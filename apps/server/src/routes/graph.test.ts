import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GraphResponse, RenamePreview, TagRenamePreview } from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.js';
import { VaultIndex } from '../store/vault-index.js';

// Every note links to another, so that a neighbourhood three hops wide is the whole vault.
const VAULT = {
  'Home.md': '# Home\n\nStart with [[Silverstadt]] and [[Mira]].\n',
  'Campaign/Places/Silverstadt.md':
    '---\ntags: [campaign, places]\n---\n# Silverstadt\n\nThe ledger is kept by [[Mira]].\n',
  'Campaign/NPCs/Mira.md':
    '---\ntags: [campaign, npcs]\n---\n# Mira\n\nShe lives in [[Silverstadt]].\n\n![[Glossary/Ledger]]\n',
  'Glossary/Ledger.md': '---\ntags: [glossary]\n---\n# Ledger\n\nKept by [[Mira]] and [[Mira]].\n',
};

function writeInto(root: string, path: string, content: string): void {
  const absolute = join(root, ...path.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

const opened: { app: FastifyInstance; root: string }[] = [];

/** One vault per test: these tests write, and a shared vault would make them read each other. */
async function openVault(watch = false): Promise<{ app: FastifyInstance; root: string }> {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-graph-'));
  for (const [path, content] of Object.entries(VAULT)) {
    writeInto(root, path, content);
  }
  const app = await buildApp({ webDist: false, vault: { dir: root, dataDir: ':memory:', watch } });
  await app.ready();
  opened.push({ app, root });
  return { app, root };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const entry of opened.splice(0)) {
    await entry.app.close();
    rmSync(entry.root, { recursive: true, force: true });
  }
});

async function graph(app: FastifyInstance, query = ''): Promise<GraphResponse> {
  const res = await app.inject({ method: 'GET', url: `/api/v/default/graph${query}` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

const paths = (data: GraphResponse): string[] => data.nodes.map((node) => node.path);
const edge = (data: GraphResponse, source: string, target: string) =>
  data.edges.find((candidate) => candidate.source === source && candidate.target === target);

describe('GET /api/graph from the cache', () => {
  it('builds the graph once per clustering and serves it again until something is written', async () => {
    const build = vi.spyOn(VaultIndex.prototype, 'graphInput');
    const { app } = await openVault();

    const first = await app.inject({ method: 'GET', url: '/api/v/default/graph' });
    const second = await app.inject({
      method: 'GET',
      url: '/api/v/default/graph?clusterBy=folder',
    });
    expect(second.body).toBe(first.body);
    expect(first.headers['content-type']).toBe('application/json; charset=utf-8');
    await app.inject({ method: 'GET', url: '/api/v/default/graph?clusterBy=tag' });
    await app.inject({ method: 'GET', url: '/api/v/default/graph?clusterBy=tag' });
    await app.inject({
      method: 'GET',
      url: '/api/v/default/graph/local?path=Home.md&depth=1&clusterBy=tag',
    });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('sends the bytes the schema serializer makes on a request of its own', async () => {
    const { app } = await openVault();
    // The local route still serialises per request, through the same response schema, and a
    // neighbourhood three hops wide is the whole of this vault — the same nodes in the same
    // order, the same edges, the same clusters.
    for (const clusterBy of ['folder', 'tag']) {
      const whole = await app.inject({
        method: 'GET',
        url: `/api/v/default/graph?clusterBy=${clusterBy}`,
      });
      const local = await app.inject({
        method: 'GET',
        url: `/api/v/default/graph/local?path=Home.md&depth=3&clusterBy=${clusterBy}`,
      });
      expect(whole.body).toBe(local.body);
    }
    const data = await graph(app);
    expect(edge(data, 'Campaign/NPCs/Mira.md', 'Glossary/Ledger.md')).toEqual({
      source: 'Campaign/NPCs/Mira.md',
      target: 'Glossary/Ledger.md',
      count: 1,
      embeds: 1,
    });
    expect(edge(data, 'Glossary/Ledger.md', 'Campaign/NPCs/Mira.md')?.count).toBe(2);
  });

  it('follows a save', async () => {
    const { app } = await openVault();
    expect(edge(await graph(app), 'Home.md', 'Glossary/Ledger.md')).toBeUndefined();
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v/default/notes/Home.md',
      payload: { content: '# Home\n\nNow [[Ledger]] as well as [[Silverstadt]] and [[Mira]].\n' },
    });
    expect(saved.statusCode).toBe(200);
    expect(edge(await graph(app), 'Home.md', 'Glossary/Ledger.md')?.count).toBe(1);
  });

  it('follows a new note and a deleted one', async () => {
    const { app } = await openVault();
    await graph(app);
    await app.inject({
      method: 'POST',
      url: '/api/v/default/notes',
      payload: { path: 'Campaign/Quay.md', content: '# Quay\n\nNext to [[Silverstadt]].\n' },
    });
    const created = await graph(app);
    expect(paths(created)).toContain('Campaign/Quay.md');
    expect(edge(created, 'Campaign/Quay.md', 'Campaign/Places/Silverstadt.md')).toBeDefined();

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v/default/notes/Campaign/Quay.md',
    });
    expect(deleted.statusCode).toBe(204);
    expect(paths(await graph(app))).not.toContain('Campaign/Quay.md');
  });

  it('follows a rename', async () => {
    const { app } = await openVault();
    await graph(app);
    const dry = await app.inject({
      method: 'GET',
      url: `/api/v/default/rename?from=${encodeURIComponent('Campaign/NPCs/Mira.md')}&to=${encodeURIComponent('People/Mira.md')}`,
    });
    const preview = dry.json<RenamePreview>();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v/default/rename',
      payload: {
        from: 'Campaign/NPCs/Mira.md',
        to: 'People/Mira.md',
        hash: preview.fromHash,
        files: preview.files.map((file) => ({ source: file.source, hash: file.hash })),
      },
    });
    expect(res.statusCode).toBe(200);
    const renamed = await graph(app);
    expect(paths(renamed)).toContain('People/Mira.md');
    expect(paths(renamed)).not.toContain('Campaign/NPCs/Mira.md');
    expect(edge(renamed, 'Home.md', 'People/Mira.md')).toBeDefined();
    expect(renamed.clusters).toContain('People');
  });

  it('follows a renamed tag', async () => {
    const { app } = await openVault();
    expect((await graph(app, '?clusterBy=tag')).clusters).toContain('glossary');
    const dry = await app.inject({
      method: 'GET',
      url: '/api/v/default/tags/rename?from=glossary&to=lexicon',
    });
    const preview = dry.json<TagRenamePreview>();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v/default/tags/rename',
      payload: {
        from: 'glossary',
        to: 'lexicon',
        files: preview.files.map((file) => ({ source: file.source, hash: file.hash })),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const clusters = (await graph(app, '?clusterBy=tag')).clusters;
    expect(clusters).toContain('lexicon');
    expect(clusters).not.toContain('glossary');
  });

  it('follows a rebuild that found a change on disk', async () => {
    const { app, root } = await openVault();
    await graph(app);
    writeInto(root, 'Outside.md', '# Outside\n\nWritten by another editor, about [[Home]].\n');
    const rebuilt = await app.inject({ method: 'POST', url: '/api/v/default/index/rebuild' });
    expect(rebuilt.statusCode).toBe(200);
    expect(edge(await graph(app), 'Outside.md', 'Home.md')).toBeDefined();
  });

  it('follows a change the watcher reports', async () => {
    const { app, root } = await openVault(true);
    await graph(app);
    let round = 0;
    // Written until it arrives: on macOS the event stream starts a moment after the watcher
    // says it is ready, and swallows what happens in between.
    await vi.waitFor(
      async () => {
        round += 1;
        writeInto(root, 'Watched.md', `# Watched ${String(round)}\n\nAbout [[Silverstadt]].\n`);
        expect(
          edge(await graph(app), 'Watched.md', 'Campaign/Places/Silverstadt.md'),
        ).toBeDefined();
      },
      { timeout: 15_000, interval: 500 },
    );
  });

  it('cuts neighbourhoods without changing the whole graph the index keeps', async () => {
    const graphOf = vi.spyOn(VaultIndex.prototype, 'graph');
    const { app } = await openVault();
    const whole = await app.inject({ method: 'GET', url: '/api/v/default/graph?clusterBy=folder' });
    // The index that answered, caught on its way through: the app does not hand it out.
    const index = graphOf.mock.contexts[0];
    if (!(index instanceof VaultIndex)) {
      throw new Error('the graph route did not ask the index for its graph');
    }
    const kept = index.graph('folder');
    const before = JSON.stringify(kept);

    for (const [path, depth] of [
      ['Home.md', 1],
      ['Campaign/NPCs/Mira.md', 3],
    ] as const) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v/default/graph/local?path=${encodeURIComponent(path)}&depth=${String(depth)}&clusterBy=folder`,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(paths(res.json<GraphResponse>())).toContain(path);
    }

    expect(index.graph('folder')).toBe(kept);
    expect(JSON.stringify(kept)).toBe(before);
    const again = await app.inject({ method: 'GET', url: '/api/v/default/graph?clusterBy=folder' });
    expect(again.body).toBe(whole.body);
  });

  it('cuts a neighbourhood from the graph as it stands after a write', async () => {
    const { app } = await openVault();
    const local = async (): Promise<GraphResponse> =>
      (
        await app.inject({ method: 'GET', url: '/api/v/default/graph/local?path=Home.md&depth=1' })
      ).json<GraphResponse>();
    expect(paths(await local())).not.toContain('Glossary/Ledger.md');
    await app.inject({
      method: 'PUT',
      url: '/api/v/default/notes/Home.md',
      payload: { content: '# Home\n\nOnly [[Ledger]].\n' },
    });
    expect(paths(await local()).sort()).toEqual(['Glossary/Ledger.md', 'Home.md']);
  });
});
