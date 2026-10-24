# Handoff — 24 October 2026

Working notes for whoever picks this up next, on whichever machine. Rewrite it at the end of a
session and commit it with the rest of the work.

## Where it stands

**Phase 3 is in progress**, split into sub-projects, each with its own spec, plan and review:

1. More than one vault — **merged** (PR #7)
2. Module core: `type: campaign`, the stat block, the templates — **merged** (PR #8)
3. The GM gate: `> [!gm]`, `%%…%%`, public index side, reveals, the player view — **merged**
   (PR #9)
4. At the table: capture bar, dice, tables, decks — **spec written**
   (`docs/specs/2026-10-04-at-the-table.md`), on `lokianer/feat-at-the-table`; no plan, no code yet
5. Ties, blocs, axis packs, acquaintance colouring
6. Campaign time: clocks, the session spine, the improv drawer, the party ledger
7. The second half of the phase (fourteen items), later

The maintainer asked to work through without stopping between stages; the phase-end review stop
from CLAUDE.md still applies when Phase 3 as a whole is done.

## What this session did

- Wrote the spec for sub-project 4. The open fork — which session note is "tonight's" — was
  settled with option A: the highest-numbered session note; when its `date:` lies before today,
  the capture bar offers once to make session N+1 from the built-in template.
- Started a dev server against scratchpad copies of the example vault to try the merged state.

## Sub-project 4, as the spec has it

Three slices, one commit each:

1. **Dice and rollable tables.** `parseDice`/`rollDice` in core (`NdM`, N ≤ 100, M ≤ 1000,
   `kh`/`kl`, constants, `d%`); `roll()` in `syntax/template.ts` moves onto it, so `{{roll:}}`
   shares the grammar. `/roll` slash command (`apps/web/src/editor/slash.ts`). An inline
   `` `dice: 1d8+3` `` chip in the reader that rolls and can record. A heading naming a die makes
   the first list or table under it rollable (ranges `2–4`, `00` = 100); a Roll button on the
   heading; `{{table:Note#Heading}}` in templates.
2. **Decks.** `type: deck` inside the campaign; cards are the first task list's items, ticked =
   drawn; Draw and Shuffle are text edits of the file.
3. **Capture bar.** Ctrl/Cmd+J; plain text, `/roll`, `/draw`, `/table`, `/loot`, `/know`, `/npc`;
   writes go under `## Log` (or `## Loot`) of tonight's session note, saved with the hash it was
   read with.

Then: a fresh whole-branch review, fixes with failing tests first, the full CI sequence, PR.

## Open, in the order I would take them

1. **Sub-project 4**: plan (`docs/plans/2026-10-04-at-the-table.md`), then the three slices.
2. Minors left by the sub-project 1 review: `VaultPool.get()` after `close()` can reopen a vault
   during shutdown; a request longer than the idle time can see its context closed; the `ui`
   store's move to version 2 drops the open folders, milieu field and graph depth once; a vault
   at a drive root has an empty name in the switcher; the registry's Windows-path test only
   checks the tail of the path.
3. Older items: an error boundary around the note page; the milieu field still hashes its
   colours; the two block-reference gaps in `ROADMAP.md`; the zen-mode hint and the rename
   confirmation; the `NotePage` chunk over 500 kB; the side-tab border in `callouts.css` that
   the design hook flags.

## Traps, so the next session does not walk into them

- **Heredocs eat backslashes** — in the Bash tool, even inside a quoted `'EOF'` heredoc feeding
  Python: `\n` arrives as a real newline, `C:\notes` loses its backslash. Use Write/Edit for
  anything with a backslash.
- **The web unit tests run in Node, without a DOM.** No jsdom, no testing-library: logic worth
  asserting goes into plain functions (`commands-model.ts`, `table-model.ts`), and `localStorage`
  is stubbed with `vi.stubGlobal`.
- **Do not `setState` a persisted store before pointing it at another key**: it saves under the
  old key. `switchVaultUi` resets through the `merge` option instead.
- **The player view must never load GM data.** `isPlayerView` in `app/vault-loader.ts` keeps the
  note list out; `e2e/table.spec.ts` audits every request. Anything new under `/v/<id>/table`
  goes through `store/public-index.ts` and gets a marker in `apps/server/src/table.test.ts`.
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
