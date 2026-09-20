import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  Backlink,
  NoteLink,
  RenameNoteResult,
  RenamePreview,
  SearchResponse,
} from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

/** One vault per test: these tests write, and a shared vault would make them read each other. */
async function openVault(files: Record<string, string>): Promise<{
  app: FastifyInstance;
  root: string;
}> {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-rename-'));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  const app = await buildApp({
    webDist: false,
    vault: { dir: root, dataDir: ':memory:', watch: false },
  });
  await app.ready();
  opened.push({ app, root });
  return { app, root };
}

const opened: { app: FastifyInstance; root: string }[] = [];

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.app.close();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

async function preview(app: FastifyInstance, from: string, to: string): Promise<RenamePreview> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** The whole operation the browser performs: preview, then write exactly what it offered. */
async function rename(
  app: FastifyInstance,
  from: string,
  to: string,
): Promise<{ preview: RenamePreview; result: RenameNoteResult }> {
  const dryRun = await preview(app, from, to);
  const res = await app.inject({
    method: 'POST',
    url: '/api/rename',
    payload: {
      from,
      to,
      hash: dryRun.fromHash,
      files: dryRun.files.map((file) => ({ source: file.source, hash: file.hash })),
    },
  });
  expect(res.statusCode).toBe(200);
  return { preview: dryRun, result: res.json() };
}

function read(root: string, path: string): string {
  return readFileSync(join(root, ...path.split('/')), 'utf8');
}

describe('GET /api/rename', () => {
  it('lists the links it would rewrite, with the text before and after', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': 'See [[People/Mira]] and [link](People/Mira.md "The Ledger").\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');

    expect(dryRun.refusal).toBeUndefined();
    expect(dryRun.files).toHaveLength(1);
    expect(dryRun.files[0]?.source).toBe('Home.md');
    expect(dryRun.files[0]?.refs.map((ref) => [ref.before, ref.after, ref.rewrite])).toEqual([
      ['People/Mira', 'People/Wurzeln', true],
      ['People/Mira.md', 'People/Wurzeln.md', true],
    ]);
  });

  it('leaves a link that reaches the note through an alias', async () => {
    const { app } = await openVault({
      'People/Mira.md': '---\naliases: [The Ledger-Keeper]\n---\n# Mira\n',
      'Home.md': 'Ask [[The Ledger-Keeper]].\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');

    // An alias is a word the reader chose; it has nothing to do with the file's name.
    expect(dryRun.files).toEqual([]);
    expect(dryRun.leftAlone).toBe(1);
  });

  it('leaves a bare name that finds the note at its new path anyway', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': 'See [[Mira]].\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'Archive/People/Mira.md');

    // Name resolution is folder-blind, so moving the note touches no file at all.
    expect(dryRun.files).toEqual([]);
    expect(dryRun.leftAlone).toBe(1);
  });

  it('writes the path out when a namesake would capture the bare name', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      // A note already carrying the name the rename is heading for.
      'Archive/Wurzeln.md': '# Wurzeln, the other one\n',
      'Home.md': 'See [[Mira]].\n',
    });

    // `[[Mira]]` is unambiguous today. `[[Wurzeln]]` would not be, so the bare name must not
    // survive the rename: it would lead to whichever of the two the tie-break happened to pick.
    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');
    expect(dryRun.files[0]?.refs[0]).toMatchObject({ before: 'Mira', after: 'People/Wurzeln' });
    expect(dryRun.nameClash).toEqual(['Archive/Wurzeln.md']);
  });

  it('flags a link that stands in a heading', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': '## About [[People/Mira]]\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');

    expect(dryRun.files[0]?.refs[0]).toMatchObject({ rewrite: true, inHeading: true });
  });

  it('says whether the title follows the file name', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'People/Voss.md': '---\ntitle: Mira Voss\n---\n',
    });

    expect(await preview(app, 'People/Mira.md', 'People/Wurzeln.md')).toMatchObject({
      title: 'Mira',
      titleFollowsFileName: true,
    });
    expect(await preview(app, 'People/Voss.md', 'People/Wurzeln.md')).toMatchObject({
      title: 'Mira Voss',
      titleFollowsFileName: false,
    });
  });

  it('refuses what cannot be done, before anything is written', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'People/Taken.md': '# Taken\n',
    });

    expect((await preview(app, 'People/Mira.md', 'People/Taken.md')).refusal).toBe('exists');
    expect((await preview(app, 'People/Mira.md', '../escape.md')).refusal).toBe('unsafePath');
    expect((await preview(app, 'People/Mira.md', '.trash/gone.md')).refusal).toBe('unsafePath');
    // `#`, `|`, `[` and `]` are what the wikilink syntax spends on something else, so a note
    // named with one cannot be linked to at all.
    expect((await preview(app, 'People/Mira.md', 'People/Mira #2.md')).refusal).toBe(
      'unwritableName',
    );
    const gone = await app.inject({ method: 'GET', url: '/api/rename?from=Nope.md&to=Yes.md' });
    expect(gone.statusCode).toBe(404);
  });

  it('allows a rename that only changes the capitalisation', async () => {
    const { app } = await openVault({ 'archive.md': '# Archive\n' });

    expect((await preview(app, 'archive.md', 'Archive.md')).refusal).toBeUndefined();
  });
});

describe('POST /api/rename', () => {
  it('rewrites the links, moves the note and reindexes both ends', async () => {
    const { app, root } = await openVault({
      'People/Mira.md': '---\naliases: [The Ledger-Keeper]\n---\n# Mira\n',
      'Home.md': 'See [[People/Mira|her]] and [the ledger](People/Mira.md#secrets).\n',
      'Aside.md': 'Ask [[The Ledger-Keeper]] instead.\n',
    });

    const { result } = await rename(app, 'People/Mira.md', 'Garten/Wurzeln.md');

    expect(result).toMatchObject({
      from: 'People/Mira.md',
      to: 'Garten/Wurzeln.md',
      rewritten: [{ source: 'Home.md', count: 2 }],
      skipped: [],
    });
    expect(read(root, 'Home.md')).toBe(
      'See [[Garten/Wurzeln|her]] and [the ledger](Garten/Wurzeln.md#secrets).\n',
    );
    // The alias link was never touched, and still leads to the note at its new path — which is
    // what indexing the new path before removing the old one buys.
    expect(read(root, 'Aside.md')).toBe('Ask [[The Ledger-Keeper]] instead.\n');

    const backlinks: Backlink[] = (
      await app.inject({ method: 'GET', url: '/api/backlinks?path=Garten/Wurzeln.md' })
    ).json();
    // One row per link, and Home.md holds two of them.
    expect(backlinks.map((entry) => entry.source).sort()).toEqual([
      'Aside.md',
      'Home.md',
      'Home.md',
    ]);

    const links: NoteLink[] = (
      await app.inject({ method: 'GET', url: '/api/links?path=Home.md' })
    ).json();
    expect(links.every((link) => link.target === 'Garten/Wurzeln.md')).toBe(true);

    expect(
      (await app.inject({ method: 'GET', url: '/api/links?path=People/Mira.md' })).statusCode,
    ).toBe(404);

    // The full-text row moved with the note: an id kept across a path change would leave the
    // old path searchable and the new one invisible.
    const found: SearchResponse = (
      await app.inject({ method: 'GET', url: '/api/search?q=Mira' })
    ).json();
    expect(found.hits.map((hit) => hit.path)).toEqual(['Garten/Wurzeln.md']);
  });

  it('skips a file that changed since the preview, and still moves the note', async () => {
    const { app, root } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': 'See [[People/Mira]].\n',
      'Aside.md': 'Also [[People/Mira]].\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');
    expect(dryRun.files).toHaveLength(2);
    writeFileSync(join(root, 'Aside.md'), 'Also [[People/Mira]]. And a new sentence.\n', 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: '/api/rename',
      payload: {
        from: 'People/Mira.md',
        to: 'People/Wurzeln.md',
        hash: dryRun.fromHash,
        files: dryRun.files.map((file) => ({ source: file.source, hash: file.hash })),
      },
    });

    const result: RenameNoteResult = res.json();
    expect(result.rewritten).toEqual([{ source: 'Home.md', count: 1 }]);
    expect(result.skipped).toEqual([{ source: 'Aside.md', reason: 'conflict' }]);
    // One stale file must not strand the note halfway: the move happens, and the dangling link
    // in Aside.md is what the second run repairs.
    expect(read(root, 'People/Wurzeln.md')).toBe('# Mira\n');
    expect(read(root, 'Aside.md')).toContain('[[People/Mira]]');
  });

  it('reports a file that vanished between the preview and the write', async () => {
    const { app, root } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': 'See [[People/Mira]].\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');
    rmSync(join(root, 'Home.md'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/rename',
      payload: {
        from: 'People/Mira.md',
        to: 'People/Wurzeln.md',
        hash: dryRun.fromHash,
        files: dryRun.files.map((file) => ({ source: file.source, hash: file.hash })),
      },
    });

    const result: RenameNoteResult = res.json();
    expect(result.skipped).toEqual([{ source: 'Home.md', reason: 'notFound' }]);
  });

  it('leaves the same request able to finish the job when the move fails', async () => {
    const { app, root } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': 'See [[People/Mira]].\n',
      'Aside.md': 'Also [[People/Mira]].\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');
    const files = dryRun.files.map((file) => ({ source: file.source, hash: file.hash }));

    // The note itself changed since the preview, so the move is refused — after the files have
    // already been rewritten. This is the failure the write order is built around.
    const failed = await app.inject({
      method: 'POST',
      url: '/api/rename',
      payload: { from: 'People/Mira.md', to: 'People/Wurzeln.md', hash: 'stale', files },
    });
    expect(failed.statusCode).toBe(412);
    expect(read(root, 'Home.md')).toBe('See [[People/Wurzeln]].\n');
    expect(read(root, 'People/Mira.md')).toBe('# Mira\n');

    // The note is still at `from`, so the same rename run again finishes it: the files that were
    // written are no longer candidates, and nothing is written twice.
    const { result } = await rename(app, 'People/Mira.md', 'People/Wurzeln.md');
    expect(result).toMatchObject({ rewritten: [], skipped: [] });
    expect(read(root, 'People/Wurzeln.md')).toBe('# Mira\n');
    expect(read(root, 'Aside.md')).toBe('Also [[People/Wurzeln]].\n');
  });

  it('writes nothing for a file whose links no longer need changing', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'Home.md': 'See [[People/Mira]].\n',
    });

    const dryRun = await preview(app, 'People/Mira.md', 'People/Wurzeln.md');
    const res = await app.inject({
      method: 'POST',
      url: '/api/rename',
      // The same file, but the rename it was previewed for is a different one: nothing in it
      // leads to `Other.md`, so there is nothing to write.
      payload: {
        from: 'People/Mira.md',
        to: 'People/Mira.md',
        hash: dryRun.fromHash,
        files: [{ source: 'Home.md', hash: dryRun.files[0]?.hash ?? '' }],
      },
    });

    const result: RenameNoteResult = res.json();
    expect(result.skipped).toEqual([{ source: 'Home.md', reason: 'nothing' }]);
  });

  it('refuses a target that is taken', async () => {
    const { app } = await openVault({
      'People/Mira.md': '# Mira\n',
      'People/Taken.md': '# Taken\n',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/rename',
      payload: { from: 'People/Mira.md', to: 'People/Taken.md', hash: 'x', files: [] },
    });

    expect(res.statusCode).toBe(409);
  });

  it('carries a name made of emoji from end to end', async () => {
    const { app, root } = await openVault({
      'Garten/🌱 Über Wurzeln.md': '# Über Wurzeln\n',
      'A.md': 'Kurz: [[🌱 Über Wurzeln]].\n',
      'B.md': 'Pfad: [[Garten/🌱 Über Wurzeln]].\n',
      'C.md': 'Als Link: [dort](Garten/%F0%9F%8C%B1%20%C3%9Cber%20Wurzeln.md).\n',
      'Garten/🌱 Über Wurzeln 2.md': '# A namesake, so the bare name cannot stay bare\n',
    });

    const { result } = await rename(app, 'Garten/🌱 Über Wurzeln.md', 'Garten/Wurzeln 👨‍👩‍👧.md');

    expect(result.skipped).toEqual([]);
    expect(read(root, 'A.md')).toBe('Kurz: [[Wurzeln 👨‍👩‍👧]].\n');
    expect(read(root, 'B.md')).toBe('Pfad: [[Garten/Wurzeln 👨‍👩‍👧]].\n');
    expect(read(root, 'C.md')).toBe(
      'Als Link: [dort](Garten/Wurzeln%20%F0%9F%91%A8%E2%80%8D%F0%9F%91%A9%E2%80%8D%F0%9F%91%A7.md).\n',
    );
    expect(read(root, 'Garten/Wurzeln 👨‍👩‍👧.md')).toBe('# Über Wurzeln\n');
  });
});
