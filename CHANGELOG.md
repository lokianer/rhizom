# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Reserved frontmatter vocabulary: a flat `type:` key with the values `definition`, `template`,
  `query` and `axes`, beside the `aliases:` and `tags:` keys Obsidian established.
- Term index: a note with `type: definition` contributes its title and every alias as a term of
  the vault. The index keeps them in a `terms` table, which is what lets `GET /api/glossary`
  find the definition notes without parsing the frontmatter of every note in the vault.
- `packages/core` finds those terms in running text: whole words only, case-insensitive and
  indifferent to how an accent is encoded (but not to whether it is there); across the line
  break a hard-wrapped paragraph puts in the middle of a term, but never across a blank line;
  through `_underscore emphasis_`; and keeping the punctuation a term such as `C++` carries.
- A definition note and its unlinked mentions in `examples/vault`, checked by the acceptance
  test.
- Transclusion: `![[Note]]` shows the note and `![[Note#Heading]]` shows one section of it, in
  the wiki and in the preview beside the editor. A note that embeds itself, a cycle between two
  notes, a page with too many embeds and a target that is not there each say so in place of the
  body rather than failing.
- Wiki mode follows the files: a note open in it refreshes when the index reports that it, or
  a note it transcludes, changed on disk.
- Definitions: a term the vault defines is marked wherever it is mentioned — in the editor, in
  the preview and in the wiki — and says what it means on hover. A mention inside a link, a code
  span, a wikilink or the frontmatter is left alone, and a definition never marks itself in its
  own text.
- Unlinked mentions: a panel beside the backlinks showing every note that names the open one —
  by its title or any alias — without a link leading there, with the line each sits in. Ticking
  a few and pressing the button writes the links in one go. A name inside a link, a code span,
  a wikilink or the frontmatter is not a mention, and a name broken across a line is shown but
  cannot be linked, because no wikilink may contain a line break. Inside a table cell the alias
  separator is written `\|`, the way Obsidian writes it, so the row keeps its columns — and a
  link written that way is now read back with the backslash stripped.
- Templates and a slash menu: `/` at the start of a line or after a space offers a table, the
  date, the time, "mark as a definition" — which writes `type: definition` into the frontmatter
  — and every note in the vault's template folder. The folder is the one Obsidian's own settings
  name, `RHIZOM_TEMPLATE_DIR`, or simply a folder called Templates, so a vault brought from
  Obsidian keeps its templates without being changed.
- Template placeholders in Obsidian's syntax: `{{title}}`, `{{date}}`, `{{time}}`, each with an
  optional format (`{{date:DD.MM.YYYY}}`) in the Moment tokens, plus Rhizom's `{{roll:2d6+3}}`,
  `{{path}}` and `{{cursor}}`. They are filled once, when the text is inserted, in the language
  the app is read in and the formats the vault is set to. A placeholder in code, one nobody
  knows, and one whose format says nothing are all left exactly as they stand.
- A glossary page listing every definition alphabetically, grouped by first letter, with the
  aliases each also answers to. It is a view of the index, not a file written into the vault, so
  it cannot go stale. Reachable from the navigation and from the command palette.

### Changed

- `NoteSummary` and `NoteDocument` carry the note's `aliases`, which the web app now uses:
  clicking `[[An Alias]]` in the preview or the wiki resolves the same way the server does.
- The index schema version is 3. The index file is deleted and rebuilt on first start, which
  costs one vault scan and no data: every vault stays the Markdown files it was.
- Building the index no longer resolves links once per note. A first build of a generated vault
  of 5,000 notes and 47,000 links went from 198 s to about 10 s, and the server answers nothing
  until that build is done.
- A resolved `![[Note]]` is an edge in the bubble field. Once an embed pulls the target's text
  onto the page the two notes are connected, and a note that is only ever embedded no longer
  sits there as an orphan. The edge says how many of its links transclude, so the field can tell
  the two apart later. File embeds still have no node and stay out.
- `RenderOptions` carries the note being rendered and hands it to `resolveLink`, so a
  transcluded note's own links resolve against its folder rather than the host's.

### Fixed

- A hard-wrapped paragraph counts as one block of plain text, so a search snippet no longer
  breaks mid-sentence.
- A heading that contains a wikilink reads as the page shows it: `## See [[Silverstadt|the
city]]` is `See the city`, not `See Silverstadt|the city`, and slugs the way Obsidian slugs
  it, so an anchor already written in a vault finds it. A heading holding a run of spaces, a tab
  or a non-breaking space keeps its anchor too: every heading id, `#fragment` href and
  `![[Note#Heading]]` now goes through one function.
- A note whose body could not be fetched because the connection dropped is asked for again
  instead of showing "Loading …" for the rest of the session, and a reply that arrives after the
  index said that note changed is discarded rather than kept.
- A batch that reports two changes at once no longer loses the first: pages count what the index
  reported per note instead of reacting to the last event alone.
- When two notes share a name, the one a link leads to no longer depends on the order the index
  was filled in or on the machine's locale — the server and the browser used to be able to
  disagree.
- An index left behind by an older schema that cannot be removed now says so and names the
  file, instead of failing later with a bare SQLite error.
- `schemas.test.ts` now compares every TypeBox schema with its `@rhizom/core` contract in both
  directions, which a comment had claimed for a file that did not exist.

### Removed

- The unused `@fastify/sensible` dependency, the leftover Phase 0 `App.tsx` shell and the
  `app.tagline` translation key it was the only reader of.

## [0.1.0] - 2026-09-18

Phase 1: open a vault, write in it, link it and see the field.

### Added

- Monorepo foundation: pnpm 12 workspace with `packages/core`, `apps/server` and `apps/web`,
  strict TypeScript project references, ESLint 10 with type-aware rules, Prettier, Vitest 5
  with an 80 % coverage gate for `packages/core`, and Playwright smoke tests.
- `commit-msg` git hook that enforces Conventional Commits and rejects attribution lines.
- Fastify server with `GET /api/health` and a history-API fallback for the built web app.
- React web shell with the i18n layer (English default, German) and the Humus/Kalk design
  tokens.
- GitHub Actions CI matrix (Ubuntu, macOS, Windows × Node 22, 24) plus a Docker build and
  container smoke test; `Dockerfile` and `docker-compose.yml`.
- Project landing page in `site/`, deployed to GitHub Pages.
- Repository documentation: README, roadmap, decisions log, contributing guide, code of
  conduct, security policy, issue and pull request templates.
- `packages/core`: Markdown parsing (frontmatter, wikilinks, embeds, tags, headings),
  Obsidian-style link resolution through paths, names and aliases, fuzzy matching and graph
  building with folder or tag clusters.
- `apps/server`: vault access with atomic writes, `If-Match` conflict detection and a
  `.trash/` folder; a SQLite index with FTS5 search that is synced incrementally and kept
  current by a file watcher; the REST API under `/api` (vault info, tree, notes, links,
  backlinks, search, tags, graph, assets, rebuild) with server-sent index events, an OpenAPI
  document at `/api/openapi.json` and Swagger UI at `/api/docs`.
- `apps/web`: the Phase 1 interface — CodeMirror 6 editor with live preview, `[[`
  autocompletion and image drop, an optional preview pane beside the editor, file tree,
  backlinks, full-text search with snippets, command palette, the bubble graph on a canvas
  (force layout in a worker) with SVG and PNG export, and read-only wiki mode, all in English
  and German with the Humus and Kalk themes.
- Notes can be created from the palette, from a missing link or from a folder in the tree, and
  moved to the vault’s `.trash` folder from the note header.
- Example vault in `examples/vault` with a manifest of what the index must find and an
  acceptance test that checks the server against it.
- Docker image with `/vault` and `/data` volumes; `RHIZOM_VAULT_DIR` and `RHIZOM_DATA_DIR`
  configure the server.

[Unreleased]: https://github.com/lokianer/rhizom/commits/main
