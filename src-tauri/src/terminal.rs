//! Terminal apps in which the SSH session can be opened.
//!
//! macOS has no system-wide default terminal. "Default" opens the .command file
//! with the app the Finder uses for it (usually Terminal.app). On Linux, "default"
//! is `x-terminal-emulator` (Debian/Ubuntu) or the first installed terminal.
//! On Windows the session opens in the default console (Windows Terminal on Windows 11),
//! see `ssh::open_terminal`.

use serde::Serialize;

pub use platform::*;

/// Entry for the selection in the UI
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalApp {
    pub id: String,
    pub name: String,
}

pub(crate) fn open_failed() -> String {
    tr!(
        "Could not open the terminal. Is the app still installed?",
        "Das Terminal konnte nicht geöffnet werden. Ist die App noch installiert?"
    )
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::{TerminalApp, open_failed};

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
            return Err(open_failed());
        }
        Ok(())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use std::path::Path;
    use std::process::{Command, Stdio};

    use super::{TerminalApp, open_failed};

    struct App {
        id: &'static str,
        name: &'static str,
        bin: &'static str,
        /// Arguments before the script path
        args: &'static [&'static str],
    }

    const APPS: &[App] = &[
        App {
            id: "gnome-terminal",
            name: "GNOME Terminal",
            bin: "gnome-terminal",
            args: &["--"],
        },
        App {
            id: "ptyxis",
            name: "Ptyxis",
            bin: "ptyxis",
            args: &["--"],
        },
        App {
            id: "konsole",
            name: "Konsole",
            bin: "konsole",
            args: &["-e"],
        },
        App {
            id: "xfce4-terminal",
            name: "Xfce Terminal",
            bin: "xfce4-terminal",
            args: &["-x"],
        },
        App {
            id: "ghostty",
            name: "Ghostty",
            bin: "ghostty",
            args: &["-e"],
        },
        App {
            id: "wezterm",
            name: "WezTerm",
            bin: "wezterm",
            args: &["start", "--"],
        },
        App {
            id: "kitty",
            name: "kitty",
            bin: "kitty",
            args: &[],
        },
        App {
            id: "alacritty",
            name: "Alacritty",
            bin: "alacritty",
            args: &["-e"],
        },
        App {
            id: "xterm",
            name: "xterm",
            bin: "xterm",
            args: &["-e"],
        },
    ];

    /// Debian/Ubuntu alternative pointing to the system's default terminal
    const DEFAULT: App = App {
        id: "default",
        name: "",
        bin: "x-terminal-emulator",
        args: &["-e"],
    };

    fn on_path(bin: &str) -> bool {
        std::env::var_os("PATH")
            .is_some_and(|paths| std::env::split_paths(&paths).any(|dir| dir.join(bin).is_file()))
    }

    pub fn installed() -> Vec<TerminalApp> {
        APPS.iter()
            .filter(|app| on_path(app.bin))
            .map(|app| TerminalApp {
                id: app.id.into(),
                name: app.name.into(),
            })
            .collect()
    }

    /// Runs the script in the chosen terminal; None or unknown = default
    pub fn launch(terminal: Option<&str>, script: &Path) -> Result<(), String> {
        let app = terminal
            .and_then(|id| APPS.iter().find(|app| app.id == id))
            .filter(|app| on_path(app.bin))
            .or_else(|| Some(&DEFAULT).filter(|app| on_path(app.bin)))
            .or_else(|| APPS.iter().find(|app| on_path(app.bin)))
            .ok_or_else(|| {
                tr!(
                    "No terminal app found. Install e.g. GNOME Terminal, Konsole or xterm.",
                    "Keine Terminal-App gefunden. Installiere z. B. GNOME Terminal, Konsole oder xterm."
                )
            })?;
        // The terminal keeps running after we return; it is not waited for
        Command::new(app.bin)
            .args(app.args)
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(drop)
            .map_err(|_| open_failed())
    }
}

#[cfg(windows)]
mod platform {
    use super::TerminalApp;

    /// Windows opens the session in the default console, there is nothing to choose
    pub fn installed() -> Vec<TerminalApp> {
        Vec::new()
    }
}
