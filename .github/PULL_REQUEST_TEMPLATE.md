## Summary

<!-- What does this change, and why? Link the issue it resolves, e.g. "Closes #12". -->

## How was it tested?

<!-- Unit tests, Playwright flows, manual checks on which OS. -->

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and are small and atomic
- [ ] Commit messages contain no tool attribution lines (`Co-Authored-By: <AI tool>`, "Generated with …") — the `commit-msg` hook enforces this
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] New core logic has unit tests; new user flows have a Playwright test
- [ ] Docs, `CHANGELOG.md` and (if an architecture choice was made) `DECISIONS.md` are updated
- [ ] No commented-out code, no TODOs without a linked issue
- [ ] Paths are platform-neutral (`path.join`, no hard-coded slashes)
