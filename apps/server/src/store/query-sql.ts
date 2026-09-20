// Running a `rhizom-query` block against the index.
//
// The filters split in two. Folder, tag, title and `linksTo` are selective and have an index
// behind them, so they go into the SQL and cut the row set down before anything is read. Type
// and `where` both need the note's frontmatter, which is a JSON column, so they are decided in
// JavaScript over what is left — the same values the columns then render, parsed once.
//
// Nothing from the note reaches SQLite as SQL. Every value is a bound parameter, and the two
// places a value becomes part of a pattern (a folder prefix, a title substring) escape the
// characters LIKE spends on something else. A query block is data that is read; that promise is
// kept here as much as in the parser.
import { noteTypeOf, type Query, type QueryRow } from '@rhizom/core';

/** One note as the index hands it over, before the columns are rendered. */
export interface QueryCandidate {
  path: string;
  title: string;
  folder: string;
  modifiedAt: number;
  size: number;
  frontmatter: string;
  tags: string | null;
}

const TAG_SEPARATOR = String.fromCharCode(31);

/** The SQL a query narrows to, and the parameters it is bound with. */
export interface QuerySql {
  sql: string;
  parameters: (string | number)[];
  /** True when a filter can match nothing at all, so the query need not be run. */
  empty: boolean;
}

/**
 * The `where` clause of a query, with its parameters.
 *
 * `linksTo` is resolved by the caller, because only the caller has the resolver: a query may
 * name a note by its path or by its name, exactly as a link may. A `linksTo` that resolves to
 * nothing cannot match anything, and saying so here is cheaper than running the query.
 */
export function queryToSql(query: Query, linkTargets: readonly string[]): QuerySql {
  const clauses: string[] = [];
  const parameters: (string | number)[] = [];

  if (query.folders.length > 0) {
    const parts: string[] = [];
    for (const folder of query.folders) {
      // The folder itself and everything below it; compared folded, because a setting that says
      // `Campaign` has to find `campaign/` on a file system that does not care about the case.
      parts.push("(rz_lower(n.folder) = rz_lower(?) or rz_lower(n.folder) like ? escape '\\')");
      parameters.push(folder, `${likePattern(folder.toLowerCase())}/%`);
    }
    clauses.push(`(${parts.join(' or ')})`);
  }

  if (query.tags.length > 0) {
    const parts: string[] = [];
    for (const tag of query.tags) {
      // A parent tag matches its children: `campaign` finds `campaign/npcs`. Tags are stored
      // folded already, so only the pattern needs escaping.
      parts.push(
        "exists (select 1 from note_tags t where t.path = n.path and (t.tag = ? or t.tag like ? escape '\\'))",
      );
      parameters.push(tag, `${likePattern(tag)}/%`);
    }
    clauses.push(`(${parts.join(' or ')})`);
  }

  if (query.title !== null) {
    clauses.push("rz_lower(n.title) like ? escape '\\'");
    parameters.push(`%${likePattern(query.title.toLowerCase())}%`);
  }

  if (query.linksTo.length > 0) {
    if (linkTargets.length === 0) {
      return { sql: '', parameters: [], empty: true };
    }
    const placeholders = linkTargets.map(() => '?').join(', ');
    clauses.push(
      `exists (select 1 from links l where l.source = n.path and l.target in (${placeholders}))`,
    );
    parameters.push(...linkTargets);
  }

  const where = clauses.length === 0 ? '' : ` where ${clauses.join(' and ')}`;
  return {
    sql: `select n.path, n.title, n.folder, n.modified_at as modifiedAt, n.size, n.frontmatter,
        (select group_concat(t.tag, char(31)) from note_tags t where t.path = n.path) as tags
 from notes n${where}`,
    parameters,
    empty: false,
  };
}

/** Escapes the two characters LIKE spends on itself, plus the escape character. */
function likePattern(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/** One candidate with its frontmatter read, which both the remaining filters and the columns need. */
export interface QueryNote {
  path: string;
  title: string;
  folder: string;
  modifiedAt: number;
  size: number;
  tags: string[];
  frontmatter: Record<string, unknown>;
}

export function toQueryNote(row: QueryCandidate): QueryNote {
  return {
    path: row.path,
    title: row.title,
    folder: row.folder,
    modifiedAt: row.modifiedAt,
    size: row.size,
    tags: row.tags === null ? [] : row.tags.split(TAG_SEPARATOR).sort(),
    frontmatter: readFrontmatter(row.frontmatter),
  };
}

function readFrontmatter(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The filters that need the frontmatter: the reserved `type` key, and `where`. */
export function matchesFrontmatter(note: QueryNote, query: Query): boolean {
  if (query.types.length > 0) {
    const type = noteTypeOf(note.frontmatter);
    if (type === undefined || !query.types.includes(type)) {
      return false;
    }
  }
  return query.where.every((condition) =>
    condition.values.some((wanted) => holds(note.frontmatter[condition.key], wanted)),
  );
}

/**
 * Whether a frontmatter value answers to what the query asked for. A list answers when one of
 * its entries does, because `status: [draft, review]` is a note that is both; strings are
 * compared folded, since nobody writing `status: Draft` means a different note from `draft`.
 */
function holds(value: unknown, wanted: string | number | boolean): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => holds(entry, wanted));
  }
  if (typeof value === 'string' && typeof wanted === 'string') {
    return value.trim().toLowerCase() === wanted.trim().toLowerCase();
  }
  if (value instanceof Date && typeof wanted === 'string') {
    return isoDate(value) === wanted.trim();
  }
  return value === wanted;
}

/**
 * Sorts the matches. Every comparison ends in the path, which is unique, so two runs of the
 * same query on two machines put the notes in the same order — SQLite would otherwise hand
 * them back in whatever order it scanned.
 */
export function sortNotes(notes: QueryNote[], query: Query): QueryNote[] {
  const direction = query.descending ? -1 : 1;
  return [...notes].sort((a, b) => {
    const decided = compare(a, b, query.sort) * direction;
    return decided !== 0 ? decided : a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

function compare(a: QueryNote, b: QueryNote, by: Query['sort']): number {
  switch (by) {
    case 'path':
      // Code units rather than a locale: a vault has to read the same on every machine.
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    case 'modified':
      return a.modifiedAt - b.modifiedAt;
    case 'created': {
      // The index has no creation time — the file system's is a lie after any copy or checkout,
      // and keeping one would cost every installation a rebuild. So `created` is the note's own
      // `created:` field, and a note that does not declare one sorts last either way round.
      const first = createdAt(a);
      const second = createdAt(b);
      if (first === undefined || second === undefined) {
        return first === second ? 0 : first === undefined ? 1 : -1;
      }
      return first - second;
    }
    default:
      return BY_TITLE.compare(a.title, b.title);
  }
}

/**
 * One collator, built once. `String.prototype.localeCompare` builds a fresh one on every call,
 * which is most of the time an unfiltered query over a large vault spends: sorting five
 * thousand titles went from 130 ms to a few, and the whole point of the budget is that a query
 * block in a note renders without the page waiting for it.
 */
const BY_TITLE = new Intl.Collator(undefined, { sensitivity: 'base' });

function createdAt(note: QueryNote): number | undefined {
  const value = note.frontmatter.created;
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN;
  return Number.isNaN(time) ? undefined : time;
}

/** A note as a row, with the columns the query asked for rendered as text. */
export function toRow(note: QueryNote, columns: readonly string[]): QueryRow {
  const fields: Record<string, string> = {};
  for (const column of columns) {
    if (!BUILT_IN.has(column)) {
      fields[column] = render(note.frontmatter[column]);
    }
  }
  return {
    path: note.path,
    title: note.title,
    folder: note.folder,
    tags: note.tags,
    modifiedAt: new Date(note.modifiedAt).toISOString(),
    size: note.size,
    fields,
  };
}

const BUILT_IN: ReadonlySet<string> = new Set([
  'title',
  'path',
  'folder',
  'tags',
  'modified',
  'size',
]);

/**
 * One frontmatter value as a table cell. A nested mapping renders as nothing rather than as
 * `[object Object]`: a table that cannot show a thing should say nothing about it.
 */
function render(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => render(entry)).join(', ');
  }
  if (value instanceof Date) {
    return isoDate(value);
  }
  // Only the scalars a YAML document can hold are turned into text. Anything else — a nested
  // mapping, and whatever a future parser might hand back — renders as nothing rather than as
  // `[object Object]`: a table that cannot show a thing should say nothing about it.
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/** A date without its time, which is how a note writes one. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
