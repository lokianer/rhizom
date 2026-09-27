# Handoff — 27 September 2026, evening

Working notes for whoever picks this up next, on whichever machine. Rewrite it at the end of a
session and commit it with the rest of the work.

## Where it stands

Branch `lokianer/feat-graph-fancier`, **not pushed yet**: four commits on top of `main` —
`e4f7a2c` fix(core) (frontmatter that contains itself or expands too far), `9ed7810`
perf(server) (the memory slice), `59c7051` feat(graph) (the WebGL2 field) and the 0.2.1 release
commit, which carries this handoff. The whole local CI sequence was green before the commits
(85/85 e2e), and the perf commit was checked on its own in a separate worktree. **Next: push,
open the pull request, watch CI on all three systems, merge, tag `v0.2.1`.** Phase 3 (D&D mode) is
still not begun — wait for the maintainer's go.

## What this session did

Between Phases 2 and 3, at the maintainer's request: a vault of 2,000 notes lagged, and the
bubble field was to become much more worth looking at. Spec with the measurements and the
prototype judging: `docs/specs/2026-09-27-graph-renderer.md`; reasons in `DECISIONS.md`
(2026-09-27, WebGL2 and Memory); the user-facing list in `CHANGELOG.md` under 0.2.1.

- **Renderer** (`apps/web/src/graph/`): `controller.ts` drives everything; `gl/` is the WebGL2
  field, `canvas2d-renderer.ts` the fallback behind the same `FieldRenderer` interface
  (`types.ts`), `overlay.ts` + `labels.ts` + `label-sprites.ts` the words on a 2D canvas,
  `GraphLegend.tsx` / `GraphInfo.tsx` the DOM panels. `look.ts` holds the numbers all three
  renderers (WebGL, Canvas 2D, SVG export) share.
- **Renderer choice:** WebGL2 unless it is missing, lost for good, or drawn in software
  (SwiftShader, llvmpipe, softpipe — not WARP). `localStorage['rhizom.renderer']` = `webgl2` or
  `canvas2d` overrides it; the e2e suite forces WebGL2 once so CI still compiles the shaders.
- **Layout worker:** sleeps 2 s after settling, ticks in 8 ms slices, falls back to the page when
  its script does not load (`worker-layout.ts`, `layout.worker.ts`).
- **Server memory:** graph cached per clustering in the index and dropped by every write;
  prepared statements (`store/index/statements.ts`); `--max-semi-space-size=16` on native starts.
- **Reviews:** two review waves with adversarial verification (code, docs, a11y, environment,
  GL, tests, security). Everything confirmed was fixed; the security pass found the two
  frontmatter crashes, which were already on `main` and got their own commit.

## Open, in the order I would take them

1. **Push, pull request, CI, merge, tag `v0.2.1`** — only with the maintainer's go.
2. **Start phase 3** once the maintainer says so.
3. **An error boundary around the note page.** The router's default error screen is what catches
   a render error today; the frontmatter fix removed the one known trigger.
4. **The milieu field still hashes its colours**, so a folder can have another colour there than
   in the bubble field. Worth a vault-wide assignment once somebody uses both side by side.
5. Older items still open: the two block-reference gaps in `ROADMAP.md`, the zen-mode hint and
   the rename confirmation, and the `NotePage` chunk over 500 kB.

## Traps, so the next session does not walk into them

- **Heredocs eat backslashes.** `\n`, `\t`, `\r` in a bash/python heredoc become real control
  characters. Use Write/Edit for anything with a backslash; backticks inside `node -e` strings
  get eaten by bash too.
- **`netstat` answers in German.** Never grep for `LISTENING`; match `":3737"`, take the last
  column, verify the port is free afterwards. A surviving dev server gets reused by Playwright
  and the e2e run tests the wrong vault.
- **Agents that are stopped leave servers behind.** After stopping a workflow, look for node
  processes on 39xx/51xx ports and for a stale `.git/worktrees/*/index.lock`.
- **A Chrome tab driven by automation may be hidden:** `requestAnimationFrame` then only runs on
  screenshots, and the field's entry growth looks five times slower than it is.
- **Headless Chromium draws WebGL2 through SwiftShader**, so CI gets the Canvas 2D field unless
  a test sets `rhizom.renderer`.
- **Run the whole CI sequence locally before pushing**, not just the tests: format:check, lint,
  typecheck, test:coverage, build, site:build, `CI=1 pnpm e2e` (with `RHIZOM_E2E_API_PORT` when
  a dev server holds 3737).

## How to run it

```
pnpm install
pnpm dev                 # core watch + Fastify on 3737 + Vite on 5173
RHIZOM_VAULT_DIR=<dir> pnpm dev
```

Run the dev server against a throwaway copy of `examples/vault` in the session scratchpad, never
against the repository's own example vault. Stop whatever holds 3737 before `pnpm e2e`.
