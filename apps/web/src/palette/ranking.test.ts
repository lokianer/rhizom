import { describe, expect, it } from 'vitest';

import { highlightSegments, rankCommands, rankNotes, wrapIndex } from './ranking.js';

const commands = [
  { id: 'newNote', label: 'New note' },
  { id: 'toggleTheme', label: 'Switch theme' },
  { id: 'openGraph', label: 'Open the graph' },
];

const notes = [
  { path: 'Home.md', title: 'Home' },
  { path: 'Campaign/Places/Silverstadt.md', title: 'Silverstadt' },
  { path: 'Campaign/NPCs/Mira.md', title: "Mira's Ledger" },
  { path: 'Research/Graph visualisation.md', title: 'Graph visualisation' },
];

describe('rankCommands', () => {
  it('puts the best match first and drops the rest', () => {
    const ranked = rankCommands('graph', commands, 8);

    expect(ranked.map((match) => match.item.id)).toStrictEqual(['openGraph']);
    expect(ranked[0]?.positions).toHaveLength('graph'.length);
  });

  it('keeps the given order for an empty query and honours the limit', () => {
    expect(rankCommands('', commands, 2).map((match) => match.item.id)).toStrictEqual([
      'newNote',
      'toggleTheme',
    ]);
  });
});

describe('rankNotes', () => {
  it('matches the title and says so', () => {
    const ranked = rankNotes('silver', notes, 10);

    expect(ranked[0]?.item.path).toBe('Campaign/Places/Silverstadt.md');
    expect(ranked[0]?.field).toBe('title');
    expect(ranked[0]?.positions[0]).toBe(0);
  });

  it('falls back to the path when only that matches', () => {
    const ranked = rankNotes('npcs', notes, 10);

    expect(ranked[0]?.item.path).toBe('Campaign/NPCs/Mira.md');
    expect(ranked[0]?.field).toBe('path');
    expect(
      ranked[0]?.positions.map((index) => 'Campaign/NPCs/Mira.md'.charAt(index)),
    ).toStrictEqual(['N', 'P', 'C', 's']);
  });

  it('lists every note in order for an empty query, up to the limit', () => {
    const ranked = rankNotes('  ', notes, 2);

    expect(ranked.map((match) => match.item.title)).toStrictEqual(['Home', 'Silverstadt']);
    expect(ranked[0]?.positions).toStrictEqual([]);
  });

  it('finds nothing when the query is not a subsequence anywhere', () => {
    expect(rankNotes('zzzz', notes, 10)).toStrictEqual([]);
  });
});

describe('highlightSegments', () => {
  it('splits the text into matched and unmatched runs', () => {
    expect(highlightSegments('Silverstadt', [0, 1, 2])).toStrictEqual([
      { text: 'Sil', match: true },
      { text: 'verstadt', match: false },
    ]);
    expect(highlightSegments('Mira', [1, 3])).toStrictEqual([
      { text: 'M', match: false },
      { text: 'i', match: true },
      { text: 'r', match: false },
      { text: 'a', match: true },
    ]);
  });

  it('returns the whole text unmatched without positions', () => {
    expect(highlightSegments('Home', [])).toStrictEqual([{ text: 'Home', match: false }]);
    expect(highlightSegments('', [1])).toStrictEqual([]);
  });
});

describe('wrapIndex', () => {
  it('wraps around both ends', () => {
    expect(wrapIndex(0, 1, 3)).toBe(1);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
  });

  it('starts at the right end when nothing is chosen yet', () => {
    expect(wrapIndex(-1, 1, 3)).toBe(0);
    expect(wrapIndex(-1, -1, 3)).toBe(2);
  });

  it('has nowhere to go in an empty list', () => {
    expect(wrapIndex(-1, 1, 0)).toBe(-1);
  });
});
