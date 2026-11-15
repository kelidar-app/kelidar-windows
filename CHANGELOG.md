# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Phase 0 foundation: Electron, electron-vite, React and strict TypeScript project with ESLint, Prettier, Vitest and Playwright.
- Secure main window: context isolation, sandbox, no Node integration, the app served from `app://` with a strict Content Security Policy, navigation and new windows denied, all permission requests denied, single-instance lock.
- Electron fuses applied to the packaged app (no RunAsNode, no NODE_OPTIONS, no inspector flags, asar integrity check, app loads only from asar).
- Typed IPC contract in `src/shared/ipc.ts` with a router that checks the sender frame and validates every payload and response with zod; sample channel `app:getVersion`.
- App shell: custom title bar with a tab strip, sidebar (Hosts and Settings enabled; Files, Tunnels and Snippets shown as coming later), empty Hosts state with a Quick Connect field (not wired yet), keyboard shortcuts Ctrl+1, Ctrl+, and Ctrl+T.
- Light and dark themes that follow Windows, with a manual choice in Settings; design tokens in `src/renderer/styles/tokens.css`.
- English and Persian with a full right-to-left layout and the Vazirmatn font for Persian.
- Non-secret `settings.json` in the user data folder with a zod schema, versioned migrations, atomic writes and recovery from a broken file.
- Windows installer (NSIS, x64, per-user, no admin rights) and a GitHub Actions workflow that typechecks, lints, tests and uploads the installer.
