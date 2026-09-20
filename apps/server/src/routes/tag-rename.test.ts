import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TagCount, TagRenamePreview, TagRenameResult } from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

/** One vault per test: these tests write, and a shared vault would make them read each other. */
async function openVault(files: Record<string, string>): Promise<{
  app: FastifyInstance;
  root: string;
}> {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-tag-'));
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

async function preview(app: FastifyInstance, from: string, to: string): Promise<TagRenamePreview> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/tags/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** The whole operation the browser performs: preview, then write exactly what it offered. */
async function rename(
  app: FastifyInstance,
  from: string,
  to: string,
): Promise<{ preview: TagRenamePreview; result: TagRenameResult }> {
  const dry = await preview(app, from, to);
  const res = await app.inject({
    method: 'POST',
    url: '/api/tags/rename',
    payload: {
      from,
      to,
      files: dry.files.map((file) => ({ source: file.source, hash: file.hash })),
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { preview: dry, result: res.json() };
}

function read(root: string, path: string): string {
  return readFileSync(join(root, ...path.split('/')), 'utf8');
}

async function tags(app: FastifyInstance): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: '/api/tags' });
  const rows: TagCount[] = res.json();
  return rows.map((entry) => entry.tag);
}

describe('renaming a tag', () => {
  it('rewrites it in the prose and in the frontmatter, and takes the levels under it', async () => {
    const { app, root } = await openVault({
      'Mira.md': ['---', 'tags:', '  - campaign/npcs', '---', '', 'Met at #campaign today.'].join(
        '\n',
      ),
      'Silverstadt.md': '# Silverstadt\n\nA place. #campaign/places\n',
      'Elsewhere.md': '# Elsewhere\n\nNot part of it. #campaigns\n',
    });

    const { preview: dry, result } = await rename(app, 'campaign', 'chronicle');
    expect(dry.files.map((file) => file.source)).toEqual(['Mira.md', 'Silverstadt.md']);
    expect(result.skipped).toEqual([]);

    expect(read(root, 'Mira.md')).toContain('chronicle/npcs');
    expect(read(root, 'Mira.md')).toContain('#chronicle today');
    expect(read(root, 'Silverstadt.md')).toContain('#chronicle/places');
    expect(read(root, 'Elsewhere.md')).toContain('#campaigns');
    expect(await tags(app)).toEqual([
      'campaigns',
      'chronicle',
      'chronicle/npcs',
      'chronicle/places',
    ]);
  });

  it('reports both places it would change, with the line each stands on', async () => {
    const { app } = await openVault({
      'Mira.md': [
        '---',
        'tags: [campaign, npc]',
        '---',
        '',
        '# Mira',
        '',
        'A #campaign entry.',
      ].join('\n'),
    });
    const dry = await preview(app, 'campaign', 'chronicle');
    const refs = dry.files[0]?.refs ?? [];
    expect(refs.map((ref) => ({ where: ref.where, line: ref.line, after: ref.after }))).toEqual([
      { where: 'frontmatter', line: 2, after: 'chronicle, npc' },
      { where: 'inline', line: 7, after: 'chronicle' },
    ]);
  });

  it('leaves the rest of the frontmatter exactly as it was', async () => {
    const { app, root } = await openVault({
      'Mira.md': [
        '---',
        '# who she is',
        'title: Mira',
        "tags: 'campaign, npc'",
        'level: 3',
        '---',
        '',
        'Body.',
      ].join('\n'),
    });
    await rename(app, 'campaign', 'chronicle');
    const written = read(root, 'Mira.md');
    expect(written).toContain('# who she is');
    expect(written).toContain('title: Mira');
    expect(written).toContain('level: 3');
    // A string value keeps its separators rather than becoming a list. The quoting is the
    // writer's, as it is everywhere a value is rewritten: the value itself is the same string.
    expect(written).toContain('tags: chronicle, npc');
  });

  it('does not touch a tag the indexer does not count', async () => {
    const { app, root } = await openVault({
      'Doc.md': [
        '# Doc',
        '',
        'Tag your notes `#campaign` like this:',
        '',
        '```',
        '#campaign',
        '```',
        '',
        'Really: #campaign',
      ].join('\n'),
    });
    const { result } = await rename(app, 'campaign', 'chronicle');
    expect(result.rewritten).toEqual([{ source: 'Doc.md', count: 1 }]);
    const written = read(root, 'Doc.md');
    expect(written).toContain('`#campaign`');
    expect(written).toContain('```\n#campaign\n```');
    expect(written).toContain('Really: #chronicle');
  });

  it('names the tag it would merge with instead of refusing', async () => {
    const { app } = await openVault({
      'A.md': '# A\n\n#campaign\n',
      'B.md': '# B\n\n#chronicle\n',
    });
    const dry = await preview(app, 'campaign', 'chronicle');
    expect(dry.merges).toEqual(['chronicle']);
    expect(dry.refusal).toBeUndefined();
  });

  it('refuses a name that could not be written as a tag, and a tag nobody carries', async () => {
    const { app } = await openVault({ 'A.md': '# A\n\n#campaign\n' });
    expect((await preview(app, 'campaign', 'two words')).refusal).toBe('unwritableName');
    expect((await preview(app, 'campaign', 'Campaign')).refusal).toBe('same');
    expect((await preview(app, 'nothing', 'something')).refusal).toBe('notFound');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tags/rename',
      payload: { from: 'campaign', to: '#nope', files: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a file that changed since the preview and writes the others', async () => {
    const { app, root } = await openVault({
      'A.md': '# A\n\n#campaign\n',
      'B.md': '# B\n\n#campaign\n',
    });
    const dry = await preview(app, 'campaign', 'chronicle');
    writeFileSync(join(root, 'A.md'), '# A\n\nSomeone else was here. #campaign\n', 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: '/api/tags/rename',
      payload: {
        from: 'campaign',
        to: 'chronicle',
        files: dry.files.map((file) => ({ source: file.source, hash: file.hash })),
      },
    });
    const result: TagRenameResult = res.json();
    expect(result.skipped).toEqual([{ source: 'A.md', reason: 'conflict' }]);
    expect(result.rewritten).toEqual([{ source: 'B.md', count: 1 }]);
    expect(read(root, 'A.md')).toContain('#campaign');
    expect(read(root, 'B.md')).toContain('#chronicle');
  });

  it('can be run again with the same arguments after a partial failure', async () => {
    const { app, root } = await openVault({
      'A.md': '# A\n\n#campaign\n',
      'B.md': '# B\n\n#campaign\n',
    });
    const first = await preview(app, 'campaign', 'chronicle');
    await app.inject({
      method: 'POST',
      url: '/api/tags/rename',
      payload: {
        from: 'campaign',
        to: 'chronicle',
        files: [{ source: 'B.md', hash: first.files[1]?.hash ?? '' }],
      },
    });
    const { result } = await rename(app, 'campaign', 'chronicle');
    expect(result.rewritten).toEqual([{ source: 'A.md', count: 1 }]);
    expect(read(root, 'A.md')).toContain('#chronicle');
    expect(read(root, 'B.md')).toContain('#chronicle');
  });
});
