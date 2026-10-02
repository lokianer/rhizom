// The statements every index write runs, prepared once when the connection opens. Drizzle builds
// and prepares a fresh native statement for each query it runs, and a first build of a 2,000-note
// vault ran 22,490 of them — native memory the garbage collector gives back late, for SQL that
// never changes. The SQL is what Drizzle generated for the same writes, and the values are
// encoded the way its column types encode them, so the rows that land are the same rows.
import type Database from 'better-sqlite3';

import type { ResolutionRow } from './resolution.js';

/** A `notes` row as it is written; the JSON columns arrive already serialised. */
export interface NoteRow {
  path: string;
  name: string;
  title: string;
  folder: string;
  modifiedAt: number;
  size: number;
  hash: string;
  frontmatter: string;
  headings: string;
  aliases: string;
  wordCount: number;
  body: string;
  publicTitle: string;
  publicBody: string;
  gates: string;
}

/** A `links` row as it is written. */
export interface LinkRow {
  source: string;
  target: string | null;
  raw: string;
  targetKey: string;
  kind: string;
  alias: string | null;
  heading: string | null;
  line: number;
  context: string;
  publicFrom: number | null;
}

export interface WriteStatements {
  readonly deleteNote: Database.Statement<[path: string]>;
  readonly deleteLinksFrom: Database.Statement<[source: string]>;
  readonly deleteTags: Database.Statement<[path: string]>;
  readonly deleteTerms: Database.Statement<[path: string]>;
  readonly insertNote: Database.Statement<[NoteRow]>;
  readonly insertTag: Database.Statement<[path: string, tag: string]>;
  /** `alias` is the boolean column, written as 0 or 1 the way Drizzle's boolean mode does. */
  readonly insertTerm: Database.Statement<
    [path: string, surface: string, folded: string, alias: number]
  >;
  readonly insertLink: Database.Statement<[LinkRow]>;
  /** Links that point at a note which is about to be gone. */
  readonly unresolveLinksTo: Database.Statement<[target: string]>;
  readonly setLinkTarget: Database.Statement<[target: string | null, id: number]>;
  /** Links worth resolving again after `path` changed: unresolved ones and those pointing at it. */
  readonly resolutionCandidates: Database.Statement<[path: string], ResolutionRow>;
  readonly allResolutionRows: Database.Statement<[], ResolutionRow>;
  readonly setMeta: Database.Statement<[key: string, value: string]>;
}

const RESOLUTION_SELECT = 'select id, source, target_key as targetKey, target from links';

export function prepareWriteStatements(sqlite: Database.Database): WriteStatements {
  return {
    deleteNote: sqlite.prepare('delete from notes where path = ?'),
    deleteLinksFrom: sqlite.prepare('delete from links where source = ?'),
    deleteTags: sqlite.prepare('delete from note_tags where path = ?'),
    deleteTerms: sqlite.prepare('delete from terms where path = ?'),
    insertNote: sqlite.prepare<NoteRow>(
      `insert into notes (path, name, title, folder, modified_at, size, hash, frontmatter, headings, aliases, word_count, body, public_title, public_body, gates)
       values (@path, @name, @title, @folder, @modifiedAt, @size, @hash, @frontmatter, @headings, @aliases, @wordCount, @body, @publicTitle, @publicBody, @gates)`,
    ),
    insertTag: sqlite.prepare('insert into note_tags (path, tag) values (?, ?)'),
    insertTerm: sqlite.prepare(
      'insert into terms (path, surface, folded, alias) values (?, ?, ?, ?)',
    ),
    insertLink: sqlite.prepare<LinkRow>(
      `insert into links (source, target, raw, target_key, kind, alias, heading, line, context, public_from)
       values (@source, @target, @raw, @targetKey, @kind, @alias, @heading, @line, @context, @publicFrom)`,
    ),
    unresolveLinksTo: sqlite.prepare('update links set target = null where target = ?'),
    setLinkTarget: sqlite.prepare('update links set target = ? where id = ?'),
    resolutionCandidates: sqlite.prepare<[string], ResolutionRow>(
      `${RESOLUTION_SELECT} where target is null or target = ?`,
    ),
    allResolutionRows: sqlite.prepare<[], ResolutionRow>(RESOLUTION_SELECT),
    setMeta: sqlite.prepare(
      'insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
    ),
  };
}
