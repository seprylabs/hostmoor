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
