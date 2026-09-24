# Rhizom — project instructions

Rhizom is a self-hostable, open-source tool for networked knowledge: a Markdown editor, a
local SQLite index derived from plain Markdown files, and a bubble-field graph in the style of
the Sinus-Milieu studies. Every vault becomes a navigable wiki. Audiences: the self-hosting
community, researchers, authors, D&D game masters.

## Non-negotiable rules

1. **Authorship.** The maintainer is the sole author. Never add `Co-Authored-By` trailers,
   "Generated with …" lines, bot signatures, emoji markers or any other attribution to commits,
   pull requests, the changelog or any file. The `commit-msg` hook enforces this; do not bypass
   it with `--no-verify`, `SKIP_SIMPLE_GIT_HOOKS` or a changed `core.hooksPath`.
2. **Files first.** The Markdown files in the vault folder are the source of truth. SQLite is a
   derived index (links, tags, frontmatter, full text) that can be rebuilt at any time. A vault
   must stay readable without Rhizom; an existing Obsidian vault (`.md` files with
   `[[wikilinks]]`) must open directly.
3. **Local and private.** No telemetry, no mandatory cloud, no third-party accounts.
4. **English in the repository** (code, comments, commit messages, docs). The UI is
   internationalised from the start: English default, German second.
5. **Conventional Commits**, one commit per finished slice (not per file or fix), no commit
   without green tests and clean lint.
6. Larger new dependencies only with a short justification beforehand.
7. Keep `ROADMAP.md` and `DECISIONS.md` current: assumptions and architecture decisions go
   into `DECISIONS.md`.

## Working with the maintainer

- **Language.** Chat in German; everything in the repository stays English.
- **Session handoff.** Read `HANDOFF.md` at the start of a session; rewrite it at the end and
  commit it with that session's work. Run prettier on it — it wraps code spans across lines.
- **Commits.** Few, larger commits; offer to squash when a phase ends with many. Subjects name
  the change plainly (`feat(tags): rename a tag across the vault`), not how it feels to use it;
  the body says what changed, then why, then what was deliberately left out. A history rewrite
  needs the maintainer's explicit choice of shape first.
- **Before every push**, run the CI sequence locally, in order: `format:check`, `lint`,
  `typecheck`, `test:coverage`, `build`, `site:build`, then `CI=1 pnpm e2e`. If a dev server
  holds 3737, set `RHIZOM_E2E_API_PORT=<free port>`; rebuild the web app first when the test
  server serves `apps/web/dist`.
- **Design.** Humus (dark) is the preferred theme and the one to judge readability in first.
  Secondary text stays ≥ 16 px in the brightened `--rz-text-muted`; no small italic text.
- **Agents.** Keep the fleet small: spawn only agents with a clearly separate task, stop what
  stalls, and check `git status` after research runs — they write downloads into the repo.
- **Shell traps on Windows.** Heredocs in the Bash tool mangle backslashes (`\n`, `\s`): use
  the Edit/Write tools for such text. `netstat` answers in German (`ABHÖREN`), so never grep for
  `LISTENING`; match `":3737"`, kill the PID in the last column, verify the port is free — a
  surviving dev server gets reused by Playwright and the e2e run tests the wrong vault.
- **Environment.** Node via nvm-windows, 24.x (25 is EOL and unsupported); pnpm is installed
  per Node version (`npm install -g pnpm@12`) after `nvm use`. Docker Desktop has to be started
  by hand before a Docker build.

## Working method

Work strictly in phases (`ROADMAP.md`). A phase ends with a runnable state, green CI on all
three operating systems, updated docs and clean commits — then **stop and wait for review**
before starting the next phase. Never pull features forward from a later phase.

Definition of Done for every phase: CI green on ubuntu/macos/windows; new core logic has unit
tests, every new user flow has at least one Playwright test; README/docs and `CHANGELOG.md`
updated; no commented-out code, no TODO without a linked issue; performance budget: 5,000-note
vault → search < 100 ms, graph smooth at 2,000 nodes, editor latency imperceptible.

## Stack (binding — deviations need a justification before building)

- pnpm 12 workspaces: `packages/core` (types, Markdown/link parser, index logic — UI-free,
  browser-safe), `apps/server`, `apps/web`, later `apps/desktop`.
- TypeScript strict everywhere (currently 6.0; see `DECISIONS.md` for why not 7), Node ≥ 22.22.
- Server: Fastify 5, better-sqlite3 + Drizzle ORM, SQLite FTS5, chokidar, REST API with an
  OpenAPI schema.
- Web: React 19 + Vite 8, CodeMirror 6, d3-force with Canvas rendering, Zustand, theming via
  CSS custom properties (`apps/web/src/styles/tokens.css`), i18next.
- Markdown pipeline: unified/remark with own plugins for `[[wikilinks]]`, `![[transclusion]]`,
  callouts, tasks, Mermaid.
- Tests: Vitest (coverage ≥ 80 % in `packages/core`), Playwright for every core user flow.
- CI: GitHub Actions matrix ubuntu/macos/windows × Node 22/24. Paths must be platform-neutral
  (`path.join`, no hard-coded slashes; globs in configs use forward slashes).
- Deployment: `Dockerfile` + `docker-compose.yml`, plus native start. Desktop later via
  Electron; the server must stay headless.
- License: AGPL-3.0-only.

## Commands

```
pnpm install            # also installs the git hooks (prepare)
pnpm dev                # core watch build + Fastify (tsx watch) + Vite, all in parallel
pnpm build              # tsc -b (typecheck + emit core/server) + vite build
pnpm typecheck          # tsc -b across all project references
pnpm lint               # eslint . (type-aware, warnings fail)
pnpm format             # prettier --write .   /   pnpm format:check
pnpm test               # vitest run (all projects)   /   pnpm test:watch
pnpm test:coverage      # enforces the packages/core threshold
pnpm e2e                # Playwright (apps/web); once: pnpm --filter @rhizom/web exec playwright install chromium
pnpm site:build         # assembles the landing page into dist/site
```

Server defaults: port 3737, `HOST=localhost`; env `PORT`, `HOST`, `LOG_LEVEL`, `NODE_ENV`
(blank values count as unset; pretty logs only on a terminal outside production).

## Conventions

- Relative imports in Node packages carry the `.js` extension (`module: nodenext`); the web
  app does the same for consistency.
- `erasableSyntaxOnly`: no enums (use `as const` objects), no namespaces, no parameter
  properties.
- Tests live next to the code as `*.test.ts`. In `packages/core` and `apps/server` they are
  excluded from the build project and type-checked by the test project; `apps/web` emits
  nothing (Vite bundles it) and type-checks its unit tests in the app project. Tooling files
  (`vitest.config.ts`, `vite.config.ts`, Playwright) belong to each package's test/node tsconfig
  so ESLint's project service can see them.
- Root `vitest.config.ts` owns coverage; per-package configs (`vitest.config.ts`, and
  `apps/web/vite.config.ts`, which doubles as one) only use `defineProject`.
- One `eslint.config.js` at the root; never add per-package ESLint configs.
- Every external dependency version lives in the pnpm catalog (`pnpm-workspace.yaml`); package
  manifests only say `catalog:`. `vitest` and `@vitest/coverage-v8` are bumped together.
- Design tokens: `--rz-*` custom properties with `light-dark()`; Humus (dark) is the default
  theme, `data-theme="kalk"` is light, `data-theme="system"` follows the OS.
- i18n: add keys to `apps/web/src/i18n/locales/en/common.json` first (it drives the types),
  then to `de/common.json`.

## Where things are documented

`ROADMAP.md` (phases and status), `DECISIONS.md` (why), `CHANGELOG.md` (what changed, Keep a
Changelog), `CONTRIBUTING.md` (how to work on it), `SECURITY.md` (private vulnerability
reporting via GitHub).
