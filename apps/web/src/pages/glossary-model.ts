// Shaping for the glossary page, kept apart from the component so it can be tested: the web
// unit tests run without a DOM, so anything worth asserting has to be a plain function.
import type { GlossaryEntry } from '@rhizom/core';

export interface GlossaryGroup {
  /** The letter the titles in this group start with, or `#` for anything that is not one. */
  letter: string;
  entries: GlossaryEntry[];
}

/**
 * Groups the glossary by first letter, in the order the server already sorted it. Grouping is
 * by the *base* letter, so `Über` sits with `U` rather than alone at the end, and anything that
 * does not start with a letter — a number, a symbol — collects under `#`.
 */
export function groupByLetter(entries: readonly GlossaryEntry[]): GlossaryGroup[] {
  const groups: GlossaryGroup[] = [];
  for (const entry of entries) {
    const letter = letterOf(entry.title);
    const last = groups[groups.length - 1];
    if (last?.letter === letter) {
      last.entries.push(entry);
    } else {
      groups.push({ letter, entries: [entry] });
    }
  }
  return groups;
}

function letterOf(title: string): string {
  const first = [...title.trim()][0];
  if (first === undefined) {
    return '#';
  }
  // Decomposing separates a letter from its accent, so Ä and A land in the same group; the
  // accent itself is a combining mark and is dropped by the letter test below. Iterated by code
  // point, or a letter outside the basic plane would yield half a surrogate pair.
  const base = [...first.normalize('NFD')][0] ?? first;
  // `toUpperCase`, not its locale variant: a vault must group the same on every machine, and
  // Turkish would otherwise file `i` under `İ`.
  return /\p{L}/u.test(base) ? base.toUpperCase() : '#';
}
