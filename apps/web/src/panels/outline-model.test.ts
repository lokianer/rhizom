import type { Heading } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { headingAt, outlineRows, slugFromHash } from './outline-model.js';

/** Headings as `level#text@line`, which is all these tests need to write one. */
const headings = (...written: string[]): Heading[] =>
  written.map((entry, index) => {
    const [levels = '1', rest = ''] = entry.split('#');
    const [text = '', line] = rest.split('@');
    return {
      level: Number(levels),
      text,
      // Not the real slugger: these tests are about the rows, not about github-slugger, which
      // packages/core tests where it is used.
      slug: text.toLowerCase().replace(/\s+/g, '-'),
      line: line === undefined ? index + 1 : Number(line),
    };
  });

/** The outline as `depth:text` lines — the shape is what these tests are about. */
const shape = (list: readonly Heading[]): string[] =>
  outlineRows(list).map((row) => `${String(row.depth)}:${row.text}`);

describe('outlineRows', () => {
  it('indents each heading by the headings it hangs under', () => {
    expect(shape(headings('1#Silverstadt', '2#Districts', '3#Tidewater', '2#Calendar'))).toEqual([
      '0:Silverstadt',
      '1:Districts',
      '2:Tidewater',
      '1:Calendar',
    ]);
  });

  it('starts a note that opens at ## flush left, not one step in', () => {
    // The title is in the file name and the text begins at `##`: nothing is missing, so
    // nothing should look as if it were.
    expect(shape(headings('2#Layout', '3#Upper hall', '2#Hazards'))).toEqual([
      '0:Layout',
      '1:Upper hall',
      '0:Hazards',
    ]);
  });

  it('takes a jumped level as one step, not as the two it skipped', () => {
    expect(shape(headings('1#Mira', '3#Loot', '3#More loot', '2#Rumours'))).toEqual([
      '0:Mira',
      '1:Loot',
      '1:More loot',
      '1:Rumours',
    ]);
  });

  it('keeps two headings of the same text apart by their slug and line', () => {
    const rows = outlineRows([
      { level: 2, text: 'Loot', slug: 'loot', line: 4 },
      { level: 2, text: 'Loot', slug: 'loot-1', line: 12 },
    ]);
    expect(rows.map((row) => row.slug)).toEqual(['loot', 'loot-1']);
    expect(rows.map((row) => row.line)).toEqual([4, 12]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
  });

  it('carries an empty heading through as one, for the panel to name', () => {
    // `##` on a line of its own is a heading with no text. It is a row, because it is a place
    // in the note; what it is called is the panel's business, not the model's.
    const rows = outlineRows(headings('2#@3'));
    expect(rows).toEqual([{ text: '', level: 2, slug: '', line: 3, depth: 0 }]);
  });

  it('has no rows for a note without headings', () => {
    expect(outlineRows([])).toEqual([]);
  });

  it('has one row for a note with one heading', () => {
    expect(outlineRows(headings('4#Notes to self'))).toEqual([
      { text: 'Notes to self', level: 4, slug: 'notes-to-self', line: 1, depth: 0 },
    ]);
  });
});

describe('headingAt', () => {
  const rows = outlineRows(headings('1#Mira@3', '2#Loot@10', '3#Rare@14', '2#Rumours@22'));

  it('is the last heading at or above the line', () => {
    expect(headingAt(rows, 3)?.text).toBe('Mira');
    expect(headingAt(rows, 9)?.text).toBe('Mira');
    expect(headingAt(rows, 10)?.text).toBe('Loot');
    expect(headingAt(rows, 15)?.text).toBe('Rare');
    expect(headingAt(rows, 400)?.text).toBe('Rumours');
  });

  it('is nothing above the first heading, where the note has not started a part yet', () => {
    expect(headingAt(rows, 1)).toBeNull();
    expect(headingAt(rows, 2)).toBeNull();
  });

  it('is nothing in a note without headings', () => {
    expect(headingAt([], 12)).toBeNull();
  });
});

describe('slugFromHash', () => {
  it('reads the slug out of a fragment, decoded', () => {
    expect(slugFromHash('#districts')).toBe('districts');
    expect(slugFromHash('#%C3%BCber-die-wurzeln')).toBe('über-die-wurzeln');
    expect(slugFromHash('districts')).toBe('districts');
  });

  it('is nothing when the address names no heading', () => {
    expect(slugFromHash('')).toBeNull();
    expect(slugFromHash('#')).toBeNull();
  });

  it('keeps a fragment that is not valid encoding as it stands', () => {
    expect(slugFromHash('#100%-silver')).toBe('100%-silver');
  });
});
