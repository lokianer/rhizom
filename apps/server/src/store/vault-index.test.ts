import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { glossaryTerms, parseNote } from '@rhizom/core';
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
      '---\naliases: [Mira]\ntags: [campaign, npcs]\n---\n# Mira the Ledger-Keeper\n\nShe keeps the harbour ledger in [[Silverstadt]].\n\n![[Glossary/Ledger]]',
    ),
  );
  index.upsertNote(
    note(
      'Glossary/Ledger.md',
      '---\ntype: definition\naliases: [ledgers, account book]\n---\n# Ledger\n\nA bound record of debts and payments.',
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
      'Glossary/Ledger.md',
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
    expect(index.stats().noteCount).toBe(3);
  });

  it('reports the file state of every note for incremental syncing', () => {
    const states = index.fileStates();
    expect(states.get('Home.md')).toEqual({
      size: expect.any(Number) as number,
      modifiedAt: new Date('2026-09-18T10:00:00Z'),
    });
    expect(states.size).toBe(4);
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

  it('finds a note by an alias it declares, and not by one it does not', () => {
    index.upsertNote(
      note(
        'Campaign/Places/Silverstadt.md',
        '---\ntags: [campaign, places]\naliases: [the Silver City, Silverstadt-on-Selle]\n---\n# Silverstadt\n\nA harbour city. The ledger is kept by [[Mira]].\nSee also [[Home]].',
      ),
    );
    // Nothing in the prose of this vault says "Selle"; the alias is the only place it stands.
    expect(index.search('Selle', 10).hits.map((hit) => hit.path)).toEqual([
      'Campaign/Places/Silverstadt.md',
    ]);
    expect(index.search('Golden City', 10).hits).toEqual([]);
  });

  it('shows the opening of the note when only an alias matched, marking nothing', () => {
    index.upsertNote(
      note(
        'Campaign/Places/Sunken Archive.md',
        '---\naliases: [Drowned Library, the Archive below]\n---\n# Sunken Archive\n\nThe lower stacks, under the water line since 841.',
      ),
    );
    const hit = index.search('drowned', 10).hits[0];
    expect(hit?.path).toBe('Campaign/Places/Sunken Archive.md');
    expect(hit?.snippet).toContain('The lower stacks');
    expect(hit?.snippet).not.toContain('<mark>');
  });

  it('ranks a title before an alias and an alias before a mention in the body', () => {
    const prose = 'A tower over the water, lit against the tide.';
    index.upsertNote(note('Rank/Beacon.md', `# Beacon\n\n${prose}`));
    index.upsertNote(
      note('Rank/Watchfire.md', `---\naliases: [Beacon]\n---\n# Watchfire\n\n${prose}`),
    );
    index.upsertNote(note('Rank/Quay.md', `# Quay\n\nThe beacon burns here, ${prose}`));
    expect(index.search('beacon', 10).hits.map((hit) => hit.path)).toEqual([
      'Rank/Beacon.md',
      'Rank/Watchfire.md',
      'Rank/Quay.md',
    ]);
  });

  it('indexes an alias in another script and one carrying an emoji', () => {
    index.upsertNote(
      note(
        'Garten/Wurzeln.md',
        '---\naliases: [Über die Wurzeln, Луна, 🌱 Sprout]\n---\n# Wurzeln\n\nSchön.',
      ),
    );
    const found = (query: string): string[] => index.search(query, 10).hits.map((hit) => hit.path);
    // `remove_diacritics 2` folds the umlaut, and unicode61 folds case beyond ASCII.
    expect(found('Über')).toContain('Garten/Wurzeln.md');
    expect(found('uber')).toContain('Garten/Wurzeln.md');
    expect(found('Луна')).toContain('Garten/Wurzeln.md');
    expect(found('ЛУН')).toContain('Garten/Wurzeln.md');
    // The emoji is a separator to the tokeniser: it indexes nothing and breaks no neighbour.
    expect(found('Sprout')).toContain('Garten/Wurzeln.md');
    expect(index.search('🌱', 10)).toEqual({ query: '🌱', hits: [], total: 0 });
  });

  it('forgets an alias the note no longer declares', () => {
    const archive = (alias: string) =>
      note(
        'Campaign/Places/Sunken Archive.md',
        `---\naliases: [${alias}]\n---\n# Sunken Archive\n\nThe lower stacks, under the water line since 841.`,
      );
    index.upsertNote(archive('Drowned Library'));
    expect(index.search('Drowned Library', 10).hits.map((hit) => hit.path)).toEqual([
      'Campaign/Places/Sunken Archive.md',
    ]);

    index.upsertNote(archive('Lost Library'));
    expect(index.search('Drowned Library', 10).hits).toEqual([]);
    expect(index.search('Lost Library', 10).hits.map((hit) => hit.path)).toEqual([
      'Campaign/Places/Sunken Archive.md',
    ]);
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

  it('finds every note under a tag level, and nothing that merely starts alike', () => {
    expect(index.notesUnderTag('campaign')).toEqual([
      'Campaign/NPCs/Mira the Ledger-Keeper.md',
      'Campaign/Places/Silverstadt.md',
    ]);
    expect(index.notesUnderTag('npcs')).toEqual(['Campaign/NPCs/Mira the Ledger-Keeper.md']);
    expect(index.notesUnderTag('camp')).toEqual([]);
  });

  it('treats a tag with a wildcard character in it as the literal tag', () => {
    index.upsertNote(note('Odd.md', '# Odd\n\n#a_b/one and #axb/two'));
    // `_` is any single character to SQL's `like`, so without escaping this would also find the
    // note under `axb`.
    expect(index.notesUnderTag('a_b')).toEqual(['Odd.md']);
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
      {
        type: 'folder',
        name: 'Glossary',
        path: 'Glossary',
        children: [{ type: 'note', name: 'Ledger', path: 'Glossary/Ledger.md', title: 'Ledger' }],
      },
      { type: 'note', name: 'Home', path: 'Home.md', title: 'Home' },
    ]);
  });

  it('exposes notes and resolved links for the graph', () => {
    const data = index.graphInput();
    expect(data.notes).toHaveLength(4);
    // Five wikilinks plus the note embed of Glossary/Ledger.
    expect(data.links.filter((l) => l.target !== null)).toHaveLength(6);
  });

  it('hands the graph a resolved note embed, marked as one', () => {
    const embed = index
      .linksFrom('Campaign/NPCs/Mira the Ledger-Keeper.md')
      .find((link) => link.kind === 'embed');
    expect(embed?.target).toBe('Glossary/Ledger.md');
    expect(index.graphInput().links).toContainEqual({
      source: 'Campaign/NPCs/Mira the Ledger-Keeper.md',
      target: 'Glossary/Ledger.md',
      kind: 'embed',
    });
  });

  it('keeps a file embed out of the graph, because it resolves to no note', () => {
    index.upsertNote(note('Campaign/Places/Quay.md', '# Quay\n\n![[tavern.png]]'));
    const fileEmbed = index
      .graphInput()
      .links.find((link) => link.source === 'Campaign/Places/Quay.md');
    expect(fileEmbed?.target).toBeNull();
  });
});

describe('terms', () => {
  const terms = (): ReturnType<typeof glossaryTerms> => glossaryTerms(index.glossary());

  it('collects the title and every alias of a definition note', () => {
    const summary = 'A bound record of debts and payments.';
    expect(terms()).toEqual([
      { surface: 'Ledger', path: 'Glossary/Ledger.md', alias: false, summary },
      { surface: 'account book', path: 'Glossary/Ledger.md', alias: true, summary },
      { surface: 'ledgers', path: 'Glossary/Ledger.md', alias: true, summary },
    ]);
  });

  it('collects nothing from a note that is not a definition', () => {
    index.upsertNote(note('Campaign/Places/Harbour.md', '---\ntype: place\n---\n# Harbour'));
    expect(terms().every((term) => term.path === 'Glossary/Ledger.md')).toBe(true);
  });

  it('follows the note when it stops being a definition', () => {
    index.upsertNote(note('Glossary/Ledger.md', '# Ledger\n\nJust prose now.'));
    expect(terms()).toEqual([]);
  });

  it('forgets the terms of a removed note', () => {
    index.removeNote('Glossary/Ledger.md');
    expect(terms()).toEqual([]);
    expect(index.glossary()).toEqual([]);
  });

  it('keeps one row when a title and an alias fold to the same term', () => {
    index.upsertNote(
      note('Glossary/Tide.md', '---\ntype: definition\naliases: [TIDE, ebb]\n---\n# Tide'),
    );
    const tide = terms().filter((term) => term.path === 'Glossary/Tide.md');
    expect(tide).toEqual([
      { surface: 'Tide', path: 'Glossary/Tide.md', alias: false, summary: '' },
      { surface: 'ebb', path: 'Glossary/Tide.md', alias: true, summary: '' },
    ]);
  });

  it('sorts the glossary by title, whatever order the rows come back in', () => {
    index.upsertNote(note('Glossary/tide.md', '---\ntype: definition\n---\n# tide\n\nThe sea.'));
    index.upsertNote(note('Glossary/Anchor.md', '---\ntype: definition\n---\n# Anchor\n\nA hook.'));
    expect(index.glossary().map((entry) => entry.title)).toEqual(['Anchor', 'Ledger', 'tide']);
  });

  it('lists one glossary entry per definition note, with a summary that is not the title', () => {
    expect(index.glossary()).toEqual([
      {
        path: 'Glossary/Ledger.md',
        title: 'Ledger',
        aliases: ['account book', 'ledgers'],
        summary: 'A bound record of debts and payments.',
      },
    ]);
  });
});

describe('linkTextFor', () => {
  it('writes the bare name when it leads back to the same note', () => {
    expect(index.linkTextFor('Campaign/Places/Silverstadt.md', 'Home.md')).toBe('Silverstadt');
  });

  it('writes the path once a namesake exists, even where the tie breaks towards this note', () => {
    index.upsertNote(note('Research/Silverstadt.md', '# Silverstadt\n\nA paper, not a city.'));
    // From the same folder the name resolves here — but only until the next namesake moves in.
    expect(index.linkTextFor('Campaign/Places/Silverstadt.md', 'Campaign/Places/Docks.md')).toBe(
      'Campaign/Places/Silverstadt',
    );
  });
});

describe('mentionCandidates', () => {
  it('finds a note naming a title whose accent is a combining mark', () => {
    // The way a Mac writes a filename: the circumflex is a character of its own.
    const decomposed = 'Rhône'.normalize('NFD');
    index.upsertNote(note('Places/Rhone.md', `# ${decomposed}\n\nA river.`));
    index.upsertNote(note('Journal/Trip.md', `# Trip\n\nWe followed the ${decomposed} south.`));
    expect(index.mentionCandidates([decomposed], 10)).toContain('Journal/Trip.md');
  });

  it('passes over a note that only declares the term as an alias', () => {
    index.upsertNote(
      note(
        'Glossary/Tide.md',
        '---\naliases: [spring tides]\n---\n# Tide\n\nThe sea, twice a day.',
      ),
    );
    // Frontmatter is metadata, not prose: the scan would find nothing to mark in this note.
    expect(index.mentionCandidates(['spring tides'], 10)).not.toContain('Glossary/Tide.md');
  });

  it('asks for nothing when the terms hold no word', () => {
    expect(index.mentionCandidates(['', '  '], 10)).toEqual([]);
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
