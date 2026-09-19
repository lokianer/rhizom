// Shaping for the mentions panel: which mentions are selected and what a batch write asks for.
// Kept apart from the component because the web unit tests run without a DOM, so anything worth
// asserting has to be a plain function.
import type { MentionGroup, MentionWrite } from '@rhizom/core';

/** A mention is identified by the note it sits in and where in it — unique within a scan. */
export type MentionKey = string;

export function keyOf(source: string, start: number): MentionKey {
  return `${source}:${String(start)}`;
}

/**
 * Every mention a batch could write: the ones a link can actually go around. A mention in a
 * heading is offered, because moving an anchor is the reader's call, but one broken across a
 * line is not, because no wikilink may contain a line break.
 */
export function linkableKeys(groups: readonly MentionGroup[]): MentionKey[] {
  return groups.flatMap((group) =>
    group.mentions
      .filter((mention) => mention.linkable)
      .map((mention) => keyOf(group.source, mention.start)),
  );
}

/**
 * The selection after a fresh scan.
 *
 * A mention the panel has offered before keeps the answer it was given — an unticked box is an
 * answer, and the scan runs again for reasons the reader had nothing to do with: any note in the
 * vault being saved. A mention nobody has seen yet starts ticked, because the usual answer is
 * "all of them". Anything no longer in the scan falls out with it.
 */
export function keepSelection(
  previous: ReadonlySet<MentionKey>,
  linkable: readonly MentionKey[],
  offered: ReadonlySet<MentionKey>,
): Set<MentionKey> {
  return new Set(linkable.filter((key) => !offered.has(key) || previous.has(key)));
}

/** How many mentions there are in total, whether or not they can be linked. */
export function countMentions(groups: readonly MentionGroup[]): number {
  return groups.reduce((total, group) => total + group.mentions.length, 0);
}

/**
 * Turns a selection into the writes the server expects: one entry per note, carrying the hash
 * that note was scanned at. A note whose mentions are all deselected is left out entirely, so
 * a batch never touches a file it has nothing to change in.
 */
export function writesFor(
  groups: readonly MentionGroup[],
  selected: ReadonlySet<MentionKey>,
): MentionWrite[] {
  const writes: MentionWrite[] = [];
  for (const group of groups) {
    const offsets = group.mentions
      .filter((mention) => mention.linkable && selected.has(keyOf(group.source, mention.start)))
      .map((mention) => mention.start);
    if (offsets.length > 0) {
      writes.push({ source: group.source, hash: group.hash, offsets });
    }
  }
  return writes;
}

/** How many notes a batch would write, for a confirmation that names a number. */
export function noteCount(writes: readonly MentionWrite[]): number {
  return writes.length;
}
