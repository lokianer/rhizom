// Opens the SQLite index file. The schema is created in code (no migrations): when the stored
// schema version differs, the file is deleted and rebuilt, because everything in it can be
// derived from the vault again.
import { rmSync } from 'node:fs';

import Database from 'better-sqlite3';

/**
 * Bump whenever the DDL below, the Drizzle schema, or what `parseNote` stores in a row changes.
 * The index is a cache of a parse, so a parser that reports something different needs the file
 * rebuilt: `syncVault` skips a file whose size and modification time are unchanged and would
 * otherwise keep the old answer forever.
 */
export const INDEX_SCHEMA_VERSION = 5;

const DDL = `
create table if not exists notes (
  id integer primary key autoincrement,
  path text not null unique,
  name text not null,
  title text not null,
  folder text not null,
  modified_at integer not null,
  size integer not null,
  hash text not null,
  frontmatter text not null,
  headings text not null,
  aliases text not null,
  word_count integer not null,
  body text not null
);
create index if not exists notes_folder on notes (folder);
create index if not exists notes_name on notes (name);

create table if not exists links (
  id integer primary key autoincrement,
  source text not null,
  target text,
  raw text not null,
  target_key text not null,
  kind text not null,
  alias text,
  heading text,
  line integer not null,
  context text not null
);
create index if not exists links_source on links (source);
create index if not exists links_target on links (target);
create index if not exists links_target_key on links (target_key);

create table if not exists note_tags (
  path text not null,
  tag text not null,
  primary key (path, tag)
);
create index if not exists note_tags_tag on note_tags (tag);

create table if not exists terms (
  path text not null,
  surface text not null,
  folded text not null,
  alias integer not null,
  primary key (path, folded)
);
create index if not exists terms_folded on terms (folded);

create table if not exists meta (
  key text primary key,
  value text not null
);

-- The aliases are in the index because they are names: a note that answers to "the Silver City"
-- should be findable under it, the way links, the glossary and the mention scan already find it.
-- They go in as the JSON text the column holds, brackets and quotes and all, rather than unfolded
-- into a list. An external-content table promises that what the triggers write is what the content
-- table would return, and integrity-check and rebuild hold it to that promise; a second, prettier
-- spelling of the same value would break it silently, because nothing reads the index until
-- somebody searches. The tokeniser makes the promise cheap: brackets, quotes and commas are
-- separators to unicode61, so what lands in the index is the words of the aliases and nothing else.
create virtual table if not exists notes_fts using fts5(
  title,
  aliases,
  body,
  content='notes',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
create trigger if not exists notes_fts_insert after insert on notes begin
  insert into notes_fts (rowid, title, aliases, body) values (new.id, new.title, new.aliases, new.body);
end;
create trigger if not exists notes_fts_delete after delete on notes begin
  insert into notes_fts (notes_fts, rowid, title, aliases, body)
  values ('delete', old.id, old.title, old.aliases, old.body);
end;
create trigger if not exists notes_fts_update after update on notes begin
  insert into notes_fts (notes_fts, rowid, title, aliases, body)
  values ('delete', old.id, old.title, old.aliases, old.body);
  insert into notes_fts (rowid, title, aliases, body) values (new.id, new.title, new.aliases, new.body);
end;
`;

/**
 * Deletes an index written by an older schema, together with its write-ahead log. On Windows a
 * second Rhizom still holding the file makes this fail, and the bare errno that better-sqlite3
 * would raise a moment later says nothing about what to do, so the cause is named here.
 */
function replaceIndexFile(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${file}${suffix}`, { force: true });
    } catch (error) {
      throw new Error(
        `The index at ${file} was written by another version of Rhizom and has to be rebuilt, ` +
          `but ${file}${suffix} could not be removed. Stop any other Rhizom using this data ` +
          `directory, or delete the file yourself; nothing in it is lost, it is rebuilt from ` +
          `the vault.`,
        { cause: error },
      );
    }
  }
}

export function openDatabase(file: string): Database.Database {
  let sqlite = new Database(file);
  if (
    file !== ':memory:' &&
    sqlite.pragma('user_version', { simple: true }) !== INDEX_SCHEMA_VERSION
  ) {
    const version = sqlite.pragma('user_version', { simple: true });
    sqlite.close();
    if (version !== 0) {
      replaceIndexFile(file);
    }
    sqlite = new Database(file);
  }
  if (file !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.exec(DDL);
  sqlite.pragma(`user_version = ${String(INDEX_SCHEMA_VERSION)}`);
  registerFunctions(sqlite);
  return sqlite;
}

/**
 * SQLite's own `lower()` folds ASCII and nothing else: `Ü` stays `Ü`, and a vault written in
 * German or Greek would quietly fail every case-insensitive comparison. JavaScript knows the
 * whole of Unicode, so the comparison is done there and handed to SQLite as a function.
 *
 * It is deterministic — the same string always folds to the same string — so SQLite may use it
 * in an index or a WHERE clause without surprises.
 */
function registerFunctions(sqlite: Database.Database): void {
  sqlite.function('rz_lower', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );
}
