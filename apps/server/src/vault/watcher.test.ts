import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watchVault, type VaultChanges, type VaultWatcher } from './watcher.js';

let root: string;
let watcher: VaultWatcher;
let batches: VaultChanges[];

function write(relative: string, content: string): void {
  const absolute = join(root, ...relative.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

/** Every reported path must be a note outside hidden folders, whatever the platform adds. */
function expectOnlyNotes(): void {
  for (const batch of batches) {
    for (const path of [...batch.changed, ...batch.removed]) {
      expect(path).toMatch(/\.md$/);
      expect(path).not.toMatch(/(^|\/)\./);
    }
  }
}

/** Writes a note until the watcher has reported it, and answers with the batches so far. */
async function writeUntilReported(paths: readonly string[]): Promise<void> {
  let round = 0;
  await vi.waitFor(
    () => {
      round += 1;
      for (const path of paths) {
        write(path, `# ${path} ${String(round)}\n`);
      }
      const changed = new Set(batches.flatMap((batch) => batch.changed));
      for (const path of paths) {
        expect([...changed]).toContain(path);
      }
    },
    { timeout: 15_000, interval: 400 },
  );
}

async function nextBatch(): Promise<VaultChanges> {
  const before = batches.length;
  await vi.waitFor(() => expect(batches.length).toBeGreaterThan(before), { timeout: 10_000 });
  return batches[batches.length - 1]!;
}

beforeEach(async () => {
  // The real temp path: on GitHub's Windows runners tmpdir() is an 8.3 short name (RUNNER~1),
  // which makes fs.watch abort the process.
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-watch-'));
  write('Home.md', '# Home\n');
  write('Notes/Alpha.md', '# Alpha\n');
  batches = [];
  watcher = watchVault(root, (changes) => batches.push(changes), {
    debounceMs: 150,
    writeSettleMs: 50,
    maxWaitMs: 1_000,
  });
  await watcher.ready;
});

afterEach(async () => {
  await watcher.close();
  rmSync(root, { recursive: true, force: true });
});

describe('watchVault', () => {
  it('reports a new note as a vault path', async () => {
    await writeUntilReported(['Notes/Beta.md']);
    expect(batches.flatMap((batch) => batch.removed)).toEqual([]);
    expectOnlyNotes();
  });

  it('reports a note that was written again', async () => {
    await writeUntilReported(['Notes/Alpha.md']);
    expectOnlyNotes();
  });

  it('reports removed notes', async () => {
    rmSync(join(root, 'Notes', 'Alpha.md'));
    const batch = await nextBatch();
    expect(batch.removed).toEqual(['Notes/Alpha.md']);
    // macOS may also list an unchanged neighbour; the removed note itself never counts as changed.
    expect(batch.changed).not.toContain('Notes/Alpha.md');
    expectOnlyNotes();
  });

  it('reports a rename as a removal plus a change', async () => {
    renameSync(join(root, 'Notes', 'Alpha.md'), join(root, 'Notes', 'Gamma.md'));
    const batch = await nextBatch();
    expect(batch.removed).toEqual(['Notes/Alpha.md']);
    expect(batch.changed).toContain('Notes/Gamma.md');
    expect(batch.changed).not.toContain('Notes/Alpha.md');
    expectOnlyNotes();
  });

  it('coalesces a burst of changes', async () => {
    // Into a folder that already exists: macOS does not report files written into a folder
    // created in the same breath, which would test the platform rather than the batching.
    const burst = Array.from({ length: 5 }, (_, index) => `Notes/Burst ${String(index)}.md`);
    await writeUntilReported(burst);
    // The point of the batching: five writes must not mean five rounds of indexing.
    expect(batches.length).toBeLessThan(burst.length);
    expectOnlyNotes();
  });

  it('flushes a never-ending stream of changes at the maximum wait time', async () => {
    const started = Date.now();
    const interval = setInterval(() => {
      write(`Stream/Note ${String(Date.now())}.md`, '# x');
    }, 60);
    try {
      const batch = await nextBatch();
      expect(batch.changed.length).toBeGreaterThan(0);
      expect(Date.now() - started).toBeLessThan(2_500);
    } finally {
      clearInterval(interval);
    }
  });

  it('ignores dot folders and files that are not notes', async () => {
    write('.obsidian/workspace.json', '{}');
    write('assets/picture.txt', 'x');
    write('.trash/Old.md', '# Old\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Nothing to report on Linux and Windows; macOS may list the existing notes as changed.
    expectOnlyNotes();
    for (const batch of batches) {
      expect(batch.removed).toEqual([]);
    }
  });
}, 30_000);
