import { describe, expect, it } from 'vitest';

import { parseNote } from './parse.js';

const NOTE = `---
title: Mira the Ledger-Keeper
tags: [npc, Campaign/Silverstadt]
aliases:
  - Mira
  - The Ledger
type: npc
---
# Mira

Mira keeps the ledger of [[Silverstadt]] and works for the [[Factions/Harbour Guild|guild]].
See [[Session 12 – The Sunken Archive#Loot]] and [[Archive#^blk1]].

![[tavern.png]] and ![[Templates/NPC]]

A standard [link](Campaign/Places/Sunken%20Archive.md) and an [external](https://example.com) one.
![map](assets/silverstadt-map.svg)

Inline #tags/here and #tag_two, but \`#not-a-tag\` and #campaign again.

\`\`\`md
#also-not-a-tag [[NotALink]]
\`\`\`

## Loot

- [ ] open task #todo
- [x] done

## Loot
`;

describe('parseNote', () => {
  const note = parseNote(NOTE, { fallbackTitle: 'Mira' });

  it('takes the title from frontmatter, then the first level-1 heading, then the fallback', () => {
    expect(note.title).toBe('Mira the Ledger-Keeper');
    expect(parseNote('# Heading Title\n\ntext', { fallbackTitle: 'File' }).title).toBe(
      'Heading Title',
    );
    expect(parseNote('just text', { fallbackTitle: 'File' }).title).toBe('File');
  });

  it('exposes the frontmatter and its aliases', () => {
    expect(note.frontmatter).toMatchObject({ type: 'npc', title: 'Mira the Ledger-Keeper' });
    expect(note.aliases).toEqual(['Mira', 'The Ledger']);
    expect(note.frontmatterError).toBeUndefined();
  });

  it('collects frontmatter and inline tags, lower-cased and unique, ignoring code', () => {
    expect(note.tags).toEqual([
      'npc',
      'campaign/silverstadt',
      'tags/here',
      'tag_two',
      'campaign',
      'todo',
    ]);
  });

  it('finds wikilinks with their parts and line numbers', () => {
    const wikilinks = note.links.filter((l) => l.kind === 'wikilink');
    expect(wikilinks).toEqual([
      { kind: 'wikilink', raw: 'Silverstadt', target: 'Silverstadt', line: 11 },
      {
        kind: 'wikilink',
        raw: 'Factions/Harbour Guild|guild',
        target: 'Factions/Harbour Guild',
        alias: 'guild',
        line: 11,
      },
      {
        kind: 'wikilink',
        raw: 'Session 12 – The Sunken Archive#Loot',
        target: 'Session 12 – The Sunken Archive',
        heading: 'Loot',
        line: 12,
      },
      { kind: 'wikilink', raw: 'Archive#^blk1', target: 'Archive', blockId: 'blk1', line: 12 },
    ]);
  });

  it('finds embeds of notes and files, including standard image syntax', () => {
    const embeds = note.links.filter((l) => l.kind === 'embed').map((l) => l.target);
    expect(embeds).toEqual(['tavern.png', 'Templates/NPC', 'assets/silverstadt-map.svg']);
  });

  it('treats relative Markdown links to .md files as links and skips external URLs', () => {
    const markdownLinks = note.links.filter((l) => l.kind === 'markdown');
    expect(markdownLinks).toEqual([
      {
        kind: 'markdown',
        raw: 'Campaign/Places/Sunken%20Archive.md',
        target: 'Campaign/Places/Sunken Archive.md',
        alias: 'link',
        line: 16,
      },
    ]);
    // The external link in the fixture is not a link into the vault, so it is not listed at all.
    expect(note.links.every((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target))).toBe(true);
    expect(note.links.some((l) => l.target === 'NotALink')).toBe(false);
  });

  it('lists headings with unique slugs and line numbers', () => {
    expect(note.headings).toEqual([
      { level: 1, text: 'Mira', slug: 'mira', line: 9 },
      { level: 2, text: 'Loot', slug: 'loot', line: 25 },
      { level: 2, text: 'Loot', slug: 'loot-1', line: 30 },
    ]);
  });

  it('produces plain text for search without frontmatter or syntax, and a word count', () => {
    expect(note.text).toContain('Mira keeps the ledger of Silverstadt and works for the guild.');
    expect(note.text).toContain('open task');
    expect(note.text).not.toContain('title:');
    expect(note.text).not.toContain('[[Silverstadt]]');
    expect(note.text).not.toContain('```');
    expect(note.wordCount).toBeGreaterThan(30);
  });

  it('gives a hard-wrapped paragraph one line, so a block really is a line', () => {
    const wrapped = parseNote(
      '# T\n\nThe higher tide that follows\na full moon.\n\nSecond block.',
      {
        fallbackTitle: 'F',
      },
    );
    expect(wrapped.text.split('\n')).toEqual([
      'T',
      'The higher tide that follows a full moon.',
      'Second block.',
    ]);
  });
});

describe('parseNote edge cases', () => {
  it('survives invalid YAML frontmatter and reports it', () => {
    const note = parseNote('---\ntitle: "unclosed\n---\n# Fallback Heading\n', {
      fallbackTitle: 'F',
    });
    expect(note.frontmatter).toEqual({});
    expect(note.frontmatterError).toBeDefined();
    expect(note.title).toBe('Fallback Heading');
  });

  it('ignores frontmatter that is not a mapping', () => {
    expect(parseNote('---\n- a\n- b\n---\ntext', { fallbackTitle: 'F' }).frontmatter).toEqual({});
  });

  it('accepts tags as a comma or space separated string, with or without #', () => {
    expect(parseNote('---\ntags: "#a, b  c"\n---\n', { fallbackTitle: 'F' }).tags).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(parseNote('---\ntag: solo\n---\n', { fallbackTitle: 'F' }).tags).toEqual(['solo']);
  });

  it('returns empty results for an empty document', () => {
    expect(parseNote('', { fallbackTitle: 'Empty' })).toEqual({
      title: 'Empty',
      frontmatter: {},
      aliases: [],
      tags: [],
      links: [],
      headings: [],
      text: '',
      wordCount: 0,
    });
  });

  it('handles CRLF input and a wikilink at the very start of the document', () => {
    const note = parseNote('[[Start]] here\r\n\r\n## Two\r\n', { fallbackTitle: 'F' });
    expect(note.links[0]).toMatchObject({ target: 'Start', line: 1 });
    expect(note.headings[0]).toMatchObject({ text: 'Two', line: 3 });
  });

  it('does not treat escaped brackets, numbers-only tags or URL fragments as links or tags', () => {
    const note = parseNote('\\[\\[not a link\\]\\] and #123 and https://x.test/page#frag', {
      fallbackTitle: 'F',
    });
    expect(note.links).toEqual([]);
    expect(note.tags).toEqual([]);
  });

  it('keeps a wikilink that contains spaces inside the brackets', () => {
    expect(parseNote('[[ Silverstadt ]]', { fallbackTitle: 'F' }).links[0]?.target).toBe(
      'Silverstadt',
    );
  });

  it('does not span wikilinks across lines', () => {
    expect(parseNote('[[not\nclosed]]', { fallbackTitle: 'F' }).links).toEqual([]);
  });
});
