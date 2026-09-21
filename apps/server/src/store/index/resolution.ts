// Deciding what a link points at. A link is stored as it was written and resolved against the
// note index afterwards, so a note that arrives later makes every link to it resolve without
// anything being re-parsed.
import { eq, isNull, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { resolveLinkTarget } from '@rhizom/core';

import { links } from '../schema.js';
import type { IndexContext } from './context.js';

/** Re-resolves links that are unresolved or point at `path`, after that note changed. */
export function reresolve(ctx: IndexContext, tx: BetterSQLite3Database, path: string): void {
  applyResolution(
    ctx,
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
export function resolveAll(ctx: IndexContext): void {
  ctx.db.transaction((tx) => {
    applyResolution(ctx, tx, tx.select(RESOLUTION_COLUMNS).from(links).all());
  });
}

export function applyResolution(
  ctx: IndexContext,
  tx: BetterSQLite3Database,
  candidates: readonly ResolutionRow[],
): void {
  for (const candidate of candidates) {
    const resolution = resolveLinkTarget(candidate.targetKey, candidate.source, ctx.resolver);
    const target = resolution.resolved ? resolution.path : null;
    if (target !== candidate.target) {
      tx.update(links).set({ target }).where(eq(links.id, candidate.id)).run();
    }
  }
}

export const RESOLUTION_COLUMNS = {
  id: links.id,
  source: links.source,
  targetKey: links.targetKey,
  target: links.target,
};

export interface ResolutionRow {
  id: number;
  source: string;
  targetKey: string;
  target: string | null;
}
