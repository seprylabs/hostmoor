//! Language for texts that come from the Rust side: error messages, deploy log lines
//! and system notifications. The UI tells us its language via `set_language`;
//! until then the operating system language applies.

use std::sync::atomic::{AtomicBool, Ordering};

static GERMAN: AtomicBool = AtomicBool::new(false);

pub fn german() -> bool {
    GERMAN.load(Ordering::Relaxed)
}

/// Sets the language ("en", "de"); `None` follows the system language.
/// Returns the language actually used, everything except German falls back to English.
pub fn set(language: Option<&str>) -> &'static str {
    let tag = match language {
        Some(lang) => lang.to_owned(),
        None => sys_locale::get_locale().unwrap_or_default(),
    };
    let german = tag.to_ascii_lowercase().starts_with("de");
    GERMAN.store(german, Ordering::Relaxed);
    if german { "de" } else { "en" }
}

/// `tr!("English {x}", "Deutsch {x}", args…)` formats the text in the current language
#[macro_export]
macro_rules! tr {
    ($en:literal, $de:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::german() {
            format!($de $(, $arg)*)
        } else {
            format!($en $(, $arg)*)
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_language_tags() {
        assert_eq!(set(Some("de")), "de");
        assert_eq!(set(Some("de-AT")), "de");
        assert_eq!(set(Some("en")), "en");
        // Languages without translation fall back to English
        assert_eq!(set(Some("fr-FR")), "en");
        assert!(!german());
    }
}
