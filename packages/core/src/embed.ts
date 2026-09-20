// Transclusion: `![[Note]]`, `![[Note#Heading]]` and `![[Note#^abc]]` rendered as the note
// itself rather than as a link to it. This is the only code that fills
// `RenderOptions.renderEmbed`, and with it the only code that decides how deep the recursion may
// go and when it has to stop.
//
// The note bodies arrive through a synchronous `readNote`, so the guard lives here while the
// fetching and caching stay with the app. Content the app has not got yet is not an error: the
// embed renders a `loading` placeholder, and the app renders again when the note arrives. That
// keeps the renderer a pure function of what is currently known, which is what the editor's
// preview needs — it renders an unsaved draft on every keystroke, and no server has ever seen
// that text.
import type { Heading } from './api.js';
import { headingSlug } from './parse.js';
import {
  renderNote,
  type EmbedReference,
  type EmbedResult,
  type RenderOptions,
  type RenderedNote,
} from './render.js';
import { sliceBlock, sliceSection } from './section.js';

/** A rendered note, plus what it still needs before it is complete. */
export interface RenderedWithEmbeds extends RenderedNote {
  /**
   * Notes an embed asked for that `readNote` did not have. The caller fetches them and renders
   * again; reported here rather than collected by the caller, because only this module knows
   * which embeds were reached at all — the budget stops before the rest.
   */
  pending: string[];
  /**
   * The bodies of the query blocks `renderQuery` had no answer for, in the order they stand in
   * the page — the host note's and every embedded note's alike. Same idea as `pending`: the
   * caller fetches them and renders again, and the placeholders fill in.
   */
  pendingQueries: string[];
}

/** One note as the renderer needs it: its Markdown and the headings `parseNote` found in it. */
export interface EmbedSource {
  markdown: string;
  headings: readonly Heading[];
}

/**
 * What to show in the place of a body. Core carries no language, so the app supplies the words;
 * each receives the target as written, for a placeholder that names what is missing.
 */
export interface EmbedLabels {
  loading: (target: string) => string;
  /** The vault has no such note. */
  missing: (target: string) => string;
  /**
   * The note is there, but it has no such section: no heading of that name, and no block
   * carrying that id. One label for both, because the reader's mistake is the same one — the
   * address they wrote leads into a note that has nothing at that address.
   */
  noSection: (target: string, heading: string) => string;
  circular: (target: string) => string;
  /** Embedded from within too many embeds. */
  tooDeep: (target: string) => string;
  /** The page has reached its embed budget. */
  tooMany: (target: string) => string;
}

export interface EmbedRenderOptions extends Omit<RenderOptions, 'renderEmbed' | 'idPrefix'> {
  /** The embedded note, or undefined while the app is still fetching it. */
  readNote: (path: string) => EmbedSource | undefined;
  labels: EmbedLabels;
  /** How many embeds deep to go. The default keeps a map of content readable, not infinite. */
  maxDepth?: number;
  /** How many embeds to ask for on one page at all, however they are nested. */
  maxEmbeds?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_EMBEDS = 32;
const CACHE_LIMIT = 64;

// Rendered bodies, kept between calls. The editor's preview re-renders on every keystroke while
// the embedded notes have not changed; without this, editing a map of content re-parses every
// note it pulls in, once per character. Cleared whenever anything that could change the outcome
// of a render is a different function than it was last time.
const bodies = new Map<string, string>();
let owner: readonly unknown[] = [];

function sameOwner(next: readonly unknown[]): boolean {
  return owner.length === next.length && owner.every((value, index) => value === next[index]);
}

function cached(key: string, produce: () => { html: string; settled: boolean }): string {
  const hit = bodies.get(key);
  if (hit !== undefined) {
    // The iteration order is the eviction order, so a hit moves to the back.
    bodies.delete(key);
    bodies.set(key, hit);
    return hit;
  }
  const { html, settled } = produce();
  // A body holding a placeholder is not worth keeping: the note it waits for arrives, and the
  // cached copy would still be waiting. Only a finished render is cached.
  if (settled) {
    if (bodies.size >= CACHE_LIMIT) {
      const oldest = bodies.keys().next().value;
      if (oldest !== undefined) {
        bodies.delete(oldest);
      }
    }
    bodies.set(key, html);
  }
  return html;
}

/**
 * Renders a note with its embeds resolved. `headings` in the result stay the host note's, so an
 * outline lists what the reader wrote, not what the reader pulled in.
 */
export function renderNoteWithEmbeds(
  markdown: string,
  options: EmbedRenderOptions,
): RenderedWithEmbeds {
  const { readNote, labels, maxDepth, maxEmbeds, ...base } = options;
  const depthLimit = maxDepth ?? DEFAULT_MAX_DEPTH;
  const embedLimit = maxEmbeds ?? DEFAULT_MAX_EMBEDS;
  // Everything a cached body's HTML depends on. `terms` belongs here too: a body rendered
  // before the term list arrived carries no marks, and reusing it would keep it that way, and
  // `renderQuery` for the same reason — an embedded note may hold a query block of its own.
  // `calloutLabels` likewise: a reader who switches the interface to German would otherwise keep
  // every callout title an embedded note had when it was last rendered.
  const identity = [
    base.resolveLink,
    base.assetUrl,
    base.terms,
    base.calloutLabels,
    labels,
    readNote,
    base.renderQuery,
  ] as const;
  if (!sameOwner(identity)) {
    bodies.clear();
    owner = identity;
  }

  // Counts every embed the page asks about, not only the ones that render a body: on the first
  // pass nothing is loaded yet, and a budget that counted finished bodies would let a page of
  // two hundred embeds fetch all two hundred before deciding it wanted thirty-two.
  let asked = 0;
  // Placeholders a later render may resolve. A body containing one must not be cached.
  let unsettled = 0;
  const pending: string[] = [];
  const pendingQueries: string[] = [];

  // The app's own hook, watched rather than replaced: an unanswered block is a placeholder for
  // exactly as long as an embed waiting for its note is, so it is collected the same way and
  // keeps the body it stands in out of the cache.
  //
  // Installed even when the caller offered no hook at all. A query block is a question either
  // way, and a caller that has not fetched a single answer yet is in the same position as one
  // whose answers have not arrived: it needs to be told what to ask for. `renderNote` on its own
  // still leaves the fence the code block it looks like.
  const askQuery = base.renderQuery;
  const renderQuery = (body: string): string | undefined => {
    const html = askQuery?.(body);
    if (html === undefined) {
      unsettled += 1;
      if (!pendingQueries.includes(body)) {
        pendingQueries.push(body);
      }
    }
    return html;
  };

  // A note may be transcluded twice on one page, and two sections of one note side by side is
  // the ordinary map-of-content case; only a reference that is already an ancestor of itself is
  // a cycle. Keying on path *and* the piece addressed is what tells those two apart. A block id
  // keeps its caret here as well, so a heading slugging to `loot` and a block `^loot` are two
  // keys rather than one.
  const keyOf = (reference: EmbedReference): string =>
    reference.blockId === undefined
      ? `${reference.path ?? ''}#${headingSlug(reference.heading ?? '')}`
      : `${reference.path ?? ''}#^${reference.blockId}`;

  function embedder(
    ancestors: ReadonlySet<string>,
    depth: number,
  ): (reference: EmbedReference) => EmbedResult | undefined {
    return (reference) => {
      const shown = reference.alias ?? reference.target;
      const path = reference.path;
      if (path === null) {
        return { state: 'missing', label: labels.missing(shown) };
      }
      if (depth >= depthLimit) {
        unsettled += 1;
        return { state: 'truncated', label: labels.tooDeep(shown) };
      }
      if (asked >= embedLimit) {
        unsettled += 1;
        return { state: 'truncated', label: labels.tooMany(shown) };
      }
      const key = keyOf(reference);
      if (ancestors.has(key)) {
        return { state: 'circular', label: labels.circular(shown) };
      }

      // Counted before the body is read, so the same embed gets the same prefix whether or not
      // its note had arrived yet — which is what lets a finished body stay in the cache.
      asked += 1;
      const prefix = `e${String(asked)}-`;
      const source = readNote(path);
      if (source === undefined) {
        unsettled += 1;
        if (!pending.includes(path)) {
          pending.push(path);
        }
        return { state: 'loading', label: labels.loading(shown) };
      }
      let body = source.markdown;
      if (reference.heading !== undefined) {
        const section = sliceSection(source.markdown, source.headings, reference.heading);
        if (section === undefined) {
          return { state: 'missing', label: labels.noSection(shown, reference.heading) };
        }
        body = section;
      } else if (reference.blockId !== undefined) {
        // Nothing about block ids is written to SQLite, and nothing needs to be: the target
        // note's own text is already in hand here, so the id is looked up in it. That is why
        // `INDEX_SCHEMA_VERSION` stands where it stood — a block reference costs one parse of a
        // note the page was about to render anyway, not a table and a migration.
        const block = sliceBlock(source.markdown, reference.blockId);
        if (block === undefined) {
          // The same label a missing heading gets, with the reference as it was written: what
          // the reader needs to hear is which address led nowhere, not which kind it was.
          return { state: 'missing', label: labels.noSection(shown, `^${reference.blockId}`) };
        }
        body = block;
      }

      const html = cached(`${prefix}\u0000${path}\u0000${body}`, () => {
        const before = unsettled;
        const rendered = renderNote(body, {
          ...base,
          sourcePath: path,
          idPrefix: prefix,
          renderEmbed: embedder(new Set([...ancestors, key]), depth + 1),
          renderQuery,
        }).html;
        return { html: rendered, settled: unsettled === before };
      });
      return { state: 'ready', html };
    };
  }

  const rendered = renderNote(markdown, {
    ...base,
    renderEmbed: embedder(new Set([`${base.sourcePath}#`]), 0),
    renderQuery,
  });
  return { ...rendered, pending, pendingQueries };
}
