# Handoff — 2 October 2026, evening

Working notes for whoever picks this up next, on whichever machine. Rewrite it at the end of a
session and commit it with the rest of the work.

## Where it stands

**Phase 3 has begun.** The maintainer gave the go and agreed to split the phase into
sub-projects, each with its own spec, plan and review:

1. More than one vault — **done on `lokianer/feat-multi-vault`**, not pushed yet
2. Module core: `type: campaign`, the NPC stat block, the templates
3. The GM gate: `> [!gm]`, `%%…%%`, public and private index sides, reveals, the player view
4. At the table: capture bar, dice, tables, decks
5. Ties, blocs, axis packs, acquaintance colouring
6. Campaign time: clocks, the session spine, the improv drawer, the party ledger
7. The second half of the phase (fourteen items), later

Dependabot's PR #6 (14 minor and patch updates) was merged into `main` by the maintainer before
the branch was cut.

## What this session did

Sub-project 1, spec `docs/specs/2026-10-02-multi-vault.md`, plan
`docs/plans/2026-10-02-multi-vault.md`, reasons in `DECISIONS.md` (2026-10-02, "More than one
vault"), the user-facing list in `CHANGELOG.md` under Unreleased.

- **Server:** `vault/registry.ts` parses `RHIZOM_VAULTS` (`id=path;…`) or the
  `RHIZOM_VAULT_DIR` shorthand (id `default`); `vault/pool.ts` opens a vault on first use and
  closes it after ten idle minutes, held open by an event stream; `routes/vault-scope.ts` puts
  every vault route under `/api/v/:vault`, resolves the vault in an `onRequest` hook and adds the
  `vault` parameter to every schema through `onRoute`. Assets are one `@fastify/static` per
  vault. Indexes live at `<data>/<id>/index.sqlite`.
- **Web:** `routing/vault.ts` holds the tab's vault; `app/vault-loader.ts` sets it, empties the
  stores (`store/reset.ts`, with a generation counter in `store/vault.ts`) and switches
  `store/vault-ui.ts` (open folders, milieu field, graph depth — per vault in `localStorage`).
  Old addresses redirect. `app/layout/VaultSwitcher.tsx` and a palette command appear only with
  two vaults or more.
- **e2e:** `serve.mjs` registers two vaults (`default`, `second`); `vaults.spec.ts` covers the
  redirect, the switcher, the palette, two tabs, links staying inside a vault and an unknown id.

A fresh reviewer read the whole change. Fixed with a failing test first each: a pending edit that
flushed during a vault switch went to the new vault (saves now carry the vault they were opened
in); a switch interrupted before it committed left the tab speaking to the other vault (the
route revalidates when an address leaves the tab's vault); an event stream whose client left
while the vault was opening held it open for good; a failed vault list overwrote the remembered
vault; a failing idle close became an unhandled rejection; a stale 404 blocked an embed in the
new vault.

## Open, in the order I would take them

1. **Push sub-project 1** once the maintainer has looked at it, then the pull request; CI on
   three systems.
2. **Sub-project 2** (module core): brainstorm, spec, plan.
3. Minors the review left, deliberately not fixed: `VaultPool.get()` after `close()` can reopen
   a vault during shutdown; a request longer than the idle time can see its context closed; the
   `ui` store's move to version 2 drops the open folders, milieu field and graph depth once
   instead of moving them to the `default` vault; a vault at a drive root (`x=D:\`) has an empty
   name in the switcher; the registry's Windows-path test only checks the tail of the path.
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
