// What a store function needs from the index it belongs to. The modules beside this one are
// free functions rather than methods, so the three handles a method used to reach through
// `this` travel as one argument instead.
import type { NoteIndex } from '@rhizom/core';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface IndexContext {
  /**
   * The raw connection. Full-text search goes through it rather than through Drizzle: FTS5 is
   * a virtual table with its own syntax, and `snippet()` and `bm25()` are functions no query
   * builder knows.
   */
  readonly sqlite: Database.Database;
  /** Everything that is an ordinary table. */
  readonly db: BetterSQLite3Database;
  /** Turns a link target as written into the path it resolves to, against the whole vault. */
  readonly resolver: NoteIndex;
}
