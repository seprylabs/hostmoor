//! Watches the TLS certificate and reachability of every project domain while the app runs.
//!
//! Every 6 hours (and right away after a project is saved) each domain gets a TLS
//! handshake and a plain HTTPS request. The certificate is checked with the
//! operating system's verifier, like a browser would. The result goes to the UI as
//! the `site-update` event; a system notification appears when a certificate gets
//! within 14 days of expiry, within 3 days, or becomes invalid.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, SignatureScheme};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::net::TcpStream;
use tokio::sync::Notify;
use x509_parser::prelude::{FromDer, X509Certificate};

use crate::db::Db;

const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const TIMEOUT: Duration = Duration::from_secs(15);
const WARN_DAYS: i64 = 14;
const CRITICAL_DAYS: i64 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Ok,
    /// Certificate expires within 14 days
    Warn,
    /// Expires within 3 days, expired or invalid
    Critical,
    /// Could not connect, e.g. offline or wrong domain
    Unknown,
}

impl Level {
    fn rank(self) -> u8 {
        match self {
            Self::Ok | Self::Unknown => 0,
            Self::Warn => 1,
            Self::Critical => 2,
        }
    }
}

/// Why the system does not trust the certificate
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CertProblem {
    Expired,
    NotYetValid,
    WrongName,
    Revoked,
    Untrusted,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Certificate {
    /// Unix seconds
    pub expires_at: i64,
    pub issuer: Option<String>,
    pub problem: Option<CertProblem>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Http {
    pub status: u16,
    pub millis: u64,
}

/// Result for one project
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteStatus {
    pub project_id: String,
    pub domain: String,
    /// Unix milliseconds
    pub checked_at: u64,
    pub level: Level,
    pub certificate: Option<Certificate>,
    pub http: Option<Http>,
    /// Connection or TLS error when no certificate could be read
    pub error: Option<String>,
}

/// Shared state: latest results for the UI and a signal to check again right away
#[derive(Default)]
pub struct SiteWatch {
    overview: Mutex<Vec<SiteStatus>>,
    /// Last level that caused a notification, per project
    notified: Mutex<HashMap<String, Level>>,
    wake: Notify,
}

impl SiteWatch {
    pub fn overview(&self) -> Vec<SiteStatus> {
        self.overview.lock().expect("site mutex poisoned").clone()
    }

    /// Check again right away, e.g. after a domain changed
    pub fn refresh(&self) {
        self.wake.notify_one();
    }
}

/// Host and port from what the user typed: `example.com`, `https://example.com/shop`, `example.com:8443`
pub fn parse_domain(input: &str) -> Option<(String, u16)> {
    let s = input.trim();
    let s = s.split_once("://").map_or(s, |(_, rest)| rest);
    let s = s.split(['/', '?', '#']).next().unwrap_or_default();
    let (host, port) = match s.rsplit_once(':') {
        Some((host, port)) => (host, port.parse().ok()?),
        None => (s, 443),
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.contains(char::is_whitespace) {
        return None;
    }
    Some((host, port))
}

fn days_left(expires_at: i64, now: i64) -> i64 {
    (expires_at - now).div_euclid(86_400)
}

fn level(certificate: Option<&Certificate>, now: i64) -> Level {
    let Some(cert) = certificate else {
        return Level::Unknown;
    };
    if cert.problem.is_some() {
        return Level::Critical;
    }
    match days_left(cert.expires_at, now) {
        d if d < CRITICAL_DAYS => Level::Critical,
        d if d < WARN_DAYS => Level::Warn,
        _ => Level::Ok,
    }
}

/// Notify only when the state gets worse than what the user was last told
fn should_notify(previous: Option<Level>, now: Level) -> bool {
    now.rank() > previous.map_or(0, Level::rank)
}

/// Records the verdict of the system verifier instead of aborting the handshake,
/// so expired or mismatched certificates can still be read and reported.
#[derive(Debug)]
struct Recording {
    inner: Arc<dyn ServerCertVerifier>,
    verdict: Mutex<Option<rustls::Error>>,
}

impl ServerCertVerifier for Recording {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let result = self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        );
        *self.verdict.lock().expect("verdict mutex poisoned") = result.err();
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

fn problem(verdict: Option<&rustls::Error>) -> Option<CertProblem> {
    use CertificateError::*;
    let rustls::Error::InvalidCertificate(e) = verdict? else {
        return Some(CertProblem::Untrusted);
    };
    Some(match e {
        Expired | ExpiredContext { .. } => CertProblem::Expired,
        NotValidYet | NotValidYetContext { .. } => CertProblem::NotYetValid,
        NotValidForName | NotValidForNameContext { .. } => CertProblem::WrongName,
        Revoked => CertProblem::Revoked,
        _ => CertProblem::Untrusted,
    })
}

fn tls_error(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::TimedOut => tr!(
            "Connection timed out",
            "Zeitüberschreitung bei der Verbindung"
        ),
        _ => e.to_string(),
    }
}

/// TLS handshake that returns the server certificate and the system's verdict on it
async fn certificate(host: &str, port: u16, now: i64) -> Result<Certificate, String> {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let inner =
        rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|e| e.to_string())?;
    let verifier = Arc::new(Recording {
        inner: Arc::new(inner),
        verdict: Mutex::new(None),
    });
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    let name = ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;

    let connect = async {
        let tcp = TcpStream::connect((host, port)).await?;
        tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(name, tcp)
            .await
    };
    let stream = tokio::time::timeout(TIMEOUT, connect)
        .await
        .map_err(|_| {
            tr!(
                "Connection timed out",
                "Zeitüberschreitung bei der Verbindung"
            )
        })?
        .map_err(|e| tls_error(&e))?;

    let der = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|chain| chain.first())
        .ok_or_else(|| {
            tr!(
                "The server sent no certificate",
                "Der Server hat kein Zertifikat gesendet"
            )
        })?;
    let (_, cert) = X509Certificate::from_der(der).map_err(|e| e.to_string())?;
    let expires_at = cert.validity().not_after.timestamp();
    let issuer = cert
        .issuer()
        .iter_organization()
        .chain(cert.issuer().iter_common_name())
        .find_map(|a| a.as_str().ok())
        .map(str::to_string);

    let verdict = verifier
        .verdict
        .lock()
        .expect("verdict mutex poisoned")
        .take();
    // Our own clock decides "expired", whatever error the platform verifier reports first
    let problem = if expires_at < now {
        Some(CertProblem::Expired)
    } else {
        problem(verdict.as_ref())
    };
    Ok(Certificate {
        expires_at,
        issuer,
        problem,
    })
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Hostmoor/", env!("CARGO_PKG_VERSION")))
        .timeout(TIMEOUT)
        // The certificate is judged separately; here we only want the status code
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())
}

async fn http(client: &reqwest::Client, host: &str, port: u16) -> Option<Http> {
    let url = if port == 443 {
        format!("https://{host}/")
    } else {
        format!("https://{host}:{port}/")
    };
    let started = Instant::now();
    let response = client.get(url).send().await.ok()?;
    Some(Http {
        status: response.status().as_u16(),
        millis: started.elapsed().as_millis() as u64,
    })
}

fn now() -> Duration {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
}

async fn check(client: &reqwest::Client, project_id: &str, domain: &str) -> SiteStatus {
    let now = now();
    let mut status = SiteStatus {
        project_id: project_id.to_string(),
        domain: domain.to_string(),
        checked_at: now.as_millis() as u64,
        level: Level::Unknown,
        certificate: None,
        http: None,
        error: None,
    };
    let Some((host, port)) = parse_domain(domain) else {
        status.error = Some(tr!("Not a valid domain", "Keine gültige Domain"));
        return status;
    };
    match certificate(&host, port, now.as_secs() as i64).await {
        Ok(cert) => status.certificate = Some(cert),
        Err(e) => status.error = Some(e),
    }
    status.http = http(client, &host, port).await;
    status.level = level(status.certificate.as_ref(), now.as_secs() as i64);
    status
}

fn notify(app: &AppHandle, project: &str, status: &SiteStatus) {
    let Some(cert) = &status.certificate else {
        return;
    };
    let days = days_left(cert.expires_at, now().as_secs() as i64);
    let title = match cert.problem {
        Some(CertProblem::Expired) => tr!(
            "✖ Certificate expired: {project}",
            "✖ Zertifikat abgelaufen: {project}"
        ),
        Some(_) => tr!(
            "✖ Certificate invalid: {project}",
            "✖ Zertifikat ungültig: {project}"
        ),
        None => tr!(
            "⚠ Certificate expires in {days} days: {project}",
            "⚠ Zertifikat läuft in {days} Tagen ab: {project}"
        ),
    };
    if let Err(e) = app
        .notification()
        .builder()
        .title(title)
        .body(&status.domain)
        .show()
    {
        eprintln!("Mitteilung konnte nicht angezeigt werden: {e}");
    }
}

/// Stores a result, notifies if needed and sends the new overview to the UI
fn record(app: &AppHandle, name: &str, status: SiteStatus) {
    let watch = app.state::<SiteWatch>();
    // Offline or unreachable: keep what the user was told, so coming back online does not notify again
    if status.level != Level::Unknown {
        let mut notified = watch.notified.lock().expect("site mutex poisoned");
        let previous = notified.get(&status.project_id).copied();
        if should_notify(previous, status.level) {
            notify(app, name, &status);
        }
        notified.insert(status.project_id.clone(), status.level);
    }
    let overview = {
        let mut current = watch.overview.lock().expect("site mutex poisoned");
        current.retain(|s| s.project_id != status.project_id);
        current.push(status);
        current.clone()
    };
    let _ = app.emit("site-update", &overview);
}

/// Checks one project now, for the "Check now" button
pub async fn check_project(app: &AppHandle, project_id: &str) -> Result<SiteStatus, String> {
    let project = app
        .state::<Db>()
        .snapshot()
        .map_err(|e| e.to_string())?
        .projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| tr!("Project not found", "Projekt nicht gefunden"))?;
    let domain = project
        .domain
        .filter(|d| !d.trim().is_empty())
        .ok_or_else(|| tr!("The project has no domain", "Das Projekt hat keine Domain"))?;
    let status = check(&http_client()?, project_id, &domain).await;
    record(app, &project.name, status.clone());
    Ok(status)
}

async fn cycle(app: &AppHandle, client: &reqwest::Client) {
    let Ok(snapshot) = app.state::<Db>().snapshot() else {
        return;
    };
    let projects: Vec<_> = snapshot
        .projects
        .into_iter()
        .filter_map(|p| {
            let domain = p.domain.filter(|d| !d.trim().is_empty())?;
            Some((p.id, p.name, domain))
        })
        .collect();

    // Drop results of deleted projects or removed domains
    {
        let watch = app.state::<SiteWatch>();
        let mut current = watch.overview.lock().expect("site mutex poisoned");
        let before = current.len();
        current.retain(|s| {
            projects
                .iter()
                .any(|(id, _, d)| *id == s.project_id && *d == s.domain)
        });
        if current.len() != before {
            let _ = app.emit("site-update", &*current);
        }
    }

    for (id, name, domain) in &projects {
        let status = check(client, id, domain).await;
        record(app, name, status);
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(client) = http_client() else { return };
        loop {
            cycle(&app, &client).await;
            let watch = app.state::<SiteWatch>();
            tokio::select! {
                _ = tokio::time::sleep(INTERVAL) => {}
                _ = watch.wake.notified() => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;
    const DAY: i64 = 86_400;

    fn cert(expires_in: i64, problem: Option<CertProblem>) -> Certificate {
        Certificate {
            expires_at: NOW + expires_in,
            issuer: None,
            problem,
        }
    }

    #[test]
    fn parses_domains_as_users_type_them() {
        let d = |s| parse_domain(s);
        assert_eq!(d("example.com"), Some(("example.com".into(), 443)));
        assert_eq!(
            d(" https://Shop.Example.com/de/?x=1 "),
            Some(("shop.example.com".into(), 443))
        );
        assert_eq!(d("example.com:8443"), Some(("example.com".into(), 8443)));
        assert_eq!(d("http://example.com./"), Some(("example.com".into(), 443)));
        assert_eq!(d(""), None);
        assert_eq!(d("example.com:abc"), None);
        assert_eq!(d("my shop.de"), None);
    }

    #[test]
    fn level_follows_days_until_expiry() {
        assert_eq!(level(Some(&cert(30 * DAY, None)), NOW), Level::Ok);
        assert_eq!(level(Some(&cert(14 * DAY, None)), NOW), Level::Ok);
        assert_eq!(level(Some(&cert(14 * DAY - 1, None)), NOW), Level::Warn);
        assert_eq!(level(Some(&cert(3 * DAY, None)), NOW), Level::Warn);
        assert_eq!(level(Some(&cert(3 * DAY - 1, None)), NOW), Level::Critical);
        assert_eq!(level(None, NOW), Level::Unknown);
    }

    #[test]
    fn invalid_certificate_is_critical_even_with_time_left() {
        let wrong_name = cert(300 * DAY, Some(CertProblem::WrongName));
        assert_eq!(level(Some(&wrong_name), NOW), Level::Critical);
    }

    #[test]
    fn days_left_rounds_down_and_goes_negative() {
        assert_eq!(days_left(NOW + DAY - 1, NOW), 0);
        assert_eq!(days_left(NOW - 1, NOW), -1);
    }

    #[test]
    fn notifies_only_when_things_get_worse() {
        use Level::*;
        // First check of an expiring certificate
        assert!(should_notify(None, Warn));
        assert!(should_notify(None, Critical));
        assert!(!should_notify(None, Ok));
        // Same level again, e.g. the next check 6 hours later
        assert!(!should_notify(Some(Warn), Warn));
        assert!(should_notify(Some(Warn), Critical));
        assert!(!should_notify(Some(Critical), Warn));
        // Renewed, then expiring again months later
        assert!(should_notify(Some(Ok), Warn));
    }

    #[test]
    fn maps_verifier_errors() {
        let invalid = |e| rustls::Error::InvalidCertificate(e);
        assert_eq!(problem(None), None);
        assert_eq!(
            problem(Some(&invalid(CertificateError::Expired))),
            Some(CertProblem::Expired)
        );
        assert_eq!(
            problem(Some(&invalid(CertificateError::NotValidForName))),
            Some(CertProblem::WrongName)
        );
        assert_eq!(
            problem(Some(&invalid(CertificateError::UnknownIssuer))),
            Some(CertProblem::Untrusted)
        );
        assert_eq!(
            problem(Some(&rustls::Error::General("x".into()))),
            Some(CertProblem::Untrusted)
        );
    }
}
