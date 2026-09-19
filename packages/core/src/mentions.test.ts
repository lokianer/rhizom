import { describe, expect, it } from 'vitest';

import { canLinkTo, findMentions, linkMentions, proseSpans } from './mentions.js';
import { parseNote } from './parse.js';
import { createTermMatcher, type VaultTerm } from './terms.js';

function term(surface: string, path = 'Places/Silverstadt.md'): VaultTerm {
  return { surface, path, alias: false, summary: '' };
}

const matcher = createTermMatcher([term('Silverstadt'), term('Grüne Insel')]);

function mentions(markdown: string) {
  return findMentions(markdown, matcher);
}

function texts(markdown: string): string[] {
  return mentions(markdown).map((mention) => mention.text);
}

describe('proseSpans', () => {
  it('covers running text and nothing else', () => {
    const spans = proseSpans('A word and `code` and [a link](x.md).');
    const covered = spans.map((span) =>
      'A word and `code` and [a link](x.md).'.slice(span.start, span.end),
    );
    expect(covered).toEqual(['A word and ', ' and ', '.']);
  });

  it('marks a span inside a heading', () => {
    const spans = proseSpans('## A heading\n\nA paragraph.');
    expect(spans.map((span) => span.inHeading)).toEqual([true, false]);
  });
});

describe('findMentions', () => {
  it('finds a name in ordinary prose, with its line and the line it stands in', () => {
    const source = '# Home\n\nThe road to Silverstadt is long.\n';
    const found = mentions(source);
    expect(source.slice(found[0]?.start ?? 0, found[0]?.end ?? 0)).toBe('Silverstadt');
    expect(found).toEqual([
      {
        target: 'Places/Silverstadt.md',
        line: 3,
        start: 20,
        end: 31,
        text: 'Silverstadt',
        context: 'The road to Silverstadt is long.',
        inHeading: false,
        inTableCell: false,
        linkable: true,
      },
    ]);
  });

  it('ignores a name that already leads somewhere', () => {
    expect(texts('See [[Silverstadt]].')).toEqual([]);
    expect(texts('See [[Places/Silverstadt|Silverstadt]].')).toEqual([]);
    expect(texts('See [Silverstadt](Places/Silverstadt.md).')).toEqual([]);
    expect(texts('See ![[Silverstadt]].')).toEqual([]);
  });

  it('ignores a name inside code', () => {
    expect(texts('Run `Silverstadt --help`.')).toEqual([]);
    expect(texts('```\nSilverstadt\n```\n')).toEqual([]);
    expect(texts('    Silverstadt\n')).toEqual([]);
  });

  it('ignores a name in the frontmatter', () => {
    expect(texts('---\naliases: [Silverstadt]\n---\n\nNothing here.\n')).toEqual([]);
  });

  it('reports a mention in a heading as one, because linking it moves an anchor', () => {
    const found = mentions('## The road to Silverstadt\n');
    expect(found[0]?.inHeading).toBe(true);
  });

  it('reports a mention broken across a line as not linkable', () => {
    const found = mentions('We sailed to the Grüne\nInsel last spring.\n');
    expect(found[0]?.text).toBe('Grüne\nInsel');
    expect(found[0]?.linkable).toBe(false);
  });

  it('counts lines the same way whatever the file ends its lines with', () => {
    const lf = mentions('one\ntwo\nSilverstadt\n');
    const crlf = mentions('one\r\ntwo\r\nSilverstadt\r\n');
    const cr = mentions('one\rtwo\rSilverstadt\r');
    expect([lf[0]?.line, crlf[0]?.line, cr[0]?.line]).toEqual([3, 3, 3]);
  });

  it('never assembles a term out of words with markup between them', () => {
    expect(texts('The Grüne *and* Insel.')).toEqual([]);
  });

  it('has nothing to find without terms', () => {
    expect(findMentions('Silverstadt', createTermMatcher([]))).toEqual([]);
  });
});

describe('linkMentions', () => {
  it('links a mention bare when the words already read like the target', () => {
    const source = 'The road to Silverstadt is long.';
    expect(linkMentions(source, mentions(source), 'Silverstadt')).toBe(
      'The road to [[Silverstadt]] is long.',
    );
  });

  it('keeps the words as the alias when the target is written differently', () => {
    const source = 'The road to Silverstadt is long.';
    expect(linkMentions(source, mentions(source), 'Places/Silverstadt')).toBe(
      'The road to [[Places/Silverstadt|Silverstadt]] is long.',
    );
  });

  it('rewrites every mention in one pass, later ones first', () => {
    const source = 'Silverstadt, and again Silverstadt.';
    expect(linkMentions(source, mentions(source), 'Silverstadt')).toBe(
      '[[Silverstadt]], and again [[Silverstadt]].',
    );
  });

  it('leaves a mention it cannot write a link around', () => {
    const source = 'We sailed to the Grüne\nInsel last spring.';
    expect(linkMentions(source, mentions(source), 'Grüne Insel')).toBe(source);
  });

  it('changes nothing the second time, because the mention is a link by then', () => {
    const source = 'The road to Silverstadt is long.';
    const once = linkMentions(source, mentions(source), 'Silverstadt');
    expect(linkMentions(once, mentions(once), 'Silverstadt')).toBe(once);
  });

  it('keeps the line endings the file had', () => {
    const source = 'one\r\nSilverstadt\r\ntwo\r\n';
    const linked = linkMentions(source, mentions(source), 'Silverstadt');
    expect(linked).toBe('one\r\n[[Silverstadt]]\r\ntwo\r\n');
  });

  it('writes nothing when nothing was asked for', () => {
    expect(linkMentions('Silverstadt', [], 'Silverstadt')).toBe('Silverstadt');
  });

  it('escapes the alias separator inside a table cell, so the row keeps its columns', () => {
    const source = '| a | b | c |\n| --- | --- | --- |\n| x | near Silverstadt | y |\n';
    const linked = linkMentions(source, mentions(source), 'Places/Silverstadt');
    expect(linked).toContain('[[Places/Silverstadt\\|Silverstadt]]');
    // The row still has three cells and the link survives the round trip.
    expect(parseNote(linked, { fallbackTitle: 'T' }).links.map((link) => link.target)).toEqual([
      'Places/Silverstadt',
    ]);
  });

  it('needs no escape in a cell when the words already read like the target', () => {
    const source = '| a |\n| --- |\n| Silverstadt |\n';
    expect(linkMentions(source, mentions(source), 'Silverstadt')).toContain('| [[Silverstadt]] |');
  });

  it('refuses to write a target the wikilink syntax cannot hold', () => {
    const source = 'The road to Silverstadt is long.';
    for (const target of ['Rule #3', 'C#', 'Notes [draft]', 'a|b', '']) {
      expect(canLinkTo(target)).toBe(false);
      expect(linkMentions(source, mentions(source), target)).toBe(source);
    }
    expect(canLinkTo('Places/Silverstadt')).toBe(true);
  });

  it('leaves words already inside square brackets alone', () => {
    const source = 'See [Silverstadt] for the map.';
    expect(mentions(source)[0]?.linkable).toBe(false);
    expect(linkMentions(source, mentions(source), 'Silverstadt')).toBe(source);
  });
});
