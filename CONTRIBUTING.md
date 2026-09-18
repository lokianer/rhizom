# Contributing to Rhizom

Thanks for your interest. Rhizom is in early development and follows a strict
[roadmap](ROADMAP.md); contributions that fit the current or next phase are the easiest to
review. Open an issue before starting anything larger than a bug fix so the approach can be
agreed first.

## Prerequisites

- Node.js 22.22+ or 24 (see `.node-version`)
- pnpm 12 — install it with `npm install -g pnpm@12.4.2` or the
  [standalone installer](https://pnpm.io/installation); the exact version is pinned in
  `package.json` and pnpm switches to it automatically once you have any pnpm ≥ 11.10
- Docker (optional, for the container build)

## Setup

```
git clone git@github.com:lokianer/rhizom.git
cd rhizom
pnpm install
pnpm --filter @rhizom/web exec playwright install chromium
```

`pnpm install` also installs the git hooks (see below).

## Everyday commands

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                          | core watch build, Fastify with `tsx watch`, Vite dev server — parallel |
| `pnpm test` / `pnpm test:watch`     | Vitest for all packages                                                |
| `pnpm test:coverage`                | Vitest with coverage; `packages/core` must stay ≥ 80 %                 |
| `pnpm e2e`                          | Playwright smoke tests for the web app                                 |
| `pnpm lint`                         | ESLint with type information; warnings fail                            |
| `pnpm typecheck`                    | `tsc -b` across all project references                                 |
| `pnpm format` / `pnpm format:check` | Prettier                                                               |
| `pnpm build`                        | Compile core and server, bundle the web app                            |
| `docker compose up`                 | Build and run the container on port 3737                               |

CI runs format check, lint, typecheck, unit tests with coverage, build, landing-page assembly
and Playwright on Ubuntu, macOS and Windows with Node 22 and 24, plus a Docker build with a
container smoke test on Ubuntu. Run the same commands locally before pushing.

## Branches and commits

- Work on a branch; `main` is always green.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `docs:`, `test:`, `chore:`, `ci:`, `build:`, `refactor:`, `perf:`, `style:`, `revert:` — with
  an optional lower-case scope such as `feat(core): …` and a header of at most 100 characters.
  Keep commits small and atomic.
- The `commit-msg` hook (installed by `pnpm install`, source in `scripts/commit-msg/`) rejects
  headers that do not follow the convention and any tool attribution line
  (`Co-Authored-By: <AI tool>`, "Generated with …", robot emoji). Do not bypass it with
  `--no-verify`, `SKIP_SIMPLE_GIT_HOOKS` or a changed `core.hooksPath`. Co-author trailers
  naming a human are fine.
- If a GUI git client reports `node: command not found` when committing, its `PATH` lacks your
  Node installation: point `SIMPLE_GIT_HOOKS_RC` at a file that exports the right `PATH`; the
  hook sources it before running.
- Commit messages, code, comments and docs are written in English.

## Code guidelines

- TypeScript strict; no `any`, no enums (`erasableSyntaxOnly`), no default exports except where
  a framework requires them.
- Relative imports carry the `.js` extension.
- Paths are platform-neutral: `path.join`, no hard-coded slashes. Globs in configs use forward
  slashes on every platform.
- `packages/core` must not depend on Node-only or DOM-only APIs; it runs in both.
- New core logic comes with unit tests next to the code (`*.test.ts`). New user-facing flows get
  a Playwright test in `apps/web/e2e`.
- UI strings go through i18next: add the English key in
  `apps/web/src/i18n/locales/en/common.json` (it drives the types), then the German one.
- Colours, spacing and type come from the design tokens (`apps/web/src/styles/tokens.css`);
  do not hard-code values that have a token.
- No commented-out code; a `TODO` needs a linked issue.

## Dependencies

Shared versions live in the pnpm catalog (`pnpm-workspace.yaml`). Larger new dependencies need
a short justification in the pull request and, if the choice shapes the architecture, an entry
in `DECISIONS.md`. pnpm blocks dependency build scripts until they are reviewed; if
`pnpm install` reports an unreviewed package, decide it with `pnpm approve-builds` and commit
the change to `allowBuilds`.

## Pull requests

Fill in the template. A pull request is ready when CI is green on all three operating systems,
tests cover the change, and `CHANGELOG.md` (under _Unreleased_), the docs and — for
architecture choices — `DECISIONS.md` are updated.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Security problems go through
[private vulnerability reporting](SECURITY.md), never through a public issue.
