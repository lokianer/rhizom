// Ranking and highlighting for the palette, kept apart from the component so it can be
// tested without a DOM. Commands are matched on their label, notes on their title and their
// path, whichever fits the query better.
import { fuzzyRank } from '@rhizom/core';

/** The part of a command the ranking needs; PaletteCommand satisfies it. */
export interface RankableCommand {
  id: string;
  label: string;
}

/** The part of a note the ranking needs; NoteSummary satisfies it. */
export interface RankableNote {
  path: string;
  title: string;
}

export interface Ranked<T> {
  item: T;
  /** Indices of the matched characters, for highlighting. */
  positions: readonly number[];
}

export interface RankedNote<T> extends Ranked<T> {
  /** Which text the positions point into. */
  field: 'title' | 'path';
}

export function rankCommands<T extends RankableCommand>(
  query: string,
  commands: readonly T[],
  limit: number,
): Ranked<T>[] {
  return fuzzyRank(query, commands, (command) => command.label, limit).map(
    ({ item, positions }) => ({ item, positions }),
  );
}

export function rankNotes<T extends RankableNote>(
  query: string,
  notes: readonly T[],
  limit: number,
): RankedNote<T>[] {
  if (query.trim() === '') {
    return notes.slice(0, limit).map((item) => ({ item, positions: [], field: 'title' }));
  }

  const best = new Map<T, RankedNote<T> & { score: number }>();
  for (const ranked of fuzzyRank(query, notes, (note) => note.title)) {
    best.set(ranked.item, { ...ranked, field: 'title' });
  }
  // A path match only wins when it beats the title match, so `Mira` stays ahead of
  // `Campaign/NPCs/Something` for the query "mira".
  for (const ranked of fuzzyRank(query, notes, (note) => note.path)) {
    const found = best.get(ranked.item);
    if (found === undefined || ranked.score > found.score) {
      best.set(ranked.item, { ...ranked, field: 'path' });
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, positions, field }) => ({ item, positions, field }));
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Splits a text into matched and unmatched runs, in order. */
export function highlightSegments(text: string, positions: readonly number[]): HighlightSegment[] {
  if (text === '') {
    return [];
  }
  if (positions.length === 0) {
    return [{ text, match: false }];
  }
  const matched = new Set(positions);
  const segments: HighlightSegment[] = [];
  let run = '';
  let runMatch = matched.has(0);
  for (let index = 0; index < text.length; index += 1) {
    const isMatch = matched.has(index);
    if (isMatch !== runMatch) {
      segments.push({ text: run, match: runMatch });
      run = '';
      runMatch = isMatch;
    }
    run += text.charAt(index);
  }
  segments.push({ text: run, match: runMatch });
  return segments;
}

/** The next option the arrow keys reach, wrapping around; -1 when there are none. */
export function wrapIndex(index: number, delta: number, count: number): number {
  if (count <= 0) {
    return -1;
  }
  if (index < 0) {
    return delta >= 0 ? 0 : count - 1;
  }
  return (((index + delta) % count) + count) % count;
}
