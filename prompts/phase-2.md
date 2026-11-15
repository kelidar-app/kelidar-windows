Read AGENTS.md first. We are in Phase 2 (Daily driver, v0.2, first public alpha). Goal: good enough to replace my current SSH client every day and safe to hand to strangers. Do the steps in order and stop after each one.

Step 2.1 Organize. Nested groups, tags, colors, favorites and recents; group defaults inherited by hosts (port, identity, jump host, environment); card view and compact list view; fuzzy search; a command palette (Ctrl+K) that lists hosts and every action; a shortcut cheat sheet.

Step 2.2 Credentials. Identities (a reusable username plus sign-in method); a key manager (generate ed25519 and RSA keys with ssh2 utils, import OpenSSH and PPK keys, show the fingerprint, copy the public key); ssh-agent support (the Windows OpenSSH agent pipe `\\.\pipe\openssh-ssh-agent` and Pageant; ssh2's README documents only Pageant, so prove the OpenSSH pipe works with a test and tell me if it does not); keyboard-interactive prompts for one-time codes; agent forwarding per host; an "Upgrade to key login" flow (generate key, append it to authorized_keys, test the new login, then switch the host to the key).

Step 2.3 Reach. Jump hosts (chain with forwardOut and the sock option); SOCKS5 and HTTP proxies; auto-reconnect with backoff (1, 2, 5, 10, 30 s); "new tab on the same connection" (a new channel, no new login); sticky session (start the shell inside `tmux new-session -A -s kelidar-<short id>` when tmux exists, otherwise explain how to install it); a startup command per host.

Step 2.4 Terminal comfort. Split panes (horizontal and vertical, resizable, keyboard navigation); search; clickable links (Ctrl+click, http and https only); font family, size and line height; zoom; a multi-line paste guard with preview; an environment tag (production, staging, development) that colors the tab and pane border, with an extra confirmation for multi-line paste on production; sudo password fill by hotkey when a sudo prompt is detected, never automatic.

Step 2.5 Security. Optional master password (scrypt-wrapped vault key); a lock screen; auto-lock on idle and when Windows locks (powerMonitor); clipboard auto-clear after copying a secret; encrypted manual export and import; a restore screen for the automatic backups.

Step 2.6 Getting data in. Import from ~/.ssh/config (ssh-config package) and from PuTTY sessions (read `HKCU\Software\SimonTatham\PuTTY\Sessions` with reg.exe); a first-run wizard that detects both and offers to import; Smart Paste (extract host, port, user and password from free text such as a hosting provider e-mail, and always show a preview before saving); read /etc/os-release after the first connect to set the host icon; notes and links per host.

Step 2.7 Shipping. electron-updater with GitHub Releases (check on start, download in the background, a "Restart to update" button, release notes); version shown in Settings; README with screenshots, LICENSE, SECURITY.md, issue templates; a release workflow that runs on a version tag.

Done when: my PuTTY sessions import correctly; I can reach a server through a jump host with a key from the agent; after 30 s without network the session reconnects and a sticky session resumes; the app updates itself from 0.2.0 to 0.2.1; a locked vault shows nothing sensitive.

Out of scope: SFTP, tunnels, snippets, tray.
