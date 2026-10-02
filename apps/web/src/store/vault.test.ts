import type { NoteSummary, VaultInfo } from '@rhizom/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshCount, resetVaultStore, useVaultStore } from './vault.js';

function summary(path: string, aliases: string[] = [], size = 10): NoteSummary {
  return {
    path,
    name: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    tags: [],
    aliases,
    modifiedAt: '2026-09-27T10:00:00.000Z',
    size,
    linkCount: 0,
    backlinkCount: 0,
  };
}

const INFO: VaultInfo = {
  name: 'Vault',
  noteCount: 2,
  indexedAt: null,
  templates: { folder: null, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
  daily: { folder: null, format: 'YYYY-MM-DD', template: null },
};

let notes: NoteSummary[];

/** Answers the six requests of a reload, with whatever `notes` holds at the time. */
function stubServer(): { requests: string[] } {
  const requests: string[] = [];
  vi.stubGlobal('fetch', (input: string) => {
    requests.push(input);
    const body: Record<string, unknown> = {
      '/api/v/default/vault': INFO,
      '/api/v/default/notes': notes,
      '/api/v/default/tree': [],
      '/api/v/default/tags': [],
      '/api/v/default/assets': [],
      '/api/v/default/glossary': [],
    };
    return Promise.resolve(
      new Response(JSON.stringify(body[input]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return { requests };
}

beforeEach(() => {
  notes = [summary('Home.md'), summary('People/Mira.md', ['The Ledger-Keeper'])];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the vault store', () => {
  it('builds one note index for the whole app, resolving paths, names and aliases', async () => {
    stubServer();
    await useVaultStore.getState().load();
    const index = useVaultStore.getState().noteIndex;
    expect(index.findPath('people/mira.md')).toBe('People/Mira.md');
    expect(index.findByName('Mira')).toEqual(['People/Mira.md']);
    expect(index.findByAlias('the ledger-keeper')).toEqual(['People/Mira.md']);
  });

  it('keeps the note index across a reload that changed no path and no alias', async () => {
    stubServer();
    await useVaultStore.getState().load();
    const before = useVaultStore.getState().noteIndex;
    // What a save changes: sizes, times and counts, never a name.
    notes = [summary('Home.md', [], 99), summary('People/Mira.md', ['The Ledger-Keeper'], 42)];
    await useVaultStore.getState().refresh();
    expect(useVaultStore.getState().notes[0]?.size).toBe(99);
    expect(useVaultStore.getState().noteIndex).toBe(before);
  });

  it('builds a new note index when an alias or a path changed', async () => {
    stubServer();
    await useVaultStore.getState().load();
    const before = useVaultStore.getState().noteIndex;

    notes = [summary('Home.md'), summary('People/Mira.md', ['The Harbourmaster'])];
    await useVaultStore.getState().refresh();
    const renamedAlias = useVaultStore.getState().noteIndex;
    expect(renamedAlias).not.toBe(before);
    expect(renamedAlias.findByAlias('The Harbourmaster')).toEqual(['People/Mira.md']);
    expect(renamedAlias.findByAlias('The Ledger-Keeper')).toEqual([]);

    notes = [summary('Home.md'), summary('Archive/Mira.md', ['The Harbourmaster'])];
    await useVaultStore.getState().refresh();
    expect(useVaultStore.getState().noteIndex).not.toBe(renamedAlias);
    expect(useVaultStore.getState().noteIndex.findByName('Mira')).toEqual(['Archive/Mira.md']);
  });

  it('keeps the newest reload when an older one finishes after it', async () => {
    stubServer();
    await useVaultStore.getState().load();
    // The notes each reload's /api/notes answers with, released by hand and in reverse order.
    const releases: (() => void)[] = [];
    const lists = [[summary('Old.md')], [summary('New.md')]];
    let call = 0;
    const server = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string) => {
      if (input !== '/api/v/default/notes') {
        return server(input);
      }
      const list = lists[call] ?? [];
      call += 1;
      return new Promise<Response>((resolve) => {
        releases.push(() => {
          resolve(
            new Response(JSON.stringify(list), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        });
      });
    });

    const older = useVaultStore.getState().refresh();
    const newer = useVaultStore.getState().refresh();
    releases[1]?.();
    await newer;
    releases[0]?.();
    await older;
    expect(useVaultStore.getState().notes.map((note) => note.path)).toEqual(['New.md']);
  });

  it('counts the reloads it starts, so a save can tell one began while it was out', async () => {
    const { requests } = stubServer();
    await useVaultStore.getState().load();
    const before = refreshCount();
    const running = useVaultStore.getState().refresh();
    expect(refreshCount()).toBe(before + 1);
    await running;
    expect(requests.filter((url) => url === '/api/v/default/notes')).toHaveLength(2);
  });

  it('drops a load that was still running for the vault it switched away from', async () => {
    stubServer();
    const server = globalThis.fetch;
    // Every request of the load waits until the switch has happened.
    const held: (() => void)[] = [];
    vi.stubGlobal(
      'fetch',
      (input: string) =>
        new Promise<Response>((resolve) => {
          held.push(() => {
            resolve(server(input));
          });
        }),
    );
    resetVaultStore();
    const loading = useVaultStore.getState().load();
    resetVaultStore();
    for (const release of held) {
      release();
    }
    await loading;
    expect(useVaultStore.getState().notes).toEqual([]);
    expect(useVaultStore.getState().status).toBe('idle');
  });
});
