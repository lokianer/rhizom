// The rendered side of a note: the same sanitised HTML the wiki serves, from whatever text
// is in the editor right now. An `![[Note]]` shows the note itself; the bodies it needs are
// fetched here rather than in core, which stays a pure function of what is already known — the
// editor renders an unsaved draft on every keystroke, and no server has ever seen that text.
import {
  createTermMatcher,
  renderNoteWithEmbeds,
  type EmbedLabels,
  type LinkKind,
} from '@rhizom/core';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { api } from '../api/client.js';
import { useNoteSources } from '../store/notes.js';
import { useVaultStore } from '../store/vault.js';
import { createAssetResolver, createResolver } from './links.js';
import { noteHref } from './paths.js';

// A stable identity, so a keystroke does not look like a different vault to the renderer.
const assetUrlOf = (vaultPath: string): string => api.assetUrl(vaultPath);

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
  const { t } = useTranslation();
  const notes = useVaultStore((state) => state.notes);
  const assets = useVaultStore((state) => state.assets);
  const sources = useNoteSources((state) => state.sources);
  const request = useNoteSources((state) => state.request);
  const terms = useVaultStore((state) => state.terms);
  const resolver = useMemo(() => createResolver(notes), [notes]);
  const assetResolver = useMemo(() => createAssetResolver(assets), [assets]);
  // Memoised on the term list alone: the vault store replaces every array after each save, and
  // rebuilding the matcher for a keystroke would be the expensive part of this render.
  const matcher = useMemo(() => createTermMatcher(terms), [terms]);

  const labels = useMemo<EmbedLabels>(
    () => ({
      loading: (target) => t('embed.loading', { target }),
      missing: (target) => t('embed.missing', { target }),
      noSection: (target, heading) => t('embed.noSection', { target, heading }),
      circular: (target) => t('embed.circular', { target }),
      tooDeep: (target) => t('embed.tooDeep', { target }),
      tooMany: (target) => t('embed.tooMany', { target }),
    }),
    [t],
  );

  // Hoisted out of the render below and memoised on what it actually depends on, so its
  // identity survives a keystroke. That is what lets core keep the rendered embeds it already
  // has instead of re-rendering every transcluded note on every character typed.
  const resolveLink = useMemo(
    () => (target: string, kind: LinkKind, source: string) => {
      // An embedded file is an attachment, addressed by name or by a path from the
      // vault root; only a note is resolved through the link index.
      if (kind === 'embed') {
        const asset = assetResolver.resolve(target);
        if (asset !== null) {
          return { path: asset, href: api.assetUrl(asset) };
        }
      }
      const resolution = resolver.resolve(target, source);
      if (resolution.resolved) {
        return { path: resolution.path, href: noteHref(resolution.path, mode) };
      }
      // Nothing to point at yet: the link leads to the note that would be created.
      return {
        path: null,
        href: resolution.createPath === undefined ? '' : noteHref(resolution.createPath, mode),
      };
    },
    [assetResolver, mode, resolver],
  );

  // Memoised on the note bodies alone, so its identity survives a keystroke: core drops every
  // rendered embed body it has kept when any of its inputs is a different function than before.
  const readNote = useMemo(
    () => (embedded: string) => {
      const source = sources[embedded];
      return source === undefined
        ? undefined
        : { markdown: source.content, headings: source.headings };
    },
    [sources],
  );

  const { html, wanted } = useMemo(() => {
    const rendered = renderNoteWithEmbeds(content, {
      sourcePath: path,
      resolveLink,
      assetUrl: assetUrlOf,
      terms: matcher,
      readNote,
      labels,
    });
    // The renderer reports what it asked for and did not get; the effect below fetches it and
    // the next render fills the placeholders in.
    return { html: rendered.html, wanted: rendered.pending };
  }, [content, labels, matcher, path, readNote, resolveLink]);

  useEffect(() => {
    for (const embedded of wanted) {
      request(embedded);
    }
  }, [request, wanted]);

  return (
    // renderNoteWithEmbeds sanitises its output; the click handler keeps navigation inside the
    // app instead of reloading the page.
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
