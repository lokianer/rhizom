// Which of the vault's notes count as templates. The slash menu offers them and the new-note
// dialog starts a note from one, so the rule lives here rather than in either: on its own, away
// from anything that touches CodeMirror, it can be read by the app frame without the frame
// having to carry the editor.
import { isInFolder, type NoteSummary, type TemplateSettings } from '@rhizom/core';

/** The notes offered as templates: the ones in the vault's template folder. */
export function templateNotes(
  notes: readonly NoteSummary[],
  templates: TemplateSettings,
): NoteSummary[] {
  return notes.filter((note) => isInFolder(note.path, templates.folder));
}
