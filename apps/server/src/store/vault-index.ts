// The derived index of one vault: notes, links, tags and full-text search on top of SQLite.
// Everything in here can be rebuilt from the Markdown files; nothing here is a source of truth.
import {
  buildGraph,
  createNoteIndex,
  type Backlink,
  type GlossaryEntry,
  type GraphData,
  type GraphLink,
  type GraphNote,
  type GraphOptions,
  type NoteLink,
  type NoteSummary,
  type Query,
  type QueryRow,
  type SearchResponse,
  type TagCount,
  type TreeEntry,
} from '@rhizom/core';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { INDEX_SCHEMA_VERSION, openDatabase } from './database.js';
import type { IndexContext } from './index/context.js';
import * as glossaryStore from './index/glossary.js';
import * as graphStore from './index/graph.js';
import * as linksStore from './index/links.js';
import * as notesStore from './index/notes.js';
import * as queryStore from './index/query.js';
import * as resolutionStore from './index/resolution.js';
import * as searchStore from './index/search.js';
import { prepareWriteStatements } from './index/statements.js';
import * as tagsStore from './index/tags.js';
import * as treeStore from './index/tree.js';
import type {
  FileState,
  IndexNoteInput,
  IndexStats,
  NoteRecord,
  UpsertOptions,
} from './index/rows.js';
import { notes } from './schema.js';

export { INDEX_SCHEMA_VERSION };
export type {
  FileState,
  IndexNoteInput,
  IndexStats,
  NoteRecord,
  UpsertOptions,
} from './index/rows.js';

export class VaultIndex {
  private readonly ctx: IndexContext;

  /**
   * The whole-vault graph, built once per clustering and kept until the index changes. The
   * graph view asks for all of it, and building it reads every link in the vault: at 2,000 notes
   * and 17,000 links that was 33 MB of garbage and 50-100 ms per request, for an answer that
   * stays the same until something is written. Every write goes through `upsertNote`,
   * `removeNote` or `resolveAll` — a save, a rename, a delete, a watcher batch and a rebuild
   * alike — and each of them empties this before it writes.
   */
  private readonly graphs = new Map<GraphOptions['clusterBy'], GraphData>();

  private constructor(sqlite: Database.Database) {
    const db = drizzle(sqlite);
    const resolver = createNoteIndex();
    for (const row of db.select({ path: notes.path, aliases: notes.aliases }).from(notes).all()) {
      resolver.add(row.path, row.aliases);
    }
    this.ctx = { sqlite, db, resolver, statements: prepareWriteStatements(sqlite) };
  }

  static open(file: string): VaultIndex {
    return new VaultIndex(openDatabase(file));
  }

  /** The underlying connection, for tests and maintenance. */
  get rawDatabase(): Database.Database {
    return this.ctx.sqlite;
  }

  close(): void {
    this.ctx.sqlite.close();
  }

  // The cache is emptied before the write rather than after it: a write that throws half-way
  // has rolled its transaction back, and a graph built again from the unchanged rows is merely
  // the same graph once more, while one kept across a write that did land would be wrong.
  upsertNote(input: IndexNoteInput, options: UpsertOptions = {}): void {
    this.graphs.clear();
    notesStore.upsertNote(this.ctx, input, options);
  }

  removeNote(path: string, options: UpsertOptions = {}): void {
    this.graphs.clear();
    notesStore.removeNote(this.ctx, path, options);
  }

  /**
   * Re-resolves every link in the index. A bulk sync defers the per-note pass and calls this
   * once at the end instead, because the per-note pass is quadratic over a first build: while
   * the vault is still half indexed most links are unresolved, so note n re-checks almost every
   * link in the vault. Measured on a generated vault of 5,000 notes with 47,000 links, a first
   * build took 198 s that way and the server answers nothing until it is done; one pass at the
   * end gives the same answer, because a link is resolved against the finished note index.
   */
  resolveAll(): void {
    this.graphs.clear();
    resolutionStore.resolveAll(this.ctx);
  }

  stats(): IndexStats {
    return notesStore.stats(this.ctx);
  }

  getMeta(key: string): string | undefined {
    return notesStore.getMeta(this.ctx, key);
  }

  setMeta(key: string, value: string): void {
    notesStore.setMeta(this.ctx, key, value);
  }

  fileStates(): Map<string, FileState> {
    return notesStore.fileStates(this.ctx);
  }

  listNotes(): NoteSummary[] {
    return notesStore.listNotes(this.ctx);
  }

  /** The same shape as listNotes(), for one note: reading a note must not scan the vault. */
  summary(path: string): NoteSummary | undefined {
    return notesStore.summary(this.ctx, path);
  }

  getNote(path: string): NoteRecord | undefined {
    return notesStore.getNote(this.ctx, path);
  }

  linksFrom(path: string): NoteLink[] {
    return linksStore.linksFrom(this.ctx, path);
  }

  backlinks(path: string): Backlink[] {
    return linksStore.backlinks(this.ctx, path);
  }

  /**
   * The notes that link here, once each. A rename starts from this list: the `links` table can
   * only say which notes mention the target, never how — that is decided by resolving each link
   * again — so this is a candidate list, not an answer.
   */
  linkSources(target: string): string[] {
    return linksStore.linkSources(this.ctx, target);
  }

  /**
   * Every note and the names it answers to, which is all a `NoteIndex` is built from. A rename
   * needs one of a vault that does not exist yet — the same notes with one of them moved — to
   * ask what each link would resolve to afterwards.
   */
  noteAliases(): { path: string; aliases: string[] }[] {
    return linksStore.noteAliases(this.ctx);
  }

  /** Link targets that do not resolve to a note, with the number of notes mentioning them. */
  unresolved(): { target: string; count: number }[] {
    return linksStore.unresolved(this.ctx);
  }

  /**
   * Full-text search over the three columns of `notes_fts`, weighted apart rather than equally.
   * A note *called* the search term is nearly always what was meant, so the title carries ten
   * times a word in the body; an alias is a name too — the other name the note answers to — and
   * sits just below the title at eight, which keeps the title in front where a note wears the
   * term as its title and another only as an alias, while still putting both ahead of prose that
   * merely mentions it.
   *
   * The snippet always comes from the body (column 2), because that is the only column that
   * reads as a sentence: a snippet cut from the aliases column would show the stored JSON. A hit
   * that matched an alias alone therefore shows the opening of the note with nothing marked,
   * which is the honest answer — the term is not in the prose, it is what the note is called,
   * and the reader gets the first line to recognise it by.
   */
  search(query: string, limit: number): SearchResponse {
    return searchStore.search(this.ctx, query, limit);
  }

  /**
   * Notes that might name any of these terms, narrowed through the full-text index so that a
   * mention scan reads a handful of files rather than the whole vault. Full-text is a coarse
   * filter — it tokenises and folds differently from the term matcher — so it may hand back a
   * note that holds no mention after all; the scan drops those. It must never miss one, which
   * is why the terms are ANDed per term and ORed between them, without prefix matching.
   *
   * Only the title and the body are searched. A mention lives in prose, and the scan skips
   * frontmatter on purpose — `aliases: [Mira]` names Mira without mentioning her — so a note
   * that matched through the aliases column would be read and thrown away, and would take a
   * place in the candidate limit from a note that has something to say.
   */
  mentionCandidates(terms: readonly string[], limit: number): string[] {
    return searchStore.mentionCandidates(this.ctx, terms, limit);
  }

  /** How a link to `target` should be written inside `source`; the rule lives in the core. */
  linkTextFor(target: string, source: string): string {
    return linksStore.linkTextFor(this.ctx, target, source);
  }

  /**
   * Runs a query block. The parser decided what the block means; this decides which notes
   * answer to it, and hands back the total before the limit so a table can say what it cut.
   */
  runQuery(query: Query): { rows: QueryRow[]; total: number } {
    return queryStore.runQuery(this.ctx, query);
  }

  tags(): TagCount[] {
    return tagsStore.tags(this.ctx);
  }

  /**
   * Every note carrying this tag or one below it, which is what renaming a level has to reach:
   * `campaign` takes `campaign/silverstadt/npcs` with it. The `like` runs on a literal prefix
   * with its wildcards escaped, so a tag with a `%` or a `_` in it matches itself and nothing
   * else — and `campaigns` is not below `campaign`, because the slash is part of the prefix.
   */
  notesUnderTag(tag: string): string[] {
    return tagsStore.notesUnderTag(this.ctx, tag);
  }

  /**
   * One entry per note that defines something, alphabetical by title. The `terms` table is what
   * finds those notes: without it this would parse the frontmatter of every note in the vault,
   * on a path the browser reloads after every save.
   */
  glossary(): GlossaryEntry[] {
    return glossaryStore.glossary(this.ctx);
  }

  tree(): TreeEntry[] {
    return treeStore.tree(this.ctx);
  }

  graphInput(): { notes: GraphNote[]; links: GraphLink[] } {
    return graphStore.graphInput(this.ctx);
  }

  /**
   * The whole vault as a graph, from the cache while nothing has been written since it was
   * built. The same object is handed to every caller, so nobody may change it: `localGraph`
   * builds its answer from new arrays and leaves its input alone.
   */
  graph(clusterBy: GraphOptions['clusterBy']): GraphData {
    const cached = this.graphs.get(clusterBy);
    if (cached !== undefined) {
      return cached;
    }
    const input = this.graphInput();
    const graph = buildGraph(input.notes, input.links, { clusterBy });
    this.graphs.set(clusterBy, graph);
    return graph;
  }
}
