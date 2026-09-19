import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { createTermMatcher, type NoteSummary } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { buildNoteIndex, editorContext, type EditorContextValue } from './context.js';
import { baseExtensions } from './extensions.js';
import { commandChange, definitionChange, slashCompletion, templateNotes } from './slash.js';

function note(path: string, title: string, folder: string): NoteSummary {
  return {
    path,
    name: title,
    title,
    folder,
    tags: [],
    aliases: [],
    modifiedAt: '2026-01-01T00:00:00.000Z',
    size: 0,
    linkCount: 0,
    backlinkCount: 0,
  };
}

const notes: readonly NoteSummary[] = [
  note('Campaign/NPCs/Mira.md', 'Mira', 'Campaign/NPCs'),
  // What an Obsidian vault's templates look like: the title is the placeholder itself.
  note('Templates/NPC.md', '{{title}}', 'Templates'),
  note('Templates/Campaign/Session.md', '{{title}}', 'Templates/Campaign'),
];

function contextValue(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    path: 'Campaign/Session.md',
    notes,
    index: buildNoteIndex(notes),
    terms: createTermMatcher([]),
    templates: { folder: 'Templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
    commandLabels: { table: 'Tabelle' },
    locale: 'de',
    handlers: {
      current: {
        onChange: () => undefined,
        onSave: () => undefined,
        onOpenLink: () => undefined,
        onUpload: () => Promise.resolve(''),
        onReadNote: () => Promise.resolve(''),
      },
    },
    ...overrides,
  };
}

function complete(doc: string, value = contextValue(), pos = doc.length) {
  const state = EditorState.create({
    doc,
    // The real Markdown language, so that a fenced block is a fenced block to the syntax tree.
    extensions: [baseExtensions(), editorContext.of(value)],
  });
  return slashCompletion(new CompletionContext(state, pos, false));
}

function labels(doc: string): string[] {
  return (complete(doc)?.options ?? []).map((option) => option.label);
}

describe('slashCompletion', () => {
  it('opens on a slash at the start of a line', () => {
    const result = complete('/');
    expect(result?.from).toBe(1);
    expect(result?.options.map((option) => option.label)).toEqual([
      'table',
      'definition',
      'date',
      'time',
      'NPC',
      'Session',
    ]);
  });

  it('opens after a space, with what has been typed already', () => {
    const result = complete('Write this: /tab');
    expect(result?.from).toBe('Write this: /'.length);
  });

  it('reads in the language of the app and matches in the language of the keyboard', () => {
    const table = complete('/')?.options[0];
    expect(table?.label).toBe('table');
    expect(table?.displayLabel).toBe('Tabelle');
  });

  it('stays shut in the middle of a word', () => {
    expect(complete('and/or')).toBeNull();
    expect(complete('Campaign/NPCs/')).toBeNull();
  });

  it('stays shut inside an unfinished wikilink, whose target holds slashes', () => {
    expect(complete('see [[Campaign/')).toBeNull();
  });

  it('stays shut in code, where a slash is a divide sign', () => {
    expect(complete('```js\nconst half = one /')).toBeNull();
    const span = '`one / two` and on we go';
    expect(complete(span, contextValue(), span.indexOf('/') + 1)).toBeNull();
  });

  it('offers the built-ins and nothing else when the vault has no templates', () => {
    const value = contextValue({
      templates: { folder: null, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' },
    });
    expect((complete('/', value)?.options ?? []).map((option) => option.label)).toEqual([
      'table',
      'definition',
      'date',
      'time',
    ]);
  });

  it('names a template by its file, not by the title the index read out of it', () => {
    // `Templates/NPC.md` begins with `# {{title}}`, so its indexed title is that placeholder.
    expect(labels('/')).toContain('NPC');
    expect(labels('/')).not.toContain('{{title}}');
    expect(complete('/')?.options[4]?.detail).toBe('Templates');
  });
});

describe('templateNotes', () => {
  const settings = { folder: 'Templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' };

  it('takes the notes in the template folder, including the ones below it', () => {
    expect(templateNotes(notes, settings).map((found) => found.path)).toEqual([
      'Templates/NPC.md',
      'Templates/Campaign/Session.md',
    ]);
  });

  it('takes none when the vault has no template folder', () => {
    expect(templateNotes(notes, { ...settings, folder: null })).toEqual([]);
  });
});

describe('commandChange', () => {
  const value = contextValue();

  it('writes a table and puts the cursor in its first cell', () => {
    const doc = '/table';
    const { changes, anchor } = commandChange('table', value, doc, 0, doc.length);
    expect(changes).toEqual([
      { from: 0, to: doc.length, insert: '|  |  |\n| --- | --- |\n|  |  |\n' },
    ]);
    // Between the two spaces of the first cell, where `{{cursor}}` stood.
    expect(anchor).toBe(2);
  });

  it('starts a table on a line of its own, wherever the command was typed', () => {
    // A table that begins after a sentence is not a table; GFM reads it as pipes in prose.
    const doc = 'Some prose /table';
    const { changes, anchor } = commandChange('table', value, doc, 11, doc.length);
    expect(changes[0]?.insert.startsWith('\n|')).toBe(true);
    expect(anchor).toBe(14);
    // On an empty line, nothing is added in front of it.
    const bare = '/table';
    expect(commandChange('table', value, bare, 0, 6).changes[0]?.insert.startsWith('|')).toBe(true);
  });

  it('writes the date in the format the vault uses, in the language it is read in', () => {
    const value = contextValue({
      templates: { folder: null, dateFormat: '[heute, ]dddd', timeFormat: 'HH:mm' },
    });
    const german = new Intl.DateTimeFormat('de', { weekday: 'long' }).format(new Date());
    const { changes } = commandChange('date', value, '/date', 0, 5);
    // The context says `locale: 'de'`, so the weekday has to arrive in German — the whole point
    // of carrying the language into the editor.
    expect(changes[0]?.insert).toBe(`heute, ${german}`);
  });
});

describe('definitionChange', () => {
  it('adds the key to a note that already has frontmatter', () => {
    const doc = '---\ntags: [x]\n---\n\n# Ledger\n\n/def';
    const { changes, anchor } = definitionChange(doc, doc.length - 4, doc.length);
    expect(changes).toEqual([
      { from: 4, insert: 'type: definition\n' },
      { from: doc.length - 4, to: doc.length, insert: '' },
    ]);
    expect(anchor).toBe(doc.length - 4 + 'type: definition\n'.length);
  });

  it('gives a note without frontmatter a block of its own', () => {
    const doc = '# Ledger\n\n/def';
    const { changes } = definitionChange(doc, 10, doc.length);
    expect(changes).toEqual([
      { from: 0, insert: '---\ntype: definition\n---\n\n' },
      { from: 10, to: doc.length, insert: '' },
    ]);
  });

  it('does not give a note with an empty frontmatter block a second one', () => {
    const doc = '---\n---\n\n# Ledger\n\n/def';
    const { changes } = definitionChange(doc, doc.length - 4, doc.length);
    expect(changes[0]).toEqual({ from: 4, insert: 'type: definition\n' });
  });

  it('leaves a note that already declares a type with the one it has', () => {
    const doc = '---\ntype: npc\n---\n\n/def';
    const { changes } = definitionChange(doc, 19, doc.length);
    expect(changes).toEqual([{ from: 19, to: doc.length, insert: '' }]);
  });
});
