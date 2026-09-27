// Deciding what a link points at. A link is stored as it was written and resolved against the
// note index afterwards, so a note that arrives later makes every link to it resolve without
// anything being re-parsed.
import { resolveLinkTarget } from '@rhizom/core';

import type { IndexContext } from './context.js';

/**
 * Re-resolves links that are unresolved or point at `path`, after that note changed. Runs inside
 * the caller's transaction: better-sqlite3 transactions belong to the connection, so the
 * prepared statements take part in it without being handed anything.
 */
export function reresolve(ctx: IndexContext, path: string): void {
  // `.all()` rather than `.iterate()`: the updates below need the connection, and an open
  // iterator keeps it busy.
  applyResolution(ctx, ctx.statements.resolutionCandidates.all(path));
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
  ctx.sqlite.transaction(() => {
    applyResolution(ctx, ctx.statements.allResolutionRows.all());
  })();
}

export function applyResolution(ctx: IndexContext, candidates: readonly ResolutionRow[]): void {
  for (const candidate of candidates) {
    const resolution = resolveLinkTarget(candidate.targetKey, candidate.source, ctx.resolver);
    const target = resolution.resolved ? resolution.path : null;
    if (target !== candidate.target) {
      ctx.statements.setLinkTarget.run(target, candidate.id);
    }
  }
}

export interface ResolutionRow {
  id: number;
  source: string;
  targetKey: string;
  target: string | null;
}
