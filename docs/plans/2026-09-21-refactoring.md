# Pre-Phase-3 Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the tree so that Phase 3 can make the vault index vault-aware without wading
through a 540-line class, a flat 24-module package and two collected stylesheets.

**Architecture:** Five independent slices, each a commit. `packages/core` is grouped along the
layer axis `text <- syntax <- vault <- query <- render`, which its imports already follow. The
three longest core modules are cut along the seams their own function groups already have.
`VaultIndex` keeps every public method and becomes a facade over `store/index/`. The web app
separates what frames the application from what a route renders. The two collected stylesheets
become `@import` barrels over per-area files.

**Tech Stack:** pnpm 12 workspaces, TypeScript 6 strict with `module: nodenext` and
`erasableSyntaxOnly`, Fastify 5, Drizzle + better-sqlite3, React 19 + Vite 8, Vitest, Playwright.

**Spec:** `docs/specs/2026-09-21-refactoring.md`

## Global Constraints

- **Strictly behaviour-preserving.** No REST response, rendered HTML, CSS cascade, i18n key or
  `@rhizom/core` export changes. No dead code removed, no helper merged, no signature changed.
- **Existing tests are the safety net.** No new test is written. The only edit inside a test file
  is an import path. A test whose body needs changing means the refactoring went wrong — stop
  and say so rather than editing the assertion.
- **Relative imports carry the `.js` extension** (`module: nodenext`); the web app does the same.
- **No enums, no namespaces, no parameter properties** (`erasableSyntaxOnly`).
- **Tests live next to the code** as `*.test.ts`; a test moves with the module it tests.
- **Paths must be platform-neutral**: `path.join`, no hard-coded slashes; globs in configs use
  forward slashes.
- **Conventional Commits.** No `Co-Authored-By`, no "Generated with", no bot signature, no emoji
  marker — in any commit, file or changelog entry. Never bypass the `commit-msg` hook.
- **Every commit is green** on `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm e2e` before
  the next task starts.

---

## Task 0: Record the baseline

The two checks the test suites cannot make need a "before" to compare against.

**Files:**

- Create: `../scratch/openapi-before.json` (outside the repo, not committed)
- Create: `../scratch/css-before.txt` (outside the repo, not committed)

**Interfaces:**

- Consumes: nothing
- Produces: two baseline files every later task's verification step compares against

- [ ] **Step 1: Confirm the tree is clean and green**

```bash
git status --short
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `git status --short` prints nothing; all three commands exit 0.

- [ ] **Step 2: Record the published contract**

`apps/server/openapi.json` is tracked, so regenerating it now proves the generator and the
committed file already agree.

```bash
pnpm --filter @rhizom/server run openapi
git diff --exit-code apps/server/openapi.json
```

Expected: exit 0, no diff. If this fails before any refactoring, the baseline is already broken —
fix that first, in its own commit.

- [ ] **Step 3: Record the emitted CSS**

```bash
pnpm --filter @rhizom/web run build
ls apps/web/dist/assets/*.css
```

Write down the file name (it carries a hash of the content) and copy the file somewhere outside
the repo. Vite names the file after a hash of its content, so an unchanged name after Task 5 is
itself the proof that the cascade did not move.

- [ ] **Step 4: No commit**

Task 0 produces no repository change.

---

## Task 1: Group `packages/core` into layers

Pure moves. Not one function body changes; only file locations and the relative imports between
them.

**Files:**

- Move (with each module's `*.test.ts` beside it):

| From `packages/core/src/` | To `packages/core/src/`     |
| ------------------------- | --------------------------- |
| `lines.ts`                | `text/lines.ts`             |
| `fuzzy.ts`                | `text/fuzzy.ts`             |
| `wikilink.ts`             | `syntax/wikilink.ts`        |
| `remark-wikilink.ts`      | `syntax/remark-wikilink.ts` |
| `parse.ts`                | `syntax/parse.ts`           |
| `section.ts`              | `syntax/section.ts`         |
| `callout.ts`              | `syntax/callout.ts`         |
| `tasks.ts`                | `syntax/tasks.ts`           |
| `tagrefs.ts`              | `syntax/tagrefs.ts`         |
| `linkrefs.ts`             | `syntax/linkrefs.ts`        |
| `template.ts`             | `syntax/template.ts`        |
| `paths.ts`                | `vault/paths.ts`            |
| `markdown.ts`             | `vault/markdown.ts`         |
| `frontmatter.ts`          | `vault/frontmatter.ts`      |
| `terms.ts`                | `vault/terms.ts`            |
| `resolve.ts`              | `vault/resolve.ts`          |
| `mentions.ts`             | `vault/mentions.ts`         |
| `axes.ts`                 | `vault/axes.ts`             |
| `graph.ts`                | `vault/graph.ts`            |
| `query.ts`                | `query/language.ts`         |
| `query-blocks.ts`         | `query/blocks.ts`           |
| `render.ts`               | `render/note.ts`            |
| `embed.ts`                | `render/embed.ts`           |
| `query-view.ts`           | `render/query-view.ts`      |

- Stay at the root: `index.ts`, `api.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/api.ts`

**Interfaces:**

- Consumes: nothing
- Produces: the layer folders every later core task writes into. The export list of
  `packages/core/src/index.ts` is unchanged, so `apps/server` and `apps/web` see nothing.

- [ ] **Step 1: Confirm nothing imports into core more deeply than the barrel**

```bash
grep -rn "@rhizom/core/" apps packages --include=*.ts --include=*.tsx --include=*.json | grep -v node_modules
```

Expected: no output. `packages/core/package.json` exposes only `"."`, so every consumer goes
through `src/index.ts` and the move is invisible to them. If this prints anything, stop: a deep
import means the move is not invisible and this plan's Task 1 is wrong.

- [ ] **Step 2: Create the folders and move the files with git**

`git mv` rather than a plain move, so the history follows the file.

```bash
cd packages/core/src
mkdir -p text syntax vault query render

git mv lines.ts lines.test.ts text/
git mv fuzzy.ts fuzzy.test.ts text/

git mv wikilink.ts wikilink.test.ts syntax/
git mv remark-wikilink.ts syntax/
git mv parse.ts parse.test.ts syntax/
git mv section.ts section.test.ts syntax/
git mv callout.ts callout.test.ts syntax/
git mv tasks.ts tasks.test.ts syntax/
git mv tagrefs.ts tagrefs.test.ts syntax/
git mv linkrefs.ts linkrefs.test.ts syntax/
git mv template.ts template.test.ts syntax/

git mv paths.ts paths.test.ts vault/
git mv markdown.ts markdown.test.ts vault/
git mv frontmatter.ts frontmatter.test.ts vault/
git mv terms.ts terms.test.ts vault/
git mv resolve.ts resolve.test.ts vault/
git mv mentions.ts mentions.test.ts vault/
git mv axes.ts axes.test.ts vault/
git mv graph.ts graph.test.ts vault/

git mv query.ts query/language.ts
git mv query.test.ts query/language.test.ts
git mv query-blocks.ts query/blocks.ts
git mv query-blocks.test.ts query/blocks.test.ts

git mv render.ts render/note.ts
git mv render.test.ts render/note.test.ts
git mv embed.ts embed.test.ts render/
git mv query-view.ts render/query-view.ts
git mv query-view.test.ts render/query-view.test.ts
```

Note that `remark-wikilink.ts` has no test file of its own; it is covered through `parse.test.ts`
and `render/note.test.ts`.

- [ ] **Step 3: Rewrite the relative imports inside the moved modules**

Every edge, taken from the dependency map. Apply exactly these substitutions in exactly these
files; a module not listed here has no relative import to fix.

| File                   | Old                      | New                                     |
| ---------------------- | ------------------------ | --------------------------------------- |
| `syntax/tagrefs.ts`    | `'./lines.js'`           | `'../text/lines.js'`                    |
| `syntax/linkrefs.ts`   | `'./api.js'`             | `'../api.js'`                           |
| `syntax/linkrefs.ts`   | `'./lines.js'`           | `'../text/lines.js'`                    |
| `syntax/parse.ts`      | `'./api.js'`             | `'../api.js'`                           |
| `syntax/section.ts`    | `'./api.js'`             | `'../api.js'`                           |
| `vault/terms.ts`       | —                        | `'./frontmatter.js'` stays, same folder |
| `vault/resolve.ts`     | `'./linkrefs.js'`        | `'../syntax/linkrefs.js'`               |
| `vault/mentions.ts`    | `'./lines.js'`           | `'../text/lines.js'`                    |
| `vault/mentions.ts`    | `'./remark-wikilink.js'` | `'../syntax/remark-wikilink.js'`        |
| `vault/graph.ts`       | `'./api.js'`             | `'../api.js'`                           |
| `query/language.ts`    | `'./frontmatter.js'`     | `'../vault/frontmatter.js'`             |
| `query/language.ts`    | `'./paths.js'`           | `'../vault/paths.js'`                   |
| `query/blocks.ts`      | `'./query.js'`           | `'./language.js'`                       |
| `render/note.ts`       | `'./api.js'`             | `'../api.js'`                           |
| `render/note.ts`       | `'./callout.js'`         | `'../syntax/callout.js'`                |
| `render/note.ts`       | `'./parse.js'`           | `'../syntax/parse.js'`                  |
| `render/note.ts`       | `'./query.js'`           | `'../query/language.js'`                |
| `render/note.ts`       | `'./terms.js'`           | `'../vault/terms.js'`                   |
| `render/note.ts`       | `'./remark-wikilink.js'` | `'../syntax/remark-wikilink.js'`        |
| `render/note.ts`       | `'./section.js'`         | `'../syntax/section.js'`                |
| `render/note.ts`       | `'./wikilink.js'`        | `'../syntax/wikilink.js'`               |
| `render/embed.ts`      | `'./api.js'`             | `'../api.js'`                           |
| `render/embed.ts`      | `'./parse.js'`           | `'../syntax/parse.js'`                  |
| `render/embed.ts`      | `'./render.js'`          | `'./note.js'`                           |
| `render/embed.ts`      | `'./section.js'`         | `'../syntax/section.js'`                |
| `render/query-view.ts` | `'./api.js'`             | `'../api.js'`                           |
| `render/query-view.ts` | `'./query.js'`           | `'../query/language.js'`                |
| `render/query-view.ts` | `'./render.js'`          | `'./note.js'`                           |
| `api.ts`               | `'./graph.js'`           | `'./vault/graph.js'`                    |
| `api.ts`               | `'./mentions.js'`        | `'./vault/mentions.js'`                 |
| `api.ts`               | `'./query.js'`           | `'./query/language.js'`                 |

Imports that stay as they are because both ends landed in the same folder:
`syntax/linkrefs.ts -> './remark-wikilink.js'`, `'./wikilink.js'`;
`syntax/parse.ts -> './remark-wikilink.js'`, `'./tagrefs.js'`, `'./template.js'`, `'./wikilink.js'`;
`syntax/section.ts -> './parse.js'`, `'./remark-wikilink.js'`;
`vault/terms.ts -> './frontmatter.js'`; `vault/resolve.ts -> './paths.js'`;
`vault/mentions.ts -> './terms.js'`; `vault/graph.ts -> './paths.js'`.

- [ ] **Step 4: Rewrite the imports inside the moved test files**

Each test imports the module beside it. Two need more than the folder change:

- `query/language.test.ts`: `from './query.js'` becomes `from './language.js'`
- `query/blocks.test.ts`: `from './query-blocks.js'` becomes `from './blocks.js'`
- `render/note.test.ts`: `from './render.js'` becomes `from './note.js'`
- `render/query-view.test.ts`: `from './query-view.js'` stays; its `from './render.js'` becomes
  `from './note.js'`

Every other test file keeps `from './<same-name>.js'` and only needs `../` added to imports that
now cross a folder. Let the typechecker find them rather than guessing — Step 6 does that.

- [ ] **Step 5: Rewrite `index.ts`**

The export list — every name, in the order it stands today — does not change. Only the module
specifiers do:

```
'./api.js'              stays
'./callout.js'       -> './syntax/callout.js'
'./axes.js'          -> './vault/axes.js'
'./frontmatter.js'   -> './vault/frontmatter.js'
'./embed.js'         -> './render/embed.js'
'./fuzzy.js'         -> './text/fuzzy.js'
'./graph.js'         -> './vault/graph.js'
'./markdown.js'      -> './vault/markdown.js'
'./linkrefs.js'      -> './syntax/linkrefs.js'
'./mentions.js'      -> './vault/mentions.js'
'./parse.js'         -> './syntax/parse.js'
'./query-blocks.js'  -> './query/blocks.js'
'./query.js'         -> './query/language.js'
'./query-view.js'    -> './render/query-view.js'
'./paths.js'         -> './vault/paths.js'
'./resolve.js'       -> './vault/resolve.js'
'./remark-wikilink.js' -> './syntax/remark-wikilink.js'
'./terms.js'         -> './vault/terms.js'
'./template.js'      -> './syntax/template.js'
'./wikilink.js'      -> './syntax/wikilink.js'
'./render.js'        -> './render/note.js'
'./section.js'       -> './syntax/section.js'
'./tasks.js'         -> './syntax/tasks.js'
'./tagrefs.js'       -> './syntax/tagrefs.js'
```

- [ ] **Step 6: Typecheck, and let it find what Steps 3 to 5 missed**

```bash
pnpm typecheck
```

Expected: exit 0. Every `TS2307: Cannot find module` names a specifier that still points at the
old flat layout — fix it and run again. Do not proceed while this fails.

- [ ] **Step 7: Prove the public API did not move**

```bash
git diff -- packages/core/src/index.ts | grep -E "^[-+]" | grep -v "^[-+][-+]" | grep -vE "from '\./"
```

Expected: no output. Every changed line in `index.ts` must be a module specifier; a changed or
removed export name means the barrel moved and the guarantee is broken.

- [ ] **Step 8: Run the tests**

```bash
pnpm test
pnpm lint
```

Expected: both exit 0, with the same number of passing tests as in Task 0 Step 1. A test body
that needs editing means the move went wrong.

- [ ] **Step 9: Commit**

```bash
git add -A packages/core
git commit -F - <<'EOF'
refactor(core): group the modules into layers

The package held 24 modules in one flat folder, where nothing said which
module belonged to which concern and nothing stopped a new one from
importing in a circle.

They now sit in text, syntax, vault, query and render, the axis their
imports already followed: every edge points from render towards text. A
feature-shaped grouping was rejected because parse imports tagrefs while
linkrefs imports remark-wikilink, which would put two folders in a cycle.

The barrel exports the same names in the same order, so nothing outside
the package sees this.
EOF
```

---

## Task 2: Cut the three long core modules

**Files:**

- Modify: `packages/core/src/render/note.ts` (788 lines today)
- Create: `packages/core/src/render/transform.ts`, `packages/core/src/render/links.ts`,
  `packages/core/src/render/sanitize.ts`
- Modify: `packages/core/src/query/language.ts` (581 lines today)
- Create: `packages/core/src/query/clauses.ts`, `packages/core/src/query/reader.ts`
- Modify: `packages/core/src/vault/frontmatter.ts` (531 lines today)
- Create: `packages/core/src/vault/frontmatter-write.ts`, `packages/core/src/text/breaks.ts`

**Interfaces:**

- Consumes: the folders from Task 1
- Produces: nothing new outside the package. Functions that were module-private and are now
  needed across a cut become named exports of the new module and are **not** added to
  `src/index.ts`.

- [ ] **Step 1: Cut `render/note.ts`**

Move whole function bodies, comments included. Nothing is rewritten.

`render/sanitize.ts` takes, in this order: the `SanitizeAttributes` and `PropertyDefinition`
type aliases, `CALLOUT_CLASSES`, `allowFor`, and `sanitizeSchema`. It exports `sanitizeSchema`.

`render/links.ts` takes: `MARKDOWN_TARGET`, `ASSET_EXTENSION`, `IMAGE_EXTENSION`, `URL_SCHEME`,
`EMBED_SIZE`, `renderWikilink`, `noteLink`, `noteLinkProperties`, `imageEmbed`, `fileEmbed`,
`rewriteLink`, `rewriteImage`, `embedKind`, `fragmentOf`, `labelOf`, `reference`,
`relativeTarget`, `decode`. `noteLinkProperties` is already exported (`render/query-view.ts`
imports it) and stays exported.

`render/transform.ts` takes: the `Context` interface, `transform`, `markTerms`,
`termProperties`, `embedParagraph`, `queryBlock`, `mermaidBlock`, `markTasks`, `fillEmbeds`,
`collectHeadings`, `hideBlockMarkers`, `anchorBlocks`. It exports `Context`, `transform`,
`collectHeadings`, `hideBlockMarkers`, `anchorBlocks` and `fillEmbeds`.

`render/note.ts` keeps: the exported interfaces (`RenderedLink`, `EmbedReference`,
`EmbedResult`, `RenderOptions`, `RenderedNote`), `MERMAID_LANGUAGE`, `MERMAID_CLASS`, the
`parser`, `makeRenderer`, the `renderers` cache with `MAX_RENDERERS` and `rendererFor`, and
`renderNote`.

`render/transform.ts` and `render/links.ts` both need `Context`; define it in `transform.ts` and
import the type into `links.ts`. If that turns out to be circular, move `Context` into
`render/note.ts` alongside the `RenderOptions` it is built from and import it into both.

- [ ] **Step 2: Typecheck and test the render cut**

```bash
pnpm typecheck
pnpm --filter @rhizom/core exec vitest run src/render
```

Expected: both exit 0. `render/note.test.ts` and `render/query-view.test.ts` pass unchanged.

- [ ] **Step 3: Cut `query/language.ts`**

`query/reader.ts` takes the YAML-shaped helpers: the `Reader` and `Entry` interfaces, `entries`,
`textOf`, `numberOf`, `isEmpty`, `lineOf`, `unique`, `plainValue`, and the `PATH_SYNTAX`
constant they use. It exports all of them.

`query/clauses.ts` takes one reader per query key: `folders`, `types`, `tags`, `title`,
`linksTo`, `whereClauses`, `whereValues`, `sort`, `limit`, `view`, `columns`, plus the constants
only they use: `NOTE_TYPE_NAMES`, `TAG_SHAPE`, `TAG_HAS_LETTER`, `DEFAULT_LIMIT`, `MIN_LIMIT`,
`MAX_LIMIT`.

`query/language.ts` keeps the public surface — `QUERY_LANGUAGE`, `QUERY_KEYS`, `QuerySort`,
`QUERY_SORTS`, `QueryView`, `QUERY_VIEWS`, `BUILT_IN_COLUMNS`, `Query`, `QueryProblem`,
`ParsedQuery` — and `parseQuery`.

`lineOf` in `query/reader.ts` is a different function from `lineOf` in `text/lines.ts`: one reads
a YAML node's line, the other looks an offset up in a table. Do not merge them and do not import
one where the other is meant.

- [ ] **Step 4: Typecheck and test the query cut**

```bash
pnpm typecheck
pnpm --filter @rhizom/core exec vitest run src/query
```

Expected: both exit 0.

- [ ] **Step 5: Cut `vault/frontmatter.ts`**

`text/breaks.ts` takes `lineAt`, `lineStartAt`, `lineEndAt`, `isBreak`, `endsWithBreak`,
`startsWithBreak`, `needsSpace` and `lineBreakOf`, and exports all of them. Give the file this
head comment:

```ts
// Line breaks as an editor sees them: where a line starts and ends around an offset, and what
// a text is written with. Separate from lines.ts, which answers the same question against a
// precomputed table of line starts — the two have different costs, and a caller picks.
```

`vault/frontmatter-write.ts` takes what turns a value into YAML: `FLOW_WIDTH`, `SAMPLE_KEY`,
`openBlock`, `pairText`, `valueSuffix`, `useFlow`, `isEmptyMapping`, `write`, `forYaml`,
`withIndent`, `rewrite`, and the `Edit` interface. It exports what `frontmatter.ts` still calls.

`vault/frontmatter.ts` keeps the public surface — `NoteType`, `NOTE_TYPES`, `RESERVED`,
`noteTypeOf`, `FrontmatterBlock`, `FieldKind`, `FrontmatterField`, `findFrontmatter`,
`frontmatterFields`, `setFrontmatter` — plus `locate`, `keyRanges`, `indentOf`, `kindOf`,
`isPlainValue`, `dateOf`, and the `KeyRange`, `Located`, `OPEN_FENCE`, `CLOSE_FENCE`,
`ISO_DATE` definitions.

- [ ] **Step 6: Typecheck and test the frontmatter cut**

```bash
pnpm typecheck
pnpm --filter @rhizom/core exec vitest run src/vault src/text
```

Expected: both exit 0.

- [ ] **Step 7: Check no file grew where it should have shrunk**

```bash
find packages/core/src -name "*.ts" ! -name "*.test.ts" | xargs wc -l | sort -rn | head -8
```

Expected: no non-test module over roughly 350 lines. If `render/transform.ts` lands well above
that, cut `embedParagraph`, `queryBlock` and `mermaidBlock` into `render/blocks.ts` and say so in
the commit message.

- [ ] **Step 8: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:coverage
```

Expected: all exit 0. `pnpm test:coverage` matters here: the `packages/core` threshold is 80 %
on lines, branches, functions and statements, and the coverage config counts every file under
`packages/core/src/**/*.ts` whether a test imports it or not. A new file that no test reaches
would fail the gate.

- [ ] **Step 9: Commit**

```bash
git add -A packages/core
git commit -F - <<'EOF'
refactor(core): cut render, query and frontmatter into their parts

Three modules had grown past what a reader can hold at once: render at
788 lines, query at 581, frontmatter at 531. Each is cut along the seam
its own function groups already had.

render keeps the pipeline and renderNote; the mdast walk, the wikilink
and embed handling and the sanitize schema each get a file. query keeps
its types and parseQuery, with one file per clause reader and one for the
YAML-shaped helpers. frontmatter keeps reading and setting, and hands the
YAML writing to its own module.

The line-break helpers move to text/breaks.ts. They are not merged into
lines.ts: that module answers offsets against a precomputed table while
these count breaks in a slice, and folding one into the other would
change what every caller pays.

Every function keeps its body, its name and its comment. No export was
added to the barrel.
EOF
```

---

## Task 3: Split the vault index and the schema module

**Files:**

- Modify: `apps/server/src/store/vault-index.ts` (701 lines today)
- Create: `apps/server/src/store/index/context.ts`, `notes.ts`, `links.ts`, `resolution.ts`,
  `search.ts`, `tags.ts`, `glossary.ts`, `tree.ts`, `graph.ts`, `query.ts`, `rows.ts`
- Modify: `apps/server/src/routes/schemas.ts` -> `apps/server/src/routes/schemas/` (535 lines today)
- Create: `apps/server/src/routes/schemas/index.ts`, `common.ts`, `notes.ts`, `search.ts`,
  `graph.ts`, `mentions.ts`, `rename.ts`, `tag-rename.ts`, `query.ts`, `assets.ts`
- Modify (import path only, 13 files): `apps/server/src/app.ts`, and in
  `apps/server/src/routes/`: `assets.ts`, `errors.ts`, `graph.ts`, `maintenance.ts`,
  `mentions.ts`, `notes.ts`, `query.ts`, `rename.ts`, `schemas.test.ts`, `search.ts`,
  `tag-rename.ts`, `terms.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/src/plugins/swagger.ts`, `static-web.ts`, `not-found.ts`

**Interfaces:**

- Consumes: nothing from Tasks 1 and 2 — `apps/server` reaches `@rhizom/core` through the barrel
- Produces: `IndexContext`, the object every `store/index/` function takes as its first argument:

```ts
// apps/server/src/store/index/context.ts
import type Database from 'better-sqlite3';
import type { NoteIndex } from '@rhizom/core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * What a store function needs from the index it belongs to: the raw connection for the
 * prepared statements FTS5 needs, the Drizzle handle for everything else, and the resolver
 * that turns a written link target into a path.
 */
export interface IndexContext {
  readonly sqlite: Database.Database;
  readonly db: BetterSQLite3Database;
  readonly resolver: NoteIndex;
}
```

The spec says the functions receive "the Drizzle handle". That is not enough: `search` and
`stats` prepare raw statements on `this.sqlite`, and `applyResolution` reads `this.resolver`.
`IndexContext` is the corrected shape.

- [ ] **Step 1: Create `store/index/context.ts`**

Write the file exactly as under **Interfaces** above.

- [ ] **Step 2: Give `VaultIndex` a context and keep every method working**

In `vault-index.ts`, replace the three private fields with one, built once in the constructor:

```ts
export class VaultIndex {
  private readonly ctx: IndexContext;

  private constructor(sqlite: Database.Database) {
    const db = drizzle(sqlite);
    const resolver = createNoteIndex();
    for (const row of db.select({ path: notes.path, aliases: notes.aliases }).from(notes).all()) {
      resolver.add(row.path, row.aliases);
    }
    this.ctx = { sqlite, db, resolver };
  }

  get rawDatabase(): Database.Database {
    return this.ctx.sqlite;
  }

  close(): void {
    this.ctx.sqlite.close();
  }
  // ... every other method unchanged for now
}
```

Then replace `this.sqlite`, `this.db` and `this.resolver` with `this.ctx.sqlite`, `this.ctx.db`
and `this.ctx.resolver` throughout the class. Run `pnpm typecheck` — it exits 0 and no method has
moved yet. Commit nothing; this is the seam the next step cuts along.

- [ ] **Step 3: Move the method bodies into `store/index/`**

One module at a time, in this order, so that each module only needs what is already moved:

| Module          | Takes                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `rows.ts`       | `SummaryRow`, `SUMMARY_COLUMNS`, `parseAliases`, `toSummary`, `NoteRecord`, `IndexNoteInput`, `FileState`, `IndexStats`, `UpsertOptions` |
| `resolution.ts` | `RESOLUTION_COLUMNS`, `ResolutionRow`, `reresolve`, `applyResolution`, `resolveAll`                                                      |
| `notes.ts`      | `upsertNote`, `removeNote`, `listNotes`, `summary`, `getNote`, `fileStates`, `stats`, `getMeta`, `setMeta`                               |
| `links.ts`      | `linksFrom`, `backlinks`, `linkSources`, `noteAliases`, `unresolved`, `linkTextFor`                                                      |
| `search.ts`     | `MARK_START`, `MARK_END`, `CONTEXT_LENGTH`, `escapeHtml`, `search`, `mentionCandidates`                                                  |
| `tags.ts`       | `tags`, `notesUnderTag`                                                                                                                  |
| `glossary.ts`   | `glossary`                                                                                                                               |
| `tree.ts`       | `tree`, `compareTreeEntries`, `BY_TREE_NAME`                                                                                             |
| `graph.ts`      | `graphInput`                                                                                                                             |
| `query.ts`      | `runQuery`                                                                                                                               |

`BY_NAME` and `BY_TITLE` go to whichever module still uses them after the move; check with
`grep -n "BY_NAME\|BY_TITLE" apps/server/src/store/vault-index.ts` before moving them.

Each moved method becomes a free function whose first parameter is `ctx: IndexContext`:

```ts
// store/index/tags.ts
export function tags(ctx: IndexContext): TagCount[] {
  // the body from VaultIndex.tags(), with this.db -> ctx.db
}
```

A method that takes a transaction handle keeps it as its second parameter:

```ts
export function applyResolution(
  ctx: IndexContext,
  tx: BetterSQLite3Database,
  candidates: readonly ResolutionRow[],
): void {
```

- [ ] **Step 4: Reduce `VaultIndex` to a facade**

Every public method keeps its name, parameters, return type and doc comment, and becomes one
line:

```ts
  tags(): TagCount[] {
    return tagsStore.tags(this.ctx);
  }

  upsertNote(input: IndexNoteInput, options: UpsertOptions = {}): void {
    notesStore.upsertNote(this.ctx, input, options);
  }
```

Import the modules under a namespace-ish alias (`import * as notesStore from './index/notes.js'`)
so the facade reads as a routing table. The long doc comments — the one on `resolveAll` about the
quadratic first build, the one on `search` about alias snippets, the one on `mentionCandidates`
about why frontmatter is skipped — move **with the function body**, not with the facade line: they
explain the implementation, and that is where they now live.

`static open`, `get rawDatabase`, `close` and the constructor stay whole in the facade.

- [ ] **Step 5: Typecheck and test the store**

```bash
pnpm typecheck
pnpm --filter @rhizom/server exec vitest run
```

Expected: both exit 0. `store/vault-index.test.ts` and `store/sync.test.ts` pass unchanged; not
one route file was touched.

- [ ] **Step 6: Check the facade is short**

```bash
wc -l apps/server/src/store/vault-index.ts
```

Expected: well under 200 lines. If it is longer, a body did not move.

- [ ] **Step 7: Split `routes/schemas.ts`**

```bash
cd apps/server/src/routes
mkdir schemas
git mv schemas.ts schemas/index.ts
git mv schemas.test.ts schemas/index.test.ts
```

Then move the schema groups out of `schemas/index.ts` into siblings, leaving `index.ts` as a
barrel that re-exports every name it exports today:

| Sibling         | Takes                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.ts`     | `ErrorSchema`, `HealthSchema`, `NotePathParamsSchema`, `PathQuerySchema`, `ErrorBody`                                                                                                                                                                                                             |
| `notes.ts`      | `TemplateSettingsSchema`, `DailySettingsSchema`, `VaultInfoSchema`, `HeadingSchema`, `noteSummaryFields`, `NoteSummarySchema`, `NoteDocumentSchema`, `GlossaryEntrySchema`, `LinkKindSchema`, `NoteLinkSchema`, `BacklinkSchema`, `TreeEntrySchema`, `CreateNoteBodySchema`, `SaveNoteBodySchema` |
| `search.ts`     | `SearchHitSchema`, `SearchResponseSchema`, `TagCountSchema`, `SearchQuerySchema`                                                                                                                                                                                                                  |
| `graph.ts`      | `GraphNodeSchema`, `GraphEdgeSchema`, `GraphSchema`, `ClusterBySchema`, `GraphQuerySchema`, `LocalGraphQuerySchema`                                                                                                                                                                               |
| `mentions.ts`   | `MentionSchema`, `MentionGroupSchema`, `MentionsResponseSchema`, `MentionWriteSchema`, `LinkMentionsBodySchema`, `LinkMentionsResultSchema`, `MentionsQuerySchema`                                                                                                                                |
| `rename.ts`     | `RenameRefSchema`, `RenameFileSchema`, `RenamePreviewSchema`, `RenameNoteBodySchema`, `RenameNoteResultSchema`, `RenameQuerySchema`                                                                                                                                                               |
| `tag-rename.ts` | `TagRenameRefSchema`, `TagRenameFileSchema`, `TagRenamePreviewSchema`, `TagRenameBodySchema`, `TagRenameResultSchema`, `TagRenameQuerySchema`                                                                                                                                                     |
| `query.ts`      | `QueryBodySchema`, `QueryRowSchema`, `QueryProblemSchema`, `QueryResultSchema`                                                                                                                                                                                                                    |
| `assets.ts`     | `AssetSummarySchema`, `UploadResponseSchema`, `SyncResultSchema`                                                                                                                                                                                                                                  |

Every `Static<typeof …>` type alias goes to the file that holds its schema. Keep each schema's
`$id` exactly as it is: the `$id` is what the published OpenAPI document names the component,
and changing one would move the contract.

- [ ] **Step 8: Point the 13 importers at the barrel**

In `apps/server/src/app.ts` and in `routes/assets.ts`, `errors.ts`, `graph.ts`, `maintenance.ts`,
`mentions.ts`, `notes.ts`, `query.ts`, `rename.ts`, `search.ts`, `tag-rename.ts`, `terms.ts`:

```
from './schemas.js'    ->  from './schemas/index.js'
from '../routes/schemas.js'  ->  from '../routes/schemas/index.js'
```

`schemas/index.test.ts`, now inside the folder, imports `from './index.js'`.

`nodenext` does not resolve a directory to its `index.js`, so the specifier must be written out.

- [ ] **Step 9: Split `app.ts` into plugins**

`plugins/swagger.ts` takes the `fastifySwagger` registration including the `openapi` object,
the tag list and the `refResolver`, plus the `fastifySwaggerUi` registration. It needs the
package version, so it takes it as an argument:

```ts
export async function registerSwagger(app: FastifyInstance, version: string): Promise<void>;
```

`plugins/static-web.ts` takes `IMMUTABLE`, `REVALIDATE`, `DEFAULT_WEB_DIST` and the
`fastifyStatic` registration with its `setHeaders`. `plugins/not-found.ts` takes the
`setNotFoundHandler` body with its `pathname`/`isApi`/`isAsset`/`isPage` logic.

`DEFAULT_WEB_DIST` is exported from `app.ts` today. Keep `app.ts` re-exporting it
(`export { DEFAULT_WEB_DIST } from './plugins/static-web.js';`) so `server.ts` and the tests do
not change.

`app.ts` keeps `BuildAppOptions` with its doc comments, the `pkg` require, `buildApp`, the
health and openapi.json routes, the vault context wiring with `requireContext`, the
`app.addSchema(TreeEntrySchema)` call and the ten `register…Routes` calls.

- [ ] **Step 10: Prove the published contract did not move**

```bash
pnpm --filter @rhizom/server run openapi
git diff --exit-code apps/server/openapi.json
```

Expected: exit 0, no diff. This is the check that matters most in this task: a schema that lost
its `$id`, or a route whose schema reference changed, shows up here and nowhere else.

- [ ] **Step 11: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

Expected: all exit 0.

Before `pnpm e2e`: a dev server left running from an earlier session poisons the run. Check with
`netstat -ano | findstr :3737` and `findstr :5173` — grep for the port, not for a status word,
because the status column is localised on this machine.

- [ ] **Step 12: Commit**

```bash
git add -A apps/server
git commit -F - <<'EOF'
refactor(server): split the vault index and the schema module

VaultIndex was one class of 540 lines with 30 methods, covering note
storage, links, full-text search, the query language, tags, the glossary,
the folder tree and the graph. Phase 3 has to make it vault-aware, and
that is a change nobody should have to make in a file this size.

It is now a facade: every method keeps its name and signature, and
delegates in one line to a function in store/index/. Those functions take
an IndexContext — the raw connection, the Drizzle handle and the link
resolver — because the raw connection is what the FTS5 statements are
prepared on. No route file changed.

The schema module splits by domain behind a barrel, and app.ts hands
swagger, static serving and the not-found fallback to plugins, keeping
only the assembly. The tracked OpenAPI document is unchanged, which is
what proves the contract did not move.
EOF
```

---

## Task 4: Separate pages from the application frame

**Files:**

- Create folders: `apps/web/src/pages/`, `apps/web/src/pages/note/`,
  `apps/web/src/app/layout/`, `apps/web/src/routing/`, `apps/web/src/mermaid/`
- Move:

| From `apps/web/src/`                                                                     | To `apps/web/src/` |
| ---------------------------------------------------------------------------------------- | ------------------ |
| `app/paths.ts`, `app/paths.test.ts`                                                      | `routing/`         |
| `app/links.ts`, `app/links.test.ts`                                                      | `routing/`         |
| `app/mermaid.ts`, `app/mermaid.test.ts`, `app/mermaid-draw.ts`                           | `mermaid/`         |
| `app/commands-model.ts`, `app/commands-model.test.ts`                                    | `app/layout/`      |
| `app/daily.ts`, `app/daily.test.ts`                                                      | `app/layout/`      |
| `app/HomePage.tsx`, `app/WikiPage.tsx`, `app/GraphPage.tsx`, `app/GraphLayoutSelect.tsx` | `pages/`           |
| `app/GlossaryPage.tsx`, `app/glossary-model.ts`, `app/glossary-model.test.ts`            | `pages/`           |
| `app/NotePage.tsx`, `app/NotePreview.tsx`                                                | `pages/`           |

- Create: `apps/web/src/app/layout/commands.ts`, `tabs.ts`, `useNoteCommands.ts`
- Create: `apps/web/src/pages/note/useNoteDocument.ts`, `useNoteEvents.ts`, `useNoteEditing.ts`,
  `SaveStatus.tsx`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/app/Layout.tsx`
- Modify (import path only): the 17 files that import `app/paths.js`, listed in Step 2

**Interfaces:**

- Consumes: nothing from Tasks 1 to 3
- Produces: no new public surface. Every extracted hook returns exactly what the component read
  from its own state before, so the JSX is untouched.

- [ ] **Step 1: Move the files**

```bash
cd apps/web/src
mkdir -p pages/note app/layout routing mermaid

git mv app/paths.ts app/paths.test.ts routing/
git mv app/links.ts app/links.test.ts routing/
git mv app/mermaid.ts app/mermaid.test.ts app/mermaid-draw.ts mermaid/
git mv app/commands-model.ts app/commands-model.test.ts app/layout/
git mv app/daily.ts app/daily.test.ts app/layout/
git mv app/HomePage.tsx app/WikiPage.tsx app/GraphPage.tsx app/GraphLayoutSelect.tsx pages/
git mv app/GlossaryPage.tsx app/glossary-model.ts app/glossary-model.test.ts pages/
git mv app/NotePage.tsx app/NotePreview.tsx pages/
```

`app/` keeps `App.tsx`, `Layout.tsx`, `outlet.ts`, `useIndexEvents.ts`, `theme.ts`.

- [ ] **Step 2: Fix the importers of the moved modules**

`app/paths.js` has 17 importers. Rewrite each specifier:

| File                                                                                                                                       | New specifier              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `pages/GlossaryPage.tsx`, `pages/GraphPage.tsx`, `pages/HomePage.tsx`, `pages/NotePage.tsx`, `pages/NotePreview.tsx`, `pages/WikiPage.tsx` | `'../routing/paths.js'`    |
| `app/Layout.tsx`                                                                                                                           | `'../routing/paths.js'`    |
| `components/RenameDialog.tsx`, `components/TagRenameDialog.tsx`                                                                            | `'../routing/paths.js'`    |
| `milieu/MilieuField.tsx`, `milieu/MilieuLayout.tsx`                                                                                        | `'../routing/paths.js'`    |
| `panels/BacklinksPanel.tsx`, `panels/MentionsPanel.tsx`, `panels/OutlinePanel.tsx`, `panels/SearchPanel.tsx`, `panels/SmartFolders.tsx`    | `'../routing/paths.js'`    |
| `routing/paths.test.ts`                                                                                                                    | `'./paths.js'` (unchanged) |

The rest:

| Module                         | Importers and their new specifier                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `routing/links.js`             | `pages/NotePage.tsx`, `pages/NotePreview.tsx` -> `'../routing/links.js'`; `editor/extensions.ts` -> `'../routing/links.js'`                 |
| `mermaid/mermaid.js`           | `pages/NotePreview.tsx` -> `'../mermaid/mermaid.js'`; `mermaid/mermaid-draw.ts` and `mermaid/mermaid.test.ts` keep `'./mermaid.js'`         |
| `app/layout/daily.js`          | `app/Layout.tsx` -> `'./layout/daily.js'`                                                                                                   |
| `app/layout/commands-model.js` | `app/Layout.tsx` -> `'./layout/commands-model.js'`                                                                                          |
| `pages/glossary-model.js`      | `pages/GlossaryPage.tsx` -> `'./glossary-model.js'` (unchanged)                                                                             |
| `app/theme.js`                 | `app/Layout.tsx` -> `'./theme.js'` (unchanged); `editor/extensions.ts` -> `'../app/theme.js'` (unchanged)                                   |
| `app/outlet.js`                | `pages/GlossaryPage.tsx`, `pages/NotePage.tsx`, `pages/WikiPage.tsx` -> `'../app/outlet.js'`; `app/useIndexEvents.ts`, `milieu/*` unchanged |
| `app/useIndexEvents.js`        | `pages/NotePage.tsx`, `pages/WikiPage.tsx` -> `'../app/useIndexEvents.js'`; `app/Layout.tsx`, `milieu/MilieuLayout.tsx` unchanged           |

Also update the moved pages' own relative imports to `api/`, `components/`, `editor/`,
`panels/`, `store/` and `i18n/` — they were `'../x/…'` from `app/` and stay `'../x/…'` from
`pages/`, so most need no change. Let the typechecker confirm.

- [ ] **Step 3: Point the router at `pages/`**

In `app/App.tsx`:

```ts
import { HomePage } from '../pages/HomePage.js';
```

and in the four `lazy` imports: `'../pages/NotePage.js'`, `'../pages/WikiPage.js'`,
`'../pages/GraphPage.js'`, `'../pages/GlossaryPage.js'`.

The lazy boundaries must stay exactly where they are: they are what keeps CodeMirror, the force
layout and the Markdown renderer off the first page. Do not turn a `lazy` into a static import.

`pages/NotePage.tsx` keeps its own `lazy` import of `NotePreview`; the specifier
`'./NotePreview.js'` is unchanged because both moved together.

- [ ] **Step 4: Typecheck and test the moves before cutting anything**

```bash
pnpm typecheck
pnpm --filter @rhizom/web exec vitest run
```

Expected: both exit 0. Stop here if not: Steps 5 to 7 assume the tree already compiles.

- [ ] **Step 5: Cut `Layout.tsx`**

`app/layout/tabs.ts` takes `SIDEBAR_TABS` and `modifierLabel`.

`app/layout/useNoteCommands.ts` takes the module-level `templateText` helper and the `openNote`,
`createNote`, `openToday` and `duplicateNote` callbacks, together with the `newNoteFolder` state
they drive and the `templateChoices` memo. These are the signatures as they stand in
`Layout.tsx` today; they do not change:

```ts
export function useNoteCommands(openNotePath: string | null): {
  openNote: (path: string, fragment?: string) => void;
  createNote: (path: string, template: string | null) => Promise<void>;
  openToday: () => Promise<void>;
  duplicateNote: () => Promise<void>;
  newNoteFolder: string | null;
  setNewNoteFolder: Dispatch<SetStateAction<string | null>>;
  templateChoices: { path: string; name: string }[];
};
```

`openNotePath` is the argument because `duplicateNote` reads it; `Layout` computes it from
`useLocation()` and keeps doing so. Everything else the hook needs — `navigate`, and `notes`,
`refresh`, `info.daily`, `info.templates` from the vault store, plus `i18n.language` — it reads
itself, exactly as `Layout` does today. Keep every `useCallback` dependency array as it is: a
changed array changes how often a command is rebuilt.

`app/layout/commands.ts` takes the `useMemo<PaletteCommand[]>` body — the roughly 160 lines from
`Layout.tsx:219` — as a function that receives what the list closes over and returns the array.
It stays wrapped in `useMemo` at the call site with the same dependency array, so the list is
rebuilt exactly as often as today.

- [ ] **Step 6: Cut `NotePage.tsx`**

`pages/note/useNoteDocument.ts` takes `LoadState`, `SaveState`, `AUTOSAVE_MS`, the `doc`,
`state`, `saveState`, `message`, `draft` and `externalContent` state, `applyLoaded`,
`applyLoadFailure`, `reload`, `save`, `scheduleSave` and the effects that load and autosave.

`pages/note/useNoteEvents.ts` takes the effect that reacts to index events and the `notice`
state around an external change.

`pages/note/useNoteEditing.ts` takes `confirmRename`, `applyFrontmatter`, `toggleTask`,
`remove`, `announceBlockLink`, `openTarget`, the `askDelete` and `renaming` state, and
`BLOCK_LINK_REFUSALS`.

`pages/note/SaveStatus.tsx` takes the `SaveStatus` component from the bottom of the file.

`NO_TEMPLATES`, the `NotePreview` lazy import and the `NotePage`/`NoteView` components stay in
`pages/NotePage.tsx`.

Each hook returns exactly the values the JSX reads today. The JSX itself is not edited.

- [ ] **Step 7: Check what is left**

```bash
find apps/web/src -name "*.tsx" -o -name "*.ts" | grep -v "\.test\." | xargs wc -l | sort -rn | head -8
```

Expected: `NotePage.tsx` and `Layout.tsx` are both well under 300 lines. `MilieuField.tsx` at
492 lines is knowingly left alone — it is one SVG component and splitting it would scatter one
drawing across files.

- [ ] **Step 8: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm e2e
```

Expected: all exit 0. All 20 Playwright specs pass; they drive the real routes, so a broken lazy
boundary or a hook that stopped returning something shows up here.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web
git commit -F - <<'EOF'
refactor(web): separate pages from the application frame

app/ had become the folder for everything: the router, the layout, six
pages, four models, the mermaid bridge, the theme and the path helpers.
What a route renders now lives in pages/, what frames the application
stays in app/, and paths and links move to routing/ where the seventeen
files that use them can find them.

NotePage and Layout keep their JSX. What moves out of them is state and
effects that already formed a unit: loading and autosaving a note, the
reaction to an index event, the editing commands, and the palette's
command list. The lazy route boundaries are untouched, so CodeMirror and
the force layout still stay off the first page.
EOF
```

---

## Task 5: Cut the two collected stylesheets

**Files:**

- Modify: `apps/web/src/styles/base.css` (941 lines today) -> barrel
- Create: `apps/web/src/styles/reset.css`, `primitives.css`, `frame.css`, `note.css`,
  `prose.css`, `dialogs.css`
- Modify: `apps/web/src/panels/panels.css` (678 lines today) -> barrel
- Create: `apps/web/src/panels/css/shared.css`, `tree.css`, `smart-folders.css`, `outline.css`,
  `search.css`, `tags.css`, `backlinks.css`, `frontmatter.css`

**Interfaces:**

- Consumes: nothing
- Produces: nothing. No component changes its import: `main.tsx` still imports
  `./styles/base.css`, and the eight panel components still import `./panels.css`.

- [ ] **Step 1: Cut `base.css` at its own section markers**

The file already marks its sections. Cut at those lines, keeping every rule in its original
order:

| New file         | From `base.css`                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reset.css`      | the head comment and the reset, lines 1 to 98                                                                                                                                  |
| `primitives.css` | `/* --- shared primitives --- */`, from line 99                                                                                                                                |
| `frame.css`      | `/* --- app frame --- */` including the Zen block, from line 137                                                                                                               |
| `note.css`       | `/* --- note view --- */`, from line 244                                                                                                                                       |
| `prose.css`      | `/* --- graph --- */` and `/* --- rendered Markdown (wiki mode) --- */` through the glossary, terms, transclusion, callouts, tasks, query blocks and mermaid, lines 316 to 773 |
| `dialogs.css`    | `/* --- dialogs --- */`, from line 774 to the end                                                                                                                              |

Check the line numbers against the file before cutting — they are from today's version and a
formatting pass may have moved them. The section comments are the authority, not the numbers.

If `prose.css` still reads as three subjects rather than one, cut `graph.css` and `callouts.css`
out of it and add them to the barrel in the same position.

- [ ] **Step 2: Turn `base.css` into a barrel**

```css
/* Base styles: a small reset, the shared primitives every view uses, and the app frame.
   Component-specific rules live next to their components (editor.css, graph.css, panels.css,
   milieu.css, palette.css). The parts are imported in cascade order: a rule further down still
   wins over one further up, exactly as when this was one file. */

@import './reset.css';
@import './primitives.css';
@import './frame.css';
@import './note.css';
@import './prose.css';
@import './dialogs.css';
```

The file holds `@import` statements and nothing else. CSS requires `@import` to precede every
rule, so a stray declaration would make the file invalid.

- [ ] **Step 3: Cut `panels.css` at its own section markers**

| New file                | From `panels.css`                                                    |
| ----------------------- | -------------------------------------------------------------------- |
| `css/shared.css`        | the head comment and the shared panel rules, lines 1 to 48           |
| `css/tree.css`          | `/* --- file tree --- */`, from line 49                              |
| `css/smart-folders.css` | `/* --- smart folders --- */`, from line 143                         |
| `css/outline.css`       | `/* --- outline --- */`, from line 219                               |
| `css/search.css`        | `/* --- search --- */`, from line 256                                |
| `css/tags.css`          | `/* --- tags --- */`, from line 308                                  |
| `css/backlinks.css`     | `/* --- backlinks --- */` including unlinked mentions, from line 400 |
| `css/frontmatter.css`   | `/* --- frontmatter --- */`, from line 544 to the end                |

`panels.css` becomes the same kind of barrel, importing the eight in that order.

The comment in `css/shared.css` that says "This stylesheet is loaded after base.css" stays true
and stays where it is.

- [ ] **Step 4: Prove the cascade did not move**

```bash
pnpm --filter @rhizom/web run build
ls apps/web/dist/assets/*.css
```

Expected: the same file name as Task 0 Step 3. Vite inlines `@import` at build time and names the
file after a hash of its content, so an identical name means identical bytes. If the name
changed, diff the file against the copy from Task 0 — a reordered rule or a lost declaration is
what you are looking for.

- [ ] **Step 5: Full verification**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm e2e
```

Expected: all exit 0. `pnpm format:check` matters here: prettier formats CSS, and a hand-cut file
often needs `pnpm format` once.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -F - <<'EOF'
refactor(web): cut the two collected stylesheets

base.css had grown to 941 lines and panels.css to 678, each collecting
rules for areas with nothing to do with each other. Both are cut at the
section markers they already carried, and both stay in place as a barrel
of @import statements in the original order.

Vite inlines @import at build time, so the emitted stylesheet is the same
bytes: the asset keeps its content hash, which is what proves the cascade
did not move. No component changed its import.
EOF
```

---

## Task 6: Update the documentation

**Files:**

- Modify: `DECISIONS.md`, `CHANGELOG.md`, `docs/specs/2026-09-21-refactoring.md`

**Interfaces:**

- Consumes: Tasks 1 to 5
- Produces: nothing

- [ ] **Step 1: Record the decision**

Add to `DECISIONS.md`, in the file's existing style: why `packages/core` is grouped by layer
(`text <- syntax <- vault <- query <- render`) rather than by feature — `parse` imports `tagrefs`
while `linkrefs` imports `remark-wikilink`, so a feature grouping puts two folders in a cycle —
and why `VaultIndex` stays one class with one facade rather than becoming several classes the
routes would have to know about.

- [ ] **Step 2: Record what changed**

Add one entry to `CHANGELOG.md` under _Changed_, in Keep a Changelog style. It says the tree was
restructured and that no behaviour changed; it does not list every moved file.

- [ ] **Step 3: Mark the spec done**

In `docs/specs/2026-09-21-refactoring.md`, change `Status: accepted, not yet implemented` to
`Status: implemented` with the date.

- [ ] **Step 4: Run the whole CI sequence locally before pushing**

The workflow order, not only the tests:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:coverage
pnpm e2e
```

Expected: all exit 0. `pnpm test:coverage` enforces the 80 % threshold on `packages/core`.

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md CHANGELOG.md docs/specs/2026-09-21-refactoring.md
git commit -F - <<'EOF'
docs: record the pre-phase-3 restructuring

DECISIONS.md explains the layer axis in packages/core and why the vault
index keeps one facade. CHANGELOG.md notes the restructuring under
Changed, and the spec is marked implemented.
EOF
```

---

## Verification Summary

Three things prove the guarantee, in rising order of what they cover:

1. **The test suites.** 65 unit-test files and 20 Playwright specs, running with no edit to any
   test body. They cover behaviour.
2. **`git diff --exit-code apps/server/openapi.json`** after regenerating it. It covers the
   published contract, which no test asserts in full.
3. **The content hash of the emitted CSS asset.** It covers the cascade, which no test sees.

If all three hold, the refactoring did what it said and nothing else.
