// Opens the SQLite index file. The schema is created in code (no migrations): when the stored
// schema version differs, the file is deleted and rebuilt, because everything in it can be
// derived from the vault again.
import { rmSync } from 'node:fs';

import Database from 'better-sqlite3';

/** Bump whenever the DDL below or the Drizzle schema changes. */
export const INDEX_SCHEMA_VERSION = 1;

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

create table if not exists meta (
  key text primary key,
  value text not null
);

create virtual table if not exists notes_fts using fts5(
  title,
  body,
  content='notes',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
create trigger if not exists notes_fts_insert after insert on notes begin
  insert into notes_fts (rowid, title, body) values (new.id, new.title, new.body);
end;
create trigger if not exists notes_fts_delete after delete on notes begin
  insert into notes_fts (notes_fts, rowid, title, body) values ('delete', old.id, old.title, old.body);
end;
create trigger if not exists notes_fts_update after update on notes begin
  insert into notes_fts (notes_fts, rowid, title, body) values ('delete', old.id, old.title, old.body);
  insert into notes_fts (rowid, title, body) values (new.id, new.title, new.body);
end;
`;

export function openDatabase(file: string): Database.Database {
  let sqlite = new Database(file);
  if (
    file !== ':memory:' &&
    sqlite.pragma('user_version', { simple: true }) !== INDEX_SCHEMA_VERSION
  ) {
    const version = sqlite.pragma('user_version', { simple: true });
    sqlite.close();
    if (version !== 0) {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${file}${suffix}`, { force: true });
      }
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
  return sqlite;
}
