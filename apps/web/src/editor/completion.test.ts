import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { createTermMatcher, type NoteSummary } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { wikilinkCompletion } from './completion.js';
import { buildNoteIndex, editorContext, wikilinkExists } from './context.js';

function note(path: string, title: string, folder: string, aliases: string[] = []): NoteSummary {
  return {
    path,
    name: title,
    title,
    folder,
    tags: [],
    aliases,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    size: 0,
    linkCount: 0,
    backlinkCount: 0,
  };
}

const notes: readonly NoteSummary[] = [
  note('Campaign/NPCs/Mira.md', 'Mira', 'Campaign/NPCs'),
  note('Campaign/NPCs/Miro.md', 'Miro', 'Campaign/NPCs'),
  note('Ideas/Mirror worlds.md', 'Mirror worlds', 'Ideas'),
];

const context = {
  path: 'Campaign/Session.md',
  notes,
  index: buildNoteIndex(notes),
  terms: createTermMatcher([]),
  handlers: {
    current: {
      onChange: () => undefined,
      onSave: () => undefined,
      onOpenLink: () => undefined,
      onUpload: () => Promise.resolve(''),
    },
  },
};

function complete(doc: string) {
  const state = EditorState.create({ doc, extensions: editorContext.of(context) });
  return wikilinkCompletion(new CompletionContext(state, doc.length, false));
}

describe('wikilinkCompletion', () => {
  it('opens after `[[` and offers every note', () => {
    const result = complete('see [[');
    expect(result?.from).toBe(6);
    expect(result?.options).toHaveLength(notes.length);
  });

  it('ranks by the fuzzy score and shows the folder', () => {
    const result = complete('[[Mira');
    expect(result?.options[0]?.label).toBe('Mira');
    expect(result?.options[0]?.detail).toBe('Campaign/NPCs');
  });

  it('matches the path when the query contains a slash', () => {
    const result = complete('[[Ideas/Mirr');
    expect(result?.options[0]?.label).toBe('Mirror worlds');
  });

  it('stays closed outside a link and after the target ended', () => {
    expect(complete('plain text')).toBeNull();
    expect(complete('[[Mira]]')).toBeNull();
    expect(complete('[[Mira|')).toBeNull();
  });
});

describe('wikilinkExists', () => {
  it('follows the vault rules for names, paths and subpaths', () => {
    expect(wikilinkExists(context, 'Mira')).toBe(true);
    expect(wikilinkExists(context, 'Campaign/NPCs/Mira')).toBe(true);
    expect(wikilinkExists(context, 'Mira#Hooks')).toBe(true);
    expect(wikilinkExists(context, '#Local heading')).toBe(true);
    expect(wikilinkExists(context, 'Nobody')).toBe(false);
  });

  it('reports nothing as missing before the first configuration', () => {
    expect(wikilinkExists(undefined, 'Nobody')).toBe(true);
  });
});
