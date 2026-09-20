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
- Rename and move a note, with the links following. A dry run first: which files would change,
  which line each link stands on, and what it would read afterwards. A link that reached the note
  through an alias is left as it is, and so is a short `[[Mira]]` that still finds the note where
  it has moved to — so moving a note into a folder often changes no other file at all. What the
  parser cannot see — reference definitions, raw HTML, links inside HTML comments — is named in
  the dialog rather than silently skipped, and notes sharing a name with either end of the move
  are listed, because those are the links a move can quietly retarget.
- The rename is a batch write under the same rules as "link all": every file carries the hash it
  was read at, a file that changed meanwhile is reported rather than overwritten, and the note is
  moved only after the links have been rewritten — so the identical request run again finishes a
  rename that failed halfway.
- `GET /api/rename` and `POST /api/rename`, in the OpenAPI document with the rest.
- Query blocks: a fenced ` ```rhizom-query ` block is answered from the index. A closed set of
  ten keys — `from`, `type`, `tag`, `title`, `linksTo`, `where`, `sort`, `limit`, `as`,
  `columns` — with literal values and no expression language, because a vault can come from
  anywhere and opening one must never run anything. A block that is partly wrong still answers:
  the rows are what could be read, and each line that could not is named underneath.
- `POST /api/query`, in the OpenAPI document with the rest.
- Milieu fields: a second layout on the graph page that lays the vault out between two freely
  named axes, in the manner of the Sinus-Milieu studies. A field is a note, the way a saved
  search is — `type: axes`, six flat keys naming the two directions, and a query block saying
  which notes stand in it — and every placed note carries its own position as an ordinary
  number from 0 to 100 under the keys the field named. So a field is readable, editable and
  shareable without Rhizom, and nothing goes stale when a note is renamed. Each note is drawn
  as a bubble in the colours the bubble field uses; the notes that give no position wait in a
  tray beside the rectangle saying which value each still owes; and the whole field exports as
  SVG or PNG. Dragging a bubble writes the position back into the note — one write when it is
  let go, carrying the hash the file was read at, so a note that changed on disk meanwhile is
  said so rather than overwritten. `POST /api/query` gained a `fields` argument for it, which
  hands back any frontmatter key a caller names beside the block's own columns.

### Changed

- Smart folders: a note that declares `type: query` is a saved search, and the sidebar shows it
  as a folder that fills itself by running the block inside it. A saved search is therefore a
  file — it travels with the vault, reads without Rhizom and can be edited in any editor, rather
  than living in one browser's storage. The section is not there at all in a vault that keeps
  none.
- Callouts in Obsidian's syntax: `> [!warning] Title` and the twenty-nine spellings that fold
  onto thirteen kinds, with `+` and `-` for a fold that starts open or closed. A folded callout is
  a `<details>`, so it works with JavaScript switched off, and the colours come out of the vault's
  own palette rather than the blue-red-green every other tool uses. A blockquote that names no
  kind stays a blockquote.
- Task lists: `- [ ]` and `- [x]` are drawn with a box, ticked where the note ticked them. Beside
  the editor the box is a control — clicking it writes the tick into the note, through the same
  autosave typing goes through — and in the wiki it stays what it was, a picture of what the file
  says. Only the three characters of the box change; the rest of the line, links and trailing tags
  and indentation, comes through untouched, and a line that is no longer a task is refused rather
  than written into.
- Block references: `[[Note#^abc]]` points at one block of a note and `![[Note#^abc]]` shows it.
  A marker is an id written at the end of a block, the way Obsidian writes one, and it is hidden
  from the reader. What counts as the block is the outermost thing the marker ends — a list item
  rather than the list around it, a whole quotation rather than the paragraph inside it, and a
  whole table rather than the row, because a row cut out of a table is a line with pipes in it.
  Nothing goes into the index: a block embed has the target's own text in hand.
- Find and replace in the editor, with Ctrl/Cmd+F and Ctrl/Cmd+H. The keys were bound from the
  start and the panel they belong to was never installed, so the editor answered them by doing
  nothing at all; it also highlights the other occurrences of whatever is selected.
- Zen mode: the text and nothing else — no header, no sidebar, none of the shelves under the
  editor. Escape leaves it, and it is deliberately not remembered between visits: coming back to
  an application with no interface, and no memory of having asked for that, is a bad morning.
- Vim mode, for those who want it: a palette command switches the editor to Vim keybindings,
  with Vim's own mode line under the text saying which mode it is in. Unlike zen it is
  remembered, because how a person types is a preference and not a mood. The keymap is a
  package of its own and is downloaded the first time the mode is switched on — never by
  somebody who leaves it off — and it goes in and out through a CodeMirror compartment, so
  switching it leaves the text, the undo history and the cursor exactly where they were.
- An outline panel: a fourth tab in the sidebar listing the open note's headings, indented by
  how deep each one hangs rather than by its level number, so a note that starts at `##` is not
  drawn as if a heading were missing. It follows the note as it is written.
- A heading in the address now scrolls the rendered note to it. `[[Note#Heading]]` and the
  outline both navigate to `…#slug`, and the renderer has always put that slug on the heading as
  an id, but nothing read it: the address changed and the page stayed where it was. The app never
  reloads, so the browser never does this by itself.
- Tag hierarchies: the tag panel nests `campaign/silverstadt/npcs` as three levels rather than
  showing one long word, and a level nobody wrote on its own is still there, because that row is
  how you ask for everything below it. Asking for a level now means asking for its whole subtree:
  filtering the graph by `campaign` finds a note that only ever wrote `campaign/silverstadt/npcs`.
- Daily notes: a command that opens today's, making it from the vault's own template when it is
  not there yet. Where it goes and what a day is called come from the vault — the operator's
  `RHIZOM_DAILY_DIR`, Obsidian's `daily-notes.json`, or simply a folder called Daily — so a
  vault brought from Obsidian keeps its arrangement and one that was never opened there works
  anyway. A format holding slashes makes folders, as it does in Obsidian. The command is not
  offered at all in a vault that keeps no daily notes.
- Frontmatter as a form: a fold above the editor showing every key of the open note as a field —
  text, number, yes-or-no, date or list — with keys that can be added and removed. It edits the
  note's own text and saves it the way typing does, so there is one writer and one undo history.
  Everything the form did not touch survives character for character: comments, blank lines, key
  order, quoting style. A nested value is shown and left alone rather than flattened, and a
  frontmatter block nobody can parse is reported instead of rewritten.
- Query blocks are drawn where they stand, in the wiki and in the editor's preview alike: a list
  of note links, a table of the columns the block named, or cards. The links are ordinary note
  links, so a click inside a result navigates like any other. Everything a row carries — a title,
  a folder, a tag, a frontmatter field — is written as text and can never become markup.
- Mermaid diagrams: a ` ```mermaid ` fence is drawn as the diagram it describes, in the wiki and
  in the editor's preview, in the colours of the theme the page is set in — and it follows a
  switch between Humus and Kalk without a reload. Mermaid is the largest dependency this app
  has, so it is fetched only when a note on screen actually holds a diagram: a vault without one
  never downloads a byte of it. It runs with `securityLevel: 'strict'`, because a vault can come
  from anywhere and the text between the fences is somebody else's. A diagram mermaid will not
  read — which a half-written one is on nearly every keystroke — keeps its source on screen and
  says in one muted line what was wrong.
- Case-insensitive comparisons in the index no longer fold only ASCII. SQLite's own `lower()`
  leaves `Ü` alone, so a folder or title in any language but English quietly failed to match; the
  index now registers a `rz_lower` backed by JavaScript, which knows the whole of Unicode.
- Sorting a large vault got a collator instead of `localeCompare`, which builds a fresh one on
  every call. An unfiltered query over 5,000 notes went from 132 ms to 21 ms; the note tree and
  the glossary take the same route.

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

- A note saved as UTF-16 is read as one. It used to arrive as mojibake and, on the next
  autosave, be written back that way over the file it came from. Every note is now written as
  UTF-8, so a vault converges on the one encoding every other tool in its life can read, and the
  text — umlauts, emoji, a family made of several joined together — carries over whole.
- The slash menu opens for a template named in any script, and for one named with an emoji.
- A vault that reads as empty no longer empties the index. A mount point without its mount looks
  exactly like a vault somebody deleted every note from; the first is common and the second is
  rare, so a scan that finds nothing at all now keeps what it knows and says so.
- The notes have one door. `/api/assets/*` served the vault folder statically, so a note could
  be read through it as well — which the listing beside it never offered, and which would go
  around any lock a later phase puts on `/api/notes/*`.
- The published API document has no dangling reference any more: the folder tree, the one schema
  that refers to itself, is now registered by name and carried in `components.schemas`, where a
  validator or a client generator can reach it. Shared schemas are published under their own
  names rather than as `def-0`.
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
