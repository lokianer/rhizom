// The two palette commands that have something to decide: which note "a random note" lands on,
// and what a copy of a note is called. Kept apart from Layout because the web unit tests run
// without a DOM, so anything worth asserting has to be a plain function.
import { folderOf, noteNameOf, type NoteSummary } from '@rhizom/core';

/**
 * A note to stumble into. A Zettelkasten is worth walking through without a destination, and the
 * one note that is no answer is the one already open — being handed back the page you are looking
 * at is not a find. In a vault of one note that is all there is, so it comes back anyway; an empty
 * vault has nothing to give, and the command is not offered there at all.
 */
export function randomNotePath(
  notes: readonly NoteSummary[],
  openPath: string | null,
  random: () => number = Math.random,
): string | null {
  const others = notes.filter((note) => note.path !== openPath);
  const pool = others.length > 0 ? others : notes;
  // `Math.random` is below 1, but a stand-in handed in by a test need not be: the index is
  // clamped rather than trusted.
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]?.path ?? null;
}

/** A name that is already a copy: ` copy`, or ` copy` and a number. */
const COPY_SUFFIX = / copy(?: \d+)?$/;

/**
 * What the duplicate of a note is called: `Note copy`, then `Note copy 2`, `Note copy 3` — the
 * series a file manager writes and a person reads without being told. It stays in the folder the
 * note is in, keeps the extension the note has, and counts on from a name that is already a copy
 * rather than stacking the word, so duplicating `Note copy` gives `Note copy 2`.
 *
 * `taken` is every path the vault holds, and the first name in the series that is not among them
 * is the one to ask for. The series is endless and the vault is not, so the loop ends.
 */
export function copyPath(path: string, taken: ReadonlySet<string>): string {
  const folder = folderOf(path);
  const prefix = folder === '' ? '' : `${folder}/`;
  const segment = path.slice(path.lastIndexOf('/') + 1);
  const name = noteNameOf(path);
  // Whatever the name did not cover: `.md`, or nothing at all.
  const extension = segment.slice(name.length);
  const base = name.replace(COPY_SUFFIX, '');
  for (let copy = 1; ; copy += 1) {
    const candidate = `${prefix}${base} copy${copy === 1 ? '' : ` ${String(copy)}`}${extension}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
