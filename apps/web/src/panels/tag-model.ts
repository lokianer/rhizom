// Tags are a hierarchy: `campaign/silverstadt/npcs` is three levels, not one long word. The
// panel shows them as one, and asking for a level asks for everything below it — being shown
// only the notes that wrote exactly `campaign`, while `campaign/npcs` counts as an unrelated
// word, is the reading nobody means.
//
// A level may exist only as a prefix: a vault with `campaign/npcs` and `campaign/places` and no
// bare `campaign` still has a campaign, and it is worth a row, because that row is how you ask
// for both at once.
import type { TagCount } from '@rhizom/core';

/** One level of the tag hierarchy. */
export interface TagNode {
  /** The whole tag as a note writes it, e.g. `campaign/silverstadt`. */
  tag: string;
  /** The last segment, which is what the chip shows. */
  name: string;
  /** How many notes wrote exactly this tag; zero for a level that only exists as a prefix. */
  count: number;
  /**
   * The same, plus everything below it. A note carrying both `campaign` and `campaign/npcs`
   * counts twice, which is what a "how much is written about this" reading of the number wants.
   */
  total: number;
  children: TagNode[];
}

/** One collator, built once; `localeCompare` would build a fresh one for every comparison. */
const BY_NAME = new Intl.Collator();

/**
 * The tags as a tree, every level sorted by name. Levels nobody wrote are filled in, so a vault
 * that only has `campaign/npcs` still gets a `campaign` to ask by.
 */
export function buildTagTree(tags: readonly TagCount[]): TagNode[] {
  const roots: TagNode[] = [];
  const byTag = new Map<string, TagNode>();

  const nodeFor = (tag: string): TagNode => {
    const existing = byTag.get(tag);
    if (existing !== undefined) {
      return existing;
    }
    const slash = tag.lastIndexOf('/');
    const node: TagNode = { tag, name: tag.slice(slash + 1), count: 0, total: 0, children: [] };
    byTag.set(tag, node);
    if (slash === -1) {
      roots.push(node);
    } else {
      nodeFor(tag.slice(0, slash)).children.push(node);
    }
    return node;
  };

  for (const entry of tags) {
    // An empty segment would make a level with no name, and `a//b` is a typo rather than two
    // levels; the indexer already folds those away, and this keeps the tree honest anyway.
    const tag = entry.tag.split('/').filter(Boolean).join('/');
    if (tag !== '') {
      nodeFor(tag).count += entry.count;
    }
  }

  for (const node of byTag.values()) {
    for (let at: string | null = node.tag; at !== null; at = parentOf(at)) {
      const ancestor = byTag.get(at);
      if (ancestor !== undefined) {
        ancestor.total += node.count;
      }
    }
  }

  sortLevel(roots);
  return roots;
}

function parentOf(tag: string): string | null {
  const slash = tag.lastIndexOf('/');
  return slash === -1 ? null : tag.slice(0, slash);
}

function sortLevel(nodes: TagNode[]): void {
  nodes.sort((a, b) => BY_NAME.compare(a.name, b.name));
  for (const node of nodes) {
    sortLevel(node.children);
  }
}

/** Whether a tag is the one asked for, or anything below it. */
export function isUnderTag(tag: string, asked: string): boolean {
  return tag === asked || tag.startsWith(`${asked}/`);
}

/**
 * Whether a note answers to any of the tags asked for. Asking for `campaign` finds a note that
 * only ever wrote `campaign/silverstadt/npcs`, which is the whole point of writing tags that way.
 */
export function matchesTags(noteTags: readonly string[], asked: readonly string[]): boolean {
  return asked.some((tag) => noteTags.some((carried) => isUnderTag(carried, tag)));
}
