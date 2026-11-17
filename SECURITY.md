# Security policy

Kelidar stores SSH passwords, private keys and passphrases, so we treat security reports as the
highest priority.

## Supported versions

Only the latest release receives security fixes. Kelidar is below 1.0, so please update to the
newest version before you report a problem.

## Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub:
[Report a vulnerability](https://github.com/kelidar-app/kelidar-windows/security/advisories/new).

Include, if you can:

- the Kelidar version and the Windows version,
- what an attacker can do and what they need first (local access, a malicious server, a crafted file),
- steps or a proof of concept to reproduce it.

Never include real passwords, private keys or vault files. Use throwaway test credentials.

## What happens next

- We confirm that we received the report within 7 days.
- We tell you whether we can reproduce it and how we plan to fix it.
- We publish the fix in a new release and a GitHub security advisory, and credit you unless you
  ask us not to.

## Scope

In scope: the Kelidar application and installer, the encrypted vault, host key checks, the IPC
boundary between the main process and the renderer, and the release workflows in this repository.

Out of scope: problems in Electron, ssh2 or other dependencies that are already public (report
them upstream; we will update), and attacks that need an attacker who already runs code as your
Windows user while the vault is unlocked. With a master password set, reading a locked vault or
its backups without the password is in scope.

Updates come from this repository's GitHub Releases. Until the installer is code-signed, an
update is checked against the SHA-512 hash in the release's `latest.yml`, which protects against
a damaged download but not against a compromised release. Problems in that chain are in scope.

The security design is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (in Persian).
