// Query blocks: what a ```rhizom-query fence asks the index for, read out of the note as data.
//
// A vault travels. It arrives as a git clone, as a shared Obsidian folder, as a colleague's zip,
// and Rhizom opens it without asking where it has been. So a query block is read, never run:
// there are no expressions, no function calls, no regular expressions the note supplies, no field
// paths that walk an object graph. Everything below turns text into a description of a filter —
// a list of folders, a list of tags, a substring, some equalities — and the index answers it.
// Nothing in a query body ever reaches a `RegExp` constructor, `eval`, a template or a shell.
//
// The key set is closed, and a key outside it is an error the reader sees rather than something
// guessed at. That is what makes the language safe to extend: `or` can be added later on purpose,
// and until then a note asking for it is told so instead of quietly getting an `and`.
//
// The body is YAML, because the frontmatter three lines above it already is and nobody should
// have to learn a second syntax for the same vault. It is read from the document tree rather than
// from the plain object, so that every complaint can name the line it is about — and so that an
// alias, an anchor or a tag the note invented is refused on sight, before it is ever expanded.
//
// A block that is partly wrong still yields a query. A reader who mistyped one key is better
// served by their other four filters plus a sentence about the fifth than by an empty box.
import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

import { NOTE_TYPES } from './frontmatter.js';
import { toVaultPath } from './paths.js';

/** The info string of a fenced code block that holds a query. */
export const QUERY_LANGUAGE = 'rhizom-query';

/** Every key a query understands. Nothing else is accepted; see the note at the top. */
export const QUERY_KEYS: readonly string[] = [
  'from',
  'type',
  'tag',
  'title',
  'linksTo',
  'where',
  'sort',
  'limit',
  'as',
  'columns',
];

/** What the results are ordered by. */
export type QuerySort = 'title' | 'path' | 'modified' | 'created';

export const QUERY_SORTS: readonly QuerySort[] = ['title', 'path', 'modified', 'created'];

/** How the results are drawn. */
export type QueryView = 'list' | 'table' | 'cards';

export const QUERY_VIEWS: readonly QueryView[] = ['list', 'table', 'cards'];

/**
 * The columns a table can show without asking the note for anything. Any other column name is
 * read as a frontmatter field, which is why this list is not closed the way the key set is.
 */
export const BUILT_IN_COLUMNS: readonly string[] = [
  'title',
  'path',
  'folder',
  'tags',
  'modified',
  'size',
];

const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

/**
 * A query as the index will answer it. Every filter is ANDed; within one filter a list means
 * "any of these". An empty list is not a filter at all, not a filter nothing satisfies.
 */
export interface Query {
  /** Vault folders to look in; a note in a folder below one of them counts. Empty: everywhere. */
  folders: string[];
  /** Reserved `type:` values, from NOTE_TYPES. */
  types: string[];
  /** Tags, lower-cased and without the `#`; a parent tag matches its children. */
  tags: string[];
  /** A plain substring of the title, matched case-insensitively. Never a pattern. */
  title: string | null;
  /** Notes that must be linked to, as a vault path or a note name. */
  linksTo: string[];
  /** Frontmatter equalities; several values mean "any of these". */
  where: { key: string; values: (string | number | boolean)[] }[];
  sort: QuerySort;
  descending: boolean;
  limit: number;
  view: QueryView;
  columns: string[];
}

export interface QueryProblem {
  /** 1-based line inside the block body, 0 when the problem is the body as a whole. */
  line: number;
  /** What went wrong, in one sentence a reader of the note can act on. */
  message: string;
}

export interface ParsedQuery {
  /** Always present, holding the defaults plus whatever was understood. */
  query: Query;
  problems: QueryProblem[];
}

/** What the readers below share: where a line is, and where a complaint goes. */
interface Reader {
  lineCounter: LineCounter;
  problems: QueryProblem[];
  /** The line of the key being read, for a value that has no position of its own. */
  line: number;
}

/** One entry of a key that takes a list, with the line it was written on. */
interface Entry {
  text: string;
  line: number;
}

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

/** Parses the body of a `rhizom-query` block. Never throws; what it cannot read it reports. */
export function parseQuery(body: string): ParsedQuery {
  const query: Query = {
    folders: [],
    types: [],
    tags: [],
    title: null,
    linksTo: [],
    where: [],
    sort: 'title',
    descending: false,
    limit: DEFAULT_LIMIT,
    view: 'list',
    columns: [],
  };
  const problems: QueryProblem[] = [];
  if (body.trim() === '') {
    return { query, problems };
  }

  const lineCounter = new LineCounter();
  const document = parseDocument(body, { lineCounter });
  const reader: Reader = { lineCounter, problems, line: 0 };
  // Warnings come along with the errors: an unresolved tag or an unsupported YAML version is
  // exactly the sort of thing a reader wants to hear about before wondering why a table is empty.
  for (const error of [...document.errors, ...document.warnings]) {
    problems.push({
      line: lineCounter.linePos(error.pos[0]).line,
      // yaml prints the offending lines under its message once a line counter is in play. That
      // belongs in a terminal, not next to a rendered table, so only the sentence is kept.
      message: (error.message.split('\n')[0] ?? error.message).replace(/:$/, ''),
    });
  }

  const contents: unknown = document.contents;
  if (contents === null) {
    // A body of nothing but comments asks for nothing in particular, which is a whole vault.
    return { query, problems };
  }
  if (!isMap(contents)) {
    problems.push({
      line: 0,
      message: 'A query is written as `key: value` lines, one key per line.',
    });
    return { query, problems };
  }

  let columnsLine = 0;
  for (const pair of contents.items) {
    reader.line = 0;
    const keyLine = lineOf(pair.key, reader);
    reader.line = keyLine;
    const written = textOf(pair.key, 'A query key', reader);
    if (written === undefined) {
      continue;
    }
    // Folded, because a closed set of ten words has no collisions when case is ignored, and
    // refusing `LinksTo` would teach a reader nothing they could not have been told silently.
    const key = written.trim().toLowerCase();
    switch (key) {
      case 'from':
        query.folders = folders(pair.value, reader);
        break;
      case 'type':
        query.types = types(pair.value, reader);
        break;
      case 'tag':
        query.tags = tags(pair.value, reader);
        break;
      case 'title':
        query.title = title(pair.value, reader);
        break;
      case 'linksto':
        query.linksTo = linksTo(pair.value, reader);
        break;
      case 'where':
        query.where = whereClauses(pair.value, reader);
        break;
      case 'sort':
        sort(pair.value, reader, query);
        break;
      case 'limit':
        limit(pair.value, reader, query);
        break;
      case 'as':
        view(pair.value, reader, query);
        break;
      case 'columns':
        columnsLine = keyLine;
        query.columns = columns(pair.value, reader);
        break;
      default:
        problems.push({
          line: keyLine,
          message: `\`${written.trim()}\` is not a query key. A query understands ${QUERY_KEYS.join(', ')}.`,
        });
        break;
    }
  }

  // Said last, because `as:` may stand below `columns:` and a complaint about the order of two
  // lines the reader wrote is not a complaint worth making.
  if (query.columns.length > 0 && query.view !== 'table') {
    problems.push({
      line: columnsLine,
      message: '`columns` are only shown by `as: table`.',
    });
  }

  return { query, problems };
}

/** `from`: the folders to look in. */
function folders(node: unknown, reader: Reader): string[] {
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
function types(node: unknown, reader: Reader): string[] {
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
function tags(node: unknown, reader: Reader): string[] {
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
function title(node: unknown, reader: Reader): string | null {
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
function linksTo(node: unknown, reader: Reader): string[] {
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
function whereClauses(node: unknown, reader: Reader): Query['where'] {
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

/**
 * A scalar exactly as it was written. Nothing is trimmed here: YAML has already dropped the space
 * around everything that was not deliberately quoted, and what a note put in quotes it meant to
 * compare. `null` is refused on purpose — whether a missing field equals an empty one is a
 * decision for whoever asks the index, not one to guess at while reading a note.
 */
function plainValue(node: unknown): string | number | boolean | undefined {
  if (!isScalar(node)) {
    return undefined;
  }
  const value: unknown = node.value;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/** `sort`: one of the four orders, with a leading `-` for descending. */
function sort(node: unknown, reader: Reader, query: Query): void {
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
function limit(node: unknown, reader: Reader, query: Query): void {
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
function view(node: unknown, reader: Reader, query: Query): void {
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
function columns(node: unknown, reader: Reader): string[] {
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

/**
 * The entries of a key that takes a string or a list of strings. A single string is accepted
 * wherever a list is — one folder is the common case and should not need brackets. Entries are
 * trimmed, and empty ones are dropped rather than turned into a filter nothing matches.
 */
function entries(node: unknown, key: string, reader: Reader): Entry[] {
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
function textOf(node: unknown, label: string, reader: Reader): string | undefined {
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
function numberOf(node: unknown, label: string, reader: Reader): number | undefined {
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
function isEmpty(node: unknown): boolean {
  return node === null || (isScalar(node) && node.value === null);
}

/** The 1-based line a node starts on, falling back to the line of the key it belongs to. */
function lineOf(node: unknown, reader: Reader): number {
  const start = isNode(node) ? node.range?.[0] : undefined;
  return start === undefined ? reader.line : reader.lineCounter.linePos(start).line;
}

/** Duplicates in a filter cost work and change nothing, so they are dropped. */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
