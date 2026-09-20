// The editor's static configuration. Everything that changes at runtime — the note context,
// the accessible name and read-only mode — is added by MarkdownEditor through compartments.
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  type KeyBinding,
} from '@codemirror/view';

import { wikilinkCompletion } from './completion.js';
import { definitionMarks, definitionTooltip } from './definitions.js';
import { editorContext } from './context.js';
import { formatKeymap } from './format.js';
import { fileUpload } from './imageDrop.js';
import { wikilinkClicks } from './links.js';
import { imagePreview, livePreviewMarks } from './livePreview.js';
import { slashCompletion, slashTemplates } from './slash.js';
import { editorTheme, markdownHighlight } from './theme.js';
import { wikilinkExtension } from './wikilink.js';

const saveKeymap: readonly KeyBinding[] = [
  {
    key: 'Mod-s',
    preventDefault: true,
    run: (view) => {
      const handlers = view.state.facet(editorContext)?.handlers.current;
      if (handlers === undefined) {
        return false;
      }
      handlers.onSave(view.state.doc.toString());
      return true;
    },
  },
];

/** Read-only for a wiki view: no editing, no caret, and live preview renders everything. */
export function readOnlyExtension(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

export function baseExtensions(): Extension {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    markdown({
      base: markdownLanguage, // GFM, subscript, superscript, emoji
      extensions: [wikilinkExtension],
      completeHTMLTags: false,
    }),
    markdownLanguage.data.of({ autocomplete: wikilinkCompletion }),
    markdownLanguage.data.of({ autocomplete: slashCompletion }),
    slashTemplates,
    syntaxHighlighting(markdownHighlight),
    autocompletion({ activateOnTypingDelay: 0, icons: false }),
    closeBrackets(),
    // The search keys were bound long before this: without the panel they belong to, Ctrl+F and
    // Ctrl+H were keystrokes the editor answered by doing nothing at all. The panel sits at the
    // top, where it does not cover the line somebody is looking at near the end of a note.
    search({ top: true }),
    highlightSelectionMatches(),
    livePreviewMarks,
    definitionMarks,
    definitionTooltip,
    imagePreview,
    fileUpload,
    wikilinkClicks,
    editorTheme,
    keymap.of([
      ...saveKeymap,
      // Ahead of the defaults, whose platform-dependent half reaches for some of these letters:
      // in a Markdown editor the three of them mean bold, italic and a link.
      ...formatKeymap,
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
  ];
}
