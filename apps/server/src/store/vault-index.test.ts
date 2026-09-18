import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseNote } from '@rhizom/core';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INDEX_SCHEMA_VERSION, VaultIndex } from './vault-index.js';

let index: VaultIndex;

function note(path: string, content: string, modifiedAt = new Date('2026-09-18T10:00:00Z')) {
  return {
    path,
    size: Buffer.byteLength(content),
    modifiedAt,
    hash: `hash-${path}-${String(content.length)}`,
    content,
    parsed: parseNote(content, { fallbackTitle: path.replace(/^.*\//, '').replace(/\.md$/, '') }),
  };
}

beforeEach(() => {
  index = VaultIndex.open(':memory:');
  index.upsertNote(
    note(
      'Home.md',
      '# Home\n\nStart with [[Silverstadt]] and [[Mira]]. Missing: [[The Ashen Codex]].\n\n#index',
    ),
  );
  index.upsertNote(
    note(
      'Campaign/Places/Silverstadt.md',
      '---\ntags: [campaign, places]\n---\n# Silverstadt\n\nA harbour city. The ledger is kept by [[Mira]].\nSee also [[Home]].',
    ),
  );
  index.upsertNote(
    note(
      'Campaign/NPCs/Mira the Ledger-Keeper.md',
      '---\naliases: [Mira]\ntags: [campaign, npcs]\n---\n# Mira the Ledger-Keeper\n\nShe keeps the harbour ledger in [[Silverstadt]].',
    ),
  );
});

afterEach(() => {
  index.close();
});

describe('notes', () => {
  it('lists notes with title, folder, tags and link counts', () => {
    const notes = index.listNotes();
    expect(notes.map((n) => n.path)).toEqual([
      'Campaign/NPCs/Mira the Ledger-Keeper.md',
      'Campaign/Places/Silverstadt.md',
      'Home.md',
    ]);
    const silverstadt = notes.find((n) => n.path === 'Campaign/Places/Silverstadt.md');
    expect(silverstadt).toMatchObject({
      name: 'Silverstadt',
      title: 'Silverstadt',
      folder: 'Campaign/Places',
      tags: ['campaign', 'places'],
      linkCount: 2,
      backlinkCount: 2,
    });
  });

  it('summarises one note exactly as the list does', () => {
    const path = 'Campaign/Places/Silverstadt.md';
    const fromList = index.listNotes().find((note) => note.path === path);
    expect(index.summary(path)).toEqual(fromList);
    expect(index.summary('Nope.md')).toBeUndefined();
  });

  it('returns the stored metadata of one note', () => {
    const mira = index.getNote('Campaign/NPCs/Mira the Ledger-Keeper.md');
    expect(mira).toMatchObject({
      title: 'Mira the Ledger-Keeper',
      hash: expect.stringMatching(/^hash-/) as string,
      frontmatter: { aliases: ['Mira'], tags: ['campaign', 'npcs'] },
      headings: [
        { level: 1, text: 'Mira the Ledger-Keeper', slug: 'mira-the-ledger-keeper', line: 5 },
      ],
    });
    expect(index.getNote('Nope.md')).toBeUndefined();
  });

  it('replaces a note on upsert and removes it on remove', () => {
    index.upsertNote(note('Home.md', '# Home\n\nNothing links here any more.'));
    expect(index.getNote('Home.md')?.title).toBe('Home');
    expect(index.backlinks('Campaign/Places/Silverstadt.md')).toHaveLength(1);
    index.removeNote('Home.md');
    expect(index.getNote('Home.md')).toBeUndefined();
    expect(index.stats().noteCount).toBe(2);
  });

  it('reports the file state of every note for incremental syncing', () => {
    const states = index.fileStates();
    expect(states.get('Home.md')).toEqual({
      size: expect.any(Number) as number,
      modifiedAt: new Date('2026-09-18T10:00:00Z'),
    });
    expect(states.size).toBe(3);
  });
});

describe('links and backlinks', () => {
  it('resolves wikilinks by path, name and alias', () => {
    const links = index.linksFrom('Home.md');
    expect(links.map((l) => [l.raw, l.target])).toEqual([
      ['Silverstadt', 'Campaign/Places/Silverstadt.md'],
      ['Mira', 'Campaign/NPCs/Mira the Ledger-Keeper.md'],
      ['The Ashen Codex', null],
    ]);
  });

  it('lists backlinks with the line of context', () => {
    const backlinks = index.backlinks('Campaign/NPCs/Mira the Ledger-Keeper.md');
    expect(backlinks).toEqual([
      {
        source: 'Campaign/Places/Silverstadt.md',
        sourceTitle: 'Silverstadt',
        context: 'A harbour city. The ledger is kept by [[Mira]].',
        line: 6,
      },
      {
        source: 'Home.md',
        sourceTitle: 'Home',
        context: 'Start with [[Silverstadt]] and [[Mira]]. Missing: [[The Ashen Codex]].',
        line: 3,
      },
    ]);
  });

  it('resolves earlier unresolved links when the target note appears, and unresolves on removal', () => {
    index.upsertNote(note('Campaign/Quests/The Ashen Codex.md', '# The Ashen Codex\n'));
    expect(index.linksFrom('Home.md').find((l) => l.raw === 'The Ashen Codex')?.target).toBe(
      'Campaign/Quests/The Ashen Codex.md',
    );
    expect(index.backlinks('Campaign/Quests/The Ashen Codex.md')).toHaveLength(1);

    index.removeNote('Campaign/Quests/The Ashen Codex.md');
    expect(index.linksFrom('Home.md').find((l) => l.raw === 'The Ashen Codex')?.target).toBeNull();
  });

  it('lists unresolved link targets with the number of notes that mention them', () => {
    expect(index.unresolved()).toEqual([{ target: 'The Ashen Codex', count: 1 }]);
  });
});

describe('search', () => {
  it('finds notes by words in title and body with a highlighted snippet, best first', () => {
    const result = index.search('harbour ledger', 10);
    expect(result.total).toBe(2);
    expect(result.hits[0]?.path).toBe('Campaign/NPCs/Mira the Ledger-Keeper.md');
    expect(result.hits[0]?.snippet).toContain('<mark>harbour</mark>');
    expect(result.hits[0]?.snippet).toContain('<mark>ledger</mark>');
    expect(result.hits.every((h) => h.score > 0)).toBe(true);
  });

  it('matches word prefixes and is case-insensitive', () => {
    expect(index.search('SILVER', 10).hits.map((h) => h.path)).toContain(
      'Campaign/Places/Silverstadt.md',
    );
  });

  it('escapes HTML in snippets and survives query syntax characters', () => {
    index.upsertNote(
      note('Html.md', '# Html\n\nCompare a < b & c > d with "quotes" OR NOT ( stuff'),
    );
    const hit = index.search('compare', 10).hits.find((h) => h.path === 'Html.md');
    expect(hit?.snippet).toContain(
      '<mark>Compare</mark> a &lt; b &amp; c &gt; d with &quot;quotes&quot;',
    );
    expect(() => index.search('"unbalanced OR NOT ( stuff:x', 10)).not.toThrow();
    expect(index.search('', 10)).toEqual({ query: '', hits: [], total: 0 });
  });

  it('honours the limit but reports the total', () => {
    const result = index.search('the', 1);
    expect(result.hits).toHaveLength(1);
    expect(result.total).toBeGreaterThan(1);
  });
});

describe('tags, tree and graph', () => {
  it('counts tags across notes', () => {
    expect(index.tags()).toEqual([
      { tag: 'campaign', count: 2 },
      { tag: 'index', count: 1 },
      { tag: 'npcs', count: 1 },
      { tag: 'places', count: 1 },
    ]);
  });

  it('builds a folder tree with folders first and notes sorted by name', () => {
    expect(index.tree()).toEqual([
      {
        type: 'folder',
        name: 'Campaign',
        path: 'Campaign',
        children: [
          {
            type: 'folder',
            name: 'NPCs',
            path: 'Campaign/NPCs',
            children: [
              {
                type: 'note',
                name: 'Mira the Ledger-Keeper',
                path: 'Campaign/NPCs/Mira the Ledger-Keeper.md',
                title: 'Mira the Ledger-Keeper',
              },
            ],
          },
          {
            type: 'folder',
            name: 'Places',
            path: 'Campaign/Places',
            children: [
              {
                type: 'note',
                name: 'Silverstadt',
                path: 'Campaign/Places/Silverstadt.md',
                title: 'Silverstadt',
              },
            ],
          },
        ],
      },
      { type: 'note', name: 'Home', path: 'Home.md', title: 'Home' },
    ]);
  });

  it('exposes notes and resolved links for the graph', () => {
    const data = index.graphInput();
    expect(data.notes).toHaveLength(3);
    expect(data.links.filter((l) => l.target !== null)).toHaveLength(5);
  });
});

describe('index file lifecycle', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rhizom-index-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists to a file and reopens it', () => {
    const file = join(dir, 'index.sqlite');
    const first = VaultIndex.open(file);
    first.upsertNote(note('A.md', '# A'));
    first.close();
    const second = VaultIndex.open(file);
    expect(second.stats().noteCount).toBe(1);
    second.close();
  });

  it('recreates the file when the schema version differs', () => {
    const file = join(dir, 'index.sqlite');
    const stale = new Database(file);
    stale.pragma(`user_version = ${String(INDEX_SCHEMA_VERSION + 100)}`);
    stale.exec('create table leftover (x)');
    stale.close();
    const reopened = VaultIndex.open(file);
    expect(reopened.stats().noteCount).toBe(0);
    expect(
      reopened.rawDatabase.prepare("select name from sqlite_master where name = 'leftover'").get(),
    ).toBeUndefined();
    reopened.close();
  });
});
