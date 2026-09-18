import type { TreeEntry } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import {
  ancestorFolders,
  flattenTree,
  nestRows,
  rowIndexOf,
  rowWindow,
  treeKeyAction,
  ROW_HEIGHT,
  WINDOW_THRESHOLD,
  type TreeRow,
} from './tree-model.js';

function folder(name: string, path: string, children: TreeEntry[]): TreeEntry {
  return { type: 'folder', name, path, children };
}

function note(name: string, path: string, title = name): TreeEntry {
  return { type: 'note', name, path, title };
}

const vault: TreeEntry[] = [
  note('Home.md', 'Home.md', 'Home'),
  folder('Campaign', 'Campaign', [
    folder('NPCs', 'Campaign/NPCs', [note('Mira.md', 'Campaign/NPCs/Mira.md', 'Mira')]),
    note('Campaign.md', 'Campaign/Campaign.md', 'Campaign'),
  ]),
];

describe('flattenTree', () => {
  it('puts folders before notes and keeps closed folders shut', () => {
    const rows = flattenTree(vault, new Set());

    expect(rows.map((row) => row.path)).toStrictEqual(['Campaign', 'Home.md']);
    expect(rows[0]).toMatchObject({
      kind: 'folder',
      label: 'Campaign',
      level: 1,
      expanded: false,
      hasChildren: true,
      noteCount: 2,
      posInSet: 1,
      setSize: 2,
      parent: -1,
    });
    expect(rows[1]).toMatchObject({ kind: 'note', label: 'Home', posInSet: 2, parent: -1 });
  });

  it('descends into open folders and records level and parent', () => {
    const rows = flattenTree(vault, new Set(['Campaign', 'Campaign/NPCs']));

    expect(rows.map((row) => row.path)).toStrictEqual([
      'Campaign',
      'Campaign/NPCs',
      'Campaign/NPCs/Mira.md',
      'Campaign/Campaign.md',
      'Home.md',
    ]);
    expect(rows.map((row) => row.level)).toStrictEqual([1, 2, 3, 2, 1]);
    expect(rows.map((row) => row.parent)).toStrictEqual([-1, 0, 1, 0, -1]);
    expect(rows[2]?.setSize).toBe(1);
  });

  it('falls back to the file name when a note has no title', () => {
    const rows = flattenTree([note('Untitled.md', 'Untitled.md', '')], new Set());

    expect(rows[0]?.label).toBe('Untitled.md');
  });
});

describe('rowIndexOf and ancestorFolders', () => {
  it('finds a visible row and reports -1 for a hidden one', () => {
    const rows = flattenTree(vault, new Set());

    expect(rowIndexOf(rows, 'Home.md')).toBe(1);
    expect(rowIndexOf(rows, 'Campaign/NPCs/Mira.md')).toBe(-1);
  });

  it('lists the folders above a note, outermost first', () => {
    expect(ancestorFolders('a/b/c.md')).toStrictEqual(['a', 'a/b']);
    expect(ancestorFolders('Home.md')).toStrictEqual([]);
  });
});

describe('rowWindow', () => {
  it('renders every row of a small tree', () => {
    expect(rowWindow(120, 0, 400)).toStrictEqual({ start: 0, end: 120, padTop: 0, padBottom: 0 });
  });

  it('renders a window with overscan once the tree is large', () => {
    const total = WINDOW_THRESHOLD + 500;
    const view = rowWindow(total, 100 * ROW_HEIGHT, 10 * ROW_HEIGHT);

    expect(view.start).toBeLessThan(100);
    expect(view.end).toBeGreaterThan(110);
    expect(view.end - view.start).toBeLessThan(40);
    expect(view.padTop).toBe(view.start * ROW_HEIGHT);
    expect(view.padTop + (view.end - view.start) * ROW_HEIGHT + view.padBottom).toBe(
      total * ROW_HEIGHT,
    );
  });

  it('keeps the focused row inside the window', () => {
    const total = 5000;
    const view = rowWindow(total, 0, 10 * ROW_HEIGHT, 4000);

    expect(view.start).toBeLessThanOrEqual(4000);
    expect(view.end).toBeGreaterThan(4000);
  });

  it('never scrolls past the last row', () => {
    const total = 1000;
    const view = rowWindow(total, 1000 * ROW_HEIGHT, 10 * ROW_HEIGHT);

    expect(view.end).toBe(total);
    expect(view.padBottom).toBe(0);
  });
});

describe('nestRows', () => {
  it('rebuilds the nesting and numbers the rows from the offset', () => {
    const rows = flattenTree(vault, new Set(['Campaign', 'Campaign/NPCs']));
    const nodes = nestRows(rows, 0);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.row.path).toBe('Campaign');
    expect(nodes[0]?.children.map((child) => child.row.path)).toStrictEqual([
      'Campaign/NPCs',
      'Campaign/Campaign.md',
    ]);
    expect(nodes[0]?.children[0]?.children[0]?.index).toBe(2);
    expect(nodes[1]?.row.path).toBe('Home.md');
  });

  it('treats a window that starts inside a subtree as roots', () => {
    const rows = flattenTree(vault, new Set(['Campaign', 'Campaign/NPCs']));
    const nodes = nestRows(rows.slice(2, 4), 2);

    expect(nodes.map((node) => node.row.path)).toStrictEqual([
      'Campaign/NPCs/Mira.md',
      'Campaign/Campaign.md',
    ]);
    expect(nodes[0]?.index).toBe(2);
  });
});

describe('treeKeyAction', () => {
  const rows: TreeRow[] = flattenTree(vault, new Set(['Campaign']));
  // ['Campaign', 'Campaign/NPCs', 'Campaign/Campaign.md', 'Home.md']

  it('walks the visible rows and stops at both ends', () => {
    expect(treeKeyAction('ArrowDown', rows, 0)).toStrictEqual({ type: 'focus', index: 1 });
    expect(treeKeyAction('ArrowUp', rows, 0)).toBeNull();
    expect(treeKeyAction('ArrowDown', rows, rows.length - 1)).toBeNull();
    expect(treeKeyAction('Home', rows, 2)).toStrictEqual({ type: 'focus', index: 0 });
    expect(treeKeyAction('End', rows, 0)).toStrictEqual({
      type: 'focus',
      index: rows.length - 1,
    });
  });

  it('opens a closed folder and descends into an open one', () => {
    expect(treeKeyAction('ArrowRight', rows, 1)).toStrictEqual({
      type: 'toggle',
      path: 'Campaign/NPCs',
    });
    expect(treeKeyAction('ArrowRight', rows, 0)).toStrictEqual({ type: 'focus', index: 1 });
    expect(treeKeyAction('ArrowRight', rows, 3)).toBeNull();
  });

  it('closes an open folder and climbs out of a closed one', () => {
    expect(treeKeyAction('ArrowLeft', rows, 0)).toStrictEqual({ type: 'toggle', path: 'Campaign' });
    expect(treeKeyAction('ArrowLeft', rows, 1)).toStrictEqual({ type: 'focus', index: 0 });
    expect(treeKeyAction('ArrowLeft', rows, 3)).toBeNull();
  });

  it('opens notes and toggles folders on Enter, and ignores other keys', () => {
    expect(treeKeyAction('Enter', rows, 3)).toStrictEqual({ type: 'open', path: 'Home.md' });
    expect(treeKeyAction('Enter', rows, 0)).toStrictEqual({ type: 'toggle', path: 'Campaign' });
    expect(treeKeyAction(' ', rows, 3)).toStrictEqual({ type: 'open', path: 'Home.md' });
    expect(treeKeyAction('a', rows, 0)).toBeNull();
    expect(treeKeyAction('Enter', rows, 99)).toBeNull();
  });
});
