// One reader per key a query understands. Each one takes the node written under its key and
// returns the filter it describes, or nothing plus a complaint when the note wrote something
// the key does not take. A key is never guessed at and never run: what comes back is a list of
// folders, a list of tags, a substring, some equalities — never an expression.
import { isMap, isSeq } from 'yaml';

import { NOTE_TYPES } from '../vault/frontmatter.js';
import { toVaultPath } from '../vault/paths.js';
import { BUILT_IN_COLUMNS, QUERY_SORTS, QUERY_VIEWS, type Query } from './language.js';
import {
  entries,
  isEmpty,
  lineOf,
  numberOf,
  plainValue,
  textOf,
  unique,
  type Reader,
} from './reader.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

const NOTE_TYPE_NAMES: ReadonlySet<string> = new Set(NOTE_TYPES);

/**
 * A tag as the indexer records one: letters, digits, `_`, `-` and `/`, with at least one
 * character that is not a digit. The rule is parse.ts's, because a query that spells a tag
 * differently from the file it is looking for finds nothing and says nothing about why.
 */
const TAG_SHAPE = /^[\p{L}\p{N}_/-]+$/u;
const TAG_HAS_LETTER = /[\p{L}_/-]/u;

/**
 * The characters a path expression would be built from. A `where` key and a column name are one
 * frontmatter field each, so `author.name` and `tags[0]` are refused rather than read as a walk
 * into a value — that walk is the expression language this format does not have.
 */
const PATH_SYNTAX = /[.[\]]/;

/** `from`: the folders to look in. */
export function folders(node: unknown, reader: Reader): string[] {
  const result: string[] = [];
  for (const entry of entries(node, 'from', reader)) {
    const folder = toVaultPath(entry.text);
    if (folder === '') {
      continue;
    }
    // toVaultPath keeps `..` so that it can be refused rather than quietly resolved. Nothing
    // here opens a file — the index answers the query — but a folder outside the vault can only
    // ever match nothing, and a reader deserves to be told that instead of shown an empty table.
    if (folder.split('/').includes('..')) {
      reader.problems.push({
        line: entry.line,
        message: `\`from: ${entry.text}\` leaves the vault; a query looks inside it.`,
      });
      continue;
    }
    // The written case is kept: isInFolder compares folded, so a query may say `Templates`
    // where the disk says `templates`.
    result.push(folder);
  }
  return unique(result);
}

/** `type`: the reserved `type:` values in the frontmatter. */
export function types(node: unknown, reader: Reader): string[] {
  const result: string[] = [];
  for (const entry of entries(node, 'type', reader)) {
    const type = entry.text.toLowerCase();
    if (NOTE_TYPE_NAMES.has(type)) {
      result.push(type);
    } else {
      reader.problems.push({
        line: entry.line,
        message: `\`${entry.text}\` is not a note type. The types are ${NOTE_TYPES.join(', ')}.`,
      });
    }
  }
  return unique(result);
}

/** `tag`: tags as the index records them, with the `#` optional and the case irrelevant. */
export function tags(node: unknown, reader: Reader): string[] {
  const result: string[] = [];
  for (const entry of entries(node, 'tag', reader)) {
    // A trailing slash is dropped so that `campaign/` and `campaign` ask the same question:
    // both mean the tag and everything below it.
    const tag = entry.text.replace(/^#+/, '').replace(/\/+$/, '').trim().toLowerCase();
    if (tag === '') {
      continue;
    }
    if (!TAG_SHAPE.test(tag) || !TAG_HAS_LETTER.test(tag)) {
      reader.problems.push({
        line: entry.line,
        message: `\`${entry.text}\` is not a tag. A tag looks like \`campaign/npcs\`, with or without the \`#\`.`,
      });
      continue;
    }
    result.push(tag);
  }
  return unique(result);
}

/** `title`: one substring, matched case-insensitively by whoever runs the query. */
export function title(node: unknown, reader: Reader): string | null {
  if (isSeq(node)) {
    reader.problems.push({
      line: lineOf(node, reader),
      message: '`title` matches one substring, not a list of them.',
    });
    return null;
  }
  const text = textOf(node, '`title`', reader)?.trim();
  // Whatever it says is a substring and nothing else. `.*` is three characters to look for.
  return text === undefined || text === '' ? null : text;
}

/** `linksTo`: the notes a result must link to. */
export function linksTo(node: unknown, reader: Reader): string[] {
  const result: string[] = [];
  for (const entry of entries(node, 'linksTo', reader)) {
    // A link target is matched, not opened, and may be written as a path or as a bare note name.
    // toVaultPath only settles the slashes and the unicode form, which both spellings want.
    const target = toVaultPath(entry.text);
    if (target !== '') {
      result.push(target);
    }
  }
  return unique(result);
}

/** `where`: frontmatter equalities, one field each. */
export function whereClauses(node: unknown, reader: Reader): Query['where'] {
  if (isEmpty(node)) {
    return [];
  }
  if (!isMap(node)) {
    reader.problems.push({
      line: lineOf(node, reader),
      message: '`where` is a mapping of frontmatter fields to the values they must have.',
    });
    return [];
  }

  const result: Query['where'] = [];
  for (const pair of node.items) {
    const keyLine = lineOf(pair.key, reader);
    reader.line = keyLine;
    const field = textOf(pair.key, 'A `where` field', reader)?.trim();
    if (field === undefined || field === '') {
      continue;
    }
    if (PATH_SYNTAX.test(field)) {
      reader.problems.push({
        line: keyLine,
        message: `\`where\` compares one frontmatter field; \`${field}\` reads like a path into a value.`,
      });
      continue;
    }
    const values = whereValues(pair.value, field, reader);
    if (values.length > 0) {
      result.push({ key: field, values });
    }
  }
  return result;
}

/** The value, or values, one `where` field is compared against. */
function whereValues(node: unknown, field: string, reader: Reader): (string | number | boolean)[] {
  const complain = (line: number) => {
    reader.problems.push({
      line,
      message: `\`where: ${field}\` compares a plain value: text, a number, true or false, or a list of those.`,
    });
  };

  if (isSeq(node)) {
    if (node.items.length === 0) {
      complain(lineOf(node, reader));
      return [];
    }
    const values: (string | number | boolean)[] = [];
    for (const item of node.items) {
      const value = plainValue(item);
      if (value === undefined) {
        complain(lineOf(item, reader));
      } else {
        values.push(value);
      }
    }
    return values;
  }

  const value = plainValue(node);
  if (value === undefined) {
    complain(lineOf(node, reader));
    return [];
  }
  return [value];
}

/** `sort`: one of the four orders, with a leading `-` for descending. */
export function sort(node: unknown, reader: Reader, query: Query): void {
  const text = textOf(node, '`sort`', reader)?.trim();
  if (text === undefined || text === '') {
    return;
  }
  const descending = text.startsWith('-');
  const name = (descending ? text.slice(1) : text).trim().toLowerCase();
  const order = QUERY_SORTS.find((candidate) => candidate === name);
  if (order === undefined) {
    reader.problems.push({
      line: lineOf(node, reader),
      message: `\`sort: ${text}\` is not an order. Sort by ${QUERY_SORTS.join(', ')}, with a leading \`-\` for descending.`,
    });
    return;
  }
  query.sort = order;
  query.descending = descending;
}

/** `limit`: how many results at most. */
export function limit(node: unknown, reader: Reader, query: Query): void {
  const value = numberOf(node, '`limit`', reader);
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
    // The default stands rather than the nearest allowed number: clamping 5000 to 500 would be
    // a guess at what was wanted, and the reader is being told either way.
    reader.problems.push({
      line: lineOf(node, reader),
      message: `\`limit\` is a whole number between ${String(MIN_LIMIT)} and ${String(MAX_LIMIT)}.`,
    });
    return;
  }
  query.limit = value;
}

/** `as`: how the results are drawn. */
export function view(node: unknown, reader: Reader, query: Query): void {
  const text = textOf(node, '`as`', reader)?.trim();
  if (text === undefined || text === '') {
    return;
  }
  const chosen = QUERY_VIEWS.find((candidate) => candidate === text.toLowerCase());
  if (chosen === undefined) {
    reader.problems.push({
      line: lineOf(node, reader),
      message: `\`as: ${text}\` is not a view. A query is shown as ${QUERY_VIEWS.join(', ')}.`,
    });
    return;
  }
  query.view = chosen;
}

/** `columns`: what a table shows, built-in or read from the frontmatter. */
export function columns(node: unknown, reader: Reader): string[] {
  const result: string[] = [];
  for (const entry of entries(node, 'columns', reader)) {
    if (PATH_SYNTAX.test(entry.text)) {
      reader.problems.push({
        line: entry.line,
        message: `A column is one field; \`${entry.text}\` reads like a path into a value.`,
      });
      continue;
    }
    // A built-in column is stored in its canonical spelling so that `Title` works, while any
    // other name keeps the case it was written in: it is a frontmatter key, and those are the
    // note's own words.
    const builtIn = BUILT_IN_COLUMNS.find((candidate) => candidate === entry.text.toLowerCase());
    result.push(builtIn ?? entry.text);
  }
  return unique(result);
}
