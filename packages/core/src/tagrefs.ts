// Where a tag stands in a note's source, so that renaming one can move every mention with it.
//
// A tag is written in two places and they need different tools. In the frontmatter it is a YAML
// value, and `setFrontmatter` already knows how to change one of those without disturbing the
// comments, the order or the quoting around it. In the prose it is a word in a sentence, and
// this module finds those: the span a rewrite may replace, taken from the parser's offsets
// rather than from a search, because a search would find `#npc` inside `#npcs` and inside a
// fenced block that only talks about tags.
//
// Every span is read back before it is handed out. A text node whose value the parser decoded —
// an escaped `\#` earlier on the line — puts the arithmetic out by a character, and a span that
// no longer reads as the tag the parser saw is dropped rather than rewritten at a guess.
import type { Nodes, Parent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { lineOf, lineStarts, sourceLines } from './lines.js';

/** One inline tag in a note's source, with the span a rewrite may replace. */
export interface TagRef {
  /** UTF-16 offsets of the tag's text, the leading `#` excluded. */
  start: number;
  end: number;
  /** The tag exactly as it stands in the file, without the `#`. */
  written: string;
  /** The tag as the index holds it: lower-cased. */
  tag: string;
  /** 1-based line. */
  line: number;
  /** The line it stands in, trimmed, for the preview. */
  context: string;
}

/** One replacement: the span to overwrite and what to put there. */
export interface TagEdit {
  start: number;
  end: number;
  text: string;
}

// The same dialect the indexer parses, frozen once. No wikilink plugin: a tag inside `[[…]]` is
// part of a link target, not a tag, and the plain parser leaves the brackets as text — which the
// `insideLink` guard below would not catch. Keeping the pipeline plain is what makes it catch it.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']).freeze();

// The same shape `parseNote` recognises: a `#` after something that is not part of a word, then
// letters, digits, `_`, `-` or `/`.
const INLINE_TAG = /(?<![\p{L}\p{N}_/#-])#([\p{L}\p{N}_/-]+)/gu;

/**
 * Every inline tag in the source.
 *
 * Absent by the same rule the indexer counts by: a tag in a code span or a fenced block, in the
 * frontmatter, in raw HTML, or inside a link's text is not a tag, so it is not here and is not
 * renamed. A vault that documents its own tag scheme in a code block keeps that block as it is.
 */
export function findTagRefs(markdown: string): TagRef[] {
  const starts = lineStarts(markdown);
  const lines = sourceLines(markdown);
  const refs: TagRef[] = [];

  const walk = (node: Nodes, insideLink: boolean): void => {
    if (node.type === 'text') {
      if (!insideLink) {
        collect(markdown, node, starts, lines, refs);
      }
      return;
    }
    if (!('children' in node)) {
      return;
    }
    const inside = insideLink || node.type === 'link' || node.type === 'linkReference';
    for (const child of (node as Parent).children) {
      walk(child, inside);
    }
  };
  walk(parser.parse(markdown), false);
  return refs;
}

function collect(
  markdown: string,
  node: Nodes & { value: string },
  starts: readonly number[],
  lines: readonly string[],
  refs: TagRef[],
): void {
  const base = node.position?.start.offset;
  if (base === undefined) {
    return;
  }
  for (const match of node.value.matchAll(INLINE_TAG)) {
    const written = match[1] ?? '';
    const normalised = normaliseTag(written);
    if (normalised === undefined) {
      continue;
    }
    const start = base + match.index + 1;
    const end = start + written.length;
    if (markdown.slice(start, end) !== written) {
      continue;
    }
    const line = lineOf(starts, start);
    refs.push({
      start,
      end,
      written,
      tag: normalised,
      line,
      context: (lines[line - 1] ?? '').trim(),
    });
  }
}

/**
 * What a tag becomes when `from` is renamed to `to`, or nothing when the rename does not touch
 * it. A tag is a hierarchy, so renaming `campaign` renames `campaign/silverstadt/npcs` with it;
 * `campaigns` is a different tag and is left alone.
 *
 * The comparison is on the normalised form, the answer keeps the level the file spells: renaming
 * `campaign` to `chronicle` turns `Campaign/NPCs` into `chronicle/NPCs`, because only the level
 * that was renamed was asked about.
 */
export function renamedTag(written: string, from: string, to: string): string | undefined {
  const tag = normaliseTag(written);
  const source = normaliseTag(from);
  if (tag === undefined || source === undefined) {
    return undefined;
  }
  if (tag === source) {
    return to;
  }
  if (tag.startsWith(`${source}/`)) {
    return `${to}${written.slice(source.length)}`;
  }
  return undefined;
}

/**
 * Applies the replacements to the source, back to front so that the offsets of the ones not yet
 * written stay valid. Overlapping edits are a caller's mistake and the later one wins.
 */
export function rewriteTags(markdown: string, edits: readonly TagEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let result = markdown;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const edit of ordered) {
    if (edit.end > previousStart) {
      continue;
    }
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
    previousStart = edit.start;
  }
  return result;
}

/**
 * The form a tag is compared and indexed in. It is `parseNote`'s rule, said again here so that a
 * rename and the index agree on what one tag is: lower-cased, without its `#`, and never made of
 * digits alone.
 */
export function normaliseTag(raw: string): string | undefined {
  const tag = raw.replace(/^#+/, '').trim().toLowerCase();
  if (tag === '' || !/[\p{L}_/-]/u.test(tag)) {
    return undefined;
  }
  return tag;
}

/** Whether a name may be used as the new tag: the shape a tag has, and no empty level in it. */
export function isTagName(raw: string): boolean {
  const tag = raw.trim();
  if (!/^[\p{L}\p{N}_/-]+$/u.test(tag) || normaliseTag(tag) === undefined) {
    return false;
  }
  return !tag.split('/').some((level) => level === '');
}
