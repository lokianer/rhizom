// The tags the vault uses, and what carries them.

import type { TagCount } from '@rhizom/core';

import type { IndexContext } from './context.js';

export function tags(ctx: IndexContext): TagCount[] {
  return ctx.sqlite
    .prepare('select tag, count(*) as count from note_tags group by tag order by tag')
    .all() as TagCount[];
}

/**
 * Every note carrying this tag or one below it, which is what renaming a level has to reach:
 * `campaign` takes `campaign/silverstadt/npcs` with it. The `like` runs on a literal prefix
 * with its wildcards escaped, so a tag with a `%` or a `_` in it matches itself and nothing
 * else — and `campaigns` is not below `campaign`, because the slash is part of the prefix.
 */
export function notesUnderTag(ctx: IndexContext, tag: string): string[] {
  const prefix = `${tag.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}/`;
  const rows = ctx.sqlite
    .prepare(
      `select distinct path from note_tags
       where tag = ? or tag like ? escape '\\' order by path`,
    )
    .all(tag, `${prefix}%`) as { path: string }[];
  return rows.map((row) => row.path);
}
