// The rendered side of a note: the same sanitised HTML the wiki serves, from whatever text
// is in the editor right now. An `![[Note]]` shows the note itself; the bodies it needs are
// fetched here rather than in core, which stays a pure function of what is already known — the
// editor renders an unsaved draft on every keystroke, and no server has ever seen that text.
import {
  CALLOUT_KINDS,
  createTermMatcher,
  renderNoteWithEmbeds,
  renderQueryResult,
  type CalloutLabels,
  type EmbedLabels,
  type LinkKind,
  type QueryLabels,
  type QueryLinks,
  type QueryResult,
} from '@rhizom/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { api, SETTLE_MS } from '../api/client.js';
import { useNoteSources } from '../store/notes.js';
import { useQueryResults } from '../store/queries.js';
import { useVaultStore } from '../store/vault.js';
import { createAssetResolver, createResolver } from '../routing/links.js';
import {
  drawDiagrams,
  forgetDiagrams,
  watchTheme,
  type DiagramLabels,
} from '../mermaid/mermaid.js';
import { noteHref } from '../routing/paths.js';

/**
 * The slug a fragment names. A browser percent-encodes a fragment holding anything but ASCII,
 * which a German or emoji heading has, and a fragment that will not decode is taken as written
 * rather than thrown away.
 */
function decodeSlug(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// A stable identity, so a keystroke does not look like a different vault to the renderer.
const assetUrlOf = (vaultPath: string): string => api.assetUrl(vaultPath);

/** A failure shown where the answer would be: the reader reads the reason, not an empty list. */
function failedQuery(message: string): QueryResult {
  return { rows: [], total: 0, view: 'list', columns: [], problems: [{ line: 0, message }] };
}

export interface NotePreviewProps {
  /** The note the text belongs to; links resolve relative to it. */
  path: string;
  content: string;
  /** Where a link inside the preview leads: back into the editor, or deeper into the wiki. */
  mode?: 'notes' | 'wiki';
  /**
   * Ticking a task off. Given, the checkboxes become controls; left out, they stay what the
   * renderer makes them — a picture of what the file says, which is what the wiki wants.
   */
  onToggleTask?: (line: number, done: boolean) => void;
  label?: string | undefined;
}

export function NotePreview({
  path,
  content,
  mode = 'notes',
  label,
  onToggleTask,
}: NotePreviewProps) {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const container = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const notes = useVaultStore((state) => state.notes);
  const assets = useVaultStore((state) => state.assets);
  const sources = useNoteSources((state) => state.sources);
  const request = useNoteSources((state) => state.request);
  const answers = useQueryResults((state) => state.results);
  const requestQuery = useQueryResults((state) => state.request);
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

  const queryLabels = useMemo<QueryLabels>(
    () => ({
      empty: t('query.empty'),
      loading: t('query.loading'),
      // A line of 0 is the parser saying the complaint is about the block as a whole; naming a
      // line that does not exist would send the reader looking for it.
      problem: (line, message) =>
        line === 0 ? t('query.blockProblem', { message }) : t('query.problem', { line, message }),
      more: (shown, total) => t('query.more', { shown, total }),
      columns: {
        title: t('query.columns.title'),
        path: t('query.columns.path'),
        folder: t('query.columns.folder'),
        tags: t('query.columns.tags'),
        modified: t('query.columns.modified'),
        size: t('query.columns.size'),
      },
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

  const queryLinks = useMemo<QueryLinks>(
    () => ({ sourcePath: path, resolveLink }),
    [path, resolveLink],
  );

  // Answers only; a body nobody has asked about yet stays undefined, and the renderer reports it
  // as something to fetch. A block whose answer is already here keeps it while a neighbour waits.
  const renderQuery = useMemo(
    () => (body: string) => {
      const answer = answers[body];
      if (answer === undefined) {
        return undefined;
      }
      const result = answer.state === 'ready' ? answer.result : failedQuery(answer.message);
      return renderQueryResult(result, queryLabels, queryLinks);
    },
    [answers, queryLabels, queryLinks],
  );

  // One word per kind of callout, because core carries no language. The full record is what the
  // type asks for, so a kind added to the renderer cannot ship without a word for it.
  const calloutLabels = useMemo<CalloutLabels>(
    () =>
      Object.fromEntries(
        CALLOUT_KINDS.map((kind) => [kind, t(`callout.${kind}`)]),
      ) as CalloutLabels,
    [t],
  );

  const { html, wanted, queryKey } = useMemo(() => {
    const rendered = renderNoteWithEmbeds(content, {
      sourcePath: path,
      resolveLink,
      assetUrl: assetUrlOf,
      terms: matcher,
      readNote,
      labels,
      renderQuery,
      queryLoading: queryLabels.loading,
      calloutLabels,
    });
    // The renderer reports what it asked for and did not get; the effects below fetch it and
    // the next render fills the placeholders in. The query bodies travel as one string so that
    // an effect can depend on what they say rather than on the array they arrived in.
    return {
      html: rendered.html,
      wanted: rendered.pending,
      queryKey: JSON.stringify(rendered.pendingQueries),
    };
  }, [
    calloutLabels,
    content,
    labels,
    matcher,
    path,
    queryLabels,
    readNote,
    renderQuery,
    resolveLink,
  ]);

  useEffect(() => {
    for (const embedded of wanted) {
      request(embedded);
    }
  }, [request, wanted]);

  const queryBodies = useMemo(() => JSON.parse(queryKey) as string[], [queryKey]);

  // Every keystroke inside a block cancels the timer and starts a new one, so the server hears
  // the question once rather than once per character. A body already answered is not asked about
  // again at all — that is the store's own rule — so the wait costs nothing once the text stands.
  useEffect(() => {
    if (queryBodies.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      for (const body of queryBodies) {
        requestQuery(body);
      }
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [queryBodies, requestQuery]);

  const diagramLabels = useMemo<DiagramLabels>(
    () => ({
      failed: (message) => t('mermaid.failed', { message }),
      failedPlain: t('mermaid.failedPlain'),
    }),
    [t],
  );

  // A diagram is drawn in the colours the page is set in, and the reader can switch between
  // Humus and Kalk without reloading. Nothing about the HTML changes when they do, so the change
  // is watched for: every diagram drawn so far is now in the wrong colours, and the effect below
  // is sent round again to draw them anew.
  const [themeEpoch, setThemeEpoch] = useState(0);
  useEffect(
    () =>
      watchTheme(() => {
        forgetDiagrams();
        setThemeEpoch((epoch) => epoch + 1);
      }),
    [],
  );

  // Mermaid renders asynchronously in a browser, which is why the renderer does not do it: it
  // leaves a container with the diagram's source in it, and this fills them in. Before the paint
  // rather than after, unlike the effects around it — React writes the whole HTML again on every
  // keystroke, taking the diagrams off the page with it, and a pass that ran after the paint
  // would show a frame of bare source between every character typed. A diagram whose source has
  // not changed is put back from memory here and now, without asking mermaid anything.
  useLayoutEffect(() => {
    const host = container.current;
    return host === null ? undefined : drawDiagrams(host, diagramLabels);
  }, [diagramLabels, html, themeEpoch]);

  // The renderer writes every checkbox `disabled`, because in the wiki it is a picture of what
  // the file says rather than a control. Where somebody can write, it becomes one — done here
  // rather than in the renderer so that the HTML the wiki serves is unchanged.
  useEffect(() => {
    if (onToggleTask === undefined) {
      return;
    }
    for (const box of container.current?.querySelectorAll(
      '.rz-task > input[type="checkbox"][disabled]',
    ) ?? []) {
      box.removeAttribute('disabled');
    }
  }, [html, onToggleTask]);

  // `[[Note#Heading]]` and the outline both navigate to `…#slug`, and the renderer puts that
  // slug on the heading as an id. Nothing was reading it, so the address changed and the page
  // stayed where it was. It is done here rather than by the browser because the app never
  // reloads: a fragment only ever arrives through the router, which does not scroll.
  //
  // Watched on the rendered HTML as well as the fragment, because the heading may not be in the
  // page yet — an embed can still be on its way when the link is followed.
  useEffect(() => {
    const slug = hash.startsWith('#') ? decodeSlug(hash.slice(1)) : '';
    if (slug === '') {
      return;
    }
    // Inside this preview only: the wiki and the editor's preview can both be on screen, and a
    // fragment means the one the reader is looking at.
    const heading = container.current?.querySelector(`[id="${CSS.escape(slug)}"]`);
    heading?.scrollIntoView({ block: 'start' });
  }, [hash, html]);

  return (
    // renderNoteWithEmbeds sanitises its output; the click handler keeps navigation inside the
    // app instead of reloading the page.
    <div
      ref={container}
      className="rz-prose"
      {...(label === undefined ? {} : { 'aria-label': label, role: 'region' })}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const box = target.closest('.rz-task > input[type="checkbox"]');
        if (box !== null && onToggleTask !== undefined) {
          const line = Number(box.closest('[data-task-line]')?.getAttribute('data-task-line'));
          if (Number.isInteger(line)) {
            // The box has already drawn itself ticked; the note is what has to agree with it.
            onToggleTask(line, (box as HTMLInputElement).checked);
          }
          return;
        }
        const href = target.closest('a')?.getAttribute('href') ?? '';
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
