# Contributing to Kelidar

Thanks for helping. This page covers how to set up the project, what a pull request needs and how
releases are made.

## Before you start

- For a bug, open an issue with the bug report form first, unless the fix is tiny.
- For a new feature, open an issue first. Kelidar follows a phased [roadmap](docs/ROADMAP.md) and
  keeps advanced features out of sight, so not every good idea fits the current phase.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Set up

You need Windows 10 or 11 (x64), Node.js 22.18 or newer and Git.

```powershell
npm ci
npm run dev
```

## Rules the code follows

The project rules are in [AGENTS.md](AGENTS.md). The most important ones:

- Three layers: `src/main` (Node.js), `src/preload` (contextBridge only), `src/renderer` (React).
  The renderer is untrusted. Privileged work happens in main behind the typed IPC contract in
  `src/shared/ipc.ts`.
- Secrets never reach the renderer, logs or error messages.
- TypeScript strict, no `any`, no `ts-ignore`.
- No hard-coded UI strings: every string goes through i18next in both `en.json` and `fa.json`. Use
  logical CSS properties (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) so right-to-left works.
- Every error says what failed and what the user can do next.

## Before you open a pull request

All three must pass:

```powershell
npm run typecheck
npm run lint
npm test
```

If you changed the user interface, also run `npm run build` and `npm run test:e2e`.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Release Please reads
them to pick the next version and write [CHANGELOG.md](CHANGELOG.md), so write the subject for
users: say what changed for them.

| Type                                                        | Use it for                         | In the changelog | Version (below 1.0) |
| ----------------------------------------------------------- | ---------------------------------- | ---------------- | ------------------- |
| `feat`                                                      | a new feature                      | Features         | patch (0.1.0→0.1.1) |
| `fix`                                                       | a bug fix                          | Bug Fixes        | patch               |
| `perf`                                                      | a speed-up                         | Performance      | patch               |
| `feat!` or a `BREAKING CHANGE:` footer                      | a change that breaks existing data | Features         | minor (0.1.x→0.2.0) |
| `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `style` | everything else                    | hidden           | none                |

Examples:

```text
feat(sftp): drag files from Explorer into the file panel
fix(terminal): keep the cursor visible after resizing
chore(deps): update eslint to 10.16
```

Do not edit `CHANGELOG.md` or the version in `package.json` by hand.

## How releases work

1. Every push to `main` makes Release Please open or update a pull request named
   `chore: release x.y.z`, with the new version and the changelog entry.
2. When you want to ship, merge that pull request.
3. Release Please tags the commit and creates the GitHub Release. The **Publish** workflow then
   builds the installer on Windows, runs all tests again and attaches
   `Kelidar-Setup-x.y.z-x64.exe`, its blockmap, `latest.yml` and `SHA256SUMS.txt` to the release.

Versions below 1.0.0 are marked as pre-releases.

Each roadmap phase starts a new minor version (phase 2 is 0.2.0). To jump there, add a
`Release-As` footer to any commit on `main`:

```text
chore: start phase 2

Release-As: 0.2.0
```

If a Publish run fails, fix the cause and run **Publish** again from the Actions tab with the tag
name, for example `v0.1.1`.

## License

By contributing you agree that your work is released under the [MIT License](LICENSE).
