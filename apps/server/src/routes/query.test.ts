import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { QueryResult } from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

let app: FastifyInstance;
let root: string;

/**
 * A vault with something to ask about: two folders, a tag hierarchy, notes that declare a type
 * and notes that declare their own fields.
 */
const VAULT: Record<string, string> = {
  'Campaign/NPCs/Mira.md':
    '---\ntags: [campaign/npcs, ledger]\nstatus: done\ncreated: 2026-01-02\n---\n# Mira\n\nShe knows [[Silverstadt]].\n',
  'Campaign/NPCs/Corvin.md':
    '---\ntags: [campaign/npcs]\nstatus: [draft, review]\ncreated: 2026-03-04\n---\n# Corvin\n\nAlso [[Silverstadt]].\n',
  'Campaign/Places/Silverstadt.md':
    '---\ntags: [campaign/places]\nstatus: draft\n---\n# Silverstadt\n\nA harbour city.\n',
  'Forschung/Über Wurzeln.md':
    '---\ntags: [research]\nstatus: draft\n---\n# Über Wurzeln 🌱\n\nNotes.\n',
  'Glossary/Ledger.md': '---\ntype: definition\n---\n# Ledger\n\nA bound record.\n',
  'Campaign/50% done.md': '---\ntags: [campaign]\n---\n# 50% done\n\nA LIKE-shaped trap.\n',
};

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-query-'));
  for (const [path, content] of Object.entries(VAULT)) {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  }
  app = await buildApp({
    webDist: false,
    vault: { dir: root, dataDir: ':memory:', watch: false },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

async function run(body: string, fields?: string[]): Promise<QueryResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/query',
    payload: fields === undefined ? { body } : { body, fields },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function paths(result: QueryResult): string[] {
  return result.rows.map((row) => row.path);
}

describe('POST /api/query', () => {
  it('finds the notes of a folder, and of the folders below it', async () => {
    expect(paths(await run('from: Campaign/NPCs\nsort: path'))).toEqual([
      'Campaign/NPCs/Corvin.md',
      'Campaign/NPCs/Mira.md',
    ]);
    expect(paths(await run('from: Campaign\nsort: path'))).toHaveLength(4);
  });

  it('folds the case of a folder name in any script, not only in ASCII', async () => {
    // SQLite's own `lower()` folds ASCII and leaves `Ü` alone, which would make this find
    // nothing in a German vault. The comparison is done in JavaScript for that reason.
    expect(paths(await run('from: forschung'))).toEqual(['Forschung/Über Wurzeln.md']);
    expect(paths(await run('from: Forschung/ÜBER'))).toEqual([]);
    expect(paths(await run('from: FORSCHUNG'))).toEqual(['Forschung/Über Wurzeln.md']);
  });

  it('finds a tag and the tags below it', async () => {
    expect(paths(await run('tag: campaign/npcs\nsort: path'))).toEqual([
      'Campaign/NPCs/Corvin.md',
      'Campaign/NPCs/Mira.md',
    ]);
    // The parent tag finds its children, which is what a hierarchy is for.
    expect(paths(await run('tag: campaign\nsort: path'))).toHaveLength(4);
    // Written with the hash, as a note writes it in its text.
    expect(paths(await run('tag: "#research"'))).toEqual(['Forschung/Über Wurzeln.md']);
  });

  it('matches a title as plain text, never as a pattern', async () => {
    expect(paths(await run('title: silver'))).toEqual(['Campaign/Places/Silverstadt.md']);
    // A regular expression is a string here and matches nothing, which is the whole point.
    expect(paths(await run('title: ".*"'))).toEqual([]);
    // `%` and `_` are what LIKE spends on itself; in a title they are characters.
    expect(paths(await run('title: "50%"'))).toEqual(['Campaign/50% done.md']);
    expect(paths(await run('title: "Über"'))).toEqual(['Forschung/Über Wurzeln.md']);
  });

  it('finds the notes linking to another one, named as a link names it', async () => {
    expect(paths(await run('linksTo: Silverstadt\nsort: path'))).toEqual([
      'Campaign/NPCs/Corvin.md',
      'Campaign/NPCs/Mira.md',
    ]);
    expect(paths(await run('linksTo: Campaign/Places/Silverstadt.md'))).toHaveLength(2);
    // A note that is not there cannot be linked to, so nothing matches.
    expect(paths(await run('linksTo: Nowhere'))).toEqual([]);
  });

  it('filters on the reserved type and on the vault own fields', async () => {
    expect(paths(await run('type: definition'))).toEqual(['Glossary/Ledger.md']);
    expect(paths(await run('where:\n  status: done'))).toEqual(['Campaign/NPCs/Mira.md']);
    // A list answers when one of its entries does: Corvin is both draft and review.
    expect(paths(await run('where:\n  status: review'))).toEqual(['Campaign/NPCs/Corvin.md']);
    // Any of several values.
    expect(paths(await run('where:\n  status: [done, review]\nsort: path'))).toEqual([
      'Campaign/NPCs/Corvin.md',
      'Campaign/NPCs/Mira.md',
    ]);
    // Case is not a difference anybody means.
    expect(paths(await run('where:\n  status: DONE'))).toEqual(['Campaign/NPCs/Mira.md']);
  });

  it('ANDs the filters', async () => {
    expect(paths(await run('from: Campaign\ntag: campaign/npcs\nwhere:\n  status: draft'))).toEqual(
      ['Campaign/NPCs/Corvin.md'],
    );
  });

  it('sorts, reverses and limits, and says how many there were', async () => {
    expect(paths(await run('from: Campaign\nsort: -path'))).toEqual([
      'Campaign/Places/Silverstadt.md',
      'Campaign/NPCs/Mira.md',
      'Campaign/NPCs/Corvin.md',
      'Campaign/50% done.md',
    ]);
    const capped = await run('from: Campaign\nsort: path\nlimit: 2');
    expect(paths(capped)).toHaveLength(2);
    expect(capped.total).toBe(4);
    // `created` is the note's own field; notes without one come last either way round.
    expect(paths(await run('tag: campaign/npcs\nsort: created'))).toEqual([
      'Campaign/NPCs/Mira.md',
      'Campaign/NPCs/Corvin.md',
    ]);
  });

  it('renders the columns a table asked for', async () => {
    const result = await run('tag: campaign/npcs\nas: table\ncolumns: [title, status, created]');
    expect(result.view).toBe('table');
    expect(result.columns).toEqual(['title', 'status', 'created']);
    const mira = result.rows.find((row) => row.path === 'Campaign/NPCs/Mira.md');
    expect(mira?.fields).toEqual({ status: 'done', created: '2026-01-02' });
    // A built-in column is on the row itself and not repeated in the fields.
    expect(mira?.title).toBe('Mira');
    expect(mira?.tags).toEqual(['campaign/npcs', 'ledger']);
    const corvin = result.rows.find((row) => row.path === 'Campaign/NPCs/Corvin.md');
    expect(corvin?.fields.status).toBe('draft, review');
  });

  it('hands back frontmatter the caller asked for, leaving the block as it is', async () => {
    // The milieu field draws a note at the position two of its own keys give, and those keys
    // are named by the axes rather than by the block.
    const result = await run('tag: campaign/npcs\nsort: path', ['status', 'created']);
    expect(result.columns).toEqual([]);
    expect(result.view).toBe('list');
    expect(result.rows[1]?.fields).toEqual({ status: 'done', created: '2026-01-02' });
  });

  it('answers a block it could only partly read, and says what it skipped', async () => {
    const result = await run('tag: campaign/npcs\nnonsense: 3\nsort: sideways');
    expect(paths(result)).toHaveLength(2);
    expect(result.problems.map((problem) => problem.line)).toEqual([2, 3]);
    expect(result.problems[0]?.message).toContain('nonsense');
  });

  it('is data, not a program', async () => {
    // Nothing in a block is evaluated, run or turned into a pattern. Each of these is a string
    // that matches no note, which is exactly what it should be.
    for (const body of [
      'title: "$(rm -rf /)"',
      'where:\n  x: "${process.env.HOME}"',
      'title: "(a+)+(a+)+b"',
      'title: "; drop table notes; --"',
    ]) {
      const result = await run(body);
      expect(result.rows).toEqual([]);
    }

    // A folder outside the vault is refused while the block is read, so the key is simply not
    // there — the rest of the block still answers, and nothing reaches the disk either way.
    const escaping = await run('from: "../../etc"');
    expect(escaping.problems).toHaveLength(1);
    expect(escaping.rows.every((row) => !row.path.includes('..'))).toBe(true);
    // The whole vault, with nothing asked of it, is still just the notes.
    expect((await run('')).total).toBe(6);
  });
});
