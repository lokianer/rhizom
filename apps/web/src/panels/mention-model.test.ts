import type { Mention, MentionGroup } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import {
  countMentions,
  keepSelection,
  keyOf,
  linkableKeys,
  noteCount,
  writesFor,
} from './mention-model.js';

function mention(start: number, overrides: Partial<Mention> = {}): Mention {
  return {
    target: 'Places/Silverstadt.md',
    line: 1,
    start,
    end: start + 11,
    text: 'Silverstadt',
    context: 'A line about Silverstadt.',
    inHeading: false,
    inTableCell: false,
    linkable: true,
    ...overrides,
  };
}

function group(source: string, mentions: Mention[]): MentionGroup {
  return { source, sourceTitle: source.replace(/\.md$/, ''), hash: `hash-${source}`, mentions };
}

const groups = [
  group('Home.md', [mention(10), mention(40, { linkable: false })]),
  group('Daily/Today.md', [mention(5, { inHeading: true })]),
];

describe('linkableKeys', () => {
  it('offers every mention a link can go around, in a heading too', () => {
    expect(linkableKeys(groups)).toEqual(['Home.md:10', 'Daily/Today.md:5']);
  });

  it('leaves out a mention broken across a line, which no wikilink may span', () => {
    expect(linkableKeys(groups)).not.toContain('Home.md:40');
  });

  it('has nothing to offer for an empty scan', () => {
    expect(linkableKeys([])).toEqual([]);
  });
});

describe('countMentions', () => {
  it('counts every mention, linkable or not', () => {
    expect(countMentions(groups)).toBe(3);
    expect(countMentions([])).toBe(0);
  });
});

describe('writesFor', () => {
  it('asks only for the notes something was selected in', () => {
    const selected = new Set([keyOf('Home.md', 10)]);
    expect(writesFor(groups, selected)).toEqual([
      { source: 'Home.md', hash: 'hash-Home.md', offsets: [10] },
    ]);
  });

  it('carries the hash each note was scanned at', () => {
    const writes = writesFor(groups, new Set(linkableKeys(groups)));
    expect(writes.map((write) => write.hash)).toEqual(['hash-Home.md', 'hash-Daily/Today.md']);
  });

  it('never asks for a mention that cannot be linked, even when it is selected', () => {
    const writes = writesFor(groups, new Set([keyOf('Home.md', 40)]));
    expect(writes).toEqual([]);
  });

  it('asks for nothing when nothing is selected', () => {
    expect(writesFor(groups, new Set())).toEqual([]);
    expect(noteCount(writesFor(groups, new Set()))).toBe(0);
  });

  it('counts the notes a batch would write', () => {
    expect(noteCount(writesFor(groups, new Set(linkableKeys(groups))))).toBe(2);
  });
});

describe('keepSelection', () => {
  const linkable = ['Home.md:10', 'Daily/Today.md:5'];

  it('ticks everything the first time a note is looked at', () => {
    expect([...keepSelection(new Set(), linkable, new Set())]).toEqual(linkable);
  });

  it('leaves a box the reader unticked unticked, however often the scan runs again', () => {
    const offered = new Set(linkable);
    const previous = new Set(['Home.md:10']);
    expect([...keepSelection(previous, linkable, offered)]).toEqual(['Home.md:10']);
    expect([
      ...keepSelection(keepSelection(previous, linkable, offered), linkable, offered),
    ]).toEqual(['Home.md:10']);
  });

  it('ticks a mention that was not there before', () => {
    const offered = new Set(['Home.md:10']);
    expect([...keepSelection(new Set(), linkable, offered)]).toEqual(['Daily/Today.md:5']);
  });

  it('drops what the scan no longer finds', () => {
    const previous = new Set([...linkable, 'Gone.md:1']);
    expect([...keepSelection(previous, linkable, new Set(previous))]).toEqual(linkable);
  });
});
