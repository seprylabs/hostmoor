use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, params};

use crate::models::{Customer, Deploy, DeployStatus, LastDeploy, Project, Server, Snapshot};

pub struct Db(Mutex<Connection>);

/// Schema-Versionen; neue Migrationen nur hinten anhängen
const MIGRATIONS: &[&str] = &[
    r#"
    CREATE TABLE customers (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL,
        notes TEXT
    );
    CREATE TABLE servers (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        provider     TEXT NOT NULL,
        host         TEXT NOT NULL,
        port         INTEGER NOT NULL DEFAULT 22,
        ssh_user     TEXT,
        ssh_key_path TEXT,
        customer_id  TEXT REFERENCES customers(id) ON DELETE SET NULL,
        notes        TEXT,
        facts_json   TEXT
    );
    CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        server_id   TEXT REFERENCES servers(id) ON DELETE SET NULL,
        stack       TEXT NOT NULL,
        domain      TEXT,
        path        TEXT,
        repo_url    TEXT,
        notes       TEXT
    );
"#,
    r#"
    ALTER TABLE customers ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE servers   ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE projects  ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
"#,
    r#"
    ALTER TABLE projects ADD COLUMN deploy_script TEXT;
    CREATE TABLE deploys (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        server_name TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        status      TEXT NOT NULL,
        exit_code   INTEGER,
        duration_ms INTEGER,
        output      TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX deploys_by_project ON deploys(project_id, started_at);
"#,
];

/// So viele Deploys pro Projekt bleiben im Verlauf
const DEPLOY_HISTORY: i64 = 20;

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> rusqlite::Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
        }
        // Deploys, die beim letzten Beenden der App noch liefen, können nicht mehr fertig werden
        conn.execute(
            "UPDATE deploys SET status = 'interrupted' WHERE status = 'running'",
            [],
        )?;
        Ok(Self(Mutex::new(conn)))
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().expect("db mutex poisoned")
    }

    pub fn snapshot(&self) -> rusqlite::Result<Snapshot> {
        let conn = self.conn();

        let customers = conn
            .prepare(
                "SELECT id, name, notes, favorite FROM customers ORDER BY name COLLATE NOCASE",
            )?
            .query_map([], |r| {
                Ok(Customer {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    notes: r.get(2)?,
                    favorite: r.get(3)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let servers = conn
            .prepare(
                "SELECT id, name, provider, host, port, ssh_user, ssh_key_path, customer_id, notes, facts_json, favorite
                 FROM servers ORDER BY name COLLATE NOCASE",
            )?
            .query_map([], |r| {
                let facts: Option<String> = r.get(9)?;
                Ok(Server {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    provider: r.get(2)?,
                    host: r.get(3)?,
                    port: r.get(4)?,
                    ssh_user: r.get(5)?,
                    ssh_key_path: r.get(6)?,
                    customer_id: r.get(7)?,
                    notes: r.get(8)?,
                    favorite: r.get(10)?,
                    facts: facts.and_then(|f| serde_json::from_str(&f).ok()),
                })
            })?
            .collect::<Result<_, _>>()?;

        let projects = conn
            .prepare(
                "SELECT id, name, customer_id, server_id, stack, domain, path, repo_url, notes, favorite, deploy_script
                 FROM projects ORDER BY name COLLATE NOCASE",
            )?
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    customer_id: r.get(2)?,
                    server_id: r.get(3)?,
                    stack: r.get(4)?,
                    domain: r.get(5)?,
                    path: r.get(6)?,
                    repo_url: r.get(7)?,
                    notes: r.get(8)?,
                    favorite: r.get(9)?,
                    deploy_script: r.get(10)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(Snapshot {
            customers,
            servers,
            projects,
        })
    }

    pub fn save_customer(&self, c: &Customer) -> rusqlite::Result<()> {
        upsert_customer(&self.conn(), c)
    }

    /// Speichert die Stammdaten; `facts` und `favorite` bleiben unverändert
    pub fn save_server(&self, s: &Server) -> rusqlite::Result<()> {
        upsert_server(&self.conn(), s)
    }

    pub fn save_project(&self, p: &Project) -> rusqlite::Result<()> {
        upsert_project(&self.conn(), p)
    }

    /// Speichert das Ergebnis eines Server-Checks
    pub fn set_facts(&self, server_id: &str, facts: &serde_json::Value) -> rusqlite::Result<bool> {
        let changed = self.conn().execute(
            "UPDATE servers SET facts_json = ?1 WHERE id = ?2",
            params![facts.to_string(), server_id],
        )?;
        Ok(changed > 0)
    }

    pub fn set_deploy_script(&self, project_id: &str, script: Option<&str>) -> rusqlite::Result<()> {
        self.conn().execute(
            "UPDATE projects SET deploy_script = ?1 WHERE id = ?2",
            params![script, project_id],
        )?;
        Ok(())
    }

    pub fn insert_deploy(&self, d: &Deploy) -> rusqlite::Result<()> {
        self.conn().execute(
            "INSERT INTO deploys (id, project_id, server_name, started_at, status) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![d.id, d.project_id, d.server_name, d.started_at, d.status.as_str()],
        )?;
        Ok(())
    }

    /// Schließt einen Deploy ab und kürzt den Verlauf auf die letzten Einträge
    pub fn finish_deploy(
        &self,
        id: &str,
        status: DeployStatus,
        exit_code: Option<i32>,
        duration_ms: u64,
        output: &str,
    ) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE deploys SET status = ?1, exit_code = ?2, duration_ms = ?3, output = ?4 WHERE id = ?5",
            params![status.as_str(), exit_code, duration_ms as i64, output, id],
        )?;
        conn.execute(
            "DELETE FROM deploys WHERE project_id = (SELECT project_id FROM deploys WHERE id = ?1)
               AND id NOT IN (
                 SELECT id FROM deploys WHERE project_id = (SELECT project_id FROM deploys WHERE id = ?1)
                 ORDER BY started_at DESC LIMIT ?2)",
            params![id, DEPLOY_HISTORY],
        )?;
        Ok(())
    }

    /// Neueste zuerst
    pub fn deploys(&self, project_id: &str) -> rusqlite::Result<Vec<Deploy>> {
        self.conn()
            .prepare(
                "SELECT id, project_id, server_name, started_at, status, exit_code, duration_ms, output
                 FROM deploys WHERE project_id = ?1 ORDER BY started_at DESC",
            )?
            .query_map([project_id], |r| {
                let status: String = r.get(4)?;
                let duration: Option<i64> = r.get(6)?;
                Ok(Deploy {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    server_name: r.get(2)?,
                    started_at: r.get(3)?,
                    status: DeployStatus::parse(&status),
                    exit_code: r.get(5)?,
                    duration_ms: duration.map(|d| d as u64),
                    output: r.get(7)?,
                })
            })?
            .collect()
    }

    /// Je Projekt nur der neueste Deploy
    pub fn last_deploys(&self) -> rusqlite::Result<Vec<LastDeploy>> {
        self.conn()
            .prepare(
                "SELECT project_id, status, MAX(started_at) FROM deploys GROUP BY project_id",
            )?
            .query_map([], |r| {
                let status: String = r.get(1)?;
                Ok(LastDeploy {
                    project_id: r.get(0)?,
                    status: DeployStatus::parse(&status),
                    started_at: r.get(2)?,
                })
            })?
            .collect()
    }

    pub fn set_favorite(&self, table: Table, id: &str, favorite: bool) -> rusqlite::Result<()> {
        let sql = format!("UPDATE {} SET favorite = ?1 WHERE id = ?2", table.name());
        self.conn().execute(&sql, params![favorite, id])?;
        Ok(())
    }

    /// Ersetzt alle Daten durch den Inhalt eines Backups (alles oder nichts)
    pub fn replace_all(&self, data: &Snapshot) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute_batch("DELETE FROM projects; DELETE FROM servers; DELETE FROM customers;")?;
        for c in &data.customers {
            upsert_customer(&tx, c)?;
            tx.execute(
                "UPDATE customers SET favorite = ?1 WHERE id = ?2",
                params![c.favorite, c.id],
            )?;
        }
        for s in &data.servers {
            upsert_server(&tx, s)?;
            let facts = s.facts.as_ref().map(|f| f.to_string());
            tx.execute(
                "UPDATE servers SET favorite = ?1, facts_json = ?2 WHERE id = ?3",
                params![s.favorite, facts, s.id],
            )?;
        }
        for p in &data.projects {
            upsert_project(&tx, p)?;
            tx.execute(
                "UPDATE projects SET favorite = ?1, deploy_script = ?2 WHERE id = ?3",
                params![p.favorite, p.deploy_script, p.id],
            )?;
        }
        tx.commit()
    }

    pub fn delete(&self, table: Table, id: &str) -> rusqlite::Result<bool> {
        let sql = format!("DELETE FROM {} WHERE id = ?1", table.name());
        Ok(self.conn().execute(&sql, [id])? > 0)
    }

    #[cfg(test)]
    fn exists(&self, table: Table, id: &str) -> bool {
        use rusqlite::OptionalExtension;
        let sql = format!("SELECT 1 FROM {} WHERE id = ?1", table.name());
        self.conn()
            .query_row(&sql, [id], |_| Ok(()))
            .optional()
            .unwrap()
            .is_some()
    }
}

fn upsert_customer(conn: &Connection, c: &Customer) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO customers (id, name, notes) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, notes = excluded.notes",
        params![c.id, c.name, c.notes],
    )?;
    Ok(())
}

fn upsert_server(conn: &Connection, s: &Server) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO servers (id, name, provider, host, port, ssh_user, ssh_key_path, customer_id, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, provider = excluded.provider, host = excluded.host,
            port = excluded.port, ssh_user = excluded.ssh_user, ssh_key_path = excluded.ssh_key_path,
            customer_id = excluded.customer_id, notes = excluded.notes",
        params![
            s.id, s.name, s.provider, s.host, s.port, s.ssh_user, s.ssh_key_path, s.customer_id,
            s.notes
        ],
    )?;
    Ok(())
}

fn upsert_project(conn: &Connection, p: &Project) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO projects (id, name, customer_id, server_id, stack, domain, path, repo_url, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, customer_id = excluded.customer_id, server_id = excluded.server_id,
            stack = excluded.stack, domain = excluded.domain, path = excluded.path,
            repo_url = excluded.repo_url, notes = excluded.notes",
        params![
            p.id, p.name, p.customer_id, p.server_id, p.stack, p.domain, p.path, p.repo_url,
            p.notes
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Table {
    Customer,
    Server,
    Project,
}

impl Table {
    fn name(self) -> &'static str {
        match self {
            Table::Customer => "customers",
            Table::Server => "servers",
            Table::Project => "projects",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn customer(id: &str) -> Customer {
        Customer {
            id: id.into(),
            name: format!("Kunde {id}"),
            notes: None,
            favorite: false,
        }
    }

    fn server(id: &str, customer_id: Option<&str>) -> Server {
        Server {
            id: id.into(),
            name: id.into(),
            provider: "hetzner".into(),
            host: "203.0.113.10".into(),
            port: 22,
            ssh_user: Some("deploy".into()),
            ssh_key_path: Some("~/.ssh/test_key".into()),
            customer_id: customer_id.map(Into::into),
            notes: None,
            favorite: false,
            facts: None,
        }
    }

    fn project(id: &str, customer_id: &str, server_id: Option<&str>) -> Project {
        Project {
            id: id.into(),
            name: id.into(),
            customer_id: customer_id.into(),
            server_id: server_id.map(Into::into),
            stack: "laravel".into(),
            domain: None,
            path: None,
            repo_url: None,
            notes: None,
            favorite: false,
            deploy_script: None,
        }
    }

    fn deploy(id: &str, project_id: &str, started_at: &str) -> Deploy {
        Deploy {
            id: id.into(),
            project_id: project_id.into(),
            server_name: "web".into(),
            started_at: started_at.into(),
            status: DeployStatus::Running,
            exit_code: None,
            duration_ms: None,
            output: String::new(),
        }
    }

    #[test]
    fn deploy_script_survives_project_save_and_backup() {
        let db = Db::open_in_memory().unwrap();
        db.save_customer(&customer("c1")).unwrap();
        db.save_project(&project("p1", "c1", None)).unwrap();
        db.set_deploy_script("p1", Some("git pull")).unwrap();
        // Speichern über das Formular (ohne Skript) darf es nicht löschen
        db.save_project(&project("p1", "c1", None)).unwrap();
        let snap = db.snapshot().unwrap();
        assert_eq!(snap.projects[0].deploy_script.as_deref(), Some("git pull"));
        db.replace_all(&snap).unwrap();
        assert_eq!(db.snapshot().unwrap().projects[0].deploy_script.as_deref(), Some("git pull"));
    }

    #[test]
    fn deploy_history_is_trimmed_and_removed_with_project() {
        let db = Db::open_in_memory().unwrap();
        db.save_customer(&customer("c1")).unwrap();
        db.save_project(&project("p1", "c1", None)).unwrap();
        for i in 0..25 {
            let id = format!("d{i:02}");
            db.insert_deploy(&deploy(&id, "p1", &format!("2026-10-26T10:{i:02}:00Z"))).unwrap();
            db.finish_deploy(&id, DeployStatus::Success, Some(0), 1000, "ok").unwrap();
        }
        db.insert_deploy(&deploy("d99", "p1", "2026-10-26T11:00:00Z")).unwrap();
        db.finish_deploy("d99", DeployStatus::Failed, Some(1), 1000, "").unwrap();
        let last = db.last_deploys().unwrap();
        assert_eq!(last.len(), 1);
        assert_eq!(last[0].status, DeployStatus::Failed);
        assert_eq!(last[0].started_at, "2026-10-26T11:00:00Z");

        let list = db.deploys("p1").unwrap();
        assert_eq!(list.len(), DEPLOY_HISTORY as usize);
        assert_eq!(list[0].id, "d99");
        assert_eq!(list[1].id, "d24");
        assert_eq!(list[1].status, DeployStatus::Success);
        assert_eq!(list[0].duration_ms, Some(1000));

        db.delete(Table::Project, "p1").unwrap();
        assert!(db.deploys("p1").unwrap().is_empty());
    }

    #[test]
    fn save_updates_existing_rows() {
        let db = Db::open_in_memory().unwrap();
        let mut c = customer("c1");
        db.save_customer(&c).unwrap();
        c.name = "Neu".into();
        db.save_customer(&c).unwrap();

        let snap = db.snapshot().unwrap();
        assert_eq!(snap.customers.len(), 1);
        assert_eq!(snap.customers[0].name, "Neu");
    }

    #[test]
    fn deleting_customer_removes_projects_and_unassigns_servers() {
        let db = Db::open_in_memory().unwrap();
        db.save_customer(&customer("c1")).unwrap();
        db.save_server(&server("s1", Some("c1"))).unwrap();
        db.save_project(&project("p1", "c1", Some("s1"))).unwrap();

        assert!(db.delete(Table::Customer, "c1").unwrap());

        assert!(!db.exists(Table::Project, "p1"));
        let snap = db.snapshot().unwrap();
        assert_eq!(snap.servers[0].customer_id, None);
    }

    #[test]
    fn deleting_server_keeps_project_without_server() {
        let db = Db::open_in_memory().unwrap();
        db.save_customer(&customer("c1")).unwrap();
        db.save_server(&server("s1", None)).unwrap();
        db.save_project(&project("p1", "c1", Some("s1"))).unwrap();

        db.delete(Table::Server, "s1").unwrap();

        let snap = db.snapshot().unwrap();
        assert_eq!(snap.projects[0].server_id, None);
    }

    #[test]
    fn saving_server_does_not_touch_facts() {
        let db = Db::open_in_memory().unwrap();
        db.save_server(&server("s1", None)).unwrap();
        db.conn()
            .execute(
                "UPDATE servers SET facts_json = '{\"node\":\"22\"}' WHERE id = 's1'",
                [],
            )
            .unwrap();

        db.save_server(&server("s1", None)).unwrap();

        let snap = db.snapshot().unwrap();
        assert_eq!(snap.servers[0].facts.as_ref().unwrap()["node"], "22");
    }

    #[test]
    fn saving_does_not_reset_favorite() {
        let db = Db::open_in_memory().unwrap();
        db.save_customer(&customer("c1")).unwrap();
        db.set_favorite(Table::Customer, "c1", true).unwrap();

        db.save_customer(&customer("c1")).unwrap();

        assert!(db.snapshot().unwrap().customers[0].favorite);
    }

    #[test]
    fn replace_all_restores_backup_including_facts_and_favorites() {
        let source = Db::open_in_memory().unwrap();
        source.save_customer(&customer("c1")).unwrap();
        source.save_server(&server("s1", Some("c1"))).unwrap();
        source
            .save_project(&project("p1", "c1", Some("s1")))
            .unwrap();
        source.set_favorite(Table::Project, "p1", true).unwrap();
        source
            .conn()
            .execute("UPDATE servers SET facts_json = '{\"node\":\"22\"}'", [])
            .unwrap();
        let backup = source.snapshot().unwrap();

        let target = Db::open_in_memory().unwrap();
        target.save_customer(&customer("old")).unwrap();
        target.replace_all(&backup).unwrap();

        let snap = target.snapshot().unwrap();
        assert_eq!(snap.customers.len(), 1);
        assert_eq!(snap.customers[0].id, "c1");
        assert!(snap.projects[0].favorite);
        assert_eq!(snap.servers[0].facts.as_ref().unwrap()["node"], "22");
    }

    #[test]
    fn replace_all_is_atomic() {
        let db = Db::open_in_memory().unwrap();
        db.save_customer(&customer("keep")).unwrap();
        // Projekt verweist auf einen Kunden, den es nicht gibt -> Fremdschlüssel schlägt fehl
        let broken = Snapshot {
            customers: vec![customer("c1")],
            servers: vec![],
            projects: vec![project("p1", "missing", None)],
        };

        assert!(db.replace_all(&broken).is_err());
        assert_eq!(db.snapshot().unwrap().customers[0].id, "keep");
    }
}
