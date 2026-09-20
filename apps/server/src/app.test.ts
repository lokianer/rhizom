import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AssetSummary,
  Backlink,
  GlossaryEntry,
  GraphResponse,
  HealthResponse,
  LinkMentionsResult,
  MentionsResponse,
  NoteDocument,
  NoteLink,
  NoteSummary,
  SearchResponse,
  TagCount,
  TreeEntry,
  VaultInfo,
} from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

function writeInto(root: string, relative: string, content: string | Buffer): void {
  const absolute = join(root, ...relative.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

function makeVault(): string {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-api-vault-'));
  writeInto(
    root,
    'Home.md',
    '# Home\n\nStart with [[Silverstadt]] and [[Mira]]. Missing: [[The Ashen Codex]].\n',
  );
  writeInto(
    root,
    'Campaign/Places/Silverstadt.md',
    '---\ntags: [campaign, places]\n---\n# Silverstadt\n\nA harbour city. The ledger is kept by [[Mira]].\n',
  );
  writeInto(
    root,
    'Campaign/NPCs/Mira.md',
    '---\naliases: [The Ledger-Keeper]\ntags: [campaign, npcs]\n---\n# Mira\n\nShe keeps the harbour ledger in [[Silverstadt]].\n\n![[tavern.png]]\n',
  );
  writeInto(
    root,
    'Glossary/Ledger.md',
    // The second block names Mira without linking her: the unlinked mention the panel finds.
    '---\ntype: definition\naliases: [ledgers, account book]\n---\n# Ledger\n\nA bound record of debts and payments.\n\nMira keeps one for the guild.\n',
  );
  writeInto(
    root,
    'assets/tavern.png',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  writeInto(root, '.obsidian/app.json', '{}');
  return root;
}

describe('GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ webDist: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns status ok and the package version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body: HealthResponse = res.json();
    expect(body).toEqual({ status: 'ok', version: pkg.version });
  });

  it('returns a JSON 404 for unknown /api routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('returns a JSON 404 for page paths when no web build is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/some/client/route' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('answers vault routes with 503 when no vault is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vault' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ statusCode: 503, error: 'Service Unavailable' });
  });
});

describe('vault API', () => {
  let app: FastifyInstance;
  let root: string;

  beforeAll(async () => {
    root = makeVault();
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

  it('describes the vault', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vault' });

    expect(res.statusCode).toBe(200);
    const body: VaultInfo = res.json();
    expect(body.noteCount).toBe(4);
    expect(body.name).toBe(
      root.slice(root.lastIndexOf(process.platform === 'win32' ? '\\' : '/') + 1),
    );
    expect(body.indexedAt).toMatch(/^\d{4}-/);
    // This vault has no Templates folder and no Obsidian settings, so it has no templates.
    expect(body.templates).toEqual({ folder: null, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' });
  });

  it('lists the tree and the notes', async () => {
    const tree = await app.inject({ method: 'GET', url: '/api/tree' });
    const entries: TreeEntry[] = tree.json();
    expect(entries[0]).toMatchObject({ type: 'folder', name: 'Campaign' });
    expect(entries[1]).toMatchObject({ type: 'folder', name: 'Glossary' });
    expect(entries[2]).toMatchObject({ type: 'note', path: 'Home.md' });

    const notes = await app.inject({ method: 'GET', url: '/api/notes' });
    const list: NoteSummary[] = notes.json();
    expect(list.map((n) => n.path)).toEqual([
      'Campaign/NPCs/Mira.md',
      'Campaign/Places/Silverstadt.md',
      'Glossary/Ledger.md',
      'Home.md',
    ]);
  });

  it('reads a note with its content, hash and metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notes/Campaign/NPCs/Mira.md' });

    expect(res.statusCode).toBe(200);
    const note: NoteDocument = res.json();
    expect(note).toMatchObject({
      path: 'Campaign/NPCs/Mira.md',
      title: 'Mira',
      tags: ['campaign', 'npcs'],
      frontmatter: { aliases: ['The Ledger-Keeper'] },
      backlinkCount: 2,
    });
    expect(note.content).toContain('# Mira');
    expect(note.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(res.headers.etag).toBe(`"${note.hash}"`);
  });

  it('answers 404 for a missing note and 400 for an unsafe path', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/notes/Nope.md' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });

    const unsafe = await app.inject({ method: 'GET', url: '/api/notes/..%2F..%2Fsecret.md' });
    expect(unsafe.statusCode).toBe(400);

    const hidden = await app.inject({ method: 'GET', url: '/api/notes/.obsidian/app.json' });
    expect(hidden.statusCode).toBe(400);
  });

  it('takes a note whose name and text are umlauts and emoji, all the way through', async () => {
    const path = 'Garten/🌱 Über Wurzeln.md';
    const content = '# Über Wurzeln 🌱\n\nSchön: 👨‍👩‍👧 und 🇩🇪 und 𝄞.\n';
    const created = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { path, content },
    });
    expect(created.statusCode).toBe(201);

    const read = await app.inject({ method: 'GET', url: `/api/notes/${encodeURI(path)}` });
    expect(read.statusCode).toBe(200);
    const note: NoteDocument = read.json();
    expect(note.content).toBe(content);
    expect(note.title).toBe('Über Wurzeln 🌱');
    // And the bytes on disk are UTF-8, which is what every other tool in the vault's life reads.
    expect(readFileSync(join(root, 'Garten', '🌱 Über Wurzeln.md'), 'utf8')).toBe(content);
  });

  it('creates a note, indexes it and refuses to create it twice', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { path: 'Ideas/Graph layout', content: '# Graph layout\n\nSee [[Home]].\n' },
    });
    expect(created.statusCode).toBe(201);
    const note: NoteDocument = created.json();
    expect(note.path).toBe('Ideas/Graph layout.md');
    expect(note.title).toBe('Graph layout');
    expect(existsSync(join(root, 'Ideas', 'Graph layout.md'))).toBe(true);

    const backlinks = await app.inject({ method: 'GET', url: '/api/backlinks?path=Home.md' });
    expect(backlinks.json<Backlink[]>().map((b) => b.source)).toContain('Ideas/Graph layout.md');

    const again = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { path: 'Ideas/Graph layout.md' },
    });
    expect(again.statusCode).toBe(409);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { content: 'no path' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('saves a note with optimistic concurrency', async () => {
    const before: NoteDocument = (
      await app.inject({ method: 'GET', url: '/api/notes/Home.md' })
    ).json();

    const stale = await app.inject({
      method: 'PUT',
      url: '/api/notes/Home.md',
      headers: { 'if-match': '"not-the-hash"' },
      payload: { content: '# Home\n\nStale write.\n' },
    });
    expect(stale.statusCode).toBe(412);

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/notes/Home.md',
      headers: { 'if-match': `"${before.hash}"` },
      payload: { content: '# Home\n\nFresh write with [[Mira]].\n' },
    });
    expect(saved.statusCode).toBe(200);
    const after: NoteDocument = saved.json();
    expect(after.hash).not.toBe(before.hash);
    expect(readFileSync(join(root, 'Home.md'), 'utf8')).toBe(
      '# Home\n\nFresh write with [[Mira]].\n',
    );

    const links = await app.inject({ method: 'GET', url: '/api/links?path=Home.md' });
    expect(links.json<NoteLink[]>().map((l) => l.target)).toEqual(['Campaign/NPCs/Mira.md']);

    const badBody = await app.inject({
      method: 'PUT',
      url: '/api/notes/Home.md',
      payload: { text: 'x' },
    });
    expect(badBody.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PUT',
      url: '/api/notes/Nope.md',
      payload: { content: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('deletes a note into the trash', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/notes',
      payload: { path: 'Temp.md', content: 'x' },
    });
    expect(created.statusCode).toBe(201);

    const deleted = await app.inject({ method: 'DELETE', url: '/api/notes/Temp.md' });
    expect(deleted.statusCode).toBe(204);
    expect(existsSync(join(root, '.trash', 'Temp.md'))).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/notes/Temp.md' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/notes/Temp.md' })).statusCode).toBe(
      404,
    );
  });

  it('searches the full text and reports backlinks, links and tags', async () => {
    const search = await app.inject({ method: 'GET', url: '/api/search?q=harbour' });
    expect(search.statusCode).toBe(200);
    const result: SearchResponse = search.json();
    expect(result.total).toBe(2);
    expect(result.hits[0]?.snippet).toContain('<mark>harbour</mark>');

    expect((await app.inject({ method: 'GET', url: '/api/search' })).statusCode).toBe(400);

    // Mira answers to "The Ledger-Keeper", and only her frontmatter says so: the hit comes from
    // the aliases column, and the snippet from the body, which marks nothing here.
    const byAlias = await app.inject({ method: 'GET', url: '/api/search?q=Keeper' });
    const aliasResult: SearchResponse = byAlias.json();
    expect(aliasResult.hits.map((hit) => hit.path)).toEqual(['Campaign/NPCs/Mira.md']);
    expect(aliasResult.hits[0]?.snippet).toContain('She keeps the harbour ledger');
    expect(aliasResult.hits[0]?.snippet).not.toContain('<mark>');

    const backlinks = await app.inject({
      method: 'GET',
      url: '/api/backlinks?path=Campaign/NPCs/Mira.md',
    });
    expect(backlinks.json<Backlink[]>().map((b) => b.source)).toContain(
      'Campaign/Places/Silverstadt.md',
    );

    const tags = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(tags.json<TagCount[]>()).toContainEqual({ tag: 'campaign', count: 2 });
  });

  it('lists one glossary entry per definition note', async () => {
    const glossary = await app.inject({ method: 'GET', url: '/api/glossary' });
    expect(glossary.statusCode).toBe(200);
    expect(glossary.json<GlossaryEntry[]>()).toEqual([
      {
        path: 'Glossary/Ledger.md',
        title: 'Ledger',
        aliases: ['account book', 'ledgers'],
        summary: 'A bound record of debts and payments.',
      },
    ]);
  });

  it('finds where a note is named without a link, and links it on request', async () => {
    const found = await app.inject({
      method: 'GET',
      url: '/api/mentions?path=Campaign/NPCs/Mira.md',
    });
    expect(found.statusCode).toBe(200);
    const mentions: MentionsResponse = found.json();
    expect(mentions.terms).toEqual(['Mira', 'The Ledger-Keeper']);
    const group = mentions.groups.find((entry) => entry.source === 'Glossary/Ledger.md');
    expect(group, 'the glossary note names Mira in prose').toBeDefined();
    expect(group?.mentions[0]?.text).toBe('Mira');
    // Silverstadt.md links to [[Mira]] already, so it is not an *unlinked* mention.
    expect(mentions.groups.map((entry) => entry.source)).not.toContain(
      'Campaign/Places/Silverstadt.md',
    );

    const write = {
      source: group?.source ?? '',
      hash: group?.hash ?? '',
      offsets: (group?.mentions ?? []).map((mention) => mention.start),
    };
    const linked = await app.inject({
      method: 'POST',
      url: '/api/mentions/link',
      payload: { path: 'Campaign/NPCs/Mira.md', writes: [write] },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json<LinkMentionsResult>()).toEqual({
      linked: [{ source: 'Glossary/Ledger.md', count: 1 }],
      skipped: [],
    });
    expect(readFileSync(join(root, 'Glossary', 'Ledger.md'), 'utf8')).toContain('[[Mira]]');

    // Once written it is a link, so it is no longer an unlinked mention.
    const again = await app.inject({
      method: 'GET',
      url: '/api/mentions?path=Campaign/NPCs/Mira.md',
    });
    expect(again.json<MentionsResponse>().groups.map((entry) => entry.source)).not.toContain(
      'Glossary/Ledger.md',
    );
  });

  it('refuses to write a file that changed since it was scanned', async () => {
    const before = readFileSync(join(root, 'Home.md'), 'utf8');
    const result = await app.inject({
      method: 'POST',
      url: '/api/mentions/link',
      payload: {
        path: 'Campaign/NPCs/Mira.md',
        writes: [{ source: 'Home.md', hash: 'not-the-hash-on-disk', offsets: [0] }],
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json<LinkMentionsResult>()).toEqual({
      linked: [],
      skipped: [{ source: 'Home.md', reason: 'conflict' }],
    });
    expect(readFileSync(join(root, 'Home.md'), 'utf8')).toBe(before);
  });

  it('answers 404 for a note that is not there, on both mention routes', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/mentions?path=Nope.md' })).statusCode,
    ).toBe(404);
    const post = await app.inject({
      method: 'POST',
      url: '/api/mentions/link',
      payload: { path: 'Nope.md', writes: [{ source: 'Home.md', hash: 'x', offsets: [0] }] },
    });
    expect(post.statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/mentions/link',
          payload: { path: 'Campaign/NPCs/Mira.md', writes: [] },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('serves graph data for the vault and for a neighbourhood', async () => {
    const graph = await app.inject({ method: 'GET', url: '/api/graph' });
    expect(graph.statusCode).toBe(200);
    const data: GraphResponse = graph.json();
    expect(data.nodes.length).toBeGreaterThanOrEqual(3);
    expect(data.clusters).toContain('Campaign');

    const byTag = await app.inject({ method: 'GET', url: '/api/graph?clusterBy=tag' });
    expect(byTag.json<GraphResponse>().clusters).toContain('campaign');

    const local = await app.inject({
      method: 'GET',
      url: '/api/graph/local?path=Campaign/NPCs/Mira.md&depth=1',
    });
    expect(local.json<GraphResponse>().nodes.map((n) => n.path)).toContain(
      'Campaign/Places/Silverstadt.md',
    );

    expect(
      (await app.inject({ method: 'GET', url: '/api/graph/local?path=Home.md&depth=9' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/graph?clusterBy=colour' })).statusCode,
    ).toBe(400);
  });

  it('lists the files that are not notes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/assets' });

    expect(response.statusCode).toBe(200);
    const assets = response.json<AssetSummary[]>();
    expect(assets.map((asset) => asset.path)).toContain('assets/tavern.png');
    expect(assets.map((asset) => asset.path)).not.toContain('Home.md');
    expect(assets.every((asset) => !asset.path.startsWith('.'))).toBe(true);
    expect(assets[0]?.size).toBeGreaterThan(0);
  });

  it('serves vault assets but never hidden files', async () => {
    const png = await app.inject({ method: 'GET', url: '/api/assets/assets/tavern.png' });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toMatch(/^image\/png/);

    expect(
      (await app.inject({ method: 'GET', url: '/api/assets/.obsidian/app.json' })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/assets/..%2Fpackage.json' })).statusCode,
    ).not.toBe(200);
  });

  it('never serves a note as an asset: the notes have one door, and it is /api/notes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/assets/Home.md' })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/assets/Campaign/NPCs/Mira.md' })).statusCode,
    ).toBe(404);
    // The same file is there, through the door that will one day be asked who is knocking.
    expect((await app.inject({ method: 'GET', url: '/api/notes/Home.md' })).statusCode).toBe(200);
  });

  it('stores an uploaded file under assets/', async () => {
    const boundary = 'rhizom-boundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="map sketch.png"',
      'Content-Type: image/png',
      '',
      'PNGDATA',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: 'POST',
      url: '/api/assets',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ path: 'assets/map sketch.png' });
    expect(readFileSync(join(root, 'assets', 'map sketch.png'), 'utf8')).toBe('PNGDATA');

    const served = await app.inject({ method: 'GET', url: '/api/assets/assets/map%20sketch.png' });
    expect(served.statusCode).toBe(200);
  });

  it('rebuilds the index on request and picks up external changes', async () => {
    writeInto(root, 'External.md', '# External\n\nWritten outside Rhizom.\n');
    const res = await app.inject({ method: 'POST', url: '/api/index/rebuild' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ added: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/notes/External.md' })).statusCode).toBe(
      200,
    );
  });

  it('publishes the OpenAPI document and its UI', async () => {
    const doc = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(doc.statusCode).toBe(200);
    const openapi = doc.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(openapi.openapi).toMatch(/^3\./);
    expect(Object.keys(openapi.paths)).toEqual(
      expect.arrayContaining(['/api/vault', '/api/search', '/api/notes', '/api/graph/local']),
    );

    const ui = await app.inject({ method: 'GET', url: '/api/docs' });
    expect([200, 301, 302]).toContain(ui.statusCode);
  });

  it('streams index events over server-sent events', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}/api/events`, { signal: controller.signal });
      expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let received = '';
      const first = await reader!.read();
      received += decoder.decode(first.value as Uint8Array);
      expect(received).toContain(': connected');

      await fetch(`${address}/api/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'Streamed.md', content: '# Streamed' }),
      });
      while (!received.includes('event: indexed')) {
        const chunk = await reader!.read();
        if (chunk.done) {
          break;
        }
        received += decoder.decode(chunk.value as Uint8Array);
      }
      expect(received).toContain('event: indexed');
      expect(received).toContain('"Streamed.md"');
    } finally {
      controller.abort();
    }
  });
});

describe('web app with history-API fallback', () => {
  let app: FastifyInstance;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), 'rhizom-web-dist-'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Rhizom</title>');
    writeFileSync(join(webDist, 'app.js'), 'console.log("hi")');
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'export {}');
    app = await buildApp({ webDist });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(webDist, { recursive: true, force: true });
  });

  it('serves files from the build directory', async () => {
    const res = await app.inject({ method: 'GET', url: '/app.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body).toContain('console.log');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('marks hashed assets as immutable', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves index.html for the root path', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<title>Rhizom</title>');
  });

  it('falls back to index.html for unknown GET paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings/profile?tab=2' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<title>Rhizom</title>');
  });

  it('answers HEAD requests for pages without a body', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/settings' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toBe('');
  });

  it('keeps /api/* JSON even when the web app is served', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('treats API paths with a doubled slash or a fragment as API paths', async () => {
    for (const url of ['//api/nope', '/api#fragment', '/./api/nope']) {
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/^application\/json/);
    }
  });

  it('does not serve index.html for missing assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-old.js' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('does not fall back for non-GET requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/settings' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('never serves files outside the build directory', async () => {
    for (const url of [
      '/../package.json',
      '/%2e%2e/package.json',
      '/assets/..%2f..%2fpackage.json',
    ]) {
      const res = await app.inject({ method: 'GET', url });

      expect(res.body, url).not.toContain('"name"');
    }
  });

  it('ignores a configured directory that does not exist', async () => {
    const missing = await buildApp({ webDist: join(webDist, 'does-not-exist') });
    await missing.ready();
    const res = await missing.inject({ method: 'GET', url: '/' });
    await missing.close();

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });
});
