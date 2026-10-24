# Handoff — a D&D game-master plugin for Obsidian

Date: 24 October 2026. Written at the end of the last Rhizom session for the agent that starts the
new project. Read all of it before writing code; the "first session" list at the end says what to
do first.

## 1. What happened, and what you are building

The maintainer built **Rhizom** (`github.com/lokianer/rhizom`, AGPL-3.0-only): a self-hosted,
browser-based tool for Markdown vaults, compatible with Obsidian vaults, with a D&D module for
game masters. After three of the module's sub-projects had shipped, the maintainer decided that
Obsidian already does the editor, the vault, sync and the mobile apps well, and that the D&D part
is better built as an **Obsidian community plugin**. Self-hosting — reaching the vault from a
browser or another machine — is handled by **another, existing community plugin** that the
maintainer will choose. It is out of scope here; ask which one it is before you design anything
that has to reach the players (section 6).

Your job: build the **best possible game-master plugin for Obsidian**, carrying over the ideas,
the file conventions and the hard-won edge cases from Rhizom, and **not** rebuilding what mature
plugins already do well.

Rhizom is paused, not deleted. Its repository is the reference for everything below: specs in
`docs/specs/`, plans in `docs/plans/`, the reasons in `DECISIONS.md`, the feature list in
`ROADMAP.md` (Phase 3), and the code in `packages/core/src/` (UI-free TypeScript that runs in a
browser — the parts worth porting).

## 2. Working with the maintainer (carried over from Rhizom; confirm in the first session)

- **Language.** Chat in **German**. Everything in the repository — code, comments, commit
  messages, docs — in **English**. The plugin's UI is internationalised from the start: English
  default, German second.
- **Authorship.** The maintainer is the sole author. **Never** add `Co-Authored-By` trailers,
  "Generated with …" lines, bot signatures or emoji markers to commits, pull requests, the
  changelog or any file. Rhizom enforced this with a `commit-msg` hook; set up the same in the new
  repository and never bypass it.
- **Commits.** Conventional Commits. Few, larger commits: one per finished slice, never one without
  green tests and clean lint. The subject names the change plainly
  (`feat(gate): hide GM callouts in the player export`); the body says what changed, then why,
  then what was deliberately left out. A history rewrite needs the maintainer's explicit choice.
- **Work in phases**, each with a short spec, a plan and a review stop. The maintainer reviews
  between phases. Never pull a feature forward from a later phase.
- **Larger new dependencies** only with a short justification first.
- **Keep docs current**: a roadmap, a decisions log (assumptions and architecture decisions), a
  changelog (Keep a Changelog), and a `HANDOFF.md` rewritten at the end of every session and
  committed with that session's work.
- **Files first, local and private.** The Markdown files are the truth; anything derived can be
  rebuilt. No telemetry, no network calls, no accounts. A vault must stay readable without the
  plugin — every convention below is plain Markdown another editor shows sensibly.
- **Design.** The maintainer judges readability in a dark theme first. Secondary text at least
  16 px, no small italic text. Use Obsidian's CSS variables (`--text-muted`, `--interactive-accent`
  …) so every theme works.
- **The maintainer works on Windows** (Node via nvm-windows, 24.x, pnpm). Two traps from Rhizom:
  heredocs in the Bash tool mangle backslashes (`\n`, `C:\notes`) — write such text with the
  Write/Edit tools; and `netstat` answers in German (`ABHÖREN`), so never grep for `LISTENING`.
- **Agents.** Keep the fleet small; check `git status` after research runs, which tend to drop
  downloads into the repository.

## 3. What already exists in the ecosystem — verify, then integrate, do not duplicate

From memory, as of 2026; **check each one's current state and API before you rely on it**:

| Plugin                                            | Does                                                                                            | What that means for you                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Dice Roller (javalent)                            | Inline `` `dice: 1d8+3` ``, rolling on tables and lists by block reference, rolling from a note | Do not write a second dice roller. Use its syntax in everything you write, and its API if it exposes one, to roll for your features |
| Fantasy Statblocks (javalent)                     | ` ```statblock ` fences, 5e layout and others, a bestiary                                       | Rhizom's NPC template already writes this fence. Write it; let the plugin draw it                                                   |
| Initiative Tracker (javalent)                     | Combat tracker                                                                                  | Out of scope; Rhizom deliberately had none                                                                                          |
| Calendarium (javalent, formerly Fantasy Calendar) | In-world calendars, events                                                                      | Integrate for "two chronologies" (section 5) instead of building one                                                                |
| Leaflet (javalent)                                | Maps with pins                                                                                  | Out of scope                                                                                                                        |
| Dataview / Bases                                  | Queries over frontmatter                                                                        | Obsidian's core **Bases** (`.base` files) may cover ledger-style overviews; prefer it, or Dataview, over building a query language  |
| Templater / core Templates                        | Templates with placeholders                                                                     | Ship your templates as files the user can copy, or insert through core Templates; do not invent a template language                 |

The gap no plugin fills — and the reason the maintainer wanted Rhizom's module — is the
**game-master workflow around secrecy and the session**: GM-only text with reveal markers, "what
have the players met", a player-safe view of the vault, the capture bar, decks, the session spine.
That is the core of your plugin.

## 4. Conventions in the files (port them exactly; vaults already use them)

### The campaign

- A note with `type: campaign` switches the module on for **its own folder and everything below
  it** (a campaign note at the vault root scopes the whole vault). `system:` names the game system,
  free text.
- Inside that scope the module's types count: `npc`, `place`, `faction`, `item`, `quest`,
  `session` (and `deck`, planned). Outside it, `type: npc` is just a key.
- One campaign per vault for now; of several campaign notes the one with the smallest path wins,
  and the others should be reported as ignored. Multiple campaigns per vault are on the wish list
  (section 5) — design data structures so they can come later.
- Reference: `packages/core/src/vault/campaign.ts`.

### Session notes

- `type: session` with a whole number `session: 13` (a string `"13"` counts; anything else does
  not). `date:` is the real-world date. Example: `examples/vault/Campaign/Sessions/` in Rhizom.
- **Tonight's session** is the session note with the highest number. When its `date:` lies before
  today, the plugin offers once to create session N+1 from the session template, dated today, in
  the folder of the last session note; until the GM answers, writes go to the newest one. Anything
  that writes to it always names the target ("→ Session 14").
- Reference: `sessionNumberOf` in `packages/core/src/syntax/gm.ts`; the decision in
  `docs/specs/2026-10-04-at-the-table.md`.

### The GM gate — the security-relevant part

Everything here **defaults to deny**. Read `docs/specs/2026-10-03-gm-gate.md` and
`packages/core/src/syntax/gm.ts` (with `gm.test.ts`) in full before porting.

- **GM callout**: a blockquote whose first line is `[!gm]` — any case, optional `-`/`+` fold
  marker, optional title, optional metadata after `|` (`[!gm|wide]`), spaces inside the brackets
  ignored (`[!GM ]`). Gated **at any depth**: inside a list, inside another quote. The whole
  blockquote goes, with its whole lines.
- **Reveal**: `revealed: 12` anywhere on the callout's first line makes it public from session 12
  on. Any other or no `revealed:` keeps it gated for good.
- **Comment**: `%%…%%`, inline or across lines, outside code — **always** gated, never revealable.
  A `%%` that never closes gates everything after it. A `%%` after a backslash is text.
- **Frontmatter** is never shown to players. It holds alignments and secrets as often as anything.
- An **HTML block** holding either kind of gate is gated whole; the parser cannot see inside it.
- Detection goes through a Markdown parser, so `%%` in a code span or fence is text and `[!gm]` in
  a fence is not a callout. The callout's first line is read twice — raw and as parsed (decoded
  entities such as `&#33;`, a setext underline turning the header into a heading) — and **either**
  reading saying "gm" is enough. Rule: anything the GM sees marked as GM-only must never come out
  public in the player view.
- `publicMarkdown(markdown, session)` returns the note as players may read it at a session
  (session 0 = before the first session: every callout hidden). Use **one** such function for
  everything players can see — view, export, search — so they cannot drift apart.
- Style the `gm` callout in Obsidian with a CSS snippet shipped by the plugin (Rhizom used a rust
  colour), so it reads as a secret in the editor too.

### "Met" — which notes the players know

- At session N the players may read: the session notes up to N; every note inside the campaign that
  one of those session notes links to **from a line that is public by session N** (a link inside a
  gated block does not count); and notes with `public: true` (the literal boolean, nothing that
  merely looks like it). Nothing else exists for them.
- A link to a note they have not met is shown as its words only — no link, no hint where it would
  lead.
- Reference: `visible()` in `apps/server/src/store/public-index.ts`. In Obsidian, build it from
  `app.metadataCache` (links per file with positions) plus your gate ranges.
- **Consequence for anything that writes into a session note** (capture bar, recorded rolls,
  draws): a plain link makes its target met. A link back to the note a roll came from therefore
  goes **inside `%%…%%`**, so rolling on the GM's encounter table does not reveal that table. What
  the roll produced — a card, a table row naming an NPC — is written plainly: it happened at the
  table. This was decided during Rhizom's planning and is not yet built anywhere.

### Dice, rollable tables, decks

- **Dice grammar** (Rhizom `packages/core/src/syntax/dice.ts`, tested): terms `NdM` (N ≤ 100 dice
  in all, M ≤ 1000 sides, ≤ 20 terms), keep highest/lowest `4d6kh3` / `2d20kl1`, constants, `+`/`-`,
  `d%` = d100, whitespace and case ignored. A roll is written as one line:
  `2d6+3 → 11 (4, 4, +3)`, dropped dice struck through (`~~1~~`), a lone die as `d20 → 14`.
  **Prefer Dice Roller** for rolling in the UI; keep this grammar only if you need rolls inside your
  own pure functions (templates, tests) and Dice Roller exposes no API for them.
- **Rollable tables** (Rhizom `packages/core/src/syntax/rollable.ts`, tested): a heading whose text
  names a die as a word of its own (`Rumours (d6)`, `1d20 Encounters`, `Treasure, d%`) makes the
  **first list or table under it, before the next heading**, rollable. A list rolls one item
  uniformly. A table whose every body row starts with a number or range (`1`, `2–4`, `5-6`,
  `97—00`, `00` = 100; any dash) rolls the heading's die and takes the row holding the result; a
  number no row holds is written down as it fell, never silently rerolled. Any other table rolls a
  row uniformly. Empty rows are skipped. Entries keep their source text, so a `[[link]]` in a row
  is still a link when recorded. Recorded as `Weather, 1d8 → 6: Rain, and the [[Lantern Bridge]]
slick`. Compare with how Dice Roller rolls tables and decide with the maintainer whether the
  heading convention is worth keeping beside it.
- **Template table**: `{{table:Note#Heading}}` (or `{{table:[[Note#Heading]]}}`) rolls that table
  when a template is used, so a generated name lands in the new note.
- **Decks** (spec only): a note with `type: deck` inside the campaign. Its cards are the items of
  its **first task list**: an open item is in the deck, a ticked one has been drawn. Draw ticks a
  random open item and records it in tonight's session note; Shuffle unticks all of them. The state
  lives in the file. A card that is a wikilink links to its own note. Show "N of M left", Draw,
  Shuffle in the reading view.

### Writing into notes safely

- Edit lines, never re-serialise a note: a Markdown round trip reflows the author's text. Rhizom's
  `setTask` (`packages/core/src/syntax/tasks.ts`) ticks a box by changing three characters of one
  line and refuses a line that is not a task.
- Rhizom saved with the hash the note was read with, so a concurrent edit became a conflict and
  never an overwrite. In Obsidian use **`app.vault.process(file, fn)`** (atomic read-modify-write)
  for every write, and `app.fileManager.processFrontMatter` for frontmatter.
- Appending to the session log: a line under a `## Log` heading, made at the end of the note when
  missing (decide the German heading name with the maintainer). Loot goes into a `## Loot` table
  (`| Item | Who has it |`), made when missing; the session template already has one, with one
  empty row that a first entry should replace.

### Templates

Rhizom ships built-in templates in English and German for NPC, place, faction, item, quest and
session log — see `packages/core/src/vault/campaign-templates.ts`. Port them; the NPC template ends
in a Fantasy Statblocks fence. Offer them in the interface language; a vault template of the same
name replaces the built-in one.

## 5. Feature list, from Rhizom's Phase 3 — your raw material

Done in Rhizom (port the logic): campaign note and scope; templates; stat block fence; GM gate with
reveals; player view with session slider and met-only links.

Specified, not built (`docs/specs/2026-10-04-at-the-table.md`): capture bar (one keystroke opens
one line; plain text → `- 21:14 text` in the log; `/roll`, `/draw [[Deck]]`, `/table [[Note#H]]`,
`/loot Brass key, Ilex`, `/know [[Name]]` → `- The party now knows [[Name]].` which makes it met,
`/npc Name` → stub note from the NPC template in the campaign's `NPCs` folder plus a log line);
dice chips that record; Roll buttons on table headings; decks.

Listed in `ROADMAP.md` Phase 3, not specified yet — read the full wording there:

- Typed relationships (`allies:`, `owes:`, `serves:`) as coloured, directed ties, with a panel for
  one-sided or contradictory ones; blocs (allied ties pull, hostile ties push) in a graph.
- Axis packs: alignment on the nine boxes read from and written to `alignment:`; danger × distance;
  known × true (what the party believes beside what is so).
- Acquaintance colouring: met / heard of / unknown; sessions since last seen.
- Clocks: `Clock: The fire spreads 4/6`, ticked by clicking a segment, one panel sorted by how close
  each is to going off. Faction standing summed from session notes, never written back.
- Session spine: previous/next, "first seen here" per session, a "Previously on" page.
- Improv drawer for a place or NPC: who is here, what they want, open hooks, last three sessions,
  clocks nearby.
- Party ledger: loot tables across session notes rolled into one list (held, sold, spent, promised,
  where from). A view; edited where written. Bases may do this.
- Second half: `type: character`; `type: scene` between sessions; who was told (`told: Ilex`) and a
  per-player view; cold threads; `retired:`; two chronologies (`in_world:`, via Calendarium);
  several campaigns per vault; system packs (layout and lookup, never formulas); encounter notes;
  stat blocks that change over sessions; rulings (`> [!ruling]`, `supersedes:`); reference import
  from local files with licences; lines and veils (`type: safety`, anonymous by design); handouts.

Rhizom's stance throughout: **no rules engine.** Dice are dice; nothing is computed from a stat
block. It is not a virtual tabletop.

## 6. Open decisions — settle these with the maintainer before building

1. **Which self-hosting plugin**, and therefore how players see anything. Options: (a) the plugin
   writes a **player export** — `publicMarkdown` of every visible note into a separate folder or
   vault, links to unmet notes flattened, frontmatter dropped, regenerated on demand — which the
   self-hosting plugin then serves; (b) a player **mode** inside Obsidian (a view that renders the
   public side), for a shared screen at the table; (c) both. (a) is the only one that reaches the
   players' own devices. Whatever is exported must go through the one gate function, and the export
   folder must never be inside the campaign's own scope (or it would be read as campaign notes).
2. **Scope of the first release**: the recommendation is gate + reveals + met + player export first
   (the thing nobody else does), then the capture bar and decks, then the rest of section 5.
3. **Dice**: depend on Dice Roller (declared as optional; degrade gracefully when it is missing) or
   keep a small own roller for recording. Recommendation: Dice Roller for UI rolls, the small pure
   grammar only where you must roll inside a function.
4. **Licence.** Rhizom is AGPL-3.0-only and the maintainer is its sole author, so porting code from
   it is theirs to licence; ask which licence the plugin gets (MIT is common for Obsidian plugins).
5. **Name and plugin id** (the id cannot contain "obsidian" and cannot change after release).
6. **Default hotkeys.** Obsidian's guidelines ask plugins not to set default hotkeys; the capture
   bar was meant for Ctrl/Cmd+J. Register the command without one and document the suggestion.

## 7. Technical guidance for an Obsidian plugin

- Start from the official sample plugin (TypeScript, esbuild). `manifest.json`, `versions.json`,
  releases on GitHub carrying `main.js`, `manifest.json`, `styles.css`; submission through a pull
  request to `obsidianmd/obsidian-releases`. Read the current plugin guidelines and the submission
  checklist before the first release — they change.
- **Mobile**: keep `isDesktopOnly: false` unless a feature truly needs Node; no `fs`, no
  `child_process`, no Node `path` — use `normalizePath` and the vault API. A GM uses a tablet at the
  table.
- **Rendering**: reading view through `registerMarkdownPostProcessor` and
  `registerMarkdownCodeBlockProcessor`; Live Preview through `registerEditorExtension` (CodeMirror 6
  view plugins / decorations). Rhizom's lesson: core logic marks, the view decorates — keep the
  pure functions free of DOM so they can be unit-tested in Node.
- **DOM**: never `innerHTML` with note content; build with `createEl` / `createDiv`. A vault is
  somebody else's file.
- **Data**: `app.metadataCache` for frontmatter, links (with positions), headings and list items;
  listen to `metadataCache.on('changed' | 'resolved')` and `vault.on('rename' | 'delete')`, and
  register every listener with `this.registerEvent` so unload cleans up. Cache derived state (met
  sets, gates) per file and invalidate on change; do not re-scan the vault on every keystroke.
- **Writes**: `vault.process` for every edit, `fileManager.processFrontMatter` for frontmatter,
  `fileManager.generateMarkdownLink` / `metadataCache.fileToLinktext` for links, so the user's link
  format setting is respected.
- **i18n**: detect the interface language (`getLanguage()` in current APIs, `moment.locale()` in
  older ones), two string tables, English default, German second; templates are data in both
  languages, like Rhizom's.
- **Tests**: Vitest for the pure modules (the gate, met, dice, tables, decks, log edits, capture
  parsing); port Rhizom's tests with them — `gm.test.ts` holds the adversarial cases. Keep
  coverage high on the gate. Obsidian's API is not available in tests; isolate it behind thin
  adapters.
- **Performance**: a campaign vault can hold thousands of notes. Computing "met" should touch only
  session notes and their links; the gate is per file and cacheable.
- **CI**: GitHub Actions on ubuntu/macos/windows, lint (eslint, plus `eslint-plugin-obsidianmd` if
  current), typecheck strict, tests, build.

## 8. What to port from Rhizom, file by file

| Rhizom file                                                           | Port?                    | Notes                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/syntax/gm.ts` + test                               | **Yes, first**           | Depends on unified/remark-parse/remark-gfm/remark-frontmatter/mdast-util-to-string; justify the bundle size or reimplement on Obsidian's own parse data (sections and positions from `metadataCache`) — but keep every test case passing either way |
| `apps/server/src/store/public-index.ts` (`visible`)                   | Logic only               | Rewrite over `metadataCache`                                                                                                                                                                                                                        |
| `packages/core/src/vault/campaign.ts` + test                          | Yes                      | Tiny                                                                                                                                                                                                                                                |
| `packages/core/src/vault/campaign-templates.ts`                       | Yes                      | EN + DE templates                                                                                                                                                                                                                                   |
| `packages/core/src/syntax/dice.ts`, `rollable.ts` + tests             | If needed                | See decision 3                                                                                                                                                                                                                                      |
| `packages/core/src/syntax/tasks.ts` + test                            | Yes                      | Line edit for decks                                                                                                                                                                                                                                 |
| `packages/core/src/syntax/template.ts` (`{{table:}}`, `tableTargets`) | Maybe                    | Only if you expand templates yourself                                                                                                                                                                                                               |
| `packages/core/src/render/statblock*.ts`                              | No                       | Fantasy Statblocks draws the fence                                                                                                                                                                                                                  |
| Everything server, graph, WebGL, editor                               | No                       | Obsidian provides it                                                                                                                                                                                                                                |
| `docs/specs/*gm-gate*`, `*at-the-table*`, `*campaign-module*`         | Read                     | The reasoning behind every rule above                                                                                                                                                                                                               |
| `DECISIONS.md`                                                        | Read the Phase 3 entries | Why things are the way they are                                                                                                                                                                                                                     |

## 9. The first session

1. Ask the maintainer (in German) the open decisions in section 6, at least 1, 2, 4 and 5.
2. Read Rhizom's `docs/specs/2026-10-03-gm-gate.md`, `docs/specs/2026-10-04-at-the-table.md`,
   `packages/core/src/syntax/gm.ts` and `gm.test.ts`, and the Phase 3 section of `ROADMAP.md`.
3. Check the current state of Dice Roller, Fantasy Statblocks, Calendarium and Bases, and of the
   self-hosting plugin the maintainer names; write what you found into the decisions log.
4. Scaffold the repository: sample plugin, pnpm, strict TypeScript, Vitest, eslint, prettier, the
   `commit-msg` hook against attribution lines, CI on three systems, `README.md`, `ROADMAP.md`,
   `DECISIONS.md`, `CHANGELOG.md`, `HANDOFF.md`, a `CLAUDE.md` carrying section 2.
5. Write the roadmap (phases) and the first spec — the gate and the player export — and stop for
   the maintainer's review before building it.
