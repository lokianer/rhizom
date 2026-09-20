// Nested tags such as `campaign/silverstadt/npcs` are grouped by their first segment so the
// panel can show one heading per topic instead of a flat list of long names.
import type { TagCount } from '@rhizom/core';

export interface TagGroup {
  /** First segment of every tag in the group. */
  name: string;
  /**
   * Notes counted per tag and added up. A note carrying both `campaign` and
   * `campaign/silverstadt` counts twice, which is what a "how much is written about this"
   * reading of the number wants.
   */
  total: number;
  tags: readonly TagCount[];
  /** True when the group is the single tag `name` itself and needs no heading. */
  flat: boolean;
}

/** Groups tags by their first segment; groups and their tags come back sorted by name. */
export function groupTags(tags: readonly TagCount[]): TagGroup[] {
  const groups = new Map<string, TagCount[]>();
  for (const tag of tags) {
    const name = tag.tag.split('/')[0] ?? tag.tag;
    const existing = groups.get(name);
    if (existing === undefined) {
      groups.set(name, [tag]);
    } else {
      existing.push(tag);
    }
  }

  return [...groups.entries()]
    .map(([name, entries]) => {
      const sorted = [...entries].sort((a, b) => BY_NAME.compare(a.tag, b.tag));
      return {
        name,
        total: sorted.reduce((sum, entry) => sum + entry.count, 0),
        tags: sorted,
        flat: sorted.length === 1 && sorted[0]?.tag === name,
      };
    })
    .sort((a, b) => BY_NAME.compare(a.name, b.name));
}

/** One collator, built once; `localeCompare` would build a fresh one for every comparison. */
const BY_NAME = new Intl.Collator();

/** What a chip inside a group shows: the tag without the group prefix it sits under. */
export function tagChipLabel(tag: string, group: string): string {
  return tag === group || !tag.startsWith(`${group}/`) ? tag : tag.slice(group.length + 1);
}
