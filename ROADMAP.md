# Roadmap

Rhizom is built in strict phases. Every phase ends in a runnable state with green CI on
Windows, macOS and Linux, updated documentation and clean, atomic commits — and then stops
for review before the next phase begins. Features from later phases are never pulled forward.

Status: **Phase 2 in progress** (Phases 0 and 1 complete).

## Phase 0 — Foundation

- [x] Monorepo scaffolding with pnpm workspaces: `packages/core`, `apps/server`, `apps/web`
- [x] ESLint + Prettier, strict `tsconfig`, Vitest and Playwright each running one smoke test
- [x] Git hygiene: a versioned `commit-msg` hook (simple-git-hooks) that enforces Conventional
      Commits and rejects attribution lines — authorship trailers, "Generated with" banners,
      bot signatures, emoji markers
- [x] GitHub basics: README skeleton (vision, feature overview, screenshot/GIF placeholders),
      `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
      issue and pull request templates
- [x] `ROADMAP.md` with this plan, `CHANGELOG.md` (Keep a Changelog + SemVer), `DECISIONS.md`
- [x] CI workflow with a three-OS matrix; `Dockerfile` + `docker-compose.yml`
- [x] Foundations required "from the start": i18n layer (English default, German second)
      and the theme token skeleton (Humus dark, Kalk light)
- [x] Project landing page in `site/`, deployed to GitHub Pages by a workflow

## Phase 1 — MVP: write, link, see

- [x] Open a vault: choose a folder; the indexer builds the SQLite index (notes, links, tags,
      frontmatter); chokidar keeps it current when files change outside Rhizom (e.g. via Git)
- [x] REST API: note CRUD, search, backlinks, graph data
- [x] Editor: CodeMirror 6 with live preview (Markdown syntax only visible on the cursor line),
      `[[` autocomplete with fuzzy search across all notes, clicking a non-existent link creates
      the note, images via drag & drop into `assets/`
- [x] File tree, backlinks panel, global full-text search (FTS5) with hit preview,
      command palette (Ctrl/Cmd + P)
- [x] Bubble graph: bubble size = link degree; cluster colouring by folder or tag; zoom/pan;
      click opens the note; local graph mode (depth 1–3); filter by tags; export the view as
      SVG/PNG
- [x] Wiki mode: read-only view of the whole vault with rendered links, navigation and search
- [x] Acceptance criterion: a real Obsidian vault can be opened and used in full

## Phase 2 — Knowledge layer and editor expansion

- [x] Definitions: note type `definition` via frontmatter; term and aliases are recognised
      automatically in all notes; hover tooltip with the short definition; automatically
      maintained, alphabetical glossary page
- [x] Unlinked mentions with a one-click "Link all" action
- [x] Transclusion: `![[Note]]` and `![[Note#Heading]]`
- [x] Templates + slash commands (`/table`, `/definition`, `/date`, `/time`) with variables
      (`{{date}}`, `{{title}}`, `{{time}}`, `{{path}}`, `{{cursor}}`, `{{roll:1d100}}`); the
      templates themselves are the notes in the vault's template folder. `/npc` belongs to the
      D&D module in Phase 3, where the NPC template lives.
- [ ] Frontmatter editable as a form
- [ ] Query blocks: a ` ```rhizom-query ` code block renders live tables/lists from the
      index (filter by type/tag/folder/frontmatter fields); saved searches appear as smart
      folders in the sidebar
- [ ] Tag hierarchies (`#campaign/silvercity/npcs`), daily notes
- [ ] Editor expansion: outline panel, callouts, Mermaid, task checkboxes, zen mode,
      optional Vim mode (split view already shipped with Phase 1)
- [ ] Milieu axes mode: two freely named axes; position from frontmatter values or by drag
      (dragging writes the values back); a second graph layout mode with axis labels and export

## Phase 3 — D&D mode (a module, enabled per vault)

- [ ] NPC template: stat block in frontmatter (5e-compatible fields) plus motivation, secrets,
      voice/manner of speech; rendered as a classic stat block
- [ ] Templates for places, factions, items, quests and session logs
- [ ] Typed relationships on graph edges (allied, hostile, related …) with their own colours;
      alignment chart as preconfigured milieu axes (lawful ↔ chaotic × good ↔ evil)
- [ ] Dice: `/roll 2d6+3` with inline result; random generators for names and traits
- [ ] GM-only blocks: marked sections never appear in wiki or publish mode

## Phase 4 — Sharing, permissions, history

- [ ] Multi-user: login, roles, per-folder permissions (read/write); GM content is filtered
      by permissions
- [ ] Publish flag per note: public wiki and private area in the same vault
- [ ] Static export of the wiki as HTML (GitHub Pages-ready); Pandoc export (PDF/DOCX/EPUB)
      when Pandoc is installed
- [ ] Snapshots / version history (optionally Git-based) with diff view; "Random note";
      "On this day"
- [ ] PWA: installable, readable offline, sync on reconnect
- [ ] Graph extras: time-lapse slider (growth of the network over time), heatmap colouring
      (age / activity / word count), orphan view for unlinked notes, pinned bubbles

## Phase 5 — Desktop and ecosystem

- [ ] Electron builds with electron-builder: installers for Windows, macOS and Linux;
      auto-update
- [ ] Published OpenAPI docs, webhooks, CLI (`rhizom new`, `rhizom search`, `rhizom export`)
- [ ] Documented theme system (CSS variables) plus two example community themes
- [ ] Spaced repetition: definitions as flashcards (SM-2 algorithm)
- [ ] BibTeX import and citation insertion
- [ ] Interactive maps: upload an image, place pins, link pins to notes
- [ ] Fantasy calendar (custom months/holidays, events) and initiative tracker
- [ ] Obsidian import assistant for special cases (attachment paths, plugin leftovers)
- [ ] Optional and strictly local: Ollama integration for "related notes" suggestions (opt-in)

## Definition of Done (applies to every phase)

- CI green on all three operating systems; new core logic covered by unit tests, every new
  user flow covered by at least one Playwright test
- README/docs and CHANGELOG updated; no commented-out code, no TODOs without a linked issue
- Performance budget: a vault with 5,000 notes → search < 100 ms, graph smooth at 2,000 nodes,
  editor input latency imperceptible
