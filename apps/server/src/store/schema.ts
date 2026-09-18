// Drizzle table definitions for the index. The DDL in database.ts must match these exactly; the
// index is disposable, so a schema change bumps INDEX_SCHEMA_VERSION instead of migrating.
import type { Heading, LinkKind } from '@rhizom/core';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable(
  'notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    path: text('path').notNull().unique(),
    name: text('name').notNull(),
    title: text('title').notNull(),
    folder: text('folder').notNull(),
    /** Milliseconds since the epoch. */
    modifiedAt: integer('modified_at').notNull(),
    size: integer('size').notNull(),
    hash: text('hash').notNull(),
    frontmatter: text('frontmatter', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    headings: text('headings', { mode: 'json' }).$type<Heading[]>().notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull(),
    wordCount: integer('word_count').notNull(),
    /** Plain text for full-text search; the Markdown file stays the source of truth. */
    body: text('body').notNull(),
  },
  (table) => [index('notes_folder').on(table.folder), index('notes_name').on(table.name)],
);

export const links = sqliteTable(
  'links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    /** Resolved vault path, or null while the target note does not exist. */
    target: text('target'),
    /** The reference as written, e.g. `Folder/Note#Heading|alias`. */
    raw: text('raw').notNull(),
    /** The note reference used for resolution: raw without heading, block id and alias. */
    targetKey: text('target_key').notNull(),
    kind: text('kind').$type<LinkKind>().notNull(),
    alias: text('alias'),
    heading: text('heading'),
    line: integer('line').notNull(),
    /** The source line, trimmed, for the backlinks panel. */
    context: text('context').notNull(),
  },
  (table) => [
    index('links_source').on(table.source),
    index('links_target').on(table.target),
    index('links_target_key').on(table.targetKey),
  ],
);

export const noteTags = sqliteTable(
  'note_tags',
  {
    path: text('path').notNull(),
    tag: text('tag').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.path, table.tag] }),
    index('note_tags_tag').on(table.tag),
  ],
);

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
