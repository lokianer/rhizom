// The rendered side of a note: the same sanitised HTML the wiki serves, from whatever text
// is in the editor right now.
import { renderNote } from '@rhizom/core';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api/client.js';
import { useVaultStore } from '../store/vault.js';
import { createAssetResolver, createResolver } from './links.js';
import { noteHref } from './paths.js';

export interface NotePreviewProps {
  /** The note the text belongs to; links resolve relative to it. */
  path: string;
  content: string;
  /** Where a link inside the preview leads: back into the editor, or deeper into the wiki. */
  mode?: 'notes' | 'wiki';
  label?: string | undefined;
}

export function NotePreview({ path, content, mode = 'notes', label }: NotePreviewProps) {
  const navigate = useNavigate();
  const notes = useVaultStore((state) => state.notes);
  const assets = useVaultStore((state) => state.assets);
  const resolver = useMemo(() => createResolver(notes), [notes]);
  const assetResolver = useMemo(() => createAssetResolver(assets), [assets]);

  const html = useMemo(
    () =>
      renderNote(content, {
        resolveLink: (target, kind) => {
          // An embedded file is an attachment, addressed by name or by a path from the
          // vault root; only a note is resolved through the link index.
          if (kind === 'embed') {
            const asset = assetResolver.resolve(target);
            if (asset !== null) {
              return { path: asset, href: api.assetUrl(asset) };
            }
          }
          const resolution = resolver.resolve(target, path);
          if (resolution.resolved) {
            return { path: resolution.path, href: noteHref(resolution.path, mode) };
          }
          // Nothing to point at yet: the link leads to the note that would be created.
          return {
            path: null,
            href: resolution.createPath === undefined ? '' : noteHref(resolution.createPath, mode),
          };
        },
        assetUrl: (vaultPath) => api.assetUrl(vaultPath),
      }).html,
    [assetResolver, content, mode, path, resolver],
  );

  return (
    // renderNote sanitises its output; the click handler keeps navigation inside the app
    // instead of reloading the page.
    <div
      className="rz-prose"
      {...(label === undefined ? {} : { 'aria-label': label, role: 'region' })}
      onClick={(event) => {
        const href = (event.target as HTMLElement).closest('a')?.getAttribute('href') ?? '';
        if (!href.startsWith('/')) {
          return;
        }
        event.preventDefault();
        void navigate(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
