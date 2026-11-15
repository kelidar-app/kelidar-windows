# Helper prompts

Four prompts that are useful in every phase. Fill in the parts written as `<...>` before sending.

## Bug fix (رفع باگ)

```text
Read AGENTS.md first. Bug: <what happened>. Expected: <what should happen>. Steps to reproduce: <1, 2, 3>. Logs or screenshot: <paste here>.
First reproduce it with a failing test, or explain why a test is not possible. Then find the root cause and explain it in two sentences before changing any code. Fix it with the smallest change, run typecheck, lint and tests, and tell me how to verify it by hand. Do not refactor unrelated code.
```

## End-of-phase review (بازبینی پایان فاز)

```text
Read AGENTS.md first. Review everything changed since tag <tag> as a strict senior reviewer. Check in this order: (1) any path where a secret could reach the renderer, a log or the disk unencrypted; (2) IPC handlers without sender or schema validation; (3) Electron security settings that changed; (4) hard-coded UI strings or CSS that breaks RTL; (5) missing tests; (6) dead code and needless dependencies. Report findings as a table: severity, file, problem, suggested fix. Do not change code until I choose what to fix.
```

## New feature (افزودن قابلیت جدید)

```text
Read AGENTS.md and docs/FEATURES.md first. I want to add: <feature>. Before coding, answer four questions: which simplicity rule could it break, and how do we keep it hidden until it is needed; what data model and IPC changes does it need; what could go wrong for security; how do we test it. Propose the smallest useful version, wait for my OK, then build it step by step.
```

## Electron upgrade (ارتقای Electron)

```text
Read AGENTS.md first. Upgrade Electron to the latest stable major, one major at a time. For each major: read its breaking changes, update the code, run all tests, walk through the manual smoke list (connect, split, SFTP transfer, tunnel, update check) and summarize what changed.
```
