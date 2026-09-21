// Notes in and out of the index: writing one, removing one, and every way of reading one back.
// Also the index's own bookkeeping, which is two rows in a meta table.
import { eq } from 'drizzle-orm';

import type { NoteSummary } from '@rhizom/core';

import { links, meta, notes, noteTags, terms } from '../schema.js';
import type { IndexContext } from './context.js';
import { asc } from 'drizzle-orm';

import { definedTerms, foldTerm, resolveLinkTarget, type DefinedTerm } from '@rhizom/core';

import { reresolve } from './resolution.js';
import {
  SUMMARY_COLUMNS,
  toSummary,
  type FileState,
  type IndexNoteInput,
  type IndexStats,
  type NoteRecord,
  type SummaryRow,
  type UpsertOptions,
} from './rows.js';
import { CONTEXT_LENGTH } from './search.js';

export function upsertNote(
  ctx: IndexContext,
  input: IndexNoteInput,
  options: UpsertOptions = {},
): void {
  const { path, parsed } = input;
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '');
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const lines = input.content.split(/\r?\n/);

  ctx.db.transaction((tx) => {
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

    ctx.resolver.add(path, parsed.aliases);
    if (parsed.links.length > 0) {
      tx.insert(links)
        .values(
          parsed.links.map((link) => {
            const resolution = resolveLinkTarget(link.target, path, ctx.resolver);
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
      reresolve(ctx, tx, path);
    }
  });
}

export function removeNote(ctx: IndexContext, path: string, options: UpsertOptions = {}): void {
  ctx.db.transaction((tx) => {
    tx.delete(notes).where(eq(notes.path, path)).run();
    tx.delete(links).where(eq(links.source, path)).run();
    tx.delete(noteTags).where(eq(noteTags.path, path)).run();
    tx.delete(terms).where(eq(terms.path, path)).run();
    ctx.resolver.remove(path);
    tx.update(links).set({ target: null }).where(eq(links.target, path)).run();
    if (options.deferResolution !== true) {
      reresolve(ctx, tx, path);
    }
  });
}

export function stats(ctx: IndexContext): IndexStats {
  const count = ctx.sqlite.prepare('select count(*) as count from notes').get() as {
    count: number;
  };
  const indexedAt = getMeta(ctx, 'indexedAt');
  return { noteCount: count.count, indexedAt: indexedAt ?? null };
}

export function getMeta(ctx: IndexContext, key: string): string | undefined {
  return ctx.db.select({ value: meta.value }).from(meta).where(eq(meta.key, key)).get()?.value;
}

export function setMeta(ctx: IndexContext, key: string, value: string): void {
  ctx.db
    .insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run();
}

export function fileStates(ctx: IndexContext): Map<string, FileState> {
  const states = new Map<string, FileState>();
  for (const row of ctx.db
    .select({ path: notes.path, size: notes.size, modifiedAt: notes.modifiedAt })
    .from(notes)
    .all()) {
    states.set(row.path, { size: row.size, modifiedAt: new Date(row.modifiedAt) });
  }
  return states;
}

export function listNotes(ctx: IndexContext): NoteSummary[] {
  const rows = ctx.sqlite.prepare(`${SUMMARY_COLUMNS} order by n.path`).all() as SummaryRow[];
  return rows.map(toSummary);
}

/** The same shape as listNotes(), for one note: reading a note must not scan the vault. */
export function summary(ctx: IndexContext, path: string): NoteSummary | undefined {
  const row = ctx.sqlite.prepare(`${SUMMARY_COLUMNS} where n.path = ?`).get(path) as
    SummaryRow | undefined;
  return row === undefined ? undefined : toSummary(row);
}

export function getNote(ctx: IndexContext, path: string): NoteRecord | undefined {
  const row = ctx.db.select().from(notes).where(eq(notes.path, path)).get();
  if (row === undefined) {
    return undefined;
  }
  const tags = ctx.db
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
