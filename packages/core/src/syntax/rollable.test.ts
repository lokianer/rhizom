import { describe, expect, it } from 'vitest';

import {
  describeTableRoll,
  dieOfHeading,
  findRollable,
  findRollables,
  parseRange,
  rollTable,
} from './rollable.js';

describe('dieOfHeading', () => {
  it('finds a die standing as a word of its own', () => {
    expect(dieOfHeading('Rumours (d6)')).toBe('d6');
    expect(dieOfHeading('1d20 Encounters on the road')).toBe('1d20');
    expect(dieOfHeading('Treasure, d%')).toBe('d%');
    expect(dieOfHeading('D100 names')).toBe('d100');
  });

  it('does not find one inside a word, or a die that is not one', () => {
    expect(dieOfHeading('Road6d6x')).toBeUndefined();
    expect(dieOfHeading('Hd6 tables')).toBeUndefined();
    expect(dieOfHeading('A d0 table')).toBeUndefined();
    expect(dieOfHeading('Plain heading')).toBeUndefined();
  });
});

describe('parseRange', () => {
  it('reads single numbers, ranges in every dash, and 00 as a hundred', () => {
    expect(parseRange('4')).toEqual({ low: 4, high: 4 });
    expect(parseRange('2–4')).toEqual({ low: 2, high: 4 });
    expect(parseRange(' 5 - 6 ')).toEqual({ low: 5, high: 6 });
    expect(parseRange('97—00')).toEqual({ low: 97, high: 100 });
    expect(parseRange('00')).toEqual({ low: 100, high: 100 });
  });

  it('refuses what is not a range', () => {
    expect(parseRange('six')).toBeUndefined();
    expect(parseRange('4-2')).toBeUndefined();
    expect(parseRange('')).toBeUndefined();
    expect(parseRange('1-2-3')).toBeUndefined();
  });
});

const NOTE = `# Bell Square

## Rumours (d6)

Some words first.

- The bell rang thirteen times
- [[Sable]] was seen at the docks
- Nobody has seen the apprentice

## Weather, 1d8

| d8 | Weather |
| --- | --- |
| 1–4 | Fog off the river |
| 5-7 | Rain, and the [[Lantern Bridge]] slick |
| 8 | Clear and cold |

## Names (d4)

| First | Last |
| --- | --- |
| Orrin | Vale |
| Tessaly | Marsh |

## Just a heading

- not rollable

## Nothing under it (d6)

## Another (d6)

> [!note]
> ### Inside a callout (d4)
> - one
> - two
`;

describe('findRollables', () => {
  const rollables = findRollables(NOTE);

  it('finds a list, a range table and a plain table under headings that name a die', () => {
    expect(rollables.map((each) => [each.heading, each.kind, each.die])).toEqual([
      ['Rumours (d6)', 'list', 'd6'],
      ['Weather, 1d8', 'ranges', '1d8'],
      ['Names (d4)', 'rows', 'd4'],
      ['Inside a callout (d4)', 'list', 'd4'],
    ]);
  });

  it('reads list items as the note writes them', () => {
    expect(rollables[0]?.entries).toEqual([
      { text: 'The bell rang thirteen times', index: 0, line: 7 },
      { text: '[[Sable]] was seen at the docks', index: 1, line: 8 },
      { text: 'Nobody has seen the apprentice', index: 2, line: 9 },
    ]);
    expect(rollables[0]?.slug).toBe('rumours-d6');
    expect(rollables[0]?.line).toBe(3);
  });

  it('reads the ranges of a range table and keeps the rest of the row', () => {
    expect(rollables[1]?.entries).toEqual([
      { text: 'Fog off the river', index: 0, line: 15, low: 1, high: 4 },
      { text: 'Rain, and the [[Lantern Bridge]] slick', index: 1, line: 16, low: 5, high: 7 },
      { text: 'Clear and cold', index: 2, line: 17, low: 8, high: 8 },
    ]);
  });

  it('reads a table without ranges as whole rows', () => {
    expect(rollables[2]?.entries.map((entry) => entry.text)).toEqual([
      'Orrin — Vale',
      'Tessaly — Marsh',
    ]);
  });

  it('skips empty rows but keeps the place of the rest', () => {
    const [table] = findRollables('## Loot (d2)\n\n| a | b |\n| --- | --- |\n| | |\n| x | y |\n');
    expect(table?.entries).toEqual([{ text: 'x — y', index: 1, line: 6 }]);
  });
});

describe('rollTable', () => {
  const [rumours, weather, names] = findRollables(NOTE);

  it('picks a list item uniformly', () => {
    expect(rumours && rollTable(rumours, () => 0.5).entry?.text).toBe(
      '[[Sable]] was seen at the docks',
    );
    expect(rumours && rollTable(rumours, () => 0.999).entry?.index).toBe(2);
  });

  it('rolls the die of a range table and takes the row that holds it', () => {
    const result = weather && rollTable(weather, () => 5 / 8);
    expect(result?.roll?.total).toBe(6);
    expect(result?.entry?.text).toBe('Rain, and the [[Lantern Bridge]] slick');
    expect(weather && result && describeTableRoll(weather, result)).toBe(
      'Weather, 1d8 → 6: Rain, and the [[Lantern Bridge]] slick',
    );
  });

  it('writes down a number no row holds as it fell', () => {
    const [gappy] = findRollables('## Gaps (d6)\n\n| d6 | x |\n| --- | --- |\n| 1-2 | low |\n');
    const result = gappy && rollTable(gappy, () => 0.99);
    expect(result?.entry).toBeUndefined();
    expect(gappy && result && describeTableRoll(gappy, result)).toBe('Gaps (d6) → 6');
  });

  it('picks a row of a plain table uniformly, without a die to show', () => {
    const result = names && rollTable(names, () => 0);
    expect(result).toEqual({ entry: { text: 'Orrin — Vale', index: 0, line: 23 } });
    expect(names && result && describeTableRoll(names, result)).toBe('Names (d4) → Orrin — Vale');
  });
});

describe('findRollable', () => {
  it('finds a table by its heading, folded, or by its slug', () => {
    const rollables = findRollables(NOTE);
    expect(findRollable(rollables, 'rumours  (D6)')?.line).toBe(3);
    expect(findRollable(rollables, 'weather-1d8')?.line).toBe(11);
    expect(findRollable(rollables, 'Missing')).toBeUndefined();
  });
});
