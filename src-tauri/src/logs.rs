//! Read-only log viewer: shows the end of a log file on the server and follows it live.
//!
//! `read` returns the last lines once (`tail -n`). `follow` keeps `tail -F` running over
//! ssh and sends new lines in batches as the event `log-lines` until `stop` is called
//! or the view closes. Nothing on the server is ever written.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

use crate::models::{Project, Server};
use crate::ssh;

/// Upper limit for lines loaded at once
pub const MAX_LINES: u32 = 5000;
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// Lines sent to the UI in one event at most, so a noisy log doesn't flood it
const BATCH: usize = 500;

/// Running `tail -F` sessions: stream ID → stop signal
#[derive(Default)]
pub struct Following(Mutex<HashMap<String, oneshot::Sender<()>>>);

impl Following {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<()>>> {
        self.0.lock().expect("log mutex poisoned")
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinesEvent<'a> {
    stream_id: &'a str,
    lines: &'a [String],
    /// Last event of the stream
    ended: bool,
    /// Why following ended on its own (connection lost …); empty when stopped on purpose
    reason: Option<String>,
}

/// Remote command for `tail`. Relative paths start in the project folder.
pub fn tail_command(
    project_dir: Option<&str>,
    file: &str,
    lines: u32,
    follow: bool,
) -> Result<String, String> {
    let file = file.trim();
    if file.is_empty() {
        return Err(tr!("No log file given.", "Keine Log-Datei angegeben."));
    }
    let lines = lines.min(MAX_LINES);
    let flag = if follow { " -F" } else { "" };
    let tail = format!("tail -n {lines}{flag} -- {}", ssh::quote_path(file));
    if file.starts_with('/') || file.starts_with("~/") {
        return Ok(tail);
    }
    let dir = project_dir
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .ok_or_else(|| {
            tr!(
                "Relative log paths need the project's path on the server.",
                "Relative Log-Pfade brauchen den Pfad des Projekts auf dem Server."
            )
        })?;
    Ok(format!("cd {} && {tail}", ssh::quote_path(dir)))
}

fn project_dir(project: &Project) -> Option<&str> {
    project.path.as_deref()
}

/// Last lines of a log file
pub async fn read(
    project: &Project,
    server: &Server,
    file: &str,
    lines: u32,
) -> Result<String, String> {
    let cmd = tail_command(project_dir(project), file, lines.max(1), false)?;
    // tail's own errors (file missing, no permission) go to stderr with a non-zero code
    let cmd = format!("{cmd} 2>&1");
    ssh::run(server, &cmd, READ_TIMEOUT).await.map_err(|e| {
        e.detail.unwrap_or_else(|| {
            tr!(
                "The SSH connection failed.",
                "Die SSH-Verbindung ist fehlgeschlagen."
            )
        })
    })
}

/// Starts following a log file; new lines arrive as `log-lines` events with `stream_id`
pub fn follow(
    app: &AppHandle,
    project: &Project,
    server: &Server,
    file: &str,
    stream_id: String,
) -> Result<(), String> {
    let cmd = tail_command(project_dir(project), file, 0, true)?;
    ssh::validate(server)?;
    let mut args = ssh::ssh_args(server);
    args.push(cmd);

    let (stop_tx, mut stop_rx) = oneshot::channel();
    app.state::<Following>()
        .lock()
        .insert(stream_id.clone(), stop_tx);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let emit = |lines: &[String], ended: bool, reason: Option<String>| {
            let _ = app.emit(
                "log-lines",
                LinesEvent {
                    stream_id: &stream_id,
                    lines,
                    ended,
                    reason,
                },
            );
        };
        let mut child = match Command::new("ssh")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                app.state::<Following>().lock().remove(&stream_id);
                emit(
                    &[],
                    true,
                    Some(tr!(
                        "Could not start ssh: {e}",
                        "ssh konnte nicht gestartet werden: {e}"
                    )),
                );
                return;
            }
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        if let Some(stdout) = child.stdout.take() {
            crate::deploy::forward(stdout, tx.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            crate::deploy::forward(stderr, tx);
        }

        let mut stopped = false;
        loop {
            tokio::select! {
                line = rx.recv() => match line {
                    Some(line) => {
                        let mut batch = vec![line];
                        while batch.len() < BATCH {
                            match rx.try_recv() {
                                Ok(line) => batch.push(line),
                                Err(_) => break,
                            }
                        }
                        emit(&batch, false, None);
                    }
                    None => break,
                },
                _ = &mut stop_rx, if !stopped => {
                    stopped = true;
                    let _ = child.start_kill();
                }
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        app.state::<Following>().lock().remove(&stream_id);
        let reason = if stopped {
            None
        } else if code == Some(255) {
            Some(tr!(
                "The SSH connection was lost.",
                "Die SSH-Verbindung wurde getrennt."
            ))
        } else {
            Some(tr!("Following stopped.", "Mitlesen beendet."))
        };
        emit(&[], true, reason);
    });
    Ok(())
}

/// Stops following; false when the stream was not running
pub fn stop(app: &AppHandle, stream_id: &str) -> bool {
    match app.state::<Following>().lock().remove(stream_id) {
        Some(stop) => stop.send(()).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_start_in_project_folder() {
        let cmd = tail_command(
            Some("/var/www/shop"),
            "storage/logs/laravel.log",
            200,
            false,
        )
        .unwrap();
        assert_eq!(
            cmd,
            "cd '/var/www/shop' && tail -n 200 -- 'storage/logs/laravel.log'"
        );
    }

    #[test]
    fn absolute_and_home_paths_ignore_project_folder() {
        assert_eq!(
            tail_command(None, "/var/log/nginx/error.log", 50, true).unwrap(),
            "tail -n 50 -F -- '/var/log/nginx/error.log'"
        );
        assert_eq!(
            tail_command(Some("/srv"), "~/logs/php errors.log", 10, false).unwrap(),
            "tail -n 10 -- ~/'logs/php errors.log'"
        );
    }

    #[test]
    fn rejects_relative_path_without_project_folder_and_clamps_lines() {
        assert!(tail_command(None, "storage/logs/laravel.log", 10, false).is_err());
        assert!(tail_command(Some("/srv"), "  ", 10, false).is_err());
        assert!(
            tail_command(None, "/a.log", 999_999, false)
                .unwrap()
                .contains("-n 5000 ")
        );
    }

    #[test]
    fn quoting_survives_a_real_shell() {
        // A hostile file name must stay one argument and not run anything
        let dir = std::env::temp_dir().join("hostmoor-log-test");
        std::fs::create_dir_all(&dir).unwrap();
        let name = "a'; touch pwned; '.log";
        std::fs::write(dir.join(name), "one\ntwo\nthree\n").unwrap();
        let cmd = tail_command(dir.to_str(), name, 2, false).unwrap();
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), "two\nthree\n");
        assert!(!dir.join("pwned").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
