import type { GlossaryEntry } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { groupByLetter } from './glossary-model.js';

function entry(title: string, aliases: string[] = []): GlossaryEntry {
  return { path: `Glossary/${title}.md`, title, aliases, summary: `About ${title}.` };
}

describe('groupByLetter', () => {
  it('groups consecutive entries under their first letter', () => {
    const groups = groupByLetter([entry('Anchor'), entry('Archive'), entry('Bell')]);
    expect(groups.map((group) => group.letter)).toEqual(['A', 'B']);
    expect(groups[0]?.entries.map((e) => e.title)).toEqual(['Anchor', 'Archive']);
  });

  it('keeps the order it was given, rather than sorting again', () => {
    const groups = groupByLetter([entry('Bell'), entry('Anchor')]);
    expect(groups.map((group) => group.letter)).toEqual(['B', 'A']);
  });

  it('puts an accented letter with its base letter', () => {
    const groups = groupByLetter([entry('Über die Wurzeln'), entry('Undercroft')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.letter).toBe('U');
  });

  it('collects anything that does not start with a letter under a hash', () => {
    const groups = groupByLetter([entry('3d6'), entry('…and so on'), entry('Bell')]);
    expect(groups.map((group) => group.letter)).toEqual(['#', 'B']);
    expect(groups[0]?.entries).toHaveLength(2);
  });

  it('survives a title that is only whitespace', () => {
    expect(groupByLetter([entry('   ')])).toEqual([
      { letter: '#', entries: [expect.objectContaining({ title: '   ' }) as GlossaryEntry] },
    ]);
  });

  it('has nothing to group for an empty glossary', () => {
    expect(groupByLetter([])).toEqual([]);
  });
});
