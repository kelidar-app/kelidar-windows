# Kelidar: project rules for AI coding agents

## What we are building
Kelidar is a free, open-source SSH manager for Windows 10 and 11 (x64). Connecting to a server must take two steps, and advanced features stay out of sight until they are needed. Local-first: no account, no cloud, no telemetry. UI languages: English and Persian (RTL).
Repository: https://github.com/kelidar-app/kelidar-windows (organization kelidar-app, repository kelidar-windows). Use this owner and repository for electron-builder's GitHub publish settings, the README and all links.

## Tech stack
Install the latest stable release of each package and check its current docs before using an API you are not sure about.
- Electron (always one of the three supported majors), electron-vite, TypeScript in strict mode
- Renderer: React, Tailwind CSS, shadcn/ui, Zustand, i18next, cmdk
- Terminal: @xterm/xterm 6 with addons fit, webgl, search, web-links, serialize, unicode-graphemes (the canvas addon was removed in v6)
- SSH and SFTP: ssh2, in the main process only. The app must build and run without ssh2's optional native bindings, so no native build toolchain is required.
- Validation: zod. Tests: Vitest and Playwright (Electron). Packaging: electron-builder (NSIS) with electron-updater (GitHub Releases).
- Package manager: npm. Never add a dependency without saying why in the step summary.

## Architecture rules (never break these)
1. Three layers: src/main (Node.js), src/preload (contextBridge only), src/renderer (React). Shared types and zod schemas live in src/shared.
2. The renderer is untrusted: contextIsolation on, sandbox on, nodeIntegration off, no remote content, strict CSP, app served from a custom app:// protocol, navigation and new windows denied, shell.openExternal only for validated http/https URLs.
3. All privileged work happens in main behind one typed IPC contract (src/shared/ipc.ts). Every handler checks the sender frame and parses its payload with zod.
4. Secrets (passwords, private keys, passphrases) never reach the renderer, logs, error messages or crash dumps. The renderer says "open a session for host <id>"; main reads the credentials from the vault. Copying a secret means main writes it to the clipboard.
5. Vault: one encrypted file under app.getPath('userData'). AES-256-GCM with a random 256-bit vault key. The key is wrapped with Electron safeStorage (async API only; the synchronous API is deprecated) or, when the user sets a master password, with a key derived by scrypt (N=2^17, r=8, p=1; raise maxmem as needed). Atomic writes (temp file, then rename) and ten rotating backups.
6. Host keys: trust on first use with SHA-256 fingerprints. A changed key blocks the connection with a clear warning.
7. Windows-only code lives in src/main/platform.
8. Every record has id (uuid), createdAt, updatedAt and deletedAt so data can be merged later.
9. The product name is defined once, in src/shared/app.ts.

## Product rules
- Simple by default: the host form shows four fields (name, address, username, sign-in method). Everything else sits under "More options".
- Every action is reachable from the command palette (Ctrl+K) and has a keyboard shortcut.
- Defaults that work: port 22, keepalive on, theme follows Windows.
- No hard-coded UI strings. Every string goes through i18next (en.json, fa.json). Use logical CSS properties (ms-, me-, ps-, pe-, start, end) so the RTL layout works.
- Every error says what failed and what the user can do next.
- Any tool that runs commands on a server shows the exact command first. Nothing is installed on a server unless the user asks for it.

## Code rules
- TypeScript strict, no any, no ts-ignore. Small modules in feature folders.
- Main returns typed error codes; the renderer maps them to translated messages.
- Tests: unit tests for vault, parsers, importers and IPC schemas; integration tests against an in-process ssh2 Server; one Playwright smoke test per phase.
- Before you say a step is done, run npm run typecheck, npm run lint and npm test. All three must pass.
- Conventional Commits, one commit per step. Release Please writes CHANGELOG.md and the version from the commit messages, so write each subject for users and never edit CHANGELOG.md or the version by hand. See CONTRIBUTING.md for the types and how releases work.

## Project documents
- docs/FEATURES.md: every feature with its phase number
- docs/ARCHITECTURE.md: stack, folder layout, data model, IPC contract, security design, key flows
- docs/ROADMAP.md: the seven phases with their acceptance criteria
- prompts/: one prompt per phase, plus helper prompts

The three documents are written in Persian. Read the relevant parts before you start a phase. If a document conflicts with this file, this file wins; tell me about the conflict.

## How to work with me
- Do one step at a time. After each step, tell me what changed, how to test it by hand and any decision you made. Then stop and wait for "next".
- If something is unclear or conflicts with these rules, ask before writing code.
- Never weaken a security rule to make something work. Propose another way.
- Do not build features from later phases, and do not block them either.
