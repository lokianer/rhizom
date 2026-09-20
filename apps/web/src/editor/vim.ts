// Vim mode: the keymap, and the mode line that goes with it. Nothing imports this module
// statically — the editor fetches it with `import()` the first time somebody switches the mode
// on, so it becomes a chunk of its own and a vault written the ordinary way never downloads it.
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';

/**
 * Vim's own mode line, dressed in Rhizom's tokens. It sits under the editor, says NORMAL,
 * INSERT or VISUAL, and is where a typed `:` command appears — the one sign the mode is on
 * that a Vim user looks for anyway.
 */
const statusTheme = EditorView.theme({
  '.cm-vim-panel': {
    fontFamily: 'var(--rz-font-mono)',
    // Not smaller than the note it belongs to: a mode line nobody can read says nothing.
    fontSize: 'var(--rz-text-md)',
    color: 'var(--rz-text-muted)',
    padding: 'var(--rz-space-1) var(--rz-space-4)',
  },
});

/**
 * What the editor's Vim compartment holds while the mode is on. One value for the whole
 * application: the compartment is handed this and nothing else, however often it is switched,
 * so no second copy of the keymap can pile up behind the first.
 */
export const vimExtension: Extension = [vim({ status: true }), statusTheme];
