// Full-text search, and the narrower question the mention scan asks. Both go through SQLite's
// FTS5 index rather than through the query builder: it is a virtual table with its own syntax,
// and snippet() and bm25() are functions no builder knows about.
import type { SearchHit, SearchResponse } from '@rhizom/core';

import type { IndexContext } from './context.js';

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
export function search(ctx: IndexContext, query: string, limit: number): SearchResponse {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) {
    return { query, hits: [], total: 0 };
  }
  const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' ');
  const total = ctx.sqlite
    .prepare('select count(*) as count from notes_fts where notes_fts match ?')
    .get(match) as { count: number };
  const rows = ctx.sqlite
    .prepare(
      `select n.path, n.title,
              snippet(notes_fts, 2, ?, ?, '…', 24) as snippet,
              bm25(notes_fts, 10.0, 8.0, 1.0) as score
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
 *
 * Only the title and the body are searched. A mention lives in prose, and the scan skips
 * frontmatter on purpose — `aliases: [Mira]` names Mira without mentioning her — so a note
 * that matched through the aliases column would be read and thrown away, and would take a
 * place in the candidate limit from a note that has something to say.
 */
export function mentionCandidates(
  ctx: IndexContext,
  terms: readonly string[],
  limit: number,
): string[] {
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
    ctx.sqlite
      .prepare(
        `select n.path from notes_fts join notes n on n.id = notes_fts.rowid
         where notes_fts match ? order by n.path limit ?`,
      )
      .all(`{title body} : (${phrases.join(' OR ')})`, limit) as { path: string }[]
  ).map((row) => row.path);
}

export const MARK_START = String.fromCharCode(1);

export const MARK_END = String.fromCharCode(2);

export const CONTEXT_LENGTH = 200;

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
