// Turns one note into HTML for the read-only wiki mode. The Markdown dialect is the one the
// indexer parses (GFM, YAML frontmatter, wikilinks, embeds), and headings are slugged with the
// same algorithm, so the ids in the HTML agree with what `parseNote` reports. Everything the
// note itself contributes is sanitised, so the result can be injected into the DOM as-is.
import GithubSlugger, { slug as slugOf } from 'github-slugger';
import type { Properties, Root as HastRoot } from 'hast';
import type { Image, Link, Paragraph, Parent, Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import type { Heading, LinkKind } from './api.js';
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

export interface RenderOptions {
  /** Resolves a wikilink or relative Markdown link target written in this note. */
  resolveLink: (target: string, kind: LinkKind) => RenderedLink;
  /** URL of a file inside the vault (images, PDFs) for embeds and Markdown images. */
  assetUrl: (vaultPath: string) => string;
  /** Rendered instead of an embedded note's body; return undefined to render a link instead. */
  renderEmbeddedNote?: ((path: string) => string | undefined) | undefined;
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
    div: allowFor('div', ['rz-embed'], 'dataPath', 'dataEmbed'),
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

const renderer = unified()
  .use(remarkRehype)
  .use(rehypeSanitize, sanitizeSchema)
  // Only the embedded-note bodies are raw, and they are inserted after sanitising.
  .use(rehypeStringify, { allowDangerousHtml: true })
  .freeze();

export function renderNote(markdown: string, options: RenderOptions): RenderedNote {
  const tree = parser.parse(markdown);
  // Frontmatter is metadata, not content; without a handler remark-rehype would print it.
  tree.children = tree.children.filter((child) => child.type !== 'yaml');

  const headings = collectHeadings(tree);
  const embeds: string[] = [];
  transform(tree, { options, embeds });

  const hast = renderer.runSync(tree);
  fillEmbeds(hast, embeds);
  return { html: renderer.stringify(hast), headings };
}

/**
 * Collects the headings and gives each one its id. The text comes from the untouched mdast tree
 * so that it matches `parseNote`, and the slugger is per note so that duplicate headings get
 * the same `-1`, `-2` suffixes there as here.
 */
function collectHeadings(tree: Root): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  visit(tree, 'heading', (node) => {
    const text = toString(node).trim();
    const slug = slugger.slug(text);
    headings.push({ level: node.depth, text, slug, line: node.position?.start.line ?? 0 });
    const data = (node.data ??= {});
    data.hProperties = { ...data.hProperties, id: slug };
  });
  return headings;
}

interface Context {
  options: RenderOptions;
  /** Bodies of embedded notes, addressed by their index in `data-embed`. */
  embeds: string[];
}

/** Rewrites every node whose target points into the vault; the rest stays untouched. */
function transform(parent: Parent, context: Context): void {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      continue;
    }
    if (child.type === 'paragraph' && embedParagraph(child, context)) {
      continue;
    }
    if (child.type === 'wikilink') {
      children[index] = renderWikilink(child.value, child.embed, context);
      continue;
    }
    if (child.type === 'link') {
      rewriteLink(child, context);
    } else if (child.type === 'image') {
      rewriteImage(child, context);
    }
    if ('children' in child) {
      transform(child, context);
    }
  }
}

/**
 * Turns a paragraph that holds nothing but `![[Note]]` into the embedded-note block. Only a
 * standalone embed becomes a block, because a `<div>` inside a `<p>` is not valid HTML; an
 * embed in running text falls through and is rendered as a link.
 */
function embedParagraph(paragraph: Paragraph, context: Context): boolean {
  const render = context.options.renderEmbeddedNote;
  const only = paragraph.children[0];
  if (render === undefined || paragraph.children.length !== 1 || only?.type !== 'wikilink') {
    return false;
  }
  const parts = parseWikilink(only.value);
  if (!only.embed || embedKind(parts.target) !== 'note') {
    return false;
  }
  const link = context.options.resolveLink(parts.target, 'embed');
  if (link.path === null) {
    return false;
  }
  const body = render(link.path);
  if (body === undefined) {
    return false;
  }
  const data = (paragraph.data ??= {});
  data.hName = 'div';
  data.hProperties = {
    className: ['rz-embed'],
    dataPath: link.path,
    dataEmbed: String(context.embeds.push(body) - 1),
  };
  // Replaced by the rendered body after sanitising; shown if the caller drops the marker.
  paragraph.children = [{ type: 'text', value: labelOf(parts, link, only.value) }];
  return true;
}

function renderWikilink(value: string, embed: boolean, context: Context): Image | Link {
  const parts = parseWikilink(value);
  const kind = embed ? embedKind(parts.target) : 'note';
  if (kind === 'note') {
    return noteLink(parts, embed ? 'embed' : 'wikilink', value, context);
  }
  const link = context.options.resolveLink(parts.target, 'embed');
  const url = context.options.assetUrl(link.path ?? parts.target);
  return kind === 'image' ? imageEmbed(parts, url) : fileEmbed(parts, url);
}

function noteLink(parts: WikilinkTarget, kind: LinkKind, value: string, context: Context): Link {
  const link = context.options.resolveLink(parts.target, kind);
  return {
    type: 'link',
    url: link.href + fragmentOf(parts.heading),
    children: [{ type: 'text', value: labelOf(parts, link, value) }],
    data: { hProperties: noteLinkProperties(link, parts.target) },
  };
}

function noteLinkProperties(link: RenderedLink, target: string): Properties {
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
  const link = context.options.resolveLink(target.path, 'markdown');
  node.url = link.href + fragmentOf(target.fragment);
  const data = (node.data ??= {});
  data.hProperties = { ...data.hProperties, ...noteLinkProperties(link, target.path) };
}

function rewriteImage(node: Image, context: Context): void {
  const target = relativeTarget(node.url);
  if (target === undefined) {
    return;
  }
  const link = context.options.resolveLink(target.path, 'embed');
  node.url = context.options.assetUrl(link.path ?? target.path);
}

/** Puts the embedded bodies in place; they are already HTML and must not be escaped again. */
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
  return heading === undefined ? '' : `#${slugOf(heading)}`;
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
