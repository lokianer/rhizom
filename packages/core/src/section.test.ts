import { describe, expect, it } from 'vitest';

import { parseNote } from './parse.js';
import { sliceBlock, sliceSection } from './section.js';

function slice(markdown: string, reference: string): string | undefined {
  return sliceSection(markdown, parseNote(markdown, { fallbackTitle: 'N' }).headings, reference);
}

const NOTE = [
  '# Session 12',
  '',
  'The party went in.',
  '',
  '## Loot',
  '',
  '- a lantern',
  '- a ledger',
  '',
  '### Claimed by Mira',
  '',
  'The ledger.',
  '',
  '## Casualties',
  '',
  'None.',
].join('\n');

describe('sliceSection', () => {
  it('takes the heading and everything under it, up to the next heading of that level', () => {
    expect(slice(NOTE, 'Loot')).toBe(
      [
        '## Loot',
        '',
        '- a lantern',
        '- a ledger',
        '',
        '### Claimed by Mira',
        '',
        'The ledger.',
      ].join('\n'),
    );
  });

  it('stops at a heading of a higher level, not at a deeper one', () => {
    expect(slice(NOTE, 'Claimed by Mira')).toBe(
      ['### Claimed by Mira', '', 'The ledger.'].join('\n'),
    );
  });

  it('runs to the end of the note for the last section', () => {
    expect(slice(NOTE, 'Casualties')).toBe(['## Casualties', '', 'None.'].join('\n'));
  });

  it('takes the whole note when the level-1 heading is addressed', () => {
    expect(slice(NOTE, 'Session 12')).toBe(NOTE);
  });

  it('slugs the reference, so case and spacing do not matter', () => {
    expect(slice(NOTE, '  loot  ')).toBe(slice(NOTE, 'Loot'));
  });

  it('addresses a repeated heading by its numbered slug, as an anchor link does', () => {
    const repeated = ['## Loot', '', 'First.', '', '## Loot', '', 'Second.'].join('\n');
    expect(slice(repeated, 'Loot')).toBe('## Loot\n\nFirst.');
    expect(slice(repeated, 'loot-1')).toBe('## Loot\n\nSecond.');
  });

  it('works on a note saved with Windows line endings', () => {
    const crlf = NOTE.replaceAll('\n', '\r\n');
    expect(slice(crlf, 'Casualties')).toBe(['## Casualties', '', 'None.'].join('\n'));
  });

  it('keeps a hash inside a fenced block out of it', () => {
    const fenced = [
      '## Config',
      '',
      '```sh',
      '# not a heading',
      '```',
      '',
      '## After',
      '',
      'x',
    ].join('\n');
    expect(slice(fenced, 'Config')).toBe(
      ['## Config', '', '```sh', '# not a heading', '```'].join('\n'),
    );
  });

  it('keeps a setext heading legible by taking its underline with it', () => {
    const setext = ['Loot', '----', '', 'A lantern.', '', '## After', '', 'x'].join('\n');
    expect(slice(setext, 'Loot')).toBe(['Loot', '----', '', 'A lantern.'].join('\n'));
  });

  it('finds a heading whose reference was copied with its spacing', () => {
    const spaced = ['## Loot   and  Lore', '', 'x', '', '## After', '', 'y'].join('\n');
    expect(slice(spaced, 'Loot   and  Lore')).toBe('## Loot   and  Lore\n\nx');
    expect(slice(spaced, 'Loot and Lore')).toBe('## Loot   and  Lore\n\nx');
  });

  it('does not let a heading inside a callout end the section', () => {
    const callout = [
      '## Loot',
      '',
      '> [!quote] From the rulebook',
      '> ## Sharing',
      '> Treasure is shared evenly.',
      '',
      'The party found a lantern.',
      '',
      '## Casualties',
    ].join('\n');
    expect(slice(callout, 'Loot')).toBe(
      [
        '## Loot',
        '',
        '> [!quote] From the rulebook',
        '> ## Sharing',
        '> Treasure is shared evenly.',
        '',
        'The party found a lantern.',
      ].join('\n'),
    );
  });

  it('has no section for a heading that only exists inside another block', () => {
    const nested = ['## Tasks', '', '- item', '  ### Sub', '', 'after'].join('\n');
    expect(slice(nested, 'Sub')).toBeUndefined();
  });

  it('survives a file saved with lone carriage returns', () => {
    const cr = ['## Loot', '', 'A lantern.', '', '## After', '', 'x'].join('\r');
    expect(slice(cr, 'Loot')).toBe('## Loot\n\nA lantern.');
  });

  it('has no answer for a heading the note does not have, or for an empty reference', () => {
    expect(slice(NOTE, 'Treasure')).toBeUndefined();
    expect(slice(NOTE, '')).toBeUndefined();
    expect(slice(NOTE, '   ')).toBeUndefined();
  });
});

const BLOCKS = [
  '# Session 12',
  '',
  'The party went in. ^intro',
  '',
  '- a lantern ^lantern',
  '- a ledger',
  '',
  '> [!warning] The tide',
  '> It floods twice a day. ^tide',
  '',
  '## Loot ^loot',
  '',
  '| item | who |',
  '| --- | --- |',
  '| lantern | Mira ^row |',
  '',
  '```sh',
  'grep "^fenced" ledger.txt',
  '```',
].join('\n');

describe('sliceBlock', () => {
  it('takes the paragraph an id ends, marker and all', () => {
    expect(sliceBlock(BLOCKS, 'intro')).toBe('The party went in. ^intro');
  });

  it('takes the item an id ends, not the list around it', () => {
    expect(sliceBlock(BLOCKS, 'lantern')).toBe('- a lantern ^lantern');
  });

  it('takes the whole quotation, so a callout keeps its title', () => {
    expect(sliceBlock(BLOCKS, 'tide')).toBe(
      ['> [!warning] The tide', '> It floods twice a day. ^tide'].join('\n'),
    );
  });

  it('takes the heading line an id ends', () => {
    expect(sliceBlock(BLOCKS, 'loot')).toBe('## Loot ^loot');
  });

  it('takes the whole table for an id in a row, because a row alone is not one', () => {
    expect(sliceBlock(BLOCKS, 'row')).toBe(
      ['| item | who |', '| --- | --- |', '| lantern | Mira ^row |'].join('\n'),
    );
  });

  it('takes the paragraph an id ends halfway down a quotation, not the quotation', () => {
    const quote = ['> One. ^first', '>', '> Two.'].join('\n');
    expect(sliceBlock(quote, 'first')).toBe('> One. ^first');
  });

  it('lifts a nested item out of the indentation the list gave it', () => {
    const nested = ['- outer', '    - inner ^deep', '    - other'].join('\n');
    expect(sliceBlock(nested, 'deep')).toBe('- inner ^deep');
  });

  it('works on a note saved with Windows line endings', () => {
    expect(sliceBlock(BLOCKS.replaceAll('\n', '\r\n'), 'tide')).toBe(
      ['> [!warning] The tide', '> It floods twice a day. ^tide'].join('\n'),
    );
  });

  it('has nothing for a caret inside a fenced block', () => {
    expect(sliceBlock(BLOCKS, 'fenced')).toBeUndefined();
  });

  it('has nothing for a caret inside a code span', () => {
    expect(sliceBlock('The flag is `grep ^start`.', 'start')).toBeUndefined();
  });

  it('has nothing for a caret in the middle of a sentence', () => {
    expect(sliceBlock('Read ^intro before the rest.', 'intro')).toBeUndefined();
  });

  it('has nothing for a caret the line goes on after', () => {
    expect(sliceBlock('A **bold ^inside** claim.', 'inside')).toBeUndefined();
    expect(sliceBlock('A [link ^inside](Note.md) somewhere.', 'inside')).toBeUndefined();
  });

  it('has nothing for a caret alone on a line', () => {
    expect(sliceBlock(['One line.', '^alone'].join('\n'), 'alone')).toBeUndefined();
    expect(sliceBlock(['One line.', '', '^alone'].join('\n'), 'alone')).toBeUndefined();
  });

  it('has nothing for a caret with nothing after it', () => {
    expect(sliceBlock('The party went in. ^', '')).toBeUndefined();
    expect(sliceBlock('The party went in. ^', '^')).toBeUndefined();
  });

  it('has nothing for an id holding characters outside the set', () => {
    // The whole id has to match, so `^café` is a word with a caret, not the id `caf`.
    expect(sliceBlock('Ein Satz. ^café', 'café')).toBeUndefined();
    expect(sliceBlock('Ein Satz. ^café', 'caf')).toBeUndefined();
    expect(sliceBlock('A line. ^🙂', '🙂')).toBeUndefined();
    expect(sliceBlock('A line. ^first.second', 'first.second')).toBeUndefined();
  });

  it('accepts digits and hyphens, which is what Obsidian generates', () => {
    expect(sliceBlock('The party went in. ^a1b2-c3', 'a1b2-c3')).toBe(
      'The party went in. ^a1b2-c3',
    );
  });

  it('gives a repeated id to the first block that carries it', () => {
    const twice = ['First. ^same', '', 'Second. ^same'].join('\n');
    expect(sliceBlock(twice, 'same')).toBe('First. ^same');
  });

  it('tells two ids apart that differ only in case', () => {
    const cased = ['First. ^Abc', '', 'Second. ^abc'].join('\n');
    expect(sliceBlock(cased, 'Abc')).toBe('First. ^Abc');
    expect(sliceBlock(cased, 'abc')).toBe('Second. ^abc');
  });

  it('has nothing for an id the note does not carry', () => {
    expect(sliceBlock(BLOCKS, 'nowhere')).toBeUndefined();
    expect(sliceBlock(BLOCKS, '')).toBeUndefined();
    expect(sliceBlock(BLOCKS, '   ')).toBeUndefined();
  });

  it('reads a reference that was copied with spaces around it', () => {
    expect(sliceBlock(BLOCKS, '  intro  ')).toBe('The party went in. ^intro');
  });
});
