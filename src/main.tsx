import React from "react";
import { isTauri } from "@tauri-apps/api/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import "./index.css";

// Hell/Dunkel folgt der macOS-Einstellung
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);

// Transparenter Fenster-Hintergrund nur in der App (macOS-Vibrancy der Seitenleiste)
if (isTauri()) document.documentElement.classList.add("vibrancy");

// Render only once the language is known, so the UI never flashes in the wrong one
initI18n().finally(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
