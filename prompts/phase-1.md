Read AGENTS.md first. We are in Phase 1 (First connection, v0.1). Goal: save a host and work in a real terminal. Do the steps in order and stop after each one.

Step 1.1 Vault. Implement the vault from AGENTS.md in safeStorage mode only. Unit tests for round trip, tamper detection, atomic save and backup rotation, plus a self-test that runs inside Electron, not only in Node.

Step 1.2 Hosts. Host, Secret and KnownHost types with zod schemas; IPC for list, save and delete; a Hosts list and the four-field form (name, address, username, sign-in method = password, or private key file with optional passphrase). Port goes under "More options".

Step 1.3 Sessions. A SessionManager in main built on ssh2: open(hostId or quick-connect string) returns a sessionId; shell channel with xterm-256color; keepalive; resize; close; typed states (connecting, verifying-host-key, authenticating, ready, closed, error).

Step 1.4 Host keys. Trust-on-first-use dialog that shows the SHA-256 fingerprint; a changed key blocks the connection with a warning; known hosts are stored in the vault.

Step 1.5 Terminal. xterm.js with the webgl, fit and unicode-graphemes addons; tabs (new, close, switch, rename; Ctrl+T, Ctrl+W, Ctrl+Tab); copy on select; paste with Ctrl+Shift+V and right click; output batching (about 8 ms) and flow control so printing a huge file does not freeze the UI.

Step 1.6 Quick Connect. Parse user@host, user@host:port and full commands such as ssh user@host -p 2222 -i key; connect without saving, then offer "Save host".

Step 1.7 Errors. Map failures (DNS, timeout, connection refused, host key, authentication, algorithm mismatch) to translated messages, each with a suggested next step.

Step 1.8 Themes. Four built-in terminal themes that follow the Windows light or dark setting.

Tests: integration tests against an in-process ssh2 Server for password login, key login, wrong password, changed host key, resize and large output. One test must prove that no secret appears in renderer state or in logs.

Done when: I can connect to a real Linux server with a password and with an ed25519 key, htop and vim behave correctly, three sessions stay open together, and a dropped network shows a clear state on the tab. Also confirm the app builds and runs on a machine without native build tools.

Out of scope: groups, SFTP, tunnels, snippets, agent, jump hosts.
