import { describe, expect, it } from 'vitest';

import { findTagRefs, isTagName, renamedTag, rewriteTags } from './tagrefs.js';

describe('findTagRefs', () => {
  it('finds a tag and hands back the span without the hash', () => {
    const source = 'The party met #campaign/silverstadt/npcs today.\n';
    const [ref] = findTagRefs(source);
    expect(ref).toBeDefined();
    expect(source.slice(ref?.start, ref?.end)).toBe('campaign/silverstadt/npcs');
    expect(ref?.tag).toBe('campaign/silverstadt/npcs');
    expect(ref?.line).toBe(1);
  });

  it('keeps the spelling the file uses and normalises only the comparison', () => {
    const [ref] = findTagRefs('#Campaign/NPCs\n');
    expect(ref?.written).toBe('Campaign/NPCs');
    expect(ref?.tag).toBe('campaign/npcs');
  });

  it('tells two tags on one line apart', () => {
    const source = '#npc and #npcs are different.\n';
    const refs = findTagRefs(source);
    expect(refs.map((ref) => ref.written)).toEqual(['npc', 'npcs']);
    expect(source.slice(refs[1]?.start, refs[1]?.end)).toBe('npcs');
  });

  it('leaves alone what the indexer does not count as a tag', () => {
    const source = [
      '---',
      'tags: [campaign]',
      '---',
      '',
      'A span `#campaign` and a fence:',
      '',
      '```',
      '#campaign',
      '```',
      '',
      'A link [#campaign](Home.md) and a wikilink [[Home#campaign]].',
      '',
      'An address http://example.com/#campaign and a number #123.',
      '',
      '#campaign',
    ].join('\n');
    expect(findTagRefs(source).map((ref) => ref.line)).toEqual([15]);
  });

  it('drops a span the parser decoded rather than rewriting the wrong characters', () => {
    // The escape is one character in the source and none in the text node, so every offset after
    // it is out by one. The read-back check is what notices.
    const refs = findTagRefs('A \\# and then #campaign.\n');
    expect(refs).toEqual([]);
  });

  it('finds a tag in a list, a heading and a table cell', () => {
    const source = ['# About #one', '', '- #two', '', '| a |', '| --- |', '| #three |'].join('\n');
    expect(findTagRefs(source).map((ref) => ref.tag)).toEqual(['one', 'two', 'three']);
  });
});

describe('renamedTag', () => {
  it('renames the tag itself and every level under it', () => {
    expect(renamedTag('campaign', 'campaign', 'chronicle')).toBe('chronicle');
    expect(renamedTag('campaign/npcs', 'campaign', 'chronicle')).toBe('chronicle/npcs');
  });

  it('does not rename a tag that merely starts with the same letters', () => {
    expect(renamedTag('campaigns', 'campaign', 'chronicle')).toBeUndefined();
    expect(renamedTag('the/campaign', 'campaign', 'chronicle')).toBeUndefined();
  });

  it('compares without case and keeps the levels it was not asked about', () => {
    expect(renamedTag('Campaign/NPCs', 'campaign', 'chronicle')).toBe('chronicle/NPCs');
  });
});

describe('rewriteTags', () => {
  it('applies every edit and leaves the rest of the line alone', () => {
    const source = 'See #npc and #npc/mira.\n';
    const edits = findTagRefs(source)
      .map((ref) => {
        const text = renamedTag(ref.written, 'npc', 'person');
        return text === undefined ? undefined : { start: ref.start, end: ref.end, text };
      })
      .filter((edit) => edit !== undefined);
    expect(rewriteTags(source, edits)).toBe('See #person and #person/mira.\n');
  });

  it('is a no-op without edits', () => {
    expect(rewriteTags('#npc\n', [])).toBe('#npc\n');
  });
});

describe('isTagName', () => {
  it('accepts a tag and a hierarchy', () => {
    expect(isTagName('campaign')).toBe(true);
    expect(isTagName('campaign/silverstadt/npcs')).toBe(true);
    expect(isTagName('über-alles')).toBe(true);
  });

  it('refuses what could not be written as a tag', () => {
    for (const name of ['', '   ', '#campaign', 'two words', 'a//b', '/a', 'a/', '123']) {
      expect(isTagName(name), name).toBe(false);
    }
  });
});
