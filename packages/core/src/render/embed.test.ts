import { describe, expect, it } from 'vitest';

import { renderNoteWithEmbeds, type EmbedLabels, type EmbedSource } from './embed.js';
import { createTermMatcher } from '../vault/terms.js';
import { parseNote } from '../syntax/parse.js';
import type { RenderedLink } from './note.js';

const LABELS: EmbedLabels = {
  loading: (target) => `loading ${target}`,
  missing: (target) => `missing ${target}`,
  noSection: (target, heading) => `no section ${heading} in ${target}`,
  circular: (target) => `circular ${target}`,
  tooDeep: (target) => `too deep ${target}`,
  tooMany: (target) => `too many ${target}`,
};

const VAULT: Record<string, string> = {
  'Templates/NPC.md': '# NPC\n\nA person. See [[Silverstadt]].\n\n## Voice\n\nGruff.',
  'Silverstadt.md': '# Silverstadt\n\nA city.',
  'Loop/A.md': 'Top of A.\n\n![[Loop/B]]',
  'Loop/B.md': 'Top of B.\n\n![[Loop/A]]',
  'Deep/1.md': 'one\n\n![[Deep/2]]',
  'Deep/2.md': 'two\n\n![[Deep/3]]',
  'Deep/3.md': 'three\n\n![[Deep/4]]',
  'Deep/4.md': 'four\n\n![[Deep/5]]',
  'Deep/5.md': 'five',
  'Shared.md': '# Shared\n\n## Detail\n\nA detail.',
  'Home.md': 'The host note, which embeds itself.\n\n![[Home]]',
  'Ledger.md': [
    '# Ledger',
    '',
    'The party went in. ^intro',
    '',
    '- a lantern ^lantern',
    '- a ledger ^ledger',
  ].join('\n'),
  'Quote.md': ['> ![[Quote#^quote]]', '>', '> and round again ^quote'].join('\n'),
};

function readNote(path: string): EmbedSource | undefined {
  const markdown = VAULT[path];
  if (markdown === undefined) {
    return undefined;
  }
  return { markdown, headings: parseNote(markdown, { fallbackTitle: path }).headings };
}

const resolvedSources: string[] = [];

function resolveLink(target: string, _kind: string, source: string): RenderedLink {
  resolvedSources.push(`${source} -> ${target}`);
  const withExtension = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`;
  const direct = Object.keys(VAULT).find((path) => path === withExtension);
  const byName = Object.keys(VAULT).find(
    (path) => path.slice(path.lastIndexOf('/') + 1) === withExtension,
  );
  const path = direct ?? byName ?? null;
  return path === null ? { path: null, href: `/new/${target}` } : { path, href: `/wiki/${path}` };
}

function render(
  markdown: string,
  overrides: Partial<Parameters<typeof renderNoteWithEmbeds>[1]> = {},
): string {
  return renderNoteWithEmbeds(markdown, {
    sourcePath: 'Home.md',
    resolveLink,
    assetUrl: (vaultPath) => `/files/${vaultPath}`,
    readNote,
    labels: LABELS,
    ...overrides,
  }).html;
}

describe('renderNoteWithEmbeds', () => {
  it('renders the whole note in the place of a standalone embed', () => {
    const html = render('Before\n\n![[Templates/NPC]]\n\nAfter');
    expect(html).toContain('<div class="rz-embed" data-state="ready"');
    expect(html).toContain('A person.');
    expect(html).toContain('Gruff.');
    expect(html).toContain('<p>Before</p>');
  });

  it('renders only the addressed section for an embed with a heading', () => {
    const html = render('![[Templates/NPC#Voice]]');
    expect(html).toContain('Gruff.');
    expect(html).not.toContain('A person.');
  });

  it('resolves a transcluded note’s own links against that note, not the host', () => {
    resolvedSources.length = 0;
    render('![[Templates/NPC]]');
    expect(resolvedSources).toContain('Templates/NPC.md -> Silverstadt');
    expect(resolvedSources).not.toContain('Home.md -> Silverstadt');
  });

  it('keeps the reported headings the host’s own', () => {
    const result = renderNoteWithEmbeds('# Home\n\n![[Templates/NPC]]', {
      sourcePath: 'Home.md',
      resolveLink,
      assetUrl: (vaultPath) => `/files/${vaultPath}`,
      readNote,
      labels: LABELS,
    });
    expect(result.headings.map((heading) => heading.text)).toEqual(['Home']);
  });

  it('gives two embeds of one note distinct ids, so no id appears twice', () => {
    const html = render('![[Shared]]\n\n![[Shared]]');
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids).toContain('e1-shared');
    expect(ids).toContain('e2-shared');
  });

  it('renders the same note twice side by side without calling it a cycle', () => {
    const html = render('![[Shared#Detail]]\n\n![[Shared]]');
    expect(html).not.toContain('circular');
    expect(html.match(/data-state="ready"/g)).toHaveLength(2);
  });

  it('stops a note that embeds itself', () => {
    const html = render('![[Home]]', { sourcePath: 'Home.md' });
    expect(html).toContain('circular Home');
    expect(html).not.toContain('missing Home');
  });

  it('stops a cycle between two notes', () => {
    const html = render('![[Loop/A]]');
    expect(html).toContain('Top of A.');
    expect(html).toContain('Top of B.');
    expect(html).toContain('circular Loop/A');
  });

  it('stops at the depth limit', () => {
    const html = render('![[Deep/1]]', { maxDepth: 2 });
    expect(html).toContain('one');
    expect(html).toContain('two');
    expect(html).toContain('too deep Deep/3');
  });

  it('stops at the embed budget', () => {
    const html = render('![[Shared]]\n\n![[Templates/NPC]]', { maxEmbeds: 1 });
    expect(html).toContain('A detail.');
    expect(html).toContain('too many Templates/NPC');
  });

  it('asks for at most the budget, even before any body has arrived', () => {
    const asked: string[] = [];
    const host = Array.from({ length: 20 }, () => '![[Shared]]').join('\n\n');
    render(host, {
      maxEmbeds: 3,
      readNote: (path) => {
        asked.push(path);
        return undefined;
      },
    });
    expect(asked).toHaveLength(3);
  });

  it('reports the notes it asked for and did not get, each once', () => {
    const result = renderNoteWithEmbeds('![[Shared]]\n\n![[Shared]]\n\n![[Templates/NPC]]', {
      sourcePath: 'Home.md',
      resolveLink,
      assetUrl: (vaultPath) => `/files/${vaultPath}`,
      readNote: () => undefined,
      labels: LABELS,
    });
    expect(result.pending).toEqual(['Shared.md', 'Templates/NPC.md']);
  });

  it('has nothing pending once every body is there', () => {
    const result = renderNoteWithEmbeds('![[Shared]]', {
      sourcePath: 'Home.md',
      resolveLink,
      assetUrl: (vaultPath) => `/files/${vaultPath}`,
      readNote,
      labels: LABELS,
    });
    expect(result.pending).toEqual([]);
  });

  it('renders a kept body again when the term list changed under it', () => {
    const source = () => ({ markdown: 'The spring tide floods the cellars.', headings: [] });
    const options = {
      sourcePath: 'Home.md',
      resolveLink: () => ({ path: 'Inner.md', href: '/wiki/Inner.md' }),
      assetUrl: (vaultPath: string) => `/files/${vaultPath}`,
      readNote: source,
      labels: LABELS,
    };
    const before = renderNoteWithEmbeds('![[Inner]]', { ...options, terms: createTermMatcher([]) });
    const after = renderNoteWithEmbeds('![[Inner]]', {
      ...options,
      terms: createTermMatcher([
        { surface: 'spring tide', path: 'Glossary/Spring tide.md', alias: false, summary: 'High.' },
      ]),
    });
    expect(before.html).not.toContain('rz-term');
    expect(after.html).toContain('rz-term');
  });

  it('does not keep a body that was still waiting for a note inside it', () => {
    const outer = 'Outer.\n\n![[Inner]]';
    const inner = 'The inner body.';
    let innerReady = false;
    const reader = (path: string): EmbedSource | undefined => {
      if (path === 'Outer.md') {
        return { markdown: outer, headings: [] };
      }
      if (path === 'Inner.md' && innerReady) {
        return { markdown: inner, headings: [] };
      }
      return undefined;
    };
    const resolve = (target: string): RenderedLink => ({
      path: `${target}.md`,
      href: `/wiki/${target}.md`,
    });

    const options = {
      sourcePath: 'Host.md',
      resolveLink: resolve,
      assetUrl: (vaultPath: string) => `/files/${vaultPath}`,
      readNote: reader,
      labels: LABELS,
    };
    expect(renderNoteWithEmbeds('![[Outer]]', options).html).toContain('loading Inner');
    innerReady = true;
    expect(renderNoteWithEmbeds('![[Outer]]', options).html).toContain('The inner body.');
  });

  it('says a note is missing rather than pretending it is empty', () => {
    expect(render('![[No Such Note]]')).toContain('missing No Such Note');
  });

  it('says which section is missing when the note is there but the heading is not', () => {
    expect(render('![[Templates/NPC#Nowhere]]')).toContain('no section Nowhere in Templates/NPC');
  });

  it('renders only the block an id names, with the marker gone from the text', () => {
    expect(render('![[Ledger#^lantern]]')).toBe(
      '<div class="rz-embed" data-state="ready" data-path="Ledger.md"><ul>\n' +
        '<li id="e1-^lantern">a lantern</li>\n' +
        '</ul></div>',
    );
  });

  it('says which block is missing when the note is there but the id is not', () => {
    expect(render('![[Ledger#^nowhere]]')).toContain('no section ^nowhere in Ledger');
  });

  it('renders two blocks of one note side by side without calling it a cycle', () => {
    const html = render('![[Ledger#^lantern]]\n\n![[Ledger#^ledger]]');
    expect(html).not.toContain('circular');
    expect(html.match(/data-state="ready"/g)).toHaveLength(2);
    expect(html).toContain('a lantern');
    expect(html).toContain('a ledger');
  });

  it('stops a block that embeds itself', () => {
    const html = render('![[Quote#^quote]]');
    expect(html).toContain('and round again');
    expect(html).toContain('circular Quote');
  });

  it('counts a block embed against the page budget like any other', () => {
    const html = render('![[Ledger#^intro]]\n\n![[Ledger#^lantern]]', { maxEmbeds: 1 });
    expect(html).toContain('The party went in.');
    expect(html).toContain('too many Ledger');
  });

  it('waits, visibly, for content the app has not fetched yet', () => {
    const html = render('![[Templates/NPC]]', { readNote: () => undefined });
    expect(html).toContain('loading Templates/NPC');
    expect(html).toContain('data-state="loading"');
  });

  it('shows the alias in a placeholder when the embed carries one', () => {
    expect(render('![[No Such Note|that note]]')).toContain('missing that note');
  });

  it('escapes a target that tries to write markup into its own placeholder', () => {
    const html = render('![[<img src=x onerror=alert(1)>]]');
    expect(html).not.toContain('<img');
    expect(html).toContain('&#x3C;img src=x onerror=alert(1)>');
  });

  it('never lets raw HTML in an embedded note reach the page', () => {
    const reader = (): EmbedSource => ({
      markdown: '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\nplain text',
      headings: [],
    });
    const html = render('![[Shared]]', { readNote: reader });
    expect(html).toContain('plain text');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('leaves an embed inside running text a link', () => {
    const html = render('text ![[Templates/NPC]] more');
    expect(html).toContain('class="rz-wikilink"');
    expect(html).not.toContain('rz-embed');
  });
});
