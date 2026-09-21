// What the bubble field is drawn from: every note as a point, every resolved link as an edge.
import type { GraphLink, GraphNote } from '@rhizom/core';

import type { IndexContext } from './context.js';
import { asc } from 'drizzle-orm';

import { links, notes, noteTags } from '../schema.js';

export function graphInput(ctx: IndexContext): { notes: GraphNote[]; links: GraphLink[] } {
  const tagRows = ctx.db.select().from(noteTags).orderBy(asc(noteTags.tag)).all();
  const tagsByPath = new Map<string, string[]>();
  for (const row of tagRows) {
    (tagsByPath.get(row.path) ?? tagsByPath.set(row.path, []).get(row.path))?.push(row.tag);
  }
  const graphNotes = ctx.db
    .select({ path: notes.path })
    .from(notes)
    .all()
    .map((row) => ({ path: row.path, tags: tagsByPath.get(row.path) ?? [] }));
  // Every resolved link, embeds included: buildGraph tells the kinds apart and a file embed
  // has no note to point at, so it never resolves in the first place.
  const graphLinks = ctx.db
    .select({ source: links.source, target: links.target, kind: links.kind })
    .from(links)
    .all();
  return { notes: graphNotes, links: graphLinks };
}
