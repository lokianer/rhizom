// Everything the extensions need to know about the app, in one facet. The React component
// reconfigures it through a compartment when the note list changes; the callbacks live in a
// mutable box instead, so a parent re-render never has to rebuild the editor.
import { Facet, type EditorState } from '@codemirror/state';
import {
  createNoteIndex,
  parseWikilink,
  resolveLinkTarget,
  type NoteIndex,
  type NoteSummary,
  type TemplateSettings,
  type TermMatcher,
} from '@rhizom/core';

// Type-only, so the two modules do not import each other at runtime: the command needs the
// facet, and the facet needs to know what the command reports.
import type { BlockLinkResult } from './block-link.js';

// Anything whose text is not prose. A term inside a link would give the same word two things to
// do, and one inside code is not a mention of anything.
export const NOT_PROSE: ReadonlySet<string> = new Set([
  'CodeBlock',
  'CodeText',
  'Comment',
  'CommentBlock',
  'FencedCode',
  'HTMLBlock',
  'HTMLTag',
  'Image',
  'InlineCode',
  'Link',
  'URL',
  'WikiEmbed',
  'WikiLink',
]);

/**
 * Where the frontmatter block ends. The editor's Markdown parser does not know about it, so its
 * keys and values are ordinary text to the syntax tree — and `aliases: [Mira]` is not a mention
 * of Mira.
 */
export function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || state.doc.line(1).text.trim() !== '---') {
    return 0;
  }
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (line.text.trim() === '---') {
      return line.to;
    }
  }
  return 0;
}

export interface EditorHandlers {
  onChange: (content: string) => void;
  onSave: (content: string) => void;
  onOpenLink: (target: string) => void;
  onUpload: (file: File) => Promise<string>;
  /** The Markdown of another note, for inserting a template. */
  onReadNote: (path: string) => Promise<string>;
  /**
   * A link to the block the cursor stands in — or the reason there is none. The clipboard and
   * the sentence about it both belong to the page; the editor only knows what it wrote.
   */
  onBlockLink: (result: BlockLinkResult) => void;
}

export interface EditorContextValue {
  /** Vault path of the edited note; wikilinks and relative image paths resolve against it. */
  readonly path: string;
  readonly notes: readonly NoteSummary[];
  readonly index: NoteIndex;
  /** The terms the vault defines, for marking them and explaining them on hover. */
  readonly terms: TermMatcher;
  /** Where this vault keeps its templates, and what its placeholders default to. */
  readonly templates: TemplateSettings;
  /** What the slash menu calls each built-in command, translated; keyed by command id. */
  readonly commandLabels: Readonly<Record<string, string>>;
  /** BCP 47 tag for the month and weekday names a template writes into the note. */
  readonly locale: string;
  readonly handlers: { current: EditorHandlers };
}

export const editorContext = Facet.define<EditorContextValue, EditorContextValue | undefined>({
  combine: (values) => values[0],
});

export function buildNoteIndex(notes: readonly NoteSummary[]): NoteIndex {
  // One by one, because createNoteIndex(paths) drops the aliases a link may also use.
  const index = createNoteIndex();
  for (const note of notes) {
    index.add(note.path, note.aliases);
  }
  return index;
}

/**
 * Whether a wikilink target as written (subpath included) points at a note that exists. Without
 * a context — before the first configuration — nothing is reported as missing.
 */
export function wikilinkExists(context: EditorContextValue | undefined, raw: string): boolean {
  if (context === undefined) {
    return true;
  }
  const { target } = parseWikilink(raw);
  if (target === '') {
    return true; // `[[#Heading]]` points into the note itself
  }
  return resolveLinkTarget(target, context.path, context.index).resolved;
}
