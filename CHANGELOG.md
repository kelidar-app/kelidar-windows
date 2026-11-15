# Changelog

All notable changes to this project are documented here. The project uses
[Semantic Versioning](https://semver.org/). From 0.1.0 on,
[Release Please](https://github.com/googleapis/release-please) writes each entry
from the [Conventional Commit](https://www.conventionalcommits.org/) messages
merged since the last release, so this file is not edited by hand.

## [0.1.0](https://github.com/kelidar-app/kelidar-windows/releases/tag/v0.1.0) (2026-11-16)

First preview build: phases 0 and 1 of the roadmap. Save a host, check its key and open a terminal.

### Added

- Public repository files: README, MIT LICENSE, SECURITY.md, CONTRIBUTING.md, issue and pull request templates, and Dependabot for npm packages and GitHub Actions.
- Releases: Release Please opens a release pull request from the Conventional Commit messages on `main`; merging it tags the version and a Windows workflow builds the installer and attaches it to the GitHub Release with `latest.yml`, the blockmap and `SHA256SUMS.txt`. Versions below 1.0.0 are marked as pre-releases.
- Encrypted vault (`vault.json` in the user data folder): AES-256-GCM with a random 256-bit key wrapped by Windows DPAPI through Electron safeStorage (async API), a fresh nonce on every save, the header bound to the body, atomic saves and the ten newest backups in `vault-backups`. A damaged or changed vault is never overwritten. `--vault-self-test` checks the vault against the real safeStorage inside Electron.
- Saved hosts: a Hosts list and a four-field form (name, address, user name, sign-in method) with the port under "More options". Sign in with a saved password, a password asked each time, or a private key file (OpenSSH, PEM or PuTTY) with an optional passphrase. The key file is picked in a native dialog run by main and imported into the vault; the renderer only gets the file name. Hosts can be edited and deleted (deleted records keep a tombstone and their secrets are wiped). Ctrl+N opens the form; Ctrl+E and Delete act on the focused host.
- SSH sessions in main (`SessionManager` on ssh2): `session:open` returns a session id at once and progress arrives as typed states (connecting, verifying-host-key, authenticating, ready, closed, error); an `xterm-256color` shell with keepalive, resize and close; output sent in batches about every 8 ms with flow control (main stops reading from the server while the renderer is more than 1 MB behind). Sign-in tries the saved key or password, answers a single keyboard-interactive password question, and asks the user (three tries) when no password is saved. Sessions belong to the window that opened them and close when it reloads or closes.
- Host key checks: trust on first use with the SHA-256 fingerprint shown in a dialog; trusted keys are stored in the vault; a changed key stops the connection before sign-in, and the old key can only be removed on purpose. The application menu is removed so its accelerators (Ctrl+W, Ctrl+R) no longer close or reload the window.
- Terminal: xterm.js 6 with the WebGL renderer (DOM fallback), fit and Unicode grapheme addons, one tab per session in the title bar with a status dot, rename (double-click or Ctrl+Shift+R), close (Ctrl+W, middle click) and switching (Ctrl+Tab, Ctrl+Shift+Tab). Copy on select, paste with Ctrl+Shift+V or right click. Terminals keep their scrollback while hidden. A banner shows connecting, signing in, disconnected and error states with "Connect again"; a changed host key offers to remove the old key only after a warning. Connect from the host list with the Connect button, Enter or a double-click.
- Quick Connect: type `user@host`, `user@host:port`, `user@[ipv6]:port`, `ssh://user@host:port` or paste a full command such as `ssh user@host -p 2222 -i ~/.ssh/key` (also `-l` and `-o Port=/User=/IdentityFile=`). Unsupported options (jump hosts, tunnels, remote commands) are named in a translated message. Main parses the text again and never trusts the renderer's reading. Without `-i` the password is asked for; an encrypted key's passphrase is asked for (three tries) before connecting. Nothing is saved until "Save host", which can store the password or key that worked; the tab then belongs to the saved host.
- Clear connection errors: an unknown name, a refused connection, an unreachable network, a timeout, a server that hangs up, a lost connection, a changed or rejected host key, failed sign-in, no algorithm in common and a missing shell each have their own translated message that says what to do next. A failed sign-in on a saved host offers "Edit host".
- Four terminal themes (Kelidar, Classic, Soft, High contrast), each with a light and a dark variant that follows Windows or the theme chosen in Settings; picked in Settings with a preview. Every variant keeps text at a contrast of at least 4.5:1. `settings.json` moves to version 2 (adds `terminalTheme`) with an automatic migration.
- The installer never ships or rebuilds native modules (`npmRebuild: false`; ssh2's optional `cpu-features` and crypto addons and the Pageant helper are left out), so the app builds and runs the same on a machine without a C++ toolchain.
- Phase 1 Playwright smoke test: the vault self-test against DPAPI, saving a host with the four-field form, the host key dialog, terminal output (via copy on select), typing and pasting, three sessions at once, tab shortcuts, a server that goes away, and no password in the page, its storage or the data folder.
- The production CSP allows exactly one inline style hash, the one of an empty `<style>` element that xterm.js creates; the text xterm.js writes into its style elements is moved into constructed stylesheets, so no inline CSS runs.
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
