import { describe, expect, it } from 'vitest';

import { renderNote } from './note.js';
import { parseStatblock } from './statblock.js';
import { renderStatblock, type StatblockLabels } from './statblock-view.js';

const LABELS: StatblockLabels = {
  fields: { ac: 'Armor Class', hp: 'Hit Points', speed: 'Speed', actions: 'Actions' },
  abilities: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
  problem: (message) => `This stat block could not be read: ${message}`,
};

function render(source: string): string {
  const block = parseStatblock(source);
  if ('problem' in block) {
    throw new Error(block.message);
  }
  return renderStatblock(block, LABELS);
}

const plain = {
  sourcePath: 'Note.md',
  resolveLink: () => ({ path: null, href: '#' }),
  assetUrl: (p: string) => p,
};

describe('renderStatblock', () => {
  it('draws the scores with their modifiers under the app’s labels', () => {
    const html = render(
      'name: Mira\nac: 15\nstats: [10, 16, 12, 18, 9, 17]\nactions:\n  - name: Rapier\n    desc: Stab.',
    );
    expect(html).toContain('class="rz-statblock" data-layout="5e"');
    expect(html).toContain('<dt>Armor Class</dt><dd>15</dd>');
    expect(html).toContain('<th>DEX</th>');
    expect(html).toContain('<td>16 (+3)</td>');
    expect(html).toContain('<td>9 (−1)</td>');
    expect(html).toContain('Actions');
    expect(html).toContain('<strong>Rapier.</strong> Stab.');
  });

  it('sets an entry without a name as its description alone', () => {
    const html = render(
      'name: Wyrm\nlegendary_actions:\n  - desc: Three actions.\n  - name: Tail\n    desc: Swish.',
    );
    expect(html).toContain('<p>Three actions.</p>');
    expect(html).not.toContain('<strong>.</strong>');
  });

  it('shows a key it has no label for as written, underscores turned to spaces', () => {
    expect(render('name: Sable\nledger_pages: 412')).toContain('<dt>ledger pages</dt><dd>412</dd>');
  });

  it('writes every value as text, never as markup', () => {
    const html = render(
      'name: "<script>alert(1)</script>"\nnote: "\\"><img src=x onerror=alert(1)>"',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&#x3C;script>');
  });
});

describe('a statblock fence in a note', () => {
  it('becomes a stat block', () => {
    const { html } = renderNote('```statblock\nname: Mira\nac: 15\n```\n', {
      ...plain,
      statblockLabels: LABELS,
    });
    expect(html).toContain('class="rz-statblock"');
    expect(html).not.toContain('<code');
  });

  it('stays its code block, with a notice, when it cannot be read', () => {
    const { html } = renderNote('```statblock\nname: [unclosed\n```\n', {
      ...plain,
      statblockLabels: LABELS,
    });
    expect(html).toContain('This stat block could not be read');
    expect(html).toContain('<code');
  });

  it('survives keys that name what every object inherits', () => {
    const { html } = renderNote(
      '```statblock\nname: x\nconstructor: 5\n__proto__: 6\ntoString:\n  - name: a\n    desc: b\n```\n',
      { ...plain, statblockLabels: LABELS },
    );
    expect(html).toContain('<dt>constructor</dt><dd>5</dd>');
    expect(html).toContain('<strong>a.</strong> b');
  });

  it('is drawn even without labels, under the keys as written', () => {
    const { html } = renderNote('```Statblock\nac: 15\n```\n', plain);
    expect(html).toContain('<dt>ac</dt><dd>15</dd>');
  });
});
