//! Beobachtet im Hintergrund die Pipelines aller Projekte, solange die App läuft.
//!
//! Alle 60 s (15 s, solange etwas läuft) werden die letzten Läufe jedes Repos
//! abgefragt, per ETag nur bei Änderungen. Das Ergebnis geht als Event
//! `ci-update` an die Seitenleiste; bei Start, Erfolg und Fehlschlag eines
//! Laufs gibt es eine macOS-Mitteilung.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

use crate::ci::{self, CiRun, Fetch, Repo, RunStatus};
use crate::db::Db;

const IDLE_INTERVAL: Duration = Duration::from_secs(60);
const ACTIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Stand je Projekt für die Seitenleiste
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCi {
    pub project_id: String,
    /// Wartende und laufende Läufe
    pub active: Vec<CiRun>,
    /// Status des neuesten abgeschlossenen Laufs
    pub latest: Option<RunStatus>,
    pub latest_at: Option<String>,
}

/// Gemeinsamer Zustand: letzter Stand für die Oberfläche und ein Signal zum sofortigen Neuladen
#[derive(Default)]
pub struct CiWatch {
    overview: Mutex<Vec<ProjectCi>>,
    wake: Notify,
}

impl CiWatch {
    pub fn overview(&self) -> Vec<ProjectCi> {
        self.overview.lock().expect("ci mutex poisoned").clone()
    }

    /// Sofort neu abfragen, z. B. nach neuem Token oder geänderter Repo-URL
    pub fn refresh(&self) {
        self.wake.notify_one();
    }
}

/// Was sich an einem Lauf seit der letzten Abfrage geändert hat
#[derive(Debug, PartialEq)]
enum Change {
    Started,
    Finished(RunStatus),
}

/// Vergleicht alten und neuen Status eines Laufs.
/// Läufe, die beim ersten Abfragen schon da sind, lösen nichts aus.
fn change(previous: Option<RunStatus>, now: RunStatus, baseline: bool) -> Option<Change> {
    let finished = matches!(now, RunStatus::Success | RunStatus::Failed);
    match previous {
        None if baseline => None,
        None if now.is_active() => Some(Change::Started),
        // Zwischen zwei Abfragen gestartet und schon fertig
        None if finished => Some(Change::Finished(now)),
        Some(prev) if prev.is_active() && finished => Some(Change::Finished(now)),
        _ => None,
    }
}

fn summarize(project_id: &str, runs: &[CiRun]) -> ProjectCi {
    let latest = runs.iter().find(|r| !r.status.is_active());
    ProjectCi {
        project_id: project_id.to_string(),
        active: runs
            .iter()
            .filter(|r| r.status.is_active())
            .cloned()
            .collect(),
        latest: latest.map(|r| r.status),
        latest_at: latest.map(|r| r.created_at.clone()),
    }
}

fn notify(app: &AppHandle, project: &str, run: &CiRun, change: &Change) {
    let title = match change {
        Change::Started => format!("▶ CI gestartet: {project}"),
        Change::Finished(RunStatus::Success) => format!("✔ CI erfolgreich: {project}"),
        Change::Finished(_) => format!("✖ CI fehlgeschlagen: {project}"),
    };
    let body = match &run.branch {
        Some(branch) => format!("{} · {branch}", run.title),
        None => run.title.clone(),
    };
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("Mitteilung konnte nicht angezeigt werden: {e}");
    }
}

#[derive(Default)]
struct State {
    /// ETag und letzte Läufe je Repo ("host/pfad")
    cache: HashMap<String, (Option<String>, Vec<CiRun>)>,
    /// Bekannter Status je Lauf
    known: HashMap<(String, u64), RunStatus>,
    /// Tokens aus dem Schlüsselbund; nur bei refresh() neu gelesen, damit macOS nicht ständig fragt
    tokens: HashMap<String, Option<String>>,
    /// Repos, die schon einmal abgefragt wurden (für den Ausgangsstand ohne Mitteilungen)
    seen: HashSet<String>,
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut state = State::default();
        let Ok(client) = ci::client() else { return };
        loop {
            let any_active = cycle(&app, &client, &mut state).await;
            let wait = if any_active {
                ACTIVE_INTERVAL
            } else {
                IDLE_INTERVAL
            };
            let watch = app.state::<CiWatch>();
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = watch.wake.notified() => state.tokens.clear(),
            }
        }
    });
}

/// Projekt-ID und Projektname
type ProjectRef = (String, String);

/// Eine Runde über alle Repos; true, wenn irgendwo etwas läuft
async fn cycle(app: &AppHandle, client: &reqwest::Client, state: &mut State) -> bool {
    let Ok(snapshot) = app.state::<Db>().snapshot() else {
        return false;
    };

    // Mehrere Projekte können dasselbe Repo nutzen: einmal abfragen, allen zuordnen
    let mut repos: Vec<(String, Repo, Vec<ProjectRef>)> = Vec::new();
    for project in &snapshot.projects {
        let Some(repo) = project.repo_url.as_deref().and_then(ci::parse_repo_url) else {
            continue;
        };
        let key = format!("{}/{}", repo.host, repo.path);
        match repos.iter_mut().find(|(k, _, _)| *k == key) {
            Some((_, _, projects)) => projects.push((project.id.clone(), project.name.clone())),
            None => repos.push((key, repo, vec![(project.id.clone(), project.name.clone())])),
        }
    }

    let mut overview = Vec::new();
    for (key, repo, projects) in &repos {
        let token = state
            .tokens
            .entry(repo.host.clone())
            .or_insert_with(|| ci::token(&repo.host).ok().flatten())
            .clone();
        let etag = state.cache.get(key).and_then(|(etag, _)| etag.clone());

        match ci::fetch(client, repo, token.as_deref(), etag.as_deref()).await {
            Fetch::Fresh { runs, etag } => {
                state.cache.insert(key.clone(), (etag, runs));
            }
            Fetch::NotModified => {}
            // Kein Zugriff oder offline: alten Stand behalten, beim nächsten Mal erneut versuchen
            Fetch::NeedsToken | Fetch::Error(_) => {
                if !state.cache.contains_key(key) {
                    continue;
                }
            }
        }
        let Some((_, runs)) = state.cache.get(key) else {
            continue;
        };

        let baseline = state.seen.insert(key.clone());
        let names = projects
            .iter()
            .map(|(_, name)| name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        for run in runs {
            let previous = state.known.insert((key.clone(), run.id), run.status);
            if let Some(change) = change(previous, run.status, baseline) {
                notify(app, &names, run, &change);
            }
        }
        for (project_id, _) in projects {
            overview.push(summarize(project_id, runs));
        }
    }

    let any_active = overview.iter().any(|p| !p.active.is_empty());
    let watch = app.state::<CiWatch>();
    let changed = {
        let mut current = watch.overview.lock().expect("ci mutex poisoned");
        let changed = *current != overview;
        *current = overview.clone();
        changed
    };
    if changed {
        let _ = app.emit("ci-update", &overview);
    }
    any_active
}

#[cfg(test)]
mod tests {
    use super::*;
    use RunStatus::*;

    #[test]
    fn no_notifications_for_existing_runs_on_first_poll() {
        assert_eq!(change(None, Running, true), None);
        assert_eq!(change(None, Failed, true), None);
    }

    #[test]
    fn notifies_start_and_result() {
        assert_eq!(change(None, Queued, false), Some(Change::Started));
        assert_eq!(change(Some(Queued), Running, false), None);
        assert_eq!(
            change(Some(Running), Success, false),
            Some(Change::Finished(Success))
        );
        assert_eq!(
            change(Some(Running), Failed, false),
            Some(Change::Finished(Failed))
        );
        // Abgebrochen oder schon bekannt: still
        assert_eq!(change(Some(Running), Cancelled, false), None);
        assert_eq!(change(Some(Success), Success, false), None);
    }

    #[test]
    fn notifies_result_of_run_that_was_missed_while_running() {
        assert_eq!(
            change(None, Success, false),
            Some(Change::Finished(Success))
        );
        assert_eq!(change(None, Skipped, false), None);
    }
}
