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
import { isMap, LineCounter, parseDocument } from 'yaml';

import {
  columns,
  folders,
  limit,
  linksTo,
  sort,
  tags,
  title,
  types,
  view,
  whereClauses,
} from './clauses.js';
import { lineOf, textOf, type Reader } from './reader.js';

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

/** How many results a query returns when it does not say. */
const DEFAULT_LIMIT = 100;

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
