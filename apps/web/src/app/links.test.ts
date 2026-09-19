import type { NoteSummary } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { createAssetResolver, createResolver } from './links.js';

const assets = [
  { path: 'assets/tavern.png' },
  { path: 'assets/silverstadt-map.svg' },
  { path: 'Campaign/notes.txt' },
];

describe('createAssetResolver', () => {
  it('finds an attachment by its file name, wherever it lies', () => {
    const resolver = createAssetResolver(assets);
    expect(resolver.resolve('tavern.png')).toBe('assets/tavern.png');
    expect(resolver.resolve('notes.txt')).toBe('Campaign/notes.txt');
  });

  it('finds it by a path from the vault root as well', () => {
    const resolver = createAssetResolver(assets);
    expect(resolver.resolve('assets/silverstadt-map.svg')).toBe('assets/silverstadt-map.svg');
    expect(resolver.resolve('./assets/tavern.png')).toBe('assets/tavern.png');
  });

  it('ignores the case the writer used and surrounding space', () => {
    const resolver = createAssetResolver(assets);
    expect(resolver.resolve('  Tavern.PNG ')).toBe('assets/tavern.png');
  });

  it('has no answer for a file the vault does not hold', () => {
    const resolver = createAssetResolver(assets);
    expect(resolver.resolve('missing.png')).toBeNull();
    expect(resolver.resolve('')).toBeNull();
  });
});

function summary(path: string, aliases: string[] = []): NoteSummary {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    tags: [],
    aliases,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    size: 0,
    linkCount: 0,
    backlinkCount: 0,
  };
}

describe('createResolver', () => {
  it('resolves a note by name and reports one that does not exist', () => {
    const resolver = createResolver([
      summary('Campaign/Places/Silverstadt.md'),
      summary('Home.md'),
    ]);

    const found = resolver.resolve('Silverstadt', 'Home.md');
    expect(found.resolved && found.path).toBe('Campaign/Places/Silverstadt.md');

    const missing = resolver.resolve('Nowhere', 'Home.md');
    expect(missing.resolved).toBe(false);
  });

  it("resolves a note by an alias from its frontmatter, as the server's index does", () => {
    const resolver = createResolver([
      summary("Campaign/NPCs/Mira's Ledger.md", ['Mira Voss', 'Mira']),
      summary('Home.md'),
    ]);

    const byAlias = resolver.resolve('Mira', 'Home.md');
    expect(byAlias.resolved && byAlias.path).toBe("Campaign/NPCs/Mira's Ledger.md");
    expect(byAlias.resolved && byAlias.via).toBe('alias');
  });

  it('prefers the note beside the source, deterministically, when a name is ambiguous', () => {
    const notes = [
      summary('Research/Archive.md'),
      summary('Campaign/Places/Archive.md'),
      summary('Campaign/Places/Sunken Archive.md'),
    ];
    const fromCampaign = createResolver(notes).resolve('Archive', 'Campaign/Places/Home.md');
    expect(fromCampaign.resolved && fromCampaign.path).toBe('Campaign/Places/Archive.md');

    const reversed = createResolver([...notes].reverse()).resolve(
      'Archive',
      'Campaign/Places/Home.md',
    );
    expect(reversed.resolved && reversed.path).toBe('Campaign/Places/Archive.md');
  });
});
