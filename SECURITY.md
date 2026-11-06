# Security

StackPort has SSH and deploy access to your servers, so we take security issues seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report vulnerabilities privately via
["Report a vulnerability"](https://github.com/seprylabs/stackport/security/advisories/new)
(GitHub Private Vulnerability Reporting).

Helpful details:

- affected version
- steps to reproduce or a proof of concept
- your assessment of the impact

You'll get a first response within 7 days. After the fix we publish an advisory and, if you
like, credit you as the reporter.

## Supported versions

Security fixes are only provided for the latest version.

## Security model

- **SSH keys:** The app never reads the contents of a key file. It only passes the path to the
  system `ssh` (`ssh -i`). Passphrases stay in the ssh-agent or the system keychain.
- **Host keys:** Connection tests, server checks and deploys run with `BatchMode=yes` and
  `StrictHostKeyChecking=yes`. Unknown or changed host keys are never accepted silently.
  You confirm a new server once yourself in the terminal.
- **Shell calls:** Processes are started without a local shell, with separate arguments.
  Host names and user names are validated (no leading `-`, only allowed characters);
  paths and scripts for the shell on the server are quoted.
- **Deploy scripts** are intentionally arbitrary shell commands and run with the permissions of
  the SSH user on the server. Anyone who can change the local database can therefore run commands
  on your servers. Protect your user account accordingly.
- **CI tokens** are stored in the system keychain (macOS Keychain, Windows Credential Manager,
  Secret Service on Linux), never in the database or in backups.
- **User interface:** A strict Content Security Policy only allows the app's own scripts and no
  connections except to the app itself. Tauri permissions are limited to events, window dragging,
  file dialogs, opening `https://` links, the updater and restarting the app after an update.
- **Updates:** The app downloads `latest.json` from GitHub Releases and installs an update only
  after the user confirms. Every update bundle is signed with the project's updater key (separate
  from any OS code signing) and verified against the public key in `tauri.conf.json`; a bundle
  with a missing or wrong signature is rejected.
- **`macOSPrivateApi`** is enabled because the transparent window with the sidebar effect needs it.
  StackPort is not meant for the App Store anyway: its sandbox doesn't allow access to `~/.ssh`
  and the system `ssh`.
