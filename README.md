<div align="center">

<img src="resources/icon.png" alt="" width="96" height="96">

# Kelidar

**A free, open-source SSH manager for Windows.**
Connect to a server in two steps. Everything else stays out of the way until you need it.

[![CI](https://github.com/kelidar-app/kelidar-windows/actions/workflows/ci.yml/badge.svg)](https://github.com/kelidar-app/kelidar-windows/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/kelidar-app/kelidar-windows?include_prereleases&sort=semver)](https://github.com/kelidar-app/kelidar-windows/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Windows 10 and 11, x64](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20x64-0078D4)

</div>

> [!WARNING]
> Kelidar is an early preview (phase 1 of 7 on the [roadmap](docs/ROADMAP.md)). It works, but
> features are missing and data formats may still change. The first public alpha comes after phase 2.

## Why Kelidar

- **Local-first.** No account, no cloud, no telemetry. Your hosts and secrets stay on your PC.
- **Simple by default.** The host form has four fields: name, address, user name and sign-in method. The rest sits under "More options".
- **Secure by design.** Passwords and keys live in an encrypted vault and never reach the user interface.
- **English and Persian**, with a full right-to-left layout.

## Features in this preview

- Saved hosts with password, password-asked-each-time, or private key sign-in (OpenSSH, PEM and PuTTY keys)
- Quick Connect: type `user@host` or paste a whole `ssh` command
- Trust on first use with SHA-256 host key fingerprints; a changed key blocks the connection
- Terminal tabs (xterm.js with WebGL), copy on select, paste with Ctrl+Shift+V or right click
- Clear connection errors that tell you what to do next
- Four terminal themes with light and dark variants that follow Windows

The full list, with the phase each feature arrives in, is in [docs/FEATURES.md](docs/FEATURES.md).

## Download

Get the latest installer (`Kelidar-Setup-<version>-x64.exe`) from
[Releases](https://github.com/kelidar-app/kelidar-windows/releases). It installs for the current
user only and needs no admin rights.

The installer is not code-signed yet, so Windows SmartScreen may warn you. Choose
**More info → Run anyway** if you trust the download. To check that the file is the one we built,
compare its hash with `SHA256SUMS.txt` from the same release:

```powershell
Get-FileHash .\Kelidar-Setup-0.1.0-x64.exe -Algorithm SHA256
```

## Build from source

You need Windows 10 or 11 (x64), [Node.js](https://nodejs.org/) 22.18 or newer and Git. No C++
build tools are needed.

```powershell
git clone https://github.com/kelidar-app/kelidar-windows.git
cd kelidar-windows
npm ci
npm run dev
```

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Start the app with hot reload                         |
| `npm run typecheck` | Type-check main, preload, renderer and tests          |
| `npm run lint`      | ESLint with no warnings allowed                       |
| `npm test`          | Unit and integration tests (Vitest)                   |
| `npm run test:e2e`  | Playwright smoke tests against Electron (build first) |
| `npm run dist`      | Build the NSIS installer into `dist/`                 |

## Security

- The window runs with context isolation, the sandbox on and no Node.js integration, and is served
  from a custom `app://` protocol under a strict Content Security Policy.
- All privileged work happens in the main process behind one typed IPC contract; every message is
  validated with zod.
- The vault is a single file encrypted with AES-256-GCM. Its key is protected by Windows DPAPI
  through Electron `safeStorage`.
- Secrets never reach the renderer, the logs or error messages.

The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). To report a vulnerability,
see [SECURITY.md](SECURITY.md). Please do not open a public issue for it.

## Project layout

```text
src/main       Node.js main process: vault, SSH sessions, IPC handlers
src/preload    contextBridge only
src/renderer   React user interface
src/shared     Types and zod schemas shared by all three
tests/         Unit, integration (in-process SSH server) and Playwright tests
docs/          Features, architecture and roadmap (in Persian)
```

## Contributing

Bug reports and ideas are welcome in [Issues](https://github.com/kelidar-app/kelidar-windows/issues).
Before you open a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md). Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/), because releases and the
[changelog](CHANGELOG.md) are made from them.

## License

[MIT](LICENSE) © Kelidar contributors
