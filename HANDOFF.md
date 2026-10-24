# Handoff — 24 October 2026

Working notes for whoever picks this up next, on whichever machine. Rewrite it at the end of a
session and commit it with the rest of the work.

## Where it stands

**Rhizom is paused.** On 24 October 2026 the maintainer decided to build the D&D part as an
Obsidian community plugin in a new project, and to use an existing community plugin for
self-hosting. The handoff for that project is `docs/handoff-obsidian-plugin.md`; it carries the
file conventions, the gate rules, the open decisions and what to port from here.

Phase 3 stood like this when work stopped:

1. More than one vault — **merged** (PR #7)
2. Module core: `type: campaign`, the stat block, the templates — **merged** (PR #8)
3. The GM gate, reveals, the player view — **merged** (PR #9)
4. At the table — spec and plan written (`docs/specs/2026-10-04-at-the-table.md`,
   `docs/plans/2026-10-04-at-the-table.md`); the **core half of slice 1** is committed on
   `claude/continue-from-handoff-k1mmac` (`feat(dice): …`): `parseDice`/`rollDice`,
   `findRollables`/`rollTable`, `{{table:}}`, and the render markers. No web code, no PR.
5. and later: not started

`ROADMAP.md` also gained Phase 3½ (closer to Obsidian), written before the decision to move to a
plugin; it stays as a draft in case Rhizom is picked up again.

## If Rhizom is picked up again

1. Slice 1's web half: `/roll` as a second completion source, `{{table:}}` prefetch, the reader's
   chips and Roll buttons in `NotePreview`, the session log writer, i18n, the e2e test. Then decks
   and the capture bar, per the plan. Squash the core commit into the slice commit if wanted.
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
