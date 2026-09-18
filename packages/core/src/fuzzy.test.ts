import { describe, expect, it } from 'vitest';

import { fuzzyMatch, fuzzyRank } from './fuzzy.js';

describe('fuzzyMatch', () => {
  it('matches an empty query against anything with no highlighted positions', () => {
    expect(fuzzyMatch('', 'Silverstadt')).toEqual({ score: 0, positions: [] });
  });

  it('matches characters in order and reports their positions', () => {
    const match = fuzzyMatch('note', 'My Notes');
    expect(match?.positions).toEqual([3, 4, 5, 6]);
    expect(typeof match?.score).toBe('number');
  });

  it('is case-insensitive', () => {
    expect(fuzzyMatch('SILVER', 'silverstadt')).not.toBeNull();
    expect(fuzzyMatch('über', 'Über die Wurzeln')).not.toBeNull();
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'Silverstadt')).toBeNull();
    expect(fuzzyMatch('stadtsilver', 'Silverstadt')).toBeNull();
    expect(fuzzyMatch('a', '')).toBeNull();
  });

  it('scores consecutive matches above scattered ones', () => {
    const consecutive = fuzzyMatch('arch', 'Archive');
    const scattered = fuzzyMatch('arch', 'A random chapter');
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(scattered!.score);
  });

  it('scores matches at word starts above matches inside words', () => {
    const wordStarts = fuzzyMatch('sa', 'Sunken Archive');
    const inside = fuzzyMatch('sa', 'Tessalon');
    expect(wordStarts!.score).toBeGreaterThan(inside!.score);
  });

  it('treats slashes, dashes, underscores and camelCase as word boundaries', () => {
    const slash = fuzzyMatch('pa', 'Places/Archive');
    const camel = fuzzyMatch('pa', 'placesArchive');
    const plain = fuzzyMatch('pa', 'spaces');
    expect(slash!.score).toBeGreaterThan(plain!.score);
    expect(camel!.score).toBeGreaterThan(plain!.score);
  });
});

describe('fuzzyRank', () => {
  const notes = [
    { path: 'Campaign/Places/Sunken Archive.md', name: 'Sunken Archive' },
    { path: 'Research/Archive.md', name: 'Archive' },
    {
      path: 'Campaign/Sessions/Session 12 – The Sunken Archive.md',
      name: 'Session 12 – The Sunken Archive',
    },
    { path: 'Research/Zettelkasten.md', name: 'Zettelkasten' },
  ];

  it('returns only matching items, best first, with their positions', () => {
    const ranked = fuzzyRank('arch', notes, (note) => note.name);
    expect(ranked.map((r) => r.item.name)).toEqual([
      'Archive',
      'Sunken Archive',
      'Session 12 – The Sunken Archive',
    ]);
    expect(ranked[0]?.positions).toEqual([0, 1, 2, 3]);
  });

  it('prefers the shorter text when the match quality is otherwise equal', () => {
    const ranked = fuzzyRank('sunken', notes, (note) => note.name);
    expect(ranked[0]?.item.name).toBe('Sunken Archive');
  });

  it('returns every item in original order for an empty query', () => {
    expect(fuzzyRank('', notes, (note) => note.name).map((r) => r.item.name)).toEqual(
      notes.map((n) => n.name),
    );
  });

  it('honours the limit', () => {
    expect(fuzzyRank('e', notes, (note) => note.name, 2)).toHaveLength(2);
  });
});
