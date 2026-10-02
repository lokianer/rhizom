import { afterEach, describe, expect, it } from 'vitest';

import { setCurrentVault } from '../routing/vault.js';
import { notePathOfSplat, sessionOf, tableHref, tableResolver } from './table-model.js';

describe('the player view model', () => {
  afterEach(() => {
    setCurrentVault('default');
  });

  it('reads the session from the address, else the latest, never past it', () => {
    expect(sessionOf('3', [1, 2, 3, 4])).toBe(3);
    expect(sessionOf(null, [1, 2, 3, 4])).toBe(4);
    expect(sessionOf('9', [1, 2])).toBe(2);
    expect(sessionOf('nonsense', [1, 2])).toBe(2);
    expect(sessionOf(null, [])).toBe(0);
    expect(sessionOf('-1', [1])).toBe(0);
  });

  it('builds addresses inside the view, with the session', () => {
    setCurrentVault('dnd');
    expect(tableHref('Campaign/NPCs/Mira.md', 2)).toBe(
      '/v/dnd/table/notes/Campaign/NPCs/Mira?session=2',
    );
    expect(tableHref(null, 2)).toBe('/v/dnd/table?session=2');
    expect(notePathOfSplat('notes/Campaign/NPCs/Mira')).toBe('Campaign/NPCs/Mira.md');
    expect(notePathOfSplat('')).toBeNull();
  });

  it('resolves a link only to a note the table may read, and writes any other as plain text', () => {
    const resolve = tableResolver(['Campaign/NPCs/Mira.md', 'Campaign/Bell.md'], 2);
    expect(resolve('Mira', 'wikilink', 'Campaign/Bell.md')).toEqual({
      path: 'Campaign/NPCs/Mira.md',
      href: tableHref('Campaign/NPCs/Mira.md', 2),
    });
    expect(resolve('Hidden Villain', 'wikilink', 'Campaign/Bell.md')).toEqual({
      path: null,
      href: '',
      plain: true,
    });
  });
});
