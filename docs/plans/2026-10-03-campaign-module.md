# The campaign module — implementation plan

**Goal:** A campaign note scopes the module; ` ```statblock ` fences render as stat blocks and can
be embedded as `#statblock`; six built-in templates are offered inside the campaign.

**Spec:** `docs/specs/2026-10-03-campaign-module.md`

**Execution:** inline, TDD per task, one fresh whole-branch review at the end, one
`feat(campaign): …` commit after the full local CI sequence.

## Global constraints

- Core stays UI-free and language-free: labels and template words in other languages come from
  the app or from data tables keyed by language; core never imports i18next.
- Rendered values are hast text nodes, never HTML strings.
- `NOTE_TYPES` stays the four Phase 2 values.
- i18n keys go into `en/common.json` first, then `de/common.json`.
- Relative imports carry `.js`; no enums.

## Review focus

1. A stat block whose values contain `<script>` or `"><img onerror>` renders them as text.
2. `stats` with five numbers, or strings in it, falls back to the generic layout instead of
   throwing.
3. A campaign note in `Campaign/` must not switch the module on for `Campaigner/` (prefix
   without a separator).
4. `![[Note#statblock]]` on a note with a fence inside a heading section returns only the fence,
   not the section.
5. Choosing a built-in template in the dialog, then a vault template of the same name, never
   writes the built-in text.

## Tasks

### Task 1: Campaign scope (core)

- Create `packages/core/src/vault/campaign.ts`, test beside it; export from `index.ts`.
- `CAMPAIGN_TYPES = ['npc', 'place', 'faction', 'item', 'quest', 'session'] as const`,
  `type CampaignType`.
- `interface CampaignInfo { path: string; folder: string; system: string | null }` (also the API
  shape).
- `findCampaign(notes: readonly { path: string; frontmatter: Record<string, unknown> }[]):
{ campaign: CampaignInfo | null; ignored: string[] }`.
- `inCampaign(campaign: CampaignInfo | null, path: string): boolean` — folder `''` holds
  everything; otherwise `path.startsWith(folder + '/')`.
- `campaignTypeOf(frontmatter, path, campaign): CampaignType | undefined`.

### Task 2: Stat-block model (core)

- Create `packages/core/src/render/statblock.ts` (+ test).
- `parseStatblock(source: string): Statblock | StatblockProblem` where
  `Statblock = { layout: '5e' | 'generic'; name?: string; lines: StatLine[]; abilities?:
number[]; sections: StatSection[] }`, `StatLine = { key: string; value: string }`,
  `StatSection = { key: string; entries: { name: string; desc: string }[] }`,
  `StatblockProblem = { problem: 'yaml' | 'not-a-mapping'; message: string }`.
- `abilityModifier(score: number): number` = `Math.floor((score - 10) / 2)`.
- Value formatting: scalars as `String`, lists of scalars joined with `, `, lists of single-key
  maps (`saves`, `skillsaves`) as `Dex +5`, other maps as `k v, k v`.

### Task 3: Stat-block rendering (core)

- Create `packages/core/src/render/statblock-view.ts` (+ test): `renderStatblock(block,
labels?: StatblockLabels): string` via hast + rehype-stringify, root
  `<div class="rz-statblock" data-layout="5e|generic">`.
- `StatblockLabels`: `fields: Partial<Record<string, string>>` (known keys → label),
  `abilities: [6 strings]`, `problem: (message: string) => string`.
- `blocks.ts`: `statblockBlock(node, context)` for `lang === 'statblock'`, pushed through
  `context.embeds` like the query answer; a problem renders the notice paragraph plus the original
  code block.
- `RenderOptions.statblockLabels?: StatblockLabels`; `transform.ts` tries it beside the query and
  mermaid blocks; `classes.ts` gets `STATBLOCK_LANGUAGE`, `STATBLOCK_CLASS`.

### Task 4: `#statblock` embeds (core)

- `syntax/section.ts`: `sliceStatblock(markdown: string): string | undefined` — the first fence
  whose info string is `statblock`, fences included, `~~~` and longer fences honoured.
- `embed.ts`: when `sliceSection` finds no heading and the heading folds to `statblock`, use
  `sliceStatblock`.

### Task 5: Built-in templates (core)

- Create `packages/core/src/vault/campaign-templates.ts` (+ test):
  `CAMPAIGN_TEMPLATES: Record<'en' | 'de', readonly { id: CampaignType; name: string; content:
string }[]>`, `BUILT_IN_TEMPLATE_PREFIX = 'rhizom:campaign/'`,
  `campaignTemplateChoices({ campaign, folder, vaultTemplateNames, language }):
{ path: string; name: string }[]` (path = prefix + id), `builtInTemplate(path, language):
string | undefined`.

### Task 6: Server

- `CampaignInfoSchema` in `routes/schemas/notes.ts`, `campaign` in `VaultInfoSchema` and in
  core `VaultInfo`; pair in `schemas/index.test.ts`.
- `store/index/campaign.ts`: rows `select path, frontmatter from notes where frontmatter like
'%campaign%'`, then `findCampaign`; `VaultIndex.campaign()`; the vault route returns it.
- Test in `app.test.ts`; regenerate `openapi.json`.

### Task 7: Web

- i18n `statblock.*` labels (en, de) and `note.builtInTemplate` suffix; pass `statblockLabels`
  wherever `renderNote` / `renderNoteWithEmbeds` options are built.
- `styles/statblock.css` imported with the other styles: Humus first, ≥ 16 px, rules in
  `--rz-*` tokens.
- `useNoteCommands`: choices = vault templates + `campaignTemplateChoices`; `templateText`
  resolves a built-in path through `builtInTemplate` before asking the API.

### Task 8: Example vault and e2e

- Stat blocks in `Mira's Ledger` and `Aldric Thane`; `![[Mira's Ledger#statblock]]` in Session 13;
  update `examples/vault.manifest.json` if its link counts move.
- `apps/web/e2e/campaign.spec.ts`: wiki stat block; embedded stat block; NPC from built-in
  template inside `Campaign/`, none at the root.

### Task 9: Docs and finish

- `DECISIONS.md` (fence over frontmatter, scope, built-in templates, modifiers), `CHANGELOG.md`,
  `ROADMAP.md` (tick the three items, note the fence), `README.md` table row, `HANDOFF.md`.
- Full local CI sequence; fresh reviewer; fixes with failing tests first; commit; PR.
