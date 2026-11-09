//! Server-Check: führt `check.sh` per ssh aus und wertet die Ausgabe aus.
//!
//! Das Skript liest nur (Versionen, Auslastung) und verändert nichts auf dem Server.

use std::collections::BTreeSet;
use std::time::Duration;

use serde::Serialize;

use crate::models::Server;
use crate::ssh::{self, ConnectionResult};

const SCRIPT: &str = include_str!("check.sh");
/// Mehrere Tools werden nacheinander gestartet, daher großzügiger als beim Verbindungstest
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);

/// Mounts, die keine echten Datenplatten sind
const IGNORED_MOUNTS: &[&str] = &[
    "/boot",
    "/snap",
    "/run",
    "/dev",
    "/sys",
    "/proc",
    "/var/lib/docker",
    "/var/snap",
];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerFacts {
    pub checked_at: String,
    pub os: Os,
    pub uptime_seconds: u64,
    pub cpu: Cpu,
    pub memory: Memory,
    pub disks: Vec<Disk>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub php: Option<Php>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub npm: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wp_cli: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webserver: Option<NamedVersion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<NamedVersion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redis: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Os {
    pub name: String,
    pub version: String,
    pub kernel: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Cpu {
    pub cores: u32,
    pub load: [f64; 3],
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub total_mb: u64,
    pub used_mb: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub mount: String,
    pub total_gb: f64,
    pub used_gb: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Php {
    pub version: String,
    pub installed: Vec<String>,
    pub extensions: Vec<String>,
    pub memory_limit: String,
    pub upload_max_filesize: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct NamedVersion {
    pub name: String,
    pub version: String,
}

pub enum CheckError {
    /// Anmeldung oder Verbindung klappt nicht
    Connection(ConnectionResult),
    /// Verbunden, aber die Ausgabe ist unbrauchbar
    Output(String),
}

pub async fn check_server(server: &Server, checked_at: String) -> Result<ServerFacts, CheckError> {
    let command = format!("sh -c {}", ssh::shell_quote(SCRIPT));
    let stdout = ssh::run(server, &command, CHECK_TIMEOUT)
        .await
        .map_err(CheckError::Connection)?;
    parse(&stdout, checked_at).map_err(CheckError::Output)
}

/// Erste Versionsnummer im Text, z. B. "v22.11.0" → "22.11.0"
fn find_version(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let starts_here = bytes[i].is_ascii_digit()
            && (i == 0 || !bytes[i - 1].is_ascii_digit() && bytes[i - 1] != b'.');
        if starts_here {
            let end = (i..bytes.len())
                .find(|&j| !(bytes[j].is_ascii_digit() || bytes[j] == b'.'))
                .unwrap_or(bytes.len());
            let candidate = text[i..end].trim_end_matches('.');
            if candidate.contains('.') {
                return Some(candidate.to_string());
            }
            i = end;
        } else {
            i += 1;
        }
    }
    None
}

/// Version hinter einer Markierung (z. B. "nginx/"), sonst die erste im Text
fn version_after(text: &str, marker: &str) -> Option<String> {
    text.find(marker)
        .and_then(|pos| find_version(&text[pos + marker.len()..]))
        .or_else(|| find_version(text))
}

/// Auf "8.3" vereinheitlichen: aus "8.3", "8.3.6" oder Remi-Namen wie "php83"; Unbrauchbares fällt weg
fn php_minor(raw: &str) -> Option<String> {
    let raw = raw.trim().trim_start_matches("php");
    if let Some(version) = find_version(raw) {
        let mut parts = version.split('.');
        return Some(format!("{}.{}", parts.next()?, parts.next()?));
    }
    // "83" → "8.3"
    let digits = raw.len() >= 2 && raw.len() <= 3 && raw.chars().all(|c| c.is_ascii_digit());
    digits.then(|| format!("{}.{}", &raw[..1], &raw[1..]))
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

struct Lines<'a>(Vec<(&'a str, &'a str)>);

impl<'a> Lines<'a> {
    fn get(&self, key: &str) -> Option<&'a str> {
        self.0
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.trim())
            .filter(|v| !v.is_empty())
    }

    fn all<'k>(&'k self, key: &'k str) -> impl Iterator<Item = &'a str> + 'k {
        self.0
            .iter()
            .filter(move |(k, _)| *k == key)
            .map(|(_, v)| v.trim())
    }

    fn number<T: std::str::FromStr>(&self, key: &str) -> Option<T> {
        self.get(key).and_then(|v| v.parse().ok())
    }
}

pub fn parse(stdout: &str, checked_at: String) -> Result<ServerFacts, String> {
    let lines = Lines(stdout.lines().filter_map(|l| l.split_once('=')).collect());
    if lines.get("hostmoor-check").is_none() {
        return Err(tr!(
            "The server did not run the check script. Does it use a standard shell (sh)?",
            "Der Server hat das Prüfskript nicht ausgeführt. Läuft dort eine Standard-Shell (sh)?"
        ));
    }
    if lines.get("hostmoor-check-end").is_none() {
        return Err(tr!(
            "The check was aborted on the server.",
            "Die Prüfung wurde auf dem Server vorzeitig abgebrochen."
        ));
    }

    let os = Os {
        name: lines
            .get("os_name")
            .map(String::from)
            .unwrap_or_else(|| tr!("Unknown", "Unbekannt")),
        version: lines.get("os_version").unwrap_or_default().to_string(),
        kernel: lines.get("kernel").unwrap_or_default().to_string(),
    };

    let uptime_seconds = lines.number::<f64>("uptime").unwrap_or(0.0) as u64;

    let mut load = [0.0; 3];
    if let Some(raw) = lines.get("load") {
        for (slot, value) in load.iter_mut().zip(raw.split_whitespace()) {
            *slot = value.parse().unwrap_or(0.0);
        }
    }
    let cpu = Cpu {
        cores: lines.number("cores").unwrap_or(0),
        load,
    };

    let total_kb: u64 = lines.number("mem_total_kb").unwrap_or(0);
    let available_kb: u64 = lines.number("mem_available_kb").unwrap_or(total_kb);
    let memory = Memory {
        total_mb: total_kb / 1024,
        used_mb: total_kb.saturating_sub(available_kb) / 1024,
    };

    let mut disks: Vec<Disk> = lines
        .all("disk")
        .filter_map(|raw| {
            let mut parts = raw.split_whitespace();
            let mount = parts.next()?;
            let total_kb: f64 = parts.next()?.parse().ok()?;
            let used_kb: f64 = parts.next()?.parse().ok()?;
            let ignored = IGNORED_MOUNTS
                .iter()
                .any(|m| mount == *m || mount.starts_with(&format!("{m}/")));
            (!ignored && total_kb > 0.0).then(|| Disk {
                mount: mount.to_string(),
                total_gb: round1(total_kb / 1024.0 / 1024.0),
                used_gb: round1(used_kb / 1024.0 / 1024.0),
            })
        })
        .collect();
    disks.dedup_by(|a, b| a.mount == b.mount);

    let php = lines.get("php_version").map(|version| {
        let mut seen = BTreeSet::new();
        let mut extensions: Vec<String> = lines
            .get("php_extensions")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|e| !e.is_empty() && seen.insert(e.to_lowercase()))
            .map(String::from)
            .collect();
        extensions.sort_by_key(|e| e.to_lowercase());
        let mut installed: BTreeSet<String> =
            lines.all("php_installed").filter_map(php_minor).collect();
        installed.extend(php_minor(version));
        Php {
            version: version.to_string(),
            installed: installed.into_iter().collect(),
            extensions,
            memory_limit: lines
                .get("php_memory_limit")
                .unwrap_or_default()
                .to_string(),
            upload_max_filesize: lines
                .get("php_upload_max_filesize")
                .unwrap_or_default()
                .to_string(),
        }
    });

    let tool = |key: &str, marker: &str| lines.get(key).and_then(|v| version_after(v, marker));
    let named = |name: &str, version: Option<String>| {
        version.map(|version| NamedVersion {
            name: name.to_string(),
            version,
        })
    };

    let webserver = named("nginx", tool("nginx", "nginx/"))
        .or_else(|| named("Apache", tool("apache", "Apache/")))
        .or_else(|| named("Caddy", tool("caddy", "v")))
        .or_else(|| named("LiteSpeed", tool("litespeed", "LiteSpeed/")));

    let mysql_name = |raw: &str| {
        if raw.to_lowercase().contains("mariadb") {
            "MariaDB"
        } else {
            "MySQL"
        }
    };
    let database = named("MariaDB", tool("mariadb", "Ver "))
        .or_else(|| {
            lines
                .get("mysql")
                .and_then(|raw| named(mysql_name(raw), version_after(raw, "Ver ")))
        })
        .or_else(|| {
            // Nur der Client ist installiert, die Datenbank läuft vermutlich woanders
            lines.get("mysql_client").and_then(|raw| {
                let version =
                    version_after(raw, "Distrib ").or_else(|| version_after(raw, "from "));
                named(
                    &format!("{}-Client", mysql_name(raw)),
                    version.or_else(|| version_after(raw, "Ver ")),
                )
            })
        })
        .or_else(|| named("PostgreSQL", tool("postgres", "PostgreSQL)")));

    let redis = tool("redis", "v=")
        .or_else(|| tool("redis_client", "redis-cli").map(|v| format!("{v} (nur Client)")));

    Ok(ServerFacts {
        checked_at,
        os,
        uptime_seconds,
        cpu,
        memory,
        disks,
        php,
        composer: tool("composer", "Composer version"),
        node: tool("node", "v"),
        npm: tool("npm", ""),
        git: tool("git", "git version"),
        wp_cli: tool("wpcli", "WP-CLI"),
        webserver,
        database,
        redis,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
hostmoor-check=1
os_name=Ubuntu
os_version=24.04
os_pretty=Ubuntu 24.04.1 LTS
kernel=6.8.0-45-generic
uptime=1234567.89
load=0.42 0.31 0.25
cores=4
mem_total_kb=8048576
mem_available_kb=5048576
disk=/ 157286400 47185920
disk=/boot/efi 523248 6220
disk=/mnt/data 104857600 10485760
php_version=8.3.6
php_memory_limit=-1
php_upload_max_filesize=2M
php_extensions=Core,date,PDO,pdo_mysql,Zend OPcache,redis,Zend OPcache,
php_installed=8.3
php_installed=8.2
php_installed=php81
php_installed=
php_installed=No input file specified.
composer=PHP Deprecated:  something in /usr/share/php on line 12 Composer version 2.7.1 2024-02-09 15:26:28
node=v22.11.0
npm=10.9.0
git=git version 2.43.0
wpcli=WP-CLI 2.11.0
nginx=nginx version: nginx/1.24.0 (Ubuntu)
mysql=/usr/sbin/mysqld  Ver 8.0.39-0ubuntu0.24.04.2 for Linux on x86_64 ((Ubuntu))
redis=Redis server v=7.0.15 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64 build=62c7a5d52c72f4cd
hostmoor-check-end=1
";

    #[test]
    fn parses_typical_ubuntu_server() {
        let facts = parse(SAMPLE, "2026-10-26T10:00:00Z".into()).unwrap();
        assert_eq!(facts.os.name, "Ubuntu");
        assert_eq!(facts.os.version, "24.04");
        assert_eq!(facts.uptime_seconds, 1_234_567);
        assert_eq!(facts.cpu.cores, 4);
        assert_eq!(facts.cpu.load, [0.42, 0.31, 0.25]);
        assert_eq!(facts.memory.total_mb, 7859);
        assert_eq!(facts.memory.used_mb, 2929);
        let mounts: Vec<_> = facts.disks.iter().map(|d| d.mount.as_str()).collect();
        assert_eq!(mounts, ["/", "/mnt/data"]);
        assert_eq!(facts.disks[0].total_gb, 150.0);
        assert_eq!(facts.disks[0].used_gb, 45.0);

        let php = facts.php.unwrap();
        assert_eq!(php.version, "8.3.6");
        assert_eq!(php.installed, ["8.1", "8.2", "8.3"]);
        assert_eq!(
            php.extensions,
            ["Core", "date", "PDO", "pdo_mysql", "redis", "Zend OPcache"]
        );
        assert_eq!(php.memory_limit, "-1");

        assert_eq!(facts.composer.as_deref(), Some("2.7.1"));
        assert_eq!(facts.node.as_deref(), Some("22.11.0"));
        assert_eq!(facts.npm.as_deref(), Some("10.9.0"));
        assert_eq!(facts.git.as_deref(), Some("2.43.0"));
        assert_eq!(facts.wp_cli.as_deref(), Some("2.11.0"));
        assert_eq!(
            facts.webserver,
            Some(NamedVersion {
                name: "nginx".into(),
                version: "1.24.0".into()
            })
        );
        assert_eq!(
            facts.database,
            Some(NamedVersion {
                name: "MySQL".into(),
                version: "8.0.39".into()
            })
        );
        assert_eq!(facts.redis.as_deref(), Some("7.0.15"));
    }

    #[test]
    fn detects_mariadb_apache_and_missing_tools() {
        let out = "hostmoor-check=1\nos_name=Debian GNU/Linux\nos_version=12\n\
            apache=[core:warn] AH00111: Config variable ${APACHE_RUN_DIR} is not defined Server version: Apache/2.4.62 (Debian) Server built: 2024\n\
            mysql=mysqld  Ver 10.11.6-MariaDB-0+deb12u1 for debian-linux-gnu on x86_64\n\
            hostmoor-check-end=1\n";
        let facts = parse(out, String::new()).unwrap();
        assert_eq!(facts.webserver.unwrap().version, "2.4.62");
        assert_eq!(
            facts.database,
            Some(NamedVersion {
                name: "MariaDB".into(),
                version: "10.11.6".into()
            })
        );
        assert!(facts.php.is_none());
        // Ohne versionierte Ordner zählt zumindest die CLI-Version
        let only_cli = parse(
            "hostmoor-check=1\nphp_version=8.4.27\nhostmoor-check-end=1\n",
            String::new(),
        )
        .unwrap();
        assert_eq!(only_cli.php.unwrap().installed, ["8.4"]);
        assert!(facts.node.is_none());
        assert!(facts.disks.is_empty());
    }

    #[test]
    fn mysql_client_only() {
        let out = "hostmoor-check=1\nmysql_client=mysql  Ver 15.1 Distrib 10.6.16-MariaDB, for debian-linux-gnu\nhostmoor-check-end=1\n";
        let db = parse(out, String::new()).unwrap().database.unwrap();
        assert_eq!(db.name, "MariaDB-Client");
        assert_eq!(db.version, "10.6.16");
    }

    #[test]
    fn rejects_incomplete_output() {
        assert!(parse("Welcome to Ubuntu", String::new()).is_err());
        assert!(parse("hostmoor-check=1\nos_name=Ubuntu\n", String::new()).is_err());
    }

    #[test]
    fn finds_versions() {
        assert_eq!(find_version("v22.11.0").as_deref(), Some("22.11.0"));
        assert_eq!(
            find_version("on line 12 version 2.7.1.").as_deref(),
            Some("2.7.1")
        );
        assert_eq!(find_version("nothing here"), None);
    }

    #[test]
    fn script_has_no_single_quotes() {
        // Wird in einfachen Anführungszeichen an sh -c übergeben
        assert!(!SCRIPT.contains('\''));
    }
}
