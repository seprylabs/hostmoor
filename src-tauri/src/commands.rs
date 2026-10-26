use std::path::PathBuf;

use tauri::State;

use crate::db::{Db, Table};
use crate::models::{Backup, Customer, Project, Server, Snapshot};
use crate::ssh::{self, ConnectionResult};

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
pub fn save_project(db: State<Db>, project: Project) -> CmdResult<()> {
    db.save_project(&project).map_err(err)
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

/// Testet, ob sich die App per SSH am Server anmelden kann
#[tauri::command]
pub async fn test_connection(db: State<'_, Db>, id: String) -> CmdResult<ConnectionResult> {
    let server = db
        .snapshot()
        .map_err(err)?
        .servers
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("Server nicht gefunden")?;
    Ok(ssh::test_connection(&server).await)
}
