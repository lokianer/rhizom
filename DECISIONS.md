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

`engines.node` is `^22.22.0 || ^24.0.0 || >=26.0.0`: ESLint 10 needs ≥ 22.13, react-router 8
needs ≥ 22.22, Vitest 5 excludes Node 25 (EOL since June 2026), and pnpm enforces the root
`engines` field on install.
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

## 2026-09-18 — Phase 1: vault configuration

The server serves exactly one vault, configured by `RHIZOM_VAULT_DIR` (absolute, or relative to
the working directory). The Docker image sets `/vault` and docker-compose mounts `RHIZOM_VAULT` (default:
`./examples/vault`) there. In development, when the variable is unset and `NODE_ENV` is not `production`, the
server falls back to the repository's `examples/vault` and logs that it did. There is no folder
picker in the web UI in Phase 1: choosing arbitrary server paths from a browser without
authentication (Phase 4) would expose the host file system; the desktop app (Phase 5) gets a
native picker. Switching vaults means restarting with another path.

## 2026-09-18 — Phase 1: note identity and link resolution

A note is identified by its vault path: POSIX separators, relative to the vault root,
NFC-normalised, with extension (`Campaign/NPCs/Mira.md`). Paths must pass `isSafeVaultPath`
(no traversal, no characters or names Windows refuses) before anything touches the file
system. Only `.md`/`.markdown` files are notes; `.obsidian/`, `.trash/`, `.git/` and other
dot-folders are ignored; everything else under the vault is an asset that can be embedded and
served. Wikilinks resolve as in Obsidian: exact path (with or without extension,
case-insensitive) first, then a unique note name anywhere in the vault; an ambiguous name
prefers the source note's folder, then the shortest path, and is flagged as ambiguous.
Unresolved links keep the text as written; clicking one creates the note — bare names at the
vault root, folder paths as written. All of this lives in `packages/core` (`paths.ts`,
`wikilink.ts`, `resolve.ts`) so server and web share one behaviour.

## 2026-09-18 — Phase 1: index shape and rebuild strategy

SQLite holds only derived data: notes (path, name, title, folder, modification time, size,
content hash, frontmatter as JSON, word count), links (source, resolved target or null, raw
target, kind, alias, heading, line), tags, headings, and an FTS5 table over title and body for
search with snippets. The title is frontmatter `title`, else the first level-1 heading, else
the file name. The schema version lives in `PRAGMA user_version`; on a mismatch the database
file is deleted and rebuilt from the files instead of migrated — the index is disposable by
design (rule 2), which keeps migration tooling out of Phase 1. Indexing is incremental: a file
is re-parsed when its size or modification time differs from the stored values; a full rebuild
is available from the API. External changes reach the index through the file watcher,
debounced into batches.

## 2026-09-18 — Phase 1: REST API shape

Resources under `/api`: `vault` (info), `tree`, `notes` (list, create) and `notes/{path}`
(read, save, delete) with `backlinks`, `search?q=`, `tags`, `graph` and
`graph/local?path=&depth=`, `assets` (upload) plus read-only serving of vault assets,
`index/rebuild`, and `events` (server-sent events with index changes so open clients refresh).
Every route carries a JSON schema, from which the OpenAPI document is generated, committed to
the repository and served at `/api/openapi.json` with a UI at `/api/docs`. Errors always have
the shape `{statusCode, error, message}`. Request and response types live in
`packages/core/src/api.ts` so the web client and the server share them.

## 2026-09-18 — Phase 1: editing semantics

Saves are whole-document `PUT`s carrying the content hash the client loaded as `If-Match`; a
mismatch answers 412, so nothing written outside Rhizom is overwritten silently. The editor
autosaves with a short debounce. Files are written atomically (temporary file, then rename) and
keep the original line endings and byte order mark. Deleting a note moves it to `.trash/`
(Obsidian's convention) rather than removing it. Renaming and moving notes are not part of
Phase 1: doing it right means rewriting links across the vault, which is scheduled for Phase 2
together with unlinked mentions.

## 2026-09-18 — Phase 1: where the index lives

The SQLite file goes to `RHIZOM_DATA_DIR` (default `./data`, `/data` in Docker) as
`index.sqlite`, never into the vault. A vault is often a Git repository or a synced folder;
a database with a write-ahead log inside it would be committed or synced and would show up in
Obsidian as a stray file. Because the index is derived data, the folder can be deleted at any
time and is rebuilt on the next start.

## 2026-09-18 — Phase 1: no drizzle-kit, no migrations

Drizzle ORM provides typed queries; the schema itself is hand-written DDL in
`apps/server/src/store/database.ts`. drizzle-kit cannot express the FTS5 virtual table and its
triggers, and migrations are pointless for a database that is deleted and rebuilt whenever
`PRAGMA user_version` does not match.

## 2026-09-18 — Phase 1: live updates through server-sent events

Open clients learn about index changes from `GET /api/events` (server-sent events with
`indexed`, `removed` and `rebuilt` payloads and a heartbeat comment every 25 seconds) rather
than a WebSocket. The traffic is one-directional, `EventSource` reconnects on its own, and
plain HTTP passes reverse proxies without extra configuration.

## 2026-09-18 — Phase 1: the OpenAPI document is committed

`pnpm --filter @rhizom/server openapi` generates `apps/server/openapi.json` from the route
schemas, and a test fails when the file is stale. API changes therefore show up in pull
request diffs, and the document can be used by clients and tools without a running server.

## 2026-09-18 — Phase 1: the web app's own state

React Router 8 in data mode (`createBrowserRouter` plus `RouterProvider` from `react-router/dom`;
the `react-router-dom` package is gone in version 8) with two splat routes, `notes/*` and
`wiki/*`. Note URLs carry no `.md`: a URL that looks like a file is refused by the history
fallback of `vite preview` and of most static hosts, and the extension is added back with
`ensureMarkdownExtension`. Interface state (theme, sidebar, expanded folders, graph settings)
lives in a Zustand store persisted to localStorage; the vault data (notes, tree, tags) lives in
a second store that server-sent index events refresh. There is no data-fetching library: a
typed `fetch` wrapper over the contracts in `packages/core/src/api.ts`, with AbortController for
the searches and `If-Match` for the saves, is all Phase 1 needs, and a cache would be a second
source of truth next to the index.

## 2026-09-18 — Phase 1: editing and saving in the browser

The editor is CodeMirror 6 configured by hand (the `codemirror` meta package only re-exports a
fixed extension list). Live preview hides Markdown syntax except on the lines the selection
touches: a viewport-scoped view plugin for inline marks and line classes, and a state field for
anything spanning a line break, because CodeMirror refuses block decorations from a plugin.
Wikilinks are a Lezer inline parser rather than regular expressions, so `[[…]]` inside code
stays literal. Edits autosave after a short pause and flush when the note is closed; every save
carries the hash the document was loaded with, and a 412 offers reloading or overwriting.

## 2026-09-18 — Phase 1: wiki mode renders in the core package

`renderNote` (Markdown to sanitised HTML with the vault's links resolved) lives in
`packages/core`, not in the web app: the static export and the desktop app of later phases need
the same output, and the renderer must agree with the indexer about titles, headings and link
targets. The HTML is sanitised with rehype-sanitize and only the classes and data attributes
the renderer emits are allowed, so a note can hold raw HTML without it becoming live markup.

## 2026-09-18 — Phase 1: end-to-end tests run against a real server

Playwright starts an actual Rhizom server on a throwaway copy of `examples/vault`
(`apps/web/e2e/serve.mjs`), so the tests exercise the REST API, the index and the file writes
rather than a mock. In CI that server also serves the built web app, which covers the
production bundle and the history fallback; locally the Vite dev server proxies `/api` to it.

## 2026-09-18 — Phase 1: the graph layout runs in a worker

One force tick over a few thousand notes costs tens of milliseconds, and on the main thread
that froze the canvas for the whole time the layout took to settle. The simulation therefore
runs in a worker (`apps/web/src/graph/layout.worker.ts`), which sends positions back as a
transferable array; the page keeps the node objects it draws and hit-tests, and pinning a
dragged bubble is a message rather than a field assignment. Large fields also drop the
collision force and use a coarser Barnes–Hut approximation, which only the layout notices.

Measured on a vault of 5,000 generated notes (Chromium, 1440 × 900, device pixel ratio 2):
2,000 notes with 17,250 links draw at 107 fps while panning and 120 fps at rest; the full
5,000 notes with 43,293 links at 25–39 fps while panning. Caching the quiet part of the
picture as a bitmap and blitting it during a pan was tried and dropped: it makes the dense
case slower, because the copy of a viewport-sized bitmap costs more than redrawing the lines.
Note that headless Chromium rasterises the canvas in software and reports roughly a tenth of
these numbers, so it is no measure of how the graph feels.

## 2026-09-18 — Phase 1: a missing link opens the note, it does not write it

Clicking a link whose target does not exist navigates to that note and offers to create it,
rather than writing the file on the spot. A stray click in a vault of somebody's own notes
should not leave a file behind, and the path the link would create is worth seeing before it
exists. The same page appears when a URL points at a note that is not there, so the two ways
of arriving at a missing note look the same.
