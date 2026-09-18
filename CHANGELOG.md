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

[Unreleased]: https://github.com/lokianer/rhizom/commits/main
