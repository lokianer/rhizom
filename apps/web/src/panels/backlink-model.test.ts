import type { Backlink, NoteLink } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { groupBacklinks, outgoingLinks } from './backlink-model.js';

function backlink(source: string, line: number, context: string, sourceTitle = source): Backlink {
  return { source, sourceTitle, context, line };
}

function link(raw: string, target: string | null, line: number, alias?: string): NoteLink {
  return {
    source: 'Home.md',
    target,
    raw,
    kind: 'wikilink',
    line,
    ...(alias === undefined ? {} : { alias }),
  };
}

describe('groupBacklinks', () => {
  it('keeps one entry per source with its mentions in line order', () => {
    const groups = groupBacklinks([
      backlink('Campaign/Home.md', 12, 'see [[Mira]]', 'Home'),
      backlink('Daily/2026-09-18.md', 3, 'met [[Mira]]', 'Thursday'),
      backlink('Campaign/Home.md', 4, 'about [[Mira]]', 'Home'),
    ]);

    expect(groups.map((group) => group.source)).toStrictEqual([
      'Campaign/Home.md',
      'Daily/2026-09-18.md',
    ]);
    expect(groups[0]?.title).toBe('Home');
    expect(groups[0]?.mentions.map((mention) => mention.line)).toStrictEqual([4, 12]);
  });

  it('falls back to the note name when the source has no title', () => {
    const groups = groupBacklinks([backlink('Campaign/NPCs/Mira.md', 1, 'x', '')]);

    expect(groups[0]?.title).toBe('Mira');
  });

  it('returns nothing when no note links here', () => {
    expect(groupBacklinks([])).toStrictEqual([]);
  });
});

describe('outgoingLinks', () => {
  it('keeps every target once, in the order they appear', () => {
    const links = outgoingLinks([
      link('Silverstadt', 'Campaign/Places/Silverstadt.md', 2),
      link('Silverstadt', 'Campaign/Places/Silverstadt.md', 9),
      link('Lost Note', null, 11),
    ]);

    expect(links).toStrictEqual([
      { target: 'Campaign/Places/Silverstadt.md', label: 'Silverstadt', line: 2 },
      { target: null, label: 'Lost Note', line: 11 },
    ]);
  });

  it('prefers the alias the note gave over the target name', () => {
    const links = outgoingLinks([link('Mira', 'Campaign/NPCs/Mira.md', 1, 'the ledger keeper')]);

    expect(links[0]?.label).toBe('the ledger keeper');
  });

  it('keeps a missing target apart from a resolved one with the same text', () => {
    const links = outgoingLinks([
      link('Archive', 'Research/Archive.md', 1),
      link('Archive', null, 2),
    ]);

    expect(links).toHaveLength(2);
  });
});
