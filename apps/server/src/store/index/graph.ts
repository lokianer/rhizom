// What the bubble field is drawn from: every note as a point, every resolved link as an edge.
import type { GraphLink, GraphNote } from '@rhizom/core';

import type { IndexContext } from './context.js';

// Hand-written rather than through Drizzle: the links table is the largest thing a graph reads
// (17,000 rows in a 2,000-note vault), and mapping every row through the query builder cost
// about four times what the rows themselves do. The statements are the ones Drizzle generated,
// word for word, so SQLite plans them the same way and hands the rows back in the same order —
// the order the edges of the answer come in. No `where target is not null`: buildGraph skips an
// unresolved link anyway, and the predicate would let the planner switch to the target index and
// hand the rows back sorted by target.
const TAGS = 'select "path", "tag" from "note_tags" order by "note_tags"."tag" asc';
const NOTES = 'select "path" from "notes"';
const LINKS = 'select "source", "target", "kind" from "links"';

export function graphInput(ctx: IndexContext): { notes: GraphNote[]; links: GraphLink[] } {
  const tagRows = ctx.sqlite.prepare<[], { path: string; tag: string }>(TAGS).all();
  const tagsByPath = new Map<string, string[]>();
  for (const row of tagRows) {
    (tagsByPath.get(row.path) ?? tagsByPath.set(row.path, []).get(row.path))?.push(row.tag);
  }
  const graphNotes = ctx.sqlite
    .prepare<[], { path: string }>(NOTES)
    .all()
    .map((row) => ({ path: row.path, tags: tagsByPath.get(row.path) ?? [] }));
  // Every resolved link, embeds included: buildGraph tells the kinds apart and a file embed
  // has no note to point at, so it never resolves in the first place.
  const graphLinks = ctx.sqlite.prepare<[], GraphLink>(LINKS).all();
  return { notes: graphNotes, links: graphLinks };
}
