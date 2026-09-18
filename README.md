# Rhizom

[![CI](https://github.com/lokianer/rhizom/actions/workflows/ci.yml/badge.svg)](https://github.com/lokianer/rhizom/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Self-hostable, open-source tool for networked knowledge: a Markdown editor, a local index and a
bubble-field visualization in the style of the Sinus-Milieu studies — notes as bubbles, clusters
coloured by folder or tag, links as connections. Every vault automatically becomes a navigable
wiki.

> **Status: early development.** Phase 1 of a six-phase [roadmap](ROADMAP.md) brings the MVP:
> open a vault, write, link, search, and see the bubble field. Expect rough edges, and keep a
> backup of your notes. Watch the repository or the
> [project page](https://lokianer.github.io/rhizom/) for progress.

## Principles

- **Files first.** The Markdown files in your vault folder are the source of truth. SQLite is
  only a derived index (links, tags, frontmatter, full text) that can be rebuilt at any time. A
  Rhizom vault stays readable without Rhizom, and an existing Obsidian vault — a folder of `.md`
  files with `[[wikilinks]]` — opens directly.
- **Local and private.** No telemetry, no mandatory cloud, no third-party accounts. Run it on
  your own machine or server.
- **For people who think in connections:** the self-hosting community, researchers, authors, and
  D&D game masters.

## What Rhizom does, and will do

Phase 1 is what you can run today; the later phases are planned. See the
[roadmap](ROADMAP.md) for details.

| Area           | Highlights                                                                                             | Phase |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| Editor         | CodeMirror 6 with live preview, `[[` autocomplete with fuzzy search, create notes from missing links   | 1 ✓   |
| Bubble graph   | Size by link degree, clusters by folder or tag, local graph, tag filters, SVG/PNG export               | 1 ✓   |
| Wiki mode      | Read-only view of the whole vault with rendered links, navigation and full-text search                 | 1 ✓   |
| Knowledge      | Definitions with glossary and hover tooltips, unlinked mentions, transclusion, templates, query blocks | 2     |
| Milieu axes    | Two freely named axes; drag a note and its frontmatter values follow                                   | 2     |
| D&D mode       | NPC stat blocks, typed relationships, alignment chart, dice, GM-only sections — enabled per vault      | 3     |
| Sharing        | Multi-user permissions, publish flag per note, static HTML export, version history, PWA                | 4     |
| Desktop & more | Electron installers, CLI, OpenAPI docs, theme system, spaced repetition, maps, fantasy calendar        | 5     |

Everything is reachable from the keyboard: <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>P</kbd> opens the
command palette, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> saves at once (notes autosave
anyway), and the file tree, search results and palette are usable without a mouse.

_Screenshots and a short demo GIF will appear here once the interface has settled._

## Quick start

Rhizom serves one vault: a folder of Markdown files, for example an existing Obsidian vault.
Notes are read and written as files; the SQLite index next to them can be deleted at any time.

**With Docker (one command):**

```
RHIZOM_VAULT=/path/to/your/vault docker compose up
```

Then open <http://localhost:3737>. Without `RHIZOM_VAULT` the container serves the example
vault from `examples/vault`. The container reads and writes your notes as user 1000 and keeps
its index in a named volume (`rhizom-data`) that can be deleted at any time. The port is
published on the loopback interface only — there is no login yet — so set
`RHIZOM_BIND=0.0.0.0` to reach it from other machines, ideally behind a reverse proxy.

**Natively** (Node ≥ 22.22 and [pnpm 12](https://pnpm.io/installation)):

```
pnpm install
pnpm build
RHIZOM_VAULT_DIR=/path/to/your/vault NODE_ENV=production pnpm --filter @rhizom/server start
```

The server listens on `localhost:3737` and is configured through environment variables (on
Windows PowerShell, set them with `$env:RHIZOM_VAULT_DIR = 'C:\notes'`):

| Variable           | Default                             | Meaning                                                             |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| `RHIZOM_VAULT_DIR` | `examples/vault` outside production | The folder with your notes                                          |
| `RHIZOM_DATA_DIR`  | `./data`                            | Where the SQLite index lives; it is derived data and safe to delete |
| `PORT`, `HOST`     | `3737`, `localhost`                 | Where to listen                                                     |
| `LOG_LEVEL`        | `info`                              | pino log level                                                      |
| `NODE_ENV`         | —                                   | `production` turns off the example-vault fallback and pretty logs   |

The REST API is documented at <http://localhost:3737/api/docs>; the OpenAPI document is served
at `/api/openapi.json` and committed as [`apps/server/openapi.json`](apps/server/openapi.json).

## Development

```
pnpm install        # dependencies and git hooks
pnpm dev            # core (watch build), server (tsx watch) and web (Vite) in parallel
pnpm test           # unit tests for all packages
pnpm e2e            # Playwright (run `pnpm --filter @rhizom/web exec playwright install chromium` once)
pnpm lint && pnpm typecheck && pnpm format:check
```

The workspace: `packages/core` (types, Markdown and link parsing, index logic — no UI),
`apps/server` (Fastify REST API, also serves the web app), `apps/web` (React + Vite).
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and
[DECISIONS.md](DECISIONS.md) for the reasoning behind the stack.

## Themes

Two themes ship with Rhizom: **Humus** (dark, earthy — the default) and **Kalk** (light, chalky).
Both are defined as CSS custom properties in
[`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css); cluster colours for the
graph can later be overridden per folder or tag.

## License

[AGPL-3.0-only](LICENSE). If you run a modified Rhizom as a service, the license requires you
to publish your changes.
