# Handoff — 24 September 2026, 22:40

Working notes for whoever picks this up next, on whichever machine. Rewrite it at the end of a
session and commit it with the rest of the work.

## Where it stands

`main` is pushed at `176f7b2`, working tree clean, no open pull requests. **Phases 0 to 2 are
complete, and so is the structural refactoring planned before phase 3.** CI was green 7/7 on
the last run (ubuntu/macos/windows × Node 22/24, plus the Docker build). **Phase 3 (D&D mode,
`ROADMAP.md`) is next and not begun** — wait for the maintainer's go before starting it.

## The pre-phase-3 restructuring (21 September)

Spec and plan: `docs/specs/2026-09-21-refactoring.md`, `docs/plans/`. The reasons are in
`DECISIONS.md`, the summary in `CHANGELOG.md` under Changed. Behaviour did not change: the
tracked OpenAPI document and the content hashes of the emitted CSS assets were the proof.

- `packages/core/src` is grouped **by layer**, not by feature: `text`, `syntax`, `vault`,
  `query`, `render` (plus `api.ts` and the `index.ts` barrel). A feature grouping would have put
  two folders in an import cycle. Paths in older notes are stale, e.g. `section.ts` is now
  `syntax/section.ts`.
- `render/note.ts` was cut into `blocks`, `classes`, `links`, `sanitize` and `transform` beside
  it, the query module into `query/reader.ts` and `query/clauses.ts`; line-break helpers moved
  to `text/`.
- Server: `apps/server/src/store/` holds the index — one `IndexContext` per vault
  (`vault/context.ts`), the stores under `store/index/`, and **`VaultIndex` as the single facade**
  the routes talk to. Multi-vault in phase 3 builds on that: routes never see the stores.
- Web: pages are separated from the application frame (`apps/web/src/pages`, `app`), and the
  two collected stylesheets were cut into per-area files that still form one cascade.
- Lesson recorded in `DECISIONS.md`: a hook that hands out its refs encapsulates nothing —
  React's rules rejected `useNoteDocument` doing that, rightly.

After the merge, `e2e/milieu.spec.ts` flaked once on ubuntu/Node 22: two assertions on the same
field had different timeouts. `176f7b2` gives them one `FIELD_READY` allowance. Green since —
but one green run is not proof; watch for it.

## Open, in the order I would take them

1. **Start phase 3** once the maintainer says so.
2. **Two block-reference gaps** recorded in `ROADMAP.md`: a marker on a _heading_ embeds but a
   link to it lands on the note, and Obsidian sometimes writes an id on its own line after a
   table or list, which Rhizom does not read. Check against a real Obsidian vault.
3. **Two small features named but not built:** a hint on how to leave zen mode, and a
   confirmation after a finished rename / tag rename.
4. **`NotePage` chunk ~612 kB** trips the 500 kB warning (CodeMirror's fenced-code grammars);
   `yaml` sits in the shared `queries` chunk. Lazy, not urgent; would need `advancedChunks`.

## Traps, so the next session does not walk into them

- **Heredocs eat backslashes.** `\n`, `\t`, `\r` in a bash/python heredoc become real control
  characters. Use Write/Edit for anything with a backslash.
- **`netstat` answers in German.** Never grep for `LISTENING`; match `":3737"`, take the last
  column, verify the port is free afterwards. A surviving dev server gets reused by Playwright
  and the e2e run tests the wrong vault.
- **The file tree shows titles, not file names.** Tests should ask the API for a note's path.
- **Run the whole CI sequence locally before pushing**, not just the tests: typecheck, lint,
  format:check, test:coverage, build, site:build, e2e.

## How to run it

```
pnpm install
pnpm dev                 # core watch + Fastify on 3737 + Vite on 5173
RHIZOM_VAULT_DIR=<dir> pnpm dev
```

Run the dev server against a throwaway copy of `examples/vault` in the session scratchpad, never
against the repository's own example vault. Stop whatever holds 3737 before `pnpm e2e`.
