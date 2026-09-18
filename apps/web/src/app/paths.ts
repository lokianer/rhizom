// Note paths in the URL. The router keeps the extension out of the address so static hosts
// with an "ends in a dot-something is a file" rule still serve the app for deep links.
import { ensureMarkdownExtension } from '@rhizom/core';

const MARKDOWN = /\.(md|markdown)$/i;

/** `Campaign/NPCs/Mira.md` → `/notes/Campaign/NPCs/Mira` */
export function noteHref(path: string, mode: 'notes' | 'wiki' = 'notes'): string {
  const withoutExtension = path.replace(MARKDOWN, '');
  return `/${mode}/${withoutExtension.split('/').map(encodeURIComponent).join('/')}`;
}

/** The open note of a `/notes/…` or `/wiki/…` URL, for components above those routes. */
export function notePathFromLocation(pathname: string): string | null {
  const match = /^\/(?:notes|wiki)\/(.+)$/.exec(pathname);
  const splat = match?.[1];
  if (splat === undefined) {
    return null;
  }
  return ensureMarkdownExtension(splat.split('/').map(decodeURIComponent).join('/'));
}

/** The vault path behind a `notes/*` or `wiki/*` route parameter. */
export function notePathFromParam(splat: string | undefined): string | null {
  if (splat === undefined || splat === '') {
    return null;
  }
  return ensureMarkdownExtension(splat);
}
