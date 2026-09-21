import { describe, expect, it } from 'vitest';

import { createNoteIndex, resolveLinkTarget } from './resolve.js';

const index = createNoteIndex([
  'Home.md',
  'Campaign/Campaign.md',
  'Campaign/Places/Silverstadt.md',
  'Campaign/Places/Archive.md',
  'Campaign/NPCs/Mira.md',
  'Research/Archive.md',
  'Research/Über die Wurzeln.md',
  'Research/Deep/Nested/Archive.md',
]);

describe('resolveLinkTarget', () => {
  it('resolves an exact vault path with or without the extension', () => {
    expect(resolveLinkTarget('Campaign/Places/Silverstadt', 'Home.md', index)).toEqual({
      resolved: true,
      path: 'Campaign/Places/Silverstadt.md',
      via: 'path',
    });
    expect(resolveLinkTarget('Campaign/Places/Silverstadt.md', 'Home.md', index)).toMatchObject({
      resolved: true,
      path: 'Campaign/Places/Silverstadt.md',
    });
  });

  it('matches paths case-insensitively and accepts backslashes', () => {
    expect(resolveLinkTarget('campaign\\places\\silverstadt', 'Home.md', index)).toMatchObject({
      resolved: true,
      path: 'Campaign/Places/Silverstadt.md',
    });
  });

  it('resolves a unique note name anywhere in the vault', () => {
    expect(resolveLinkTarget('Mira', 'Home.md', index)).toEqual({
      resolved: true,
      path: 'Campaign/NPCs/Mira.md',
      via: 'name',
    });
    expect(resolveLinkTarget('mira.md', 'Home.md', index)).toMatchObject({
      path: 'Campaign/NPCs/Mira.md',
    });
  });

  it('prefers the note in the same folder when a name is ambiguous', () => {
    expect(resolveLinkTarget('Archive', 'Research/Mycelium.md', index)).toEqual({
      resolved: true,
      path: 'Research/Archive.md',
      via: 'name',
      ambiguous: true,
    });
  });

  it('falls back to the shortest path, then alphabetical order, when a name is ambiguous', () => {
    expect(resolveLinkTarget('Archive', 'Home.md', index)).toEqual({
      resolved: true,
      path: 'Research/Archive.md',
      via: 'name',
      ambiguous: true,
    });
    const twoAtRootLevel = createNoteIndex(['Zeta/Archive.md', 'Alpha/Archive.md']);
    expect(resolveLinkTarget('Archive', 'Home.md', twoAtRootLevel)).toMatchObject({
      path: 'Alpha/Archive.md',
    });
  });

  it('handles unicode names in either normalisation form', () => {
    expect(resolveLinkTarget('Über die Wurzeln', 'Home.md', index)).toMatchObject({
      resolved: true,
      path: 'Research/Über die Wurzeln.md',
    });
  });

  it('reports an unresolved bare name with a root-level creation path', () => {
    expect(resolveLinkTarget('The Ashen Codex', 'Campaign/Quests/Codex.md', index)).toEqual({
      resolved: false,
      createPath: 'The Ashen Codex.md',
    });
  });

  it('reports an unresolved folder path with that path as creation path', () => {
    expect(resolveLinkTarget('Research/Graph Layout Algorithms', 'Home.md', index)).toEqual({
      resolved: false,
      createPath: 'Research/Graph Layout Algorithms.md',
    });
  });

  it('does not match a folder path by bare name', () => {
    expect(resolveLinkTarget('Places/Mira', 'Home.md', index)).toMatchObject({ resolved: false });
  });

  it('resolves an empty target to the source note itself', () => {
    expect(resolveLinkTarget('', 'Campaign/NPCs/Mira.md', index)).toEqual({
      resolved: true,
      path: 'Campaign/NPCs/Mira.md',
      via: 'self',
    });
  });

  it('refuses unsafe targets', () => {
    expect(resolveLinkTarget('../outside', 'Home.md', index)).toEqual({ resolved: false });
  });
});

describe('createNoteIndex', () => {
  it('can be extended and shrunk as notes appear and disappear', () => {
    const live = createNoteIndex(['A.md']);
    live.add('Folder/B.md');
    expect(resolveLinkTarget('B', 'A.md', live)).toMatchObject({ path: 'Folder/B.md' });
    live.remove('Folder/B.md');
    expect(resolveLinkTarget('B', 'A.md', live)).toMatchObject({ resolved: false });
    expect(live.size).toBe(1);
  });
});

describe('aliases', () => {
  const withAliases = createNoteIndex([]);
  withAliases.add('Campaign/NPCs/Mira the Ledger-Keeper.md', ['Mira', 'The Ledger']);
  withAliases.add('Research/Rhizomes.md');

  it('resolves a link to a note by one of its aliases, case-insensitively', () => {
    expect(resolveLinkTarget('mira', 'Home.md', withAliases)).toEqual({
      resolved: true,
      path: 'Campaign/NPCs/Mira the Ledger-Keeper.md',
      via: 'alias',
    });
    expect(resolveLinkTarget('The Ledger', 'Home.md', withAliases)).toMatchObject({
      path: 'Campaign/NPCs/Mira the Ledger-Keeper.md',
    });
  });

  it('prefers a real note name over an alias', () => {
    withAliases.add('People/Mira.md');
    expect(resolveLinkTarget('Mira', 'Home.md', withAliases)).toMatchObject({
      path: 'People/Mira.md',
      via: 'name',
    });
  });

  it('forgets aliases when the note is removed or re-added without them', () => {
    withAliases.remove('People/Mira.md');
    withAliases.add('Campaign/NPCs/Mira the Ledger-Keeper.md', []);
    expect(resolveLinkTarget('Mira', 'Home.md', withAliases)).toMatchObject({ resolved: false });
  });
});
