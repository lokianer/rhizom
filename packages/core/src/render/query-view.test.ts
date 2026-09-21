import { describe, expect, it } from 'vitest';

import type { QueryResult, QueryRow } from '../api.js';
import { renderNoteWithEmbeds, type EmbedLabels } from './embed.js';
import { BUILT_IN_COLUMNS } from '../query/language.js';
import { renderQueryResult, type QueryLabels, type QueryLinks } from './query-view.js';
import { renderNote, type RenderedLink } from './note.js';

const LABELS: QueryLabels = {
  empty: 'nothing matches',
  loading: 'running …',
  problem: (line, message) => (line === 0 ? message : `line ${String(line)}: ${message}`),
  more: (shown, total) => `${String(shown)} of ${String(total)}`,
  columns: {
    title: 'Title',
    path: 'Path',
    folder: 'Folder',
    tags: 'Tags',
    modified: 'Modified',
    size: 'Size',
  },
};

const LINKS: QueryLinks = {
  sourcePath: 'Home.md',
  resolveLink: (target) => ({ path: target, href: `/wiki/${target}` }),
};

const EMBED_LABELS: EmbedLabels = {
  loading: (target) => `loading ${target}`,
  missing: (target) => `missing ${target}`,
  noSection: (target, heading) => `no section ${heading} in ${target}`,
  circular: (target) => `circular ${target}`,
  tooDeep: (target) => `too deep ${target}`,
  tooMany: (target) => `too many ${target}`,
};

function row(overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    path: 'Campaign/NPCs/Mira.md',
    title: 'Mira',
    folder: 'Campaign/NPCs',
    tags: ['campaign/npcs'],
    modifiedAt: '2026-01-02T03:04:05.000Z',
    size: 1234,
    fields: {},
    ...overrides,
  };
}

function result(overrides: Partial<QueryResult> = {}): QueryResult {
  return { rows: [row()], total: 1, view: 'list', columns: [], problems: [], ...overrides };
}

function render(overrides: Partial<QueryResult> = {}, links: QueryLinks = LINKS): string {
  return renderQueryResult(result(overrides), LABELS, links);
}

describe('renderQueryResult', () => {
  it('draws a list as note links', () => {
    expect(render()).toBe(
      '<ul class="rz-query-list">' +
        '<li><a class="rz-wikilink" href="/wiki/Campaign/NPCs/Mira.md">Mira</a></li>' +
        '</ul>',
    );
  });

  it('draws a table with the columns the query named', () => {
    const html = render({
      view: 'table',
      columns: ['title', 'folder', 'tags', 'modified', 'size', 'status'],
      rows: [row({ fields: { status: 'done' } })],
    });
    expect(html).toContain(
      '<thead><tr><th scope="col">Title</th><th scope="col">Folder</th>' +
        '<th scope="col">Tags</th><th scope="col">Modified</th><th scope="col">Size</th>' +
        // A column the built-in list does not know is a frontmatter key, shown as it was written.
        '<th scope="col">status</th></tr></thead>',
    );
    expect(html).toContain(
      '<td><a class="rz-wikilink" href="/wiki/Campaign/NPCs/Mira.md">Mira</a>',
    );
    expect(html).toContain('<td>Campaign/NPCs</td>');
    expect(html).toContain('<td><span class="rz-query-tag">#campaign/npcs</span></td>');
    // The day out of the timestamp, the size in SI units, the field as the server rendered it.
    expect(html).toContain('<td><span class="rz-query-date">2026-01-02</span></td>');
    expect(html).toContain('<td><span class="rz-query-date">1.2 kB</span></td>');
    expect(html).toContain('<td>done</td>');
  });

  it('falls back to a title and a date when a table names no columns', () => {
    const html = render({ view: 'table' });
    expect(html).toContain('<th scope="col">Title</th><th scope="col">Modified</th>');
  });

  it('links a path column too, and leaves an unknown field empty', () => {
    const html = render({ view: 'table', columns: ['path', 'nothing'] });
    expect(html).toContain('<td><a class="rz-wikilink" href="/wiki/Campaign/NPCs/Mira.md">');
    expect(html).toContain('<td></td>');
  });

  it('draws cards with the title, the folder, the tags and the date', () => {
    const html = render({ view: 'cards', rows: [row({ tags: ['a', 'b'] })] });
    expect(html).toContain('<ul class="rz-query-cards"><li class="rz-query-card">');
    expect(html).toContain('<span class="rz-query-folder">Campaign/NPCs</span>');
    expect(html).toContain(
      '<span class="rz-query-tag">#a</span><span class="rz-query-tag">#b</span>',
    );
    expect(html).toContain('<span class="rz-query-date">2026-01-02</span>');
  });

  it('leaves the folder out of a card for a note at the vault root', () => {
    const html = render({ view: 'cards', rows: [row({ folder: '', path: 'Home.md' })] });
    expect(html).not.toContain('rz-query-folder');
  });

  it('says so when nothing matched, and says nothing of the sort when the block was misread', () => {
    expect(render({ rows: [], total: 0 })).toBe('<p class="rz-query-empty">nothing matches</p>');
    // With a complaint on screen, "nothing matches" would be an answer to a question the block
    // never managed to ask.
    expect(render({ rows: [], total: 0, problems: [{ line: 2, message: 'nope' }] })).toBe(
      '<ul class="rz-query-problems"><li>line 2: nope</li></ul>',
    );
  });

  it('names the line of every problem, and the whole body when there is no line', () => {
    const html = render({
      problems: [
        { line: 3, message: '`sort: sideways` is not an order.' },
        { line: 0, message: 'A query is written as `key: value` lines.' },
      ],
    });
    expect(html).toContain(
      '<ul class="rz-query-problems">' +
        '<li>line 3: `sort: sideways` is not an order.</li>' +
        '<li>A query is written as `key: value` lines.</li>' +
        '</ul>',
    );
  });

  it('says how much of the answer is on screen when the limit cut it short', () => {
    expect(render({ total: 42 })).toContain('<p class="rz-query-more">1 of 42</p>');
    expect(render()).not.toContain('rz-query-more');
  });

  it('marks a row whose note the vault no longer holds', () => {
    const html = render(
      {},
      { sourcePath: 'Home.md', resolveLink: () => ({ path: null, href: '' }) },
    );
    expect(html).toContain(
      '<a class="rz-wikilink rz-wikilink-missing" data-target="Campaign/NPCs/Mira.md" href="">',
    );
  });

  it('keeps a size readable as it grows, and a timestamp that is not one as it stands', () => {
    const sizes = render({
      view: 'table',
      columns: ['size'],
      rows: [row({ size: 0 }), row({ size: 999 }), row({ size: 2_500_000 }), row({ size: 4e12 })],
    });
    expect(sizes).toContain('<td><span class="rz-query-date">0 B</span></td>');
    expect(sizes).toContain('<td><span class="rz-query-date">999 B</span></td>');
    expect(sizes).toContain('<td><span class="rz-query-date">2.5 MB</span></td>');
    expect(sizes).toContain('<td><span class="rz-query-date">4000.0 GB</span></td>');
    expect(
      render({ view: 'table', columns: ['modified'], rows: [row({ modifiedAt: 'never' })] }),
    ).toContain('<td><span class="rz-query-date">never</span></td>');
  });

  it('shows the path when a note has no title to show', () => {
    expect(render({ rows: [row({ title: '' })] })).toContain('>Campaign/NPCs/Mira.md</a>');
  });

  it('has a heading for every built-in column', () => {
    // The labels are a closed set, so a column added to the parser has to be given a word here.
    expect(Object.keys(LABELS.columns).toSorted()).toEqual([...BUILT_IN_COLUMNS].toSorted());
  });
});

describe('renderQueryResult escaping', () => {
  it('writes a title that is markup as the text it is', () => {
    const html = render({ rows: [row({ title: '<script>alert(1)</script>' })] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>');
  });

  it('cannot let a tag break out of its element', () => {
    const html = render({ view: 'cards', rows: [row({ tags: ['a" onmouseover=x'] })] });
    // The quote is inert because a tag is only ever a text node: it opens no attribute, and the
    // span it sits in carries the one class this renderer gave it.
    expect(html).toContain('<span class="rz-query-tag">#a" onmouseover=x</span>');
    expect(html).not.toContain('rz-query-tag" ');
  });

  it('writes a frontmatter field that is markup as the text it is', () => {
    const html = render({
      view: 'table',
      columns: ['weapon'],
      rows: [row({ fields: { weapon: '<img src=x onerror="alert(1)">' } })],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('<td>&#x3C;img src=x onerror="alert(1)"></td>');
  });

  it('escapes a path that would close an attribute', () => {
    const html = render({ rows: [row({ path: 'Weird "note".md', title: 'Weird' })] });
    expect(html).toContain('href="/wiki/Weird &#x22;note&#x22;.md"');
  });
});

describe('a rhizom-query fence in a note', () => {
  const MARKDOWN = ['Before', '', '```rhizom-query', 'from: Campaign', '```', '', 'After'].join(
    '\n',
  );

  function renderPage(overrides: Record<string, unknown> = {}) {
    return renderNoteWithEmbeds(MARKDOWN, {
      sourcePath: 'Home.md',
      resolveLink: (target): RenderedLink => ({ path: null, href: `/new/${target}` }),
      assetUrl: (vaultPath) => `/files/${vaultPath}`,
      readNote: () => undefined,
      labels: EMBED_LABELS,
      queryLoading: 'running …',
      ...overrides,
    });
  }

  it('waits for an answer and says what it is waiting for', () => {
    const rendered = renderPage();
    expect(rendered.pendingQueries).toEqual(['from: Campaign']);
    expect(rendered.html).toContain('<div class="rz-query" data-state="loading">running …</div>');
  });

  it('puts the answer in the block once it arrives', () => {
    const rendered = renderPage({
      renderQuery: (body: string) =>
        `<ul class="rz-query-list"><li>${body.length.toString()}</li></ul>`,
    });
    expect(rendered.pendingQueries).toEqual([]);
    expect(rendered.html).toContain(
      '<div class="rz-query" data-state="ready"><ul class="rz-query-list"><li>14</li></ul></div>',
    );
    expect(rendered.html).not.toContain('data-embed');
  });

  it('leaves the fence a code block for a renderer that answers no questions', () => {
    const html = renderNote(MARKDOWN, {
      sourcePath: 'Home.md',
      resolveLink: (target): RenderedLink => ({ path: null, href: `/new/${target}` }),
      assetUrl: (vaultPath) => `/files/${vaultPath}`,
    }).html;
    expect(html).toContain('<pre><code class="language-rhizom-query">from: Campaign');
  });
});
