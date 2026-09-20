// Turns one note into HTML for the read-only wiki mode. The Markdown dialect is the one the
// indexer parses (GFM, YAML frontmatter, wikilinks, embeds), and headings are slugged with the
// same algorithm, so the ids in the HTML agree with what `parseNote` reports. Everything the
// note itself contributes is sanitised, so the result can be injected into the DOM as-is.
import GithubSlugger from 'github-slugger';
import type { Properties, Root as HastRoot } from 'hast';
import type { Code, Image, Link, List, Paragraph, Parent, Root, RootContent, Text } from 'mdast';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import type { Heading, LinkKind } from './api.js';
import { applyCallout, CALLOUT_KINDS, type CalloutLabels } from './callout.js';
import { displayText, headingSlug } from './parse.js';
import { QUERY_LANGUAGE } from './query.js';
import type { TermMatcher, VaultTerm } from './terms.js';
import { remarkWikilink } from './remark-wikilink.js';
import { parseWikilink, type WikilinkTarget } from './wikilink.js';

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

const MARKDOWN_TARGET = /\.(md|markdown)$/i;
// A trailing `.ext` that really looks like a file extension, so note names such as `v1.2 draft`
// are not mistaken for files. Obsidian requires non-Markdown targets to carry their extension.
const ASSET_EXTENSION = /\.[a-z0-9]{1,8}$/i;
const IMAGE_EXTENSION = /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Obsidian's embed sizes: `![[picture.png|320]]` and `![[picture.png|320x200]]`.
const EMBED_SIZE = /^(\d{1,4})(?:x(\d{1,4}))?$/;

/**
 * Every class a callout can carry. Derived from `CALLOUT_KINDS` rather than written out again, so
 * that a kind added there cannot become the one whose colour the sanitiser quietly strips.
 */
const CALLOUT_CLASSES: string[] = [
  'rz-callout',
  'rz-callout-title',
  'rz-callout-body',
  ...CALLOUT_KINDS.map((kind) => `rz-callout-${kind}`),
];

type SanitizeAttributes = NonNullable<SanitizeSchema['attributes']>;
type PropertyDefinition = SanitizeAttributes[string][number];

/**
 * Builds a tag's attribute rules from the default schema plus the class names and attributes
 * this renderer emits. hast-util-sanitize takes the first rule that matches a property name, so
 * an extra `className` rule would never be reached: the default one has to be merged instead.
 */
function allowFor(tag: string, classes: string[], ...attributes: string[]): PropertyDefinition[] {
  const inherited = defaultSchema.attributes?.[tag] ?? [];
  const isClassRule = (rule: PropertyDefinition): boolean =>
    Array.isArray(rule) && rule[0] === 'className';
  const inheritedClasses = inherited.flatMap((rule) => (isClassRule(rule) ? rule.slice(1) : []));
  return [
    ...inherited.filter((rule) => !isClassRule(rule)),
    ['className', ...inheritedClasses, ...classes],
    ...attributes,
  ];
}

/**
 * GitHub's schema plus exactly what this renderer emits. Clobbering is switched off on purpose:
 * remark-rehype already namespaces its footnote ids and writes matching hrefs, so a second
 * `user-content-` prefix from the sanitiser would break every footnote link, and heading ids
 * have to stay equal to the slugs returned in `headings` and used in `#fragment` hrefs. Nothing
 * untrusted reaches the sanitiser as an id: raw HTML in the source never becomes markup.
 */
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: allowFor('a', ['rz-wikilink', 'rz-wikilink-missing', 'rz-embed-file'], 'dataTarget'),
    div: allowFor(
      'div',
      ['rz-embed', 'rz-query', ...CALLOUT_CLASSES],
      'dataPath',
      'dataEmbed',
      'dataState',
    ),
    // A foldable callout and its title. `open` is allowed on every element by the default schema.
    details: allowFor('details', CALLOUT_CLASSES),
    summary: allowFor('summary', ['rz-callout-title']),
    // Task lists: the class the stylesheet drops the bullets by, and the one that says "ticked".
    ul: allowFor('ul', ['rz-tasks']),
    ol: allowFor('ol', ['rz-tasks']),
    li: allowFor('li', ['rz-task', 'rz-task-done']),
    // `span` is an allowed tag in the default schema but has no attribute rules of its own, so
    // without this the element would survive and its class would be filtered away in silence.
    span: allowFor('span', ['rz-term'], 'dataTerm'),
  },
  clobberPrefix: '',
};

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
  const embeds: string[] = [];
  transform(tree, { options, embeds }, false);

  const renderer = rendererFor(idPrefix);
  const hast = renderer.runSync(tree);
  fillEmbeds(hast, embeds);
  return { html: renderer.stringify(hast), headings };
}

/**
 * Collects the headings and gives each one its id. The text comes from the untouched mdast tree
 * so that it matches `parseNote`, and the slugger is per note so that duplicate headings get
 * the same `-1`, `-2` suffixes there as here.
 */
function collectHeadings(tree: Root, idPrefix: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  visit(tree, 'heading', (node) => {
    const text = displayText(node);
    const slug = slugger.slug(text);
    // The reported slug stays bare, so an outline and a `#fragment` agree with `parseNote`;
    // only the id written into the page carries the prefix that keeps it unique there.
    headings.push({ level: node.depth, text, slug, line: node.position?.start.line ?? 0 });
    const data = (node.data ??= {});
    data.hProperties = { ...data.hProperties, id: `${idPrefix}${slug}` };
  });
  return headings;
}

interface Context {
  options: RenderOptions;
  /**
   * HTML this renderer produced itself — an embedded note's body, an answered query block —
   * addressed by its index in `data-embed` and put back after sanitising. See `fillEmbeds`.
   */
  embeds: string[];
}

/** Rewrites every node whose target points into the vault; the rest stays untouched. */
function transform(parent: Parent, context: Context, insideLink: boolean): void {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      continue;
    }
    if (child.type === 'paragraph' && embedParagraph(child, context)) {
      continue;
    }
    if (child.type === 'code') {
      const block = queryBlock(child, context);
      if (block !== undefined) {
        children[index] = block;
      }
      continue;
    }
    if (child.type === 'wikilink') {
      children[index] = renderWikilink(child.value, child.embed, context);
      continue;
    }
    // Only running text carries term marks. Code is a leaf node and never reaches this branch;
    // a wikilink was replaced above; a link is skipped so a word does not end up with two
    // things to click.
    if (child.type === 'text' && !insideLink) {
      const marked = markTerms(child, context);
      if (marked !== undefined) {
        // Spliced by assignment rather than with a spread: a text node can hold more matches
        // than the engine allows arguments, and `splice(i, 1, ...pieces)` would throw on it.
        children.splice(index, 1);
        for (const [offset, piece] of marked.entries()) {
          children.splice(index + offset, 0, piece);
        }
        index += marked.length - 1;
        continue;
      }
    }
    if (child.type === 'link') {
      rewriteLink(child, context);
    } else if (child.type === 'image') {
      rewriteImage(child, context);
    } else if (child.type === 'blockquote') {
      // A callout is a blockquote that named a kind; everything else stays a quotation. Either
      // way the walk goes on into it below, so a callout's body is rendered like any other prose.
      applyCallout(child, context.options.calloutLabels);
    } else if (child.type === 'list') {
      markTasks(child);
    }
    if ('children' in child) {
      transform(
        child,
        context,
        insideLink || child.type === 'link' || child.type === 'linkReference',
      );
    }
  }
}

/**
 * Splits one text node around the terms the vault defines. Undefined when it holds none, so the
 * overwhelmingly common case allocates nothing.
 *
 * A definition never marks itself: reading the note that defines a word should not present that
 * word as something to look up.
 */
function markTerms(node: Text, context: Context): RootContent[] | undefined {
  const matcher = context.options.terms;
  if (matcher === undefined) {
    return undefined;
  }
  const matches = matcher
    .find(node.value)
    .filter((match) => match.term.path !== context.options.sourcePath);
  if (matches.length === 0) {
    return undefined;
  }

  const pieces: RootContent[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) {
      pieces.push({ type: 'text', value: node.value.slice(at, match.start) });
    }
    pieces.push({
      // Any node remark-rehype knows will do as the carrier; `hName` decides the tag, and
      // emphasis is the least loaded of the inline containers.
      type: 'emphasis',
      children: [{ type: 'text', value: match.text }],
      data: { hName: 'span', hProperties: termProperties(match.term) },
    });
    at = match.end;
  }
  if (at < node.value.length) {
    pieces.push({ type: 'text', value: node.value.slice(at) });
  }
  return pieces;
}

function termProperties(term: VaultTerm): Properties {
  const properties: Properties = { className: ['rz-term'], dataTerm: term.path };
  if (term.summary !== '') {
    // `title` is allowed on every element by the default schema, so the plainest tooltip there
    // is needs no JavaScript and works in the wiki as well as in the preview.
    properties.title = term.summary;
  }
  return properties;
}

/**
 * Turns a paragraph that holds nothing but `![[Note]]` into the embedded-note block. Only a
 * standalone embed becomes a block, because a `<div>` inside a `<p>` is not valid HTML; an
 * embed in running text falls through and is rendered as a link.
 */
function embedParagraph(paragraph: Paragraph, context: Context): boolean {
  const render = context.options.renderEmbed;
  const only = paragraph.children[0];
  if (render === undefined || paragraph.children.length !== 1 || only?.type !== 'wikilink') {
    return false;
  }
  // A paragraph that already names its tag is one this renderer built — a callout's title — and
  // a title is a line of text, not a place to hang a block of transcluded note on.
  if (paragraph.data?.hName !== undefined) {
    return false;
  }
  const parts = parseWikilink(only.value);
  if (!only.embed || embedKind(parts.target) !== 'note') {
    return false;
  }
  const link = context.options.resolveLink(parts.target, 'embed', context.options.sourcePath);
  const reference: EmbedReference = { path: link.path, target: parts.target };
  if (parts.heading !== undefined) {
    reference.heading = parts.heading;
  }
  if (parts.blockId !== undefined) {
    reference.blockId = parts.blockId;
  }
  if (parts.alias !== undefined) {
    reference.alias = parts.alias;
  }
  const result = render(reference);
  if (result === undefined) {
    return false;
  }

  const data = (paragraph.data ??= {});
  data.hName = 'div';
  const properties: Properties = {
    className: ['rz-embed'],
    dataState: result.state,
  };
  if (link.path !== null) {
    properties.dataPath = link.path;
  }
  if (result.state === 'ready') {
    // Replaced by the rendered body after sanitising; the label below is what shows if the
    // marker is ever dropped.
    properties.dataEmbed = String(context.embeds.push(result.html) - 1);
  }
  data.hProperties = properties;
  paragraph.children = [
    {
      type: 'text',
      value: result.state === 'ready' ? labelOf(parts, link, only.value) : result.label,
    },
  ];
  return true;
}

/**
 * Turns a ` ```rhizom-query ` fence into the list or table it describes. It looks like a code
 * block and is written like one, but it is a question about the vault, so it is answered rather
 * than printed — and only when something offers to answer it; without the hook the fence stays
 * the code block every other Markdown tool will show.
 *
 * Undefined leaves the node as it stands. Otherwise the fence becomes a block of its own, which
 * is why the node is replaced instead of relabelled: `code` renders as `<pre><code>`, and the
 * text between the fences is a query, never something to print.
 */
function queryBlock(node: Code, context: Context): Paragraph | undefined {
  const render = context.options.renderQuery;
  // Folded, because an info string is the author's spelling of a language name and `Rhizom-Query`
  // asks the same question.
  if (render === undefined || node.lang?.trim().toLowerCase() !== QUERY_LANGUAGE) {
    return undefined;
  }
  const html = render(node.value);
  const properties: Properties = {
    className: ['rz-query'],
    dataState: html === undefined ? 'loading' : 'ready',
  };
  if (html !== undefined) {
    // Replaced by the answer after sanitising, the same way an embedded body is.
    properties.dataEmbed = String(context.embeds.push(html) - 1);
  }
  return {
    // Any block node remark-rehype knows will do as the carrier; `hName` decides the tag, and a
    // paragraph is the one with nothing of its own to contribute.
    type: 'paragraph',
    children: [
      { type: 'text', value: html === undefined ? (context.options.queryLoading ?? '') : '' },
    ],
    data: { hName: 'div', hProperties: properties },
  };
}

/**
 * Marks a list whose items are tasks — `- [ ]` and `- [x]` — so the stylesheet can drop the
 * bullets the checkboxes stand in for and strike a finished one through. The list is a task list
 * as soon as one item is a task, which is how Markdown writes a list of them.
 *
 * remark-rehype puts a real checkbox in front of the item's content; it renders it disabled, and
 * this leaves it that way. Ticking a box has to write the box back into the Markdown file it came
 * from, and that is a later slice — a box that took the click and then forgot it would be worse
 * than one that plainly cannot be clicked.
 */
function markTasks(list: List): void {
  const tasks = list.children.filter((item) => typeof item.checked === 'boolean');
  if (tasks.length === 0) {
    return;
  }
  // The classes replace the GitHub ones remark-rehype writes: one vocabulary in the page, and
  // `rz-` is the one the stylesheet knows.
  const data = (list.data ??= {});
  data.hProperties = { ...data.hProperties, className: ['rz-tasks'] };
  for (const item of tasks) {
    const itemData = (item.data ??= {});
    itemData.hProperties = {
      ...itemData.hProperties,
      className: item.checked === true ? ['rz-task', 'rz-task-done'] : ['rz-task'],
    };
  }
}

function renderWikilink(value: string, embed: boolean, context: Context): Image | Link {
  const parts = parseWikilink(value);
  const kind = embed ? embedKind(parts.target) : 'note';
  if (kind === 'note') {
    return noteLink(parts, embed ? 'embed' : 'wikilink', value, context);
  }
  const link = context.options.resolveLink(parts.target, 'embed', context.options.sourcePath);
  const url = context.options.assetUrl(link.path ?? parts.target);
  return kind === 'image' ? imageEmbed(parts, url) : fileEmbed(parts, url);
}

function noteLink(parts: WikilinkTarget, kind: LinkKind, value: string, context: Context): Link {
  const link = context.options.resolveLink(parts.target, kind, context.options.sourcePath);
  return {
    type: 'link',
    url: link.href + fragmentOf(parts.heading),
    children: [{ type: 'text', value: labelOf(parts, link, value) }],
    data: { hProperties: noteLinkProperties(link, parts.target) },
  };
}

/**
 * The classes a link to a note carries. Exported for `query-view.ts`, so a note link inside a
 * query result is the same link it would be in prose rather than a second thing that looks like
 * one; not part of the package's public surface.
 */
export function noteLinkProperties(link: RenderedLink, target: string): Properties {
  if (link.path !== null) {
    return { className: ['rz-wikilink'] };
  }
  // The raw target lets the app offer to create the missing note.
  return { className: ['rz-wikilink', 'rz-wikilink-missing'], dataTarget: target };
}

function imageEmbed(parts: WikilinkTarget, url: string): Image {
  const size = parts.alias === undefined ? null : EMBED_SIZE.exec(parts.alias);
  const node: Image = {
    type: 'image',
    url,
    alt: size === null ? (parts.alias ?? parts.target) : parts.target,
  };
  if (size !== null) {
    const properties: Properties = {};
    const [, width, height] = size;
    if (width !== undefined) {
      properties.width = Number(width);
    }
    if (height !== undefined) {
      properties.height = Number(height);
    }
    node.data = { hProperties: properties };
  }
  return node;
}

function fileEmbed(parts: WikilinkTarget, url: string): Link {
  return {
    type: 'link',
    url,
    children: [{ type: 'text', value: parts.alias ?? parts.target }],
    data: { hProperties: { className: ['rz-embed-file'] } },
  };
}

/** `[text](Other%20Note.md#Heading)` is a note link too and is routed like a wikilink. */
function rewriteLink(node: Link, context: Context): void {
  const target = relativeTarget(node.url);
  if (target === undefined || !MARKDOWN_TARGET.test(target.path)) {
    return;
  }
  const link = context.options.resolveLink(target.path, 'markdown', context.options.sourcePath);
  node.url = link.href + fragmentOf(target.fragment);
  const data = (node.data ??= {});
  data.hProperties = { ...data.hProperties, ...noteLinkProperties(link, target.path) };
}

function rewriteImage(node: Image, context: Context): void {
  const target = relativeTarget(node.url);
  if (target === undefined) {
    return;
  }
  const link = context.options.resolveLink(target.path, 'embed', context.options.sourcePath);
  node.url = context.options.assetUrl(link.path ?? target.path);
}

/**
 * Puts the embedded bodies and the answered query blocks in place; they are already HTML and
 * must not be escaped again.
 *
 * This runs *after* `rehypeSanitize` and the result is stringified with `allowDangerousHtml`,
 * so whatever reaches here is written into the page untouched. Exactly two producers of such a
 * string are acceptable: `renderNote` itself, which is why `EmbedResult.ready` is the one state
 * that carries HTML, and `renderQueryResult`, which assembles a tree of nodes and stringifies it
 * with the same compiler rather than pasting text into a template — nothing out of a note or an
 * index can become markup on the way through it. Widening that further — `rehype-raw`, a string
 * built by hand, anything — turns a tool whose whole point is opening somebody else's vault into
 * stored cross-site scripting.
 */
function fillEmbeds(tree: HastRoot, embeds: readonly string[]): void {
  if (embeds.length === 0) {
    return;
  }
  visit(tree, 'element', (element) => {
    const marker = element.properties.dataEmbed;
    if (typeof marker !== 'string') {
      return;
    }
    element.properties.dataEmbed = undefined;
    const body = embeds[Number(marker)];
    if (body !== undefined) {
      element.children = [{ type: 'raw', value: body }];
    }
  });
}

/** What `![[target]]` embeds: a picture, another file in the vault, or a note. */
function embedKind(target: string): 'image' | 'file' | 'note' {
  const name = target.slice(target.lastIndexOf('/') + 1);
  if (MARKDOWN_TARGET.test(name) || !ASSET_EXTENSION.test(name)) {
    return 'note';
  }
  return IMAGE_EXTENSION.test(name) ? 'image' : 'file';
}

/** Heading references are slugged like the heading ids, so `#Heading` finds its anchor. */
function fragmentOf(heading: string | undefined): string {
  return heading === undefined ? '' : `#${headingSlug(heading)}`;
}

/** The alias wins over the resolver's label: it is what the author wrote into the note. */
function labelOf(parts: WikilinkTarget, link: RenderedLink, value: string): string {
  const written = reference(parts);
  return parts.alias ?? link.label ?? (written === '' ? value.trim() : written);
}

function reference(parts: WikilinkTarget): string {
  if (parts.heading !== undefined) {
    return `${parts.target}#${parts.heading}`;
  }
  if (parts.blockId !== undefined) {
    return `${parts.target}#^${parts.blockId}`;
  }
  return parts.target;
}

/** Splits a relative URL into a decoded path and fragment; undefined for external URLs. */
function relativeTarget(url: string): { path: string; fragment?: string } | undefined {
  const trimmed = url.trim();
  if (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    URL_SCHEME.test(trimmed)
  ) {
    return undefined;
  }
  const hash = trimmed.indexOf('#');
  const fragment = hash === -1 ? '' : decode(trimmed.slice(hash + 1)).trim();
  const path = decode(hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
  return fragment === '' ? { path } : { path, fragment };
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
