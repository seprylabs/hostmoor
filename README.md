# StackPort

macOS-App, die eigene Server und Kundenserver (Hetzner, netcup …) mit ihren Projekten an einem Ort zeigt, gedacht für die Arbeit mit Laravel und WordPress.

**Stack:** Tauri 2 (Rust) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · SQLite

## Funktionen

- Kunden → Projekte → Server, in der Seitenleiste nach Kunden oder nach Servern gruppiert
- Kunden, Server und Projekte von Hand anlegen, bearbeiten und löschen
- Favoriten und einklappbare Kundengruppen
- Backup als JSON exportieren und wiederherstellen
- SSH-Zugang nur über lokale Keys: die App speichert nur den **Pfad** zum Key und liest die Key-Datei nie
- Verbindungstest mit Einrichtungshilfe (erkannte Ursache plus Befehle zum Selbst-Ausführen)
- Button „Terminal“: öffnet das Mac-Terminal mit einer SSH-Sitzung, bei Projekten direkt im Projektordner
- Server-Check auf Knopfdruck: PHP, Composer, Node/npm, Git, WP-CLI, Webserver, Datenbank, Redis, RAM, Platten. Das Skript (`src-tauri/src/check.sh`) liest nur. Das Ergebnis wird lokal gespeichert, nach 30 Tagen als veraltet markiert, und es wird nie automatisch geprüft
- Deploy-Skripte pro Projekt: Vorlagen für Laravel/WordPress, Bestätigung vor dem Start, Live-Ausgabe, Abbrechen, Verlauf der letzten 20 Deploys, macOS-Mitteilung am Ende (wenn das Fenster im Hintergrund ist oder der Deploy länger als eine Minute lief)
- „Alle Server prüfen“ im ⋯-Menü der Seitenleiste (drei Server gleichzeitig, Zusammenfassung am Ende)
- GitHub Actions und GitLab-Pipelines pro Projekt (auch selbst gehostetes GitLab); Tokens liegen im macOS-Schlüsselbund
- Seitenleiste zeigt laufende und fehlgeschlagene Deploys pro Projekt

## Entwicklung

Voraussetzungen: Rust (`rustup`), Xcode Command Line Tools, Node 22 (siehe `.nvmrc`).

```bash
npm install
npm run tauri dev      # App mit Hot-Reload starten
npm run tauri build    # StackPort.app bauen → src-tauri/target/release/bundle/macos/
```

Rust-Tests:

```bash
cd src-tauri && cargo test
```

Ohne Tauri läuft die Oberfläche auch im Browser (`npm run dev`, http://localhost:1420). Die Daten landen dann im localStorage statt in SQLite.

## Daten

Die Datenbank liegt unter `~/Library/Application Support/de.spmedia.stackport/stackport.db`. Schema-Migrationen stehen in `src-tauri/src/db.rs` (`MIGRATIONS`) und laufen beim Start automatisch.

## Aufbau

```
src/                    React-Oberfläche
  components/           Seitenleiste, Detailansichten, Formulare
  components/ui/        shadcn/ui-Komponenten
  hooks/use-store.ts    Daten laden und ändern
  lib/api.ts            Aufrufe ans Rust-Backend (mit Browser-Fallback)
src-tauri/src/
  db.rs                 SQLite, Migrationen, Tests
  commands.rs           Tauri-Commands für die Oberfläche
  ssh.rs                Aufruf des System-ssh, Fehlererkennung
  check.rs / check.sh   Server-Check: Skript auf dem Server, Auswertung in Rust
  deploy.rs             Deploys: ssh im Hintergrund, Ausgabe als Events
  ci.rs                 GitHub-/GitLab-API, Tokens im Schlüsselbund
  models.rs             Datentypen
```
