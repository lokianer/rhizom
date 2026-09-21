import { encodeLinkUrl, type LinkRef } from '../syntax/linkrefs.js';
import {
  ensureMarkdownExtension,
  folderOf,
  isSafeVaultPath,
  noteNameOf,
  toVaultPath,
} from './paths.js';

/** Lookup structure over the vault's note paths and aliases, kept current by the indexer. */
export interface NoteIndex {
  /** Adds or replaces a note; aliases come from its frontmatter. */
  add(path: string, aliases?: readonly string[]): void;
  remove(path: string): void;
  /** Exact path lookup, case-insensitive; returns the path as stored. */
  findPath(path: string): string | undefined;
  /** All paths whose note name matches, case-insensitive. */
  findByName(name: string): readonly string[];
  /** All paths that declare the alias, case-insensitive. */
  findByAlias(alias: string): readonly string[];
  readonly size: number;
}

export type LinkResolution =
  | { resolved: true; path: string; via: 'path' | 'name' | 'alias' | 'self'; ambiguous?: true }
  | { resolved: false; createPath?: string };

export function createNoteIndex(paths: Iterable<string> = []): NoteIndex {
  const byLowerPath = new Map<string, string>();
  const byLowerName = new Map<string, Set<string>>();
  const byLowerAlias = new Map<string, Set<string>>();
  const aliasesByPath = new Map<string, string[]>();

  function addTo(map: Map<string, Set<string>>, key: string, path: string): void {
    const group = map.get(key) ?? new Set<string>();
    group.add(path);
    map.set(key, group);
  }

  function removeFrom(map: Map<string, Set<string>>, key: string, path: string): void {
    const group = map.get(key);
    if (group) {
      group.delete(path);
      if (group.size === 0) {
        map.delete(key);
      }
    }
  }

  const index: NoteIndex = {
    add(path, aliases = []) {
      const stored = toVaultPath(path);
      index.remove(stored);
      byLowerPath.set(stored.toLowerCase(), stored);
      addTo(byLowerName, noteNameOf(stored).toLowerCase(), stored);
      const cleaned = aliases.map((alias) => alias.trim()).filter((alias) => alias !== '');
      aliasesByPath.set(stored, cleaned);
      for (const alias of cleaned) {
        addTo(byLowerAlias, alias.normalize('NFC').toLowerCase(), stored);
      }
    },
    remove(path) {
      const stored = toVaultPath(path);
      byLowerPath.delete(stored.toLowerCase());
      removeFrom(byLowerName, noteNameOf(stored).toLowerCase(), stored);
      for (const alias of aliasesByPath.get(stored) ?? []) {
        removeFrom(byLowerAlias, alias.normalize('NFC').toLowerCase(), stored);
      }
      aliasesByPath.delete(stored);
    },
    findPath(path) {
      return byLowerPath.get(path.toLowerCase());
    },
    findByName(name) {
      return [...(byLowerName.get(name.toLowerCase()) ?? [])];
    },
    findByAlias(alias) {
      return [...(byLowerAlias.get(alias.normalize('NFC').toLowerCase()) ?? [])];
    },
    get size() {
      return byLowerPath.size;
    },
  };

  for (const path of paths) {
    index.add(path);
  }
  return index;
}

/**
 * Resolves a wikilink target the way Obsidian does: an exact vault path first (with or without
 * the extension), then a unique note name anywhere in the vault, then a frontmatter alias. An
 * ambiguous name prefers a note in the source note's folder, then the shortest path. Unresolved
 * targets carry the path a new note would get: bare names at the vault root, folder paths as
 * written.
 */
export function resolveLinkTarget(
  rawTarget: string,
  sourcePath: string,
  index: NoteIndex,
): LinkResolution {
  const target = toVaultPath(rawTarget);
  if (target === '') {
    return { resolved: true, path: sourcePath, via: 'self' };
  }
  if (!isSafeVaultPath(target)) {
    return { resolved: false };
  }

  const withExtension = ensureMarkdownExtension(target);
  const byPath = index.findPath(withExtension) ?? index.findPath(target);
  if (byPath !== undefined) {
    return { resolved: true, path: byPath, via: 'path' };
  }

  if (!target.includes('/')) {
    const byName = pick(index.findByName(noteNameOf(withExtension)), sourcePath);
    if (byName !== undefined) {
      return { resolved: true, via: 'name', ...byName };
    }
    const byAlias = pick(index.findByAlias(target), sourcePath);
    if (byAlias !== undefined) {
      return { resolved: true, via: 'alias', ...byAlias };
    }
  }

  return { resolved: false, createPath: withExtension };
}

/**
 * How a link to `target` should be written inside `source`: the bare note name where that leads
 * back to the same note, the path from the vault root where it would not — two notes of the same
 * name are exactly the case a written link must not guess at.
 *
 * An ambiguous name counts as "would not", even when the tie happens to break towards this note
 * today: the rule that breaks it depends on where the link stands and on what else the vault
 * holds, so the bare name would start pointing elsewhere the day a namesake is added.
 */
export function linkTextFor(target: string, source: string, index: NoteIndex): string {
  const name = noteNameOf(target);
  const resolution = resolveLinkTarget(name, source, index);
  const unambiguous =
    resolution.resolved && resolution.path === target && resolution.ambiguous !== true;
  return unambiguous ? name : target.replace(MARKDOWN_EXTENSION, '');
}

const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

/**
 * What to put in a link's target span so that it leads to `to` after a rename.
 *
 * The form the reader chose is kept. A target written as a path stays a path — a path can never
 * be captured by a namesake, and shortening what somebody wrote out in full is not this
 * operation's business. A bare name stays a bare name only while that still reaches the note;
 * `linkTextFor` decides, and hands back the path when it does not.
 *
 * The extension follows the same rule: written once, written again. A Markdown link always keeps
 * it, because a URL without one is not recorded as a link to a note in the first place.
 */
export function writtenTargetFor(
  ref: Pick<LinkRef, 'kind' | 'written' | 'angled'>,
  to: string,
  source: string,
  index: NoteIndex,
): string {
  const asPath = ref.written.includes('/');
  const chosen = asPath ? to.replace(MARKDOWN_EXTENSION, '') : linkTextFor(to, source, index);
  const withExtension =
    ref.kind === 'markdown' || MARKDOWN_EXTENSION.test(ref.written)
      ? ensureMarkdownExtension(chosen)
      : chosen;
  // Inside `<…>` a space is a space; everywhere else in a Markdown destination it ends the URL.
  return ref.kind === 'markdown' && !ref.angled ? encodeLinkUrl(withExtension) : withExtension;
}

function pick(
  candidates: readonly string[],
  sourcePath: string,
): { path: string; ambiguous?: true } | undefined {
  const [single] = candidates;
  if (candidates.length === 1 && single !== undefined) {
    return { path: single };
  }
  if (candidates.length > 1) {
    return { path: pickAmbiguous(candidates, sourcePath), ambiguous: true };
  }
  return undefined;
}

/**
 * Picks one of several notes of the same name: one beside the source note first, then the
 * shallowest path, then code-unit order. Every step is a total order on purpose — two notes in
 * the source's own folder used to be separated by whichever the index happened to hold first,
 * and the server and the browser fill their index in different orders, so the same link could
 * lead to two different notes. Code-unit order rather than `localeCompare` for the same reason:
 * a vault must read the same on every machine.
 */
function pickAmbiguous(candidates: readonly string[], sourcePath: string): string {
  const sourceFolder = folderOf(sourcePath);
  const beside = (candidate: string): number => (folderOf(candidate) === sourceFolder ? 0 : 1);
  const sorted = [...candidates].sort(
    (a, b) =>
      beside(a) - beside(b) ||
      a.split('/').length - b.split('/').length ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return sorted[0] ?? '';
}
