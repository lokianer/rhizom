// Obsidian-style live preview in two layers:
//   livePreviewMarks  — ViewPlugin, viewport only: hides syntax marks and adds line classes.
//   imagePreview      — StateField, whole document: image widgets, which may cover line breaks
//                       and therefore may not come from a plugin.
// Both reveal the source on every line the selection touches; read-only means "no active
// line", so a wiki view renders everything.
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';

import { imageUrl, isImagePath } from './assets.js';
import { editorContext, wikilinkExists, type EditorContextValue } from './context.js';

/** 1-based numbers of the lines the selection touches. Empty while the editor is read-only. */
export function activeLines(state: EditorState): ReadonlySet<number> {
  const lines = new Set<number>();
  if (state.readOnly) {
    return lines;
  }
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

export function isActiveLine(state: EditorState, pos: number): boolean {
  return activeLines(state).has(state.doc.lineAt(pos).number);
}

function touchesActiveLine(
  state: EditorState,
  active: ReadonlySet<number>,
  from: number,
  to: number,
): boolean {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let line = first; line <= last; line += 1) {
    if (active.has(line)) {
      return true;
    }
  }
  return false;
}

const hidden = Decoration.replace({});

const HIDDEN_MARKS: ReadonlySet<string> = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'QuoteMark',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'WikiLinkMark',
]);

const HEADING_CLASS: Readonly<Record<string, string>> = {
  ATXHeading1: 'cm-rz-h1',
  ATXHeading2: 'cm-rz-h2',
  ATXHeading3: 'cm-rz-h3',
  ATXHeading4: 'cm-rz-h4',
  ATXHeading5: 'cm-rz-h5',
  ATXHeading6: 'cm-rz-h6',
  SetextHeading1: 'cm-rz-h1',
  SetextHeading2: 'cm-rz-h2',
};

/** Nodes the image layer owns: their source must stay untouched here. */
function ownedByImageLayer(state: EditorState, node: SyntaxNodeRef): boolean {
  if (node.name === 'Image') {
    return true;
  }
  return node.name === 'WikiEmbed' && isImagePath(embedTarget(state, node) ?? '');
}

function embedTarget(state: EditorState, embed: SyntaxNodeRef): string | null {
  const link = embed.node.getChild('WikiLink');
  const target = link?.getChild('WikiLinkTarget');
  return target === undefined || target === null ? null : state.sliceDoc(target.from, target.to);
}

function lineClass(state: EditorState, pos: number, className: string): Range<Decoration> {
  // A line decoration anchored anywhere but a line start is dropped in silence, and a heading
  // inside a list item or a blockquote does not begin at one.
  return Decoration.line({ class: className }).range(state.doc.lineAt(pos).from);
}

function enterMarkNode(
  state: EditorState,
  context: EditorContextValue | undefined,
  active: ReadonlySet<number>,
  ranges: Range<Decoration>[],
  node: SyntaxNodeRef,
  visible: { from: number; to: number },
): boolean {
  const heading = HEADING_CLASS[node.name];
  if (heading !== undefined) {
    ranges.push(lineClass(state, node.from, heading));
    return true;
  }
  if (node.name === 'Blockquote' && node.node.parent?.name !== 'Blockquote') {
    // The `>` characters are hidden below, so the lines carry the quote bar instead.
    const first = state.doc.lineAt(Math.max(node.from, visible.from));
    const last = state.doc.lineAt(Math.min(node.to, visible.to));
    for (let line = first.number; line <= last.number; line += 1) {
      ranges.push(lineClass(state, state.doc.line(line).from, 'cm-rz-quote'));
    }
    return true;
  }
  if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
    return false; // never touch marks inside code
  }
  if (ownedByImageLayer(state, node)) {
    return false;
  }
  if (node.name === 'WikiLink') {
    pushWikilink(state, context, ranges, node);
    return true;
  }
  if (!isHideable(state, node)) {
    return true;
  }
  if (touchesActiveLine(state, active, node.from, node.to)) {
    return true;
  }
  let end = node.to;
  // HeaderMark covers the `#` run only; swallow the single space behind it, never more.
  if (node.name === 'HeaderMark' && state.sliceDoc(end, end + 1) === ' ') {
    end += 1;
  }
  // A plugin-provided replacement must never cover a line break.
  end = Math.min(end, state.doc.lineAt(node.from).to);
  if (end > node.from) {
    ranges.push(hidden.range(node.from, end));
  }
  return true;
}

function isHideable(state: EditorState, node: SyntaxNodeRef): boolean {
  if (HIDDEN_MARKS.has(node.name)) {
    return true;
  }
  // The destination of a Markdown link, but not an autolink, which is its own visible text.
  return (node.name === 'URL' || node.name === 'LinkTitle') && node.matchContext(['Link']);
}

function pushWikilink(
  state: EditorState,
  context: EditorContextValue | undefined,
  ranges: Range<Decoration>[],
  node: SyntaxNodeRef,
): void {
  const target = node.node.getChild('WikiLinkTarget');
  if (target === null) {
    return;
  }
  const raw = state.sliceDoc(target.from, target.to);
  const missing = !wikilinkExists(context, raw);
  ranges.push(
    Decoration.mark({
      class: missing ? 'cm-wikilink cm-wikilink-missing' : 'cm-wikilink',
      attributes: { 'data-rz-wikilink': raw },
    }).range(node.from, node.to),
  );
}

function buildMarks(view: EditorView): DecorationSet {
  const { state } = view;
  const context = state.facet(editorContext);
  const active = activeLines(state);
  const tree = syntaxTree(state);
  const ranges: Range<Decoration>[] = [];
  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => enterMarkNode(state, context, active, ranges, node, visible),
    });
  }
  return Decoration.set(ranges, true);
}

export const livePreviewMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarks(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.readOnly !== update.state.readOnly ||
        update.startState.facet(editorContext) !== update.state.facet(editorContext) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildMarks(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

class ImageWidget extends WidgetType {
  readonly src: string;
  readonly alt: string;

  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof ImageWidget && other.src === this.src && other.alt === this.alt;
  }

  override toDOM(view: EditorView): HTMLElement {
    const image = document.createElement('img');
    image.className = 'cm-rz-image';
    image.src = this.src;
    image.alt = this.alt;
    // The height is unknown until the bytes arrive: let the view remeasure once they do.
    image.addEventListener('load', () => {
      view.requestMeasure();
    });
    return image;
  }

  override get estimatedHeight(): number {
    return 240;
  }

  override ignoreEvent(): boolean {
    return false; // a click puts the cursor on the line, which reveals the source
  }
}

const IMAGE_ALT = /^!\[([^\]]*)\]/;

function buildImages(state: EditorState): DecorationSet {
  const notePath = state.facet(editorContext)?.path ?? '';
  const active = activeLines(state);
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      const image = imageAt(state, node, notePath);
      if (image === null) {
        return true;
      }
      if (!touchesActiveLine(state, active, node.from, node.to)) {
        ranges.push(
          Decoration.replace({ widget: image, inclusive: false }).range(node.from, node.to),
        );
      }
      return false;
    },
  });
  return Decoration.set(ranges, true);
}

function imageAt(state: EditorState, node: SyntaxNodeRef, notePath: string): ImageWidget | null {
  if (node.name === 'Image') {
    const url = node.node.getChild('URL');
    if (url === null) {
      return null;
    }
    const source = state.sliceDoc(node.from, node.to);
    const alt = IMAGE_ALT.exec(source)?.[1] ?? '';
    return new ImageWidget(imageUrl(state.sliceDoc(url.from, url.to), notePath), alt);
  }
  if (node.name !== 'WikiEmbed') {
    return null;
  }
  const target = embedTarget(state, node);
  if (target === null || !isImagePath(target)) {
    return null;
  }
  return new ImageWidget(imageUrl(target, notePath), target);
}

export const imagePreview = StateField.define<DecorationSet>({
  create: (state) => buildImages(state),
  update(value, transaction) {
    const contextChanged =
      transaction.startState.facet(editorContext) !== transaction.state.facet(editorContext);
    const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    const readOnlyChanged = transaction.startState.readOnly !== transaction.state.readOnly;
    if (
      !transaction.docChanged &&
      transaction.selection === undefined &&
      !contextChanged &&
      !treeChanged &&
      !readOnlyChanged
    ) {
      return value;
    }
    return buildImages(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});
