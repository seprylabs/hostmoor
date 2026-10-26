use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: String,
    pub name: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub host: String,
    pub port: u16,
    pub ssh_user: Option<String>,
    /// Nur der Pfad zum Key; die Datei wird von der App nie gelesen
    pub ssh_key_path: Option<String>,
    pub customer_id: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    /// Ergebnis des letzten SSH-Checks (JSON), wird nur vom Check geschrieben
    pub facts: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub customer_id: String,
    pub server_id: Option<String>,
    pub stack: String,
    pub domain: Option<String>,
    pub path: Option<String>,
    pub repo_url: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    /// Wird nur über die Deploy-Ansicht geändert, nicht über das Projekt-Formular
    #[serde(default)]
    pub deploy_script: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeployStatus {
    Running,
    Success,
    Failed,
    Cancelled,
    /// App wurde während des Deploys beendet
    Interrupted,
}

impl DeployStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "running" => Self::Running,
            "success" => Self::Success,
            "cancelled" => Self::Cancelled,
            "interrupted" => Self::Interrupted,
            _ => Self::Failed,
        }
    }
}

/// Ein Eintrag im Deploy-Verlauf eines Projekts
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deploy {
    pub id: String,
    pub project_id: String,
    pub server_name: String,
    pub started_at: String,
    pub status: DeployStatus,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub output: String,
}

/// Letzter Deploy eines Projekts, für den Status in der Seitenleiste
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastDeploy {
    pub project_id: String,
    pub status: DeployStatus,
    pub started_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub customers: Vec<Customer>,
    pub servers: Vec<Server>,
    pub projects: Vec<Project>,
}

/// Inhalt einer Backup-Datei
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub app: String,
    pub format_version: u32,
    pub exported_at: String,
    #[serde(flatten)]
    pub data: Snapshot,
}
