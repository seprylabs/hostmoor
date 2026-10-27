use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::db::{Db, Table};
use crate::deploy;
use crate::models::{Backup, Customer, Deploy, LastDeploy, Project, Server, Snapshot};
use crate::check::{self, CheckError};
use crate::ci::{self, CiResult};
use crate::ci_watch::{CiWatch, ProjectCi};
use crate::ssh::{self, ConnectionResult};
use crate::terminal;

type CmdResult<T> = Result<T, String>;

const BACKUP_APP: &str = "StackPort";
const BACKUP_FORMAT_VERSION: u32 = 1;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn load_all(db: State<Db>) -> CmdResult<Snapshot> {
    db.snapshot().map_err(err)
}

#[tauri::command]
pub fn save_customer(db: State<Db>, customer: Customer) -> CmdResult<()> {
    db.save_customer(&customer).map_err(err)
}

#[tauri::command]
pub fn save_server(db: State<Db>, server: Server) -> CmdResult<()> {
    db.save_server(&server).map_err(err)
}

#[tauri::command]
pub fn save_project(db: State<Db>, watch: State<CiWatch>, project: Project) -> CmdResult<()> {
    db.save_project(&project).map_err(err)?;
    // Repo-URL könnte sich geändert haben
    watch.refresh();
    Ok(())
}

#[tauri::command]
pub fn delete_entity(db: State<Db>, kind: Table, id: String) -> CmdResult<bool> {
    db.delete(kind, &id).map_err(err)
}

#[tauri::command]
pub fn set_favorite(db: State<Db>, kind: Table, id: String, favorite: bool) -> CmdResult<()> {
    db.set_favorite(kind, &id, favorite).map_err(err)
}

/// Schreibt alle Daten als JSON in die vom Nutzer gewählte Datei
#[tauri::command]
pub fn export_backup(db: State<Db>, path: PathBuf, exported_at: String) -> CmdResult<()> {
    let backup = Backup {
        app: BACKUP_APP.into(),
        format_version: BACKUP_FORMAT_VERSION,
        exported_at,
        data: db.snapshot().map_err(err)?,
    };
    let json = serde_json::to_string_pretty(&backup).map_err(err)?;
    std::fs::write(&path, json).map_err(err)
}

/// Ersetzt alle Daten durch das Backup und gibt den neuen Stand zurück
#[tauri::command]
pub fn import_backup(db: State<Db>, path: PathBuf) -> CmdResult<Snapshot> {
    let raw = std::fs::read_to_string(&path).map_err(err)?;
    let backup: Backup = serde_json::from_str(&raw)
        .map_err(|e| format!("Keine gültige StackPort-Sicherung: {e}"))?;
    if backup.app != BACKUP_APP {
        return Err("Die Datei ist keine StackPort-Sicherung.".into());
    }
    if backup.format_version > BACKUP_FORMAT_VERSION {
        return Err("Die Sicherung stammt aus einer neueren StackPort-Version.".into());
    }
    db.replace_all(&backup.data).map_err(err)?;
    db.snapshot().map_err(err)
}

fn find_server(db: &Db, id: &str) -> CmdResult<Server> {
    db.snapshot()
        .map_err(err)?
        .servers
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "Server nicht gefunden".into())
}

/// Testet, ob sich die App per SSH am Server anmelden kann
#[tauri::command]
pub async fn test_connection(db: State<'_, Db>, id: String) -> CmdResult<ConnectionResult> {
    let server = find_server(&db, &id)?;
    Ok(ssh::test_connection(&server).await)
}

#[tauri::command]
pub fn set_deploy_script(db: State<Db>, id: String, script: Option<String>) -> CmdResult<()> {
    let script = script.filter(|s| !s.trim().is_empty());
    db.set_deploy_script(&id, script.as_deref()).map_err(err)
}

#[tauri::command]
pub fn list_deploys(db: State<Db>, project_id: String) -> CmdResult<Vec<Deploy>> {
    db.deploys(&project_id).map_err(err)
}

#[tauri::command]
pub fn last_deploys(db: State<Db>) -> CmdResult<Vec<LastDeploy>> {
    db.last_deploys().map_err(err)
}

/// Startet das Deploy-Skript des Projekts auf seinem Server; die Ausgabe kommt als Events
#[tauri::command]
pub fn start_deploy(
    app: AppHandle,
    db: State<Db>,
    project_id: String,
    deploy_id: String,
    started_at: String,
) -> CmdResult<Deploy> {
    let snapshot = db.snapshot().map_err(err)?;
    let project = snapshot
        .projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or("Projekt nicht gefunden")?;
    let server_id = project
        .server_id
        .as_deref()
        .ok_or("Dem Projekt ist kein Server zugeordnet.")?;
    let server = snapshot
        .servers
        .into_iter()
        .find(|s| s.id == server_id)
        .ok_or("Server nicht gefunden")?;
    deploy::start(&app, &project, &server, deploy_id, started_at)
}

#[tauri::command]
pub fn cancel_deploy(app: AppHandle, project_id: String) -> bool {
    deploy::cancel(&app, &project_id)
}

/// Letzte Pipeline-Läufe zur Repo-URL des Projekts
#[tauri::command]
pub async fn ci_runs(db: State<'_, Db>, project_id: String) -> CmdResult<CiResult> {
    let repo_url = db
        .snapshot()
        .map_err(err)?
        .projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or("Projekt nicht gefunden")?
        .repo_url
        .unwrap_or_default();
    Ok(ci::runs(&repo_url).await)
}

/// Speichert den Token für einen Host im Schlüsselbund; leer = entfernen
#[tauri::command]
pub fn set_ci_token(watch: State<CiWatch>, host: String, token: Option<String>) -> CmdResult<()> {
    ci::set_token(&host, token.as_deref())?;
    watch.refresh();
    Ok(())
}

/// Aktueller Stand der Hintergrund-Abfrage für die Seitenleiste
#[tauri::command]
pub fn ci_overview(watch: State<CiWatch>) -> Vec<ProjectCi> {
    watch.overview()
}

/// Öffnet das Terminal mit einer SSH-Sitzung, optional direkt im Projektordner
#[tauri::command]
pub fn open_terminal(db: State<Db>, id: String, dir: Option<String>, terminal: Option<String>) -> CmdResult<()> {
    let server = find_server(&db, &id)?;
    ssh::open_terminal(&server, dir.as_deref().filter(|d| !d.trim().is_empty()), terminal.as_deref())
}

/// Installierte Terminal-Apps für die Auswahl am Terminal-Button
#[tauri::command]
pub fn list_terminals() -> Vec<terminal::TerminalApp> {
    terminal::installed()
}

/// Ergebnis von „Jetzt prüfen“: bei Verbindungsproblemen die Ursache, sonst None
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckOutcome {
    connection_error: Option<ConnectionResult>,
}

/// Liest PHP, Node, Kapazität usw. per SSH aus und speichert das Ergebnis
#[tauri::command]
pub async fn check_server(db: State<'_, Db>, id: String, checked_at: String) -> CmdResult<CheckOutcome> {
    let server = find_server(&db, &id)?;
    match check::check_server(&server, checked_at).await {
        Ok(facts) => {
            let json = serde_json::to_value(&facts).map_err(err)?;
            db.set_facts(&id, &json).map_err(err)?;
            Ok(CheckOutcome { connection_error: None })
        }
        Err(CheckError::Connection(result)) => Ok(CheckOutcome {
            connection_error: Some(result),
        }),
        Err(CheckError::Output(message)) => Err(message),
    }
}
