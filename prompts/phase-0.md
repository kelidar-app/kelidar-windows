Read AGENTS.md first. We are in Phase 0 (Foundation). Goal: an empty but real app shell that builds into a Windows installer. Do the steps in order and stop after each one.

Step 0.1 Scaffold. electron-vite with React and TypeScript strict; the folder layout from AGENTS.md; ESLint, Prettier, Vitest; npm scripts: dev, build, typecheck, lint, test, dist.

Step 0.2 Secure window. One BrowserWindow with the security settings from AGENTS.md, a custom app:// protocol, a strict CSP, navigation and new windows denied, single-instance lock, and @electron/fuses applied in the build.

Step 0.3 Typed IPC. src/shared/ipc.ts as the single contract, a generic invoke/handle wrapper with zod validation and a sender check, a preload that exposes one typed api object, and one sample call (app:getVersion) with a test.

Step 0.4 App shell. Custom title bar with a tab strip, a left sidebar (Hosts, Files, Tunnels, Snippets, Settings; only Hosts and Settings enabled for now), an empty state with a Quick Connect input that is not wired yet, light and dark themes that follow Windows, design tokens in one file.

Step 0.5 Languages. i18next with en and fa, a language switch in Settings, and a full right-to-left layout check.

Step 0.6 Settings store. A non-secret settings.json in userData with a zod schema and versioned migrations.

Step 0.7 Packaging and CI. electron-builder NSIS target (per-user install, no admin rights) and a GitHub Actions workflow on windows-latest that runs typecheck, lint and tests and uploads the installer as an artifact.

Done when: npm run dev opens the shell; switching language mirrors the layout; CI is green and its installer installs and starts on a clean Windows 11 machine.

Out of scope: any SSH code, the vault, real hosts.
