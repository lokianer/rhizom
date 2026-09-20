import { setFrontmatter } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import {
  ADDABLE_KINDS,
  blankValue,
  boxText,
  canAddKey,
  fieldChange,
  frontmatterForm,
  todayIso,
} from './frontmatter-model.js';

/** A head with everything a form meets: a comment, a nested mapping, and lists written two ways. */
const NOTE = [
  '---',
  '# where the city sits',
  'title: Silverstadt',
  '',
  'aliases: ["Silver City"]',
  'tags:',
  '  - city',
  '  - ruin',
  'stats:',
  '  population: 12000',
  '  founded: 1274',
  'draft: true',
  'when: 2024-05-01',
  'count: 3',
  '---',
  '',
  '# Silverstadt',
  '',
].join('\n');

const BROKEN = '---\na: [1, 2\nb: 3\n---\n\nBody\n';

describe('frontmatterForm', () => {
  it('reads the keys in the order the file writes them, each in the shape its box wants', () => {
    expect(frontmatterForm(NOTE).fields).toEqual([
      { key: 'title', kind: 'text', value: 'Silverstadt' },
      { key: 'aliases', kind: 'list', value: ['Silver City'] },
      { key: 'tags', kind: 'list', value: ['city', 'ruin'] },
      { key: 'stats', kind: 'unsupported', value: '' },
      { key: 'draft', kind: 'boolean', value: true },
      { key: 'when', kind: 'date', value: '2024-05-01' },
      { key: 'count', kind: 'number', value: 3 },
    ]);
  });

  it('has no rows and nothing to complain about for a note with no head', () => {
    expect(frontmatterForm('# Silverstadt\n')).toEqual({ fields: [] });
    expect(frontmatterForm('')).toEqual({ fields: [] });
  });

  it('shows an empty block as a form waiting for its first key', () => {
    expect(frontmatterForm('---\n---\n\nBody\n')).toEqual({ fields: [] });
  });

  it('hands back the parser complaint and shows no rows at all', () => {
    const form = frontmatterForm(BROKEN);

    expect(form.error).toContain('Flow sequence in block collection');
    expect(form.fields).toEqual([]);
  });

  it('shows a key with nothing behind it as an empty text box', () => {
    expect(frontmatterForm('---\nsummary:\n---\n').fields).toEqual([
      { key: 'summary', kind: 'text', value: '' },
    ]);
  });

  it('reads a list the same way whether the file writes it flowing or one per line', () => {
    const flow = frontmatterForm('---\ntags: [city, ruin]\n---\n').fields[0];
    const block = frontmatterForm('---\ntags:\n  - city\n  - ruin\n---\n').fields[0];

    expect(flow?.value).toEqual(['city', 'ruin']);
    expect(block?.value).toEqual(['city', 'ruin']);
  });

  it('keeps what is not ASCII exactly as the file has it', () => {
    expect(frontmatterForm('---\ntitle: Über 🌱\ntags: [Wüste, 👨‍👩‍👧]\n---\n').fields).toEqual([
      { key: 'title', kind: 'text', value: 'Über 🌱' },
      { key: 'tags', kind: 'list', value: ['Wüste', '👨‍👩‍👧'] },
    ]);
  });
});

describe('fieldChange', () => {
  it('writes text as it was typed, spaces, case and all', () => {
    expect(fieldChange('title', 'text', '  Der Wald ')).toEqual({ title: '  Der Wald ' });
    expect(fieldChange('title', 'text', 'Über 🌱')).toEqual({ title: 'Über 🌱' });
    expect(fieldChange('title', 'text', '')).toEqual({ title: '' });
  });

  it('changes the one key it was given and leaves every other byte of the note alone', () => {
    expect(setFrontmatter(NOTE, fieldChange('title', 'text', 'Silberstadt'))).toBe(
      NOTE.replace('title: Silverstadt', 'title: Silberstadt'),
    );
  });

  it('reads a number out of the box', () => {
    expect(fieldChange('count', 'number', '12')).toEqual({ count: 12 });
    expect(fieldChange('count', 'number', 12)).toEqual({ count: 12 });
    expect(fieldChange('count', 'number', '-2.5')).toEqual({ count: -2.5 });
  });

  it('removes a number key whose box is empty rather than writing a zero', () => {
    expect(fieldChange('count', 'number', '')).toStrictEqual({ count: undefined });
    expect(fieldChange('count', 'number', '   ')).toStrictEqual({ count: undefined });

    const written = setFrontmatter(
      '---\ncount: 3\ntitle: A\n---\n',
      fieldChange('count', 'number', ''),
    );
    expect(written).toBe('---\ntitle: A\n---\n');
  });

  it('asks for nothing when a number box holds something that is not a number', () => {
    expect(fieldChange('count', 'number', 'twelve')).toEqual({});
    expect(setFrontmatter(NOTE, fieldChange('count', 'number', 'twelve'))).toBe(NOTE);
  });

  it('writes a tick as true and an empty box as false', () => {
    expect(fieldChange('draft', 'boolean', true)).toEqual({ draft: true });
    expect(fieldChange('draft', 'boolean', false)).toEqual({ draft: false });
  });

  it('writes a date as the plain day it is', () => {
    expect(fieldChange('when', 'date', '2024-06-01')).toEqual({ when: '2024-06-01' });
    expect(setFrontmatter(NOTE, fieldChange('when', 'date', '2024-06-01'))).toBe(
      NOTE.replace('when: 2024-05-01', 'when: 2024-06-01'),
    );
  });

  it('removes a date key whose box has been cleared', () => {
    expect(fieldChange('when', 'date', '')).toStrictEqual({ when: undefined });
    expect(
      setFrontmatter('---\nwhen: 2024-05-01\ntitle: A\n---\n', fieldChange('when', 'date', '')),
    ).toBe('---\ntitle: A\n---\n');
  });

  it('splits a list on its lines and drops the ones with nothing on them', () => {
    expect(fieldChange('tags', 'list', 'city\n\nruin\n   \n')).toEqual({
      tags: ['city', 'ruin'],
    });
    expect(fieldChange('tags', 'list', 'city\r\nruin\r\n')).toEqual({ tags: ['city', 'ruin'] });
  });

  it('keeps every entry of a list as it was typed', () => {
    expect(fieldChange('tags', 'list', 'Alte Stadt\n👨‍👩‍👧\n  eingerückt')).toEqual({
      tags: ['Alte Stadt', '👨‍👩‍👧', '  eingerückt'],
    });
  });

  it('empties a list rather than losing the key when its box is cleared', () => {
    expect(fieldChange('tags', 'list', '')).toEqual({ tags: [] });
    expect(setFrontmatter('---\ntags: [a]\n---\n', fieldChange('tags', 'list', ''))).toBe(
      '---\ntags: []\n---\n',
    );
  });

  it('asks for nothing at all for a value no box could hold', () => {
    expect(fieldChange('stats', 'unsupported', '')).toEqual({});
    expect(setFrontmatter(NOTE, fieldChange('stats', 'unsupported', ''))).toBe(NOTE);
  });
});

describe('boxText', () => {
  it('shows a list one entry per line and everything else as its text', () => {
    expect(boxText(['city', 'ruin'])).toBe('city\nruin');
    expect(boxText([])).toBe('');
    expect(boxText('Silverstadt')).toBe('Silverstadt');
    expect(boxText(3)).toBe('3');
    expect(boxText(true)).toBe('true');
  });

  it('comes back through fieldChange as the value it started as', () => {
    const value = ['city', 'ruin'];

    expect(fieldChange('tags', 'list', boxText(value))).toEqual({ tags: value });
  });
});

describe('blankValue', () => {
  it('starts a new key with a value of the kind that was chosen', () => {
    expect(blankValue('text', '2026-09-20')).toBe('');
    expect(blankValue('number', '2026-09-20')).toBe(0);
    expect(blankValue('boolean', '2026-09-20')).toBe(false);
    expect(blankValue('date', '2026-09-20')).toBe('2026-09-20');
    expect(blankValue('list', '2026-09-20')).toEqual([]);
  });

  it('writes a row the form reads back as the kind it was added as', () => {
    for (const kind of ADDABLE_KINDS) {
      const written = setFrontmatter(
        '---\n---\n',
        fieldChange('fresh', kind, blankValue(kind, '2026-09-20')),
      );

      expect(frontmatterForm(written).fields).toEqual([
        { key: 'fresh', kind, value: blankValue(kind, '2026-09-20') },
      ]);
    }
  });
});

describe('canAddKey', () => {
  const keys = ['title', 'tags'];

  it('takes a name the block does not have yet', () => {
    expect(canAddKey('status', keys)).toBe(true);
    expect(canAddKey('Über 🌱', keys)).toBe(true);
    expect(canAddKey('👨‍👩‍👧', keys)).toBe(true);
  });

  it('refuses a name of nothing', () => {
    expect(canAddKey('', keys)).toBe(false);
    expect(canAddKey('   ', keys)).toBe(false);
  });

  it('refuses a key the block already has, and compares it exactly', () => {
    expect(canAddKey('title', keys)).toBe(false);
    // YAML keys are case-sensitive: `Title` beside `title` is a second key, not a clash.
    expect(canAddKey('Title', keys)).toBe(true);
    expect(canAddKey('title ', keys)).toBe(true);
  });

  it('refuses the shapes a path into a nested value is written in', () => {
    expect(canAddKey('stats.population', keys)).toBe(false);
    expect(canAddKey('people[0]', keys)).toBe(false);
    expect(canAddKey('.', keys)).toBe(false);
  });
});

describe('todayIso', () => {
  it('writes the day the reader is having, not the one UTC is having', () => {
    // Late in the evening east of UTC the two are different days, and the wrong one would be
    // the date somebody's note is stamped with.
    const evening = new Date(2026, 0, 5, 23, 30);

    expect(todayIso(evening)).toBe('2026-01-05');
  });

  it('pads every part to the width a date field expects', () => {
    expect(todayIso(new Date(2026, 8, 7, 12))).toBe('2026-09-07');
  });
});
