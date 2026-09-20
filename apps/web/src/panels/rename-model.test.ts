import type { RenameFile, RenamePreview, RenameRef } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { countsOf, filesFor, refusalKey, targetPathFor } from './rename-model.js';

function ref(overrides: Partial<RenameRef> = {}): RenameRef {
  return {
    line: 3,
    start: 4,
    end: 16,
    before: '[[Mira]]',
    after: '[[Wurzeln]]',
    rewrite: true,
    inHeading: false,
    ...overrides,
  };
}

function file(source: string, refs: RenameRef[], more = 0): RenameFile {
  return { source, sourceTitle: source.replace(/\.md$/, ''), hash: `hash-${source}`, refs, more };
}

function preview(overrides: Partial<RenamePreview> = {}): RenamePreview {
  return {
    from: 'People/Mira.md',
    to: 'People/Wurzeln.md',
    fromHash: 'hash-from',
    files: [],
    nameClash: [],
    leftAlone: 0,
    title: 'Mira',
    titleFollowsFileName: true,
    ...overrides,
  };
}

describe('targetPathFor', () => {
  it('keeps the note in its folder when the typed name carries none', () => {
    expect(targetPathFor('People/Mira.md', 'Wurzeln')).toBe('People/Wurzeln.md');
  });

  it('reads a name holding a slash from the vault root', () => {
    expect(targetPathFor('People/Mira.md', 'Archive/Wurzeln')).toBe('Archive/Wurzeln.md');
  });

  it('drops a leading slash, which says the same thing', () => {
    expect(targetPathFor('People/Mira.md', '/Wurzeln')).toBe('Wurzeln.md');
    expect(targetPathFor('People/Mira.md', '/Archive/Wurzeln')).toBe('Archive/Wurzeln.md');
  });

  it('adds the Markdown extension, and keeps the one that is there', () => {
    expect(targetPathFor('Mira.md', 'Wurzeln')).toBe('Wurzeln.md');
    expect(targetPathFor('Mira.md', 'Wurzeln.md')).toBe('Wurzeln.md');
    expect(targetPathFor('Mira.md', 'Wurzeln.markdown')).toBe('Wurzeln.markdown');
  });

  it('stays at the vault root for a note that is already there', () => {
    expect(targetPathFor('Mira.md', 'Wurzeln')).toBe('Wurzeln.md');
  });

  it('leaves emoji and other non-ASCII names exactly as typed', () => {
    expect(targetPathFor('People/Mira.md', 'Über Wurzeln')).toBe('People/Über Wurzeln.md');
    expect(targetPathFor('People/Mira.md', '👨‍👩‍👧 Familie')).toBe('People/👨‍👩‍👧 Familie.md');
    expect(targetPathFor('People/Mira.md', 'ᚦᚱᛁᛞᛁ')).toBe('People/ᚦᚱᛁᛞᛁ.md');
  });

  it('neither folds case nor drops what a file system might refuse — the server answers that', () => {
    expect(targetPathFor('People/Mira.md', 'WURZELN? <2>')).toBe('People/WURZELN? <2>.md');
    expect(targetPathFor('People/Mira.md', '../escape')).toBe('../escape.md');
  });

  it('has no target for an empty or whitespace-only name, so the button can stay off', () => {
    expect(targetPathFor('People/Mira.md', '')).toBe('');
    expect(targetPathFor('People/Mira.md', '   ')).toBe('');
    expect(targetPathFor('People/Mira.md', '/')).toBe('');
  });
});

describe('filesFor', () => {
  it('carries every file with the hash the preview read it at', () => {
    const files = [file('Home.md', [ref()]), file('Daily/Today.md', [ref({ line: 9 })])];
    expect(filesFor(preview({ files }))).toEqual([
      { source: 'Home.md', hash: 'hash-Home.md' },
      { source: 'Daily/Today.md', hash: 'hash-Daily/Today.md' },
    ]);
  });

  it('leaves out a file whose links all stay as they are', () => {
    const files = [
      file('Home.md', [ref({ rewrite: false, skipReason: 'alias' })]),
      file('Daily/Today.md', [ref()]),
    ];
    expect(filesFor(preview({ files }))).toEqual([
      { source: 'Daily/Today.md', hash: 'hash-Daily/Today.md' },
    ]);
  });

  it('keeps a file whose only refs are the ones the preview did not list', () => {
    const files = [file('Home.md', [], 12)];
    expect(filesFor(preview({ files }))).toEqual([{ source: 'Home.md', hash: 'hash-Home.md' }]);
  });

  it('asks for nothing when nothing links here', () => {
    expect(filesFor(preview())).toEqual([]);
  });
});

describe('countsOf', () => {
  it('counts files, links and the ones in a heading', () => {
    const files = [
      file('Home.md', [ref(), ref({ line: 5, inHeading: true })]),
      file('Daily/Today.md', [
        ref({ rewrite: false, skipReason: 'alias' }),
        ref({ line: 8, rewrite: false, skipReason: 'stillResolves' }),
        ref({ line: 9 }),
      ]),
    ];
    expect(countsOf(preview({ files, leftAlone: 2 }))).toEqual({
      files: 2,
      refs: 3,
      leftAlone: 2,
      inHeadings: 1,
    });
  });

  it('takes the links left alone from the preview, not from the rows it shows', () => {
    // Most of a move's links resolve by name, so their files are not in `files` at all.
    const files = [file('Home.md', [ref()])];
    expect(countsOf(preview({ files, leftAlone: 31 })).leftAlone).toBe(31);
  });

  it('counts the refs the preview did not list as links that would change', () => {
    const files = [file('Home.md', [ref()], 49)];
    expect(countsOf(preview({ files })).refs).toBe(50);
  });

  it('counts a file only when something in it would be rewritten', () => {
    const files = [file('Home.md', [ref({ rewrite: false, skipReason: 'alias' })])];
    expect(countsOf(preview({ files, leftAlone: 1 }))).toEqual({
      files: 0,
      refs: 0,
      leftAlone: 1,
      inHeadings: 0,
    });
  });

  it('counts nothing for a refused rename, which has no files', () => {
    expect(countsOf(preview({ refusal: 'exists' }))).toEqual({
      files: 0,
      refs: 0,
      leftAlone: 0,
      inHeadings: 0,
    });
  });
});

describe('refusalKey', () => {
  it('names a key for every refusal the server may send', () => {
    expect(refusalKey('notFound')).toBe('rename.refusal.notFound');
    expect(refusalKey('exists')).toBe('rename.refusal.exists');
    expect(refusalKey('unsafePath')).toBe('rename.refusal.unsafePath');
    expect(refusalKey('unwritableName')).toBe('rename.refusal.unwritableName');
    expect(refusalKey('tooMany')).toBe('rename.refusal.tooMany');
  });

  it('has no key when the rename may go ahead', () => {
    expect(refusalKey(undefined)).toBeNull();
    expect(refusalKey(preview().refusal)).toBeNull();
  });
});
