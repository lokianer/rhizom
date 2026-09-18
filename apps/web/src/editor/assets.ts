// Turning what an embed or an image link says into a URL the browser can load. Files live in
// the vault and are served by the server under /api/assets/<vault path>.
import { folderOf, toVaultPath } from '@rhizom/core';

import { api } from '../api/client.js';

const IMAGE_EXTENSION = /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:|^\/\//i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSION.test(path.trim());
}

/** Joins a `./`- or `../`-style reference onto a folder, collapsing `.` and `..`. */
function joinVaultPath(folder: string, relative: string): string {
  const segments = folder === '' ? [] : folder.split('/');
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

/**
 * URL for an image destination. Absolute URLs and site-absolute paths are kept as they are;
 * `./x.png` and `../x.png` resolve against the note's folder, everything else is a vault path
 * (which is what uploads and Obsidian-style `![[assets/x.png]]` embeds produce).
 */
export function imageUrl(destination: string, notePath: string): string {
  const trimmed = destination.trim();
  if (trimmed === '' || ABSOLUTE_URL.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed;
  }
  const relative = trimmed.startsWith('./') || trimmed.startsWith('../');
  const vaultPath = joinVaultPath(relative ? folderOf(notePath) : '', toVaultPath(trimmed));
  return api.assetUrl(vaultPath);
}
