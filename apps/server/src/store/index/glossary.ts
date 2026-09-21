// The vocabulary the vault defines: every note marked as a definition, with what it is called
// and the aliases it also answers to.
import { summaryOf, type GlossaryEntry } from '@rhizom/core';

import type { IndexContext } from './context.js';
import { parseAliases } from './rows.js';

/**
 * One entry per note that defines something, alphabetical by title. The `terms` table is what
 * finds those notes: without it this would parse the frontmatter of every note in the vault,
 * on a path the browser reloads after every save.
 */
export function glossary(ctx: IndexContext): GlossaryEntry[] {
  const rows = ctx.sqlite
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
        aliases: parseAliases(row.aliases).sort((a, b) => BY_NAME.compare(a, b)),
        summary: summaryOf(row.body, row.title),
      }))
      // Path breaks a tie in code-unit order, because two notes may well carry the same title
      // and SQLite hands rows back in whatever order it scanned them.
      .sort(
        (a, b) =>
          BY_TITLE.compare(a.title, b.title) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      )
  );
}

/**
 * Collators, built once each. `String.prototype.localeCompare` builds a fresh one on every
 * call, which is the whole cost of sorting a large vault: the tree of five thousand notes and
 * the glossary both go through these on paths the browser reloads after every save.
 */
export const BY_NAME = new Intl.Collator();

export const BY_TITLE = new Intl.Collator(undefined, { sensitivity: 'base' });
