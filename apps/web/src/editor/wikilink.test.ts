import { parser } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';

import { wikilinkExtension } from './wikilink.js';

const markdown = parser.configure(wikilinkExtension);

/** Every node of the parse in document order, which spells out the nesting well enough. */
function nodes(source: string): string[] {
  const names: string[] = [];
  const cursor = markdown.parse(source).cursor();
  do {
    names.push(cursor.name);
  } while (cursor.next());
  return names;
}

/** The text of the first node with the given name. */
function textOf(source: string, name: string): string | null {
  const cursor = markdown.parse(source).cursor();
  do {
    if (cursor.name === name) {
      return source.slice(cursor.from, cursor.to);
    }
  } while (cursor.next());
  return null;
}

describe('wikilinkExtension', () => {
  it('parses a plain link', () => {
    expect(nodes('[[Mira]]')).toEqual([
      'Document',
      'Paragraph',
      'WikiLink',
      'WikiLinkMark',
      'WikiLinkTarget',
      'WikiLinkMark',
    ]);
    expect(textOf('[[Mira]]', 'WikiLinkTarget')).toBe('Mira');
  });

  it('parses an alias', () => {
    expect(nodes('[[Mira|the smith]]')).toContain('WikiLinkAlias');
    expect(textOf('[[Mira|the smith]]', 'WikiLinkTarget')).toBe('Mira');
    expect(textOf('[[Mira|the smith]]', 'WikiLinkAlias')).toBe('the smith');
  });

  it('keeps a heading reference in the target', () => {
    expect(textOf('[[Mira#Hooks]]', 'WikiLinkTarget')).toBe('Mira#Hooks');
  });

  it('wraps an embed and marks its bang', () => {
    expect(nodes('![[map.png]]')).toEqual([
      'Document',
      'Paragraph',
      'WikiEmbed',
      'WikiLinkMark',
      'WikiLink',
      'WikiLinkMark',
      'WikiLinkTarget',
      'WikiLinkMark',
    ]);
    expect(textOf('![[map.png]]', 'WikiLinkTarget')).toBe('map.png');
  });

  it('wins against the CommonMark link parser', () => {
    expect(nodes('[[Mira]](not-a-url)')).toContain('WikiLink');
    expect(nodes('[[Mira]](not-a-url)')).not.toContain('Link');
    expect(nodes('[Mira](note.md)')).toContain('Link');
  });

  it('leaves incomplete and empty links alone', () => {
    expect(nodes('[[Mira')).not.toContain('WikiLink');
    expect(nodes('[[]]')).not.toContain('WikiLink');
    expect(nodes('[[Mira\nand more]]')).not.toContain('WikiLink');
  });

  it('does not reach into code spans', () => {
    expect(nodes('`[[Mira]]`')).not.toContain('WikiLink');
  });
});
