# At the table — implementation plan

**Spec:** `docs/specs/2026-10-04-at-the-table.md`. Inline execution, TDD per task, three slices with
one commit each (`feat(dice): …`, `feat(decks): …`, `feat(capture): …`), then one fresh review of
the whole branch and the full local CI sequence before the PR.

## Decisions taken while planning

- **The reader decorates, core marks.** Core never emits a `<button>`: the player view renders
  through the same pipeline and must not offer to roll. Core writes markers that survive
  sanitising (`span.rz-dice[data-dice]`, `data-roll-line` on a heading, `data-roll-for` on the
  list or table it rolls); `NotePreview` adds the controls in an effect after each render, the way
  it already turns task checkboxes into controls.
- **A recorded line never reveals its source.** A link in a session note makes its target met.
  The link back to the note a roll came from goes inside `%%…%%`, which the gate hides and which
  counts for nothing, so rolling on the GM's encounter table does not hand the table to the
  players. What the roll produced — a card, a table row that names an NPC — is written plainly:
  it happened at the table.
- **Tonight's session is found through the query endpoint** (`where: { type: session }`, columns
  `session` and `date`, scoped to the campaign folder) rather than a new GM route. The choice is a
  pure function in the web app.
- **`/roll` in the editor** is a second completion source: the slash menu's `roll` entry writes
  `/roll `, and once the text after it parses, the menu offers the roll; Enter writes the line.
- **Sentences the app writes into a note** ("Drew … from …", "The party now knows …") come from
  i18n, like the templates come in the interface language. The dice and table lines are language
  free.
- **`d` sides ≤ 1000** where `{{roll:}}` used to take up to 9999. One grammar for both; noted in
  `DECISIONS.md`.

## Slice 1 — dice and rollable tables

1. **Dice** — `packages/core/src/syntax/dice.ts`: `parseDice`, `rollDice`, `describeRoll`; terms,
   keep, `d%`, limits (100 dice in all, 1000 sides, 20 terms). `roll()` in `template.ts` moves onto
   it. Tests.
2. **Rollable tables** — `packages/core/src/syntax/rollable.ts`: `dieOfHeading`, `parseRange`,
   `findRollables(markdown)`, `rollTable(rollable, random)`, `describeTableRoll`. Tests for lists,
   range tables (`2–4`, `5-6`, `00`), plain tables, nothing under the heading, a heading in a
   callout.
3. **Template tables** — `{{table:Note#Heading}}`: `TemplateContext.tables`, `tableTargets(source)`.
   Tests.
4. **Render markers** — the dice chip and the rollable marks in `transform.ts`, the sanitise
   schema. Tests in `note.test.ts`.
5. **Web** — `/roll` (slash, tests in `slash.test.ts`); `{{table:}}` prefetch in the slash menu and
   the new-note dialog (`editor/template-tables.ts`); `NotePreview` chips and Roll buttons, the
   highlighted row; the session log writer (`session/`) with tonight's choice and the record
   action; i18n; styles.
6. **Example vault** — a `dice:` chip and a `d6` rumour table. e2e `dice.spec.ts`.

## Slice 2 — decks

1. **Core** — `packages/core/src/syntax/deck.ts`: `deckCards`, `drawCard`, `shuffleDeck` as line
   edits through `setTask`; `deck` joins `CAMPAIGN_TYPES`. Tests.
2. **Web** — the deck bar in `NotePreview` (cards left, Draw, Shuffle); edits go through the page's
   writer (draft in the editor, a hashed save in the wiki); a draw is recorded.
3. **Example vault** — `Campaign/Decks/Weather.md`. e2e `deck.spec.ts`.

## Slice 3 — the capture bar

1. **Core** — `parseCapture(line)`; `appendLog`, `addLootRow` as section edits. Tests.
2. **Web** — `tonightsSession` and `nextSession` (unit tests); `CaptureBar` in the layout,
   Ctrl/Cmd+J, the N+1 offer, the seven kinds of line; `/npc` from the NPC template.
3. e2e `capture.spec.ts`.

## Review focus

1. A recorded line linking a GM note in the open, and with it a note reaching the player view.
2. A write to the session note racing the open editor on the same note: conflict, never loss.
3. Range tables with gaps, overlaps, `00`, and a die whose total no row holds.
4. Markers inside an embedded note pointing at the host's lines.
5. The capture bar on the player view, or anything new under `/v/<id>/table`.
