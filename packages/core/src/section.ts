// Cuts one piece out of a note's source: a section for `![[Note#Heading]]`, a block for
// `![[Note#^abc]]`. Both work on the source text rather than on the parsed tree, so what comes
// back is Markdown the ordinary renderer can take, and a heading addressed twice in one vault
// addresses the same lines here as the `#fragment` link that jumps to it: both go through the
// slugs `parseNote` reported.
//
// A block id is found through the parser rather than by looking for a `^`, because a `^abc` in
// the middle of a sentence, inside a code fence or inside a code span is not an address — it is
// text that happens to hold a caret, and a vault full of maths or shell scripts holds plenty.
import type { Nodes, Parent, Root, Text } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { Heading } from './api.js';
import { headingSlug } from './parse.js';
import { remarkWikilink } from './remark-wikilink.js';

// CommonMark ends a line on CR, LF or CRLF, and `parseNote` counts lines that way. A file
// saved by an old Mac editor is rare but real, and splitting it wrongly would shift every line.
const LINE_END = /\r\n|\r|\n/;
const ATX_HEADING = /^#{1,6}(?:\s|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)\s*$/;

// The same dialect the indexer parses, frozen once: `.use()` after the first run throws, and
// building the pipeline is the expensive part.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkWikilink)
  .freeze();

/**
 * What a block id is made of, one character at a time. An id as Obsidian writes it stands at the
 * end of the block's last line, after a space: a caret, then letters, digits and hyphens. The
 * whole id counts — `^café` is not the id `caf` followed by a letter, it is a word with a caret
 * in front of it, which is why the scan below stops at the first character that is not one of
 * these and then insists on the caret.
 *
 * ASCII only, on purpose. The id travels into the page as an anchor and into the address bar as
 * a `#fragment`, and both stay exactly as written that way; and it is a token the author copies
 * rather than reads, so nothing is lost by keeping it to the set Obsidian itself generates.
 */
const ID_CHARACTER = /[A-Za-z0-9-]/;

/** What a marker may have behind it: a line break, and the space or `|` a table row ends with. */
const TRAILING: ReadonlySet<string> = new Set([' ', '\t', '|', '\r', '\n']);

/**
 * The marker a string ends with: the id itself, and where the run of spaces before its caret
 * begins — which is what a rewrite has to replace, marker and separating space together.
 *
 * Read backwards from the end rather than with `/[ \t]+\^([A-Za-z0-9-]+)$/`, although that is the
 * grammar this implements. A pattern of that shape is quadratic on a line made of nothing but
 * spaces and tabs: the engine starts again at every one of them, consumes the rest, and fails the
 * anchor. A note is somebody else's file and a line of ten thousand tabs is a legal one, so the
 * scan walks each character once instead.
 */
function markerAtEnd(text: string): { id: string; offset: number } | undefined {
  let start = text.length;
  while (start > 0 && ID_CHARACTER.test(text[start - 1]!)) {
    start -= 1;
  }
  // An id of no characters, or one with no caret in front of it, is not a marker.
  if (start === text.length || start === 0 || text[start - 1] !== '^') {
    return undefined;
  }
  let offset = start - 1;
  while (offset > 0 && (text[offset - 1] === ' ' || text[offset - 1] === '\t')) {
    offset -= 1;
  }
  // The caret has to follow whitespace: `E = mc^2` ends in an id and is not one.
  return offset === start - 1 ? undefined : { id: text.slice(start), offset };
}

/**
 * The id one line of source ends with, if it ends with one at all — the same grammar and the
 * same end-of-line rule `sliceBlock` reads a marker by, on a line rather than on a parsed tree.
 *
 * It exists for the editor, which writes these markers and must agree with the reader about what
 * one is. `sliceBlock` would answer the same question by parsing the whole note to find one id,
 * which is not a thing to do on a keystroke. On a line rather than a tree it cannot tell a caret
 * in running text from one inside a fenced block; a caller that needs that distinction wants
 * `sliceBlock`.
 */
export function blockIdOnLine(line: string): string | undefined {
  let end = line.length;
  // A line break, and the trailing space or `|` a table row ends with: the marker stands before
  // all of it. Trimmed by hand for the reason `markerAtEnd` gives.
  while (end > 0 && TRAILING.has(line[end - 1]!)) {
    end -= 1;
  }
  return markerAtEnd(line.slice(0, end))?.id;
}

/** The same set again, for checking a reference before it is looked up. */
const BLOCK_ID = /^[A-Za-z0-9-]+$/;

/**
 * Nodes an id never belongs to. The document is not a block; and a list is a set of siblings
 * rather than a thing anybody points at, so an id at the end of its last item marks that item.
 */
const NOT_A_BLOCK = new Set(['root', 'list']);

/**
 * The lines of the section a reference names: the heading itself and everything under it, up to
 * the next heading of the same level or higher, or the end of the note. Undefined when the note
 * has no such heading at the top level of the document.
 *
 * The reference is slugged the way the headings were, so `#Loot`, `#loot` and `#  Loot  ` all
 * find the first `## Loot`, and a second `## Loot` in the same note is `#loot-1`, exactly as in
 * an anchor link.
 *
 * Only headings that start a line of the document count. A `## …` inside a callout, a blockquote
 * or a list item is a heading to the parser, but it is part of a block, not a boundary between
 * them: treating it as one would cut a section short at the callout, and slicing the nested
 * heading itself would hand back lines that were never a unit.
 */
export function sliceSection(
  markdown: string,
  headings: readonly Heading[],
  reference: string,
): string | undefined {
  const wanted = headingSlug(reference);
  if (wanted === '') {
    return undefined;
  }

  const lines = markdown.split(LINE_END);
  const atTopLevel = headings.filter((heading) => startsALine(lines, heading));
  const index = atTopLevel.findIndex((heading) => heading.slug === wanted);
  const heading = atTopLevel[index];
  if (heading === undefined) {
    return undefined;
  }

  const next = atTopLevel.slice(index + 1).find((later) => later.level <= heading.level);
  const end = next === undefined ? lines.length : next.line - 1;
  return lines
    .slice(heading.line - 1, end)
    .join('\n')
    .trimEnd();
}

/**
 * Whether the heading opens a line of the document rather than sitting inside another block.
 * `parseNote` reports a heading's first line; a `#` heading has to start that line, and a setext
 * heading has to be an unindented line with its `===` or `---` underline directly below.
 */
function startsALine(lines: readonly string[], heading: Heading): boolean {
  // `parseNote` falls back to 0 for a node without a position, which no line can be.
  if (heading.line < 1) {
    return false;
  }
  const line = lines[heading.line - 1];
  if (line === undefined) {
    return false;
  }
  if (ATX_HEADING.test(line)) {
    return true;
  }
  const underline = lines[heading.line];
  return (
    !line.startsWith(' ') &&
    !line.startsWith('\t') &&
    underline !== undefined &&
    SETEXT_UNDERLINE.test(underline)
  );
}

/**
 * The id a block's anchor carries in the page, and the `#fragment` a link to it names. One
 * function for both, because a link only lands when the two agree.
 *
 * The caret stays. A block id is letters, digits and hyphens — exactly what a heading slugs to —
 * so without it a note holding both `## Loot` and a block `^loot` would write the same id twice
 * and one of the two links would land on the wrong line.
 *
 * A `^` is legal in an HTML id and is written there as it stands, while the `#fragment` of the
 * href reaches the page percent-encoded: mdast-util-to-hast normalises every URL it writes. That
 * is the road a heading in German or Japanese has always taken, and the app decodes a fragment
 * before it looks it up, so the two ends still meet.
 */
export function blockAnchorId(blockId: string): string {
  return `^${blockId}`;
}

/** One block id found in a note, with everything the renderer needs to act on it. */
export interface BlockMarker {
  /** The id as written, without the caret. */
  id: string;
  /** The block the id belongs to: what an embed slices, and what the anchor goes on. */
  block: Nodes;
  /** The text node the marker stands in, and the node that holds it. */
  text: Text;
  parent: Parent;
  /** Where the marker begins in `text.value`, the space before the caret included. */
  offset: number;
}

/**
 * Every block id in a parsed note, in the order they stand in it. Exported for `render.ts`,
 * which has the tree in hand already and must not parse the note a second time per keystroke;
 * not part of the package's public surface.
 *
 * An id claimed twice belongs to the first block that carries it. A duplicate is a slip of the
 * copy key, and the first one is the one every link written so far already found: letting a
 * later one win would move an anchor that was working.
 */
export function findBlockMarkers(tree: Root, markdown: string): BlockMarker[] {
  const markers: BlockMarker[] = [];
  const claimed = new Set<string>();
  const ancestors: Nodes[] = [];

  const walk = (node: Nodes, parent: Parent | undefined): void => {
    if (node.type === 'text') {
      const marker = markerIn(node, markdown);
      if (marker === undefined || parent === undefined || claimed.has(marker.id)) {
        return;
      }
      const block = blockOf(node, ancestors);
      if (block !== undefined) {
        claimed.add(marker.id);
        markers.push({ id: marker.id, offset: marker.offset, block, text: node, parent });
      }
      return;
    }
    if (!('children' in node)) {
      return;
    }
    ancestors.push(node);
    for (const child of node.children) {
      walk(child, node);
    }
    ancestors.pop();
  };

  walk(tree, undefined);
  return markers;
}

/**
 * The source of the block carrying this id, or undefined when the note carries no such id.
 *
 * The `^id` comes with it. This hands back the block as it stands in the file — the renderer is
 * the one place that decides what the reader sees, and it hides the marker there, so an embedded
 * block and the note it came from are hidden by the same line of code rather than by two.
 */
export function sliceBlock(markdown: string, blockId: string): string | undefined {
  const wanted = blockId.trim();
  if (!BLOCK_ID.test(wanted)) {
    return undefined;
  }
  const found = findBlockMarkers(parser.parse(markdown), markdown).find(
    (marker) => marker.id === wanted,
  );
  const position = found?.block.position;
  if (position === undefined) {
    return undefined;
  }
  // A nested list item stands four spaces in, and four spaces on their own are an indented code
  // block: cut out of the list around it, the item has to be moved back to the margin to stay
  // the item it was.
  const indent = position.start.column - 1;
  return markdown
    .split(LINE_END)
    .slice(position.start.line - 1, position.end.line)
    .map((line) => dedent(line, indent))
    .join('\n')
    .trimEnd();
}

function dedent(line: string, indent: number): string {
  let at = 0;
  while (at < indent && (line[at] === ' ' || line[at] === '\t')) {
    at += 1;
  }
  return line.slice(at);
}

/** The id this text node ends with, if it ends with one at all. */
function markerIn(node: Text, markdown: string): { id: string; offset: number } | undefined {
  const marker = markerAtEnd(node.value);
  const end = node.position?.end.offset;
  if (marker === undefined || end === undefined) {
    return undefined;
  }
  return endsTheLine(markdown, end) ? marker : undefined;
}

/**
 * Whether nothing but the end of the line follows the marker. This is what keeps `**bold ^abc**`
 * and `[a link ^abc](x.md)` out: the caret is inside something that goes on after it, so it was
 * never the end of a block.
 *
 * A `|` counts as the end of the line, because a table row is written with one. `| 1 | 2 ^abc |`
 * is how an id reaches a table at all — there is nowhere else on that line to put it.
 */
function endsTheLine(markdown: string, from: number): boolean {
  for (let at = from; at < markdown.length; at += 1) {
    const character = markdown[at];
    if (character === '\n' || character === '\r') {
      return true;
    }
    if (character !== ' ' && character !== '\t' && character !== '|') {
      return false;
    }
  }
  return true;
}

/**
 * Which block an id belongs to: the outermost one the marker ends.
 *
 * Outermost, because the reader put the id on the last line of the thing they were looking at,
 * and the largest thing ending there is that thing. So a paragraph is the paragraph; a blockquote
 * is the whole quotation, callout title and all, rather than the last paragraph inside it; and an
 * id halfway down a quotation, which ends no more than the paragraph it sits in, marks that
 * paragraph. A list is the exception in one direction (see `NOT_A_BLOCK`), a table in the other:
 * a row cut out of a table is no longer a table but a line of text with pipes in it, so an id
 * anywhere in a row marks the whole table, header and all.
 *
 * Undefined when nothing ends there — a hard-wrapped line in the middle of a paragraph, say.
 */
function blockOf(text: Text, ancestors: readonly Nodes[]): Nodes | undefined {
  for (const ancestor of ancestors) {
    if (NOT_A_BLOCK.has(ancestor.type) || lastLeaf(ancestor) !== text) {
      continue;
    }
    if (ancestor.type === 'tableRow' || ancestor.type === 'tableCell') {
      return ancestors.find((node) => node.type === 'table') ?? ancestor;
    }
    return ancestor;
  }
  return undefined;
}

/** The last thing inside a node, however deep: what its last line ends with. */
function lastLeaf(node: Nodes): Nodes {
  let current = node;
  while ('children' in current) {
    const last: Nodes | undefined = current.children.at(-1);
    if (last === undefined) {
      return current;
    }
    current = last;
  }
  return current;
}
