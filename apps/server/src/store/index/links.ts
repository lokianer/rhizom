// What points where. A link is recorded from the note that wrote it, so the same table answers
// both directions: what this note points at, and what points at it.
import { eq } from 'drizzle-orm';

import { linkTextFor as textForLink, type Backlink, type NoteLink } from '@rhizom/core';

import { links, notes } from '../schema.js';
import type { IndexContext } from './context.js';
import { asc } from 'drizzle-orm';

export function linksFrom(ctx: IndexContext, path: string): NoteLink[] {
  return ctx.db
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

export function backlinks(ctx: IndexContext, path: string): Backlink[] {
  return ctx.sqlite
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
export function linkSources(ctx: IndexContext, target: string): string[] {
  return (
    ctx.sqlite
      .prepare('select distinct source from links where target = ? order by source')
      .all(target) as { source: string }[]
  ).map((row) => row.source);
}

/**
 * Every note and the names it answers to, which is all a `NoteIndex` is built from. A rename
 * needs one of a vault that does not exist yet — the same notes with one of them moved — to
 * ask what each link would resolve to afterwards.
 */
export function noteAliases(ctx: IndexContext): { path: string; aliases: string[] }[] {
  return ctx.db
    .select({ path: notes.path, aliases: notes.aliases })
    .from(notes)
    .all()
    .map((row) => ({ path: row.path, aliases: row.aliases }));
}

/** Link targets that do not resolve to a note, with the number of notes mentioning them. */
export function unresolved(ctx: IndexContext): { target: string; count: number }[] {
  return ctx.sqlite
    .prepare(
      `select target_key as target, count(distinct source) as count
       from links where target is null and kind <> 'embed'
       group by target_key order by count desc, target_key`,
    )
    .all() as { target: string; count: number }[];
}

/** How a link to `target` should be written inside `source`; the rule lives in the core. */
export function linkTextFor(ctx: IndexContext, target: string, source: string): string {
  return textForLink(target, source, ctx.resolver);
}
