Read AGENTS.md first. We are in Phase 6 (Polish and 1.0). Do the steps in order and stop after each one.

Step 6.1 First run. Onboarding in three steps (import, first host, first connection); searchable settings; every empty state and tooltip reviewed in both languages.

Step 6.2 Look and feel. Windows 11 Mica background and a title-bar overlay with integrated tabs; focus mode; always on top; import of Windows Terminal and iTerm color schemes.

Step 6.3 Accessibility. Full keyboard navigation, UI zoom, a high-contrast theme, the xterm.js screen-reader mode and visible focus rings.

Step 6.4 Performance. Measure cold start, memory with 20 tabs and typing latency; add a low-resource mode (dispose the renderers of hidden tabs, cap scrollback); fix the top three findings and record the numbers in docs/performance.md.

Step 6.5 More ways in. Importers for WinSCP, MobaXterm and CSV with column mapping; a portable build that keeps its data folder next to the exe and requires a master password.

Step 6.6 Security review. Go through the Electron security checklist item by item; verify fuses and ASAR integrity; audit dependencies; run the secret-leak tests; write a short threat model; fix or document every finding.

Step 6.7 Release. User docs in English and Persian, a project page, CONTRIBUTING and a translation guide, winget and Scoop manifests, the SignPath Foundation application with a "Code signing policy" page, and the 1.0 release notes.

Done when: the release checklist in docs/ROADMAP.md is fully ticked and no critical or high bug is open.
