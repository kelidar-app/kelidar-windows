## What this changes

<!-- What changes for the user, and why. Link the issue: Fixes #123 -->

## How to test it

<!-- Steps a reviewer can follow by hand. -->

## Checklist

- [ ] The pull request title follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix: ...`); it becomes the changelog line
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass
- [ ] New UI strings are in both `en.json` and `fa.json`, and the layout works right to left
- [ ] No secret (password, key, passphrase) can reach the renderer, logs or error messages
- [ ] Screenshots for visible changes
