// The player view must never hand out what the GM gate holds back. Every gated form carries a
// marker of its own; every route of the view is asked, for every session, and no answer may hold
// a marker that is not public at that session.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const FILES: Record<string, string> = {
  'Campaign/Campaign.md': '---\ntype: campaign\nsystem: 5e\n---\n# Silverstadt\n',
  'Campaign/Sessions/One.md': [
    '---',
    'type: session',
    'session: 1',
    '---',
    '# Session one',
    '',
    'We met [[Mira]].',
    '',
    '> [!gm]',
    '> Prep: [[Hidden Villain]] waits. SECRET-PREP',
    '',
    // What the security review tried, each with a link that must not count as met.
    '> [!gm] revealed: 1',
    '> The heist.',
    '> > [!gm]',
    '> > [[Hidden Villain]] is behind it. SECRET-NESTED',
    '',
    '> [!GM ]',
    '> [[Cult]] SECRET-SPACED',
    '',
    '> [&#33;gm]',
    '> [[Cult]] SECRET-ENTITY',
    '',
    '> [!gm|wide]',
    '> [[Cult]] SECRET-META',
    '',
    '> [!gm] Title',
    '> ---',
    '> [[Cult]] SECRET-SETEXT',
    '',
    '<details>',
    '> [!gm]',
    '> SECRET-HTML',
    '</details>',
    '',
    'Odds are 50\\%% tonight. %%[[Cult]] SECRET-ESCAPED%% Done.',
  ].join('\n'),
  'Campaign/Sessions/Two.md':
    '---\ntype: session\nsession: 2\n---\n# Session two\n\nThe [[Bell]] rang. %%[[Cult]] SECRET-COMMENT%%\n',
  'Campaign/Mira.md': [
    '---',
    'type: npc',
    'title: SECRET-FRONTTITLE',
    'alignment: SECRET-FRONTMATTER',
    '---',
    '# Mira',
    '',
    'A moneylender. She knows [[Hidden Villain]].',
    '',
    '> [!gm]',
    '> She is the treasurer. SECRET-CALLOUT',
    '',
    '- a list',
    '  > [!gm]-',
    '  > SECRET-NESTED',
    '',
    '> [!gm] revealed: 2',
    '> The ledger is forged. REVEAL-AT-TWO',
    '',
    'Then %% a comment that never closes SECRET-OPEN',
  ].join('\n'),
  'Campaign/Bell.md': '---  \nsecret: SECRET-SPACEDFRONT\n---\n# Bell\n\nCracked.\n',
  'Campaign/Hidden Villain.md': '# Hidden Villain\n\nSECRET-UNMET\n',
  'Campaign/Cult.md': '# Cult\n\nSECRET-CULT\n',
  'Campaign/Handout.md': '---\npublic: true\n---\n# Handout\n\nThe city map.\n',
  'Research/Notes.md': '# Notes\n\nSECRET-OUTSIDE\n',
};

let app: FastifyInstance;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-table-'));
  for (const [path, content] of Object.entries(FILES)) {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  app = await buildApp({
    webDist: false,
    vault: { dir: root, dataDir: ':memory:', watch: false },
  });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const get = async (url: string) => {
  const response = await app.inject(`/api/v/default/table${url}`);
  return { status: response.statusCode, body: response.body, json: () => response.json<unknown>() };
};

describe('the player view', () => {
  it('lists the sessions', async () => {
    expect((await get('/sessions')).json()).toEqual({ campaign: true, sessions: [1, 2] });
  });

  it('shows the notes met by a session, the session notes and public notes', async () => {
    const titles = async (session: number) =>
      ((await get(`/notes?session=${String(session)}`)).json() as { title: string }[]).map(
        (note) => note.title,
      );
    expect(await titles(1)).toEqual(['Handout', 'Mira', 'Session one']);
    expect(await titles(2)).toEqual(['Bell', 'Handout', 'Mira', 'Session one', 'Session two']);
    expect(await titles(0)).toEqual(['Handout']);
  });

  it('answers a hidden note exactly like a missing one', async () => {
    const hidden = await get('/notes/Campaign/Hidden%20Villain.md?session=2');
    const missing = await get('/notes/Campaign/Nobody.md?session=2');
    expect(hidden.status).toBe(404);
    expect(hidden.body).toBe(missing.body.replace('Nobody', 'Hidden Villain'));
  });

  it('reveals a block from its session on', async () => {
    const one = (await get('/notes/Campaign/Mira.md?session=1')).body;
    const two = (await get('/notes/Campaign/Mira.md?session=2')).body;
    expect(one).not.toContain('REVEAL-AT-TWO');
    expect(two).toContain('REVEAL-AT-TWO');
  });

  it('never hands out a marker, whatever is asked, at any session', async () => {
    const paths = Object.keys(FILES).map((path) =>
      path.split('/').map(encodeURIComponent).join('/'),
    );
    const answers: string[] = [];
    for (const session of [0, 1, 2, 3, 99]) {
      const query = `session=${String(session)}`;
      answers.push((await get(`/sessions`)).body, (await get(`/notes?${query}`)).body);
      for (const path of paths) {
        answers.push((await get(`/notes/${path}?${query}`)).body);
      }
      for (const word of [
        'SECRET',
        'treasurer',
        'villain',
        'cult',
        'forged',
        'ledger',
        'moneylender',
      ]) {
        answers.push((await get(`/search?q=${word}&${query}`)).body);
      }
      const leaked = answers.join('\n').match(/SECRET-[A-Z]+/g) ?? [];
      expect(leaked, `session ${String(session)}`).toEqual([]);
      if (session < 2) {
        expect(answers.join('\n')).not.toContain('REVEAL-AT-TWO');
      }
      answers.length = 0;
    }
  });

  it('finds public words, and only in notes the party has met', async () => {
    const hits = (await get('/search?q=moneylender&session=1')).json() as { path: string }[];
    expect(hits.map((hit) => hit.path)).toEqual(['Campaign/Mira.md']);
    expect((await get('/search?q=cracked&session=1')).json()).toEqual([]);
    expect(
      ((await get('/search?q=cracked&session=2')).json() as { path: string }[]).map(
        (hit) => hit.path,
      ),
    ).toEqual(['Campaign/Bell.md']);
  });

  it('says there is no campaign in a vault without one', async () => {
    const plain = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-table-plain-'));
    writeFileSync(join(plain, 'Home.md'), '# Home\n');
    const other = await buildApp({
      webDist: false,
      vault: { dir: plain, dataDir: ':memory:', watch: false },
    });
    try {
      const response = await other.inject('/api/v/default/table/sessions');
      expect(response.json()).toEqual({ campaign: false, sessions: [] });
      expect((await other.inject('/api/v/default/table/notes')).json()).toEqual([]);
    } finally {
      await other.close();
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
