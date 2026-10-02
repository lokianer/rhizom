# More than one vault, and a way between them

Date: 2026-10-02
Status: implemented 2026-10-02

## Why

The server serves exactly one vault, set by `RHIZOM_VAULT_DIR`; switching means restarting with
another path. A game master keeps one vault per campaign, a researcher one per project. Phase 3
opens with this item because it restructures the server and the web app's routing, and every
later item of the phase builds on that structure. It does not depend on the D&D module.

## Decisions taken with the maintainer

- The operator registers vaults through an environment variable. There is no UI that names a
  path: a browser that may name any path is a browser that may read any folder on the machine.
- One URL space: the browser always works under `/v/<id>/…` and the API under
  `/api/v/<id>/…`, even with a single vault. Old paths redirect, so bookmarks survive.

## Registry

- `RHIZOM_VAULTS` lists vaults as `id=path` pairs separated by `;`, for example
  `dnd=/srv/vaults/dnd;thesis=D:\Notes\Thesis`. Whitespace around ids and paths is trimmed; an
  empty entry (a trailing `;`) is ignored.
- An id matches `^[a-z0-9][a-z0-9-]{0,31}$`. Paths are resolved against the working directory.
- Startup fails with a message naming the offending entry when an id is malformed or repeated,
  a path does not exist or is not a directory, or an entry has no `=`.
- `RHIZOM_VAULT_DIR` alone yields one vault with the id `default`. Setting both variables is a
  startup error, so no setup is ambiguous. With neither set, the development fallback to
  `examples/vault` stays as it is (as `default`), and production starts with no vault.
- A vault's display name is its folder name (what `openVault` reports today).
- `RHIZOM_TEMPLATE_DIR` and `RHIZOM_DAILY_DIR` apply to every vault as the operator's fallback;
  a vault's own settings still win, as today.
- Each vault keeps its index at `<dataDir>/<id>/index.sqlite`. The single-vault file at
  `<dataDir>/index.sqlite` is not migrated: the index is derived, so the first start after the
  upgrade rebuilds it once. The changelog says so, and the old file can be deleted by hand.

## Lifecycle: the vault pool

`VaultPool` (`apps/server/src/vault/pool.ts`) owns the open contexts.

- `get(id)` returns the open `VaultContext`, or opens it on first use. Concurrent callers share
  one pending promise, so a vault is never opened twice. A failed open is not cached; the next
  request tries again.
- Every request marks its vault as used. A vault with no request for the idle time (10 minutes,
  `idleMs` option for tests) and no open event stream is closed: watcher stopped, database
  closed. An event stream holds a lease that is released when the stream ends.
- Changes made while a vault was closed are picked up by the incremental `syncVault` that every
  open already runs; the files are the truth, nothing is lost.
- `close()` closes every open vault; the app's `onClose` hook calls it.
- A vault that is still opening when the idle check runs is left alone.

## API

- Every vault route moves under `/api/v/{vault}/…`: notes, tree, search, query, tags, glossary,
  mentions, rename, graph, maintenance, events and assets (`/api/v/{vault}/assets/<path>`).
- `requireContext()` becomes `requireContext(request)`: it reads the `vault` route parameter,
  checks it against the registry (the pattern first, then membership) and awaits the pool. An
  unknown id is a 404 with the same error shape as any other. No route ever takes a filesystem
  path from the client.
- `GET /api/vaults` returns `[{ id, name }]` in registry order, and never a path.
- `GET /api/health` stays global.
- The old unprefixed vault routes are removed. The web app is their only client and Rhizom is
  `0.x`; the changelog lists it as a breaking change for anyone scripting against the API.
- The OpenAPI document describes the prefixed routes with `vault` as a path parameter.
- Assets are served by one `@fastify/static` registration per vault, under
  `/api/v/<id>/assets/`: the set of vaults is fixed at start-up, and each registration is bound
  to its own root.

## Web

- The router gains `/v/:vault` as the parent of today's pages (`notes/*`, `wiki/*`, `graph`,
  `glossary`, home). The subtree is keyed by the vault id, so switching remounts it and nothing
  from the previous vault survives in component state.
- The data stores (`store/notes.ts`, `store/vault.ts`, queries) are reset when the vault
  changes. The API client takes the vault id and prefixes every request; `assetUrl` produces
  `/api/v/<id>/assets/<path>`, so rendered Markdown embeds the right vault's images.
- `/`, and the old paths `/notes/…`, `/wiki/…`, `/graph`, `/glossary`, redirect to the same
  page in the last vault this browser used (`localStorage`), or the first registered vault. An
  unknown vault id in the URL shows a "vault not found" page with a link to the vaults that
  exist.
- Internal links and `navigate` calls go through one helper that adds the current vault's
  prefix; no component builds `/notes/…` by hand any more.
- The persisted `ui` store is split: global preferences (sidebar, split view, zen, vim mode,
  language, renderer) stay global; vault state (`expandedFolders`, `milieuPath`, `graphDepth`,
  `graphTags`) is kept per vault id.
- The switcher is a control in the header and a "Switch vault" command in the palette. Both are
  absent when only one vault is registered.
- Two tabs may hold two vaults at once; each tab's event stream is its own vault's.

## Boundaries

- Links never cross a vault boundary. Each index knows only its own vault, so a name resolves
  inside the vault it is written in and nowhere else.
- Not part of this item: registering vaults from the UI, search across vaults, per-vault
  permissions or login (Phase 4), a desktop folder picker.

## Tests

- Unit (server): registry parsing and every startup error; pool opens lazily, shares a pending
  open, retries after a failed open, closes idle vaults, keeps a vault with an open stream,
  closes everything on shutdown; a note path of vault A is not reachable through vault B's id;
  an unknown or malformed id is a 404; `/api/vaults` carries no paths.
- Unit (web): the link helper, the redirect of old paths, the split `ui` store, and the
  switcher's absence with a single vault (the e2e server always registers two).
- Playwright: two registered vaults and switching between them; two tabs on two vaults at once;
  an old bookmark (`/notes/…`) lands on the note; a link stays inside its vault; an unknown
  vault id. The e2e server is started with two throwaway vaults.

## Documentation

`DECISIONS.md` (registry by environment, one URL space, idle close, index location),
`README.md` (the variable, a compose example with two mounts), `CHANGELOG.md` (the feature, the
breaking API change, the one-time index rebuild), `ROADMAP.md` (the item ticked).
