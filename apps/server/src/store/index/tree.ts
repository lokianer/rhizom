// The vault as folders. Built in one pass over the note list rather than from the file system,
// so that what the sidebar shows and what the index knows cannot drift apart.
import type { TreeEntry } from '@rhizom/core';

import type { IndexContext } from './context.js';
import { notes } from '../schema.js';

export function tree(ctx: IndexContext): TreeEntry[] {
  const root: TreeEntry[] = [];
  const folders = new Map<string, TreeEntry[]>([['', root]]);
  const folderChildren = (folder: string): TreeEntry[] => {
    const existing = folders.get(folder);
    if (existing) {
      return existing;
    }
    const slash = folder.lastIndexOf('/');
    const parent = folderChildren(slash === -1 ? '' : folder.slice(0, slash));
    const children: TreeEntry[] = [];
    parent.push({
      type: 'folder',
      name: folder.slice(slash + 1),
      path: folder,
      children,
    });
    folders.set(folder, children);
    return children;
  };
  for (const note of ctx.db
    .select({ path: notes.path, name: notes.name, title: notes.title, folder: notes.folder })
    .from(notes)
    .all()) {
    folderChildren(note.folder).push({
      type: 'note',
      name: note.name,
      path: note.path,
      title: note.title,
    });
  }
  for (const children of folders.values()) {
    children.sort(compareTreeEntries);
  }
  return root;
}

export const BY_TREE_NAME = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  if (a.type !== b.type) {
    return a.type === 'folder' ? -1 : 1;
  }
  return BY_TREE_NAME.compare(a.name, b.name);
}
