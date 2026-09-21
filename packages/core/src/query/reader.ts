// Reading values out of the query body's YAML document tree. Every helper here answers with
// what it could read plus a complaint on the reader when it could not, because a block that is
// partly wrong still yields a query: a reader who mistyped one key is better served by their
// other four filters plus a sentence about the fifth than by an empty box.
//
// The document tree rather than the plain object, so that every complaint can name the line it
// is about, and so that an alias, an anchor or a tag the note invented is refused on sight.
import { isNode, isScalar, isSeq, type LineCounter } from 'yaml';

import type { QueryProblem } from './language.js';

/** What the readers below share: where a line is, and where a complaint goes. */
export interface Reader {
  lineCounter: LineCounter;
  problems: QueryProblem[];
  /** The line of the key being read, for a value that has no position of its own. */
  line: number;
}

/** One entry of a key that takes a list, with the line it was written on. */
export interface Entry {
  text: string;
  line: number;
}

/**
 * A scalar exactly as it was written. Nothing is trimmed here: YAML has already dropped the space
 * around everything that was not deliberately quoted, and what a note put in quotes it meant to
 * compare. `null` is refused on purpose — whether a missing field equals an empty one is a
 * decision for whoever asks the index, not one to guess at while reading a note.
 */
export function plainValue(node: unknown): string | number | boolean | undefined {
  if (!isScalar(node)) {
    return undefined;
  }
  const value: unknown = node.value;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/**
 * The entries of a key that takes a string or a list of strings. A single string is accepted
 * wherever a list is — one folder is the common case and should not need brackets. Entries are
 * trimmed, and empty ones are dropped rather than turned into a filter nothing matches.
 */
export function entries(node: unknown, key: string, reader: Reader): Entry[] {
  const label = `\`${key}\``;
  if (isSeq(node)) {
    const result: Entry[] = [];
    for (const item of node.items) {
      const text = textOf(item, label, reader)?.trim();
      if (text !== undefined && text !== '') {
        result.push({ text, line: lineOf(item, reader) });
      }
    }
    return result;
  }
  const text = textOf(node, label, reader)?.trim();
  return text === undefined || text === '' ? [] : [{ text, line: lineOf(node, reader) }];
}

/**
 * The text of a scalar. A key written with nothing after it says nothing and is simply dropped;
 * a mapping, a list or an alias where text belongs is reported.
 *
 * A number or a boolean is read as the word it was written with. YAML's types are an accident of
 * spelling — `from: 2026` is a number and `limit: "50"` is text, though both say exactly what
 * they mean — and a vault full of daily notes has folders that look like dates.
 */
export function textOf(node: unknown, label: string, reader: Reader): string | undefined {
  if (isEmpty(node)) {
    return undefined;
  }
  if (isScalar(node)) {
    const value: unknown = node.value;
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  reader.problems.push({ line: lineOf(node, reader), message: `${label} expects text.` });
  return undefined;
}

/** The number a scalar holds, whether or not the note put quotes around it. */
export function numberOf(node: unknown, label: string, reader: Reader): number | undefined {
  if (isEmpty(node)) {
    return undefined;
  }
  if (isScalar(node)) {
    const value: unknown = node.value;
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  reader.problems.push({ line: lineOf(node, reader), message: `${label} expects a number.` });
  return undefined;
}

/** `key:` with nothing after it, or an explicit `~`: not a mistake, just nothing to say. */
export function isEmpty(node: unknown): boolean {
  return node === null || (isScalar(node) && node.value === null);
}

/** The 1-based line a node starts on, falling back to the line of the key it belongs to. */
export function lineOf(node: unknown, reader: Reader): number {
  const start = isNode(node) ? node.range?.[0] : undefined;
  return start === undefined ? reader.line : reader.lineCounter.linePos(start).line;
}

/** Duplicates in a filter cost work and change nothing, so they are dropped. */
export function unique(values: string[]): string[] {
  return [...new Set(values)];
}
