import { describe, expect, it } from 'vitest';

import {
  calloutKindOf,
  CALLOUT_ALIASES,
  CALLOUT_KINDS,
  type CalloutKind,
  type CalloutLabels,
} from './callout.js';
import { renderNote, type RenderOptions, type RenderedLink } from './render.js';

const VAULT = new Set(['Silverstadt.md']);

function resolveLink(target: string): RenderedLink {
  const withExtension = /\.(md|markdown)$/i.test(target) ? target : `${target}.md`;
  if (VAULT.has(withExtension)) {
    return { path: withExtension, href: `/wiki/${withExtension}` };
  }
  return { path: null, href: `/new/${target}` };
}

// A word per kind, as the app supplies them. Built from the exported list rather than written
// out, so this file says nothing about how many kinds there are.
const LABELS = Object.fromEntries(
  CALLOUT_KINDS.map((kind) => [kind, `The ${kind} word`]),
) as CalloutLabels;

function render(markdown: string, overrides: Partial<RenderOptions> = {}): string {
  return renderNote(markdown, {
    sourcePath: 'Home.md',
    resolveLink,
    assetUrl: (vaultPath) => `/files/${vaultPath}`,
    ...overrides,
  }).html;
}

describe('callout kinds', () => {
  it('folds every spelling onto a kind the renderer draws', () => {
    for (const [word, kind] of Object.entries(CALLOUT_ALIASES)) {
      expect(CALLOUT_KINDS).toContain(kind);
      expect(render(`> [!${word}] Title`)).toContain(`class="rz-callout rz-callout-${kind}"`);
    }
  });

  it('lets every exported kind through the sanitiser, and each one names itself', () => {
    for (const kind of CALLOUT_KINDS) {
      expect(calloutKindOf(kind)).toBe(kind);
      // The class is what the stylesheet colours by; a kind the sanitiser strips is a kind that
      // renders grey, which is exactly the drift a list in two places would produce.
      expect(render(`> [!${kind}] Title`)).toContain(`rz-callout-${kind}`);
    }
  });

  it('reads a kind however it is capitalised', () => {
    expect(calloutKindOf('WARNING')).toBe('warning');
    expect(calloutKindOf(' Tldr ')).toBe('abstract');
    expect(calloutKindOf('houserule')).toBeUndefined();
    expect(render('> [!Caution] Mind the step')).toContain('rz-callout-warning');
  });

  it('draws a kind nobody knows as a note and keeps the word as its title', () => {
    const html = render('> [!houserule]\n> Roll twice.', { calloutLabels: LABELS });
    expect(html).toContain('class="rz-callout rz-callout-note"');
    expect(html).toContain('<div class="rz-callout-title">houserule</div>');
  });

  it('keeps the title an unknown kind was given', () => {
    expect(render('> [!houserule] Table rules', { calloutLabels: LABELS })).toContain(
      '<div class="rz-callout-title">Table rules</div>',
    );
  });
});

describe('renderNote: callouts', () => {
  it('renders a callout with a title and a body', () => {
    expect(render('> [!note] Watch the tide\n> The causeway floods.')).toBe(
      '<div class="rz-callout rz-callout-note">\n' +
        '<div class="rz-callout-title">Watch the tide</div>\n' +
        '<div class="rz-callout-body">\n<p>The causeway floods.</p>\n</div>\n' +
        '</div>',
    );
  });

  it('titles a callout without a title with the app’s word for its kind', () => {
    expect(render('> [!tip]\n> Ask the harbour master.', { calloutLabels: LABELS })).toContain(
      '<div class="rz-callout-title">The tip word</div>',
    );
  });

  it('falls back to the word the note wrote when the app supplied none', () => {
    expect(render('> [!tldr]\n> The short of it.')).toContain(
      '<div class="rz-callout-title">tldr</div>',
    );
  });

  it('renders a callout with a title and nothing else', () => {
    expect(render('> [!todo] Pack the maps')).toBe(
      '<div class="rz-callout rz-callout-todo">\n' +
        '<div class="rz-callout-title">Pack the maps</div>\n' +
        '</div>',
    );
  });

  it('folds a marked callout into a details, open for + and shut for -', () => {
    const open = render('> [!info]+ Open\n> Body.');
    expect(open).toContain('<details class="rz-callout rz-callout-info" open>');
    expect(open).toContain('<summary class="rz-callout-title">Open</summary>');

    const folded = render('> [!warning]- Shut\n> Body.');
    expect(folded).toContain('<details class="rz-callout rz-callout-warning">');
    expect(folded).toContain('<summary class="rz-callout-title">Shut</summary>');
    expect(folded).not.toContain('open');

    // Without a marker it is not foldable at all, which is the one thing a details cannot be.
    expect(render('> [!warning] Plain\n> Body.')).not.toContain('<details');
  });

  it('leaves an ordinary blockquote a blockquote', () => {
    expect(render('> The sea was angry that day.')).toBe(
      '<blockquote>\n<p>The sea was angry that day.</p>\n</blockquote>',
    );
    // A bracket that names nothing is not a callout either.
    expect(render('> [!] Nothing')).toContain('<blockquote>');
    // Nor is one whose first line is not plain text to begin with.
    expect(render('> # A quoted heading\n>\n> [!note] Body')).toContain('<blockquote>');
    expect(render('> *[!note]* in italics')).toContain('<blockquote>');
  });

  it('ends the title at a hard line break as well', () => {
    expect(render('> [!note] Watch the tide  \n> The causeway floods.')).toBe(
      '<div class="rz-callout rz-callout-note">\n' +
        '<div class="rz-callout-title">Watch the tide</div>\n' +
        '<div class="rz-callout-body">\n<p>The causeway floods.</p>\n</div>\n' +
        '</div>',
    );
  });

  it('treats a bracket in the middle of a quote as the text it is', () => {
    const html = render('> The rule says\n> [!warning] is not a warning here.');
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('rz-callout');
    expect(html).toContain('[!warning] is not a warning here.');
  });

  it('escapes the title instead of letting it become markup', () => {
    const html = render('> [!note] <script>alert(1)</script>\n> Body.');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('</script>');
    expect(html).toContain('<div class="rz-callout-title">alert(1)</div>');
    expect(render('> [!note] 5 < 6 & rising')).toContain(
      '<div class="rz-callout-title">5 &#x3C; 6 &#x26; rising</div>',
    );
  });

  it('renders the Markdown in a title and in a body alike', () => {
    const html = render('> [!quote] From [[Silverstadt]]\n> See [[Silverstadt]] as well.');
    expect(html.match(/class="rz-wikilink"/g)).toHaveLength(2);
    expect(html).toContain('<div class="rz-callout-title">From <a href="/wiki/Silverstadt.md"');
  });

  it('carries a list, a fence and a link through a callout body', () => {
    const html = render(
      '> [!example] Rolling\n> - a note\n> - another\n>\n> ```\n> 2d6\n> ```\n>\n> See [[Silverstadt]].',
    );
    expect(html).toContain('<ul>\n<li>a note</li>');
    expect(html).toContain('<pre><code>2d6\n</code></pre>');
    expect(html).toContain('<a href="/wiki/Silverstadt.md" class="rz-wikilink">Silverstadt</a>');
  });

  it('nests a callout inside a callout', () => {
    const html = render('> [!note] Outer\n>\n> > [!danger]- Inner\n> > Mind the gap.');
    expect(html).toContain('<div class="rz-callout rz-callout-note">');
    expect(html).toContain('<details class="rz-callout rz-callout-danger">');
    expect(html).toContain('<summary class="rz-callout-title">Inner</summary>');
    expect(html).toContain('<p>Mind the gap.</p>');
  });

  it('does not read the first line of a body as a second callout', () => {
    const html = render('> [!note] Outer\n> [!warning] is only text on the next line.');
    expect(html.match(/rz-callout /g)).toHaveLength(1);
    expect(html).toContain('[!warning] is only text on the next line.');
  });

  it('marks a task list inside a callout', () => {
    const html = render('> [!todo] Before the session\n> - [ ] print the map\n> - [x] pack dice');
    expect(html).toContain('<div class="rz-callout rz-callout-todo">');
    expect(html).toContain('<ul class="rz-tasks">');
    expect(html).toContain(
      '<li class="rz-task" data-task-line="2"><input type="checkbox" disabled> print the map',
    );
    expect(html).toContain(
      '<li class="rz-task rz-task-done" data-task-line="3">' +
        '<input type="checkbox" checked disabled> pack dice',
    );
  });

  it('keeps a callout out of an embed hook’s way', () => {
    // A title is a line of text; an embed in it stays the link it was, and the title keeps its
    // tag rather than becoming an embed block.
    const html = render('> [!note] ![[Silverstadt]]\n> Body.', {
      renderEmbed: () => ({ state: 'ready', html: '<p>body</p>' }) as const,
    });
    expect(html).toContain('<div class="rz-callout-title"><a href="/wiki/Silverstadt.md"');
    expect(html).not.toContain('rz-embed');
  });

  it('is deterministic', () => {
    const markdown = '> [!tip]+ Twice\n> The same both times.';
    expect(render(markdown)).toBe(render(markdown));
  });
});

describe('callout labels', () => {
  it('takes a word for every kind and shows it', () => {
    for (const kind of CALLOUT_KINDS) {
      const label: string = LABELS[kind satisfies CalloutKind];
      expect(render(`> [!${kind}]\n> Body.`, { calloutLabels: LABELS })).toContain(
        `<div class="rz-callout-title">${label}</div>`,
      );
    }
  });
});
