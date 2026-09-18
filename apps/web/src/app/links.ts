// Where a link written in a note leads. The server resolves links for the index; the app
// resolves them again for clicks and for the wiki view, from the note list it already has.
import {
  createNoteIndex,
  resolveLinkTarget,
  type LinkResolution,
  type NoteSummary,
} from '@rhizom/core';

export interface LinkResolver {
  /** `target` is the text inside `[[…]]` or the href of a Markdown link. */
  resolve: (target: string, sourcePath: string) => LinkResolution;
}

export function createResolver(notes: readonly NoteSummary[]): LinkResolver {
  const index = createNoteIndex(notes.map((note) => note.path));
  return {
    resolve: (target, sourcePath) => resolveLinkTarget(target, sourcePath, index),
  };
}
