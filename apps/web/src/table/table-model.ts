// The player view's plain functions: which session the address asks for, the addresses inside the
// view, and how a link is drawn. The resolver knows only the notes the table may read — the view
// never loads the GM lens's note list — so a link to anything else has no target to find and is
// written as plain text.
import { ensureMarkdownExtension, type LinkKind, type RenderedLink } from '@rhizom/core';

import { buildNoteIndex, createResolver } from '../routing/links.js';
import { vaultHref } from '../routing/vault.js';

const MARKDOWN = /\.(md|markdown)$/i;

/** The session in the address, else the latest; never one past the latest. */
export function sessionOf(raw: string | null, sessions: readonly number[]): number {
  const latest = sessions.at(-1) ?? 0;
  if (raw === null || !/^\d+$/.test(raw)) {
    return Math.max(0, raw !== null && /^-\d+$/.test(raw) ? 0 : latest);
  }
  return Math.min(Number(raw), latest);
}

/** `/v/<id>/table/notes/<path>?session=N`, or the view's front page for `null`. */
export function tableHref(path: string | null, session: number): string {
  const query = `?session=${String(session)}`;
  if (path === null) {
    return vaultHref(`/table${query}`);
  }
  const encoded = path.replace(MARKDOWN, '').split('/').map(encodeURIComponent).join('/');
  return vaultHref(`/table/notes/${encoded}${query}`);
}

/** The note a `table/*` splat names: `notes/<path>`, or null for the front page. */
export function notePathOfSplat(splat: string | undefined): string | null {
  if (splat === undefined || !splat.startsWith('notes/') || splat.length === 'notes/'.length) {
    return null;
  }
  return ensureMarkdownExtension(splat.slice('notes/'.length));
}

/** Resolves links against the visible notes only; everything else is plain text. */
export function tableResolver(
  visible: readonly string[],
  session: number,
): (target: string, kind: LinkKind, source: string) => RenderedLink {
  const resolver = createResolver(buildNoteIndex(visible.map((path) => ({ path, aliases: [] }))));
  return (target, _kind, source) => {
    const resolution = resolver.resolve(target, source);
    if (!resolution.resolved) {
      return { path: null, href: '', plain: true };
    }
    return { path: resolution.path, href: tableHref(resolution.path, session) };
  };
}
