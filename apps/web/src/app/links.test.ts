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

describe('createResolver', () => {
  it('resolves a note by name and reports one that does not exist', () => {
    const resolver = createResolver([
      { path: 'Campaign/Places/Silverstadt.md' },
      { path: 'Home.md' },
    ] as never);

    const found = resolver.resolve('Silverstadt', 'Home.md');
    expect(found.resolved && found.path).toBe('Campaign/Places/Silverstadt.md');

    const missing = resolver.resolve('Nowhere', 'Home.md');
    expect(missing.resolved).toBe(false);
  });
});
