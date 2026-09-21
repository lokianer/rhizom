// Where a link's target stands in the source, so that renaming a note can move the links with it.
//
// The index records a link's line, which is enough to show it and nothing like enough to change
// it: a rewrite has to replace the target and leave everything around it exactly as it was — the
// alias, the heading reference, the block id, the link's own text, its title, the backslash a
// table cell needs. So this module hands back the one span a rewrite may replace, taken from the
// parser's offsets rather than from a search: a search would find the second `Mira` on a line
// that holds two of them.
//
// Every span is checked against what the parser made of it before it is handed out. A reference
// whose span does not read back as the target the parser saw — an escape inside a URL, a form
// this scanner did not foresee — is dropped rather than rewritten at a guess.
import type { Nodes, Parent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { LinkKind } from '../api.js';
import { lineOf, lineStarts, sourceLines } from '../text/lines.js';
import { remarkWikilink, type Wikilink } from './remark-wikilink.js';
import { parseWikilink } from './wikilink.js';

/** One link in a note's source, with the span a rewrite may replace. */
export interface LinkRef {
  kind: LinkKind;
  /** UTF-16 offsets of the whole reference, for showing it. */
  start: number;
  end: number;
  /** UTF-16 offsets of the target alone — the only span a rewrite replaces. */
  targetStart: number;
  targetEnd: number;
  /** The target exactly as it stands in the file: `source.slice(targetStart, targetEnd)`. */
  written: string;
  /** The target as a resolver takes it: percent-decoded for a Markdown link, trimmed. */
  target: string;
  /** The destination stood in `<…>`, where spaces need no encoding. */
  angled: boolean;
  alias?: string;
  heading?: string;
  blockId?: string;
  /** 1-based line of the target. */
  line: number;
  /** In a heading, where rewriting moves the anchor every link into it points at. */
  inHeading: boolean;
  /** The line the target stands in, trimmed, for the preview. */
  context: string;
}

/** One replacement: the span to overwrite and what to put there. */
export interface LinkTargetEdit {
  targetStart: number;
  targetEnd: number;
  text: string;
}

// The same dialect the indexer parses, frozen once: `.use()` after the first run throws, and
// building the pipeline is the expensive part.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkWikilink)
  .freeze();

const MARKDOWN_TARGET = /\.(md|markdown)$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every link in the source whose target could be rewritten: wikilinks and embeds, and Markdown
 * links that lead to a note in this vault.
 *
 * What is deliberately absent is what the parser never turns into a link node — a reference
 * definition, raw HTML, an HTML comment, a code span or fence, the frontmatter — and image
 * nodes, whose targets are assets rather than notes. Those references exist and are not
 * rewritten; a caller that promises otherwise is promising something this cannot see.
 */
export function findLinkRefs(markdown: string): LinkRef[] {
  const starts = lineStarts(markdown);
  const lines = sourceLines(markdown);
  const refs: LinkRef[] = [];
  const place = (ref: Omit<LinkRef, 'line' | 'context'>): void => {
    const line = lineOf(starts, ref.targetStart);
    refs.push({ ...ref, line, context: (lines[line - 1] ?? '').trim() });
  };

  const walk = (node: Nodes, inHeading: boolean): void => {
    if (node.type === 'wikilink') {
      const found = wikilinkRef(markdown, node, inHeading);
      if (found !== undefined) {
        place(found);
      }
      return;
    }
    if (node.type === 'link') {
      const found = markdownRef(markdown, node, inHeading);
      if (found !== undefined) {
        place(found);
      }
    }
    // An image's target is an asset, and renaming assets is not this. Its children still hold
    // the alt text only, so nothing below it can be a link.
    if (node.type === 'image' || !('children' in node)) {
      return;
    }
    for (const child of (node as Parent).children) {
      walk(child, inHeading || node.type === 'heading');
    }
  };
  walk(parser.parse(markdown), false);
  return refs;
}

/**
 * Applies the replacements to the source, back to front so that the offsets of the ones not yet
 * written stay valid. Overlapping edits are a caller's mistake and the later one wins.
 */
export function rewriteLinkTargets(markdown: string, edits: readonly LinkTargetEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.targetStart - a.targetStart);
  let result = markdown;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    if (edit.targetEnd > previousStart) {
      continue;
    }
    result = `${result.slice(0, edit.targetStart)}${edit.text}${result.slice(edit.targetEnd)}`;
    previousStart = edit.targetStart;
  }
  return result;
}

/**
 * A vault path as a Markdown link destination: each segment percent-encoded, the separators
 * left alone. Round brackets go too, although `encodeURIComponent` leaves them: an unescaped
 * one inside `(…)` ends the destination early and the rest of the path becomes the title.
 */
export function encodeLinkUrl(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replaceAll('(', '%28').replaceAll(')', '%29'))
    .join('/');
}

/**
 * The span of a wikilink's target. `parseWikilink` decides where the target ends — the first
 * `|` starts the alias, the first `#` before it a heading or block reference, and a `\` right
 * before the pipe escaped it for a table cell — and the span is derived the same way, so that
 * everything the reader wrote after the name survives the rewrite byte for byte.
 */
function wikilinkRef(
  source: string,
  node: Wikilink,
  inHeading: boolean,
): Omit<LinkRef, 'line' | 'context'> | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const content = node.value;
  const contentStart = start + (node.embed ? 3 : 2);
  if (source.slice(contentStart, contentStart + content.length) !== content) {
    return undefined;
  }

  const pipe = content.indexOf('|');
  const referenceEnd = pipe === -1 ? content.length : content[pipe - 1] === '\\' ? pipe - 1 : pipe;
  const reference = content.slice(0, referenceEnd);
  const hash = reference.indexOf('#');
  const raw = hash === -1 ? reference : reference.slice(0, hash);
  // The same trim `parseWikilink` applies, so that `[[  Mira  ]]` keeps its spacing.
  const targetStart = contentStart + (raw.length - raw.trimStart().length);
  const target = raw.trim();
  const targetEnd = targetStart + target.length;

  const parts = parseWikilink(content);
  if (target === '' || target !== parts.target) {
    return undefined;
  }
  return {
    kind: node.embed ? 'embed' : 'wikilink',
    start,
    end,
    targetStart,
    targetEnd,
    written: target,
    target,
    angled: false,
    ...(parts.alias === undefined ? {} : { alias: parts.alias }),
    ...(parts.heading === undefined ? {} : { heading: parts.heading }),
    ...(parts.blockId === undefined ? {} : { blockId: parts.blockId }),
    inHeading,
  };
}

/**
 * The span of a Markdown link's destination: after the label, inside the brackets, before any
 * `#fragment` and before the title. The label is skipped through the node's own children rather
 * than by counting brackets, so `[a [b] c](x.md)` and `[![alt](a.png)](x.md)` come out right.
 */
function markdownRef(
  source: string,
  node: Nodes & { type: 'link' },
  inHeading: boolean,
): Omit<LinkRef, 'line' | 'context'> | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const last = node.children.at(-1)?.position?.end.offset;
  let at = last ?? start + 1;
  while (at < end && source[at] !== ']') {
    at += 1;
  }
  if (source[at + 1] !== '(') {
    return undefined;
  }
  at += 2;
  while (at < end && isSpace(source[at])) {
    at += 1;
  }

  const angled = source[at] === '<';
  const destinationStart = angled ? at + 1 : at;
  let cursor = destinationStart;
  let depth = 0;
  while (cursor < end) {
    const character = source[cursor];
    if (character === '\\') {
      cursor += 2;
      continue;
    }
    if (angled) {
      if (character === '>') {
        break;
      }
    } else if (character === undefined || isSpace(character)) {
      break;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    cursor += 1;
  }

  const destination = source.slice(destinationStart, cursor);
  const hash = destination.indexOf('#');
  const targetStart = destinationStart;
  const targetEnd = destinationStart + (hash === -1 ? destination.length : hash);
  const written = source.slice(targetStart, targetEnd);
  const target = decode(written).trim();

  // What the scanner read must be what the parser read; a URL holding an escape would differ,
  // and a link nobody can rewrite safely is better left out of the list than rewritten wrong.
  const parsedPath = node.url.split('#', 1)[0] ?? '';
  if (target === '' || target !== decode(parsedPath).trim()) {
    return undefined;
  }
  if (!isLocalNote(target)) {
    return undefined;
  }

  // The same text `parseNote` records as the link's alias, so the two descriptions of one link
  // agree: the label as the reader sees it, not the markup it is written with.
  const alias = toString(node).trim();
  const heading = hash === -1 ? '' : decode(destination.slice(hash + 1)).trim();
  return {
    kind: 'markdown',
    start,
    end,
    targetStart,
    targetEnd,
    written,
    target,
    angled,
    ...(alias === '' ? {} : { alias }),
    ...(heading === '' ? {} : { heading }),
    inHeading,
  };
}

/** Whether this destination names a note inside the vault rather than somewhere on the web. */
function isLocalNote(target: string): boolean {
  return (
    !target.startsWith('#') &&
    !target.startsWith('//') &&
    !URL_SCHEME.test(target) &&
    MARKDOWN_TARGET.test(target)
  );
}

function isSpace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
