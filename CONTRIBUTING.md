# Contributing to StackPort

Thanks for your interest in StackPort! Bug reports, ideas and pull requests are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Language

Code comments, commit messages, issues and pull requests are written in **English**. Some older code comments are still in German; they are translated step by step, and a PR that translates comments in files it touches anyway is welcome.

The app itself is available in English and German. User-facing texts live in [`src/locales/en.json`](src/locales/en.json) and [`src/locales/de.json`](src/locales/de.json). When you add or change a text, update both files with the same keys. If you don't speak German, add the English text in both files and say so in the PR; we'll translate it.

## Setup

You need Rust (`rustup`), Node 22 (see `.nvmrc`) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system.

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run dev            # UI only in the browser (http://localhost:1420), data in localStorage
```

The [Development section of the README](README.md#development) explains where data is stored and how the source is organized.

## Checks

CI runs these checks on macOS, Windows and Linux for every pull request. Run them locally before you open one:

```bash
npm run build                                   # TypeScript check and Vite build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

## Code style

- **Rust:** formatted with `cargo fmt`; Clippy warnings fail the build.
- **TypeScript:** strict mode; `tsc` must pass without errors. Follow the style of the surrounding code.
- **UI:** components are built on [shadcn/ui](https://ui.shadcn.com) and Tailwind CSS. Reuse existing components before adding new ones.
- Keep changes focused. Unrelated refactoring belongs in its own PR.

## Tests

Rust tests live next to the code they test (`#[cfg(test)]` modules in `src-tauri/src/`). Add a test when you fix a bug or add logic in the backend, especially around SSH arguments, quoting and parsing. There are no frontend tests yet.

## Pull requests

1. For larger changes, open an issue first so we can agree on the approach.
2. Create a branch from `main`, e.g. `fix/deploy-cancel` or `feat/rollback`.
3. Write clear commit messages in the imperative mood ("Add rollback for deploys").
4. Open a pull request against `main` and fill in the template. Reference the issue with `Closes #123`.
5. All CI checks must pass. A maintainer reviews the PR and merges it with a merge commit.

Issues labeled [`good first issue`](../../labels/good%20first%20issue) are a good place to start, and [`help wanted`](../../labels/help%20wanted) marks issues where help is especially welcome.

Notable changes go into [CHANGELOG.md](CHANGELOG.md) under "Unreleased".

## License

StackPort is licensed under the [AGPL-3.0](LICENSE). By submitting a pull request, you agree that your contribution is licensed under the same license.
