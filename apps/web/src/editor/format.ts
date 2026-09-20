// The keys a Markdown editor is expected to answer: bold, italic, and a link around whatever is
// selected. CodeMirror binds a great many keys on its own and not one of them writes Markdown, so
// until these, selecting a word and pressing Ctrl+B did nothing at all.
//
// Each one is a StateCommand — a function of the state with no view in it — so what a press does
// to a document can be read in a test that never opens a browser. Each press is one transaction,
// which is what makes it one step of the undo history rather than three.
//
// Positions in a document are counted in UTF-16 units, so nothing here measures the text it moves:
// every offset comes from the selection or from the document itself, and the only lengths taken
// are those of the markers, which are ASCII and therefore exactly as wide as they read. A
// selection holding `Über` or an emoji comes back out of these commands unharmed.
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';

/** What one selection range turns into: the text it changes, and where the range is left. */
interface RangeEdit {
  changes: ChangeSpec;
  range: SelectionRange;
}

const BOLD = '**';
const ITALIC = '*';

/** The three pieces a Markdown link is written in: `[` text `](` url `)`. */
const LINK_OPEN = '[';
const LINK_MIDDLE = '](';
const LINK_CLOSE = ')';

/**
 * Whether a run of marker characters at a boundary already carries this marker. Markdown reads a
 * row of asterisks greedily: two of them are bold and a single one is italic. So `**bold**`
 * carries bold but not italic — pressing italic there adds a third star rather than stealing one
 * from the pair — while `***both***` carries both and gives either back.
 */
function carries(run: number, marker: string): boolean {
  return marker.length === 1 ? run % 2 === 1 : run >= marker.length;
}

/** How many marker characters stand in a row before `at`, looking back no further than `stop`. */
function runBefore(state: EditorState, at: number, character: string, stop: number): number {
  let start = at;
  while (start > stop && state.sliceDoc(start - 1, start) === character) {
    start -= 1;
  }
  return at - start;
}

/** How many marker characters stand in a row after `at`, looking no further than `stop`. */
function runAfter(state: EditorState, at: number, character: string, stop: number): number {
  let end = at;
  while (end < stop && state.sliceDoc(end, end + 1) === character) {
    end += 1;
  }
  return end - at;
}

/**
 * Bold or italic for one selection range: the markers go on, or off again when they are already
 * there. Both ways of already being there count — the reader may have dragged across the markers
 * or only across the text between them — which is what lets a second press undo the first, and a
 * third put it back, with the document reading exactly as it did before.
 */
function emphasisEdit(state: EditorState, range: SelectionRange, marker: string): RangeEdit {
  const character = marker.charAt(0);
  const width = marker.length;
  const { from, to } = range;

  // Markers inside the selection: the reader dragged across them. The two runs are kept apart so
  // that a selection made of nothing but markers cannot count the same ones twice.
  const openInside = runAfter(state, from, character, to);
  const closeInside = runBefore(state, to, character, from + openInside);
  if (to - from >= 2 * width && carries(openInside, marker) && carries(closeInside, marker)) {
    return {
      changes: [
        { from, to: from + width, insert: '' },
        { from: to - width, to, insert: '' },
      ],
      range: EditorSelection.range(from, to - 2 * width),
    };
  }

  // Markers around the selection: what wrapping leaves behind, so this is the second press. A run
  // never crosses a line, so neither does the search for one.
  const openOutside = runBefore(state, from, character, state.doc.lineAt(from).from);
  const closeOutside = runAfter(state, to, character, state.doc.lineAt(to).to);
  if (carries(openOutside, marker) && carries(closeOutside, marker)) {
    return {
      changes: [
        { from: from - width, to: from, insert: '' },
        { from: to, to: to + width, insert: '' },
      ],
      range: EditorSelection.range(from - width, to - width),
    };
  }

  return {
    changes: [
      { from, insert: marker },
      { from: to, insert: marker },
    ],
    // The selection stays on the text rather than on the markers: pressing again takes them off,
    // and typing on replaces the words while keeping the emphasis around them. With nothing
    // selected the two ends meet, so the cursor lands between the markers and typing continues
    // inside them.
    range: EditorSelection.range(from + width, to + width),
  };
}

/**
 * The selection becomes the text of a link and the cursor goes where the URL belongs. Nothing is
 * read from the clipboard: that can only be asked for asynchronously and the answer would arrive
 * after the keystroke was over, so the address is typed or pasted by hand — the cursor standing in
 * the right place is the whole of this.
 *
 * With nothing selected the cursor lands between the brackets instead, because a link with neither
 * text nor address is written from its text.
 */
function linkEdit(_state: EditorState, range: SelectionRange): RangeEdit {
  const { from, to } = range;
  return {
    changes: [
      { from, insert: LINK_OPEN },
      { from: to, insert: LINK_MIDDLE + LINK_CLOSE },
    ],
    range: EditorSelection.cursor(
      range.empty ? from + LINK_OPEN.length : to + LINK_OPEN.length + LINK_MIDDLE.length,
    ),
  };
}

/**
 * One press, one transaction. Every selection range is edited on its own — CodeMirror keeps more
 * than one when a configuration allows it, and each of them is a piece of text somebody meant to
 * mark — and `changeByRange` maps the ranges through the changes the others make.
 *
 * `input.format` rather than `input.type`: the history joins adjacent typing into one event, and
 * marking a word is its own step, undone without taking the sentence around it along.
 */
function formatCommand(
  edit: (state: EditorState, range: SelectionRange) => RangeEdit,
): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) {
      return false;
    }
    dispatch(
      state.update(
        state.changeByRange((range) => edit(state, range)),
        { scrollIntoView: true, userEvent: 'input.format' },
      ),
    );
    return true;
  };
}

/** `**bold**` on, or off again. */
export const toggleBold: StateCommand = formatCommand((state, range) =>
  emphasisEdit(state, range, BOLD),
);

/** `*italic*` on, or off again. */
export const toggleItalic: StateCommand = formatCommand((state, range) =>
  emphasisEdit(state, range, ITALIC),
);

/** `[selection]()`, with the cursor where the URL goes. */
export const insertLink: StateCommand = formatCommand(linkEdit);

/**
 * The three keys, on the modifier the machine uses: Command on Apple systems, Control everywhere
 * else. They are the ones every text box on a computer has answered to for thirty years, and the
 * ones Obsidian and Typora bind, so a vault opened here is typed in the same way.
 */
export const formatKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-k', run: insertLink },
];
