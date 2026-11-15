Read AGENTS.md first. We are in Phase 4 (Speed and automation, v0.4, public beta). Do the steps in order and stop after each one.

Step 4.1 Snippets. Create, edit and delete snippets with name, description and tags; variables written as {{name}} are asked for at run time; run from the palette, the sidebar or quick-action buttons on a host card; starter packs (Ubuntu, Docker, Nginx, systemd) shipped as JSON.

Step 4.2 Fleet run. Pick hosts by group or tag and run one snippet in parallel over exec channels (at most 10 at a time); one result card per host (exit code, duration, output); a "failed only" filter; re-run on failed hosts; an extra confirmation when any selected host is production.

Step 4.3 Broadcast and workspaces. Send typed input to all selected panes; save and restore a workspace (tabs, split layout, tunnels) by name, with an optional startup workspace.

Step 4.4 Watch. Per tab "notify me when": the command finishes (OSC 133 when shell integration is installed, otherwise a prompt-return heuristic), a text appears (regex), or output stays silent for N seconds. Windows notifications focus the tab on click.

Step 4.5 Capture. Opt-in session log to a text file; asciinema v2 recording with in-app replay; copy the selection as an image; regex highlight rules.

Step 4.6 Privacy and records. Privacy mode that masks host names, IPs and usernames in the sidebar, tabs, title bar and palette; a local connection history; secure notes per host with one-click copy; bulk edit of selected hosts; export to ssh config and CSV without secrets; a share file for a group (no secrets, or protected by its own password); copy a host as an ssh command or ssh:// link.

Step 4.7 Windows integration. Jump List with recent and favorite hosts (app.setJumpList); a global shortcut that shows the app or the palette; an ssh:// protocol handler that asks before connecting to an unknown host; start with Windows, hidden in the tray.

Done when: one snippet runs on 20 test hosts with separate results; a workspace restores 4 tabs and 2 tunnels in one click; clicking an ssh:// link opens a session after I confirm; privacy mode leaves no real host name visible in the app chrome.
