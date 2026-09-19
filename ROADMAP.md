# Roadmap

Rhizom is built in strict phases. Every phase ends in a runnable state with green CI on
Windows, macOS and Linux, updated documentation and clean, atomic commits — and then stops
for review before the next phase begins. Features from later phases are never pulled forward.

Status: **Phase 2 in progress** (Phases 0 and 1 complete).

Versions: everything up to the end of Phase 5 is `0.x`. The format a vault is written in may
still move in that stretch, and every move comes with a note in the changelog. The end of
Phase 5 is **1.0**: from there the files a vault holds are a promise, and what they mean
changes only with a documented migration.

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
- [ ] Rename and move a note, with every link that points at it rewritten: a dry run that says
      which files would change, then the same rules the "link all" batch works under — a
      mandatory hash per file and a file that changed meanwhile reported rather than overwritten
- [ ] Frontmatter editable as a form
- [ ] Query blocks: a ` ```rhizom-query ` code block renders live tables/lists from the
      index (filter by type/tag/folder/frontmatter fields); saved searches appear as smart
      folders in the sidebar. A closed set of keys and no expression language: a query is read
      by the index, never evaluated as code out of somebody else's vault
- [ ] Tag hierarchies (`#campaign/silvercity/npcs`), daily notes
- [ ] Editor expansion: outline panel, callouts, Mermaid, task checkboxes, zen mode,
      optional Vim mode (split view already shipped with Phase 1)
- [ ] Milieu axes mode: two freely named axes; position from frontmatter values or by drag
      (dragging writes the values back); a second graph layout mode with axis labels and export.
      Dropping a note is the one gesture in Rhizom that changes a file by itself, so it writes
      with the hash the note was loaded at and swallows the echo the watcher sends back

## Phase 3 — D&D mode (a module, enabled per vault)

_The module is a vocabulary, not a second programme: templates, a handful of frontmatter keys,
a few renderers and a graph colouring. It is system-agnostic — 5e is one stat block renderer
among several — and it is not a virtual tabletop: no battle map, no tokens, no combat tracker._

- [ ] The module is switched on by a note: `type: campaign` in the vault root names the system and
      enables the module's vocabulary. Its types (`npc`, `place`, `faction`, `item`, `quest`,
      `session`) count only while it is on, so the globally reserved set stays the four of Phase 2
- [ ] NPC template: stat block in frontmatter (5e-compatible fields) plus motivation, secrets,
      voice/manner of speech; rendered as a classic stat block. Keys of a system we have never
      heard of are laid out in the order they were written rather than refused, and the block is
      addressable as `![[Mira's Ledger#statblock]]`, so a prep note embeds it instead of copying it
- [ ] Templates for places, factions, items, quests and session logs
- [ ] GM-only blocks: `> [!gm]` for a section and `%%…%%` for a sentence — an Obsidian callout, so
      another editor shows a marked quote rather than a secret. Visibility is decided once, when a
      note is indexed (a public title and body, a second FTS table), and wiki, search, backlinks,
      graph, glossary and export read only the public side; the gate defaults to deny
- [ ] Reveal markers: `> [!gm] revealed: 12` says the party learnt this in session 12, so one mark
      answers both "may this be shown" and "have they been told". The derived `reveals` rows are
      rebuilt from the files like everything else
- [ ] Player view: the vault as the table knows it — unrevealed blocks gone, links to notes they
      have never met flattened to plain text, and a session slider that shows the vault as it stood
      in session 9. Read-only, and honest about being a view: the lock is Phase 4, not this
- [ ] Capture bar: one line over any note that appends to tonight's session note without leaving
      the page — a sentence, a roll, "they now know X" (which flips a reveal), a loot row, a name
      that becomes a stub. One keystroke to open, one to file, no modal
- [ ] Dice and tables: `/roll 2d6+3` with inline result and an inline `dice: 1d8+3` chip that rolls
      where it stands; roll-and-record appends the result to the session note. Any ordered list or
      range table under a `d20`-style heading is rollable, `{{table:Tables/Names#Surnames}}` rolls
      one at insert time, and a generated name or trait arrives in a note rather than in a message
- [ ] Decks: a table is rolled with replacement, a deck is not. A note listing cards — a Deck of
      Many Things written by hand, a deck of complications, rumours, weather or hooks — is drawn
      from with one click, and what has been drawn stays drawn until the deck is shuffled again.
      The draw goes into the session note the way a roll does, so the run of the evening is on
      record; a drawn card links to its own note where one exists, so the card is a place to read
- [ ] Typed relationships from frontmatter lists the vault names itself (`allies:`, `owes:`,
      `serves:`): each is a directed, coloured graph edge and a rendered "Ties" block. Eight
      colours at most, the ninth relation stays neutral, direction is drawn and reciprocity is
      never invented — with a panel for ties that are one-sided or contradict each other
- [ ] Blocs: allied ties pull, hostile ties push, everything else behaves as a link does today, so
      a faction map arranges itself into sides. Behind the size threshold the layout already uses
- [ ] Axis packs as notes: alignment (read from and written back to the `alignment:` string,
      snapping to the nine boxes), danger × distance, and known × true — where a note carries what
      the party believes beside what is so and the field draws the pair as an arrow
- [ ] The field coloured by acquaintance: met, heard of, unknown, where met means a session note
      links it; a second mode shades by sessions since last seen. The export omits the unmet notes
      instead of dimming them, because the export is what you actually show players
- [ ] Clocks and standings: `Clock: The fire spreads 4/6` in a quest, place or faction note, ticked
      by clicking a segment (carrying the file's hash), with one panel sorted by how close each is
      to going off. A faction's standing is the sum of what the session notes recorded, never a
      number written back into the faction
- [ ] The session spine: sessions ordered by `session:` or a date, previous and next between them,
      and a derived "first seen here" list per session; "Previously on" assembles the last
      session's beats, the open quests and the clocks that ticked into a page readable at arm's
      length
- [ ] Improv drawer for a place or an NPC: who is here, what each of them wants, every unchecked
      hook one link away, the last three sessions that touched it, the clocks nearby
- [ ] Party ledger: the loot tables in the session notes rolled up into one list — held, sold,
      spent, promised, and the session each item came from. A view; a row is edited where it was
      written

_The second half of the module: what it grows into once those sixteen stand — the people at the
table and the weeks between sessions, a campaign that has run for years beside a second one in the
same vault, and the mechanical half, which stays a layout and a lookup table and never a rules
engine._

- [ ] The people at the table: `type: character` for the player characters — player name, the four
      or five numbers you ask for mid-session, bonds and flags as links, and `sheet:` pointing at
      wherever the real sheet lives. The keys render as written; Rhizom never computes a number
- [ ] The week between sessions: a `type: scene` note with `between: 12, 13` and its participants
      sits on the spine and counts for reveals exactly as a session does, and a downtime note beside
      it holds one task per character with an owner and an outcome. Pasted text only, no bot
- [ ] Who was told, not only when: a gated block may name people (`> [!gm] told: Ilex, Orrin`) and
      the player view renders for one of them; sessions name who was present, so the page for a
      player who missed two of them is the same view over exactly the sessions they missed
- [ ] Cold threads: every unchecked hook and open quest sorted by how many sessions have passed
      since anything touched the note it lives in, grouped by place or faction — two years in, a
      dropped thread does not announce itself
- [ ] The shelf: `retired: 2026-05-02` on material the campaign has finished with. It keeps its
      links and backlinks, drops out of search ranking, the field and the improv drawer, and comes
      back by deleting the line — retired is about what is in play, never about what a player sees
- [ ] Two chronologies: `in_world: 14 Thawrun 1247` beside the real `date:`, ordered by the month
      names the campaign note lists, so the spine reads both ways after a flashback; a `type: event`
      with `when:` and `status:` lists what falls due. Ordering only — arithmetic is Phase 5
- [ ] More than one campaign in a vault: several campaign notes each scoping a folder, one current,
      `ended:` stopping the counting while its notes stay searchable, a selector that says how many
      notes it narrows away, and `revealed: hollow-crown/12` — decided before the reveal item ships
- [ ] System pack (`type: system`): one note per game system saying which stat keys exist, in what
      groups and order, which are rollable and which named Markdown tables may be looked up. Layout
      and lookup, never a formula; Rhizom ships an empty skeleton and no numbers of its own
- [ ] Encounter note: party size and level plus creatures as wikilinks with counts, costed against
      the thresholds in the system pack — a pack may say the system has no budget, and the panel is
      then absent rather than wrong. It renders as one page for the table and keeps no state at all
- [ ] Stat blocks that change: a second `## statblock — after session 12` heading in the same note
      holds the numbers as they are now; the renderer shows the latest, offers the earlier ones and
      diffs two, and a prep note embeds the version it means with the heading transclusion it has
- [ ] Rulings: `> [!ruling]` in a session note records what the table decided and what about; the
      index collects every one into a searchable page and a later ruling `supersedes:` an earlier
      one without deleting it. Rules are somebody else's text, rulings are the vault's own
- [ ] Reference import from a file already on disk, never over the network: one note per monster or
      spell carrying `license:` and `source:`, a licence note per folder, nothing written whose
      profile cannot name a licence, and a second run that touches only what the first run wrote
- [ ] Lines and veils in a `type: safety` note, with what actually came up logged by date and never
      by name; prep is checked against the list at index time, so a note tagged with something on it
      is flagged before you run it. Anonymity is the feature — the format cannot record who asked
- [ ] Handouts: `type: handout` refuses to index as one while the note holds a gated block, prints
      as a single sheet with the images inlined and the wiki chrome gone, and records `handed_out:`
      with the session. One note and the browser's print; the site builder stays in Phase 4

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

## Phase 6 — Everything after

_Open-ended: what the tool needs once it stands on its own, in the order a one-person project can
carry it — robustness first, reach afterwards. Nothing here starts while an earlier phase is open._

- [ ] Vault health report: unresolved and ambiguous links, orphans, duplicate note names,
      frontmatter that failed to parse (the note stays indexed and flagged, never dropped), files
      too large to index, broken embeds, assets nothing references, duplicate uploads. It links to
      each note and never repairs; `rhizom doctor` prints the same thing
- [ ] Sync-conflict files: recognise what Dropbox, Syncthing and Nextcloud leave behind instead of
      indexing it as an ordinary note, group them, diff them against the original and keep one
- [ ] Start and keep answering: serve while the first index builds (progress over the existing
      event stream instead of a dead port), build a new index beside the old one after a schema
      bump, rebuild on `SQLITE_CORRUPT` as a version mismatch already does, and refuse a second
      Rhizom on the same data directory with a lock file rather than a confusing failure later
- [ ] Never lose text when the disk says no: a vault on a read-only mount opens read-only with a
      banner and autosave off, an unwritable data directory falls back to an in-memory index with a
      warning, and a full disk says so and stops saving instead of retrying in a loop
- [ ] Vaults that are not a local disk: a polling switch for SMB and NFS, `ENOSPC` from inotify
      reported with the sysctl that fixes it and an automatic fallback to polling, a warning before
      the first scan hydrates a cloud-placeholder folder, and a README paragraph that says plainly
      where this is tested and where it is not
- [ ] Identity across platforms, and what counts as a note: a case-folded path with a collision
      check (Linux vaults can hold both spellings; Windows and macOS cannot), the on-disk name kept
      beside the NFC key so an NFD vault from a Mac resolves, a byte cap above which a file is
      listed and searchable by title but not indexed, and symlinks decided once — off by default in
      both the scanner and the watcher
- [ ] Draft recovery: the working document kept per browser with the hash it was loaded at and
      offered back after a crash with a diff against the file. It is a draft, never a source, and
      it expires
- [ ] Backup, said out loud: the vault is the backup, so mostly a documented paragraph — plus a
      manifest of SHA-256 per file that `sha256sum -c` can read, `rhizom verify` against it, a
      "download the vault as a zip" button for someone with no backup habit, and a retention
      setting for `.trash`, which lives in the vault and otherwise syncs every deleted note forever
- [ ] Vault settings note (`type: settings`): what belongs to the material rather than to the
      browser — default theme, date and time format, template folder, cluster colours, the vault's
      content language, publish defaults. Paths to local binaries stay environment variables
- [ ] The format, written down: one document listing everything Rhizom ever writes into a file, a
      fixture vault another implementation could check itself against, and `rhizom eject`, which
      reports every Rhizom-specific mark in a vault and strips the ones that are not content
- [ ] Accessibility pass over every surface, kept by an automated check in the Playwright run: the
      bubble field gets a parallel reading — arrow keys along links, a spatial list in axis order,
      degree and cluster announced — so the canvas is one view of the data and not the only way in
- [ ] Scale, measured rather than hoped: a vault generator, a benchmark harness for first build,
      save, search and graph, and a CI job that fails on a regression, with a published budget at
      20,000 notes and the virtualisation and pagination the numbers ask for. Above that the field
      aggregates into meta-bubbles by folder or tag, caches its settled layout and says on screen
      how many notes it is drawing
- [ ] Git sync made boring, for the many vaults that are already repositories: status in the status
      bar, commit and push on a timer, and a conflict that is refused and explained with the exact
      commands rather than merged. For two people at once, a banner saying who else has the note
      open — not live co-editing, which would supersede the whole-document save and can lose text
- [ ] The inbox: a watched folder any program can drop a file into, a capture endpoint behind a
      token (never before Phase 4's authentication), and a bookmarklet — no browser extension, no
      store. An arrival is a file from the first instant; filing rules turn it into a note
- [ ] `rhizom build`: the whole vault as a deployable static site — wiki, glossary, prebuilt
      search, the field as a working canvas — with private notes and GM blocks absent from the
      output rather than hidden, and a test that greps the build for a known secret. A trail note
      (`type: trail`) is an ordered list of links, so the site has a way in that somebody chose
- [ ] Local models behind one setting, the base URL of a runner on the user's own machine, empty by
      default and switchable per feature: semantic search beside the full-text search, and axes
      defined by two poles written as sentences, whose positions are a provisional layer until
      accepted note by note with a diff. The same contract serves a local transcriber for audio
- [ ] Extensibility as data: a module is a folder plus a manifest note declaring which `type`
      values exist, which keys are ties, which are axes and which blocks are private, so a
      historian or a lab can have what the D&D module has without anyone running code from a
      vault. If hooks are ever needed they are two, and they load from the operator's data
      directory
- [ ] Longform: a note that is an ordered list of `![[…]]` embeds is already a manuscript — give it
      word counts per section and in total, a focus view, and a compile that flattens the embeds
      into one file. Reordering is editing the list, which is what files first means
- [ ] Beyond two languages: ICU plurals instead of the two-form assumption, locale-aware dates, and
      a documented extraction and review workflow so a third locale can be contributed and stay
      current. Right-to-left is declared unsupported until someone who reads it can test it
- [ ] Packaging, so it can actually be installed: signed and checksummed releases with an SBOM, and
      three targets owned with a CI job each that proves they install — Docker, a Nix flake and a
      Homebrew formula. NAS templates are published as community-maintained, in those words

## Definition of Done (applies to every phase)

- CI green on all three operating systems; new core logic covered by unit tests, every new
  user flow covered by at least one Playwright test
- README/docs and CHANGELOG updated; no commented-out code, no TODOs without a linked issue
- Performance budget: a vault with 5,000 notes → search < 100 ms, graph smooth at 2,000 nodes,
  editor input latency imperceptible
