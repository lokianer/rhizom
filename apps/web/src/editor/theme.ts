// One theme for both Rhizom themes: every value comes from the app's design tokens, so Humus
// and Kalk need no reconfiguration.
import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { wikiLinkTag } from './wikilink.js';

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--rz-text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--rz-text-md)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--rz-font-sans)',
    lineHeight: 'var(--rz-leading-relaxed)',
  },
  '.cm-content': { padding: 'var(--rz-space-4) 0', caretColor: 'var(--rz-accent-strong)' },
  '.cm-line': { padding: '0 var(--rz-space-4)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--rz-accent-strong)' },
  '.cm-activeLine': { backgroundColor: 'var(--rz-surface)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--rz-selection)',
  },
  '.cm-selectionMatch, .cm-searchMatch': { backgroundColor: 'var(--rz-selection)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--rz-accent)' },

  '.cm-line.cm-rz-h1': { fontSize: 'var(--rz-text-2xl)', lineHeight: 'var(--rz-leading-tight)' },
  '.cm-line.cm-rz-h2': { fontSize: 'var(--rz-text-xl)', lineHeight: 'var(--rz-leading-tight)' },
  '.cm-line.cm-rz-h3': { fontSize: 'var(--rz-text-lg)' },
  '.cm-line.cm-rz-h4, .cm-line.cm-rz-h5, .cm-line.cm-rz-h6': { fontWeight: '600' },
  '.cm-line.cm-rz-quote': {
    borderLeft: '3px solid var(--rz-border-strong)',
    color: 'var(--rz-text-muted)',
  },

  // The nested selector wins over the syntax highlighting inside the link, which would
  // otherwise repaint a missing link in the ordinary link colour.
  '.cm-wikilink, .cm-wikilink span': { color: 'var(--rz-link)', cursor: 'pointer' },
  '.cm-wikilink:hover': { textDecoration: 'underline' },
  '.cm-wikilink-missing, .cm-wikilink-missing span': {
    color: 'var(--rz-link-missing)',
    textDecoration: 'underline dashed',
    textUnderlineOffset: '3px',
  },

  '.cm-panels': { backgroundColor: 'var(--rz-surface)', color: 'var(--rz-text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--rz-border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--rz-border)' },
  '.cm-panel input, .cm-panel button, .cm-panel select': {
    backgroundColor: 'var(--rz-surface-raised)',
    color: 'var(--rz-text)',
    border: '1px solid var(--rz-border)',
    borderRadius: 'var(--rz-radius-sm)',
    padding: '0 var(--rz-space-1)',
  },

  // A word this vault defines somewhere. An underline rather than a colour, so a paragraph full
  // of known terms still reads as prose.
  '.cm-rz-term': {
    borderBottom: '1px dotted var(--rz-accent)',
  },
  '.cm-rz-term-tooltip': {
    fontFamily: 'var(--rz-font-sans)',
    fontSize: 'var(--rz-text-md)',
    lineHeight: '1.5',
    maxWidth: '34em',
    padding: 'var(--rz-space-2) var(--rz-space-3)',
  },
  '.cm-rz-term-tooltip strong': {
    color: 'var(--rz-accent-strong)',
  },
  '.cm-rz-term-tooltip p': {
    margin: 'var(--rz-space-1) 0 0',
    color: 'var(--rz-text-muted)',
  },

  '.cm-tooltip': {
    backgroundColor: 'var(--rz-surface-raised)',
    color: 'var(--rz-text)',
    border: '1px solid var(--rz-border)',
    borderRadius: 'var(--rz-radius-md)',
    boxShadow: 'var(--rz-shadow-floating)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--rz-font-sans)',
    fontSize: 'var(--rz-text-md)',
    maxHeight: '18em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: 'var(--rz-space-1) var(--rz-space-3)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--rz-selection)',
    color: 'var(--rz-text)',
  },
  '.cm-completionMatchedText': {
    color: 'var(--rz-accent-strong)',
    textDecoration: 'none',
    fontWeight: '600',
  },
  '.cm-completionDetail': {
    color: 'var(--rz-text-muted)',
    fontStyle: 'normal',
    fontSize: 'var(--rz-text-md)',
    marginLeft: 'var(--rz-space-3)',
  },
});

export const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  {
    tag: tags.monospace,
    fontFamily: 'var(--rz-font-mono)',
    backgroundColor: 'var(--rz-surface-sunken)',
    borderRadius: 'var(--rz-radius-sm)',
  },
  { tag: tags.link, color: 'var(--rz-link)' },
  { tag: tags.url, color: 'var(--rz-text-muted)' },
  { tag: tags.labelName, color: 'var(--rz-text-muted)' },
  { tag: tags.quote, color: 'var(--rz-text-muted)' },
  { tag: tags.contentSeparator, color: 'var(--rz-text-muted)' },
  // The Markdown marks, visible only on the line the cursor is on.
  { tag: tags.processingInstruction, color: 'var(--rz-text-muted)' },
  { tag: wikiLinkTag, color: 'var(--rz-link)' },
]);
