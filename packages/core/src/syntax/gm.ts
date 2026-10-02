// What the players must not see: the GM gate. A vault marks it in a way any other editor shows
// as what it is — an Obsidian callout `> [!gm]` for a passage, an Obsidian comment `%%…%%` for a
// sentence — and the frontmatter, which holds alignments and secrets as often as anything else,
// is never shown to the table at all.
//
// Everything here leans towards hiding. A `[!gm]` callout is gated wherever it stands, inside
// whatever it stands in, and for as long as its `revealed:` cannot be read; a comment is gated for
// good; a comment that never closes gates everything after it; an HTML block that holds either is
// gated whole. Detection goes through the Markdown parser, so `%%` in code is text and a `[!gm]`
// in a fence is not a callout. A callout's first line is read twice — as the file writes it and as
// the parser decoded it — and either reading that says "gm" is enough: an author who sees a GM
// block in the GM lens must never find it public in the player view.
//
// `publicMarkdown` is the one function the indexer and the player view both use, so what search
// finds and what the table reads cannot drift apart.
import type { Nodes } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export interface Gate {
  kind: 'callout' | 'comment';
  /** UTF-16 offsets of what is removed: whole lines for a callout, the span for a comment. */
  start: number;
  end: number;
  /** 1-based lines the gate covers. */
  startLine: number;
  endLine: number;
  /** The session from which a callout is public; null while it is gated for good. */
  revealed: number | null;
}

interface Range {
  start: number;
  end: number;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']).freeze();

/**
 * A callout's first line, the way `callout.ts` reads it: `[!word]`, with anything after a `|` as
 * Obsidian's metadata (`[!gm|wide]`) and the space around the word ignored (`[!GM ]`).
 */
const HEADER = /^[ \t]*\[!([^\]\r\n]*)\][+-]?(.*)$/;
const REVEALED = /\brevealed[ \t]*:[ \t]*(\d+)\b/i;
/** An HTML block holding either kind of gate is gated whole: the parser cannot see inside it. */
const GATED_HTML = /\[[ \t]*!|%%|&#|&[a-z]+;/i;
const LINE_END = /\r\n?|\n/;

/** Every gate in a note, in the order they start. */
export function findGates(markdown: string): Gate[] {
  return scan(markdown).gates;
}

/** Whether a gate keeps this 1-based line from the players at a session. */
export function hiddenAt(gates: readonly Gate[], line: number, session: number): boolean {
  return gates.some(
    (gate) =>
      line >= gate.startLine &&
      line <= gate.endLine &&
      (gate.kind === 'comment' || gate.revealed === null || gate.revealed > session),
  );
}

/**
 * The note as the players may read it at a session: no frontmatter, no comment, no GM callout
 * that is not revealed by then. Session 0 is before the first session — every callout hidden.
 */
export function publicMarkdown(markdown: string, session: number): string {
  const { gates, front } = scan(markdown);
  const ranges: Range[] = [...front];
  for (const gate of gates) {
    if (gate.kind === 'comment' || gate.revealed === null || gate.revealed > session) {
      ranges.push({ start: gate.start, end: gate.end });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let text = '';
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      text += markdown.slice(cursor, range.start);
    }
    cursor = Math.max(cursor, range.end);
  }
  return text + markdown.slice(cursor);
}

/** The number of a session note: `type: session` with a whole `session:`. */
export function sessionNumberOf(frontmatter: Record<string, unknown>): number | undefined {
  const type = frontmatter.type;
  if (typeof type !== 'string' || type.trim().toLowerCase() !== 'session') {
    return undefined;
  }
  const value = frontmatter.session;
  const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= 0 ? number : undefined;
}

/** A note the table may always read: `public: true`, and nothing that merely looks like it. */
export function isPublicNote(frontmatter: Record<string, unknown>): boolean {
  return frontmatter.public === true;
}

/** The gates of a note, and where its frontmatter stands. */
function scan(markdown: string): { gates: Gate[]; front: Range[] } {
  const tree = parser.parse(markdown);
  const lineStarts = lineStartsOf(markdown);
  const gates: Gate[] = [];
  const skip: Range[] = [];
  const front: Range[] = [];

  // Whole lines, and the one blank line after them, so the text around closes up the way it
  // would have been written without the passage.
  const wholeLines = (startLine: number, endLine: number, revealed: number | null): void => {
    let last = endLine;
    if (isBlank(markdown, lineStarts, last + 1)) {
      last += 1;
    }
    gates.push({
      kind: 'callout',
      start: lineStarts[startLine - 1] ?? 0,
      end: lineStarts[last] ?? markdown.length,
      startLine,
      endLine,
      revealed,
    });
  };

  const walk = (node: Nodes): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === 'code' || node.type === 'inlineCode') {
      if (start !== undefined && end !== undefined) {
        skip.push({ start, end });
      }
      return;
    }
    if (node.type === 'yaml') {
      if (start !== undefined && end !== undefined) {
        skip.push({ start, end });
        front.push({ start: 0, end: lineStarts[node.position?.end.line ?? 0] ?? end });
      }
      return;
    }
    if (node.type === 'html') {
      if (start !== undefined && end !== undefined) {
        skip.push({ start, end });
        if (GATED_HTML.test(node.value)) {
          wholeLines(node.position?.start.line ?? 1, node.position?.end.line ?? 1, null);
        }
      }
      return;
    }
    if (node.type === 'blockquote' && start !== undefined) {
      const header = gmHeaderOf(node, markdown, start);
      const startLine = node.position?.start.line;
      const endLine = node.position?.end.line;
      if (header !== undefined && startLine !== undefined && endLine !== undefined) {
        const revealed = REVEALED.exec(header)?.[1];
        wholeLines(startLine, endLine, revealed === undefined ? null : Number(revealed));
        // No return: a GM callout inside this one is a gate of its own, and must stay closed
        // when this one is revealed.
      }
    }
    if ('children' in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };
  walk(tree);

  // A frontmatter block the parser did not take as one, written the way the tools that do write
  // it, is still not for the table.
  const fence = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (fence !== null) {
    front.push({ start: 0, end: fence[0].length });
    skip.push({ start: 0, end: fence[0].length });
  }

  for (const comment of commentsOf(markdown, skip)) {
    gates.push({
      kind: 'comment',
      start: comment.start,
      end: comment.end,
      startLine: lineOf(lineStarts, comment.start),
      endLine: lineOf(lineStarts, Math.max(comment.start, comment.end - 1)),
      revealed: null,
    });
  }
  return { gates: gates.sort((a, b) => a.start - b.start), front };
}

/**
 * What follows `[!gm]` on a blockquote's first line, or undefined when it is no GM callout. Read
 * from the file (one `>` taken off, so an outer quote is not mistaken for the callout it holds)
 * and from the parsed text of its first child (which has decoded `&#33;` and joined a header that
 * a setext underline turned into a heading); either reading is enough.
 */
function gmHeaderOf(node: Nodes, markdown: string, start: number): string | undefined {
  if (node.type !== 'blockquote') {
    return undefined;
  }
  const rawLine = (markdown.slice(start).split(LINE_END)[0] ?? '').replace(/^>[ \t]?/, '');
  const first = node.children[0];
  const parsedLine = first === undefined ? '' : (toString(first).split(LINE_END)[0] ?? '');
  for (const line of [rawLine, parsedLine]) {
    const match = HEADER.exec(line);
    const word = match?.[1]?.split('|')[0]?.trim().toLowerCase();
    if (word === 'gm') {
      return match?.[2] ?? '';
    }
  }
  return undefined;
}

/**
 * `%%…%%` spans outside code, HTML and frontmatter; one that never closes runs to the end of the
 * note. A `%%` written after a backslash is text, so `50\%%` cannot shift the pairs after it.
 */
function commentsOf(markdown: string, skip: readonly Range[]): Range[] {
  const skipped = (offset: number): boolean =>
    skip.some((range) => offset >= range.start && offset < range.end);
  const marks: number[] = [];
  let index = markdown.indexOf('%%');
  while (index !== -1) {
    if (markdown[index - 1] === '\\') {
      index = markdown.indexOf('%%', index + 2);
      continue;
    }
    if (!skipped(index)) {
      marks.push(index);
    }
    index = markdown.indexOf('%%', index + 2);
  }
  const comments: Range[] = [];
  for (let i = 0; i < marks.length; i += 2) {
    const start = marks[i] ?? 0;
    const close = marks[i + 1];
    comments.push({ start, end: close === undefined ? markdown.length : close + 2 });
  }
  return comments;
}

/** Where each line starts; `\r\n`, a lone `\r` and `\n` all end one, as they do for the parser. */
function lineStartsOf(markdown: string): number[] {
  const starts = [0];
  for (let i = 0; i < markdown.length; i += 1) {
    const char = markdown[i];
    if (char === '\n' || (char === '\r' && markdown[i + 1] !== '\n')) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineOf(lineStarts: readonly number[], offset: number): number {
  let line = 1;
  while (line < lineStarts.length && (lineStarts[line] ?? Infinity) <= offset) {
    line += 1;
  }
  return line;
}

/** Whether a 1-based line exists and holds nothing but white space. */
function isBlank(markdown: string, lineStarts: readonly number[], line: number): boolean {
  const start = lineStarts[line - 1];
  if (start === undefined || start >= markdown.length) {
    return false;
  }
  const end = lineStarts[line] ?? markdown.length;
  return markdown.slice(start, end).trim() === '';
}
