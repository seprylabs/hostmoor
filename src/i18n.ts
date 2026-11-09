import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { setBackendLanguage } from "@/lib/api";
import de from "@/locales/de.json";
import en from "@/locales/en.json";

export type Language = "en" | "de";
/** "system" follows the operating system language */
export type LanguageSetting = Language | "system";

// `satisfies` makes tsc fail when a key from en.json is missing in de.json
export const resources = {
  en: { translation: en },
  de: { translation: de satisfies typeof en },
};

const SETTING_KEY = "hostmoor-language";

export function languageSetting(): LanguageSetting {
  const value = localStorage.getItem(SETTING_KEY);
  return value === "en" || value === "de" ? value : "system";
}

/** Saves the setting, resolves "system" to en/de and switches the UI and the Rust side */
export async function applyLanguage(setting: LanguageSetting) {
  if (setting === "system") localStorage.removeItem(SETTING_KEY);
  else localStorage.setItem(SETTING_KEY, setting);
  const language = await setBackendLanguage(setting === "system" ? null : setting);
  document.documentElement.lang = language;
  await i18n.changeLanguage(language);
}

/** Call once before the first render */
export async function initI18n() {
  await i18n.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    // React escapes values itself
    interpolation: { escapeValue: false },
  });
  await applyLanguage(languageSetting());
}

export default i18n;
