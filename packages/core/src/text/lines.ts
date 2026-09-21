// Turning an offset into a line number, and back into the line itself. Shared by everything
// that reports a position in a note's source: an offset is what a rewrite needs, a line is what
// a reader needs, and the two have to agree.

const LINE_END = /\r\n|\r|\n/;

/** Offsets at which each line begins, for turning an offset into a 1-based line number. */
export function lineStarts(markdown: string): number[] {
  const starts = [0];
  const pattern = /\r\n|\r|\n/g;
  let match = pattern.exec(markdown);
  while (match !== null) {
    starts.push(match.index + match[0].length);
    match = pattern.exec(markdown);
  }
  return starts;
}

/** The 1-based line an offset falls on. */
export function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}

/** The source split into lines, indexed as `lines[line - 1]`. */
export function sourceLines(markdown: string): string[] {
  return markdown.split(LINE_END);
}
