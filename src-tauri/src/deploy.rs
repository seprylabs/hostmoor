//! Deploy-Skripte per ssh im Projektordner ausführen, mit Live-Ausgabe.
//!
//! Ablauf: `start` legt einen Verlaufseintrag an und startet ssh im Hintergrund.
//! Jede Ausgabezeile geht als Event `deploy-output` an die Oberfläche, am Ende
//! folgt `deploy-finished`. Gespeichert wird die Ausgabe erst zum Schluss.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

use crate::db::Db;
use crate::models::{Deploy, DeployStatus, Project, Server};
use crate::ssh;

/// Obergrenze für einen Deploy, danach wird abgebrochen
const DEPLOY_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Ab dieser Dauer gibt es eine Mitteilung, auch wenn das Fenster im Vordergrund ist
const NOTIFY_AFTER: Duration = Duration::from_secs(60);
/// Gespeicherte Ausgabe pro Deploy (das Ende ist wichtiger als der Anfang)
const MAX_OUTPUT_CHARS: usize = 200_000;

/// Laufende Deploys: Projekt-ID → Abbrechen-Signal
#[derive(Default)]
pub struct Running(Mutex<HashMap<String, (String, oneshot::Sender<()>)>>);

impl Running {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, (String, oneshot::Sender<()>)>> {
        self.0.lock().expect("deploy mutex poisoned")
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent<'a> {
    deploy_id: &'a str,
    line: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinishedEvent<'a> {
    deploy_id: &'a str,
    project_id: &'a str,
    status: DeployStatus,
}

/// Befehl, der auf dem Server ausgeführt wird: in den Projektordner wechseln
/// und das Skript mit bash (Login-Shell, damit nvm/PATH stimmen) ausführen.
/// `set -e` stoppt beim ersten Fehler, `set -x` zeigt jeden Befehl mit „$ “ an.
pub fn remote_command(dir: &str, script: &str) -> String {
    let body = format!("PS4=\"\\$ \"\nset -ex\n{script}\n");
    let quoted = ssh::shell_quote(&body);
    let target = match dir.strip_prefix("~/") {
        Some(rest) => format!("~/{}", ssh::shell_quote(rest)),
        None => ssh::shell_quote(dir),
    };
    format!(
        "cd {target} && if command -v bash >/dev/null 2>&1; then exec bash -lc {quoted}; else exec sh -lc {quoted}; fi"
    )
}

/// Startet einen Deploy und liefert sofort den Verlaufseintrag zurück
pub fn start(
    app: &AppHandle,
    project: &Project,
    server: &Server,
    deploy_id: String,
    started_at: String,
) -> Result<Deploy, String> {
    let dir = project
        .path
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .ok_or_else(|| {
            tr!(
                "The project has no path on the server.",
                "Für das Projekt ist kein Pfad auf dem Server eingetragen."
            )
        })?;
    let script = project
        .deploy_script
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            tr!(
                "The project has no deploy script yet.",
                "Für das Projekt ist noch kein Deploy-Skript hinterlegt."
            )
        })?;
    ssh::validate(server)?;
    if let Some(key) = &server.ssh_key_path
        && !ssh::expand_home(key).exists()
    {
        return Err(tr!(
            "Key file not found: {key}",
            "Key-Datei nicht gefunden: {key}"
        ));
    }
    let mut args = ssh::ssh_args(server);
    args.push(remote_command(dir, script));

    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let running = app.state::<Running>();
        let mut running = running.lock();
        if running.contains_key(&project.id) {
            return Err(tr!(
                "A deploy is already running for this project.",
                "Für dieses Projekt läuft bereits ein Deploy."
            ));
        }
        running.insert(project.id.clone(), (deploy_id.clone(), cancel_tx));
    }

    let deploy = Deploy {
        id: deploy_id,
        project_id: project.id.clone(),
        server_name: server.name.clone(),
        started_at,
        status: DeployStatus::Running,
        exit_code: None,
        duration_ms: None,
        output: String::new(),
    };
    if let Err(e) = app.state::<Db>().insert_deploy(&deploy) {
        app.state::<Running>().lock().remove(&project.id);
        return Err(e.to_string());
    }

    let app = app.clone();
    let (id, project_id) = (deploy.id.clone(), deploy.project_id.clone());
    let (project_name, server_name) = (project.name.clone(), server.name.clone());
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let (status, exit_code, output) = run(&app, &id, args, cancel_rx).await;
        app.state::<Running>().lock().remove(&project_id);
        let duration = started.elapsed().as_millis() as u64;
        if let Err(e) = app
            .state::<Db>()
            .finish_deploy(&id, status, exit_code, duration, &output)
        {
            eprintln!("Deploy {id} konnte nicht gespeichert werden: {e}");
        }
        notify(&app, &project_name, &server_name, status, started.elapsed());
        let _ = app.emit(
            "deploy-finished",
            FinishedEvent {
                deploy_id: &id,
                project_id: &project_id,
                status,
            },
        );
    });

    Ok(deploy)
}

/// macOS-Mitteilung, wenn man gerade nicht hinschaut oder der Deploy lange gedauert hat
fn notify(app: &AppHandle, project: &str, server: &str, status: DeployStatus, took: Duration) {
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if status == DeployStatus::Cancelled || (focused && took < NOTIFY_AFTER) {
        return;
    }
    let title = match status {
        DeployStatus::Success => tr!("✔ {project} deployed", "✔ {project} deployt"),
        _ => tr!(
            "✖ Deploy of {project} failed",
            "✖ Deploy von {project} fehlgeschlagen"
        ),
    };
    let secs = took.as_secs();
    let duration = if secs < 60 {
        format!("{secs} s")
    } else {
        format!("{} min {} s", secs / 60, secs % 60)
    };
    if let Err(e) = app
        .notification()
        .builder()
        .title(title)
        .body(format!("{server} · {duration}"))
        .show()
    {
        eprintln!("Mitteilung konnte nicht angezeigt werden: {e}");
    }
}

/// Bricht den laufenden Deploy eines Projekts ab; false, wenn keiner läuft
pub fn cancel(app: &AppHandle, project_id: &str) -> bool {
    match app.state::<Running>().lock().remove(project_id) {
        Some((_, cancel)) => cancel.send(()).is_ok(),
        None => false,
    }
}

/// Liest einen Ausgabestrom zeilenweise (auch bei ungültigem UTF-8)
fn forward(stream: impl AsyncRead + Unpin + Send + 'static, tx: mpsc::UnboundedSender<String>) {
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buf);
                    // Fortschrittsbalken arbeiten mit \r; nur der letzte Stand zählt
                    let line = line.trim_end_matches(['\n', '\r']);
                    let line = line.rsplit('\r').next().unwrap_or_default();
                    if tx.send(line.to_string()).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

async fn run(
    app: &AppHandle,
    deploy_id: &str,
    args: Vec<String>,
    mut cancel: oneshot::Receiver<()>,
) -> (DeployStatus, Option<i32>, String) {
    let mut output = String::new();
    let mut push = |line: &str| {
        let _ = app.emit("deploy-output", OutputEvent { deploy_id, line });
        output.push_str(line);
        output.push('\n');
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
            push(&tr!(
                "Could not start ssh: {e}",
                "ssh konnte nicht gestartet werden: {e}"
            ));
            return (DeployStatus::Failed, None, output);
        }
    };

    let (tx, mut rx) = mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        forward(stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        forward(stderr, tx);
    }

    let deadline = tokio::time::sleep(DEPLOY_TIMEOUT);
    tokio::pin!(deadline);
    let mut stopped: Option<DeployStatus> = None;

    // Ausgabe weiterreichen, bis beide Ströme zu sind (Prozess beendet oder abgebrochen)
    loop {
        tokio::select! {
            line = rx.recv() => match line {
                Some(line) => push(&line),
                None => break,
            },
            _ = &mut cancel, if stopped.is_none() => {
                let _ = child.start_kill();
                stopped = Some(DeployStatus::Cancelled);
            }
            _ = &mut deadline, if stopped.is_none() => {
                let _ = child.start_kill();
                stopped = Some(DeployStatus::Failed);
            }
        }
    }

    let code = child.wait().await.ok().and_then(|s| s.code());
    let status = match stopped {
        Some(DeployStatus::Cancelled) => {
            push("");
            push(&tr!(
                "■ Cancelled. The connection was closed; a command that was already running may still finish on the server.",
                "■ Abgebrochen. Die Verbindung wurde getrennt; ein bereits laufender Befehl kann auf dem Server noch zu Ende laufen."
            ));
            DeployStatus::Cancelled
        }
        Some(_) => {
            push("");
            push(&tr!(
                "✖ Time limit of {} minutes exceeded, deploy aborted.",
                "✖ Zeitlimit von {} Minuten überschritten, Deploy abgebrochen.",
                DEPLOY_TIMEOUT.as_secs() / 60
            ));
            DeployStatus::Failed
        }
        None if code == Some(0) => {
            push("");
            push(&tr!(
                "✔ Deploy completed successfully.",
                "✔ Deploy erfolgreich abgeschlossen."
            ));
            DeployStatus::Success
        }
        None if code == Some(255) => {
            push("");
            push(&tr!(
                "✖ The SSH connection failed. Test the connection in the server view.",
                "✖ Die SSH-Verbindung ist fehlgeschlagen. Teste die Verbindung in der Serveransicht."
            ));
            DeployStatus::Failed
        }
        None => {
            push("");
            match code {
                Some(code) => push(&tr!(
                    "✖ Deploy failed (exit code {code}). The last command above caused the error.",
                    "✖ Deploy fehlgeschlagen (Exit-Code {code}). Der letzte Befehl oben hat den Fehler ausgelöst."
                )),
                None => push(&tr!("✖ Deploy failed.", "✖ Deploy fehlgeschlagen.")),
            }
            DeployStatus::Failed
        }
    };

    if output.len() > MAX_OUTPUT_CHARS {
        let cut = output.len() - MAX_OUTPUT_CHARS;
        let cut = (cut..output.len())
            .find(|&i| output.is_char_boundary(i))
            .unwrap_or(cut);
        output = tr!(
            "… (beginning truncated)\n{}",
            "… (Anfang gekürzt)\n{}",
            &output[cut..]
        );
    }
    (status, code, output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_command_changes_dir_and_stops_on_error() {
        let cmd = remote_command("/var/www/shop", "git pull\nphp artisan migrate --force");
        assert!(cmd.starts_with("cd '/var/www/shop' && "), "{cmd}");
        assert!(cmd.contains("exec bash -lc '"));
        assert!(cmd.contains("set -ex\ngit pull\nphp artisan migrate --force\n"));
    }

    #[test]
    fn remote_command_keeps_home_and_quotes_safely() {
        let cmd = remote_command("~/sites/it's", "echo 'hi'");
        assert!(cmd.starts_with("cd ~/'sites/it'\\''s' && "), "{cmd}");
        assert!(cmd.contains("echo '\\''hi'\\''"), "{cmd}");
    }

    #[test]
    fn remote_command_runs_locally() {
        // Mit einem echten sh prüfen, dass Quoting, cd und set -e zusammenspielen
        let dir = std::env::temp_dir();
        let cmd = remote_command(dir.to_str().unwrap(), "echo eins\nfalse\necho nie");
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(!out.status.success());
        assert!(stdout.contains("eins"));
        assert!(!stdout.contains("nie"));
        assert!(stderr.contains("$ echo eins"), "{stderr}");
    }
}
