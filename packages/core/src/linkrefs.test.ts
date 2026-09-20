import { describe, expect, it } from 'vitest';

import { encodeLinkUrl, findLinkRefs, rewriteLinkTargets, type LinkRef } from './linkrefs.js';

/** The one assertion that matters: the span reads back as the target the parser saw. */
function spans(markdown: string): string[] {
  return findLinkRefs(markdown).map((ref) => markdown.slice(ref.targetStart, ref.targetEnd));
}

function only(markdown: string): LinkRef {
  const refs = findLinkRefs(markdown);
  expect(refs).toHaveLength(1);
  return refs[0]!;
}

/** Rewrites every reference found to the same new target. */
function retarget(markdown: string, text: string): string {
  return rewriteLinkTargets(
    markdown,
    findLinkRefs(markdown).map((ref) => ({
      targetStart: ref.targetStart,
      targetEnd: ref.targetEnd,
      text,
    })),
  );
}

describe('findLinkRefs', () => {
  it('spans the target of a wikilink and nothing around it', () => {
    expect(spans('[[Mira]]')).toEqual(['Mira']);
    expect(spans('see [[Mira]] today')).toEqual(['Mira']);
    // The `!` belongs to the node, so the span has to start three characters in, not two.
    expect(spans('![[Mira#Secrets]]')).toEqual(['Mira']);
    expect(spans('[[Mira#^abc12]]')).toEqual(['Mira']);
    expect(spans('[[Mira|her]]')).toEqual(['Mira']);
    // The backslash a table cell needs is outside the span, so the escape survives a rewrite.
    expect(spans('[[Mira\\|her]]')).toEqual(['Mira']);
    // `parseWikilink` trims, so the spacing somebody typed is not part of the name.
    expect(spans('[[  Mira  ]]')).toEqual(['Mira']);
  });

  it('spans the destination of a Markdown link, without its title or fragment', () => {
    expect(spans('[text](People/Mira.md)')).toEqual(['People/Mira.md']);
    expect(spans('[text](People/Mira.md#secrets)')).toEqual(['People/Mira.md']);
    expect(spans('[t](People/Mira.md "The Ledger")')).toEqual(['People/Mira.md']);
    expect(spans('[t](<People/Mira Sedge.md>)')).toEqual(['People/Mira Sedge.md']);
    expect(spans('[](x.md)')).toEqual(['x.md']);
    // The label is skipped through the node's children, so brackets inside it do not confuse it.
    expect(spans('[a [b] c](x.md)')).toEqual(['x.md']);
    expect(spans('[![alt](a.png)](x.md)')).toEqual(['x.md']);
  });

  it('reports what the link says beside its target', () => {
    const wiki = only('## See [[People/Mira#Secrets|her]] first');
    expect(wiki).toMatchObject({
      kind: 'wikilink',
      target: 'People/Mira',
      alias: 'her',
      heading: 'Secrets',
      inHeading: true,
      angled: false,
      line: 1,
      context: '## See [[People/Mira#Secrets|her]] first',
    });
    expect(wiki.written).toBe('People/Mira');

    expect(only('![[Mira#^abc12]]')).toMatchObject({ kind: 'embed', blockId: 'abc12' });
    expect(only('[t](<a.md>)')).toMatchObject({ kind: 'markdown', angled: true, alias: 't' });
    expect(only('a\n\n[t](Mira.md)')).toMatchObject({ line: 3, context: '[t](Mira.md)' });
  });

  it('decodes a Markdown target but hands back the bytes that stand in the file', () => {
    const ref = only('[t](Garten/%F0%9F%8C%B1%20%C3%9Cber.md)');
    expect(ref.written).toBe('Garten/%F0%9F%8C%B1%20%C3%9Cber.md');
    expect(ref.target).toBe('Garten/🌱 Über.md');
  });

  it('leaves alone what it cannot see', () => {
    expect(findLinkRefs('`[[Mira]]`')).toEqual([]);
    expect(findLinkRefs('```\n[[Mira]]\n[t](Mira.md)\n```')).toEqual([]);
    expect(findLinkRefs('~~~\n[[Mira]]\n~~~')).toEqual([]);
    expect(findLinkRefs('    [[Mira]]')).toEqual([]);
    expect(findLinkRefs('[ref]: People/Mira.md')).toEqual([]);
    expect(findLinkRefs('see [ref]\n\n[ref]: People/Mira.md')).toEqual([]);
    expect(findLinkRefs('<a href="People/Mira.md">Mira</a>')).toEqual([]);
    expect(findLinkRefs('<!-- [[Mira]] -->')).toEqual([]);
    expect(findLinkRefs('---\naliases: [Mira]\nlink: "[[Mira]]"\n---\n')).toEqual([]);
  });

  it('leaves alone what is not a note in this vault', () => {
    expect(findLinkRefs('[t](https://example.com/Mira.md)')).toEqual([]);
    expect(findLinkRefs('[t](//example.com/Mira.md)')).toEqual([]);
    expect(findLinkRefs('[t](#a-heading)')).toEqual([]);
    // Without an extension a URL is not recorded as a link to a note, here or in the index.
    expect(findLinkRefs('[t](People/Mira)')).toEqual([]);
    // An image's target is an asset, and assets are not renamed by this.
    expect(findLinkRefs('![alt](assets/map.png)')).toEqual([]);
    // A link into the note itself names nothing that could be renamed.
    expect(findLinkRefs('[[#Secrets]]')).toEqual([]);
  });

  it('finds a wikilink in a table cell, escape and all', () => {
    const source = '| a | b |\n| --- | --- |\n| [[Mira\\|her]] | x |';
    expect(spans(source)).toEqual(['Mira']);
    expect(only(source).alias).toBe('her');
  });
});

describe('rewriteLinkTargets', () => {
  it('changes the target and nothing else on the line', () => {
    expect(retarget('[t](People/Mira.md "The Ledger")', 'People/Wurzeln.md')).toBe(
      '[t](People/Wurzeln.md "The Ledger")',
    );
    expect(retarget('| [[Mira\\|her]] |', 'Wurzeln')).toBe('| [[Wurzeln\\|her]] |');
    expect(retarget('![[Mira#Secrets]]', 'Wurzeln')).toBe('![[Wurzeln#Secrets]]');
    expect(retarget('[[  Mira  ]]', 'Wurzeln')).toBe('[[  Wurzeln  ]]');
    expect(retarget('[t](<People/Mira Sedge.md>)', 'P/Mira Sedge.md')).toBe(
      '[t](<P/Mira Sedge.md>)',
    );
  });

  it('still parses to the same link afterwards', () => {
    const rewritten = retarget('| [[Mira\\|her]] |\n| --- |\n| x |', 'Garten/Wurzeln');
    const refs = findLinkRefs(rewritten);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ target: 'Garten/Wurzeln', alias: 'her' });
  });

  it('rewrites several references on one line back to front', () => {
    const source = 'Both [[Mira]] and [t](Mira.md) and [[Mira|her]] again.';
    expect(retarget(source, 'Wurzeln')).toBe(
      'Both [[Wurzeln]] and [t](Wurzeln) and [[Wurzeln|her]] again.',
    );
    // A replacement longer than what it replaces must not shift the ones still to come.
    expect(retarget('[[A]] [[A]] [[A]]', 'A much longer name')).toBe(
      '[[A much longer name]] [[A much longer name]] [[A much longer name]]',
    );
  });

  it('carries a name made of emoji through unharmed', () => {
    const source = 'Family 👨‍👩‍👧 keeps [[Mira 🌿]] and 🇩🇪 close.';
    expect(spans(source)).toEqual(['Mira 🌿']);
    expect(retarget(source, 'Wurzeln 👨‍👩‍👧')).toBe('Family 👨‍👩‍👧 keeps [[Wurzeln 👨‍👩‍👧]] and 🇩🇪 close.');
  });

  it('treats a spelling that differs only by a variation selector as a different name', () => {
    // U+FE0F makes ❤ a coloured emoji and a different string; the resolver never equates them,
    // so a rename between the two is a real rewrite rather than a no-op.
    const source = '[[Heart ❤]]';
    expect(only(source).target).toBe('Heart ❤');
    expect(retarget(source, 'Heart ❤️')).toBe('[[Heart ❤️]]');
  });

  it('drops an edit that overlaps one already applied', () => {
    // Overlapping edits are a caller's mistake; the one nearer the end of the file is written
    // first and keeps the ground, so the result is never two edits half-applied over each other.
    expect(
      rewriteLinkTargets('[[Mira]]', [
        { targetStart: 2, targetEnd: 6, text: 'Whole' },
        { targetStart: 4, targetEnd: 6, text: 'End' },
      ]),
    ).toBe('[[MiEnd]]');
  });
});

describe('encodeLinkUrl', () => {
  it('encodes each segment and keeps the separators', () => {
    expect(encodeLinkUrl('People/Mira Sedge.md')).toBe('People/Mira%20Sedge.md');
    expect(encodeLinkUrl('Garten/🌱 Über.md')).toBe('Garten/%F0%9F%8C%B1%20%C3%9Cber.md');
  });

  it('encodes round brackets, which would end the destination early', () => {
    expect(encodeLinkUrl('Notes/Mira (2).md')).toBe('Notes/Mira%20%282%29.md');
    expect(findLinkRefs(`[t](${encodeLinkUrl('Notes/Mira (2).md')})`)[0]?.target).toBe(
      'Notes/Mira (2).md',
    );
  });
});
