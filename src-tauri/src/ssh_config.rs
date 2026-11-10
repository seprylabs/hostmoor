//! Reads `~/.ssh/config` so its hosts can be imported as servers.
//! Read-only: the files are never written, and key files are not opened.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// ssh stops at the same depth
const MAX_INCLUDE_DEPTH: usize = 16;

/// A concrete `Host` entry with the settings ssh would use for it
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigHost {
    /// The name after `Host`
    pub alias: String,
    /// `HostName`, or the alias itself
    pub host: String,
    pub port: u16,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

enum Condition {
    /// Lines before the first `Host` apply to every host
    All,
    Host(Vec<String>),
    /// `Match` blocks depend on runtime state; they are skipped
    Never,
}

struct Block {
    condition: Condition,
    options: Vec<(String, String)>,
}

/// Hosts from `~/.ssh/config`; empty when there is no config
pub fn read_default() -> Vec<ConfigHost> {
    match std::env::home_dir() {
        Some(home) => {
            let dir = home.join(".ssh");
            read(&dir.join("config"), &dir)
        }
        None => Vec::new(),
    }
}

/// Hosts from `file`; relative `Include` paths start in `ssh_dir`
pub fn read(file: &Path, ssh_dir: &Path) -> Vec<ConfigHost> {
    let mut blocks = vec![Block {
        condition: Condition::All,
        options: Vec::new(),
    }];
    parse_file(file, ssh_dir, 0, &mut blocks);

    let mut aliases: Vec<String> = Vec::new();
    for block in &blocks {
        if let Condition::Host(patterns) = &block.condition {
            for p in patterns {
                let concrete = !p.contains(['*', '?']) && !p.starts_with('!');
                if concrete && !aliases.iter().any(|a| a.eq_ignore_ascii_case(p)) {
                    aliases.push(p.clone());
                }
            }
        }
    }
    aliases.iter().map(|a| resolve(a, &blocks)).collect()
}

fn parse_file(file: &Path, ssh_dir: &Path, depth: usize, blocks: &mut Vec<Block>) {
    let Ok(text) = std::fs::read_to_string(file) else {
        return;
    };
    for line in text.lines() {
        let Some((key, value)) = split_line(line) else {
            continue;
        };
        match key.as_str() {
            "host" => blocks.push(Block {
                condition: Condition::Host(words(&value)),
                options: Vec::new(),
            }),
            "match" => blocks.push(Block {
                condition: Condition::Never,
                options: Vec::new(),
            }),
            "include" if depth < MAX_INCLUDE_DEPTH => {
                for pattern in words(&value) {
                    for path in expand_include(&pattern, ssh_dir) {
                        parse_file(&path, ssh_dir, depth + 1, blocks);
                    }
                }
            }
            _ => {
                if let Some(block) = blocks.last_mut() {
                    block.options.push((key, value));
                }
            }
        }
    }
}

/// `Keyword value` or `Keyword=value`; keywords are case-insensitive
fn split_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let end = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let key = line[..end].to_ascii_lowercase();
    let rest = line[end..].trim_start();
    let rest = rest.strip_prefix('=').unwrap_or(rest).trim();
    if rest.is_empty() {
        return None;
    }
    Some((key, rest.to_string()))
}

/// Splits on whitespace and keeps "quoted parts" together
fn words(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in value.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Include paths may use `~` and wildcards in the file name, e.g. `config.d/*`
fn expand_include(pattern: &str, ssh_dir: &Path) -> Vec<PathBuf> {
    let path = if pattern.starts_with('~') {
        crate::ssh::expand_home(pattern)
    } else {
        ssh_dir.join(pattern)
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !name.contains(['*', '?']) {
        return vec![path];
    }
    let Some(parent) = path.parent() else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = std::fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| wildcard(&name, &e.file_name().to_string_lossy()))
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    found.sort();
    found
}

/// `*` and `?` as in ssh patterns
fn wildcard(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti, mut star, mut mark) = (0, 0, None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

/// A `Host` line matches when one pattern matches and no `!pattern` does
fn host_matches(patterns: &[String], alias: &str) -> bool {
    let alias = alias.to_ascii_lowercase();
    let mut matched = false;
    for p in patterns {
        let p = p.to_ascii_lowercase();
        match p.strip_prefix('!') {
            Some(neg) if wildcard(neg, &alias) => return false,
            Some(_) => {}
            None => matched |= wildcard(&p, &alias),
        }
    }
    matched
}

/// Like ssh: the first value found for each option wins
fn resolve(alias: &str, blocks: &[Block]) -> ConfigHost {
    let get = |key: &str| {
        blocks
            .iter()
            .filter(|b| match &b.condition {
                Condition::All => true,
                Condition::Host(patterns) => host_matches(patterns, alias),
                Condition::Never => false,
            })
            .flat_map(|b| &b.options)
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.trim_matches('"').to_string())
    };
    let host = get("hostname")
        .map(|h| h.replace("%h", alias).replace("%%", "%"))
        .unwrap_or_else(|| alias.to_string());
    let user = get("user");
    let port = get("port").and_then(|p| p.parse().ok()).unwrap_or(22);
    let identity_file = get("identityfile")
        .filter(|f| !f.eq_ignore_ascii_case("none"))
        .map(|f| {
            let f = f.replace("%d/", "~/").replace("%h", &host);
            match &user {
                Some(u) => f.replace("%r", u),
                None => f,
            }
        });
    let proxy_jump = get("proxyjump").filter(|j| !j.eq_ignore_ascii_case("none"));
    ConfigHost {
        alias: alias.to_string(),
        host,
        port,
        user,
        identity_file,
        proxy_jump,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("hostmoor-sshcfg-{stamp}"));
        std::fs::create_dir_all(dir.join("config.d")).unwrap();
        dir
    }

    #[test]
    fn resolves_hosts_like_ssh() {
        let dir = dir();
        std::fs::write(
            dir.join("config"),
            "# global defaults\n\
             ServerAliveInterval 30\n\
             Include config.d/*\n\
             \n\
             Host shop shop-staging\n\
             \tHostName 203.0.113.10\n\
             \tUser deploy\n\
             \tPort=2222\n\
             \tIdentityFile %d/.ssh/shop_ed25519\n\
             \tProxyJump bastion\n\
             \n\
             Host shop-staging\n\
             \tHostName 203.0.113.11\n\
             \n\
             Host bastion\n\
             \tHostName bastion.example.com\n\
             \tProxyJump none\n\
             \n\
             Match host *.internal\n\
             \tUser nobody\n\
             \n\
             Host *.example.com !legacy.example.com\n\
             \tUser ops\n\
             \n\
             Host * \n\
             \tUser fallback\n\
             \tPort 22\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("config.d/clients"),
            "Host \"Client Web\"\n  HostName web.client.de\n  IdentityFile \"~/.ssh/client key\"\n",
        )
        .unwrap();

        let hosts = read(&dir.join("config"), &dir);
        let aliases: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
        // Wildcard and negated patterns are not hosts of their own
        assert_eq!(aliases, ["Client Web", "shop", "shop-staging", "bastion"]);

        let get = |a: &str| hosts.iter().find(|h| h.alias == a).unwrap().clone();
        assert_eq!(
            get("shop"),
            ConfigHost {
                alias: "shop".into(),
                host: "203.0.113.10".into(),
                port: 2222,
                user: Some("deploy".into()),
                identity_file: Some("~/.ssh/shop_ed25519".into()),
                proxy_jump: Some("bastion".into()),
            }
        );
        // The first HostName wins, as in ssh, even though a later block sets another one
        assert_eq!(get("shop-staging").host, "203.0.113.10");
        // Host *.example.com does not match the alias "bastion", only Host * does; ProxyJump none clears it
        let bastion = get("bastion");
        assert_eq!(bastion.user.as_deref(), Some("fallback"));
        assert_eq!(bastion.proxy_jump, None);
        let client = get("Client Web");
        assert_eq!(client.host, "web.client.de");
        assert_eq!(client.identity_file.as_deref(), Some("~/.ssh/client key"));
        assert_eq!(client.port, 22);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_config_and_include_loops_are_harmless() {
        let dir = dir();
        assert!(read(&dir.join("config"), &dir).is_empty());
        std::fs::write(dir.join("config"), "Include config\nHost a\n").unwrap();
        let hosts = read(&dir.join("config"), &dir);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "a");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn wildcards() {
        assert!(wildcard("*", "anything"));
        assert!(wildcard("web-?", "web-1"));
        assert!(!wildcard("web-?", "web-12"));
        assert!(wildcard("*.example.com", "a.b.example.com"));
        assert!(!wildcard("*.example.com", "example.com"));
        let patterns = vec!["*.example.com".into(), "!legacy.example.com".into()];
        assert!(host_matches(&patterns, "WWW.example.com"));
        assert!(!host_matches(&patterns, "legacy.example.com"));
    }
}
