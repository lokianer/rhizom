// The file tree without the DOM: flattening, windowing and the keyboard decisions. Keeping
// these as plain functions lets them be tested in the node environment and keeps the
// component down to rendering and focus handling.
import type { TreeEntry } from '@rhizom/core';

/** Height of one row in pixels. Must match --rz-tree-row-height in panels.css. */
export const ROW_HEIGHT = 30;
/** Up to this many visible rows every row is rendered; above it only a window is. */
export const WINDOW_THRESHOLD = 500;
/** Rows kept above and below the viewport so scrolling never shows a gap. */
const OVERSCAN = 6;

export interface TreeRow {
  path: string;
  kind: 'folder' | 'note';
  /** Folder name or note title. */
  label: string;
  /** 1-based nesting depth, for aria-level. */
  level: number;
  /** Folders only; always false for notes. */
  expanded: boolean;
  hasChildren: boolean;
  /** Notes in this folder and below it; 0 on note rows. */
  noteCount: number;
  posInSet: number;
  setSize: number;
  /** Index of the parent row in the flat list, -1 at the vault root. */
  parent: number;
}

/** The rows a tree shows with the given folders open, in display order. */
export function flattenTree(
  entries: readonly TreeEntry[],
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  collect(entries, expanded, 1, -1, rows);
  return rows;
}

function collect(
  entries: readonly TreeEntry[],
  expanded: ReadonlySet<string>,
  level: number,
  parent: number,
  rows: TreeRow[],
): void {
  // The server already sorts this way; sorting again keeps the order right for any caller.
  const sorted = [...entries].sort(compareEntries);
  for (const [position, entry] of sorted.entries()) {
    const index = rows.length;
    const shared = { level, posInSet: position + 1, setSize: sorted.length, parent };
    if (entry.type === 'folder') {
      const open = expanded.has(entry.path);
      rows.push({
        ...shared,
        path: entry.path,
        kind: 'folder',
        label: entry.name,
        expanded: open,
        hasChildren: entry.children.length > 0,
        noteCount: countNotes(entry.children),
      });
      if (open) {
        collect(entry.children, expanded, level + 1, index, rows);
      }
    } else {
      rows.push({
        ...shared,
        path: entry.path,
        kind: 'note',
        label: entry.title === '' ? entry.name : entry.title,
        expanded: false,
        hasChildren: false,
        noteCount: 0,
      });
    }
  }
}

/**
 * One collator, built once. `String.prototype.localeCompare` builds a fresh one on every call,
 * and this runs over every entry of the tree each time the vault is refreshed.
 */
const BY_NAME = new Intl.Collator();

function compareEntries(a: TreeEntry, b: TreeEntry): number {
  if (a.type !== b.type) {
    return a.type === 'folder' ? -1 : 1;
  }
  return BY_NAME.compare(a.name, b.name);
}

function countNotes(entries: readonly TreeEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += entry.type === 'folder' ? countNotes(entry.children) : 1;
  }
  return total;
}

/** Position of a path in the flat list, or -1 when it is not visible. */
export function rowIndexOf(rows: readonly TreeRow[], path: string): number {
  return rows.findIndex((row) => row.path === path);
}

/** Every folder above a note, outermost first: `a/b/note.md` → `['a', 'a/b']`. */
export function ancestorFolders(path: string): string[] {
  const segments = path.split('/');
  segments.pop();
  const folders: string[] = [];
  let prefix = '';
  for (const segment of segments) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    folders.push(prefix);
  }
  return folders;
}

export interface RowWindow {
  /** First rendered row, inclusive. */
  start: number;
  /** Last rendered row, exclusive. */
  end: number;
  /** Pixels standing in for the rows above and below the window. */
  padTop: number;
  padBottom: number;
}

/**
 * Which rows to render for a scroll position. Small trees are rendered whole; large ones only
 * around the viewport, plus the focused row, which the keyboard may have moved out of sight
 * before the browser scrolls to it.
 */
export function rowWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  focusIndex = -1,
): RowWindow {
  if (total <= WINDOW_THRESHOLD) {
    return { start: 0, end: total, padTop: 0, padBottom: 0 };
  }
  const span = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT)) + OVERSCAN * 2;
  const last = Math.max(0, total - span);
  let start = clamp(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, 0, last);
  if (focusIndex >= 0 && (focusIndex < start || focusIndex >= start + span)) {
    start = clamp(focusIndex - OVERSCAN, 0, last);
  }
  const end = Math.min(total, start + span);
  return { start, end, padTop: start * ROW_HEIGHT, padBottom: (total - end) * ROW_HEIGHT };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export interface TreeNode {
  row: TreeRow;
  /** Index of the row in the full flat list, for ids and the roving tabindex. */
  index: number;
  children: TreeNode[];
}

/**
 * Rebuilds the nesting of a window of rows so the markup can carry role="group". A window may
 * start inside a subtree; those rows become roots here, and aria-level still tells the truth.
 */
export function nestRows(rows: readonly TreeRow[], offset = 0): TreeNode[] {
  const roots: TreeNode[] = [];
  const open: TreeNode[] = [];
  for (const [position, row] of rows.entries()) {
    const node: TreeNode = { row, index: offset + position, children: [] };
    while (open.length > 0 && (open.at(-1)?.row.level ?? 0) >= row.level) {
      open.pop();
    }
    const parent = open.at(-1);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    open.push(node);
  }
  return roots;
}

export type TreeAction =
  | { type: 'focus'; index: number }
  | { type: 'toggle'; path: string }
  | { type: 'open'; path: string };

/** What a key press means for the row at `index`; null when the tree ignores the key. */
export function treeKeyAction(
  key: string,
  rows: readonly TreeRow[],
  index: number,
): TreeAction | null {
  const row = rows[index];
  switch (key) {
    case 'ArrowDown':
      return index + 1 < rows.length ? { type: 'focus', index: index + 1 } : null;
    case 'ArrowUp':
      return index > 0 ? { type: 'focus', index: index - 1 } : null;
    case 'Home':
      return rows.length > 0 ? { type: 'focus', index: 0 } : null;
    case 'End':
      return rows.length > 0 ? { type: 'focus', index: rows.length - 1 } : null;
    case 'ArrowRight':
      if (row?.kind !== 'folder' || !row.hasChildren) {
        return null;
      }
      // An open folder hands the focus to its first child, which is the next row.
      return row.expanded
        ? { type: 'focus', index: index + 1 }
        : { type: 'toggle', path: row.path };
    case 'ArrowLeft':
      if (row === undefined) {
        return null;
      }
      if (row.kind === 'folder' && row.expanded) {
        return { type: 'toggle', path: row.path };
      }
      return row.parent >= 0 ? { type: 'focus', index: row.parent } : null;
    case 'Enter':
    case ' ':
      if (row === undefined) {
        return null;
      }
      return row.kind === 'note'
        ? { type: 'open', path: row.path }
        : { type: 'toggle', path: row.path };
    default:
      return null;
  }
}
