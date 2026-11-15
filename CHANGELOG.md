# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Encrypted vault (`vault.json` in the user data folder): AES-256-GCM with a random 256-bit key wrapped by Windows DPAPI through Electron safeStorage (async API), a fresh nonce on every save, the header bound to the body, atomic saves and the ten newest backups in `vault-backups`. A damaged or changed vault is never overwritten. `--vault-self-test` checks the vault against the real safeStorage inside Electron.
- Saved hosts: a Hosts list and a four-field form (name, address, user name, sign-in method) with the port under "More options". Sign in with a saved password, a password asked each time, or a private key file (OpenSSH, PEM or PuTTY) with an optional passphrase. The key file is picked in a native dialog run by main and imported into the vault; the renderer only gets the file name. Hosts can be edited and deleted (deleted records keep a tombstone and their secrets are wiped). Ctrl+N opens the form; Ctrl+E and Delete act on the focused host.
- SSH sessions in main (`SessionManager` on ssh2): `session:open` returns a session id at once and progress arrives as typed states (connecting, verifying-host-key, authenticating, ready, closed, error); an `xterm-256color` shell with keepalive, resize and close; output sent in batches about every 8 ms with flow control (main stops reading from the server while the renderer is more than 1 MB behind). Sign-in tries the saved key or password, answers a single keyboard-interactive password question, and asks the user (three tries) when no password is saved. Sessions belong to the window that opened them and close when it reloads or closes.
- Host key checks: trust on first use with the SHA-256 fingerprint shown in a dialog; trusted keys are stored in the vault; a changed key stops the connection before sign-in, and the old key can only be removed on purpose. The application menu is removed so its accelerators (Ctrl+W, Ctrl+R) no longer close or reload the window.
- Atomic writes retry a rename for a moment when Windows reports the file as busy.
- Integration tests against an in-process ssh2 server: password, ed25519 key with passphrase, wrong password, password asked each time, keyboard-interactive, changed and rejected host keys, resize, 3 MB of output with flow control, a dropped network, and a check that no password, passphrase or private key reaches the renderer, the logs or the disk in plain text.
- Dependencies: `ssh2` (SSH client in main, used without its optional native bindings) and `@xterm/xterm` with the fit, webgl and unicode-graphemes addons (terminal, used from step 1.5).
- Phase 0 foundation: Electron, electron-vite, React and strict TypeScript project with ESLint, Prettier, Vitest and Playwright.
- Secure main window: context isolation, sandbox, no Node integration, the app served from `app://` with a strict Content Security Policy, navigation and new windows denied, all permission requests denied, single-instance lock.
- Electron fuses applied to the packaged app (no RunAsNode, no NODE_OPTIONS, no inspector flags, asar integrity check, app loads only from asar).
- Typed IPC contract in `src/shared/ipc.ts` with a router that checks the sender frame and validates every payload and response with zod; sample channel `app:getVersion`.
- App shell: custom title bar with a tab strip, sidebar (Hosts and Settings enabled; Files, Tunnels and Snippets shown as coming later), empty Hosts state with a Quick Connect field (not wired yet), keyboard shortcuts Ctrl+1, Ctrl+, and Ctrl+T.
- Light and dark themes that follow Windows, with a manual choice in Settings; design tokens in `src/renderer/styles/tokens.css`.
- English and Persian with a full right-to-left layout and the Vazirmatn font for Persian.
- Non-secret `settings.json` in the user data folder with a zod schema, versioned migrations, atomic writes and recovery from a broken file.
- Windows installer (NSIS, x64, per-user, no admin rights) and a GitHub Actions workflow that typechecks, lints, tests and uploads the installer.
