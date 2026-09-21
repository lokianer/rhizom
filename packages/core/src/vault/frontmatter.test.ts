import { describe, expect, it } from 'vitest';

import {
  findFrontmatter,
  frontmatterFields,
  NOTE_TYPES,
  noteTypeOf,
  setFrontmatter,
} from './frontmatter.js';
import { parseNote } from '../syntax/parse.js';

describe('noteTypeOf', () => {
  it('reads every reserved value', () => {
    for (const type of NOTE_TYPES) {
      expect(noteTypeOf({ type })).toBe(type);
    }
  });

  it('ignores case and surrounding space', () => {
    expect(noteTypeOf({ type: '  Definition ' })).toBe('definition');
    expect(noteTypeOf({ type: 'QUERY' })).toBe('query');
  });

  it('is undefined for a value the vault uses for itself', () => {
    expect(noteTypeOf({ type: 'article' })).toBeUndefined();
    expect(noteTypeOf({ type: 'npc' })).toBeUndefined();
  });

  it('is undefined when the key is missing or not a string', () => {
    expect(noteTypeOf({})).toBeUndefined();
    expect(noteTypeOf({ type: 42 })).toBeUndefined();
    expect(noteTypeOf({ type: ['definition'] })).toBeUndefined();
    expect(noteTypeOf({ type: null })).toBeUndefined();
    expect(noteTypeOf({ type: '' })).toBeUndefined();
  });
});

/**
 * A block with everything a careless rewrite loses: a comment, a blank line, a string somebody
 * quoted by hand, a list written one item per line, and a nested mapping no form can show.
 */
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
  '---',
  '',
  '# Silverstadt',
  '',
  'A city of [[Silver]].',
  '',
].join('\n');

const BROKEN = '---\na: [1, 2\nb: 3\n---\n\nBody\n';

describe('findFrontmatter', () => {
  it('finds the block, its text and its values', () => {
    const block = findFrontmatter(NOTE);

    expect(block?.start).toBe(0);
    expect(NOTE.slice(block?.end)).toBe('\n# Silverstadt\n\nA city of [[Silver]].\n');
    expect(block?.body).toBe(
      '# where the city sits\ntitle: Silverstadt\n\naliases: ["Silver City"]\n' +
        'tags:\n  - city\n  - ruin\nstats:\n  population: 12000\n  founded: 1274\ndraft: true\n',
    );
    expect(block?.values).toEqual({
      title: 'Silverstadt',
      aliases: ['Silver City'],
      tags: ['city', 'ruin'],
      stats: { population: 12000, founded: 1274 },
      draft: true,
    });
    expect(block?.error).toBeUndefined();
  });

  it('only reads a block that opens on the first line', () => {
    expect(findFrontmatter('Text\n\n---\ntitle: A\n---\n')).toBeUndefined();
    expect(findFrontmatter('\n---\ntitle: A\n---\n')).toBeUndefined();
    expect(findFrontmatter(' ---\ntitle: A\n---\n')).toBeUndefined();
    expect(findFrontmatter('----\ntitle: A\n---\n')).toBeUndefined();
    expect(findFrontmatter('---\ntitle: A\n')).toBeUndefined();
    expect(findFrontmatter('# Note\n')).toBeUndefined();
  });

  it('reads a block written with CRLF', () => {
    const block = findFrontmatter('---\r\ntitle: A\r\n---\r\n\r\nBody\r\n');

    expect(block?.body).toBe('title: A\r\n');
    expect(block?.values).toEqual({ title: 'A' });
    expect(block?.end).toBe('---\r\ntitle: A\r\n---\r\n'.length);
  });

  it('reads an empty block, with and without a line after it', () => {
    expect(findFrontmatter('---\n---\n\nBody\n')).toEqual({
      start: 0,
      end: 8,
      body: '',
      values: {},
    });
    expect(findFrontmatter('---\n---')).toEqual({ start: 0, end: 7, body: '', values: {} });
  });

  it('keeps the parser complaint and hands back no values', () => {
    const block = findFrontmatter(BROKEN);

    expect(block?.error).toContain('Flow sequence in block collection');
    expect(block?.values).toEqual({});
    expect(block?.body).toBe('a: [1, 2\nb: 3\n');
  });

  it('has no values when the fences hold something other than a mapping', () => {
    const block = findFrontmatter('---\n- a\n- b\n---\n');

    expect(block?.values).toEqual({});
    expect(block?.error).toBeUndefined();
  });

  it('sees the same block as the parser the index runs on', () => {
    const sources = [
      NOTE,
      BROKEN,
      '---\r\ntitle: A\r\n---\r\n\r\nBody\r\n',
      '---\n---\n\nBody\n',
      'Text\n\n---\ntitle: A\n---\n',
      '\n---\ntitle: A\n---\n',
      '----\ntitle: A\n---\n',
      '---\ntitle: A\n',
      '--- \ntitle: A\n--- \n',
    ];

    for (const source of sources) {
      const note = parseNote(source, { fallbackTitle: 'Untitled' });
      expect(findFrontmatter(source)?.values ?? {}).toEqual(note.frontmatter);
      expect(findFrontmatter(source)?.error === undefined).toBe(
        note.frontmatterError === undefined,
      );
    }
  });
});

describe('frontmatterFields', () => {
  it('lists the keys in the order the file writes them, with their lines', () => {
    const fields = frontmatterFields(findFrontmatter(NOTE)!);

    expect(fields.map((field) => [field.key, field.kind, field.line])).toEqual([
      ['title', 'text', 2],
      ['aliases', 'list', 4],
      ['tags', 'list', 5],
      ['stats', 'unsupported', 8],
      ['draft', 'boolean', 11],
    ]);
    expect(fields[0]?.value).toBe('Silverstadt');
  });

  it('infers a kind from every sort of value', () => {
    const block = findFrontmatter(
      [
        '---',
        'name: Elena',
        'age: 34',
        'retired: false',
        'when: 2024-05-01',
        'nearly: 2024-02-30',
        'tags: [a, b]',
        'empty:',
        'stats:',
        '  a: 1',
        'people:',
        '  - name: Elena',
        '---',
      ].join('\n'),
    )!;

    expect(Object.fromEntries(frontmatterFields(block).map((f) => [f.key, f.kind]))).toEqual({
      name: 'text',
      age: 'number',
      retired: 'boolean',
      when: 'date',
      // A day that does not exist is not a date; `Date.parse` would have moved it to 1 March.
      nearly: 'text',
      tags: 'list',
      empty: 'text',
      stats: 'unsupported',
      people: 'unsupported',
    });
  });

  it('calls a Date a date and reports no line for a key outside the text', () => {
    const fields = frontmatterFields({
      start: 0,
      end: 0,
      body: '',
      values: { when: new Date(Date.UTC(2024, 4, 1)), count: 3 },
    });

    expect(fields).toEqual([
      { key: 'when', kind: 'date', value: new Date(Date.UTC(2024, 4, 1)), line: 0 },
      { key: 'count', kind: 'number', value: 3, line: 0 },
    ]);
  });

  it('shows no fields for a block that could not be read', () => {
    expect(frontmatterFields(findFrontmatter(BROKEN)!)).toEqual([]);
  });
});

describe('setFrontmatter', () => {
  it('hands the note back untouched when there is nothing to do', () => {
    expect(setFrontmatter(NOTE, {})).toBe(NOTE);
    expect(setFrontmatter(NOTE, { title: 'Silverstadt' })).toBe(NOTE);
    expect(setFrontmatter(NOTE, { tags: ['city', 'ruin'], draft: true })).toBe(NOTE);
    expect(setFrontmatter(NOTE, { missing: undefined })).toBe(NOTE);
    expect(setFrontmatter('# Note\n', {})).toBe('# Note\n');
    expect(setFrontmatter('# Note\n', { missing: undefined })).toBe('# Note\n');
  });

  it('changes one key and leaves every other byte of the block alone', () => {
    expect(setFrontmatter(NOTE, { title: 'Silberstadt' })).toBe(
      NOTE.replace('title: Silverstadt', 'title: Silberstadt'),
    );
  });

  it('appends a key the block does not have at the end of it', () => {
    expect(setFrontmatter(NOTE, { status: 'draft' })).toBe(
      NOTE.replace('draft: true\n---', 'draft: true\nstatus: draft\n---'),
    );
  });

  it('removes a key with its line, and the lines a nested value stands on', () => {
    expect(setFrontmatter(NOTE, { stats: undefined, draft: undefined })).toBe(
      NOTE.replace('stats:\n  population: 12000\n  founded: 1274\ndraft: true\n', ''),
    );
  });

  it('leaves an empty block behind when the last key goes', () => {
    expect(setFrontmatter('---\ntitle: A\n---\n\nBody\n', { title: undefined })).toBe(
      '---\n---\n\nBody\n',
    );
  });

  it('writes a block in front of a note that has none', () => {
    expect(setFrontmatter('# Hello\n\nBody\n', { title: 'Hello', tags: ['a', 'b'] })).toBe(
      '---\ntitle: Hello\ntags: [a, b]\n---\n\n# Hello\n\nBody\n',
    );
    // No blank line to add where the note brings its own, and none where there is no prose.
    expect(setFrontmatter('\n# Hello\n', { title: 'Hello' })).toBe(
      '---\ntitle: Hello\n---\n\n# Hello\n',
    );
    expect(setFrontmatter('', { title: 'Hello' })).toBe('---\ntitle: Hello\n---\n');
  });

  it('quotes a string only where YAML needs it quoted', () => {
    const written = (value: unknown): string =>
      setFrontmatter('---\n---\n', { k: value }).slice('---\nk: '.length, -'\n---\n'.length);

    expect(written('yes')).toBe('"yes"');
    expect(written('no')).toBe('"no"');
    expect(written('true')).toBe('"true"');
    expect(written('null')).toBe('"null"');
    expect(written('123')).toBe('"123"');
    expect(written('#hash')).toBe('"#hash"');
    expect(written(' lead')).toBe('" lead"');
    expect(written('trail ')).toBe('"trail "');
    expect(written('a: b')).toBe('"a: b"');
    expect(written('')).toBe('""');
    expect(written('plain text')).toBe('plain text');
    expect(written(42)).toBe('42');
    expect(written(true)).toBe('true');
    expect(written(null)).toBe('null');
    expect(written(['a', 'b'])).toBe('[a, b]');
    expect(written([])).toBe('[]');
  });

  it('never escapes what is not ASCII', () => {
    expect(setFrontmatter('---\n---\n', { title: 'Über 🌱', tags: ['Wüste', '🌱'] })).toBe(
      '---\ntitle: Über 🌱\ntags: [Wüste, 🌱]\n---\n',
    );
  });

  it('writes a long list one item per line', () => {
    expect(
      setFrontmatter('---\n---\n', {
        tags: [
          'alpha-beta-gamma',
          'delta-epsilon-zeta',
          'eta-theta-iota',
          'kappa-lambda-mu',
          'nu-xi-omicron',
        ],
      }),
    ).toBe(
      '---\ntags:\n  - alpha-beta-gamma\n  - delta-epsilon-zeta\n  - eta-theta-iota\n' +
        '  - kappa-lambda-mu\n  - nu-xi-omicron\n---\n',
    );
  });

  it('writes a date without quotes, and leaves one that has not changed', () => {
    const dated = '---\nwhen: 2024-05-01\nname: Elena\n---\n';

    expect(setFrontmatter(dated, { when: '2024-05-01' })).toBe(dated);
    expect(setFrontmatter(dated, { when: '2024-06-01' })).toBe(
      '---\nwhen: 2024-06-01\nname: Elena\n---\n',
    );
    expect(setFrontmatter(dated, { when: new Date(Date.UTC(2024, 5, 1)) })).toBe(
      '---\nwhen: 2024-06-01\nname: Elena\n---\n',
    );
    // A day that does not exist stays the text somebody typed.
    expect(setFrontmatter(dated, { when: '2024-02-30' })).toBe(
      '---\nwhen: "2024-02-30"\nname: Elena\n---\n',
    );
  });

  it('keeps a comment standing behind the value it belongs to', () => {
    expect(
      setFrontmatter('---\ntitle: A # why\nempty: # nothing\n---\n', { title: 'B', empty: 'now' }),
    ).toBe('---\ntitle: B # why\nempty: now # nothing\n---\n');
  });

  it('keeps a block scalar as it was, and writes one where it belongs', () => {
    const note = '---\nsummary: |\n  one\n  two\ntitle: A\n---\n';

    expect(setFrontmatter(note, { title: 'B' })).toBe(
      '---\nsummary: |\n  one\n  two\ntitle: B\n---\n',
    );
    expect(setFrontmatter(note, { summary: 'three\nfour\n' })).toBe(
      '---\nsummary: |\n  three\n  four\ntitle: A\n---\n',
    );
    expect(setFrontmatter(note, { summary: undefined })).toBe('---\ntitle: A\n---\n');
  });

  it('turns a value into a list and back without disturbing its neighbours', () => {
    expect(setFrontmatter('---\ntitle: A\nx: 1\n---\n', { title: ['a', 'b'] })).toBe(
      '---\ntitle: [a, b]\nx: 1\n---\n',
    );
    expect(setFrontmatter('---\ntags:\n  - a\n  - b\ntitle: A\n---\n', { tags: 'one' })).toBe(
      '---\ntags: one\ntitle: A\n---\n',
    );
  });

  it('writes the line endings the note is written with', () => {
    expect(
      setFrontmatter('---\r\ntitle: A\r\n---\r\n\r\nBody\r\n', { title: 'B', tags: ['x'] }),
    ).toBe('---\r\ntitle: B\r\ntags: [x]\r\n---\r\n\r\nBody\r\n');
    expect(setFrontmatter('# Note\r\n\r\nBody\r\n', { title: 'A' })).toBe(
      '---\r\ntitle: A\r\n---\r\n\r\n# Note\r\n\r\nBody\r\n',
    );
  });

  it('adds a key under a comment-only block', () => {
    expect(setFrontmatter('---\n# nothing yet\n---\n\nBody\n', { title: 'A' })).toBe(
      '---\n# nothing yet\ntitle: A\n---\n\nBody\n',
    );
  });

  it('refuses to touch a block whose YAML nobody could read', () => {
    expect(setFrontmatter(BROKEN, { a: 1, title: 'New' })).toBe(BROKEN);

    const duplicate = '---\na: 1\na: 2\n---\n';
    expect(findFrontmatter(duplicate)?.error).toContain('Map keys must be unique');
    expect(setFrontmatter(duplicate, { a: 3 })).toBe(duplicate);
  });

  it('refuses a block that is not a mapping, rather than hanging a key off it', () => {
    const list = '---\n- a\n- b\n---\n\nBody\n';

    expect(setFrontmatter(list, { title: 'A' })).toBe(list);
  });

  it('leaves a value YAML has no way to write alone', () => {
    expect(setFrontmatter(NOTE, { title: () => 'Silberstadt' })).toBe(NOTE);
    expect(setFrontmatter(NOTE, { fresh: Symbol('x') })).toBe(NOTE);
  });

  it('follows the column the block keeps its keys in', () => {
    const indented = '---\n  title: A\n  tags: [a]\n---\n\nBody\n';

    expect(setFrontmatter(indented, { title: 'B' })).toBe(
      '---\n  title: B\n  tags: [a]\n---\n\nBody\n',
    );
    expect(setFrontmatter(indented, { added: 'x' })).toBe(
      '---\n  title: A\n  tags: [a]\n  added: x\n---\n\nBody\n',
    );
    expect(setFrontmatter(indented, { stats: { a: 1 } })).toBe(
      '---\n  title: A\n  tags: [a]\n  stats:\n    a: 1\n---\n\nBody\n',
    );
  });

  it('writes a mapping under its key when a caller insists on one', () => {
    expect(setFrontmatter('---\n---\n', { stats: { population: 12000, founded: 1274 } })).toBe(
      '---\nstats:\n  population: 12000\n  founded: 1274\n---\n',
    );
  });

  it('leaves what it writes readable by the parser the index runs on', () => {
    const written = setFrontmatter('# Hello\n', {
      title: 'Über 🌱',
      tags: ['city', 'ruin'],
      when: '2024-05-01',
      count: 3,
      draft: false,
      odd: 'yes',
    });

    expect(parseNote(written, { fallbackTitle: 'Untitled' }).frontmatter).toEqual({
      title: 'Über 🌱',
      tags: ['city', 'ruin'],
      when: '2024-05-01',
      count: 3,
      draft: false,
      odd: 'yes',
    });
  });
});
