Read AGENTS.md first. We are in Phase 3 (Files and tunnels, v0.3). Do the steps in order and stop after each one.

Step 3.1 SFTP service. In main, on the existing connection (client.sftp()): list, stat, mkdir, rename, delete, chmod; streaming upload and download with progress, cancel and retry; a transfer queue that runs two transfers at a time.

Step 3.2 Files panel. Beside the terminal: breadcrumb, sortable list, context menu, drag from Explorer to upload, drag out or "Download" to save, a chmod dialog with checkboxes, path bookmarks per host, and a Windows notification when a long transfer finishes.

Step 3.3 Edit remote file. Download to a private temp folder, open it with the default Windows editor, watch for saves and upload automatically; clean up when the session closes.

Step 3.4 Follow the terminal. Optional shell integration that makes the remote shell emit OSC 7 (show the snippet and offer to add it to .bashrc or .zshrc with one click); the files panel follows the current directory; dropping a file on a terminal uploads it there, and asks for a folder when the directory is unknown.

Step 3.5 Tunnel service. Local (forwardOut), remote (forwardIn) and dynamic (a minimal built-in SOCKS5 server that calls forwardOut); saved tunnels with an on/off switch, live state and auto-start; tunnels come back after a reconnect; clear errors for "port in use" and for a server that needs GatewayPorts.

Step 3.6 Tunnel UX. A plain-language form with a small path diagram (this PC:port, then server, then target); presets "Database" (MySQL 3306, PostgreSQL 5432, Redis 6379), "Web panel" and "Share localhost"; an "Open in browser" button for web tunnels.

Step 3.7 Tray. A tray icon with recent hosts, tunnel switches, Lock and Quit, plus a "close to tray" option.

Done when: a 1 GB file uploads and downloads with a matching checksum while I keep typing in the terminal; a SOCKS5 tunnel works as a browser proxy; tunnels return after a network drop; the tray switches work with the window closed.

Out of scope: built-in editor, save with sudo, system proxy switch.
