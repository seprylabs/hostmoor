# Sicherheit

StackPort hat SSH- und Deploy-Zugriff auf deine Server. Sicherheitslücken nehmen wir deshalb ernst.

## Sicherheitslücke melden

Bitte **kein öffentliches Issue** anlegen. Melde Lücken vertraulich über
[„Report a vulnerability“](https://github.com/SebastianPrzybylski/stackport/security/advisories/new)
(GitHub Private Vulnerability Reporting).

Hilfreich sind:

- betroffene Version
- Schritte zum Nachstellen oder ein Proof of Concept
- deine Einschätzung der Auswirkung

Du bekommst innerhalb von 7 Tagen eine erste Rückmeldung. Nach dem Fix veröffentlichen
wir ein Advisory und nennen dich auf Wunsch als Finder.

## Unterstützte Versionen

Sicherheits-Fixes gibt es nur für die jeweils neueste Version.

## Sicherheitsmodell

- **SSH-Keys:** Die App liest nie den Inhalt einer Key-Datei. Sie übergibt nur den Pfad an das
  System-`ssh` (`ssh -i`). Passphrasen bleiben im ssh-agent bzw. Schlüsselbund.
- **Host-Keys:** Verbindungstest, Server-Check und Deploys laufen mit `BatchMode=yes` und
  `StrictHostKeyChecking=yes`. Unbekannte oder geänderte Host-Keys werden nie still akzeptiert.
  Einen neuen Server bestätigst du einmal selbst im Terminal.
- **Shell-Aufrufe:** Prozesse werden ohne lokale Shell mit getrennten Argumenten gestartet.
  Hostnamen und Benutzernamen werden geprüft (keine führenden `-`, nur erlaubte Zeichen),
  Pfade und Skripte für die Shell auf dem Server gequotet.
- **Deploy-Skripte** sind absichtlich beliebige Shell-Befehle und laufen mit den Rechten des
  SSH-Benutzers auf dem Server. Wer die lokale Datenbank ändern kann, kann also Befehle auf deinen
  Servern ausführen. Schütze deinen Mac-Account entsprechend.
- **CI-Tokens** liegen im macOS-Schlüsselbund, nicht in der Datenbank oder in Backups.
- **Oberfläche:** Eine strenge Content Security Policy erlaubt nur eigene Skripte und keine
  Verbindungen außer zur App selbst. Die Tauri-Berechtigungen sind auf Events, Fenster ziehen,
  Datei-Dialoge und das Öffnen von `https://`-Links begrenzt.
- **`macOSPrivateApi`** ist aktiv, weil das transparente Fenster mit Seitenleisten-Effekt es
  braucht. Für den App Store ist StackPort ohnehin nicht gedacht: Die Sandbox dort erlaubt keinen
  Zugriff auf `~/.ssh` und das System-`ssh`.
