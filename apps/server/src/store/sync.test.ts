import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openVault, type Vault } from '../vault/files.js';
import { syncVault, indexPaths } from './sync.js';
import { VaultIndex } from './vault-index.js';

let root: string;
let vault: Vault;
let index: VaultIndex;

function write(relative: string, content: string, when?: Date): void {
  const absolute = join(root, ...relative.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
  if (when) {
    utimesSync(absolute, when, when);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-sync-'));
  write('Home.md', '# Home\n\n[[Alpha]] and [[Beta]]');
  write('Notes/Alpha.md', '# Alpha\n\nBack to [[Home]]. #alpha');
  write('Notes/Beta.md', '# Beta\n');
  write('.obsidian/app.json', '{}');
  write('assets/x.txt', 'not a note');
  vault = openVault(root);
  index = VaultIndex.open(':memory:');
});

afterEach(() => {
  index.close();
  rmSync(root, { recursive: true, force: true });
});

describe('syncVault', () => {
  it('indexes every note on the first run and records the time', async () => {
    const result = await syncVault(vault, index);
    expect(result).toEqual({ added: 3, updated: 0, removed: 0, unchanged: 0 });
    expect(index.stats().noteCount).toBe(3);
    expect(index.stats().indexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(index.linksFrom('Home.md').map((l) => l.target)).toEqual([
      'Notes/Alpha.md',
      'Notes/Beta.md',
    ]);
  });

  it('only re-parses files whose size or modification time changed', async () => {
    await syncVault(vault, index);
    write('Notes/Beta.md', '# Beta\n\nNow with content and [[Home]].');
    const result = await syncVault(vault, index);
    expect(result).toEqual({ added: 0, updated: 1, removed: 0, unchanged: 2 });
    expect(index.backlinks('Home.md').map((b) => b.source)).toEqual([
      'Notes/Alpha.md',
      'Notes/Beta.md',
    ]);
  });

  it('detects a change that keeps the size but touches the modification time', async () => {
    await syncVault(vault, index);
    write('Notes/Beta.md', '# Bета\n', new Date(Date.now() + 5_000));
    const result = await syncVault(vault, index);
    expect(result.updated).toBe(1);
  });

  it('removes notes that disappeared and adds new ones', async () => {
    await syncVault(vault, index);
    rmSync(join(root, 'Notes', 'Beta.md'));
    write('Notes/Gamma.md', '# Gamma\n');
    const result = await syncVault(vault, index);
    expect(result).toEqual({ added: 1, updated: 0, removed: 1, unchanged: 2 });
    expect(index.getNote('Notes/Beta.md')).toBeUndefined();
    expect(index.linksFrom('Home.md').find((l) => l.raw === 'Beta')?.target).toBeNull();
  });

  it('works in chunks and reports progress', async () => {
    for (let i = 0; i < 12; i += 1) {
      write(`Bulk/Note ${String(i)}.md`, `# Note ${String(i)}\n`);
    }
    const seen: number[] = [];
    const result = await syncVault(vault, index, {
      chunkSize: 5,
      onProgress: (done, total) => seen.push(done * 100 + total),
    });
    expect(result.added).toBe(15);
    expect(seen).toEqual([515, 1015, 1515]);
  });

  it('skips files that cannot be read instead of failing the whole run', async () => {
    write('Broken.md', '');
    await syncVault(vault, index);
    rmSync(join(root, 'Broken.md'));
    mkdirSync(join(root, 'Broken.md'));
    const result = await syncVault(vault, index);
    expect(result.removed).toBe(1);
    expect(index.getNote('Broken.md')).toBeUndefined();
  });
});

describe('indexPaths', () => {
  it('indexes the given notes and removes the ones that no longer exist', async () => {
    await syncVault(vault, index);
    write('Notes/Alpha.md', '# Alpha changed\n');
    rmSync(join(root, 'Notes', 'Beta.md'));
    const result = await indexPaths(vault, index, ['Notes/Alpha.md', 'Notes/Beta.md', 'Nope.md']);
    expect(result).toEqual({
      indexed: ['Notes/Alpha.md'],
      removed: ['Notes/Beta.md', 'Nope.md'],
      unchanged: [],
    });
    expect(index.getNote('Notes/Alpha.md')?.title).toBe('Alpha changed');
  });

  it('ignores paths that are not notes', async () => {
    const result = await indexPaths(vault, index, ['assets/x.txt', '.obsidian/app.json']);
    expect(result).toEqual({ indexed: [], removed: [], unchanged: [] });
  });

  it('skips notes whose content did not change', async () => {
    await syncVault(vault, index);
    const result = await indexPaths(vault, index, ['Notes/Alpha.md']);
    expect(result).toEqual({ indexed: [], removed: [], unchanged: ['Notes/Alpha.md'] });
  });
});
