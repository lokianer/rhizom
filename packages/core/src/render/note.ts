// Turns one note into HTML for the read-only wiki mode. The Markdown dialect is the one the
// indexer parses (GFM, YAML frontmatter, wikilinks, embeds), and headings are slugged with the
// same algorithm, so the ids in the HTML agree with what `parseNote` reports. Everything the
// note itself contributes is sanitised, so the result can be injected into the DOM as-is.
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import type { Heading, LinkKind } from '../api.js';
import type { CalloutLabels } from '../syntax/callout.js';
import { remarkWikilink } from '../syntax/remark-wikilink.js';
import { findBlockMarkers } from '../syntax/section.js';
import type { TermMatcher } from '../vault/terms.js';
import { sanitizeSchema } from './sanitize.js';
import {
  anchorBlocks,
  collectHeadings,
  fillEmbeds,
  hideBlockMarkers,
  transform,
} from './transform.js';

// The fence language and the class a diagram is marked with. Re-exported here because this is
// the module the renderer is reached through; the list itself lives beside the sanitise schema
// that has to allow it.
export { MERMAID_CLASS, MERMAID_LANGUAGE } from './classes.js';

export interface RenderedLink {
  /** Vault path of the note the link resolves to, or null when it does not exist. */
  path: string | null;
  /** href to put in the HTML (the caller decides its routing scheme). */
  href: string;
  /** Text to show; defaults to the alias or the raw target. */
  label?: string;
}

/** What an `![[…]]` points at, as far as this note can tell. */
export interface EmbedReference {
  /** Resolved vault path, or null when the vault holds no such note. */
  path: string | null;
  /** The target as written, without heading, block id or alias. */
  target: string;
  heading?: string | undefined;
  blockId?: string | undefined;
  alias?: string | undefined;
}

/**
 * What to put in the place of an embed. `ready` carries HTML that is inserted after sanitising
 * and must therefore come from `renderNote` itself; every other state carries a label that is
 * rendered as ordinary text, so the app can say "loading" or "no such note" in its own language
 * without core knowing any.
 */
export type EmbedResult =
  | { state: 'ready'; html: string }
  | { state: 'loading' | 'missing' | 'circular' | 'truncated'; label: string };

export interface RenderOptions {
  /** The note being rendered; a link resolves relative to it. */
  sourcePath: string;
  /** Resolves a wikilink or relative Markdown link target written in `source`. */
  resolveLink: (target: string, kind: LinkKind, source: string) => RenderedLink;
  /** URL of a file inside the vault (images, PDFs) for embeds and Markdown images. */
  assetUrl: (vaultPath: string) => string;
  /**
   * Prepended to every id this render emits. A transcluded note carries its own headings and
   * footnotes into the host page, and two notes may well share a heading; without a prefix the
   * page would hold the same id twice and `#fragment` links would land on the wrong one.
   */
  idPrefix?: string | undefined;
  /**
   * Fills a standalone `![[Note]]`. Returning undefined leaves it a link, which is what happens
   * when nothing supplies this hook at all.
   */
  renderEmbed?: ((reference: EmbedReference) => EmbedResult | undefined) | undefined;
  /**
   * Fills a ` ```rhizom-query ` fence with the answer to it, as the HTML `renderQueryResult`
   * builds. Returning undefined means the answer is not here yet: the block renders a
   * placeholder, and `renderNoteWithEmbeds` reports the body so the app can go and fetch it.
   * Nothing supplying this hook at all leaves the fence the code block it looks like.
   */
  renderQuery?: ((body: string) => string | undefined) | undefined;
  /**
   * What an unanswered query block says while it waits. It cannot travel through `renderQuery` —
   * undefined is that hook's way of saying "not yet" — so it comes in beside it, the way
   * `EmbedLabels` supplies the words a placeholder needs.
   */
  queryLoading?: string | undefined;
  /**
   * The word each kind of callout goes by, shown as the title of one that was written without a
   * title of its own. Core carries no language, so the app supplies them; without them a callout
   * falls back to the word the note itself wrote, `[!tldr]` and all.
   */
  calloutLabels?: CalloutLabels | undefined;
  /**
   * Marks the terms the vault defines where they appear in prose. Built once by the caller and
   * reused: this runs over every text node of every render.
   */
  terms?: TermMatcher | undefined;
}

export interface RenderedNote {
  html: string;
  headings: Heading[];
}

// Frozen once and reused: `.use()` after the first run would throw, and building the pipeline
// per note is the expensive part. Per-note state lives in the tree, never in the processors.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkWikilink)
  .freeze();

function makeRenderer(idPrefix: string) {
  return (
    unified()
      // remark-rehype namespaces footnote ids and the hrefs that point at them; the prefix goes
      // in there too, so a transcluded note's footnotes do not collide with the host's.
      .use(remarkRehype, { clobberPrefix: `user-content-${idPrefix}` })
      .use(rehypeSanitize, sanitizeSchema)
      // Only the embedded-note bodies are raw, and they are inserted after sanitising.
      .use(rehypeStringify, { allowDangerousHtml: true })
      .freeze()
  );
}

// One frozen pipeline per id prefix, not per note: `.use()` after the first run throws, and
// building the pipeline is the expensive part. A page holds a handful of prefixes at most.
const renderers = new Map<string, ReturnType<typeof makeRenderer>>();

// A page uses a handful of prefixes, but a long session moving through many notes would keep
// every one it has ever seen. Past this many, the lot is dropped; the cost is one pipeline
// built per prefix on the next render, which is what the cache saves in the first place.
const MAX_RENDERERS = 64;

function rendererFor(idPrefix: string): ReturnType<typeof makeRenderer> {
  const existing = renderers.get(idPrefix);
  if (existing !== undefined) {
    return existing;
  }
  if (renderers.size >= MAX_RENDERERS) {
    renderers.clear();
  }
  const made = makeRenderer(idPrefix);
  renderers.set(idPrefix, made);
  return made;
}

export function renderNote(markdown: string, options: RenderOptions): RenderedNote {
  const tree = parser.parse(markdown);
  // Frontmatter is metadata, not content; without a handler remark-rehype would print it.
  tree.children = tree.children.filter((child) => child.type !== 'yaml');

  const idPrefix = options.idPrefix ?? '';
  const headings = collectHeadings(tree, idPrefix);
  // Block ids are read off the tree as the note was written, before anything else has touched a
  // text node — the term marker splits them, and a callout takes its first line apart.
  const blocks = findBlockMarkers(tree, markdown);
  hideBlockMarkers(blocks);
  const embeds: string[] = [];
  transform(tree, { options, embeds }, false);
  anchorBlocks(blocks, idPrefix);

  const renderer = rendererFor(idPrefix);
  const hast = renderer.runSync(tree);
  fillEmbeds(hast, embeds);
  return { html: renderer.stringify(hast), headings };
}

export interface Context {
  options: RenderOptions;
  /**
   * HTML this renderer produced itself — an embedded note's body, an answered query block —
   * addressed by its index in `data-embed` and put back after sanitising. See `fillEmbeds`.
   */
  embeds: string[];
}
