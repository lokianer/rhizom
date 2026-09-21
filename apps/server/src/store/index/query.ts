// Answering a query block. The parsed query says what to filter on; this turns the part SQLite
// can do into SQL and checks the frontmatter conditions on what comes back.
import type { Query, QueryRow } from '@rhizom/core';

import { matchesFrontmatter, queryToSql, sortNotes, toQueryNote, toRow } from '../query-sql.js';
import type { IndexContext } from './context.js';
import { resolveLinkTarget } from '@rhizom/core';

import type { QueryCandidate } from '../query-sql.js';

/**
 * Runs a query block. The parser decided what the block means; this decides which notes
 * answer to it, and hands back the total before the limit so a table can say what it cut.
 */
export function runQuery(ctx: IndexContext, query: Query): { rows: QueryRow[]; total: number } {
  // A query may name a note the way a link does, by path or by name, so the same resolver
  // answers both. One that leads nowhere cannot match, which `queryToSql` reports.
  const targets = query.linksTo
    .map((target) => resolveLinkTarget(target, '', ctx.resolver))
    .filter((resolution) => resolution.resolved)
    .map((resolution) => resolution.path);
  const { sql, parameters, empty } = queryToSql(query, targets);
  if (empty) {
    return { rows: [], total: 0 };
  }
  const candidates = ctx.sqlite.prepare(sql).all(...parameters) as QueryCandidate[];
  const matched = candidates
    .map((row) => toQueryNote(row))
    .filter((note) => matchesFrontmatter(note, query));
  return {
    rows: sortNotes(matched, query)
      .slice(0, query.limit)
      .map((note) => toRow(note, query.columns)),
    total: matched.length,
  };
}
