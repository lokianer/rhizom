import { describe, expect, it } from 'vitest';

import { parseNote } from './parse.js';
import { sliceSection } from './section.js';

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
