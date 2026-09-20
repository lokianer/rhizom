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
starting with "Generated with/by", a trailer key that claims authorship (`Co-authored-by:`,
`Assisted-by:`, `Generated-by:`, `On-behalf-of:`, …) and a `[bot]` signature under any key.
`Signed-off-by:`, `Reviewed-by:` and `Reported-by:` pass: they say who vouches for a change or
who found the problem, not who wrote it.

The hook watches the shape of a trailer, not the language of a sentence. An earlier version
also weighed credit phrasings in prose, which meant carrying a list of product names in the
repository and getting the ordinary English of a commit body wrong; a body explains what was
done, and that is none of the hook's business.

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

## 2026-09-19 — Phase 2: one reserved frontmatter key, `type`

Definitions, templates, saved searches and axis definitions all need to say what a note _is_,
and that mark lands in files their owner also opens in Obsidian or a plain editor. Rhizom
reserves a single flat key for it — `type`, with the values `definition`, `template`, `query`
and `axes` — and keeps the keys Obsidian already established for the rest (`aliases`, `tags`).
Matching is case-insensitive on the trimmed string.

A namespaced `rhizom:` map would rule out every collision, but it is invisible to Dataview and
to anything else that reads frontmatter, and it is tedious to type by hand, which is the
opposite of what rule 2 asks for. A vault that already uses `type` for something of its own
loses nothing: a value Rhizom does not know simply means the note is of no special kind to it,
and no value is ever rewritten. Should a Rhizom-only key be needed later that does not describe
the kind of a note, it goes under a `rhizom:` map introduced at that point, not now.

## 2026-09-19 — Phase 2: a resolved embed is a graph edge of its own kind

Phase 1 left `![[Note]]` out of the graph, which was right while an embed was only a link that
looked different. Once transclusion pulls the target's text into the page, the two notes are
connected in the strongest sense the vault has, and a note that is only ever embedded would
otherwise sit in the field as an orphan while its content is on screen. Resolved note embeds
therefore count.

They carry their kind: `links.kind` already distinguishes `wikilink`, `embed` and `markdown`,
so the graph edge keeps that distinction instead of flattening it, and the field can draw or
filter embeds differently. File embeds (images, PDFs) stay out — they have no node. This is
also the groundwork for the typed relationships Phase 3 wants on edges.

One caveat on the count: `links.kind` records how a reference is _written_, and only a
standalone `![[Note]]` is actually transcluded — one inside running text renders as a link.
`GraphEdge.embeds` therefore counts embed-shaped references, which is what the field can filter
on; it is not a promise that each one pulled text onto the page.

## 2026-09-19 — Phase 2: milieu axes are defined in a note

The axes of the milieu view are named, described and bounded somewhere, and that somewhere is
an ordinary Markdown note with `type: axes` in its frontmatter — not `localStorage`, and not a
configuration file under a dotted folder inside the vault. Axes are part of what a vault means,
not a per-browser preference: they belong to the material, they should travel with it through
Git or Syncthing, and someone without Rhizom should be able to read and change them.

This does not reopen the Phase 1 decision about where the index lives. The index is derived and
disposable, so it stays out of the vault; an axis definition is authored content, so it stays
in. Keeping it a note rather than a `.rhizom/axes.yml` is the same choice templates and saved
searches make, which leaves one rule instead of three.

## 2026-09-19 — Phase 2: Mermaid and Vim mode, both loaded on demand

Rule 6 wants larger dependencies justified before they are built in. Two enter in Phase 2:
`mermaid` for diagrams in notes and `@replit/codemirror-vim` for the optional Vim mode.

`mermaid` is by a distance the heaviest thing in the tree — 172 kB gzipped, 1.45 MB across its
chunks, 23 transitive dependencies — and nothing else renders a diagram from text that people
already write in their notes. It is imported dynamically the first time a `mermaid` block is
rendered, so a reader who never opens a note with a diagram never fetches it; the app's 321 kB
first load does not move. Vim mode costs 74 kB with its core, is off by default and is imported
when it is switched on. Both are optional at runtime: the editor and the wiki work with the
packages absent, a diagram then staying the code block it is in the file.

## 2026-09-19 — Phase 2: the terms table, and what a schema bump costs

The title and aliases of every definition note are denormalised into a `terms` table rather
than read out of the `notes` rows they already sit in. Marking mentions runs on a path that
fires after every save, and the two shapes differ by an order of magnitude: a few hundred term
rows against the frontmatter and alias JSON of every note in the vault. The table carries only
`path`, `surface`, `folded` and `alias`; the tooltip's summary is read from `notes.body`, and
the matcher buckets by first word in memory, so neither needs a column.

That makes `INDEX_SCHEMA_VERSION` 2. A bump deletes the index file and rebuilds it
(`openDatabase`), which costs one vault scan on the next start and loses nothing — the Markdown
files are the vault. Later slices in this phase are designed without further DDL, but the
version is not only about DDL: the index is a cache of a parse, so a slice that changes what
`parseNote` reports bumps it too, because `syncVault` skips a file whose size and modification
time are unchanged and would otherwise serve the old answer forever.

## 2026-09-19 — Phase 2: block references are not part of it

`![[Note#^block-id]]` stays out. `parseWikilink` already reports a `blockId`, but nothing parses
the `^id` anchor that a block carries, `NoteLink` has no field for it and the `links` table no
column — and an anchor has to survive being moved, edited and copied, which is a larger job than
resolving a heading. Phase 2 transcludes `![[Note]]` and `![[Note#Heading]]`, as the roadmap
says, and a block reference renders as the link it is today.

## 2026-09-19 — Phase 2: a bulk sync resolves links once, not once per note

`upsertNote` used to re-resolve, for every note it wrote, every link in the vault that was still
unresolved. While a first build is running most links are unresolved — their targets have not
been indexed yet — so the work grew with the square of the vault: a generated vault of 5,000
notes and 47,000 links took 198 seconds, and `openVaultContext` awaits that build before the
server answers anything.

A full sync now passes `deferResolution` and calls `resolveAll()` once when the batch is in. The
answer is identical, because a link is resolved against the finished note index either way, and
the same build now takes about ten seconds. The watcher keeps the per-note path: for a single
saved note the targeted pass is the cheaper of the two.

This was found while measuring what the schema bump above costs a user, since that bump makes
every existing installation rebuild once.

## 2026-09-19 — Phase 2: the transclusion seam, and what may cross it

`![[Note]]` and `![[Note#Heading]]` render the note itself. Three things about how.

**The recursion lives in core, the fetching does not.** `renderNoteWithEmbeds` owns the ancestor
chain, the depth limit and the budget; the note bodies arrive through a synchronous `readNote`
hook that the app fills from its own cache. A body the app has not got yet is not an error: the
embed renders a "loading" placeholder and the app renders again when it arrives. That keeps the
renderer a pure function of what is currently known, which is what the editor's preview needs —
it renders the unsaved draft on every keystroke, and no server has ever seen that text. Rendering
on the server was considered and dropped for the same reason.

**The cycle key is the note _and_ the heading.** Two sections of one note side by side is the
ordinary map-of-content case and must work; only a reference that is already its own ancestor is
a cycle. Every render also carries an id prefix, because a transcluded note brings its headings
and footnotes into the host page and two notes may well share a heading; the reported `headings`
stay the host's, so an outline lists what the reader wrote, not what the reader pulled in.

**Only `renderNote` may produce embedded HTML.** The bodies are inserted after `rehypeSanitize`
and stringified with `allowDangerousHtml`, so whatever reaches `fillEmbeds` is written into the
page untouched. `EmbedResult.ready` is therefore the one state carrying HTML; every other state
carries a label that is rendered as ordinary text. A later feature that wants to put something
else there — a query result, say — builds mdast and goes through the sanitiser like everything
else. Widening that seam would turn a tool whose whole point is opening somebody else's vault
into stored cross-site scripting.

Block references (`![[Note#^id]]`) stay out of Phase 2, as recorded above: `renderNoteWithEmbeds`
returns undefined for one, which leaves it the link it has always been rather than transcluding
the whole note it happens to point into.

## 2026-09-19 — Phase 2: a heading reads as the reader sees it

`## See [[Silverstadt|the city]]` used to report its text as `See Silverstadt|the city` and slug
to `see-silverstadtthe-city`, because the flattener hands back a wikilink's raw value. It now
reads `See the city`, which is what the page shows, what Obsidian slugs and therefore what an
anchor already written in a vault points at.

Three kinds of heading read differently now: one containing a wikilink, one containing an image
(its alt text counts), and one containing a run of whitespace, a tab or a non-breaking space,
which now collapses to a single space. The last is the one that matters most, because a
reference is usually the heading copied verbatim: `headingSlug` is the single function every
heading id, `#fragment` href and `![[Note#Heading]]` goes through, so a slug written one way and
read the other cannot drift apart again. `INDEX_SCHEMA_VERSION` is bumped with it, because the
stored headings are a cache of the old parse.

## 2026-09-19 — Phase 2: the glossary is a view, and a term explains itself in place

The glossary is generated from the index, not written into the vault as a note. A vault that
carried a glossary file would have two truths about what it defines, and the file would be wrong
the moment a definition is renamed or deleted; rule 2 says the Markdown files are the source, and
a generated list is not a source. The page is therefore a route, not a document, and anything
that wants the glossary in a file exports it.

A mention says what it means through the `title` attribute in the rendered HTML and through a
CodeMirror hover tooltip in the editor. Both read the same summary, which arrives with the
glossary, so hovering fetches nothing: a tooltip that has to go to the server first is a tooltip
that appears after the reader has moved on. The summary is the defining note's first block,
computed in `packages/core` so the glossary, the tooltip and the marks cannot disagree about it.

There is one endpoint, not two. `GET /api/glossary` returns one entry per definition note, and
`glossaryTerms` expands an entry into the names it answers to; a separate term list would have
been the same data with the summary repeated once per name — 1,268 kB against 171 kB on a vault
of 300 definitions with nine names apiece, reloaded after every save.

Marks are deliberately quiet — a dotted underline, no colour — because in a vault with a full
glossary most sentences hold one. A term is not marked inside a link, a code span, a wikilink or
the frontmatter, and never inside the note that defines it: a word already carrying one
affordance does not get a second, and reading the definition of a word is not a mention of it.

## 2026-09-19 — Phase 2: the batch that writes other people's notes

"Link all" is the only thing in Rhizom that writes several files at once, and the only thing
that writes a file the reader is not looking at. Three rules hold it in.

**Every file carries the hash it was read at, and the hash is mandatory.** `PUT /api/notes/*`
accepts a missing `If-Match` and overwrites; a batch writer must not inherit that habit, because
the mistake it makes is multiplied by the number of files. The hash does double duty here: it
also says the file is character for character what the browser scanned, which is what makes the
offsets it sends back safe to cut at.

**A file that changed meanwhile is reported, not refused.** One stale note comes back as
`skipped: { reason: 'conflict' }` while the other nine are written, rather than a 412 that fails
the batch. The alternative — all or nothing — means one background save can block a reader from
doing anything, and the reader cannot tell which file was the problem.

**Candidates come from the full-text index, not from reading the vault.** A panel opening must
not read five thousand files. Full-text is a coarser filter than the term matcher — it tokenises
and folds differently — so it may hand back a note holding no mention after all, which the scan
then drops; what matters is that it never misses one, so the terms are ANDed within a name and
ORed between names, with no prefix matching. The candidate set is capped and the answer says when
it was.

The undo story is Git, or the file itself. `.trash` catches deletes only, and nothing in Rhizom
restores a rewrite — which is why the mentions are listed one by one with the line each sits in,
ticked individually, and why a mention inside a heading is marked as such: linking it changes
the heading's text and with it every `#anchor` and `![[Note#Heading]]` pointing at it.

## 2026-09-19 — Phase 2: what a written link is allowed to look like

Reading a link is forgiving; writing one is not. Three rules follow from that.

**Inside a table cell the alias separator is written `\|`.** A bare `|` ends the cell: the row
gains a column, GFM drops the last one, and the link is torn in half with nothing to show for
it. Obsidian requires the same backslash there, so this is its convention rather than ours —
and `parseWikilink` now strips it, because the backslash belongs to the table, not to the note's
name.

**A note whose name holds `#`, `|`, `[` or `]` is not linked at all.** The wikilink syntax
spends those characters on something else, so writing the name would point the link at a
different note, or at none. The mention stays as it is; a syntax that cannot say what we mean is
not one to guess with.

**An ambiguous name is written as a path.** Where two notes share a name, the one a bare link
lands on depends on which folder the link stands in and on what else the vault holds. That the
tie breaks towards the right note today is not a reason to write the short form: the day a
namesake is added, every such link quietly starts pointing elsewhere.

The scan is driven by the other notes in the vault, not by the one being edited: typing in the
open note cannot add a mention of it to somebody else's file, so its own saves do not trigger a
rescan — a full-text query plus up to two hundred file reads is not something to do between
keystrokes. And a mention that has been offered once keeps whatever answer it was given, because
a scan can run again for reasons the reader had nothing to do with, and a batch that re-ticks
the boxes they unticked would write the very notes they took out of it.

## 2026-09-19 — Phase 2: a template is a note in a folder

A template could be a note marked `type: template`, and the reserved vocabulary has had that key
since definitions shipped. It is not what this vault does. The two templates in Rhizom's own
example vault carry `type: npc` and `type: session` — the type of the note they _produce_, not of
themselves — and so does every Obsidian vault, because Obsidian's Templates plugin keys on a
folder. A rule on the frontmatter would find neither of them, and the key would copy itself into
every note made from one. So the folder decides, and `type: template` stays reserved and unused
for now.

Which folder, in order: the operator's `RHIZOM_TEMPLATE_DIR`, then the vault's own
`.obsidian/templates.json`, then a top-level folder called Templates in whatever case the vault
spells it. Reading that one file is not indexing `.obsidian/` — no note comes out of it — but it
is the difference between a vault that brings its templates along and one that silently has none.
Its `dateFormat` and `timeFormat` come along too: the same template has to write the same date in
both programmes.

The placeholder syntax is Obsidian's for the same reason: `{{title}}`, `{{date}}`, `{{time}}`,
each with an optional Moment format. Rhizom adds `{{roll:2d6+3}}`, `{{path}}` and `{{cursor}}`,
which Obsidian will insert as dead text — a fair trade for a menu that stays useful. Templater's
`<% %>` is never evaluated and never will be: it is JavaScript out of somebody else's vault, the
same door the renderer keeps shut on embedded HTML.

Three rules keep expansion from being a corruption. It happens **once**, when the text is
inserted, so a note stays the file on disk rather than something that reads differently tomorrow.
It leaves **code** alone, because `B{{date}}` is a hexagon in a Mermaid diagram and a code span is
the only way to write a placeholder literally. And it leaves **anything it does not understand**
exactly as it stands — an unknown name, an empty format, a malformed roll — because writing
nothing in their place is a deletion nobody typed.

Templates are otherwise ordinary notes: indexed, searched, in the graph, and as eligible for
"Link all" as any other. A template that names a place by name is a template that produces linked
notes, and that is the point.

## 2026-09-19 — Versions: 0.x until the end of Phase 5

Everything up to and including Phase 5 carries a `0.x` number. Not modesty: the vault format is
still moving. A reserved frontmatter key, the shape of a GM-only block, what a tie in the
frontmatter looks like — each of those is something a vault will carry for years, and each is
still being decided. A `0.x` says so honestly, and every move in that stretch is written into the
changelog.

The end of Phase 5 is 1.0. From there the files are a promise: what Rhizom writes into a vault
changes only with a documented migration, and a vault written by 1.0 opens in every 1.x. The
index keeps its own rule and is exempt — it is derived, it is thrown away and rebuilt, and its
schema version has nothing to do with the version on the box.

## 2026-09-19 — The notes have one door

`/api/assets/*` served the vault folder statically, and a folder of Markdown files served
statically is a folder of Markdown files served: `GET /api/assets/Home.md` answered with the note,
although `GET /api/assets` — the listing beside it — leaves notes out by definition.

Today that leaks nothing, because `/api/notes/*` hands out the same file to anybody who asks and
the whole tool runs on one person's machine. It is still wrong, and it gets worse on a schedule:
Phase 3 puts sections in a note that the wiki may not show, Phase 4 puts a lock on folders and a
publish flag on notes. Every one of those is a decision made where notes are read, and a second
route that reads the same bytes without asking is a way around all of them.

The static route now refuses `.md` and `.markdown`. One door to the notes, and it is the one that
will be asked who is knocking.

## 2026-09-19 — A note leaves as it arrived (superseded the same day, see below)

Rhizom writes UTF-8. It does not read only UTF-8, and the difference is somebody's notes.

A file saved as UTF-16 — which a Windows editor still offers, and which a vault carried across
decades will contain — was read as UTF-8: a row of NUL bytes and mojibake where the text should
be. That alone would be a display bug. The autosave made it a loss: the mojibake was written
back, as UTF-8, over the file it came from.

The encoding is now read from the byte order mark and kept beside the line ending and the mark
itself, which the writer already preserved. UTF-16, in either byte order, is decoded on the way
in and written back the way it came. Nobody asked for a conversion, so nothing is converted; a
vault that arrives in one shape leaves in that shape. Converting a whole vault to UTF-8 is a
thing a person might want one day, and then it is a thing they will ask for.

## 2026-09-19 — An empty folder is not an empty vault

A full scan removes from the index every note it no longer finds. That is right when somebody
deleted the notes, and it is a fright when the folder is a mount point whose mount did not come
back: the share is gone, the directory underneath it is still there and reads as empty, and the
index — which knew five thousand notes a moment ago — is emptied to match.

Nothing is lost on disk, and the index is rebuilt from the files at any time. What would be lost
is the user's afternoon, and worse: a note written into what looks like an empty vault lands in
the mount point and shadows the real share when it returns.

So a scan that finds nothing at all, in a vault the index knows notes for, removes nothing and
says so in the log. Removing everything stays possible — it is what an explicit rebuild does.
The watcher is not affected: it reports the notes that actually went away, one by one.

## 2026-09-19 — Every note ends up UTF-8

The entry above kept a note in whatever encoding it arrived in. That is one decision too
careful. A vault is a folder other programmes read — an editor, a grep, a backup, a static site
builder — and the one encoding all of them agree on is UTF-8. Keeping a UTF-16 note UTF-16
preserves a property nobody asked for and leaves the vault mixed for ever.

So: read everything, write UTF-8. A note saved as UTF-16 is decoded properly on the way in —
that part of the fix stands, because reading it wrong was destroying text — and the first time
it is saved it becomes UTF-8, without a byte order mark. The text carries over whole; only the
spelling of the bytes changes. A UTF-8 file that has a mark keeps it, because that one is
already UTF-8 and some Windows tools look for it.

Umlauts and emoji are the same question asked twice. Both are ordinary text in UTF-8, and both
have to survive every hop: the file, the index, the editor, a note's own name. An emoji is two
code units in UTF-16 and up to four bytes in UTF-8, a flag is two of those, and a family is
several joined with a zero-width joiner — which is why the slash menu matches on code points
rather than on letters, and why the tests carry `🌱`, `🇩🇪` and `👨‍👩‍👧` rather than a polite
`é`.

## 2026-09-20 — A rename decides by resolving, not by the link table

The index records every link a note makes and, where it leads, the path it resolves to. What it
does not record is _how_ it got there — whether the link named a path, a note's name or one of
its aliases. That missing word is the whole difficulty of renaming: `[[Mira]]`, `[[People/Mira]]`
and `[[The Ledger-Keeper]]` all lead to the same file and none of them means the same thing when
the file moves.

So the `links` table only hands out candidates: the notes that mention this one. The decision is
taken by resolving every reference again, twice — once against the vault as it is, to see whether
the link really leads here and by what route, and once against the vault as it would be, to see
whether it would still. Two rules fall out of the second pass:

- **A link that arrived through an alias is left alone.** An alias is a word the reader chose; it
  has nothing to do with the file's name, and replacing it with a path would replace their
  sentence with a file system.
- **A short `[[Mira]]` that still finds the note afterwards is left alone.** Name resolution is
  folder-blind, so moving a note into an archive usually touches no other file at all. This is
  what keeps the dry run short enough to actually read.

The preview promises exact text at exact hashes and goes stale the moment anyone else writes, so
the write re-reads, re-parses and decides again from scratch; the hashes are a gate, never a cut
point. And the order is fixed: rewrite every file, then move the note, then index once. Only that
order survives a failure halfway, because the note is still at its old path and the identical
request finishes the job.

What is deliberately not done: folders and assets are not renamed, the note's own `title:` and
`# H1` are not touched (the file name and the note's name are two different things, and the
preview says which one the title follows), nothing is left behind at the old path — no stub, no
alias, no copy in `.trash` — and there is no per-file opt-out, because leaving a file out means
leaving a dangling link on purpose.

## 2026-09-20 — What a rename cannot see, it says so about

Reference definitions (`[ref]: People/Mira.md`), raw HTML, links inside HTML comments and
`..`-relative Markdown links never become link nodes in the parser, so they are not in the index,
not in the preview and not rewritten. They cannot even be counted: counting them would mean a
second parser with its own idea of what a link is.

A rename therefore states in one sentence that those forms are left as they are, rather than
implying a completeness it does not have. Finding them belongs to a "links this vault has lost"
report, which is a Phase 6 vault-health problem and wants to be solved once for the whole index
rather than once for this dialog.

One more thing a rename cannot see: a move can change what _other_ links mean without touching
them, because an ambiguous name is broken by folder proximity. The cheap version of that warning
ships — the notes sharing a name with either end of the move are listed — and the expensive
version, resolving the whole link table twice, does not.

## 2026-09-20 — A query block is read, never run

A vault is a folder that can come from anywhere: a shared repository, a colleague's archive, a
template somebody published. Opening one must never be the moment it starts executing something.
So a `rhizom-query` block is a closed set of ten keys with literal values — no expressions, no
function calls, no regular expression supplied by the note, no dotted field path that walks into
an object. A key nobody knows is reported with its line, not guessed at.

That is also why the parser is generous everywhere the meaning is unambiguous and strict
everywhere it is not. `LinksTo` and `linksTo` are the same word. `limit: "50"` is fifty. But a
`where` key holding a dot is refused, an out-of-range limit keeps the default rather than being
clamped to something nobody asked for, and a folder above the vault root is refused rather than
quietly matching nothing.

A block that is partly wrong still answers. The rows are what could be read and the problems are
what could not, each with its line; showing both is more useful than an empty box, and a reader
who mistyped one key can see which one.

Two implementation decisions worth knowing:

- **The filters split between SQL and JavaScript.** Folder, tag, title and `linksTo` go into the
  query, because they cut the row set down before anything is read. Type and `where` need the
  note's frontmatter, which is a JSON column, so they are decided over what is left — from the
  same parsed values the columns then render.
- **`created` is the note's own `created:` field**, not a file system timestamp. A birth time is
  a lie after any copy, checkout or sync, and keeping one in the index would cost every
  installation a rebuild for a sort key. A note that declares none sorts last, either way round.

## 2026-09-20 — SQLite lowercases ASCII and stops there

`lower()` in SQLite folds `A`–`Z` and leaves everything else alone, so `Über` stays `Über` and
any case-insensitive comparison quietly fails in a vault that is not written in English. Rhizom
is English in the repository and German second in the interface; a German vault failing to find
its own folders would be the kind of bug that never gets reported, only lived with.

So the index registers `rz_lower`, backed by JavaScript's `toLowerCase`, which knows the whole of
Unicode, and every case-insensitive comparison in SQL goes through it. It is declared
deterministic, so SQLite may use it wherever it would use its own. Full-text search is not
affected: FTS5's `unicode61` tokeniser already folds properly, which is why search has always
found `Über` and a query block would not have.

## 2026-09-20 — The frontmatter form rewrites keys, not blocks

A note's frontmatter is the user's YAML, in the user's file. It can hold comments, blank lines,
a deliberate key order, block scalars, quoting somebody chose. Reading it into an object and
writing that object back would be the obvious implementation and would destroy all of that on the
first save — silently, on a file nobody was looking at.

So the form replaces the value span of the keys it changed and nothing else. Everything outside
those spans is copied through character for character. A key that is not there is appended at the
end of the block; a key set to nothing is removed with its line; a block nobody can parse is
reported and left completely alone, because rewriting a file whose head no parser understood is
how notes get destroyed.

Two smaller decisions follow from the same rule. A nested mapping is shown read-only with a
sentence saying why, rather than flattened into boxes it does not fit. And values are written as
YAML 1.1 although Rhizom reads 1.2, because 1.1 is what Obsidian and Python use and it is the
stricter of the two about bare words: `yes`, `no`, `on` and `1:30` come out quoted and stay
strings in every reader the vault will meet.

The form is folded away to start with. The frontmatter is already in the note, three lines above
the cursor — the form is there to edit it, not to read it, and a panel open by default would take
a third of the page from the text the reader came for.
