# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Monorepo foundation: pnpm 12 workspace with `packages/core`, `apps/server` and `apps/web`,
  strict TypeScript project references, ESLint 10 with type-aware rules, Prettier, Vitest 5
  with an 80 % coverage gate for `packages/core`, and Playwright smoke tests.
- `commit-msg` git hook that enforces Conventional Commits and rejects attribution lines.
- Fastify server with `GET /api/health` and a history-API fallback for the built web app.
- React web shell with the i18n layer (English default, German) and the Humus/Kalk design
  tokens.
- GitHub Actions CI matrix (Ubuntu, macOS, Windows × Node 22, 24) plus a Docker build and
  container smoke test; `Dockerfile` and `docker-compose.yml`.
- Project landing page in `site/`, deployed to GitHub Pages.
- Repository documentation: README, roadmap, decisions log, contributing guide, code of
  conduct, security policy, issue and pull request templates.
- `packages/core`: Markdown parsing (frontmatter, wikilinks, embeds, tags, headings),
  Obsidian-style link resolution through paths, names and aliases, fuzzy matching and graph
  building with folder or tag clusters.
- `apps/server`: vault access with atomic writes, `If-Match` conflict detection and a
  `.trash/` folder; a SQLite index with FTS5 search that is synced incrementally and kept
  current by a file watcher; the REST API under `/api` (vault info, tree, notes, links,
  backlinks, search, tags, graph, assets, rebuild) with server-sent index events, an OpenAPI
  document at `/api/openapi.json` and Swagger UI at `/api/docs`.
- `apps/web`: the Phase 1 interface — CodeMirror 6 editor with live preview, `[[`
  autocompletion and image drop, an optional preview pane beside the editor, file tree,
  backlinks, full-text search with snippets, command palette, the bubble graph on a canvas
  (force layout in a worker) with SVG and PNG export, and read-only wiki mode, all in English
  and German with the Humus and Kalk themes.
- Notes can be created from the palette, from a missing link or from a folder in the tree, and
  moved to the vault’s `.trash` folder from the note header.
- Example vault in `examples/vault` with a manifest of what the index must find and an
  acceptance test that checks the server against it.
- Docker image with `/vault` and `/data` volumes; `RHIZOM_VAULT_DIR` and `RHIZOM_DATA_DIR`
  configure the server.

[Unreleased]: https://github.com/lokianer/rhizom/commits/main
