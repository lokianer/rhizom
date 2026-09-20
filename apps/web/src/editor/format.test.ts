import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { formatKeymap, insertLink, toggleBold, toggleItalic } from './format.js';

/**
 * A document with one or more selected ranges, each given as `[from, to]`. Multiple ranges need
 * the facet turned on: without it CodeMirror collapses every transaction to its main range, which
 * is what the editor itself does today.
 */
function stateOf(doc: string, ranges: readonly [number, number][]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from, to))),
    extensions: [history(), EditorState.allowMultipleSelections.of(ranges.length > 1)],
  });
}

/** Runs a command the way a keypress would, and hands back the state it left behind. */
function press(state: EditorState, command: StateCommand): EditorState {
  let next = state;
  command({
    state,
    dispatch: (transaction) => {
      next = transaction.state;
    },
  });
  return next;
}

/** The text each selected range covers, for saying what is still selected afterwards. */
function selected(state: EditorState): string[] {
  return state.selection.ranges.map((range) => state.sliceDoc(range.from, range.to));
}

describe('toggleBold', () => {
  it('wraps the selection and leaves it selected', () => {
    const after = press(stateOf('a bold word', [[7, 11]]), toggleBold);
    expect(after.doc.toString()).toBe('a bold **word**');
    expect(selected(after)).toEqual(['word']);
  });

  it('puts the cursor between the markers when nothing is selected', () => {
    const after = press(stateOf('say ', [[4, 4]]), toggleBold);
    expect(after.doc.toString()).toBe('say ****');
    expect(after.selection.main.empty).toBe(true);
    expect(after.selection.main.head).toBe(6);
  });

  it('gives the text back exactly on the second press, however it was selected', () => {
    // Selected inside the markers, selected across them, and no selection at all: each press
    // undoes the one before it and leaves the document as it started.
    for (const [doc, range] of [
      ['a bold word', [7, 11]],
      ['a **bold** word', [4, 8]],
      ['a **bold** word', [2, 10]],
      ['nothing selected', [8, 8]],
    ] as const) {
      const start = stateOf(doc, [[range[0], range[1]]]);
      const once = press(start, toggleBold);
      expect(once.doc.toString()).not.toBe(doc);
      expect(press(once, toggleBold).doc.toString()).toBe(doc);
    }
  });

  it('is one step of the undo history, not three', () => {
    const start = stateOf('a bold word', [[7, 11]]);
    const after = press(start, toggleBold);
    expect(after.doc.toString()).toBe('a bold **word**');
    expect(press(after, undo).doc.toString()).toBe('a bold word');
  });

  it('counts the document, not the characters, so any script survives it', () => {
    // An emoji and an umlaut before the selection: an implementation that counted characters
    // rather than document positions would put the markers a place or two to the left, and one
    // that sliced by character could cut a surrogate pair in half.
    const doc = '🌱 Über den Wörtern steht ein Wort';
    const after = press(stateOf(doc, [[doc.lastIndexOf('Wort'), doc.length]]), toggleBold);
    expect(after.doc.toString()).toBe('🌱 Über den Wörtern steht ein **Wort**');
    expect(selected(after)).toEqual(['Wort']);
    expect(press(after, toggleBold).doc.toString()).toBe(doc);

    // And the same when the marked text is what begins with the emoji.
    const seedling = '🌱 Seedling';
    const emoji = press(stateOf(seedling, [[0, seedling.length]]), toggleBold);
    expect(emoji.doc.toString()).toBe('**🌱 Seedling**');
    expect(selected(emoji)).toEqual([seedling]);
    expect(press(emoji, toggleBold).doc.toString()).toBe(seedling);
  });

  it('marks every selection of a state that keeps more than one', () => {
    const after = press(
      stateOf('one two three', [
        [0, 3],
        [8, 13],
      ]),
      toggleBold,
    );
    expect(after.doc.toString()).toBe('**one** two **three**');
    expect(selected(after)).toEqual(['one', 'three']);
  });

  it('leaves a read-only document alone', () => {
    const state = EditorState.create({
      doc: 'a bold word',
      selection: EditorSelection.single(7, 11),
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(toggleBold({ state, dispatch: () => undefined })).toBe(false);
  });
});

describe('toggleItalic', () => {
  it('wraps in one star and takes the one star off again', () => {
    const once = press(stateOf('a word', [[2, 6]]), toggleItalic);
    expect(once.doc.toString()).toBe('a *word*');
    expect(press(once, toggleItalic).doc.toString()).toBe('a word');
  });

  it('reads a pair of stars as bold and adds its own to it', () => {
    // Bold plus italic is three stars; taking either back off leaves the other standing.
    const both = press(stateOf('a **bold** word', [[4, 8]]), toggleItalic);
    expect(both.doc.toString()).toBe('a ***bold*** word');
    expect(press(both, toggleItalic).doc.toString()).toBe('a **bold** word');
    expect(press(both, toggleBold).doc.toString()).toBe('a *bold* word');
  });
});

describe('insertLink', () => {
  it('makes the selection the text of a link and waits in the brackets for the address', () => {
    const after = press(stateOf('see the docs', [[8, 12]]), insertLink);
    expect(after.doc.toString()).toBe('see the [docs]()');
    expect(after.selection.main.empty).toBe(true);
    // Between the parentheses, where the URL goes.
    expect(after.selection.main.head).toBe(15);
  });

  it('waits between the brackets when there is no text to link', () => {
    const after = press(stateOf('see ', [[4, 4]]), insertLink);
    expect(after.doc.toString()).toBe('see []()');
    expect(after.selection.main.head).toBe(5);
  });
});

describe('formatKeymap', () => {
  it('binds the three keys a Markdown editor is expected to answer', () => {
    expect(formatKeymap.map((binding) => binding.key)).toEqual(['Mod-b', 'Mod-i', 'Mod-k']);
    expect(formatKeymap.map((binding) => binding.run)).toEqual([
      toggleBold,
      toggleItalic,
      insertLink,
    ]);
  });
});
