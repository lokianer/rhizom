// Where a note is named without a link leading to it, and the batch that turns those names into
// links.
//
// The scan narrows candidates through the full-text index and reads only those files: a vault of
// five thousand notes must not be read from disk because a panel opened. The batch write is the
// only place in Rhizom that writes several files at once, so it is deliberately strict — every
// file carries the hash it was read at, and a file that changed meanwhile is reported as skipped
// rather than overwritten.
import { createTermMatcher, findMentions, linkMentions, type Mention } from '@rhizom/core';

import { VaultError } from '../vault/files.js';
import type { VaultContext } from '../vault/context.js';
import { errorBody } from './errors.js';
import {
  ErrorSchema,
  LinkMentionsBodySchema,
  LinkMentionsResultSchema,
  MentionsQuerySchema,
  MentionsResponseSchema,
} from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

/** How many notes the full-text filter may hand back before the answer says it is short. */
const CANDIDATE_LIMIT = 200;

export function registerMentionRoutes(app: TypedApp, context: () => VaultContext): void {
  app.get(
    '/api/mentions',
    {
      schema: {
        tags: ['mentions'],
        summary: 'Notes that name this one without linking to it',
        querystring: MentionsQuerySchema,
        response: { 200: MentionsResponseSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const path = request.query.path;
      const note = ctx.index.getNote(path);
      if (note === undefined) {
        return reply.code(404).send(errorBody(404, `No such note: ${path}`));
      }

      const terms = [note.title, ...note.aliases]
        .map((surface) => surface.trim())
        .filter((surface) => surface !== '');
      const matcher = createTermMatcher(
        terms.map((surface) => ({ surface, path, alias: false, summary: '' })),
      );
      const candidates = ctx.index.mentionCandidates(terms, CANDIDATE_LIMIT + 1);
      const truncated = candidates.length > CANDIDATE_LIMIT;

      const groups = [];
      for (const source of candidates.slice(0, CANDIDATE_LIMIT)) {
        // A note naming itself is not a mention of anything.
        if (source === path) {
          continue;
        }
        const file = await readOrSkip(ctx, source);
        if (file === undefined) {
          continue;
        }
        const mentions = findMentions(file.content, matcher);
        if (mentions.length > 0) {
          groups.push({
            source,
            sourceTitle: ctx.index.getNote(source)?.title ?? source,
            hash: file.hash,
            mentions,
          });
        }
      }
      return { path, terms, groups, truncated };
    },
  );

  app.post(
    '/api/mentions/link',
    {
      schema: {
        tags: ['mentions'],
        summary: 'Writes links around the given mentions',
        body: LinkMentionsBodySchema,
        response: { 200: LinkMentionsResultSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const target = request.body.path;
      const note = ctx.index.getNote(target);
      if (note === undefined) {
        return reply.code(404).send(errorBody(404, `No such note: ${target}`));
      }

      // The words a link may be written around are the ones the scan looked for: this note's
      // title and its aliases, as the index knows them now. A note renamed since the scan
      // therefore matches nothing and is reported as skipped rather than mislinked.
      const matcher = createTermMatcher(
        [note.title, ...note.aliases]
          .map((surface) => surface.trim())
          .filter((surface) => surface !== '')
          .map((surface) => ({ surface, path: target, alias: false, summary: '' })),
      );

      const linked: { source: string; count: number }[] = [];
      const skipped: { source: string; reason: 'conflict' | 'notFound' | 'nothing' }[] = [];
      const written: string[] = [];

      try {
        for (const write of request.body.writes) {
          const file = await readOrSkip(ctx, write.source);
          if (file === undefined) {
            skipped.push({ source: write.source, reason: 'notFound' });
            continue;
          }
          // The hash is what makes the offsets below safe: it says the file is character for
          // character what the client scanned.
          if (file.hash !== write.hash) {
            skipped.push({ source: write.source, reason: 'conflict' });
            continue;
          }

          const wanted = new Set(write.offsets);
          const chosen = findMentions(file.content, matcher).filter(
            (mention: Mention) => wanted.has(mention.start) && mention.linkable,
          );
          if (chosen.length === 0) {
            skipped.push({ source: write.source, reason: 'nothing' });
            continue;
          }

          const content = linkMentions(
            file.content,
            chosen,
            ctx.index.linkTextFor(target, write.source),
          );
          try {
            await ctx.vault.writeNote(write.source, content, write.hash);
          } catch (error) {
            if (error instanceof VaultError && error.code === 'HASH_MISMATCH') {
              skipped.push({ source: write.source, reason: 'conflict' });
              continue;
            }
            throw error;
          }
          linked.push({ source: write.source, count: chosen.length });
          written.push(write.source);
        }
      } finally {
        // One call, so the browser hears about the whole batch as a single index event rather
        // than one per file. In a `finally`, because a file written before a later one failed
        // is on disk either way, and an index that has not seen it is worse than the failure.
        if (written.length > 0) {
          await ctx.indexPaths(written);
        }
      }
      return { linked, skipped };
    },
  );
}

/** Reads a note, or nothing when it is gone: the index may be a moment behind the disk. */
async function readOrSkip(
  ctx: VaultContext,
  path: string,
): Promise<{ content: string; hash: string } | undefined> {
  try {
    return await ctx.vault.readNote(path);
  } catch (error) {
    if (error instanceof VaultError) {
      return undefined;
    }
    throw error;
  }
}
