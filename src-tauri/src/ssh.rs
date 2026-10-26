//! Verbindungen über das System-`ssh` des Macs.
//!
//! Die App liest nie den Inhalt einer Key-Datei. Sie prüft höchstens, ob die
//! Datei existiert, und übergibt den Pfad an `ssh -i`.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::process::Command;

use crate::models::Server;

/// Obergrenze für einen Verbindungstest, falls `ssh` trotz ConnectTimeout hängt
pub const HARD_TIMEOUT: Duration = Duration::from_secs(25);
const CONNECT_TIMEOUT_SECS: u32 = 8;
/// Wird vom Server zurückgegeben, wenn Anmeldung und Befehlsausführung klappen
const OK_MARKER: &str = "stackport-ok";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatus {
    Ok,
    /// Server noch nicht in known_hosts, muss einmal bestätigt werden
    UnknownHost,
    /// Host-Key hat sich geändert: Server neu installiert oder Angriff
    HostKeyChanged,
    /// Key wird vom Server nicht akzeptiert (nicht eingerichtet, falscher Benutzer, Passphrase nicht im Agent)
    AuthFailed,
    KeyNotFound,
    /// Key-Datei ist für andere lesbar, ssh verweigert sie
    KeyPermissions,
    DnsFailed,
    Refused,
    Timeout,
    Unreachable,
    InvalidConfig,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResult {
    pub status: ConnectionStatus,
    /// Ausgabe von ssh (stderr), gekürzt, für Details
    pub detail: Option<String>,
    pub duration_ms: u64,
}

/// `~/…` zum Home-Verzeichnis auflösen (ohne die Datei anzufassen)
pub fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(path),
    }
}

/// Einfache Plausibilitätsprüfung, damit Eingaben nicht als ssh-Optionen interpretiert werden
fn validate(server: &Server) -> Result<(), String> {
    let ok_host = !server.host.is_empty()
        && !server.host.starts_with('-')
        && server
            .host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '_' | '[' | ']'));
    if !ok_host {
        return Err(format!("Ungültiger Host: „{}“", server.host));
    }
    if let Some(user) = &server.ssh_user {
        let ok_user = !user.starts_with('-')
            && user
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
        if !ok_user {
            return Err(format!("Ungültiger SSH-Benutzer: „{user}“"));
        }
    }
    Ok(())
}

/// Argumente für `ssh`, ohne den auszuführenden Befehl
pub fn ssh_args(server: &Server) -> Vec<String> {
    let mut args = vec![
        // Nie interaktiv nachfragen (Passwort, Passphrase, Host bestätigen)
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        format!("ConnectTimeout={CONNECT_TIMEOUT_SECS}"),
        // Unbekannte Server nicht still akzeptieren
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-p".into(),
        server.port.to_string(),
    ];
    if let Some(key) = &server.ssh_key_path {
        args.push("-i".into());
        args.push(expand_home(key).to_string_lossy().into_owned());
        // Nur diesen Key anbieten, nicht alle aus dem Agent
        args.push("-o".into());
        args.push("IdentitiesOnly=yes".into());
    }
    args.push("--".into());
    args.push(match &server.ssh_user {
        Some(user) => format!("{user}@{}", server.host),
        None => server.host.clone(),
    });
    args
}

/// Ordnet die Fehlermeldung von ssh einer verständlichen Ursache zu
pub fn classify(stderr: &str) -> ConnectionStatus {
    let s = stderr.to_lowercase();
    if s.contains("remote host identification has changed") {
        ConnectionStatus::HostKeyChanged
    } else if s.contains("unprotected private key file") || s.contains("bad permissions") {
        ConnectionStatus::KeyPermissions
    } else if s.contains("no such file or directory") && s.contains("identity file") {
        ConnectionStatus::KeyNotFound
    } else if s.contains("host key verification failed")
        || s.contains("no ed25519 host key is known")
        || s.contains("host key is known")
    {
        ConnectionStatus::UnknownHost
    } else if s.contains("permission denied") || s.contains("too many authentication failures") {
        ConnectionStatus::AuthFailed
    } else if s.contains("could not resolve hostname") || s.contains("nodename nor servname") {
        ConnectionStatus::DnsFailed
    } else if s.contains("connection refused") {
        ConnectionStatus::Refused
    } else if s.contains("timed out") {
        ConnectionStatus::Timeout
    } else if s.contains("no route to host") || s.contains("network is unreachable") {
        ConnectionStatus::Unreachable
    } else {
        ConnectionStatus::Unknown
    }
}

fn trim_detail(stderr: &str) -> Option<String> {
    let text = stderr.trim();
    if text.is_empty() {
        return None;
    }
    // Lange Banner/Warnungen abschneiden
    Some(text.chars().take(2000).collect())
}

/// Führt `remote_command` per ssh aus und liefert stdout.
/// Schlägt die Anmeldung fehl, kommt ein `ConnectionResult` mit der erkannten Ursache zurück.
pub async fn run(server: &Server, remote_command: &str, limit: Duration) -> Result<String, ConnectionResult> {
    let started = Instant::now();
    let fail = |status, detail: Option<String>| ConnectionResult {
        status,
        detail,
        duration_ms: started.elapsed().as_millis() as u64,
    };

    validate(server).map_err(|message| fail(ConnectionStatus::InvalidConfig, Some(message)))?;
    if let Some(key) = &server.ssh_key_path {
        // Nur prüfen, ob es die Datei gibt; gelesen wird sie nicht
        if !expand_home(key).exists() {
            return Err(fail(
                ConnectionStatus::KeyNotFound,
                Some(format!("Datei nicht gefunden: {key}")),
            ));
        }
    }

    let mut cmd = Command::new("ssh");
    cmd.args(ssh_args(server))
        .arg(remote_command)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);

    let output = match tokio::time::timeout(limit, cmd.output()).await {
        Err(_) => return Err(fail(ConnectionStatus::Timeout, None)),
        Ok(Err(e)) => {
            return Err(fail(
                ConnectionStatus::Unknown,
                Some(format!("ssh konnte nicht gestartet werden: {e}")),
            ));
        }
        Ok(Ok(output)) => output,
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    // 255 = Fehler von ssh selbst; andere Codes kommen vom Befehl auf dem Server
    if output.status.code() == Some(255) || output.status.code().is_none() {
        return Err(fail(classify(&stderr), trim_detail(&stderr)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Für die Shell auf dem Server in einfache Anführungszeichen setzen
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub async fn test_connection(server: &Server) -> ConnectionResult {
    let started = Instant::now();
    let result = run(server, &format!("echo {OK_MARKER}"), HARD_TIMEOUT).await;
    match result {
        Ok(stdout) if stdout.contains(OK_MARKER) => ConnectionResult {
            status: ConnectionStatus::Ok,
            detail: None,
            duration_ms: started.elapsed().as_millis() as u64,
        },
        Ok(stdout) => ConnectionResult {
            status: ConnectionStatus::Unknown,
            detail: trim_detail(&format!("Unerwartete Antwort vom Server: {stdout}")),
            duration_ms: started.elapsed().as_millis() as u64,
        },
        Err(result) => result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server() -> Server {
        Server {
            id: "s1".into(),
            name: "web".into(),
            provider: "hetzner".into(),
            host: "203.0.113.10".into(),
            port: 2222,
            ssh_user: Some("deploy".into()),
            ssh_key_path: Some("~/.ssh/test_key".into()),
            customer_id: None,
            notes: None,
            favorite: false,
            facts: None,
        }
    }

    #[test]
    fn args_never_prompt_and_use_given_key_only() {
        let args = ssh_args(&server()).join(" ");
        assert!(args.contains("BatchMode=yes"));
        assert!(args.contains("StrictHostKeyChecking=yes"));
        assert!(args.contains("-p 2222"));
        assert!(args.contains("IdentitiesOnly=yes"));
        assert!(args.ends_with("-- deploy@203.0.113.10"));
        assert!(!args.contains("~/"), "Pfad muss aufgelöst sein: {args}");
    }

    #[test]
    fn args_without_user_and_key() {
        let mut s = server();
        s.ssh_user = None;
        s.ssh_key_path = None;
        let args = ssh_args(&s);
        assert!(!args.contains(&"-i".to_string()));
        assert_eq!(args.last().unwrap(), "203.0.113.10");
    }

    #[test]
    fn rejects_option_injection() {
        let mut s = server();
        s.host = "-oProxyCommand=evil".into();
        assert!(validate(&s).is_err());
        let mut s = server();
        s.ssh_user = Some("-oFoo".into());
        assert!(validate(&s).is_err());
        assert!(validate(&server()).is_ok());
    }

    #[test]
    fn classifies_typical_ssh_errors() {
        use ConnectionStatus::*;
        let cases = [
            (
                "deploy@203.0.113.10: Permission denied (publickey).",
                AuthFailed,
            ),
            (
                "No ED25519 host key is known for 203.0.113.10 and you have requested strict checking.\r\nHost key verification failed.",
                UnknownHost,
            ),
            (
                "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.",
                HostKeyChanged,
            ),
            (
                "ssh: Could not resolve hostname nope.example: nodename nor servname provided, or not known",
                DnsFailed,
            ),
            (
                "ssh: connect to host 203.0.113.10 port 2222: Connection refused",
                Refused,
            ),
            (
                "ssh: connect to host 203.0.113.10 port 22: Operation timed out",
                Timeout,
            ),
            (
                "ssh: connect to host 10.0.0.1 port 22: No route to host",
                Unreachable,
            ),
            (
                "Warning: Identity file /Users/x/.ssh/nope not accessible: No such file or directory.",
                KeyNotFound,
            ),
            (
                "WARNING: UNPROTECTED PRIVATE KEY FILE!\nPermissions 0644 for 'key' are too open.\nbad permissions: ignore key",
                KeyPermissions,
            ),
            ("something else", Unknown),
        ];
        for (stderr, expected) in cases {
            assert_eq!(classify(stderr), expected, "{stderr}");
        }
    }

    #[test]
    fn quotes_for_remote_shell() {
        assert_eq!(shell_quote("echo hi"), "'echo hi'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn expands_home_without_touching_file() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            expand_home("~/.ssh/x"),
            PathBuf::from(format!("{home}/.ssh/x"))
        );
        assert_eq!(expand_home("/abs/key"), PathBuf::from("/abs/key"));
    }
}
