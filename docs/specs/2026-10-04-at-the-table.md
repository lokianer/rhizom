# At the table: dice, tables, decks and the capture bar

Date: 2026-10-04
Status: approved for planning

## Why

During a session the game master's hands are full. What happens at the table — a roll, a card, a
name, a line of loot — should land in tonight's session note in one keystroke, and the tables and
decks a vault already holds should be rollable where they stand. Everything written goes into
plain Markdown: the session note is the record of the evening.

## Decisions

- **Tonight's session note** is the campaign's session note with the highest number (sub-project 3's
  rule). When it has a `date:` before today, the capture bar offers once to make session N+1 from the
  built-in session template, dated today, in the folder of the last session note; until the GM
  says yes or no, writes go to the newest one. The bar always names its target ("→ Session 14").
  (Maintainer's choice A.)
- **Writing** to a session note appends a line under a `## Log` heading (made at the end of the
  note when missing), read, appended and saved with the hash the note was read with, so a
  concurrent edit is a conflict, never an overwrite.
- **No rules engine.** Dice are dice: `NdM`, sums of terms and a constant, keep highest/lowest
  (`4d6kh3`). Nothing is computed from a stat block.

## Dice

- `parseDice(notation)` / `rollDice(notation, random)` in core: terms `NdM` (N ≤ 100, M ≤ 1000),
  `kh`/`kl` keep, constants, `+`/`-`; whitespace ignored; `d%` is `d100`. The result carries the
  total, every die and which were kept, and a one-line text: `2d6+3 → 11 (4, 4, +3)`.
- `{{roll:…}}` in templates uses the same parser.
- Slash command `/roll 2d6+3` writes the result line at the cursor.
- An inline code span `` `dice: 1d8+3` `` is drawn in the reader as a chip that rolls where it
  stands and shows the result beside it; the chip's record action appends the result line to
  tonight's session note with a link back to the note it was rolled in.

## Rollable tables

- A heading whose text names a die (`d20`, `1d6`, `d100`, `d%`) makes the first list or table under
  it rollable. An ordered or unordered list rolls one item, uniformly. A table whose first column
  holds numbers or ranges (`1`, `2–4`, `5-6`, `00` for 100) rolls the die and picks the row whose
  range holds it; a table without ranges rolls a row uniformly.
- The reader draws a Roll button on such a heading; the result is highlighted in place and can be
  recorded like a dice roll.
- `{{table:Note#Heading}}` in a template rolls that table when the template is used, so a
  generated name arrives in the new note. The app fetches the referenced notes before expanding.

## Decks

- A note with `type: deck` (inside the campaign) is a deck. Its cards are the items of its first
  task list: an open item is in the deck, a ticked one has been drawn. Drawing ticks a random open
  item and records it; shuffling unticks all of them. The state lives in the file, so it survives
  everything and shows in any editor.
- A card that is a wikilink links to its own note.
- The reader draws Draw and Shuffle buttons on a deck note, and says how many cards are left.

## The capture bar

- One keystroke (Ctrl/Cmd+J) opens a one-line bar over any page of the GM lens; Enter files the
  line and closes it; Escape closes it. No modal, no dialog.
- What a line becomes:
  - plain text → `- 21:14 text` in the log;
  - `/roll 2d6+3` → the roll's result line;
  - `/draw [[Deck]]` → a draw from that deck;
  - `/table [[Note#Heading]]` → a roll on that table;
  - `/loot Brass key, Ilex` → a row in a `## Loot` table of the session note (made when missing);
  - `/know [[Name]]` → `- The party now knows [[Name]].`, which makes the note met;
  - `/npc Name` → a stub note from the built-in NPC template in the campaign's `NPCs` folder (or
    the campaign folder), and a log line linking it.
- Flipping a specific GM block to revealed from the bar is left out: which block is meant is not
  something one line can say. `revealed:` is written in the note.

## Not part of this sub-project

The second half's encounter budgets, system packs, a dice roller with exploding dice or pools,
named reveals.

## Tests

- Unit (core): the dice grammar, keep, limits, the text; rollable-table detection for lists, range
  tables and plain tables; range parsing; deck parsing, draw and shuffle as text edits; the log
  append and loot-row edits; `{{table:}}` expansion; capture-line parsing.
- Unit (web): tonight's-session choice and the N+1 offer.
- Playwright: a dice chip rolls and records; a table under a `d6` heading rolls; drawing a card
  ticks it in the file and logs it; the capture bar files a line, a roll and a loot row.
