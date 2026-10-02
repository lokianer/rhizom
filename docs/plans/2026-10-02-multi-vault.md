# More than one vault — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server serves every vault the operator registers, each under `/api/v/<id>/…`, and
the web app works under `/v/<id>/…` with a switcher when there is more than one.

**Architecture:** A registry parsed from the environment at startup, a `VaultPool` that opens a
vault's context on first use and closes it after ten idle minutes, and one encapsulated Fastify
plugin with the prefix `/api/v/:vault` that resolves the context per request. The web app keeps
the current vault in one module (`routing/vault.ts`); the API client, the event stream and
`noteHref` read it, and a route loader on `/v/:vault` sets it and resets the vault's stores.

**Tech Stack:** Fastify 5, `@fastify/static`, TypeBox, better-sqlite3, React 19, React Router
data routers (loaders, redirects), Zustand `persist`, Vitest, Playwright.

**Spec:** `docs/specs/2026-10-02-multi-vault.md`

## Global Constraints

- Vault id pattern `^[a-z0-9][a-z0-9-]{0,31}$`; the single-vault id is `default`.
- `RHIZOM_VAULTS` is `id=path` pairs separated by `;`; setting it and `RHIZOM_VAULT_DIR`
  together is a startup error.
- Index file per vault: `<dataDir>/<id>/index.sqlite`; `:memory:` stays `:memory:`.
- Idle close after 10 minutes (`DEFAULT_IDLE_MS = 600_000`), never while an event stream holds
  the vault.
- No route takes a filesystem path from the client; `/api/vaults` never returns one.
- Relative imports carry `.js`; no enums, namespaces or parameter properties
  (`erasableSyntaxOnly`); paths built with `path.join`/`resolve`.
- i18n keys go into `en/common.json` first, then `de/common.json`.
- Secondary text ≥ 16 px; judge the switcher in Humus (dark) first.
- One Conventional Commit for the whole slice at the end (`feat(vaults): …`), after the full
  local CI sequence. No intermediate commits; no attribution lines.

## Review Focus

1. A Windows path in `RHIZOM_VAULTS` (`notes=D:\Notes\Thesis`) — the drive colon and
   backslashes must survive; only the first `=` splits. Pinned in Task 1.
2. A request arriving while its vault is being closed for idleness must get a working context,
   not a closed database. Pinned in Task 2 (`get` waits for a pending close).
3. A note path that exists in vault A requested through vault B's id answers 404, and the
   asset route of vault B never serves vault A's files. Pinned in Task 3.
4. Switching vaults while a reload of the previous vault is still in flight must not write the
   old vault's notes into the new vault's store. Pinned in Task 4 (epoch check).
5. An old bookmark with a query and a fragment (`/graph?note=…`, `/notes/X#heading`) keeps both
   after the redirect. Pinned in Task 4 (`redirectTarget` test) and Task 7 (e2e).

---

### Task 1: Vault registry

**Files:**

- Create: `apps/server/src/vault/registry.ts`
- Test: `apps/server/src/vault/registry.test.ts`

**Interfaces:**

- Produces:
  - `VAULT_ID_PATTERN: RegExp`, `DEFAULT_VAULT_ID = 'default'`
  - `interface RegisteredVault { readonly id: string; readonly name: string; readonly dir: string }`
  - `class RegistryError extends Error`
  - `parseVaultList(value: string, cwd: string): RegisteredVault[]`
  - `singleVault(dir: string): RegisteredVault`
  - `checkVaultDirs(vaults: readonly RegisteredVault[]): void`

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkVaultDirs, parseVaultList, RegistryError, singleVault } from './registry.js';

const cwd = realpathSync.native(tmpdir());

describe('parseVaultList', () => {
  it('reads id=path pairs in order, trimming blanks and a trailing separator', () => {
    const vaults = parseVaultList(' dnd = campaigns/dnd ; thesis=notes/thesis;', cwd);
    expect(vaults).toEqual([
      { id: 'dnd', name: 'dnd', dir: join(cwd, 'campaigns', 'dnd') },
      { id: 'thesis', name: 'thesis', dir: join(cwd, 'notes', 'thesis') },
    ]);
  });

  it('splits on the first = only, so a Windows path survives', () => {
    const [vault] = parseVaultList('notes=D:\\Notes\\a=b', cwd);
    expect(vault?.id).toBe('notes');
    expect(vault?.dir.endsWith('a=b')).toBe(true);
  });

  it.each([
    ['dnd', 'not of the form id=path'],
    ['Dnd=x', 'not a valid vault id'],
    ['-x=x', 'not a valid vault id'],
    [`${'a'.repeat(33)}=x`, 'not a valid vault id'],
    ['dnd=', 'has no path'],
    ['dnd=a;dnd=b', 'named twice'],
    [' ; ', 'names no vault'],
  ])('rejects %j', (value, message) => {
    expect(() => parseVaultList(value, cwd)).toThrow(RegistryError);
    expect(() => parseVaultList(value, cwd)).toThrow(message);
  });
});

describe('singleVault', () => {
  it('names the one vault default and after its folder', () => {
    expect(singleVault(join(cwd, 'My Notes'))).toEqual({
      id: 'default',
      name: 'My Notes',
      dir: join(cwd, 'My Notes'),
    });
  });
});

describe('checkVaultDirs', () => {
  it('accepts directories and rejects missing paths and files', () => {
    const root = mkdtempSync(join(cwd, 'rhizom-registry-'));
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'file.md'), '');
    expect(() => {
      checkVaultDirs([{ id: 'a', name: 'a', dir: join(root, 'a') }]);
    }).not.toThrow();
    expect(() => {
      checkVaultDirs([{ id: 'b', name: 'b', dir: join(root, 'missing') }]);
    }).toThrow('Vault "b"');
    expect(() => {
      checkVaultDirs([{ id: 'c', name: 'c', dir: join(root, 'file.md') }]);
    }).toThrow('is not a directory');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run apps/server/src/vault/registry.test.ts`
Expected: FAIL, cannot resolve `./registry.js`.

- [ ] **Step 3: Implement**

```ts
// The vaults this server may open, as the operator registered them. Only these can be opened:
// a browser that may name any path is a browser that may read any folder on the machine.
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const VAULT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const DEFAULT_VAULT_ID = 'default';

export interface RegisteredVault {
  readonly id: string;
  /** Folder name, shown in the switcher. */
  readonly name: string;
  /** Absolute path of the vault folder. */
  readonly dir: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Parses `RHIZOM_VAULTS`: `id=path` pairs separated by `;`, paths resolved against `cwd`. */
export function parseVaultList(value: string, cwd: string): RegisteredVault[] {
  const vaults: RegisteredVault[] = [];
  for (const raw of value.split(';')) {
    const entry = raw.trim();
    if (entry === '') {
      continue;
    }
    const separator = entry.indexOf('=');
    if (separator === -1) {
      throw new RegistryError(`RHIZOM_VAULTS: "${entry}" is not of the form id=path`);
    }
    const id = entry.slice(0, separator).trim();
    const path = entry.slice(separator + 1).trim();
    if (!VAULT_ID_PATTERN.test(id)) {
      throw new RegistryError(
        `RHIZOM_VAULTS: "${id}" is not a valid vault id (lower-case letters, digits and dashes, at most 32, not starting with a dash)`,
      );
    }
    if (path === '') {
      throw new RegistryError(`RHIZOM_VAULTS: vault "${id}" has no path`);
    }
    if (vaults.some((vault) => vault.id === id)) {
      throw new RegistryError(`RHIZOM_VAULTS: vault "${id}" is named twice`);
    }
    const dir = resolve(cwd, path);
    vaults.push({ id, name: basename(dir), dir });
  }
  if (vaults.length === 0) {
    throw new RegistryError('RHIZOM_VAULTS is set but names no vault');
  }
  return vaults;
}

/** The one vault of a `RHIZOM_VAULT_DIR` setup. */
export function singleVault(dir: string): RegisteredVault {
  return { id: DEFAULT_VAULT_ID, name: basename(dir), dir };
}

/** Fails start-up on a vault folder that is missing or not a folder. */
export function checkVaultDirs(vaults: readonly RegisteredVault[]): void {
  for (const vault of vaults) {
    let isDirectory = false;
    try {
      isDirectory = statSync(vault.dir).isDirectory();
    } catch {
      // Missing or unreadable: reported below in one message.
    }
    if (!isDirectory) {
      throw new RegistryError(`Vault "${vault.id}": ${vault.dir} is not a directory`);
    }
  }
}
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm vitest run apps/server/src/vault/registry.test.ts` — Expected: PASS.

---

### Task 2: Vault pool

**Files:**

- Create: `apps/server/src/vault/pool.ts`
- Test: `apps/server/src/vault/pool.test.ts`

**Interfaces:**

- Consumes: `RegisteredVault` (Task 1), `VaultContext` (`vault/context.ts`, unchanged).
- Produces:
  - `DEFAULT_IDLE_MS = 600_000`
  - `interface VaultPoolOptions { vaults: readonly RegisteredVault[]; open: (vault: RegisteredVault) => Promise<VaultContext>; idleMs?: number; onLog?: (message: string) => void }`
  - `class VaultPool { list(): readonly RegisteredVault[]; has(id: string): boolean; isOpen(id: string): boolean; get(id: string): Promise<VaultContext>; hold(id: string): () => void; close(): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultContext } from './context.js';
import { VaultPool } from './pool.js';
import type { RegisteredVault } from './registry.js';

const vaults: RegisteredVault[] = [
  { id: 'a', name: 'a', dir: '/a' },
  { id: 'b', name: 'b', dir: '/b' },
];
const IDLE = 1_000;

function fakeContext(): VaultContext & { closed: boolean } {
  const context = {
    closed: false,
    close: vi.fn(() => {
      context.closed = true;
      return Promise.resolve();
    }),
  };
  return context as unknown as VaultContext & { closed: boolean };
}

describe('VaultPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a vault on first use and shares one pending open', async () => {
    const open = vi.fn(() => Promise.resolve(fakeContext()));
    const pool = new VaultPool({ vaults, open, idleMs: IDLE });
    expect(pool.isOpen('a')).toBe(false);
    const [first, second] = await Promise.all([pool.get('a'), pool.get('a')]);
    expect(first).toBe(second);
    expect(open).toHaveBeenCalledTimes(1);
    expect(pool.isOpen('a')).toBe(true);
    expect(pool.isOpen('b')).toBe(false);
  });

  it('does not cache a failed open', async () => {
    const open = vi
      .fn<(vault: RegisteredVault) => Promise<VaultContext>>()
      .mockRejectedValueOnce(new Error('disk gone'))
      .mockResolvedValueOnce(fakeContext());
    const pool = new VaultPool({ vaults, open, idleMs: IDLE });
    await expect(pool.get('a')).rejects.toThrow('disk gone');
    await expect(pool.get('a')).resolves.toBeDefined();
  });

  it('closes a vault that nobody used for the idle time', async () => {
    const context = fakeContext();
    const pool = new VaultPool({ vaults, open: () => Promise.resolve(context), idleMs: IDLE });
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE - 10);
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE - 10);
    expect(context.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(context.closed).toBe(true);
    expect(pool.isOpen('a')).toBe(false);
  });

  it('keeps a held vault open and starts the idle time when the hold ends', async () => {
    const context = fakeContext();
    const pool = new VaultPool({ vaults, open: () => Promise.resolve(context), idleMs: IDLE });
    await pool.get('a');
    const release = pool.hold('a');
    await vi.advanceTimersByTimeAsync(IDLE * 5);
    expect(context.closed).toBe(false);
    release();
    release();
    await vi.advanceTimersByTimeAsync(IDLE + 10);
    expect(context.closed).toBe(true);
  });

  it('waits for a pending idle close before opening again', async () => {
    let finishClose: () => void = () => undefined;
    const first = fakeContext();
    first.close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = () => {
            first.closed = true;
            resolve();
          };
        }),
    );
    const second = fakeContext();
    const open = vi
      .fn<(vault: RegisteredVault) => Promise<VaultContext>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const pool = new VaultPool({ vaults, open, idleMs: IDLE });
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE + 10);
    const reopened = pool.get('a');
    expect(open).toHaveBeenCalledTimes(1);
    finishClose();
    expect(await reopened).toBe(second);
  });

  it('closes everything on close and knows only registered ids', async () => {
    const a = fakeContext();
    const pool = new VaultPool({ vaults, open: () => Promise.resolve(a), idleMs: IDLE });
    await pool.get('a');
    await pool.close();
    expect(a.closed).toBe(true);
    expect(pool.has('a')).toBe(true);
    expect(pool.has('c')).toBe(false);
    await expect(pool.get('c')).rejects.toThrow('Unknown vault');
    expect(pool.list().map((vault) => vault.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run apps/server/src/vault/pool.test.ts` — Expected: FAIL, cannot resolve
`./pool.js`.

- [ ] **Step 3: Implement**

```ts
// The open vaults. A vault is opened when it is first asked for and closed again when nothing
// has touched it for a while, so ten registered vaults are not ten open databases and ten file
// watchers. Whatever changed on disk while one was closed is picked up by the incremental sync
// that every open runs: the files are the truth.
import type { VaultContext } from './context.js';
import type { RegisteredVault } from './registry.js';

export const DEFAULT_IDLE_MS = 10 * 60_000;

export interface VaultPoolOptions {
  vaults: readonly RegisteredVault[];
  open: (vault: RegisteredVault) => Promise<VaultContext>;
  idleMs?: number;
  onLog?: (message: string) => void;
}

interface Entry {
  readonly vault: RegisteredVault;
  context: VaultContext | undefined;
  opening: Promise<VaultContext> | undefined;
  closing: Promise<void> | undefined;
  holds: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class VaultPool {
  readonly #entries = new Map<string, Entry>();
  readonly #open: (vault: RegisteredVault) => Promise<VaultContext>;
  readonly #idleMs: number;
  readonly #onLog: ((message: string) => void) | undefined;
  #closed = false;

  constructor(options: VaultPoolOptions) {
    for (const vault of options.vaults) {
      this.#entries.set(vault.id, {
        vault,
        context: undefined,
        opening: undefined,
        closing: undefined,
        holds: 0,
        timer: undefined,
      });
    }
    this.#open = options.open;
    this.#idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.#onLog = options.onLog;
  }

  list(): readonly RegisteredVault[] {
    return [...this.#entries.values()].map((entry) => entry.vault);
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  isOpen(id: string): boolean {
    return this.#entries.get(id)?.context !== undefined;
  }

  /** The vault's context, opened on first use. Every call counts as use. */
  async get(id: string): Promise<VaultContext> {
    const entry = this.#entry(id);
    this.#touch(entry);
    if (entry.closing !== undefined) {
      await entry.closing;
    }
    if (entry.context !== undefined) {
      return entry.context;
    }
    entry.opening ??= this.#open(entry.vault).then(
      (context) => {
        entry.context = context;
        entry.opening = undefined;
        this.#touch(entry);
        return context;
      },
      (error: unknown) => {
        entry.opening = undefined;
        throw error;
      },
    );
    return entry.opening;
  }

  /** Keeps the vault open until the returned function is called (an event stream). */
  hold(id: string): () => void {
    const entry = this.#entry(id);
    entry.holds += 1;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      entry.holds -= 1;
      this.#touch(entry);
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all(
      [...this.#entries.values()].map(async (entry) => {
        clearTimeout(entry.timer);
        entry.timer = undefined;
        await entry.closing;
        const context = entry.context ?? (await entry.opening?.catch(() => undefined));
        entry.context = undefined;
        await context?.close();
      }),
    );
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown vault "${id}"`);
    }
    return entry;
  }

  #touch(entry: Entry): void {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    if (entry.holds > 0 || this.#closed) {
      return;
    }
    entry.timer = setTimeout(() => {
      this.#closeIdle(entry);
    }, this.#idleMs);
    entry.timer.unref();
  }

  #closeIdle(entry: Entry): void {
    entry.timer = undefined;
    const context = entry.context;
    // Still opening, or held by a stream: the open's own touch, or the release, re-arms it.
    if (context === undefined || entry.holds > 0) {
      return;
    }
    entry.context = undefined;
    entry.closing = context.close().finally(() => {
      entry.closing = undefined;
      this.#onLog?.(`Closed vault "${entry.vault.id}" after it was idle`);
    });
  }
}
```

- [ ] **Step 4: Run to see it pass**

Run: `pnpm vitest run apps/server/src/vault/pool.test.ts` — Expected: PASS.

---

### Task 3: The API under `/api/v/{vault}`

**Files:**

- Create: `apps/server/src/routes/vault-scope.ts`
- Modify: `apps/server/src/app.ts` (whole `buildApp`), `apps/server/src/server.ts:25-73`
- Modify: every `register*Routes` in `apps/server/src/routes/` (`assets.ts`, `graph.ts`,
  `maintenance.ts`, `mentions.ts`, `notes.ts`, `query.ts`, `rename.ts`, `search.ts`,
  `tag-rename.ts`, `terms.ts`)
- Modify: `apps/server/src/routes/schemas/notes.ts` (add `VaultSummarySchema`),
  `packages/core/src/api.ts` (add `VaultSummary`)
- Modify: `apps/server/openapi.json` (regenerated)
- Test: `apps/server/src/app.test.ts`, `routes/graph.test.ts`, `routes/query.test.ts`,
  `routes/rename.test.ts`, `routes/tag-rename.test.ts` (URL sweep), new
  `apps/server/src/vaults.test.ts`

**Interfaces:**

- Consumes: `VaultPool` (Task 2), `RegisteredVault`, `parseVaultList`, `singleVault`,
  `checkVaultDirs`, `RegistryError` (Task 1).
- Produces:
  - `packages/core`: `interface VaultSummary { id: string; name: string }`
  - `type VaultContextOf = (request: FastifyRequest) => VaultContext` — what every
    `register*Routes(app, context)` now receives instead of `() => VaultContext`.
  - `registerMaintenanceRoutes(app, context, hold: (request: FastifyRequest) => () => void)`
  - `BuildAppOptions.vaults?: { list: readonly RegisteredVault[]; dataDir: string; watch?: boolean; templateDir?: string; dailyDir?: string; idleMs?: number }`;
    `BuildAppOptions.vault` stays as a shorthand for one vault with the id `default`.
  - HTTP: `GET /api/vaults` → `VaultSummary[]`; every former `/api/<x>` vault route at
    `/api/v/{vault}/<x>`; assets at `/api/v/{vault}/assets/<path>`.

- [ ] **Step 1: Write the failing integration tests** — `apps/server/src/vaults.test.ts`

```ts
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NoteDocument, VaultSummary } from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

function vaultWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-vaults-'));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

describe('more than one vault', () => {
  let app: FastifyInstance;
  let dndDir: string;

  beforeAll(async () => {
    dndDir = vaultWith({ 'Mira.md': '# Mira\n\nSee [[Thesis]].\n', 'map.png': 'png' });
    const thesisDir = vaultWith({ 'Thesis.md': '# Thesis\n' });
    app = await buildApp({
      webDist: false,
      vaults: {
        list: [
          { id: 'dnd', name: 'dnd', dir: dndDir },
          { id: 'thesis', name: 'thesis', dir: thesisDir },
        ],
        dataDir: ':memory:',
        watch: false,
      },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists the registered vaults without their paths', async () => {
    const response = await app.inject('/api/vaults');
    expect(response.statusCode).toBe(200);
    expect(response.json<VaultSummary[]>()).toEqual([
      { id: 'dnd', name: 'dnd' },
      { id: 'thesis', name: 'thesis' },
    ]);
    expect(response.body).not.toContain(dndDir);
  });

  it('reads each note through its own vault only', async () => {
    const mira = await app.inject('/api/v/dnd/notes/Mira.md');
    expect(mira.statusCode).toBe(200);
    expect(mira.json<NoteDocument>().title).toBe('Mira');
    expect((await app.inject('/api/v/thesis/notes/Mira.md')).statusCode).toBe(404);
  });

  it('does not resolve a link across the vault boundary', async () => {
    const links = await app.inject('/api/v/dnd/notes/Mira.md/links');
    expect(links.json<{ target: string; path: string | null }[]>()).toEqual([
      expect.objectContaining({ path: null }),
    ]);
  });

  it('serves assets per vault and never another vault’s', async () => {
    expect((await app.inject('/api/v/dnd/assets/map.png')).statusCode).toBe(200);
    expect((await app.inject('/api/v/thesis/assets/map.png')).statusCode).toBe(404);
  });

  it.each(['/api/v/nope/notes', '/api/v/NOPE/notes', '/api/v/..%2F/notes'])(
    'answers 404 for the unknown vault %s',
    async (url) => {
      expect((await app.inject(url)).statusCode).toBe(404);
    },
  );

  it('publishes the vault parameter in the OpenAPI document', async () => {
    const document = (await app.inject('/api/openapi.json')).json<{
      paths: Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>;
    }>();
    const read = document.paths['/api/v/{vault}/notes/{*}']?.get;
    expect(read?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'vault', in: 'path' })]),
    );
  });
});
```

Adjust the `links` assertion to the actual `NoteLink` shape in `packages/core/src/api.ts`
(the field that is `null` for an unresolved link) before running.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run apps/server/src/vaults.test.ts` — Expected: FAIL (`vaults` is not an
option; `/api/vaults` is a 404).

- [ ] **Step 3: Add the shared type and schema**

`packages/core/src/api.ts`, next to `VaultInfo`:

```ts
/** A registered vault as the switcher sees it: never its path on disk. */
export interface VaultSummary {
  id: string;
  name: string;
}
```

`apps/server/src/routes/schemas/notes.ts`:

```ts
export const VaultSummarySchema = Type.Object(
  {
    id: Type.String({ description: 'The id the vault is registered under' }),
    name: Type.String({ description: 'Folder name of the vault' }),
  },
  { $id: 'VaultSummary' },
);
```

Export it from `routes/schemas/index.ts` the way the other schemas are.

- [ ] **Step 4: Create `apps/server/src/routes/vault-scope.ts`**

```ts
// Every vault route lives under /api/v/:vault. One encapsulated plugin resolves the vault per
// request, before any handler runs, so a handler only ever sees a vault the operator registered.
import { Type, type TObject } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';

import type { VaultContext } from '../vault/context.js';
import type { VaultPool } from '../vault/pool.js';
import { VAULT_ID_PATTERN } from '../vault/registry.js';
import { HttpError } from './errors.js';
import { ErrorSchema, VaultSummarySchema } from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

declare module 'fastify' {
  interface FastifyRequest {
    vaultContext?: VaultContext;
  }
}

export type VaultContextOf = (request: FastifyRequest) => VaultContext;

const VaultParam = Type.String({ pattern: VAULT_ID_PATTERN.source, description: 'Vault id' });

function vaultIdOf(request: FastifyRequest): string {
  return (request.params as { vault?: string }).vault ?? '';
}

export const vaultContextOf: VaultContextOf = (request) => {
  const context = request.vaultContext;
  if (context === undefined) {
    throw new Error('A vault route ran without a resolved vault');
  }
  return context;
};

export async function registerVaultScope(
  app: TypedApp,
  pool: VaultPool | undefined,
  routes: (scoped: TypedApp, hold: (request: FastifyRequest) => () => void) => Promise<void> | void,
): Promise<void> {
  app.get(
    '/api/vaults',
    {
      schema: {
        tags: ['vault'],
        summary: 'The registered vaults',
        response: { 200: Type.Array(VaultSummarySchema) },
      },
    },
    () => (pool?.list() ?? []).map(({ id, name }) => ({ id, name })),
  );

  await app.register(
    async (scoped) => {
      // Every route below takes the vault as a path parameter; declaring it here keeps the
      // published contract honest without repeating it in forty schemas.
      scoped.addHook('onRoute', (route) => {
        const schema = (route.schema ??= {});
        const params = schema.params as TObject | undefined;
        schema.params = Type.Object({ vault: VaultParam, ...(params?.properties ?? {}) });
        const response = (schema.response ?? {}) as Record<string, unknown>;
        schema.response = { 404: ErrorSchema, ...response };
      });
      scoped.addHook('onRequest', async (request) => {
        const id = vaultIdOf(request);
        if (pool === undefined) {
          throw new HttpError(
            503,
            'No vault is configured (set RHIZOM_VAULTS or RHIZOM_VAULT_DIR)',
          );
        }
        if (!VAULT_ID_PATTERN.test(id) || !pool.has(id)) {
          throw new HttpError(404, 'Unknown vault');
        }
        request.vaultContext = await pool.get(id);
      });
      const hold = (request: FastifyRequest): (() => void) =>
        pool?.hold(vaultIdOf(request)) ?? (() => undefined);
      await routes(scoped, hold);
    },
    { prefix: '/api/v/:vault' },
  );
}
```

If a route already declares `'4xx': ErrorSchema`, the added `404` is harmless; if TypeBox or
`@fastify/swagger` complains about duplicate response codes, drop the `schema.response` line
and rely on `'4xx'`. Confirm that the `onRequest` hook sees `request.params.vault` (Fastify
fills params at routing); if it does not, move the hook to `preValidation`.

- [ ] **Step 5: Sweep the route modules**

In each `register*Routes` file:

1. Change the parameter type `context: () => VaultContext` to `context: VaultContextOf`
   (import from `./vault-scope.js`).
2. Drop the `/api` prefix from every route path: `'/api/notes/*'` → `'/notes/*'`,
   `'/api/vault'` → `'/vault'`, `'/api/events'` → `'/events'`, and so on.
3. Every `context()` becomes `context(request)`; a handler that does not take `request` yet
   gains it (`() => context().index.tree()` → `(request) => context(request).index.tree()`).
4. In `maintenance.ts`, add a third parameter `hold: (request: FastifyRequest) => () => void`
   and in the events handler call `const release = hold(request);` right after
   `const ctx = context(request);`, and `release();` inside the `request.raw.on('close', …)`
   callback.
5. In `assets.ts`, delete the `@fastify/static` registration and the `vaultRoot` parameter
   (static serving moves to `app.ts`, per vault); keep the multipart registration and the two
   routes, now `'/assets'`.

- [ ] **Step 6: Rewrite `buildApp`**

Replace the single-context block in `apps/server/src/app.ts` with:

```ts
export interface VaultsOption {
  list: readonly RegisteredVault[];
  /** Folder for the index databases (one subfolder per vault), or ':memory:'. */
  dataDir: string;
  watch?: boolean;
  templateDir?: string;
  dailyDir?: string;
  /** How long an unused vault stays open (default ten minutes). */
  idleMs?: number;
}
```

and in `BuildAppOptions` add `vaults?: VaultsOption;` beside the existing `vault` option
(document `vault` as "Shorthand for one vault with the id `default`"). In `buildApp`:

```ts
const vaults: VaultsOption | undefined =
  options.vaults ??
  (options.vault === undefined
    ? undefined
    : {
        list: [singleVault(options.vault.dir)],
        dataDir: options.vault.dataDir,
        ...(options.vault.watch === undefined ? {} : { watch: options.vault.watch }),
        ...(options.vault.templateDir === undefined
          ? {}
          : { templateDir: options.vault.templateDir }),
        ...(options.vault.dailyDir === undefined ? {} : { dailyDir: options.vault.dailyDir }),
      });

let pool: VaultPool | undefined;
if (vaults !== undefined) {
  const { dataDir } = vaults;
  pool = new VaultPool({
    vaults: vaults.list,
    ...(vaults.idleMs === undefined ? {} : { idleMs: vaults.idleMs }),
    onLog: (message) => {
      app.log.info(message);
    },
    open: (vault) =>
      openVaultContext({
        dir: vault.dir,
        dataDir: dataDir === ':memory:' ? ':memory:' : join(dataDir, vault.id),
        watch: vaults.watch ?? true,
        ...(vaults.templateDir === undefined ? {} : { templateDir: vaults.templateDir }),
        ...(vaults.dailyDir === undefined ? {} : { dailyDir: vaults.dailyDir }),
        onLog: (message) => {
          app.log.info(message);
        },
        onWatchError: (error) => {
          app.log.warn(error, 'vault watcher error');
        },
      }),
  });
  const opened = pool;
  app.addHook('onClose', async () => {
    await opened.close();
  });
  // Files inside each vault (images, PDFs …) for embeds. Static per vault because the set is
  // fixed at start-up; a note is not an asset, and hidden files are never served.
  for (const vault of vaults.list) {
    await app.register(fastifyStatic, {
      root: vault.dir,
      prefix: `/api/v/${vault.id}/assets/`,
      decorateReply: false,
      dotfiles: 'ignore',
      index: false,
      list: false,
      allowedPath: (pathName) => !/\.(md|markdown)$/i.test(pathName),
    });
  }
}

app.addSchema(TreeEntrySchema);

await registerVaultScope(app, pool, async (scoped, hold) => {
  registerNoteRoutes(scoped, vaultContextOf);
  registerRenameRoutes(scoped, vaultContextOf);
  registerSearchRoutes(scoped, vaultContextOf);
  registerTagRenameRoutes(scoped, vaultContextOf);
  registerQueryRoutes(scoped, vaultContextOf);
  registerTermRoutes(scoped, vaultContextOf);
  registerMentionRoutes(scoped, vaultContextOf);
  registerGraphRoutes(scoped, vaultContextOf);
  registerMaintenanceRoutes(scoped, vaultContextOf, hold);
  await registerAssetRoutes(scoped, vaultContextOf);
});
```

Move the comment that sat above `app.addSchema(TreeEntrySchema)` with it. Remove
`requireContext`, the eager `openVaultContext` call and the old `onClose` hook. Keep the
`fastifyStatic` comment from `assets.ts` ("one door to the notes") beside the new loop.

- [ ] **Step 7: Wire the environment in `server.ts`**

Replace lines 25–33 and the `vault:` spread in the `buildApp` call:

```ts
// The vaults: RHIZOM_VAULTS (id=path;…), or RHIZOM_VAULT_DIR for one, or the repository's
// example vault while developing.
const exampleVault = fileURLToPath(new URL('../../../examples/vault', import.meta.url));
const vaultList = env('RHIZOM_VAULTS', '');
const configuredVault = env('RHIZOM_VAULT_DIR', '');
let vaults: RegisteredVault[] = [];
let vaultNote = '';
try {
  if (vaultList !== '' && configuredVault !== '') {
    throw new RegistryError('Set RHIZOM_VAULTS or RHIZOM_VAULT_DIR, not both');
  }
  if (vaultList !== '') {
    vaults = parseVaultList(vaultList, process.cwd());
  } else if (configuredVault !== '') {
    vaults = [singleVault(resolve(configuredVault))];
  } else if (!isProduction && existsSync(exampleVault)) {
    vaults = [singleVault(exampleVault)];
    vaultNote = 'No vault is configured; using the example vault from the repository';
  }
  checkVaultDirs(vaults);
} catch (error) {
  if (error instanceof RegistryError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
```

and pass `...(vaults.length === 0 ? {} : { vaults: { list: vaults, dataDir, ...templateDir/dailyDir spreads as before } })`.
The log lines become:

```ts
if (vaults.length === 0) {
  app.log.warn('No vault configured: set RHIZOM_VAULTS or RHIZOM_VAULT_DIR');
} else {
  for (const vault of vaults) {
    app.log.info(`Vault "${vault.id}": ${vault.dir} (index in ${join(dataDir, vault.id)})`);
  }
}
```

- [ ] **Step 8: Sweep the server tests**

In `app.test.ts`, `routes/*.test.ts`: every request URL `'/api/<x>'` other than
`/api/health` and `/api/openapi.json` becomes `'/api/v/default/<x>'` (template literals too:
`` `/api/notes/${…}` `` → `` `/api/v/default/notes/${…}` ``). Tests that asserted the 503
"no vault configured" answer keep asserting 503 on `/api/v/default/…`. A test that relied on
the vault being indexed at `buildApp` time (the initial sync log) must make one request first.

- [ ] **Step 9: Regenerate the OpenAPI document and run the server suite**

Run: `pnpm --filter @rhizom/server openapi && pnpm vitest run --project server`
(use the project name from the root `vitest.config.ts` if it differs).
Expected: PASS, including `vaults.test.ts` and `openapi.test.ts`.

---

### Task 4: The web app under `/v/<id>`

**Files:**

- Create: `apps/web/src/routing/vault.ts`, `apps/web/src/routing/vault.test.ts`
- Create: `apps/web/src/app/VaultRoot.tsx` (loader, not-found view, keyed `Layout`)
- Create: `apps/web/src/store/reset.ts`
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/api/client.ts`,
  `apps/web/src/api/events.ts`, `apps/web/src/routing/paths.ts` (+ its test, if any),
  `apps/web/src/store/vault.ts`, `apps/web/src/store/notes.ts`,
  `apps/web/src/store/queries.ts`, `apps/web/src/app/Layout.tsx:173-197`,
  `apps/web/src/app/layout/commands.ts:79-87`, `apps/web/src/pages/NotePage.tsx:207`
- Modify: `apps/web/src/i18n/locales/en/common.json`, `de/common.json`

**Interfaces:**

- Consumes: `VaultSummary` (Task 3), `GET /api/vaults`, `/api/v/{vault}/…`.
- Produces (`routing/vault.ts`):
  - `currentVault(): string` (starts as `'default'`; the loader sets it before anything
    renders)
  - `setCurrentVault(id: string): void` (also remembers it in `localStorage`)
  - `lastVault(): string | null`
  - `vaultHref(path: string, vault?: string): string` — `'/notes/X'` → `'/v/<id>/notes/X'`,
    `'/'` → `'/v/<id>'`
  - `stripVault(pathname: string): string` — `'/v/dnd/notes/X'` → `'/notes/X'`
  - `pickVault(vaults: readonly VaultSummary[], remembered: string | null): string`
  - `redirectTarget(url: URL, vault: string): string`
- Produces (`store/reset.ts`): `resetVaultStores(): void`
- Produces (`api/client.ts`): `api.vaults()`; every vault call goes to `/api/v/<current>/…`.

- [ ] **Step 1: Write the failing tests** — `apps/web/src/routing/vault.test.ts`

```ts
import { afterEach, describe, expect, it } from 'vitest';

import {
  currentVault,
  lastVault,
  pickVault,
  redirectTarget,
  setCurrentVault,
  stripVault,
  vaultHref,
} from './vault.js';

const vaults = [
  { id: 'dnd', name: 'dnd' },
  { id: 'thesis', name: 'Thesis' },
];

describe('vault routing', () => {
  afterEach(() => {
    setCurrentVault('default');
    localStorage.clear();
  });

  it('prefixes in-app paths with the current vault', () => {
    setCurrentVault('dnd');
    expect(currentVault()).toBe('dnd');
    expect(vaultHref('/notes/Mira')).toBe('/v/dnd/notes/Mira');
    expect(vaultHref('/')).toBe('/v/dnd');
    expect(vaultHref('/graph?note=a', 'thesis')).toBe('/v/thesis/graph?note=a');
  });

  it('strips the prefix again', () => {
    expect(stripVault('/v/dnd/notes/Mira')).toBe('/notes/Mira');
    expect(stripVault('/v/dnd')).toBe('/');
    expect(stripVault('/notes/Mira')).toBe('/notes/Mira');
  });

  it('remembers the last vault and picks it while it is registered', () => {
    setCurrentVault('thesis');
    expect(lastVault()).toBe('thesis');
    expect(pickVault(vaults, 'thesis')).toBe('thesis');
    expect(pickVault(vaults, 'gone')).toBe('dnd');
    expect(pickVault([], null)).toBe('default');
  });

  it('keeps the query and the fragment of an old bookmark', () => {
    expect(redirectTarget(new URL('http://x/graph?note=a.md'), 'dnd')).toBe(
      '/v/dnd/graph?note=a.md',
    );
    expect(redirectTarget(new URL('http://x/notes/Mira#voice'), 'dnd')).toBe(
      '/v/dnd/notes/Mira#voice',
    );
    expect(redirectTarget(new URL('http://x/'), 'dnd')).toBe('/v/dnd');
  });
});
```

Add to the `paths` tests (create `routing/paths.test.ts` if it does not exist):

```ts
it('builds note addresses inside the current vault and reads them back', () => {
  setCurrentVault('dnd');
  expect(noteHref('Campaign/NPCs/Mira.md')).toBe('/v/dnd/notes/Campaign/NPCs/Mira');
  expect(notePathFromLocation('/v/dnd/wiki/Campaign/NPCs/Mira')).toBe('Campaign/NPCs/Mira.md');
  setCurrentVault('default');
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run apps/web/src/routing` — Expected: FAIL, cannot resolve `./vault.js`.

- [ ] **Step 3: Implement `routing/vault.ts`**

```ts
// The vault this tab is in. One tab shows one vault at a time, and the `/v/:vault` loader sets
// it before anything inside renders, so the API client, the event stream and every in-app link
// can read it here instead of threading it through every component.
import type { VaultSummary } from '@rhizom/core';

const LAST_VAULT_KEY = 'rhizom.lastVault';
const FALLBACK = 'default';

let current = FALLBACK;

export function currentVault(): string {
  return current;
}

export function setCurrentVault(id: string): void {
  current = id;
  try {
    window.localStorage.setItem(LAST_VAULT_KEY, id);
  } catch {
    // Storage blocked: the next visit starts at the first vault, which is fine.
  }
}

export function lastVault(): string | null {
  try {
    return window.localStorage.getItem(LAST_VAULT_KEY);
  } catch {
    return null;
  }
}

/** `/notes/X` inside a vault: `/v/<id>/notes/X`. */
export function vaultHref(path: string, vault: string = current): string {
  const prefix = `/v/${encodeURIComponent(vault)}`;
  return path === '/' || path === '' ? prefix : `${prefix}${path}`;
}

/** The in-vault part of a pathname: `/v/dnd/notes/X` → `/notes/X`. */
export function stripVault(pathname: string): string {
  const match = /^\/v\/[^/]+(\/.*)?$/.exec(pathname);
  if (match === null) {
    return pathname;
  }
  return match[1] ?? '/';
}

/** The remembered vault while it is still registered, else the first one. */
export function pickVault(vaults: readonly VaultSummary[], remembered: string | null): string {
  if (remembered !== null && vaults.some((vault) => vault.id === remembered)) {
    return remembered;
  }
  return vaults[0]?.id ?? FALLBACK;
}

/** Where a pre-vault address (`/notes/…`, `/graph?…`) lives now. */
export function redirectTarget(url: URL, vault: string): string {
  return vaultHref(`${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`, vault);
}
```

Update `routing/paths.ts`: `noteHref` returns
`vaultHref(`/${mode}/${…}`)`, and `notePathFromLocation` matches against
`stripVault(pathname)`.

- [ ] **Step 4: Prefix the API client and the event stream**

In `api/client.ts`, add

```ts
/** A vault route of the current vault. */
function inVault(path: string): string {
  return `/api/v/${encodeURIComponent(currentVault())}${path}`;
}
```

and replace every `'/api/<x>'` / `` `/api/<x>…` `` in the `api` object with
`inVault('/<x>')` / ``inVault(`/<x>…`)``, including `assetUrl`:
``assetUrl: (path: string) => inVault(`/assets/${encodeVaultPath(path)}`)``.
Add `vaults: (options?: RequestOptions) => request<VaultSummary[]>('/api/vaults', options),`.
In `api/events.ts`: `new EventSource(`/api/v/${encodeURIComponent(currentVault())}/events`)`
and the doc comment says `/api/v/<vault>/events`. Fix `api/client.test.ts` expectations to the
prefixed URLs.

- [ ] **Step 5: Reset the vault's stores on a switch**

For each of `store/vault.ts`, `store/notes.ts`, `store/queries.ts`: capture the store's
initial state in a `const initial…` object, export `reset…()` that sets it back, and add a
module-level `let epoch = 0` that `reset…()` increments. Every async action captures
`const started = epoch` before its first `await` and returns without `set` when
`started !== epoch` afterwards. In `store/vault.ts` that means `load` and `refresh`:

```ts
let epoch = 0;

export function resetVaultStore(): void {
  epoch += 1;
  useVaultStore.setState(initialVaultState);
}
```

with, inside `load`: `const started = epoch;` before `fetchAll()`, and
`if (started !== epoch) { return; }` right after it resolves and in the `catch` block. The
same in `refresh`. The 503 branch stays (`noVault`); add `vaultMissing: boolean` set for 404,
so the page can tell "no vault configured" from "this vault does not exist".

Create `store/reset.ts`:

```ts
import { resetNoteSources } from './notes.js';
import { resetQueries } from './queries.js';
import { resetVaultStore } from './vault.js';

/** Everything that belongs to one vault, emptied before another one is shown. */
export function resetVaultStores(): void {
  resetVaultStore();
  resetNoteSources();
  resetQueries();
}
```

Write a unit test in `store/vault.test.ts`: start `load()` with a `fetch` mock that resolves
after `resetVaultStore()` has run, and assert the store's `notes` are still empty.

- [ ] **Step 6: Router, loader and the not-found view**

`App.tsx`:

```ts
const router = createBrowserRouter([
  {
    id: 'vault',
    path: '/v/:vault',
    loader: vaultLoader,
    Component: VaultRoot,
    children: [/* the existing children of '/', unchanged */],
  },
  // `/` and every address from before vaults were in the URL.
  { path: '*', loader: legacyRedirect },
]);
```

`app/VaultRoot.tsx`:

```tsx
import type { VaultSummary } from '@rhizom/core';
import { useTranslation } from 'react-i18next';
import { Link, redirect, useLoaderData, useParams, type LoaderFunctionArgs } from 'react-router';

import { api } from '../api/client.js';
import {
  lastVault,
  pickVault,
  redirectTarget,
  setCurrentVault,
  vaultHref,
} from '../routing/vault.js';
import { resetVaultStores } from '../store/reset.js';
import { switchVaultUi } from '../store/vault-ui.js';
import { Layout } from './Layout.js';

let registered: Promise<VaultSummary[]> | undefined;
let shown: string | null = null;

/** The registered vaults, asked for once per page load (they only change with a restart). */
export function registeredVaults(): Promise<VaultSummary[]> {
  registered ??= api.vaults().catch((error: unknown) => {
    registered = undefined;
    throw error;
  });
  return registered;
}

export interface VaultLoaderData {
  vaults: VaultSummary[];
  known: boolean;
}

export async function vaultLoader({ params }: LoaderFunctionArgs): Promise<VaultLoaderData> {
  const vaults = await registeredVaults();
  const id = params.vault ?? '';
  // With no vault configured there is nothing to switch to; the pages say so as they do today.
  const known = vaults.length === 0 || vaults.some((vault) => vault.id === id);
  if (known && id !== shown) {
    shown = id;
    setCurrentVault(id);
    resetVaultStores();
    await switchVaultUi(id);
  }
  return { vaults, known };
}

export async function legacyRedirect({ request }: LoaderFunctionArgs): Promise<Response> {
  const vaults = await registeredVaults();
  return redirect(redirectTarget(new URL(request.url), pickVault(vaults, lastVault())));
}

export function VaultRoot() {
  const { known, vaults } = useLoaderData<VaultLoaderData>();
  const { vault = '' } = useParams();
  const { t } = useTranslation();
  if (!known) {
    return (
      <main className="rz-vault-missing">
        <h1>{t('vault.notFound.title')}</h1>
        <p>{t('vault.notFound.body', { id: vault })}</p>
        <ul>
          {vaults.map((entry) => (
            <li key={entry.id}>
              <Link to={vaultHref('/', entry.id)}>{entry.name}</Link>
            </li>
          ))}
        </ul>
      </main>
    );
  }
  // Keyed by the vault: switching remounts everything below, so no component keeps state that
  // belongs to the vault it came from.
  return <Layout key={vault} />;
}
```

`switchVaultUi` comes from Task 5; until Task 5 lands, write it as a stub in
`store/vault-ui.ts` that returns `Promise.resolve()` — Task 5 replaces the file. Style
`.rz-vault-missing` in the stylesheet that holds the home page's styles, with the same
spacing and type sizes as the home page's empty state.

- [ ] **Step 7: The remaining absolute paths**

- `Layout.tsx:173`: `stripVault(location.pathname).startsWith('/graph')`.
- `Layout.tsx:185,191,197`: `to={vaultHref('/')}`, `vaultHref('/graph…')`,
  `vaultHref('/glossary')`.
- `commands.ts:79,87`: wrap both `navigate` targets in `vaultHref(…)`.
- `NotePage.tsx:207`: `navigate(vaultHref('/'))`.
- `NotePreview.tsx:334`: links in rendered Markdown are already built by `noteHref`, so they
  carry the prefix; no change beyond verifying a click still navigates.
- Run `grep -rnE "['\`\"]/(notes|wiki|graph|glossary)" apps/web/src` and wrap any remaining
  in-app target the same way.
- `HomePage`'s "no vault" message: mention `RHIZOM_VAULTS` beside `RHIZOM_VAULT_DIR` in both
  locales.

- [ ] **Step 8: i18n**

`en/common.json`:

```json
"vault": {
  "switch": "Vault",
  "switchTo": "Switch to vault {{name}}",
  "notFound": {
    "title": "This vault does not exist",
    "body": "No vault is registered as “{{id}}”. These are:"
  }
}
```

`de/common.json`:

```json
"vault": {
  "switch": "Vault",
  "switchTo": "Zu Vault {{name}} wechseln",
  "notFound": {
    "title": "Diesen Vault gibt es nicht",
    "body": "Kein Vault ist als „{{id}}“ registriert. Diese gibt es:"
  }
}
```

- [ ] **Step 9: Run the web unit suite and the typecheck**

Run: `pnpm vitest run --project web && pnpm typecheck` — Expected: PASS.

---

### Task 5: Per-vault UI state

**Files:**

- Create: `apps/web/src/store/vault-ui.ts`, `apps/web/src/store/vault-ui.test.ts`
- Modify: `apps/web/src/store/ui.ts`, `apps/web/src/app/Layout.tsx`,
  `apps/web/src/milieu/MilieuLayout.tsx`, `apps/web/src/pages/GraphPage.tsx`,
  `apps/web/src/panels/FileTree.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: `useVaultUiStore` with `expandedFolders`, `milieuPath`, `graphDepth`,
  `graphTags` and the actions `toggleFolder`, `expandFolders`, `setMilieuPath`,
  `setGraphDepth`, `toggleGraphTag`, `clearGraphTags` (same signatures as in `ui.ts` today);
  `vaultUiKey(id: string): string`; `switchVaultUi(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from 'vitest';

import { switchVaultUi, useVaultUiStore, vaultUiKey } from './vault-ui.js';

describe('per-vault UI state', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('keeps expanded folders apart per vault', async () => {
    await switchVaultUi('dnd');
    useVaultUiStore.getState().toggleFolder('Campaign');
    await switchVaultUi('thesis');
    expect(useVaultUiStore.getState().expandedFolders).toEqual([]);
    useVaultUiStore.getState().setGraphDepth(2);
    await switchVaultUi('dnd');
    expect(useVaultUiStore.getState().expandedFolders).toEqual(['Campaign']);
    expect(useVaultUiStore.getState().graphDepth).toBe(0);
    expect(localStorage.getItem(vaultUiKey('dnd'))).toContain('Campaign');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm vitest run apps/web/src/store/vault-ui.test.ts` — Expected: FAIL (the stub has no
store).

- [ ] **Step 3: Implement `store/vault-ui.ts`**

Move the four fields and six actions out of `ui.ts` into:

```ts
// What the interface remembers about one vault: which folders are open, where the milieu field
// stands, how deep the graph reaches. Kept per vault, so two vaults never share a tree.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VaultUiState {
  expandedFolders: string[];
  milieuPath: string | null;
  graphDepth: number;
  graphTags: string[];
  toggleFolder: (path: string) => void;
  expandFolders: (paths: readonly string[]) => void;
  setMilieuPath: (path: string) => void;
  setGraphDepth: (depth: number) => void;
  toggleGraphTag: (tag: string) => void;
  clearGraphTags: () => void;
}

const empty = { expandedFolders: [], milieuPath: null, graphDepth: 0, graphTags: [] };

export function vaultUiKey(id: string): string {
  return `rhizom.vault.${id}.ui`;
}

export const useVaultUiStore = create<VaultUiState>()(
  persist(
    (set) => ({
      ...empty,
      // The six actions, moved verbatim from ui.ts.
    }),
    {
      name: vaultUiKey('default'),
      version: 1,
      skipHydration: true,
      partialize: (state) => ({
        expandedFolders: state.expandedFolders,
        milieuPath: state.milieuPath,
        graphDepth: state.graphDepth,
      }),
    },
  ),
);

/** Points the store at another vault's saved state. */
export async function switchVaultUi(id: string): Promise<void> {
  useVaultUiStore.setState(empty);
  useVaultUiStore.persist.setOptions({ name: vaultUiKey(id) });
  await useVaultUiStore.persist.rehydrate();
}
```

Copy the six action bodies from `ui.ts` into the marked place (they only touch these four
fields). In `ui.ts`, delete the fields, actions and `partialize` entries, and bump `version`
to `2` with `migrate: (persisted) => persisted` and a comment that the vault fields moved to
`vault-ui.ts` (stale keys in an old `rhizom.ui` are ignored because `partialize` no longer
reads them).

- [ ] **Step 4: Point the components at the new store**

In `Layout.tsx`, `MilieuLayout.tsx`, `GraphPage.tsx`, `FileTree.tsx`: every selector of a moved
field or action reads `useVaultUiStore` instead of `useUiStore`. Update their unit tests the
same way.

- [ ] **Step 5: Run**

Run: `pnpm vitest run --project web && pnpm typecheck` — Expected: PASS.

---

### Task 6: The switcher

**Files:**

- Create: `apps/web/src/app/layout/VaultSwitcher.tsx`,
  `apps/web/src/app/layout/VaultSwitcher.test.tsx`
- Modify: `apps/web/src/app/Layout.tsx` (header), `apps/web/src/app/layout/commands.ts`
  (palette), the header stylesheet

**Interfaces:**

- Consumes: `VaultLoaderData` via `useRouteLoaderData('vault')`, `vaultHref`, `currentVault`.
- Produces: `<VaultSwitcher />`; palette commands with id `vault:<id>`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { VaultSwitcher } from './VaultSwitcher.js';

async function renderWith(vaults: { id: string; name: string }[]) {
  const router = createMemoryRouter(
    [
      {
        id: 'vault',
        path: '/v/:vault',
        loader: () => ({ vaults, known: true }),
        Component: VaultSwitcher,
      },
    ],
    { initialEntries: ['/v/dnd'] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => {
    expect(router.state.initialized).toBe(true);
  });
}

describe('VaultSwitcher', () => {
  it('is absent with a single vault', async () => {
    await renderWith([{ id: 'dnd', name: 'dnd' }]);
    expect(screen.queryByRole('combobox', { name: 'Vault' })).toBeNull();
  });

  it('offers every vault and marks the current one', async () => {
    await renderWith([
      { id: 'dnd', name: 'dnd' },
      { id: 'thesis', name: 'Thesis' },
    ]);
    const select = await screen.findByRole('combobox', { name: 'Vault' });
    expect((select as HTMLSelectElement).value).toBe('dnd');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'dnd',
      'Thesis',
    ]);
  });
});
```

Follow the existing component tests for i18n setup (how they render English strings).

- [ ] **Step 2: Run to see it fail** — `pnpm vitest run apps/web/src/app/layout/VaultSwitcher.test.tsx`

- [ ] **Step 3: Implement**

```tsx
// Shown only when the operator registered more than one vault: a single-vault setup looks
// exactly as it did before vaults were in the URL.
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useRouteLoaderData } from 'react-router';

import { vaultHref } from '../../routing/vault.js';
import type { VaultLoaderData } from '../VaultRoot.js';

export function VaultSwitcher() {
  const data = useRouteLoaderData<VaultLoaderData>('vault');
  const { vault = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (data === undefined || data.vaults.length < 2) {
    return null;
  }
  return (
    <select
      className="rz-vault-switcher"
      aria-label={t('vault.switch')}
      value={vault}
      onChange={(event) => {
        void navigate(vaultHref('/', event.target.value));
      }}
    >
      {data.vaults.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  );
}
```

Place `<VaultSwitcher />` in `Layout.tsx` right after the brand `NavLink`. Style
`.rz-vault-switcher` with the existing header control tokens (`--rz-*` background, border,
radius), font size ≥ 16 px, and check it in Humus first, then Kalk.

- [ ] **Step 4: Palette command**

In `commands.ts`, where the navigation commands are built, read the loader data the same way
(pass `vaults` in from the hook that builds the list) and add, for every vault other than the
current one, a command `{ id: `vault:${entry.id}`, label: t('vault.switchTo', { name: entry.name }), run: () => navigate(vaultHref('/', entry.id)) }`
in the shape the neighbouring commands use. None when there is one vault. Extend the commands
unit test with one case for two vaults.

- [ ] **Step 5: Run** — `pnpm vitest run --project web && pnpm lint` — Expected: PASS.

---

### Task 7: End-to-end

**Files:**

- Modify: `apps/web/e2e/serve.mjs`
- Create: `apps/web/e2e/vaults.spec.ts`
- Modify: every spec that calls the API directly (`grep -rn "'/api/" apps/web/e2e`)

- [ ] **Step 1: A second vault in the e2e server**

In `serve.mjs`, after copying the example vault:

```js
const secondDir = join(workspace, 'second');
mkdirSync(secondDir, { recursive: true });
writeFileSync(join(secondDir, 'Thesis.md'), '# Thesis\n\nChapter one links [[Method]].\n');
writeFileSync(join(secondDir, 'Method.md'), '# Method\n');
```

and replace `RHIZOM_VAULT_DIR: vaultDir` with
`RHIZOM_VAULTS: `default=${vaultDir};second=${secondDir}``. Import `mkdirSync` and
`writeFileSync`. Delete `RHIZOM_VAULT_DIR` from the spread environment
(`RHIZOM_VAULT_DIR: undefined` does not unset it — build the env object and `delete` the key)
so a developer's shell cannot make the start fail.

- [ ] **Step 2: Sweep the specs**

Every direct API call in `apps/web/e2e/*.spec.ts` (`request.get('/api/…')`, `fetch('/api/…')`
inside `page.evaluate`) other than `/api/health` goes to `/api/v/default/…`. `page.goto('/notes/…')`
stays: it exercises the redirect. URL assertions that are anchored (`/^\/notes/`) become
`/\/v\/default\/notes/`.

- [ ] **Step 3: Write `vaults.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('an old bookmark lands on the note in the default vault', async ({ page }) => {
  await page.goto('/notes/Home');
  await expect(page).toHaveURL(/\/v\/default\/notes\/Home$/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('the switcher moves between vaults and the tree follows', async ({ page }) => {
  await page.goto('/v/default');
  const switcher = page.getByRole('combobox', { name: 'Vault' });
  await expect(switcher).toHaveValue('default');
  await switcher.selectOption('second');
  await expect(page).toHaveURL(/\/v\/second$/);
  await expect(page.getByRole('treeitem', { name: /Thesis/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Home/ })).toHaveCount(0);
});

test('two tabs hold two vaults at once', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/v/default/notes/Home');
  await second.goto('/v/second/notes/Thesis');
  await expect(second.getByText('Chapter one links')).toBeVisible();
  await first.reload();
  await expect(first).toHaveURL(/\/v\/default\/notes\/Home$/);
});

test('a link inside the second vault stays in it', async ({ page }) => {
  await page.goto('/v/second/wiki/Thesis');
  await page.getByRole('link', { name: 'Method' }).click();
  await expect(page).toHaveURL(/\/v\/second\/wiki\/Method$/);
});

test('an unknown vault says so and offers the real ones', async ({ page }) => {
  await page.goto('/v/nowhere');
  await expect(page.getByRole('heading', { name: 'This vault does not exist' })).toBeVisible();
  await page.getByRole('link', { name: 'second' }).click();
  await expect(page).toHaveURL(/\/v\/second$/);
});
```

Match the role names to what the file tree and wiki actually expose (read `FileTree.tsx` and
an existing spec such as `notes.spec.ts` for the selectors the suite already relies on). The
graph `?note=` redirect is covered by the unit test of `redirectTarget`; add one e2e line
(`page.goto('/graph?note=Home.md')` → URL ends in `/v/default/graph?note=Home.md`) to
`graph-wiki.spec.ts`.

- [ ] **Step 4: Run the suite**

Free port 3737 first (CLAUDE.md: match `":3737"` in `netstat -ano`, kill the PID in the last
column, check again). Then `pnpm --filter @rhizom/web build && CI=1 pnpm e2e`.
Expected: all specs pass.

---

### Task 8: Docs, Docker and the slice commit

**Files:**

- Modify: `Dockerfile:32`, `docker-compose.yml`, `README.md`, `DECISIONS.md`,
  `CHANGELOG.md`, `ROADMAP.md`, `HANDOFF.md`, `docs/specs/2026-10-02-multi-vault.md`
  (status line), `CONTRIBUTING.md` if it names `RHIZOM_VAULT_DIR`

- [ ] **Step 1: Docker**

`Dockerfile`: replace `ENV RHIZOM_VAULT_DIR=/vault` with `ENV RHIZOM_VAULTS=default=/vault`,
so a compose file that sets `RHIZOM_VAULTS` replaces the default instead of colliding with it.
`docker-compose.yml`: keep the single `/vault` mount as the default, and add a commented
example of two vaults:

```yaml
# More than one vault: mount each and name them, id=path separated by semicolons.
#   - '/srv/notes/dnd:/vaults/dnd'
#   - '/srv/notes/thesis:/vaults/thesis'
# environment:
#   RHIZOM_VAULTS: 'dnd=/vaults/dnd;thesis=/vaults/thesis'
```

Run `docker build .` once if Docker Desktop is running (ask the maintainer to start it
otherwise; CI builds it either way).

- [ ] **Step 2: Prose**

- `README.md`: the configuration section names `RHIZOM_VAULTS`, the one-vault shorthand, the
  `/v/<id>/` addresses and that a vault cannot be opened from the browser.
- `DECISIONS.md`, new entry "2026-10-02 — More than one vault": registry by environment and
  why not from the UI; one URL space and the redirect; lazy open and idle close; the index per
  vault and the one-time rebuild; no links across vaults; static asset serving per vault.
  Mark the 2026-09-18 entry's "Switching vaults means restarting" as superseded by it.
- `CHANGELOG.md`, under `Unreleased`: Added (more than one vault, switcher, palette command),
  Changed (**breaking:** vault API routes moved to `/api/v/{vault}/…`; addresses gained
  `/v/<id>/`, old ones redirect; the index moved to `<data>/<id>/index.sqlite` and is rebuilt
  once; the Docker image sets `RHIZOM_VAULTS` instead of `RHIZOM_VAULT_DIR`).
- `ROADMAP.md`: tick the first Phase 3 item; status line "Phase 3 in progress".
- Spec status: `implemented 2026-10-02`.

- [ ] **Step 3: The local CI sequence**

Run in order, each must pass: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm test:coverage`, `pnpm build`, `pnpm site:build`, `CI=1 pnpm e2e`.

- [ ] **Step 4: Handoff and commit**

Rewrite `HANDOFF.md` for this session, run `pnpm exec prettier --write HANDOFF.md`, then:

```bash
git add -A
git status   # nothing from test runs or downloads
git commit -m "feat(vaults): serve every registered vault under its own address" -m "<body: what changed, why, what was left out (UI registration, cross-vault search, login)>"
```

Push and open the pull request only after the maintainer has seen the result.
