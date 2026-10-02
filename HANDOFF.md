# Handoff — 3 October 2026, early morning

Working notes for whoever picks this up next, on whichever machine. Rewrite it at the end of a
session and commit it with the rest of the work.

## Where it stands

**Phase 3 is in progress**, split into sub-projects, each with its own spec, plan and review:

1. More than one vault — **merged** (PR #7, CI 11/11)
2. Module core: `type: campaign`, the stat block, the templates — **done on
   `lokianer/feat-campaign-module`**
3. The GM gate: `> [!gm]`, `%%…%%`, public and private index sides, reveals, the player view
4. At the table: capture bar, dice, tables, decks
5. Ties, blocs, axis packs, acquaintance colouring
6. Campaign time: clocks, the session spine, the improv drawer, the party ledger
7. The second half of the phase (fourteen items), later

The maintainer asked to work through without stopping between stages; the phase-end review stop
from CLAUDE.md still applies when Phase 3 as a whole is done.

## What this session did

**Sub-project 1** (spec `docs/specs/2026-10-02-multi-vault.md`): `RHIZOM_VAULTS`, a vault pool
with idle close, every vault route under `/api/v/{vault}`, the web app under `/v/<id>`, a
switcher. A fresh review found six real problems, each fixed with a failing test first. CI's own
smoke tests still asked `/api/vault` and were fixed in a second commit on the PR.

**Sub-project 2** (spec `docs/specs/2026-10-03-campaign-module.md`, reasons in `DECISIONS.md`
2026-10-03):

- **Core:** `vault/campaign.ts` (the campaign note scopes its folder; module types only inside),
  `render/statblock.ts` (YAML of a ` ```statblock ` fence → model, 5e or generic layout),
  `render/statblock-view.ts` (hast → HTML, put in after sanitising like a query answer),
  `syntax/section.ts` `sliceStatblock` (`![[Note#statblock]]`), `vault/campaign-templates.ts`
  (six templates, English and German, with the choice rule).
- **Server:** `store/index/campaign.ts`; `campaign` in the vault info.
- **Web:** labels in `NotePreview.tsx`, `styles/statblock.css`, built-in templates in
  `useNoteCommands.ts` (suffix "(built in)").
- **Example vault:** stat blocks for Mira and Aldric Thane, session 13 embeds Mira's.

A fresh review found, and failing tests now pin: a stat-block key named `constructor` or
`toString` crashed the note render (labels are read from own properties only); `#statblock` on a
fence inside a callout or nested list broke the fence (it is rebuilt from the parsed value); the 5e
layout dropped values that did not fit their slot (they fall through now); `{{title}}` was never
filled inside the fence and would not have been quoted (fences of stat blocks are filled now,
`name: "{{title}}"`); the template's `## Statblock` heading defeated `#statblock`; a vault
template overrode a built-in one only in its own language. Left: YAML merge keys (`<<`) are not
resolved, and odd nested values flatten oddly.

## Open, in the order I would take them

1. **Push sub-project 2**, then the pull request; CI on three systems.
2. **Sub-project 3** (the GM gate): the security-relevant one — brainstorm and spec carefully.
3. Minors left by the sub-project 1 review: `VaultPool.get()` after `close()` can reopen a vault
   during shutdown; a request longer than the idle time can see its context closed; the `ui`
   store's move to version 2 drops the open folders, milieu field and graph depth once; a vault
   at a drive root has an empty name in the switcher; the registry's Windows-path test only
   checks the tail of the path.
4. Older items: an error boundary around the note page; the milieu field still hashes its
   colours; the two block-reference gaps in `ROADMAP.md`; the zen-mode hint and the rename
   confirmation; the `NotePage` chunk over 500 kB.

## Traps, so the next session does not walk into them

- **Heredocs eat backslashes** — in the Bash tool, even inside a quoted `'EOF'` heredoc feeding
  Python: `\n` arrives as a real newline, `C:\notes` loses its backslash. Use Write/Edit for
  anything with a backslash.
- **The web unit tests run in Node, without a DOM.** No jsdom, no testing-library: logic worth
  asserting goes into plain functions (`commands-model.ts`), and `localStorage` is stubbed with
  `vi.stubGlobal`. A zustand `persist` store grabs its storage when the module loads, so
  `store/vault-ui.ts` hands it a wrapper that reaches `localStorage` on each call.
- **Do not `setState` a persisted store before pointing it at another key**: it saves under the
  old key. `switchVaultUi` resets through the `merge` option instead.
- **`netstat` answers in German.** Never grep for `LISTENING`; match `":3737"`, take the last
  column, verify the port is free afterwards.
- **The panel's "New note" button uses the focused tree folder**, which on a fresh page is the
  first folder (`Campaign`); an e2e test that wants the vault root uses the palette.
- **The auto-mode classifier blocks `gh pr merge`.** The maintainer merges with
  `! gh pr merge <n> --merge`.
- **Run the whole CI sequence locally before pushing**: format:check, lint, typecheck,
  test:coverage, build, site:build, `CI=1 pnpm e2e`.

## How to run it

```
pnpm install
pnpm dev                                         # core watch + Fastify on 3737 + Vite on 5173
RHIZOM_VAULT_DIR=<dir> pnpm dev                   # one vault
RHIZOM_VAULTS="dnd=<dir>;thesis=<dir>" pnpm dev   # several
```

Run the dev server against throwaway copies of `examples/vault` in the session scratchpad, never
against the repository's own example vault. Stop whatever holds 3737 before `pnpm e2e`.
