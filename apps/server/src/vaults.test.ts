import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NoteDocument, NoteLink, VaultSummary } from '@rhizom/core';
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
    expect(response.body).not.toContain(JSON.stringify(dndDir).slice(1, -1));
  });

  it('reads each note through its own vault only', async () => {
    const mira = await app.inject('/api/v/dnd/notes/Mira.md');
    expect(mira.statusCode).toBe(200);
    expect(mira.json<NoteDocument>().title).toBe('Mira');
    expect((await app.inject('/api/v/thesis/notes/Mira.md')).statusCode).toBe(404);
  });

  it('does not resolve a link across the vault boundary', async () => {
    const links = await app.inject('/api/v/dnd/links?path=Mira.md');
    expect(links.statusCode).toBe(200);
    expect(links.json<NoteLink[]>()).toEqual([
      expect.objectContaining({ raw: 'Thesis', target: null }),
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
