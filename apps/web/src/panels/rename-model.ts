// Shaping for the rename dialog: the vault path a typed name means, and what a preview adds up
// to. Kept apart from the component because the web unit tests run without a DOM (the reason is
// written out in mention-model.ts), so anything worth asserting has to be a plain function.
import { ensureMarkdownExtension, folderOf, type RenamePreview } from '@rhizom/core';

/**
 * The vault path a typed name means.
 *
 * A bare name stays where the note already is, because renaming is the common case and moving
 * the rarer one; a name carrying a `/` is read from the vault root, which is how a reader says
 * "somewhere else". A leading slash is that same gesture written out, so it marks the root and
 * is then dropped.
 *
 * Nothing here validates, folds case, shortens or strips: a vault is the user's to name, emoji
 * and all, and what a file system will actually take is `isSafeVaultPath`'s question on the
 * server — which answers with a refusal the dialog shows. So this never measures a name either;
 * `'a'.length` counts UTF-16 units, not characters a reader would recognise.
 */
export function targetPathFor(from: string, typed: string): string {
  const trimmed = typed.trim();
  // The caller disables its button on '': a name of nothing but spaces is not yet a name.
  const fromRoot = trimmed.includes('/');
  const written = trimmed.replace(/^\/+/, '');
  if (written === '') {
    return '';
  }
  const folder = folderOf(from);
  return ensureMarkdownExtension(fromRoot || folder === '' ? written : `${folder}/${written}`);
}

/**
 * The files a write should carry, each with the hash the preview read it at. A file the preview
 * lists but would not change — every ref in it deliberately left alone — is left out, so the
 * write never asks for a file it has nothing to do in, and the number sent matches the number
 * `countsOf` names.
 */
export function filesFor(preview: RenamePreview): { source: string; hash: string }[] {
  return preview.files
    .filter((file) => file.more > 0 || file.refs.some((ref) => ref.rewrite))
    .map((file) => ({ source: file.source, hash: file.hash }));
}

/**
 * The numbers the summary line says out loud before anything is written.
 *
 * `leftAlone` is the preview's own vault-wide count rather than a tally of the rows shown: a
 * short `[[Mira]]` finds the note wherever it moves, so most of a move's links need no file
 * touched and their files are not in `files` at all.
 */
export function countsOf(preview: RenamePreview): {
  files: number;
  refs: number;
  leftAlone: number;
  inHeadings: number;
} {
  let refs = 0;
  let inHeadings = 0;
  for (const file of preview.files) {
    for (const ref of file.refs) {
      if (!ref.rewrite) {
        continue;
      }
      refs += 1;
      if (ref.inHeading) {
        inHeadings += 1;
      }
    }
    // `more` counts the refs this preview did not list; the write still covers them.
    refs += file.more;
  }
  return { files: filesFor(preview).length, refs, leftAlone: preview.leftAlone, inHeadings };
}

/** The i18n key for a refusal, or null when the rename is not refused. */
export function refusalKey(
  refusal: RenamePreview['refusal'],
): `rename.refusal.${NonNullable<RenamePreview['refusal']>}` | null {
  return refusal === undefined ? null : `rename.refusal.${refusal}`;
}
