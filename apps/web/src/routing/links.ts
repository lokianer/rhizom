// Where a link written in a note leads. The server resolves links for the index; the app
// resolves them again for clicks and for the wiki view, from the note list it already has.
import {
  createNoteIndex,
  resolveLinkTarget,
  type LinkResolution,
  type NoteIndex,
  type NoteSummary,
} from '@rhizom/core';

export interface LinkResolver {
  /** `target` is the text inside `[[…]]` or the href of a Markdown link. */
  resolve: (target: string, sourcePath: string) => LinkResolution;
}

/**
 * The index a link is resolved against. The app keeps one, in the vault store; build another only
 * for a note list of your own.
 */
export function buildNoteIndex(notes: readonly Pick<NoteSummary, 'path' | 'aliases'>[]): NoteIndex {
  // Added one by one rather than through createNoteIndex(paths), which takes paths alone: a
  // link may name a note by any of its aliases, and the server resolves it that way too.
  const index = createNoteIndex();
  for (const note of notes) {
    index.add(note.path, note.aliases);
  }
  return index;
}

export function createResolver(index: NoteIndex): LinkResolver {
  return {
    resolve: (target, sourcePath) => resolveLinkTarget(target, sourcePath, index),
  };
}

export interface AssetResolver {
  /** The vault path of an embedded file, or null when the vault holds no such file. */
  resolve: (target: string) => string | null;
}

/**
 * Attachments are addressed the way Obsidian addresses them: by their file name, wherever
 * they lie, or by a path from the vault root.
 */
export function createAssetResolver(assets: readonly { path: string }[]): AssetResolver {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const asset of assets) {
    byPath.set(asset.path.toLowerCase(), asset.path);
    const name = asset.path.slice(asset.path.lastIndexOf('/') + 1).toLowerCase();
    // The first file of a name wins, which keeps the answer stable as the vault grows.
    if (!byName.has(name)) {
      byName.set(name, asset.path);
    }
  }
  return {
    resolve: (target) => {
      const trimmed = target.trim();
      const relative = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
      const cleaned = relative.toLowerCase();
      return byPath.get(cleaned) ?? byName.get(cleaned.slice(cleaned.lastIndexOf('/') + 1)) ?? null;
    },
  };
}
