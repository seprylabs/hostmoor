//! Terminal-Apps, in denen die SSH-Sitzung geöffnet werden kann.
//!
//! macOS kennt kein systemweites Standard-Terminal. „macOS-Standard“ öffnet die
//! .command-Datei mit der App, die im Finder dafür eingestellt ist (meist Terminal.app);
//! alle anderen Einträge starten gezielt eine bestimmte App.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// Wie die App das Startskript ausführt
#[derive(Clone, Copy)]
enum Launch {
    /// Die App öffnet die .command-Datei selbst (wie ein Doppelklick im Finder)
    OpenFile,
    /// Neue Instanz mit diesen Argumenten vor dem Skriptpfad
    Args(&'static [&'static str]),
}

struct App {
    id: &'static str,
    name: &'static str,
    bundle: &'static str,
    file: &'static str,
    launch: Launch,
}

const APPS: &[App] = &[
    App {
        id: "terminal",
        name: "Terminal",
        bundle: "com.apple.Terminal",
        file: "Terminal.app",
        launch: Launch::OpenFile,
    },
    App {
        id: "iterm2",
        name: "iTerm2",
        bundle: "com.googlecode.iterm2",
        file: "iTerm.app",
        launch: Launch::OpenFile,
    },
    App {
        id: "ghostty",
        name: "Ghostty",
        bundle: "com.mitchellh.ghostty",
        file: "Ghostty.app",
        // Beim Öffnen einer Datei fragt Ghostty jedes Mal nach und startet eine Shell im
        // Temp-Ordner, die nach dem SSH-Ende offen bleibt; mit -e läuft nur das Skript
        launch: Launch::Args(&["-e"]),
    },
    App {
        id: "wezterm",
        name: "WezTerm",
        bundle: "com.github.wez.wezterm",
        file: "WezTerm.app",
        launch: Launch::Args(&["start", "--"]),
    },
    App {
        id: "kitty",
        name: "kitty",
        bundle: "net.kovidgoyal.kitty",
        file: "kitty.app",
        launch: Launch::Args(&[]),
    },
    App {
        id: "alacritty",
        name: "Alacritty",
        bundle: "org.alacritty",
        file: "Alacritty.app",
        launch: Launch::Args(&["-e"]),
    },
];

/// Eintrag für die Auswahl in der Oberfläche
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalApp {
    pub id: String,
    pub name: String,
}

fn app_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join("Applications"));
    }
    dirs
}

/// Installierte Terminal-Apps; Suche in den üblichen Programmordnern
pub fn installed() -> Vec<TerminalApp> {
    let dirs = app_dirs();
    APPS.iter()
        .filter(|app| dirs.iter().any(|d| d.join(app.file).exists()))
        .map(|app| TerminalApp {
            id: app.id.into(),
            name: app.name.into(),
        })
        .collect()
}

/// Startet das Skript im gewählten Terminal; None oder unbekannt = macOS-Standard
pub fn launch(terminal: Option<&str>, script: &Path) -> Result<(), String> {
    let mut cmd = Command::new("open");
    match terminal.and_then(|id| APPS.iter().find(|app| app.id == id)) {
        None => {
            cmd.arg(script);
        }
        Some(App {
            bundle,
            launch: Launch::OpenFile,
            ..
        }) => {
            cmd.args(["-b", bundle]).arg(script);
        }
        Some(App {
            bundle,
            launch: Launch::Args(args),
            ..
        }) => {
            cmd.args(["-n", "-b", bundle, "--args"])
                .args(*args)
                .arg(script);
        }
    }
    let status = cmd.status().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(tr!(
            "Could not open the terminal. Is the app still installed?",
            "Das Terminal konnte nicht geöffnet werden. Ist die App noch installiert?"
        ));
    }
    Ok(())
}
