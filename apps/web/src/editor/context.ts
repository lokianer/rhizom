// Everything the extensions need to know about the app, in one facet. The React component
// reconfigures it through a compartment when the note list changes; the callbacks live in a
// mutable box instead, so a parent re-render never has to rebuild the editor.
import { Facet } from '@codemirror/state';
import {
  createNoteIndex,
  parseWikilink,
  resolveLinkTarget,
  type NoteIndex,
  type NoteSummary,
} from '@rhizom/core';

export interface EditorHandlers {
  onChange: (content: string) => void;
  onSave: (content: string) => void;
  onOpenLink: (target: string) => void;
  onUpload: (file: File) => Promise<string>;
}

export interface EditorContextValue {
  /** Vault path of the edited note; wikilinks and relative image paths resolve against it. */
  readonly path: string;
  readonly notes: readonly NoteSummary[];
  readonly index: NoteIndex;
  readonly handlers: { current: EditorHandlers };
}

export const editorContext = Facet.define<EditorContextValue, EditorContextValue | undefined>({
  combine: (values) => values[0],
});

export function buildNoteIndex(notes: readonly NoteSummary[]): NoteIndex {
  return createNoteIndex(notes.map((note) => note.path));
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
