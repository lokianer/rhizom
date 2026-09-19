// Cuts one section out of a note's source, for `![[Note#Heading]]`. It works on the source text
// rather than on the parsed tree, so what comes back is Markdown the ordinary renderer can take,
// and a heading addressed twice in one vault addresses the same lines here as the `#fragment`
// link that jumps to it: both go through the slugs `parseNote` reported.
import type { Heading } from './api.js';
import { headingSlug } from './parse.js';

// CommonMark ends a line on CR, LF or CRLF, and `parseNote` counts lines that way. A file
// saved by an old Mac editor is rare but real, and splitting it wrongly would shift every line.
const LINE_END = /\r\n|\r|\n/;
const ATX_HEADING = /^#{1,6}(?:\s|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)\s*$/;

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
