# The campaign module: a campaign note, the stat block and the templates

Date: 2026-10-03
Status: implemented 2026-10-03

## Why

Phase 3 is a module, not a second programme: a vocabulary of a few frontmatter values, a
renderer and some templates, switched on by a note. This sub-project lays its floor — the
campaign note that turns the module on, the stat block every later item refers to, and the
templates a game master starts notes from. The GM gate, dice, ties and the session spine build on
it in later sub-projects.

## Decisions taken with the maintainer

- The stat block is a ` ```statblock ` fence in the note body, written in the layout of the
  Obsidian plugin Fantasy Statblocks, not a frontmatter map. A vault that uses the plugin opens
  with its stat blocks drawn; later versions of a stat block sit under headings, which a fence can
  and frontmatter cannot. This departs from the roadmap's "stat block in frontmatter".
- A campaign note scopes its own folder and everything below it; one at the vault root scopes the
  whole vault. One campaign per vault for now.
- The templates are built in and offered while the module is on; a template of the vault's own
  with the same name wins. Nothing is written to the vault until a note is made from one.
- In the 5e layout the ability modifiers are shown beside the scores (`16 (+3)`), computed as
  `floor((score − 10) / 2)`; this is layout, not rules, and no other number is ever derived.
- The templates are written in the interface language (English or German), because they become
  the user's own notes.

## The campaign note

- A note whose `type` is `campaign` (case-insensitive, trimmed) is a campaign note. Its `system`
  key names the game system, as written; Rhizom reads it but does not interpret it.
- Its folder is the campaign's scope. The module types — `npc`, `place`, `faction`, `item`,
  `quest`, `session` — belong to the module and are read only for notes inside the scope
  (`campaignTypeOf`). In this sub-project the templates write them and nothing reads them yet;
  the GM gate, the session spine and the rest of the phase are their readers. The globally
  reserved types stay the four of Phase 2 (`definition`, `template`, `query`, `axes`).
- With several campaign notes, the one with the smallest path (code-unit order) is the campaign;
  the rest are reported as problems by `findCampaign` and shown nowhere else for now.
- `GET /api/v/{vault}/vault` gains `campaign: { path, folder, system } | null`. `system` is null
  when the note has no string `system`.

## The stat block

- A fenced code block whose info string is `statblock` (case-insensitive) is rendered as a stat
  block wherever it stands — inside or outside a campaign, because the fence says what it is.
- Its body is YAML. A mapping is required; anything else, or YAML that does not parse, renders as
  the code block it is with a one-line notice above it.
- The 5e layout is used when the block has a `stats` list of six numbers. It shows, in this
  order and each only when present: `name`; a line of `size`, `type`, `subtype`, `alignment`;
  `ac`, `hp` (with `hit_dice`), `speed`; the six abilities with modifiers; `saves`, `skillsaves`,
  `damage_vulnerabilities`, `damage_resistances`, `damage_immunities`,
  `condition_immunities`, `senses`, `languages`, `cr`; then the sections `traits`, `actions`,
  `bonus_actions`, `reactions`, `legendary_actions`, each a list of `{ name, desc }`.
- `saves` and `skillsaves` are lists of single-key maps (`- dex: 5`), as the plugin writes them,
  and render as `Dex +5`. A modifier written in a string is shown as written.
- Every key the layout does not know is shown after the known lines, in the order it was written,
  as `key: value`; a list of `{ name, desc }` maps becomes a section of its own.
- Without a six-number `stats`, there is no 5e layout: `name` heads the block and every other key
  follows in written order. A system Rhizom has never heard of is laid out, never refused.
- The labels ("Armor Class", "Hit Points" …) come from the app, because core carries no language;
  without them the keys are shown as written.
- Everything is built as a hast tree and stringified, like the query results: a value is text,
  never markup.
- `![[Note#statblock]]` embeds the note's first stat block when the note has no heading named
  "statblock"; a heading of that name, if there is one, wins, as any heading does. A note
  without a stat block gives the usual "no such section" placeholder.

## The templates

- Six built-in templates: NPC, place, faction, item, quest and session log, each setting its
  `type`, using `{{title}}` and `{{date}}` as the vault's own templates do, in English and German.
- The NPC template carries a ` ```statblock ` skeleton (name, ac, hp, speed, stats) and sections for
  motivation, secrets and voice.
- The new-note dialog offers them, after the vault's own templates, when the vault has a campaign
  and the folder the dialog opens in lies inside its scope. A vault template whose file name
  equals a built-in template's name (case-insensitive) replaces it in the list.

## The example vault

`Mira's Ledger` and `Aldric Thane` get a stat block; one session note embeds
`![[Mira's Ledger#statblock]]` as prep. The manifest is updated for whatever that changes.

## Not part of this sub-project

The GM gate and reveals, dice and tables, ties and blocs, clocks, the session spine, the
`type: character` sheet, system packs and stat-block versions — all later sub-projects. No
editing form for stat blocks: the fence is edited as text.

## Tests

- Unit (core): campaign scope and the several-campaigns rule; module types only inside the scope;
  the stat-block parser for 5e, an unknown system, a non-mapping and broken YAML; modifiers; the
  rendered HTML escapes values; `#statblock` slicing with and without a heading of that name;
  template choices for inside and outside the scope and a vault template overriding a built-in.
- Unit (server): `campaign` in the vault info.
- Playwright: a stat block in the wiki view; an embedded stat block in another note; a new note
  from a built-in template inside the campaign folder, and no built-in template outside it. The
  test uses the faction template, because the example vault's own `Templates/NPC.md` stands for
  the built-in NPC one.
