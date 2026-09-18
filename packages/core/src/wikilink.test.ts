import { describe, expect, it } from 'vitest';

import { parseWikilink } from './wikilink.js';

describe('parseWikilink', () => {
  it('parses a bare target', () => {
    expect(parseWikilink('Silverstadt')).toEqual({ target: 'Silverstadt' });
  });

  it('parses an alias after the first pipe and keeps later pipes in the alias', () => {
    expect(parseWikilink('Silverstadt|the city')).toEqual({
      target: 'Silverstadt',
      alias: 'the city',
    });
    expect(parseWikilink('Silverstadt|a|b')).toEqual({ target: 'Silverstadt', alias: 'a|b' });
  });

  it('parses a heading', () => {
    expect(parseWikilink('Session 12#Loot')).toEqual({ target: 'Session 12', heading: 'Loot' });
  });

  it('parses heading and alias together', () => {
    expect(parseWikilink('Session 12#Loot|what we found')).toEqual({
      target: 'Session 12',
      heading: 'Loot',
      alias: 'what we found',
    });
  });

  it('parses a block reference', () => {
    expect(parseWikilink('Session 12#^abc123')).toEqual({
      target: 'Session 12',
      blockId: 'abc123',
    });
  });

  it('keeps folder paths in the target', () => {
    expect(parseWikilink('Campaign/Places/Silverstadt')).toEqual({
      target: 'Campaign/Places/Silverstadt',
    });
  });

  it('trims whitespace around every part', () => {
    expect(parseWikilink('  Silverstadt # Loot | city ')).toEqual({
      target: 'Silverstadt',
      heading: 'Loot',
      alias: 'city',
    });
  });

  it('treats a heading without a target as a link into the same note', () => {
    expect(parseWikilink('#Loot')).toEqual({ target: '', heading: 'Loot' });
  });

  it('drops empty alias and heading parts', () => {
    expect(parseWikilink('Silverstadt|')).toEqual({ target: 'Silverstadt' });
    expect(parseWikilink('Silverstadt#')).toEqual({ target: 'Silverstadt' });
  });

  it('returns an empty target for empty input', () => {
    expect(parseWikilink('')).toEqual({ target: '' });
    expect(parseWikilink('   ')).toEqual({ target: '' });
  });
});
