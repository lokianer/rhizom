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

function pickAmbiguous(candidates: readonly string[], sourcePath: string): string {
  const sourceFolder = folderOf(sourcePath);
  const sameFolder = candidates.find((candidate) => folderOf(candidate) === sourceFolder);
  if (sameFolder !== undefined) {
    return sameFolder;
  }
  const sorted = [...candidates].sort((a, b) => {
    const depth = a.split('/').length - b.split('/').length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });
  return sorted[0] ?? candidates[0] ?? '';
}
