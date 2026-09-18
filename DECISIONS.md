# Decisions

Architecture and tooling decisions, newest at the bottom. Each entry records the context at the
time, the decision and what it implies. Revisit an entry by adding a new one that supersedes it;
do not rewrite history.

## 2026-09-18 — License: AGPL-3.0-only

Rhizom is licensed under the GNU Affero General Public License v3.0 (`LICENSE`). The network
clause fits a self-hostable tool: anyone offering Rhizom as a service must publish their
changes. Package manifests use the SPDX identifier `AGPL-3.0-only`.

## 2026-09-18 — Monorepo layout and package names

pnpm workspaces with `packages/core` (`@rhizom/core`: types, Markdown and link parsing, index
logic — no UI, no Node-only APIs so it can also run in the browser), `apps/server`
(`@rhizom/server`: Fastify REST API that also serves the built web app) and `apps/web`
(`@rhizom/web`: React SPA). `apps/desktop` is added in Phase 5. All packages are `0.0.0` and
private until the first release; `core` keeps `exports` pointing at `dist/` so it can be
published later without restructuring.

## 2026-09-18 — Package manager: pnpm 12, pinned, no Corepack

`packageManager` pins `pnpm@12.4.2`; pnpm's own `pmOnFail=download` keeps every pnpm ≥ 11.10
on that version, and CI uses `pnpm/action-setup@v6`, which reads the same field. Corepack is
not used (removed from Node 25+, and it cannot run pnpm 11+). All pnpm settings live in
`pnpm-workspace.yaml` (pnpm 11+ ignores everything else):

- `allowBuilds` decides dependency build scripts up front because pnpm 11+ fails the install
  on unreviewed ones: `esbuild` (needed by tsx) is allowed, `simple-git-hooks`' postinstall is
  not needed because the root `prepare` script installs the hooks.
- A strict `catalog` holds the version of every external dependency; package manifests only
  say `catalog:`, so one file shows all versions. `vitest` and `@vitest/coverage-v8` are
  pinned exactly and must be bumped together (the peer dependency is exact).
- `minimumReleaseAge` stays at pnpm's default (24 h). pnpm records exceptions it made during
  install in `minimumReleaseAgeExclude`; those lines are generated, keep them.

## 2026-09-18 — Node versions

`engines.node` is `^22.13.0 || ^24.0.0 || >=26.0.0`: ESLint 10 needs ≥ 22.13, Vitest 5
excludes Node 25 (EOL since June 2026), and pnpm enforces the root `engines` field on install.
CI runs Node 22 and 24 on all three operating systems; Node 26 joins the matrix once it becomes
LTS (2026-10-28). `@types/node` follows the 22 line so code cannot rely on newer APIs.
`.node-version` says `24` for developers.

## 2026-09-18 — TypeScript 6.0 rather than 7.0

TypeScript 7.0 (the native compiler) ships no JavaScript compiler API yet; typescript-eslint
8.70 supports `<6.1.0` and cannot load 7.0 at all, and editors still need `tsserver` from the
package. TypeScript 6.0.3 already has the 7.0 defaults (`strict`, `module: esnext`,
`types: []`, no `baseUrl`), so configs written now carry over. Revisit when TypeScript 7.1
publishes its API and typescript-eslint supports it; Microsoft's side-by-side alias
(`@typescript/native`) is the migration path if a faster `tsc` is wanted earlier.

## 2026-09-18 — TypeScript configuration

`tsconfig.base.json` turns on `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noUncheckedSideEffectImports`, `verbatimModuleSyntax`, `isolatedModules` and
`erasableSyntaxOnly` (no enums, namespaces or parameter properties, so every package could be
run by Node's type stripping or bundled without transforms). `target` is pinned to `es2024`
because TypeScript's default now floats upwards with each release.

Node packages use `module: nodenext`, so relative imports carry the `.js` extension; the web
app uses `module: esnext` + `moduleResolution: bundler`. `packages/core` and `apps/server`
have a solution-style `tsconfig.json` referencing a build project (`src`, tests excluded,
emits to `dist/`) and a test project (test files and `vitest.config.ts`; `noEmit`), which
keeps tests out of `dist/`. `apps/web` emits nothing (Vite bundles it), so its app project
includes the unit tests and a node project covers `vite.config.ts`, `playwright.config.ts` and
`e2e/`. Every TypeScript file belongs to exactly one project, which typescript-eslint's
`projectService` requires. The root `tsconfig.json` references all of them; `pnpm typecheck`
(= `tsc -b`) type-checks and emits in one go.

## 2026-09-18 — Lint and format

One ESLint 10 flat config at the root (`eslint.config.js`); packages never add their own,
because ESLint 10 stops at the nearest config. Rules: `@eslint/js` recommended, typescript-eslint
`recommendedTypeChecked` + `stylisticTypeChecked` with `projectService`,
`eslint-plugin-react-hooks` 7 (`flat.recommended`, which includes the React Compiler rules —
kept on purpose, they catch real bugs even without the compiler) and `eslint-plugin-react-refresh`
for `apps/web`, `eslint-config-prettier` last. Prettier: single quotes, semicolons, trailing
commas, 100 columns, prose wrap preserved. CI fails on warnings (`--max-warnings 0`) and on
unformatted files.

## 2026-09-18 — Tests

Vitest 5 with a root config that only declares projects (`core`, `server`, `web`, `tools`) and
the root-only coverage block. Coverage thresholds are keyed by a repo-relative glob so only
`packages/core` is gated at 80 % (lines, branches, functions, statements); the other projects
are reported. No DOM test environment yet: `apps/web` unit tests cover pure modules and run in
Node; jsdom (which raises the Node floor to 22.22/24.15) is added when component tests arrive.
Playwright lives in `apps/web` with a Chromium-only project; locally it starts the Vite dev
server, in CI it runs against `vite preview` of the production build. `--with-deps` is used on
all runners (it is a no-op on macOS).

## 2026-09-18 — Git hygiene

`simple-git-hooks` installs a `commit-msg` hook through the root `prepare` script, so it is
present after every `pnpm install`; CI sets `SKIP_INSTALL_SIMPLE_GIT_HOOKS=1`. The hook runs
`scripts/commit-msg/cli.mjs` with plain `node` (never `pnpm run`, which could trigger a
re-install loop). The rules in `check.mjs` are unit-tested. Header: Conventional Commits with
a fixed type list, a lower-case scope and a 100-character limit; git's own merge and revert
subjects pass; `fixup!`/`squash!` prefixes are stripped first. Attribution: every line is
checked after trimming (so indented `git merge --squash` bodies count), comment lines included
(`git commit -m` keeps them) and folded trailers joined; rejected are a robot emoji, a line
starting with "Generated with/by", and any `<key>-by:` trailer or credit phrasing ("written
with", "implemented with", …) that names an AI tool, a bot or "AI". Tool names that are also
ordinary words or first names (cursor, devin, codex, gemini) only count with context
(`Cursor Agent`, `@cursor.com`), so editor commits and human co-authors pass. The hook is a
safety net for what tools emit and for common credit phrasings, not a natural-language filter.

## 2026-09-18 — Server shape

Fastify 5 with a `buildApp()` factory (`apps/server/src/app.ts`) separate from the process entry
(`server.ts`), so tests use `app.inject()` without opening a port. The server serves the built
web app from `apps/web/dist` (when present) with a history-API fallback for GET/HEAD requests
outside `/api/*`; API routes always answer JSON, including 404s. Default port `3737` (chosen to
stay clear of the 3000/8080 crowd on self-hosted boxes), `HOST` defaults to `localhost` and is
`0.0.0.0` in the container. Blank environment values count as unset, and `PORT` must be a
plain integer between 1 and 65535. Logging is pino; the `pino-pretty` transport is used only
outside production, on a terminal, and when that development-only package is resolvable —
everything else gets JSON. Static files: hashed `assets/` are `immutable`, everything else is
`no-cache`, and a missing `/assets/*` file answers 404 instead of the fallback page. A second
SIGINT/SIGTERM exits immediately; a graceful shutdown is capped at ten seconds.

## 2026-09-18 — Web app and i18n

React 19 + Vite 8 (Rolldown/Oxc, no Babel, no React Compiler for now). All of `apps/web`'s
dependencies are devDependencies: the app is bundled, nothing is required at runtime.
Internationalisation uses i18next + react-i18next with bundled JSON resources
(`src/i18n/locales/<lang>/common.json`), English as default and fallback, German second, and
typed keys via `CustomTypeOptions`. Language detection is a ~25-line synchronous detector
(stored choice → `navigator.languages` → English) instead of `i18next-browser-languagedetector`,
which would add cookie handling and a dependency for two languages. The pure part
(`resolveLanguage`) is unit-tested; the switch is covered by a Playwright test.

## 2026-09-18 — Theming

Design tokens are CSS custom properties in `apps/web/src/styles/tokens.css`, prefixed `--rz-`.
Colours use `light-dark()` so each token is defined once for both themes; `color-scheme` on
`<html>` selects the variant: Humus (dark) is the default, `data-theme="kalk"` switches to the
light theme, `data-theme="system"` follows the operating system. Cluster colours for the graph
are eight tokens users can override later per folder or tag. The landing page shares the same
file.

## 2026-09-18 — Docker image

Two-stage `Dockerfile` on `node:22-bookworm-slim` (Debian, so native modules such as
better-sqlite3 have prebuilt binaries later): the build stage installs everything and runs
`pnpm run build`, then removes every `node_modules` folder and runs a fresh
`pnpm install --prod --ignore-scripts` from the stage's own store (installing `--prod` on top
of the full install would keep the dev packages as pnpm's orphan cache; `--ignore-scripts`
because the root `prepare` script needs `simple-git-hooks`, a devDependency). The runtime stage
copies only compiled output and `node_modules`, runs as the `node` user and has a health check
on `/api/health`. `pnpm deploy` is not used because its semantics changed in pnpm 10+ and the
plain copy is easier to reason about. `docker compose up` publishes the server on
`127.0.0.1:3737` by default — there is no login before Phase 4 — and `RHIZOM_BIND=0.0.0.0`
exposes it on the network; the vault volume is added in Phase 1 when the server reads it.

## 2026-09-18 — Landing page on GitHub Pages

A static page in `site/` (plain HTML and CSS, no framework, no external requests) shares the
design tokens with the web app: `scripts/build-site.mjs` copies `site/` plus `tokens.css` into
`dist/site`, and `.github/workflows/pages.yml` deploys that folder through the Pages artifact
flow. Pages is configured with source "GitHub Actions" (set via the API on 2026-09-18).

## 2026-09-18 — Contact channels

Security reports go through GitHub's private vulnerability reporting (enabled on the repository
on 2026-09-18); Code of Conduct reports go to the maintainer via GitHub. No e-mail address is
published in the repository.
