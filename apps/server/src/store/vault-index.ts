// The derived index of one vault: notes, links, tags and full-text search on top of SQLite.
// Everything in here can be rebuilt from the Markdown files; nothing here is a source of truth.
import {
  createNoteIndex,
  definedTerms,
  foldTerm,
  linkTextFor,
  summaryOf,
  resolveLinkTarget,
  type Backlink,
  type GlossaryEntry,
  type GraphLink,
  type GraphNote,
  type Heading,
  type NoteIndex,
  type NoteLink,
  type NoteSummary,
  type ParsedNote,
  type SearchHit,
  type SearchResponse,
  type TagCount,
  type DefinedTerm,
  type TreeEntry,
} from '@rhizom/core';
import type Database from 'better-sqlite3';
import { asc, eq, isNull, or } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { INDEX_SCHEMA_VERSION, openDatabase } from './database.js';
import { links, meta, notes, noteTags, terms } from './schema.js';

export { INDEX_SCHEMA_VERSION };

export interface IndexNoteInput {
  path: string;
  size: number;
  modifiedAt: Date;
  hash: string;
  content: string;
  parsed: ParsedNote;
}

export interface NoteRecord {
  path: string;
  name: string;
  title: string;
  folder: string;
  tags: string[];
  modifiedAt: Date;
  size: number;
  hash: string;
  frontmatter: Record<string, unknown>;
  headings: Heading[];
  aliases: string[];
  wordCount: number;
}

export interface FileState {
  size: number;
  modifiedAt: Date;
}

export interface IndexStats {
  noteCount: number;
  indexedAt: string | null;
}

const MARK_START = String.fromCharCode(1);
const MARK_END = String.fromCharCode(2);
const CONTEXT_LENGTH = 200;

const RESOLUTION_COLUMNS = {
  id: links.id,
  source: links.source,
  targetKey: links.targetKey,
  target: links.target,
};

interface ResolutionRow {
  id: number;
  source: string;
  targetKey: string;
  target: string | null;
}

/** Whether the caller runs `resolveAll()` itself once a batch of notes is in. */
export interface UpsertOptions {
  deferResolution?: boolean;
}

interface SummaryRow {
  path: string;
  name: string;
  title: string;
  folder: string;
  aliases: string;
  modifiedAt: number;
  size: number;
  linkCount: number;
  backlinkCount: number;
  tags: string | null;
}

// Counted per note with correlated subqueries; note_tags is joined as one separated string
// because SQLite has no array type.
const SUMMARY_COLUMNS = `select n.path, n.name, n.title, n.folder, n.aliases, n.modified_at as modifiedAt, n.size,
        (select count(*) from links l where l.source = n.path and l.target is not null) as linkCount,
        (select count(*) from links l where l.target = n.path) as backlinkCount,
        (select group_concat(t.tag, char(31)) from note_tags t where t.path = n.path) as tags
 from notes n`;

/** `aliases` is a JSON column, and hand-written SQL hands it back as the raw text. */
function parseAliases(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function toSummary(row: SummaryRow): NoteSummary {
  return {
    path: row.path,
    name: row.name,
    title: row.title,
    folder: row.folder,
    aliases: parseAliases(row.aliases),
    tags: row.tags === null ? [] : row.tags.split(String.fromCharCode(31)).sort(),
    modifiedAt: new Date(row.modifiedAt).toISOString(),
    size: row.size,
    linkCount: row.linkCount,
    backlinkCount: row.backlinkCount,
  };
}

export class VaultIndex {
  private readonly sqlite: Database.Database;
  private readonly db: BetterSQLite3Database;
  private readonly resolver: NoteIndex;

  private constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite);
    this.resolver = createNoteIndex();
    for (const row of this.db
      .select({ path: notes.path, aliases: notes.aliases })
      .from(notes)
      .all()) {
      this.resolver.add(row.path, row.aliases);
    }
  }

  static open(file: string): VaultIndex {
    return new VaultIndex(openDatabase(file));
  }

  /** The underlying connection, for tests and maintenance. */
  get rawDatabase(): Database.Database {
    return this.sqlite;
  }

  close(): void {
    this.sqlite.close();
  }

  upsertNote(input: IndexNoteInput, options: UpsertOptions = {}): void {
    const { path, parsed } = input;
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '');
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const lines = input.content.split(/\r?\n/);

    this.db.transaction((tx) => {
      tx.delete(notes).where(eq(notes.path, path)).run();
      tx.delete(links).where(eq(links.source, path)).run();
      tx.delete(noteTags).where(eq(noteTags.path, path)).run();
      tx.delete(terms).where(eq(terms.path, path)).run();

      tx.insert(notes)
        .values({
          path,
          name,
          title: parsed.title,
          folder,
          modifiedAt: input.modifiedAt.getTime(),
          size: input.size,
          hash: input.hash,
          frontmatter: parsed.frontmatter,
          headings: parsed.headings,
          aliases: parsed.aliases,
          wordCount: parsed.wordCount,
          body: parsed.text,
        })
        .run();
      if (parsed.tags.length > 0) {
        tx.insert(noteTags)
          .values(parsed.tags.map((tag) => ({ path, tag })))
          .run();
      }

      // The primary key is (path, folded), so a title and an alias that fold to the same string
      // would collide; the title is kept because it comes first.
      const defined = new Map<string, DefinedTerm>();
      for (const term of definedTerms({
        path,
        title: parsed.title,
        aliases: parsed.aliases,
        frontmatter: parsed.frontmatter,
      })) {
        const folded = foldTerm(term.surface);
        if (!defined.has(folded)) {
          defined.set(folded, term);
        }
      }
      if (defined.size > 0) {
        tx.insert(terms)
          .values(
            [...defined].map(([folded, term]) => ({
              path,
              surface: term.surface,
              folded,
              alias: term.alias,
            })),
          )
          .run();
      }

      this.resolver.add(path, parsed.aliases);
      if (parsed.links.length > 0) {
        tx.insert(links)
          .values(
            parsed.links.map((link) => {
              const resolution = resolveLinkTarget(link.target, path, this.resolver);
              return {
                source: path,
                target: resolution.resolved ? resolution.path : null,
                raw: link.raw,
                targetKey: link.target,
                kind: link.kind,
                alias: link.alias ?? null,
                heading: link.heading ?? null,
                line: link.line,
                context: (lines[link.line - 1] ?? '').trim().slice(0, CONTEXT_LENGTH),
              };
            }),
          )
          .run();
      }

      if (options.deferResolution !== true) {
        this.reresolve(tx, path);
      }
    });
  }

  removeNote(path: string, options: UpsertOptions = {}): void {
    this.db.transaction((tx) => {
      tx.delete(notes).where(eq(notes.path, path)).run();
      tx.delete(links).where(eq(links.source, path)).run();
      tx.delete(noteTags).where(eq(noteTags.path, path)).run();
      tx.delete(terms).where(eq(terms.path, path)).run();
      this.resolver.remove(path);
      tx.update(links).set({ target: null }).where(eq(links.target, path)).run();
      if (options.deferResolution !== true) {
        this.reresolve(tx, path);
      }
    });
  }

  /** Re-resolves links that are unresolved or point at `path`, after that note changed. */
  private reresolve(tx: BetterSQLite3Database, path: string): void {
    this.applyResolution(
      tx,
      tx
        .select(RESOLUTION_COLUMNS)
        .from(links)
        .where(or(isNull(links.target), eq(links.target, path)))
        .all(),
    );
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
    this.db.transaction((tx) => {
      this.applyResolution(tx, tx.select(RESOLUTION_COLUMNS).from(links).all());
    });
  }

  private applyResolution(tx: BetterSQLite3Database, candidates: readonly ResolutionRow[]): void {
    for (const candidate of candidates) {
      const resolution = resolveLinkTarget(candidate.targetKey, candidate.source, this.resolver);
      const target = resolution.resolved ? resolution.path : null;
      if (target !== candidate.target) {
        tx.update(links).set({ target }).where(eq(links.id, candidate.id)).run();
      }
    }
  }

  stats(): IndexStats {
    const count = this.sqlite.prepare('select count(*) as count from notes').get() as {
      count: number;
    };
    const indexedAt = this.getMeta('indexedAt');
    return { noteCount: count.count, indexedAt: indexedAt ?? null };
  }

  getMeta(key: string): string | undefined {
    return this.db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .insert(meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value } })
      .run();
  }

  fileStates(): Map<string, FileState> {
    const states = new Map<string, FileState>();
    for (const row of this.db
      .select({ path: notes.path, size: notes.size, modifiedAt: notes.modifiedAt })
      .from(notes)
      .all()) {
      states.set(row.path, { size: row.size, modifiedAt: new Date(row.modifiedAt) });
    }
    return states;
  }

  listNotes(): NoteSummary[] {
    const rows = this.sqlite.prepare(`${SUMMARY_COLUMNS} order by n.path`).all() as SummaryRow[];
    return rows.map(toSummary);
  }

  /** The same shape as listNotes(), for one note: reading a note must not scan the vault. */
  summary(path: string): NoteSummary | undefined {
    const row = this.sqlite.prepare(`${SUMMARY_COLUMNS} where n.path = ?`).get(path) as
      SummaryRow | undefined;
    return row === undefined ? undefined : toSummary(row);
  }

  getNote(path: string): NoteRecord | undefined {
    const row = this.db.select().from(notes).where(eq(notes.path, path)).get();
    if (row === undefined) {
      return undefined;
    }
    const tags = this.db
      .select({ tag: noteTags.tag })
      .from(noteTags)
      .where(eq(noteTags.path, path))
      .orderBy(asc(noteTags.tag))
      .all()
      .map((t) => t.tag);
    return {
      path: row.path,
      name: row.name,
      title: row.title,
      folder: row.folder,
      tags,
      modifiedAt: new Date(row.modifiedAt),
      size: row.size,
      hash: row.hash,
      frontmatter: row.frontmatter,
      headings: row.headings,
      aliases: row.aliases,
      wordCount: row.wordCount,
    };
  }

  linksFrom(path: string): NoteLink[] {
    return this.db
      .select()
      .from(links)
      .where(eq(links.source, path))
      .orderBy(asc(links.id))
      .all()
      .map((row) => {
        const link: NoteLink = {
          source: row.source,
          target: row.target,
          raw: row.raw,
          kind: row.kind,
          line: row.line,
        };
        if (row.alias !== null) {
          link.alias = row.alias;
        }
        if (row.heading !== null) {
          link.heading = row.heading;
        }
        return link;
      });
  }

  backlinks(path: string): Backlink[] {
    return this.sqlite
      .prepare(
        `select l.source, n.title as sourceTitle, l.context, l.line
         from links l join notes n on n.path = l.source
         where l.target = ? order by l.source, l.line`,
      )
      .all(path) as Backlink[];
  }

  /**
   * The notes that link here, once each. A rename starts from this list: the `links` table can
   * only say which notes mention the target, never how — that is decided by resolving each link
   * again — so this is a candidate list, not an answer.
   */
  linkSources(target: string): string[] {
    return (
      this.sqlite
        .prepare('select distinct source from links where target = ? order by source')
        .all(target) as { source: string }[]
    ).map((row) => row.source);
  }

  /**
   * Every note and the names it answers to, which is all a `NoteIndex` is built from. A rename
   * needs one of a vault that does not exist yet — the same notes with one of them moved — to
   * ask what each link would resolve to afterwards.
   */
  noteAliases(): { path: string; aliases: string[] }[] {
    return this.db
      .select({ path: notes.path, aliases: notes.aliases })
      .from(notes)
      .all()
      .map((row) => ({ path: row.path, aliases: row.aliases }));
  }

  /** Link targets that do not resolve to a note, with the number of notes mentioning them. */
  unresolved(): { target: string; count: number }[] {
    return this.sqlite
      .prepare(
        `select target_key as target, count(distinct source) as count
         from links where target is null and kind <> 'embed'
         group by target_key order by count desc, target_key`,
      )
      .all() as { target: string; count: number }[];
  }

  search(query: string, limit: number): SearchResponse {
    const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (tokens.length === 0) {
      return { query, hits: [], total: 0 };
    }
    const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' ');
    const total = this.sqlite
      .prepare('select count(*) as count from notes_fts where notes_fts match ?')
      .get(match) as { count: number };
    const rows = this.sqlite
      .prepare(
        `select n.path, n.title,
                snippet(notes_fts, 1, ?, ?, '…', 24) as snippet,
                bm25(notes_fts, 10.0, 1.0) as score
         from notes_fts join notes n on n.id = notes_fts.rowid
         where notes_fts match ? order by score limit ?`,
      )
      .all(MARK_START, MARK_END, match, limit) as {
      path: string;
      title: string;
      snippet: string;
      score: number;
    }[];
    const hits: SearchHit[] = rows.map((row) => ({
      path: row.path,
      title: row.title,
      snippet: escapeHtml(row.snippet)
        .replaceAll(MARK_START, '<mark>')
        .replaceAll(MARK_END, '</mark>'),
      score: -row.score,
    }));
    return { query, hits, total: total.count };
  }

  /**
   * Notes that might name any of these terms, narrowed through the full-text index so that a
   * mention scan reads a handful of files rather than the whole vault. Full-text is a coarse
   * filter — it tokenises and folds differently from the term matcher — so it may hand back a
   * note that holds no mention after all; the scan drops those. It must never miss one, which
   * is why the terms are ANDed per term and ORed between them, without prefix matching.
   */
  mentionCandidates(terms: readonly string[], limit: number): string[] {
    const phrases = terms
      // `\p{M}` keeps a combining mark with the letter it belongs to: a decomposed "Rhône" is
      // one token like the composed one, not "Rho" and "ne", which would match nothing.
      .map((term) => term.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [])
      .filter((tokens) => tokens.length > 0)
      .map((tokens) => `(${tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' ')})`);
    if (phrases.length === 0) {
      return [];
    }
    return (
      this.sqlite
        .prepare(
          `select n.path from notes_fts join notes n on n.id = notes_fts.rowid
           where notes_fts match ? order by n.path limit ?`,
        )
        .all(phrases.join(' OR '), limit) as { path: string }[]
    ).map((row) => row.path);
  }

  /** How a link to `target` should be written inside `source`; the rule lives in the core. */
  linkTextFor(target: string, source: string): string {
    return linkTextFor(target, source, this.resolver);
  }

  tags(): TagCount[] {
    return this.sqlite
      .prepare('select tag, count(*) as count from note_tags group by tag order by tag')
      .all() as TagCount[];
  }

  /**
   * One entry per note that defines something, alphabetical by title. The `terms` table is what
   * finds those notes: without it this would parse the frontmatter of every note in the vault,
   * on a path the browser reloads after every save.
   */
  glossary(): GlossaryEntry[] {
    const rows = this.sqlite
      .prepare(
        `select n.path, n.title, n.aliases, n.body
         from notes n where exists (select 1 from terms t where t.path = n.path)`,
      )
      .all() as { path: string; title: string; aliases: string; body: string }[];
    return (
      rows
        .map((row) => ({
          path: row.path,
          title: row.title,
          aliases: parseAliases(row.aliases).sort((a, b) => a.localeCompare(b)),
          summary: summaryOf(row.body, row.title),
        }))
        // Path breaks a tie in code-unit order, because two notes may well carry the same title
        // and SQLite hands rows back in whatever order it scanned them.
        .sort(
          (a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
            (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
        )
    );
  }

  tree(): TreeEntry[] {
    const root: TreeEntry[] = [];
    const folders = new Map<string, TreeEntry[]>([['', root]]);
    const folderChildren = (folder: string): TreeEntry[] => {
      const existing = folders.get(folder);
      if (existing) {
        return existing;
      }
      const slash = folder.lastIndexOf('/');
      const parent = folderChildren(slash === -1 ? '' : folder.slice(0, slash));
      const children: TreeEntry[] = [];
      parent.push({
        type: 'folder',
        name: folder.slice(slash + 1),
        path: folder,
        children,
      });
      folders.set(folder, children);
      return children;
    };
    for (const note of this.db
      .select({ path: notes.path, name: notes.name, title: notes.title, folder: notes.folder })
      .from(notes)
      .all()) {
      folderChildren(note.folder).push({
        type: 'note',
        name: note.name,
        path: note.path,
        title: note.title,
      });
    }
    for (const children of folders.values()) {
      children.sort(compareTreeEntries);
    }
    return root;
  }

  graphInput(): { notes: GraphNote[]; links: GraphLink[] } {
    const tagRows = this.db.select().from(noteTags).orderBy(asc(noteTags.tag)).all();
    const tagsByPath = new Map<string, string[]>();
    for (const row of tagRows) {
      (tagsByPath.get(row.path) ?? tagsByPath.set(row.path, []).get(row.path))?.push(row.tag);
    }
    const graphNotes = this.db
      .select({ path: notes.path })
      .from(notes)
      .all()
      .map((row) => ({ path: row.path, tags: tagsByPath.get(row.path) ?? [] }));
    // Every resolved link, embeds included: buildGraph tells the kinds apart and a file embed
    // has no note to point at, so it never resolves in the first place.
    const graphLinks = this.db
      .select({ source: links.source, target: links.target, kind: links.kind })
      .from(links)
      .all();
    return { notes: graphNotes, links: graphLinks };
  }
}

function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  if (a.type !== b.type) {
    return a.type === 'folder' ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
