import { describe, expect, it } from 'vitest';

import { parseNote } from './parse.js';
import { createTermMatcher } from './terms.js';
import { renderNote, type RenderOptions, type RenderedLink } from './render.js';

const VAULT = new Set(['Silverstadt.md', 'Factions/Harbour Guild.md', 'Templates/NPC.md']);

function resolveLink(target: string): RenderedLink {
  const withExtension = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`;
  if (VAULT.has(withExtension)) {
    return { path: withExtension, href: `/wiki/${withExtension}` };
  }
  return { path: null, href: `/new/${target}` };
}

const ready = (html: string) => ({ state: 'ready', html }) as const;

const matcher = createTermMatcher([
  {
    surface: 'spring tide',
    path: 'Glossary/Spring tide.md',
    alias: false,
    summary: 'The higher tide.',
  },
  {
    surface: 'spring tides',
    path: 'Glossary/Spring tide.md',
    alias: true,
    summary: 'The higher tide.',
  },
]);

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    sourcePath: 'Home.md',
    resolveLink,
    assetUrl: (vaultPath) => `/files/${vaultPath}`,
    ...overrides,
  };
}

function render(markdown: string, overrides: Partial<RenderOptions> = {}): string {
  return renderNote(markdown, options(overrides)).html;
}

describe('renderNote: wikilinks', () => {
  it('renders a resolved link with the target as its text', () => {
    expect(render('See [[Silverstadt]].')).toBe(
      '<p>See <a href="/wiki/Silverstadt.md" class="rz-wikilink">Silverstadt</a>.</p>',
    );
  });

  it('marks an unresolved link and keeps the raw target for creating the note', () => {
    expect(render('See [[New Note]].')).toBe(
      '<p>See <a href="/new/New%20Note" class="rz-wikilink rz-wikilink-missing" ' +
        'data-target="New Note">New Note</a>.</p>',
    );
  });

  it('shows the alias, also when the resolver offers a label', () => {
    const label = (): RenderedLink => ({ path: 'Silverstadt.md', href: '/w', label: 'The City' });
    expect(render('[[Silverstadt|the city]]')).toContain('>the city</a>');
    expect(render('[[Silverstadt|the city]]', { resolveLink: label })).toContain('>the city</a>');
    expect(render('[[Silverstadt]]', { resolveLink: label })).toContain('>The City</a>');
  });

  it('turns a heading reference into a fragment slugged like the heading id', () => {
    const html = render('[[Silverstadt#The Docks]]\n\n## The Docks');
    expect(html).toContain('href="/wiki/Silverstadt.md#the-docks"');
    expect(html).toContain('<h2 id="the-docks">The Docks</h2>');
  });

  it('keeps a block reference in the visible text', () => {
    expect(render('[[Silverstadt#^blk1]]')).toContain('>Silverstadt#^blk1</a>');
  });

  it('resolves a link into the same note', () => {
    expect(render('[[#Loot]]')).toContain('data-target=""');
  });

  it('links folder paths and passes the folder path to the resolver', () => {
    const seen: string[] = [];
    render('[[Factions/Harbour Guild|guild]]', {
      resolveLink: (target) => {
        seen.push(target);
        return resolveLink(target);
      },
    });
    expect(seen).toEqual(['Factions/Harbour Guild']);
  });
});

describe('renderNote: embeds', () => {
  it('renders an image embed through assetUrl', () => {
    expect(render('![[assets/tavern.png]]')).toBe(
      '<p><img src="/files/assets/tavern.png" alt="assets/tavern.png"></p>',
    );
  });

  it('reads Obsidian embed sizes and keeps a real alias as the alt text', () => {
    expect(render('![[tavern.png|320x200]]')).toContain('width="320" height="200"');
    expect(render('![[tavern.png|320]]')).toContain('width="320"');
    expect(render('![[tavern.png|320]]')).not.toContain('height=');
    expect(render('![[tavern.png|A tavern]]')).toContain('alt="A tavern"');
  });

  it('links other vault files instead of embedding them', () => {
    expect(render('![[Handouts/Map.pdf]]')).toBe(
      '<p><a href="/files/Handouts/Map.pdf" class="rz-embed-file">Handouts/Map.pdf</a></p>',
    );
  });

  it('replaces a standalone note embed with the rendered body', () => {
    const html = render('Before\n\n![[Templates/NPC]]\n\nAfter', {
      renderEmbed: (reference) => ready(`<p>body of ${reference.path ?? ''}</p>`),
    });
    expect(html).toContain(
      '<div class="rz-embed" data-state="ready" data-path="Templates/NPC.md">' +
        '<p>body of Templates/NPC.md</p></div>',
    );
    expect(html).not.toContain('data-embed');
  });

  it('hands the embed hook the heading and alias that were written', () => {
    const seen: unknown[] = [];
    render('![[Templates/NPC#Voice|the voice]]', {
      renderEmbed: (reference) => {
        seen.push(reference);
        return ready('<p>x</p>');
      },
    });
    expect(seen).toEqual([
      { path: 'Templates/NPC.md', target: 'Templates/NPC', heading: 'Voice', alias: 'the voice' },
    ]);
  });

  it('shows a labelled block when the hook has no body to give', () => {
    for (const state of ['loading', 'missing', 'circular', 'truncated'] as const) {
      expect(
        render('![[Templates/NPC]]', { renderEmbed: () => ({ state, label: `${state} here` }) }),
      ).toBe(
        `<div class="rz-embed" data-state="${state}" data-path="Templates/NPC.md">${state} here</div>`,
      );
    }
  });

  it('offers an embed of a note that does not exist, so the app can say so', () => {
    expect(
      render('![[No Such Note]]', {
        renderEmbed: (reference) => ({ state: 'missing', label: `no ${reference.target}` }),
      }),
    ).toBe('<div class="rz-embed" data-state="missing">no No Such Note</div>');
  });

  it('falls back to a link without a renderer, when the renderer declines or inline', () => {
    expect(render('![[Templates/NPC]]')).toBe(
      '<p><a href="/wiki/Templates/NPC.md" class="rz-wikilink">Templates/NPC</a></p>',
    );
    expect(render('![[Templates/NPC]]', { renderEmbed: () => undefined })).toContain(
      '<a href="/wiki/Templates/NPC.md" class="rz-wikilink">',
    );
    expect(render('text ![[Templates/NPC]]', { renderEmbed: () => ready('<p>x</p>') })).toBe(
      '<p>text <a href="/wiki/Templates/NPC.md" class="rz-wikilink">Templates/NPC</a></p>',
    );
  });

  it('treats a note name with a dot as a note, not as a file', () => {
    expect(render('![[v1.2 draft]]')).toContain('class="rz-wikilink rz-wikilink-missing"');
  });

  it('never embeds a plain link that stands on its own line', () => {
    expect(render('[[Templates/NPC]]', { renderEmbed: () => ready('<p>x</p>') })).toBe(
      '<p><a href="/wiki/Templates/NPC.md" class="rz-wikilink">Templates/NPC</a></p>',
    );
  });
});

describe('renderNote: terms', () => {
  it('marks a term the vault defines where it stands in prose', () => {
    const html = render('The spring tides flood the cellars.', { terms: matcher });
    expect(html).toBe(
      '<p>The <span class="rz-term" data-term="Glossary/Spring tide.md" ' +
        'title="The higher tide.">spring tides</span> flood the cellars.</p>',
    );
  });

  it('keeps the class and the data attribute through the sanitiser', () => {
    const html = render('A spring tide.', { terms: matcher });
    expect(html).toContain('class="rz-term"');
    expect(html).toContain('data-term="Glossary/Spring tide.md"');
  });

  it('leaves a term alone inside code, a link or a wikilink', () => {
    expect(render('`spring tide`', { terms: matcher })).not.toContain('rz-term');
    expect(render('```\nspring tide\n```', { terms: matcher })).not.toContain('rz-term');
    expect(render('[spring tide](https://example.com)', { terms: matcher })).not.toContain(
      'rz-term',
    );
    expect(render('[[spring tide]]', { terms: matcher })).not.toContain('rz-term');
  });

  it('does not mark a term inside the note that defines it', () => {
    const html = render('A spring tide floods the cellars.', {
      terms: matcher,
      sourcePath: 'Glossary/Spring tide.md',
    });
    expect(html).not.toContain('rz-term');
  });

  it('leaves the title off when the defining note says nothing but its name', () => {
    const bare = createTermMatcher([
      { surface: 'Insel', path: 'Glossary/Insel.md', alias: false, summary: '' },
    ]);
    expect(render('The Insel.', { terms: bare })).toBe(
      '<p>The <span class="rz-term" data-term="Glossary/Insel.md">Insel</span>.</p>',
    );
  });

  it('marks every occurrence in one paragraph, and inside a heading too', () => {
    const html = render('## A spring tide\n\nOne spring tide, then another spring tide.', {
      terms: matcher,
    });
    expect(html.match(/class="rz-term"/g)).toHaveLength(3);
  });
});

describe('renderNote: Markdown links and images', () => {
  it('routes a relative Markdown note link like a wikilink', () => {
    expect(render('[the city](Silverstadt.md#The%20Docks)')).toBe(
      '<p><a href="/wiki/Silverstadt.md#the-docks" class="rz-wikilink">the city</a></p>',
    );
    expect(render('[soon](Notes/Later.md)')).toContain(
      'rz-wikilink-missing" data-target="Notes/Later.md"',
    );
  });

  it('leaves external links and non-note targets alone', () => {
    expect(render('[home](https://example.com)')).toBe(
      '<p><a href="https://example.com">home</a></p>',
    );
    expect(render('[anchor](#loot)')).toBe('<p><a href="#loot">anchor</a></p>');
    // A broken escape is kept as written instead of throwing.
    expect(render('[half](Silverstadt%zz.md)')).toContain('data-target="Silverstadt%zz.md"');
    expect(render('[sheet](Handouts/Map.pdf)')).toBe('<p><a href="Handouts/Map.pdf">sheet</a></p>');
  });

  it('sends a relative Markdown image through assetUrl, decoded', () => {
    const seen: string[] = [];
    const html = render('![map](assets/silverstadt%20map.svg)', {
      assetUrl: (vaultPath) => {
        seen.push(vaultPath);
        return `/files/${vaultPath}`;
      },
    });
    expect(seen).toEqual(['assets/silverstadt map.svg']);
    // The URL is percent-encoded again on the way into the HTML.
    expect(html).toBe('<p><img src="/files/assets/silverstadt%20map.svg" alt="map"></p>');
    expect(render('![remote](https://example.com/a.png)')).toContain(
      'src="https://example.com/a.png"',
    );
  });
});

describe('renderNote: Markdown dialect', () => {
  it('keeps GFM tables, task lists, strikethrough and autolinks', () => {
    const html = render(
      '| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] open\n- [x] done\n\n~~gone~~ https://example.com',
    );
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).toContain('<input type="checkbox" checked disabled>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<a href="https://example.com">https://example.com</a>');
  });

  it('keeps footnote anchors pointing at their definitions', () => {
    const html = render('Text[^1]\n\n[^1]: The note.');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('<li id="user-content-fn-1">');
    expect(html).toContain('id="footnote-label"');
    expect(html).not.toContain('user-content-user-content');
  });

  it('never renders the frontmatter', () => {
    const html = render('---\ntitle: Mira\nsecret: hidden\n---\n\n# Mira\n');
    expect(html).toBe('<h1 id="mira">Mira</h1>');
  });

  it('leaves wikilink syntax inside code untouched', () => {
    const html = render('`[[Silverstadt]]`\n\n```md\n[[Silverstadt]]\n```\n');
    expect(html).toContain('<code>[[Silverstadt]]</code>');
    expect(html).toContain('<code class="language-md">[[Silverstadt]]\n</code>');
    expect(html).not.toContain('rz-wikilink');
  });

  it('is deterministic', () => {
    const markdown = '# A\n\n[[Silverstadt]] ![[tavern.png]]\n';
    expect(render(markdown)).toBe(render(markdown));
  });
});

describe('renderNote: task lists', () => {
  it('renders a task as a disabled checkbox in front of what the item says', () => {
    expect(render('- [ ] print the map\n- [x] pack the dice')).toBe(
      '<ul class="rz-tasks">\n' +
        '<li class="rz-task" data-task-line="1"><input type="checkbox" disabled> ' +
        'print the map</li>\n' +
        '<li class="rz-task rz-task-done" data-task-line="2">' +
        '<input type="checkbox" checked disabled> pack the dice</li>\n' +
        '</ul>',
    );
  });

  it('says which line each task stands on, so ticking one can find it in the note', () => {
    // The property has to be named the way hast names one — `dataTaskLine`, not the spelling it
    // ends up with in the HTML — or the sanitiser drops it and the box becomes unclickable with
    // nothing to show for it. That mistake is invisible except here.
    const html = render('# Before\n\ntext\n\n- [ ] one\n- [ ] two\n');
    expect(html).toContain('data-task-line="5"');
    expect(html).toContain('data-task-line="6"');
  });

  it('reads a capital X as ticked', () => {
    expect(render('- [X] done')).toContain(
      '<li class="rz-task rz-task-done" data-task-line="1"><input type="checkbox" checked disabled>',
    );
  });

  it('keeps the content of a task, links and all', () => {
    const html = render('- [ ] visit [[Silverstadt]] and [the guild](Factions/Harbour%20Guild.md)');
    expect(html).toContain(
      '<li class="rz-task" data-task-line="1"><input type="checkbox" disabled> visit ',
    );
    expect(html).toContain('<a href="/wiki/Silverstadt.md" class="rz-wikilink">Silverstadt</a>');
    expect(html).toContain('<a href="/wiki/Factions/Harbour%20Guild.md" class="rz-wikilink">');
  });

  it('leaves a list that only starts with a bracket alone', () => {
    const html = render('- [a link](Silverstadt.md)\n- [not a task] either');
    expect(html).not.toContain('rz-task');
    expect(html).not.toContain('<input');
    expect(html).toContain('<ul>\n<li><a href="/wiki/Silverstadt.md"');
  });

  it('marks the whole list when one item is a task, ordered lists included', () => {
    expect(render('- [ ] a task\n- an ordinary item')).toContain('<ul class="rz-tasks">');
    expect(render('- [ ] a task\n- an ordinary item')).toContain('<li>an ordinary item</li>');
    expect(render('1. [ ] a task\n2. [x] another')).toContain('<ol class="rz-tasks">');
  });

  it('marks a nested task list on its own, and numbers it by its own line', () => {
    const html = render('- a heading item\n  - [ ] a nested task');
    expect(html).toContain('<ul>\n<li>a heading item');
    expect(html).toContain('<ul class="rz-tasks">\n<li class="rz-task" data-task-line="2">');
  });
});

describe('renderNote: headings', () => {
  const NOTE = '# Mira\n\nText.\n\n## Loot\n\n### Rare Loot\n\n## Loot\n';

  it('reports level, text, slug and 1-based line', () => {
    expect(renderNote(NOTE, options()).headings).toEqual([
      { level: 1, text: 'Mira', slug: 'mira', line: 1 },
      { level: 2, text: 'Loot', slug: 'loot', line: 5 },
      { level: 3, text: 'Rare Loot', slug: 'rare-loot', line: 7 },
      { level: 2, text: 'Loot', slug: 'loot-1', line: 9 },
    ]);
  });

  it('gives every heading the reported id, duplicates included', () => {
    const html = render(NOTE);
    expect(html).toContain('<h2 id="loot">Loot</h2>');
    expect(html).toContain('<h2 id="loot-1">Loot</h2>');
    expect(html).toContain('<h3 id="rare-loot">Rare Loot</h3>');
  });

  it('agrees with parseNote, also for headings that contain links', () => {
    const markdown = '## See [[Silverstadt|the city]]\n\n## See [[Silverstadt|the city]]\n';
    expect(renderNote(markdown, options()).headings).toEqual(
      parseNote(markdown, { fallbackTitle: 'x' }).headings,
    );
  });
});

describe('renderNote: sanitising', () => {
  it('drops raw HTML instead of rendering it', () => {
    const html = render('<script>alert(1)</script>\n\n<div onclick="x()">block</div>\n');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('onclick');
  });

  it('drops inline HTML but keeps its text', () => {
    const html = render('A <img src=x onerror=alert(1)> and <b>bold</b> text.');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).toBe('<p>A  and bold text.</p>');
  });

  it('removes hrefs and sources with a dangerous protocol', () => {
    expect(render('[click](javascript:alert(1))')).toBe('<p><a>click</a></p>');
    expect(render('![x](data:text/html;base64,PHN2Zz4=)')).toBe('<p><img alt="x"></p>');
  });

  it('keeps only the class names and data attributes this renderer emits', () => {
    const html = render('[[New Note]] and ![[Handouts/Map.pdf]]', {
      resolveLink: () => ({ path: null, href: 'javascript:alert(1)' }),
    });
    expect(html).toContain('class="rz-wikilink rz-wikilink-missing"');
    expect(html).toContain('class="rz-embed-file"');
    expect(html).not.toContain('javascript:');
  });
});
