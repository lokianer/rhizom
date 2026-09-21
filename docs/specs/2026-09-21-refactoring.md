# Structural refactoring before Phase 3

Date: 2026-09-21
Status: accepted, not yet implemented

## Why

Phases 0 to 2 are complete and Phase 3 (the D&D module, several vaults per server) is next.
Three things in the tree will make that phase harder than it needs to be:

- `packages/core/src` holds 24 modules in one flat folder. Nothing says which module belongs to
  which concern, and nothing stops a new one from importing in a circle.
- `VaultIndex` is a single class of roughly 540 lines with 30 methods, covering note storage,
  links, full-text search, the query language, tags, the glossary, the folder tree and the
  graph. Phase 3 has to make that class vault-aware; every change to it currently touches one
  file that no reader can hold in their head.
- Two sheets, `base.css` (941 lines) and `panels.css` (678 lines), collect rules for areas that
  have nothing to do with each other.

The refactoring changes no behaviour. It is done before Phase 3 rather than during it, so that
the Phase 3 diff is about several vaults and nothing else.

## Guarantee

Strictly behaviour-preserving. After the refactoring:

- every REST response is byte-identical, including the published OpenAPI document;
- the rendered HTML of a note is identical, including every class name and element id;
- the computed CSS cascade is identical;
- the public API of `@rhizom/core` — the export list in `src/index.ts` — is unchanged;
- every i18n key is unchanged.

The 65 unit-test files and 20 Playwright specs run unchanged. The only edits inside a test file
are import paths. A green test run is therefore evidence, not a hope.

No dead code is removed, no helper is merged, no signature is changed. Anything worth changing
is written down at the end of this document and handled separately.

## packages/core — layers

The modules are grouped along the axis their imports already follow. The direction is

```
text  <-  syntax  <-  vault  <-  query  <-  render
```

Every edge points left. This was checked against the actual imports of all 24 modules before
the axis was chosen; a feature-shaped grouping (`links/`, `tags/`, `notes/`) was rejected
because `parse -> tagrefs` and `linkrefs -> remark-wikilink` point in opposite directions and
would put two folders in a cycle.

```
packages/core/src/
  index.ts                  the barrel; the export list does not change
  api.ts                    contract types; its only imports are type-only, so it stays at the root
  text/
    lines.ts                offset <-> line number against a precomputed table
    breaks.ts               line-break and spacing predicates (moved out of frontmatter.ts)
    fuzzy.ts
  syntax/                   what stands in the file's text
    wikilink.ts
    remark-wikilink.ts
    parse.ts
    section.ts
    callout.ts
    tasks.ts
    tagrefs.ts
    linkrefs.ts
    template.ts
  vault/                    what the collection knows about itself
    paths.ts
    markdown.ts
    frontmatter.ts          finding and setting frontmatter
    frontmatter-write.ts    turning a value into the YAML that is written back
    terms.ts
    resolve.ts
    mentions.ts
    axes.ts
    graph.ts
  query/
    language.ts             types, constants, parseQuery
    clauses.ts              one reader per query key
    reader.ts               the YAML-shaped helpers parseQuery reads entries with
    blocks.ts               was query-blocks.ts
  render/
    note.ts                 the unified pipeline and renderNote
    transform.ts            the mdast walk: terms, embeds, query blocks, mermaid, tasks
    links.ts                wikilinks, image and file embeds, link rewriting
    sanitize.ts             the rehype-sanitize schema
    embed.ts
    query-view.ts
```

`*.test.ts` files move with the module they test, as the repository convention requires.

`template.ts` stays in `syntax/` although it reads like a vault concern: `parse.ts` imports
`PLACEHOLDER` from it, and moving it to `vault/` would be the one edge that puts `syntax` and
`vault` in a cycle.

### The three long modules

| Today                       | After                                                                            |
| --------------------------- | -------------------------------------------------------------------------------- |
| `render.ts`, 788 lines      | `render/note.ts`, `render/transform.ts`, `render/links.ts`, `render/sanitize.ts` |
| `query.ts`, 581 lines       | `query/language.ts`, `query/clauses.ts`, `query/reader.ts`                       |
| `frontmatter.ts`, 531 lines | `vault/frontmatter.ts`, `vault/frontmatter-write.ts`, `text/breaks.ts`           |

The split is by cut, not by rewrite: every function keeps its body, its name and its comment.
Functions that were module-private and are now needed across the cut become named exports of
the new module and are not added to `src/index.ts`.

`text/breaks.ts` takes `lineStartAt`, `lineEndAt`, `isBreak`, `endsWithBreak`, `startsWithBreak`,
`needsSpace` and `lineBreakOf` out of `frontmatter.ts`. `lineAt` goes with them. It is _not_
merged into `lines.ts`: `lines.ts` answers offsets against a precomputed table, `lineAt` counts
breaks in a slice, and folding one into the other would change the cost of every caller.

## apps/server

```
apps/server/src/
  app.ts                    assembly only
  plugins/
    swagger.ts              the OpenAPI registration and its refResolver
    static-web.ts           fastify-static and the cache headers
    not-found.ts            the history-API fallback
  routes/
    schemas/
      index.ts              re-exports every schema; route files import from here
      common.ts             ErrorSchema, HealthSchema, path and query params
      notes.ts              vault info, note summary and document, headings, tree
      search.ts             search hits, tags
      graph.ts
      mentions.ts
      rename.ts
      tag-rename.ts
      query.ts
      assets.ts
    (the route files keep their names and places)
  store/
    vault-index.ts          the facade
    index/
      notes.ts              upsertNote, removeNote, listNotes, summary, getNote, fileStates
      links.ts              linksFrom, backlinks, linkSources, noteAliases, unresolved, linkTextFor
      resolution.ts         reresolve, resolveAll, applyResolution
      search.ts             search and its snippet marking, mentionCandidates
      tags.ts               tags, notesUnderTag
      glossary.ts
      tree.ts               tree and compareTreeEntries
      graph.ts              graphInput
      query.ts              runQuery
      rows.ts               SummaryRow, toSummary, parseAliases, the shared column list
    database.ts  schema.ts  query-sql.ts  sync.ts
```

`VaultIndex` keeps all 30 public methods with their current names and signatures, so no route
file changes. Each method becomes a single line delegating to a function in `store/index/`,
which receives an `IndexContext`: the raw `better-sqlite3` connection, the Drizzle handle and the
link resolver. All three are needed — `search` and `stats` prepare raw statements against the
connection because that is what FTS5 wants, and the resolution pass reads the resolver. Free
functions rather than sub-classes: that is what the rest of the codebase does, and
`erasableSyntaxOnly` rules out parameter properties anyway.

The private constructor, the context the constructor builds, and the transaction handling stay
in the facade. A helper that today reads from several tables stays one function; it is moved,
not decomposed.

## apps/web

```
apps/web/src/
  app/
    App.tsx  outlet.ts  useIndexEvents.ts  theme.ts
    Layout.tsx
    layout/
      commands.ts           the PaletteCommand list, today 160 lines inside Layout
      commands-model.ts     (moved, unchanged)
      daily.ts              (moved, unchanged)
      useNoteCommands.ts    createNote, openToday, duplicateNote
      tabs.ts               SIDEBAR_TABS, modifierLabel
  pages/
    HomePage.tsx  WikiPage.tsx  GraphPage.tsx  GraphLayoutSelect.tsx
    GlossaryPage.tsx  glossary-model.ts
    NotePage.tsx  NotePreview.tsx
    note/
      useNoteDocument.ts    load, save, autosave, conflict handling
      useNoteEvents.ts      external change and reload
      useNoteEditing.ts     rename, delete, frontmatter, task toggle
      SaveStatus.tsx
  routing/
    paths.ts  links.ts
  mermaid/
    mermaid.ts  mermaid-draw.ts
  api/  components/  editor/  graph/  i18n/  milieu/  palette/  panels/  store/  styles/
```

`NotePage.tsx` (611 lines) and `Layout.tsx` (579 lines) keep their component bodies; what moves
out is state and effects that already form a unit. Every extracted hook returns exactly what the
component used before, so the JSX is untouched.

`app/` keeps what frames the application. `pages/` holds what a route renders. A model file lives
next to the page that is its only consumer.

## CSS

Splitting a sheet can change the cascade, which the guarantee above forbids. So each sheet stays
in place as a barrel of `@import` statements in exactly today's order. Vite inlines `@import` at
build time, so the emitted CSS is the same text in the same order: a pure cut.

```
styles/base.css       -> reset.css  primitives.css  frame.css  note.css  prose.css  dialogs.css
panels/panels.css     -> css/shared.css  css/tree.css  css/smart-folders.css  css/outline.css
                         css/search.css  css/tags.css  css/backlinks.css  css/frontmatter.css
```

A barrel holds `@import` statements and nothing else. CSS requires `@import` to come before any
rule, so a barrel that kept one stray declaration would be invalid.

No component changes its import: `main.tsx` still imports `styles/base.css`, and the eight panel
components still import `./panels.css`.

The section comments that stand above each block today become the head comment of the file they
describe.

## Delivery

Five commits. Each one leaves the tree runnable and has `pnpm typecheck`, `pnpm lint`,
`pnpm test` and `pnpm e2e` green before the next one starts.

1. `refactor(core): group the modules into layers` — moves plus `index.ts` plus relative imports
2. `refactor(core): cut render, query and frontmatter into their parts`
3. `refactor(server): split the vault index and the schema module`
4. `refactor(web): separate pages from the application frame`
5. `refactor(web): cut the two collected stylesheets`

A sixth commit follows the five: `DECISIONS.md` records the layer axis and why a feature-shaped
grouping was rejected, `CHANGELOG.md` gets one entry under _Changed_, and this document is
marked implemented. The full CI sequence runs locally before the push.

## Verification

Beyond the test suites, two checks that the suites cannot make:

- **The contract.** `apps/server/openapi.json` is tracked, so regenerating it says whether the
  published contract moved:

  ```
  pnpm --filter @rhizom/server run openapi
  git diff --exit-code apps/server/openapi.json
  ```

- **The cascade.** Keep the CSS that `pnpm --filter @rhizom/web run build` emits into
  `apps/web/dist/assets/` before the split, then diff it against the file emitted after. Both
  content and file name must match: Vite names the file after a hash of its content, so an
  unchanged name is itself the proof.

## Out of scope, noted for later

- `api.ts` and `graph.ts`, `mentions.ts`, `query.ts` import each other's types in a circle. It is
  type-only and erased at runtime, so nothing breaks, but the contract module depending on its
  consumers is backwards. Untangling it changes the public type surface and belongs in its own
  change.
- `lineAt` in `text/breaks.ts` and `lineOf(lineStarts(...))` in `text/lines.ts` answer the same
  question by different means. Choosing one is a performance decision, not a structural one.
- `@rhizom/core` exposes a single barrel. Subpath exports (`@rhizom/core/query`) would let a
  consumer import less, but would rewrite every import in the server and the web app for no
  gain inside a private workspace.
