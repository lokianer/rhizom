// Parses one note into everything the index needs, in a single pass over the mdast tree:
// title, frontmatter (with aliases and tags), links of every kind with line numbers, headings
// with unique slugs, inline tags outside code, and plain text for full-text search.
import GithubSlugger, { slug as slugOf } from 'github-slugger';
import type { Nodes, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';

import type { Heading, LinkKind } from './api.js';
import { remarkWikilink } from './remark-wikilink.js';
import { parseWikilink } from './wikilink.js';

export interface ParsedLink {
  kind: LinkKind;
  /** The target as written (wikilink text or link URL). */
  raw: string;
  /** Target path or name, decoded and trimmed, without heading or block reference. */
  target: string;
  alias?: string;
  heading?: string;
  blockId?: string;
  /** 1-based line of the link in the source. */
  line: number;
}

export interface ParsedNote {
  title: string;
  frontmatter: Record<string, unknown>;
  frontmatterError?: string;
  aliases: string[];
  tags: string[];
  links: ParsedLink[];
  headings: Heading[];
  /**
   * Plain text without frontmatter and Markdown syntax, one line per block: a paragraph is one
   * line however the file wraps it. Only a fenced code block keeps its own line breaks.
   */
  text: string;
  wordCount: number;
}

export interface ParseOptions {
  /** Used when neither frontmatter nor a level-1 heading provides a title (usually the file name). */
  fallbackTitle: string;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkWikilink)
  .freeze();

// A tag starts with # after a non-word character and contains letters, digits, _, - or /.
const INLINE_TAG = /(?<![\p{L}\p{N}_/#-])#([\p{L}\p{N}_/-]+)/gu;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_TARGET = /\.(md|markdown)$/i;
const BLOCKS = new Set(['paragraph', 'heading', 'code', 'html', 'tableRow', 'thematicBreak']);

export function parseNote(markdown: string, options: ParseOptions): ParsedNote {
  const tree = processor.parse(markdown);
  const { frontmatter, error } = readFrontmatter(tree);

  const state: WalkState = {
    slugger: new GithubSlugger(),
    tags: new Set<string>(),
    links: [],
    headings: [],
    pieces: [],
    firstHeading: undefined,
  };
  for (const tag of frontmatterTags(frontmatter)) {
    state.tags.add(tag);
  }
  for (const child of tree.children) {
    if (child.type !== 'yaml') {
      walk(child, state, false);
    }
  }

  const text = state.pieces
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const title =
    typeof frontmatter.title === 'string' && frontmatter.title.trim() !== ''
      ? frontmatter.title.trim()
      : (state.firstHeading ?? options.fallbackTitle);

  const note: ParsedNote = {
    title,
    frontmatter,
    aliases: frontmatterList(frontmatter, ['aliases', 'alias']),
    tags: [...state.tags],
    links: state.links,
    headings: state.headings,
    text,
    wordCount: text === '' ? 0 : text.split(/\s+/).length,
  };
  if (error !== undefined) {
    note.frontmatterError = error;
  }
  return note;
}

interface WalkState {
  slugger: GithubSlugger;
  tags: Set<string>;
  links: ParsedLink[];
  headings: Heading[];
  pieces: string[];
  firstHeading: string | undefined;
}

function walk(node: RootContent, state: WalkState, insideLink: boolean): void {
  switch (node.type) {
    case 'yaml':
      return;
    case 'heading': {
      const text = displayText(node);
      state.headings.push({
        level: node.depth,
        text,
        slug: state.slugger.slug(text),
        line: lineOf(node),
      });
      if (node.depth === 1 && state.firstHeading === undefined && text !== '') {
        state.firstHeading = text;
      }
      break;
    }
    case 'wikilink': {
      const parts = parseWikilink(node.value);
      if (parts.target !== '') {
        const link: ParsedLink = {
          kind: node.embed ? 'embed' : 'wikilink',
          raw: node.value,
          target: parts.target,
          line: lineOf(node),
        };
        if (parts.alias !== undefined) {
          link.alias = parts.alias;
        }
        if (parts.heading !== undefined) {
          link.heading = parts.heading;
        }
        if (parts.blockId !== undefined) {
          link.blockId = parts.blockId;
        }
        state.links.push(link);
      }
      state.pieces.push(parts.alias ?? parts.target);
      return;
    }
    case 'link': {
      const target = localTarget(node.url);
      if (target !== undefined && MARKDOWN_TARGET.test(target.path)) {
        const link: ParsedLink = {
          kind: 'markdown',
          raw: node.url,
          target: target.path,
          line: lineOf(node),
        };
        const alias = toString(node).trim();
        if (alias !== '') {
          link.alias = alias;
        }
        if (target.fragment !== undefined) {
          link.heading = target.fragment;
        }
        state.links.push(link);
      }
      for (const child of node.children) {
        walk(child, state, true);
      }
      return;
    }
    case 'image': {
      const target = localTarget(node.url);
      if (target !== undefined) {
        state.links.push({ kind: 'embed', raw: node.url, target: target.path, line: lineOf(node) });
      }
      state.pieces.push(node.alt ?? '');
      return;
    }
    case 'text': {
      if (!insideLink) {
        for (const match of node.value.matchAll(INLINE_TAG)) {
          const tag = normaliseTag(match[1] ?? '');
          if (tag !== undefined) {
            state.tags.add(tag);
          }
        }
      }
      // A paragraph hard-wrapped in the file is still one block of prose, so its soft line
      // breaks become spaces. Without this a search snippet breaks mid-sentence and the first
      // "line" of a note is only the first line the author happened to type.
      state.pieces.push(node.value.replace(/[ \t]*\n[ \t]*/g, ' '));
      return;
    }
    case 'inlineCode':
    case 'code':
      state.pieces.push(node.value);
      break;
    case 'break':
      state.pieces.push(' ');
      return;
    case 'html':
      break;
    default:
      break;
  }

  if ('children' in node) {
    for (const child of node.children) {
      walk(child, state, insideLink);
    }
  }
  if (BLOCKS.has(node.type)) {
    state.pieces.push('\n');
  } else if (node.type === 'tableCell' || node.type === 'listItem') {
    state.pieces.push(node.type === 'tableCell' ? ' ' : '\n');
  }
}

/**
 * A node's text as the reader sees it. `mdast-util-to-string` would hand back a wikilink's raw
 * value, so `## See [[Silverstadt|the city]]` would read `See Silverstadt|the city` and slug to
 * something no anchor in Obsidian ever points at; here it reads `See the city`.
 */
export function displayText(node: Nodes): string {
  const pieces: string[] = [];
  collectText(node, pieces);
  return normaliseHeadingText(pieces.join(''));
}

/**
 * The form a heading's text is compared and slugged in: whitespace runs are one space. Every
 * place that turns a heading *or a reference to one* into a slug goes through this, because a
 * heading id, a `#fragment` href and a `![[Note#Heading]]` all have to end up at the same
 * string — and a reference is usually the heading copied verbatim, spacing and all.
 */
export function normaliseHeadingText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** The slug of a heading reference, as `parseNote` slugged the heading itself. */
export function headingSlug(reference: string): string {
  return slugOf(normaliseHeadingText(reference));
}

function collectText(node: Nodes, pieces: string[]): void {
  if (node.type === 'wikilink') {
    const parts = parseWikilink(node.value);
    pieces.push(parts.alias ?? parts.target);
    return;
  }
  if ('value' in node && typeof node.value === 'string') {
    pieces.push(node.value);
    return;
  }
  if (node.type === 'image') {
    pieces.push(node.alt ?? '');
    return;
  }
  if ('children' in node) {
    for (const child of node.children) {
      collectText(child, pieces);
    }
  }
}

function lineOf(node: Nodes): number {
  return node.position?.start.line ?? 0;
}

function readFrontmatter(tree: Root): { frontmatter: Record<string, unknown>; error?: string } {
  const first = tree.children[0];
  if (first?.type !== 'yaml') {
    return { frontmatter: {} };
  }
  try {
    const parsed: unknown = parseYaml(first.value);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown> };
    }
    return { frontmatter: {} };
  } catch (error) {
    return { frontmatter: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Obsidian accepts `tags` or `tag`, as a list or as a comma/space separated string. */
function frontmatterTags(frontmatter: Record<string, unknown>): string[] {
  return frontmatterList(frontmatter, ['tags', 'tag'])
    .flatMap((entry) => entry.split(/[,\s]+/))
    .map((entry) => normaliseTag(entry))
    .filter((tag): tag is string => tag !== undefined);
}

function frontmatterList(frontmatter: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === 'string') {
      values.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' || typeof entry === 'number') {
          values.push(String(entry));
        }
      }
    }
  }
  return values.map((value) => value.trim()).filter((value) => value !== '');
}

/** Lower-cases a tag and drops the leading #; tags made only of digits are not tags. */
function normaliseTag(raw: string): string | undefined {
  const tag = raw.replace(/^#+/, '').trim().toLowerCase();
  if (tag === '' || !/[\p{L}_/-]/u.test(tag)) {
    return undefined;
  }
  return tag;
}

/** Splits a relative URL into a decoded path and fragment; undefined for external or empty URLs. */
function localTarget(url: string): { path: string; fragment?: string } | undefined {
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
  const rawPath = hash === -1 ? trimmed : trimmed.slice(0, hash);
  const fragment = hash === -1 ? undefined : decode(trimmed.slice(hash + 1)).trim();
  const result: { path: string; fragment?: string } = { path: decode(rawPath).trim() };
  if (fragment !== undefined && fragment !== '') {
    result.fragment = fragment;
  }
  return result;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
