import React from "react";
import { isTauri } from "@tauri-apps/api/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Hell/Dunkel folgt der macOS-Einstellung
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);

// Transparenter Fenster-Hintergrund nur in der App (macOS-Vibrancy der Seitenleiste)
if (isTauri()) document.documentElement.classList.add("vibrancy");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
