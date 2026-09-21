// Everything a link or an embed turns into. A wikilink becomes an anchor, a picture or a file
// link depending on what it points at; a Markdown link or image whose target is a path inside
// the vault is rewritten to the URL the app serves it under. What a target means is decided
// here and nowhere else, so the wiki view and a transcluded note agree on it.
import type { Properties } from 'hast';
import type { Image, Link } from 'mdast';

import type { LinkKind } from '../api.js';
import { headingSlug } from '../syntax/parse.js';
import { blockAnchorId } from '../syntax/section.js';
import { parseWikilink, type WikilinkTarget } from '../syntax/wikilink.js';
import type { Context, RenderedLink } from './note.js';

const MARKDOWN_TARGET = /\.(md|markdown)$/i;
// A trailing `.ext` that really looks like a file extension, so note names such as `v1.2 draft`
// are not mistaken for files. Obsidian requires non-Markdown targets to carry their extension.
const ASSET_EXTENSION = /\.[a-z0-9]{1,8}$/i;
const IMAGE_EXTENSION = /\.(apng|avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Obsidian's embed sizes: `![[picture.png|320]]` and `![[picture.png|320x200]]`.
const EMBED_SIZE = /^(\d{1,4})(?:x(\d{1,4}))?$/;

export function renderWikilink(value: string, embed: boolean, context: Context): Image | Link {
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
  // `parseWikilink` reads a fragment as one or the other, never both; put back together here as
  // it was written, because that is the form `fragmentOf` tells the two apart by.
  const fragment = parts.blockId === undefined ? parts.heading : `^${parts.blockId}`;
  return {
    type: 'link',
    url: link.href + fragmentOf(fragment),
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
export function rewriteLink(node: Link, context: Context): void {
  const target = relativeTarget(node.url);
  if (target === undefined || !MARKDOWN_TARGET.test(target.path)) {
    return;
  }
  const link = context.options.resolveLink(target.path, 'markdown', context.options.sourcePath);
  node.url = link.href + fragmentOf(target.fragment);
  const data = (node.data ??= {});
  data.hProperties = { ...data.hProperties, ...noteLinkProperties(link, target.path) };
}

export function rewriteImage(node: Image, context: Context): void {
  const target = relativeTarget(node.url);
  if (target === undefined) {
    return;
  }
  const link = context.options.resolveLink(target.path, 'embed', context.options.sourcePath);
  node.url = context.options.assetUrl(link.path ?? target.path);
}

/** What `![[target]]` embeds: a picture, another file in the vault, or a note. */
export function embedKind(target: string): 'image' | 'file' | 'note' {
  const name = target.slice(target.lastIndexOf('/') + 1);
  if (MARKDOWN_TARGET.test(name) || !ASSET_EXTENSION.test(name)) {
    return 'note';
  }
  return IMAGE_EXTENSION.test(name) ? 'image' : 'file';
}

/**
 * Where a reference lands in the page, written the way the ids in it are.
 *
 * A heading reference is slugged like the heading ids, so `#Heading` finds its anchor. A block
 * reference — anything starting with a caret, whether it came from a wikilink or from the
 * `#…` of a Markdown link — keeps its caret, because that is what `blockAnchorId` put on the
 * block. The two have to be made in one place or a link stops landing.
 */
function fragmentOf(written: string | undefined): string {
  if (written === undefined || written === '') {
    return '';
  }
  if (written.startsWith('^')) {
    const blockId = written.slice(1).trim();
    return blockId === '' ? '' : `#${blockAnchorId(blockId)}`;
  }
  return `#${headingSlug(written)}`;
}

/** The alias wins over the resolver's label: it is what the author wrote into the note. */
export function labelOf(parts: WikilinkTarget, link: RenderedLink, value: string): string {
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
