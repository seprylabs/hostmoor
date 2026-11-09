# Changelog

All notable changes to StackPort are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and StackPort follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-09

### Fixed

- "Check for updates" failed with "Command plugin:app|version not allowed by ACL" when StackPort was already up to date.

## [1.0.0] - 2026-11-09

First public release.

### Added

- Customers, projects and servers in one place, grouped in the sidebar, with favorites and search.
- Server check over SSH (OS, PHP, database, web server, disks and more), connection test with setup help, and a terminal button that opens an SSH session.
- Deploys per project with templates for Laravel and WordPress, live output, cancel and history.
- GitHub Actions and GitLab pipelines per project, polled in the background with notifications.
- Backup of all data as JSON, export and restore.
- English and German user interface. The language follows the system and can be switched in the sidebar menu.
- Windows and Linux support, including terminal integration and CI tokens in the system keychain on all platforms.
- Builds and installers for macOS, Windows and Linux on every release tag.
- CI checks on macOS, Windows and Linux for every pull request, plus dependency audits.
- English README with screenshots, contributing guide, code of conduct, and issue and pull request templates.
- Open-source license: AGPL-3.0.
- In-app updates: StackPort checks for new versions at startup and from the sidebar menu, and installs signed updates after you confirm.

[Unreleased]: https://github.com/seprylabs/stackport/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/seprylabs/stackport/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/seprylabs/stackport/releases/tag/v1.0.0
