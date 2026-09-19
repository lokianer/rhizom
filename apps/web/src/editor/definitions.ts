// The terms the vault defines, marked in the editor and explained on hover.
//
// Two layers, like the live preview: a ViewPlugin over the viewport for the marks, because a
// mark decoration never covers a line break and may therefore come from a plugin; and a hover
// tooltip, which is not on the typing path and may take its time.
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, hoverTooltip } from '@codemirror/view';
import type { DecorationSet, Tooltip, ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';
import type { TermMatch } from '@rhizom/core';

import { editorContext, frontmatterEnd, NOT_PROSE, type EditorContextValue } from './context.js';

/** One mark per defining note, so a document full of one term allocates one decoration. */
const marks = new Map<string, Decoration>();

function markFor(path: string): Decoration {
  const existing = marks.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const made = Decoration.mark({ class: 'cm-rz-term', attributes: { 'data-rz-term': path } });
  marks.set(path, made);
  return made;
}

/** Both ends are checked: a match may begin in prose and run into a link, or the other way. */
function insideMarkup(tree: Tree, from: number, to: number): boolean {
  return insideAt(tree, from, 1) || insideAt(tree, to, -1);
}

function insideAt(tree: Tree, pos: number, side: -1 | 1): boolean {
  let node: SyntaxNode | null = tree.resolveInner(pos, side);
  while (node !== null) {
    if (NOT_PROSE.has(node.name)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/** Every term in `text`, minus the ones that are not a mention: markup, and the note's own. */
function mentionsIn(
  state: EditorState,
  context: EditorContextValue,
  text: string,
  offset: number,
): TermMatch[] {
  const tree = syntaxTree(state);
  const afterFrontmatter = frontmatterEnd(state);
  return context.terms.find(text).filter((match) => {
    const from = offset + match.start;
    return (
      from >= afterFrontmatter &&
      match.term.path !== context.path &&
      !insideMarkup(tree, from, offset + match.end)
    );
  });
}

/**
 * The stretches of text a scan looks at: the visible ranges, each widened to whole lines.
 * Without the widening the viewport can cut a word in half and its tail would match a term on
 * its own; with it, the tooltip below can use the very same windows as the marks, so the two
 * cannot disagree about where a term begins — which matters because a term may span the soft
 * line break of a hard-wrapped paragraph.
 */
function scanWindows(view: EditorView): { from: number; to: number }[] {
  const windows: { from: number; to: number }[] = [];
  for (const visible of view.visibleRanges) {
    const from = view.state.doc.lineAt(visible.from).from;
    const to = view.state.doc.lineAt(visible.to).to;
    const previous = windows[windows.length - 1];
    if (previous !== undefined && from <= previous.to) {
      previous.to = Math.max(previous.to, to);
    } else {
      windows.push({ from, to });
    }
  }
  return windows;
}

function buildTermMarks(view: EditorView): DecorationSet {
  const context = view.state.facet(editorContext);
  if (context === undefined || context.terms.size === 0) {
    return Decoration.none;
  }
  const ranges: Range<Decoration>[] = [];
  for (const window of scanWindows(view)) {
    const text = view.state.doc.sliceString(window.from, window.to);
    for (const match of mentionsIn(view.state, context, text, window.from)) {
      ranges.push(
        markFor(match.term.path).range(window.from + match.start, window.from + match.end),
      );
    }
  }
  return Decoration.set(ranges, true);
}

export const definitionMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildTermMarks(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.startState.facet(editorContext) !== update.state.facet(editorContext) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildTermMarks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The definition itself, over the word. Not on the typing path, so it may look things up. */
export const definitionTooltip = hoverTooltip((view, pos): Tooltip | null => {
  const context = view.state.facet(editorContext);
  if (context === undefined || context.terms.size === 0) {
    return null;
  }
  // The same window the marks were built from, not the line under the pointer: a term may span
  // a soft line break, and scanning one line would find a different term there — or none.
  const window = scanWindows(view).find((range) => range.from <= pos && pos <= range.to);
  if (window === undefined) {
    return null;
  }
  const text = view.state.doc.sliceString(window.from, window.to);
  const match = mentionsIn(view.state, context, text, window.from).find(
    (found) => window.from + found.start <= pos && pos <= window.from + found.end,
  );
  if (match === undefined) {
    return null;
  }
  return {
    pos: window.from + match.start,
    end: window.from + match.end,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-rz-term-tooltip';
      const name = dom.appendChild(document.createElement('strong'));
      name.textContent = match.term.surface;
      if (match.term.summary !== '') {
        dom.appendChild(document.createElement('p')).textContent = match.term.summary;
      }
      return { dom };
    },
  };
});
