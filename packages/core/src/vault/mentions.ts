// Where a note is named without being linked, and how to turn those places into links.
//
// The scan works on the note's source rather than on its plain text, because a rewrite has to
// put a `[[…]]` back at the exact offset it found the words at — and `ParsedNote.text` has the
// syntax stripped and its whitespace collapsed, so an offset in it means nothing on disk.
//
// Only running prose counts. A name inside a link already leads somewhere, one inside code is
// not a mention of anything, and one in the frontmatter is metadata: `aliases: [Mira]` names
// Mira without mentioning her.
import type { Nodes, Parent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { lineOf, lineStarts, sourceLines } from '../text/lines.js';
import { remarkWikilink } from '../syntax/remark-wikilink.js';
import type { TermMatcher } from './terms.js';

/** A stretch of source that is ordinary prose. */
export interface ProseSpan {
  /** UTF-16 offsets into the source. */
  start: number;
  end: number;
  /** Whether the span sits in a heading, where a rewrite would change an anchor. */
  inHeading: boolean;
  /** Whether it sits in a table cell, where an unescaped `|` would end the cell. */
  inTableCell: boolean;
}

/**
 * Characters a link target may not contain, because the wikilink syntax spends them on
 * something else: `#` starts a heading reference, `|` starts the alias and `[`/`]` end the link.
 * A note whose name holds one of them cannot be linked to by writing its name, so a rewrite
 * must not try — it would point somewhere else, or nowhere.
 */
const UNWRITABLE = /[#|[\]]/;

/** Whether a link to this target can be written at all. */
export function canLinkTo(target: string): boolean {
  return target !== '' && !UNWRITABLE.test(target);
}

/** One place a note is named without a link leading there. */
export interface Mention {
  /** Vault path of the note being named. */
  target: string;
  /** 1-based line in the source. */
  line: number;
  /** UTF-16 offsets into the source. */
  start: number;
  end: number;
  /** The words exactly as they stand. */
  text: string;
  /** The line they stand in, trimmed, for the panel. */
  context: string;
  /** In a heading: linking here would change its text and so the anchor pointing at it. */
  inHeading: boolean;
  /** In a table cell, where the alias separator has to be written `\|` to stay in the cell. */
  inTableCell: boolean;
  /**
   * Whether a link can be written here at all. A wikilink may not span a line break, so a
   * mention a hard-wrapped paragraph broke in two is shown but cannot be rewritten.
   */
  linkable: boolean;
}

// The same dialect the indexer parses, minus what a mention scan does not need. Frozen once:
// `.use()` after the first run throws, and building the pipeline is the expensive part.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkWikilink)
  .freeze();

const LINE_END = /\r\n|\r|\n/;

/**
 * Every stretch of the source that is running prose.
 *
 * A wikilink is a leaf node and a code span holds no text node, so both fall out on their own;
 * the text inside a Markdown link has to be excluded by hand, and frontmatter never becomes a
 * text node at all.
 */
export function proseSpans(markdown: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  const walk = (node: Nodes, insideLink: boolean, heading: boolean, cell: boolean): void => {
    if (node.type === 'text') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (!insideLink && start !== undefined && end !== undefined && end > start) {
        spans.push({ start, end, inHeading: heading, inTableCell: cell });
      }
      return;
    }
    if (!('children' in node)) {
      return;
    }
    const parent = node as Parent;
    for (const child of parent.children) {
      walk(
        child,
        insideLink || node.type === 'link' || node.type === 'linkReference',
        heading || node.type === 'heading',
        cell || node.type === 'tableCell',
      );
    }
  };
  walk(parser.parse(markdown), false, false, false);
  return spans;
}

/**
 * Every place the matcher's terms are named in prose. The matcher is run per span rather than
 * over the whole source, so a term cannot be assembled out of words that a link or a code span
 * stands between.
 */
export function findMentions(markdown: string, matcher: TermMatcher): Mention[] {
  if (matcher.size === 0) {
    return [];
  }
  const starts = lineStarts(markdown);
  const lines = sourceLines(markdown);
  const mentions: Mention[] = [];
  for (const span of proseSpans(markdown)) {
    for (const match of matcher.find(markdown.slice(span.start, span.end))) {
      const start = span.start + match.start;
      const line = lineOf(starts, start);
      mentions.push({
        target: match.term.path,
        line,
        start,
        end: span.start + match.end,
        text: match.text,
        context: (lines[line - 1] ?? '').trim(),
        inHeading: span.inHeading,
        inTableCell: span.inTableCell,
        linkable: isLinkable(
          markdown,
          span.start + match.start,
          span.start + match.end,
          match.text,
        ),
      });
    }
  }
  return mentions;
}

/**
 * Whether a link can be written around these exact words.
 *
 * Two things rule it out. A wikilink may not contain a line break, so a mention a hard-wrapped
 * paragraph broke in two cannot be one. And words already sitting in square brackets — an
 * `[undefined reference]`, which remark leaves as plain text — would become `[[[…]]]`, which
 * parses as a link to a name beginning with `[`.
 */
function isLinkable(markdown: string, start: number, end: number, text: string): boolean {
  return !LINE_END.test(text) && markdown[start - 1] !== '[' && markdown[end] !== ']';
}

/**
 * Writes `[[…]]` around the given mentions. Applied back to front, so the offsets of the ones
 * not yet rewritten stay valid, and only where a link can go.
 *
 * `linkAs` is the target as it should be written — the note's name where that is unambiguous,
 * its path where it is not; `canLinkTo` says whether it can be written at all. A mention whose
 * words already read like the target is linked bare; anything else keeps its own words as the
 * alias, so the sentence reads as it did.
 *
 * Inside a table cell the alias separator is written `\|`. An unescaped one would end the cell:
 * the row would gain a column, GFM would drop the last one, and the link would be torn in two
 * with nothing to show for it. Obsidian requires the same backslash there.
 */
export function linkMentions(
  markdown: string,
  mentions: readonly Mention[],
  linkAs: string,
): string {
  if (!canLinkTo(linkAs)) {
    return markdown;
  }
  const ordered = [...mentions]
    .filter((mention) => mention.linkable)
    .sort((a, b) => b.start - a.start);
  let result = markdown;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const mention of ordered) {
    // Overlapping mentions would produce a link inside a link; the later one already won.
    if (mention.end > previousStart) {
      continue;
    }
    const separator = mention.inTableCell ? '\\|' : '|';
    const inner = mention.text === linkAs ? linkAs : `${linkAs}${separator}${mention.text}`;
    result = `${result.slice(0, mention.start)}[[${inner}]]${result.slice(mention.end)}`;
    previousStart = mention.start;
  }
  return result;
}
