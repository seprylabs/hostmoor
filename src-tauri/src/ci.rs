//! Pipeline-Läufe von GitHub Actions und GitLab CI.
//!
//! Tokens liegen im Schlüsselbund des Systems (ein Eintrag pro Host) und verlassen
//! den Rust-Teil nie; die Oberfläche erfährt nur, ob einer hinterlegt ist.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "com.seprylabs.stackport.ci";
const RUNS_PER_PAGE: u32 = 10;
const USER_AGENT: &str = concat!("StackPort/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Forge {
    Github,
    Gitlab,
}

/// Aus der Repo-URL abgeleitet: wo liegt das Repo und unter welchem Pfad
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub forge: Forge,
    pub host: String,
    /// z. B. "owner/repo" oder bei GitLab auch "gruppe/untergruppe/repo"
    pub path: String,
    pub web_url: String,
}

/// Versteht die üblichen Formen:
/// `git@github.com:owner/repo.git`, `https://github.com/owner/repo`,
/// `ssh://git@gitlab.example.com:2222/gruppe/repo.git`, `gitlab.com/gruppe/repo`
pub fn parse_repo_url(url: &str) -> Option<Repo> {
    let url = url.trim();
    let (host, path) = if let Some(rest) = url.split_once("://").map(|(_, r)| r) {
        // https://, ssh://, git://: Benutzer und Port entfernen
        let rest = rest.rsplit_once('@').map_or(rest, |(_, r)| r);
        let (authority, path) = rest.split_once('/')?;
        (authority.split(':').next()?, path)
    } else if let Some((user_host, path)) = url.split_once(':').filter(|(h, _)| !h.contains('/')) {
        // scp-Form: git@host:pfad
        (
            user_host.rsplit_once('@').map_or(user_host, |(_, h)| h),
            path,
        )
    } else {
        url.split_once('/')?
    };

    let host = host.to_lowercase();
    let path = path
        .trim_matches('/')
        .trim_end_matches(".git")
        .split(['?', '#'])
        .next()?
        .trim_end_matches('/')
        .to_string();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let valid = |s: &&str| {
        s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if host.is_empty() || segments.len() < 2 || !segments.iter().all(valid) {
        return None;
    }

    let forge = if host == "github.com" {
        Forge::Github
    } else {
        Forge::Gitlab
    };
    // GitHub-Repos haben immer genau owner/repo; bei Links wie /tree/main den Rest abschneiden
    let path = match forge {
        Forge::Github => segments[..2].join("/"),
        Forge::Gitlab => segments.join("/"),
    };
    Some(Repo {
        web_url: format!("https://{host}/{path}"),
        forge,
        host,
        path,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Queued,
    Running,
    Success,
    Failed,
    Cancelled,
    Skipped,
    /// Wartet auf manuelle Freigabe
    Manual,
    Other,
}

impl RunStatus {
    /// Wartet oder läuft noch
    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CiRun {
    pub id: u64,
    pub title: String,
    /// Name des GitHub-Workflows; GitLab kennt das nicht
    pub workflow: Option<String>,
    pub branch: Option<String>,
    pub sha: Option<String>,
    pub status: RunStatus,
    pub event: Option<String>,
    pub actor: Option<String>,
    pub url: String,
    pub created_at: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CiResult {
    Ok {
        repo: Repo,
        runs: Vec<CiRun>,
        has_token: bool,
    },
    /// Keine oder unbrauchbare Repo-URL
    NoRepo,
    /// Token fehlt, ist abgelaufen oder hat keine Berechtigung (bei privaten Repos auch 404)
    NeedsToken {
        repo: Repo,
        has_token: bool,
    },
    Error {
        repo: Repo,
        message: String,
    },
}

// --- Credential store --------------------------------------------------------

fn entry(host: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, host).map_err(|e| store_error(host, e))
}

fn store_error(host: &str, e: keyring::Error) -> String {
    tr!(
        "Could not access the token for {host} in the system keychain ({e}).",
        "Auf den Token für {host} im Schlüsselbund des Systems konnte nicht zugegriffen werden ({e})."
    )
}

/// Ok(None) = no token stored; Err = keychain refused access or is unavailable
pub fn token(host: &str) -> Result<Option<String>, String> {
    match entry(host)?.get_password() {
        Ok(token) => Ok(Some(token).filter(|t| !t.is_empty())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(store_error(host, e)),
    }
}

pub fn set_token(host: &str, token: Option<&str>) -> Result<(), String> {
    let entry = entry(host)?;
    match token.map(str::trim).filter(|t| !t.is_empty()) {
        Some(token) => {
            entry
                .set_password(token)
                .map_err(|e| store_error(host, e))?;
            // Read back, so a problem shows up when saving and not only when loading
            match self::token(host)? {
                Some(stored) if stored == token => Ok(()),
                _ => Err(tr!(
                    "The token was saved but cannot be read back.",
                    "Der Token wurde gespeichert, lässt sich aber nicht wieder lesen."
                )),
            }
        }
        // Not existing is not an error when removing
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error(host, e)),
        },
    }
}

// --- API -------------------------------------------------------------------

#[derive(Deserialize)]
struct GithubRuns {
    workflow_runs: Vec<GithubRun>,
}

#[derive(Deserialize)]
struct GithubRun {
    id: u64,
    name: Option<String>,
    display_title: Option<String>,
    head_branch: Option<String>,
    head_sha: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
    event: Option<String>,
    html_url: String,
    created_at: String,
    updated_at: Option<String>,
    actor: Option<GithubActor>,
}

#[derive(Deserialize)]
struct GithubActor {
    login: String,
}

#[derive(Deserialize)]
struct GitlabPipeline {
    id: u64,
    status: String,
    #[serde(rename = "ref")]
    git_ref: Option<String>,
    sha: Option<String>,
    source: Option<String>,
    web_url: String,
    created_at: String,
    updated_at: Option<String>,
}

fn github_status(status: Option<&str>, conclusion: Option<&str>) -> RunStatus {
    match (status, conclusion) {
        (Some("completed"), Some("success")) => RunStatus::Success,
        (Some("completed"), Some("failure" | "timed_out" | "startup_failure")) => RunStatus::Failed,
        (Some("completed"), Some("cancelled")) => RunStatus::Cancelled,
        (Some("completed"), Some("skipped" | "neutral")) => RunStatus::Skipped,
        (Some("completed"), Some("action_required")) => RunStatus::Manual,
        (Some("in_progress"), _) => RunStatus::Running,
        (Some("queued" | "waiting" | "pending" | "requested"), _) => RunStatus::Queued,
        _ => RunStatus::Other,
    }
}

fn gitlab_status(status: &str) -> RunStatus {
    match status {
        "success" => RunStatus::Success,
        "failed" => RunStatus::Failed,
        "canceled" | "canceling" => RunStatus::Cancelled,
        "skipped" => RunStatus::Skipped,
        "manual" | "scheduled" => RunStatus::Manual,
        "running" => RunStatus::Running,
        "created" | "pending" | "preparing" | "waiting_for_resource" | "waiting_for_callback" => {
            RunStatus::Queued
        }
        _ => RunStatus::Other,
    }
}

fn short_sha(sha: Option<String>) -> Option<String> {
    sha.map(|s| s.chars().take(8).collect())
}

/// Prozent-Kodierung für den GitLab-Projektpfad (gruppe/repo → gruppe%2Frepo)
fn encode_path(path: &str) -> String {
    path.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Ergebnis einer einzelnen Abfrage
pub enum Fetch {
    Fresh {
        runs: Vec<CiRun>,
        etag: Option<String>,
    },
    /// Seit der letzten Abfrage (ETag) unverändert; zählt bei GitHub nicht aufs Limit
    NotModified,
    NeedsToken,
    Error(String),
}

/// Fragt die letzten Läufe ab; mit `etag` nur, wenn sich seitdem etwas geändert hat
pub async fn fetch(
    client: &reqwest::Client,
    repo: &Repo,
    token: Option<&str>,
    etag: Option<&str>,
) -> Fetch {
    let request = match repo.forge {
        Forge::Github => {
            let url = format!(
                "https://api.github.com/repos/{}/actions/runs?per_page={RUNS_PER_PAGE}",
                repo.path
            );
            let req = client
                .get(url)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28");
            match token {
                Some(t) => req.bearer_auth(t),
                None => req,
            }
        }
        Forge::Gitlab => {
            let url = format!(
                "https://{}/api/v4/projects/{}/pipelines?per_page={RUNS_PER_PAGE}",
                repo.host,
                encode_path(&repo.path)
            );
            let req = client.get(url);
            match token {
                Some(t) => req.header("PRIVATE-TOKEN", t),
                None => req,
            }
        }
    };
    let request = match etag {
        Some(etag) => request.header("If-None-Match", etag),
        None => request,
    };

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            return Fetch::Error(if e.is_timeout() {
                format!("{} antwortet nicht.", repo.host)
            } else if e.is_connect() {
                format!("Keine Verbindung zu {}.", repo.host)
            } else {
                e.to_string()
            });
        }
    };

    let status = response.status().as_u16();
    if status == 304 {
        return Fetch::NotModified;
    }
    // Private Repos ohne Berechtigung melden GitHub und GitLab als 404
    if status == 401 || status == 404 || (status == 403 && token.is_some()) {
        return Fetch::NeedsToken;
    }
    if status == 403 {
        return Fetch::Error(tr!(
            "Too many requests without a token. With a token the limit is much higher.",
            "Zu viele Anfragen ohne Token. Mit Token ist das Limit deutlich höher."
        ));
    }
    if !response.status().is_success() {
        return Fetch::Error(tr!(
            "Unexpected response ({status}).",
            "Unerwartete Antwort ({status})."
        ));
    }
    let etag = response
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let runs = match repo.forge {
        Forge::Github => response.json::<GithubRuns>().await.map(|r| {
            r.workflow_runs
                .into_iter()
                .map(|run| CiRun {
                    id: run.id,
                    title: run
                        .display_title
                        .or_else(|| run.name.clone())
                        .unwrap_or_else(|| "Workflow".into()),
                    workflow: run.name,
                    branch: run.head_branch,
                    sha: short_sha(run.head_sha),
                    status: github_status(run.status.as_deref(), run.conclusion.as_deref()),
                    event: run.event,
                    actor: run.actor.map(|a| a.login),
                    url: run.html_url,
                    created_at: run.created_at,
                    updated_at: run.updated_at,
                })
                .collect()
        }),
        Forge::Gitlab => response
            .json::<Vec<GitlabPipeline>>()
            .await
            .map(|pipelines| {
                pipelines
                    .into_iter()
                    .map(|p| CiRun {
                        id: p.id,
                        title: format!("Pipeline #{}", p.id),
                        workflow: None,
                        branch: p.git_ref,
                        sha: short_sha(p.sha),
                        status: gitlab_status(&p.status),
                        event: p.source,
                        actor: None,
                        url: p.web_url,
                        created_at: p.created_at,
                        updated_at: p.updated_at,
                    })
                    .collect()
            }),
    };

    match runs {
        Ok(runs) => Fetch::Fresh { runs, etag },
        Err(e) => Fetch::Error(tr!("Unreadable response: {e}", "Antwort nicht lesbar: {e}")),
    }
}

/// Für die Projektansicht: Repo erkennen, Token holen, abfragen
pub async fn runs(repo_url: &str) -> CiResult {
    let Some(repo) = parse_repo_url(repo_url) else {
        return CiResult::NoRepo;
    };
    let token = match token(&repo.host) {
        Ok(token) => token,
        Err(message) => return CiResult::Error { repo, message },
    };
    let has_token = token.is_some();
    let client = match client() {
        Ok(client) => client,
        Err(message) => return CiResult::Error { repo, message },
    };

    match fetch(&client, &repo, token.as_deref(), None).await {
        Fetch::Fresh { runs, .. } => CiResult::Ok {
            repo,
            runs,
            has_token,
        },
        Fetch::NeedsToken => CiResult::NeedsToken { repo, has_token },
        Fetch::Error(message) => CiResult::Error { repo, message },
        // Ohne ETag kann das nicht vorkommen
        Fetch::NotModified => CiResult::Ok {
            repo,
            runs: Vec::new(),
            has_token,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(url: &str) -> (Forge, String, String) {
        let r = parse_repo_url(url).unwrap_or_else(|| panic!("nicht erkannt: {url}"));
        (r.forge, r.host, r.path)
    }

    #[test]
    fn parses_common_repo_urls() {
        let gh = |p: &str| (Forge::Github, "github.com".to_string(), p.to_string());
        assert_eq!(parsed("git@github.com:owner/repo.git"), gh("owner/repo"));
        assert_eq!(parsed("https://github.com/owner/repo"), gh("owner/repo"));
        assert_eq!(
            parsed("https://github.com/owner/repo.git"),
            gh("owner/repo")
        );
        assert_eq!(
            parsed("https://github.com/owner/repo/tree/main"),
            gh("owner/repo")
        );
        assert_eq!(parsed("github.com/owner/repo"), gh("owner/repo"));
        assert_eq!(
            parsed("https://user@GitHub.com/owner/repo/"),
            gh("owner/repo")
        );

        assert_eq!(
            parsed("git@gitlab.com:agentur/kunde/shop.git"),
            (
                Forge::Gitlab,
                "gitlab.com".into(),
                "agentur/kunde/shop".into()
            )
        );
        assert_eq!(
            parsed("ssh://git@git.example.de:2222/team/app.git"),
            (Forge::Gitlab, "git.example.de".into(), "team/app".into())
        );
        assert_eq!(
            parsed("https://git.example.de/team/app"),
            (Forge::Gitlab, "git.example.de".into(), "team/app".into())
        );
    }

    #[test]
    fn rejects_unusable_urls() {
        for url in [
            "",
            "shop",
            "https://github.com/",
            "https://github.com/onlyowner",
            "git@github.com:a/b c",
        ] {
            assert!(parse_repo_url(url).is_none(), "{url}");
        }
    }

    #[test]
    fn maps_statuses() {
        assert_eq!(
            github_status(Some("completed"), Some("success")),
            RunStatus::Success
        );
        assert_eq!(
            github_status(Some("completed"), Some("failure")),
            RunStatus::Failed
        );
        assert_eq!(github_status(Some("in_progress"), None), RunStatus::Running);
        assert_eq!(github_status(Some("queued"), None), RunStatus::Queued);
        assert_eq!(gitlab_status("running"), RunStatus::Running);
        assert_eq!(gitlab_status("canceled"), RunStatus::Cancelled);
        assert_eq!(gitlab_status("manual"), RunStatus::Manual);
    }

    #[test]
    fn encodes_gitlab_path() {
        assert_eq!(encode_path("agentur/kunde/shop"), "agentur%2Fkunde%2Fshop");
    }

    #[test]
    fn parses_github_api_response() {
        let json = r#"{"total_count":1,"workflow_runs":[{"id":42,"name":"CI","display_title":"Fix login",
            "head_branch":"main","head_sha":"0123456789abcdef","status":"completed","conclusion":"failure",
            "event":"push","html_url":"https://github.com/a/b/actions/runs/42","created_at":"2026-10-26T10:00:00Z",
            "updated_at":"2026-10-26T10:03:00Z","actor":{"login":"sp"}}]}"#;
        let runs: GithubRuns = serde_json::from_str(json).unwrap();
        let run = &runs.workflow_runs[0];
        assert_eq!(run.display_title.as_deref(), Some("Fix login"));
        assert_eq!(
            github_status(run.status.as_deref(), run.conclusion.as_deref()),
            RunStatus::Failed
        );
    }
}

#[cfg(test)]
mod live {
    /// Manuell: cargo test -- --ignored live_public_github
    #[tokio::test]
    #[ignore]
    async fn live_public_github() {
        match super::runs("https://github.com/tauri-apps/tauri").await {
            super::CiResult::Ok { runs, .. } => {
                assert!(!runs.is_empty());
                println!("{:#?}", runs[0]);
            }
            other => panic!("{other:?}"),
        }
    }

    /// Manuell: cargo test -- --ignored live_etag
    #[tokio::test]
    #[ignore]
    async fn live_etag_not_modified() {
        let repo = super::parse_repo_url("https://github.com/tauri-apps/tauri").unwrap();
        let client = super::client().unwrap();
        let super::Fetch::Fresh {
            etag: Some(etag), ..
        } = super::fetch(&client, &repo, None, None).await
        else {
            panic!("kein ETag");
        };
        assert!(matches!(
            super::fetch(&client, &repo, None, Some(&etag)).await,
            super::Fetch::NotModified
        ));
    }
}
