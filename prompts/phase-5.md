Read AGENTS.md first. We are in Phase 5 (Toolbox and standout features, v0.5). Every tool here runs plain commands over an exec channel on the existing connection, shows the exact command, installs nothing, and explains what is missing when a command does not exist. Test each step on Ubuntu, Debian, AlmaLinux and Alpine. Do the steps in order and stop after each one.

Step 5.1 Status bar and Server Card. CPU, memory, disk, load and uptime read from /proc and df every few seconds, only while visible; a Server Card (OS, kernel, cores, RAM, disk, IP addresses) cached on the host; a disk-space alert threshold.

Step 5.2 Panels. Processes (sort, kill with confirmation); Services (systemd status, start, stop, restart, recent logs); Docker (containers, start, stop, logs, shell inside a container); Log viewer (tail -F or journalctl -f with a text filter and pause).

Step 5.3 Listening ports. List services from ss -tlnp (fall back to netstat) and offer a one-click local tunnel with "Open in browser".

Step 5.4 Connection Doctor. On failure, or on demand, test DNS, then the TCP port, then the SSH banner, then key exchange and algorithms, then authentication; show which step failed and how to fix it; include a per-host "legacy algorithms" switch for servers that only offer old ones.

Step 5.5 New-server setup wizard. A checklist: create a sudo user, install a key, disable password login, optionally change the SSH port, enable ufw with SSH allowed, turn on unattended upgrades. Each step previews its commands. Anti-lockout: keep the current session open, schedule an automatic rollback of sshd_config on the server, verify that a brand-new connection works, then cancel the rollback.

Step 5.6 Access audit. Read authorized_keys per host, label known keys, flag unknown ones, and add or remove one key across selected hosts after a dry-run preview.

Step 5.7 Renewal and cost. Renewal date and monthly cost per host, reminder notifications N days before, a monthly total view, Jalali dates when the UI language is Persian; an opt-in online and latency indicator in the host list (TCP connect time, rate-limited).

Step 5.8 Extras. A built-in editor for small files with syntax highlighting; "Save with sudo" (write through sudo tee after confirmation); download a folder as a tar.gz created on the server; a Windows system proxy switch for an active SOCKS tunnel that restores the previous setting on stop and on exit.

Done when: every panel works, or explains what is missing, on the four test distributions; the wizard survives three failure drills (wrong key, sshd fails to restart, firewall blocks the new port) without losing access; the doctor names the failing step for five simulated faults.
