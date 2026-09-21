// Line breaks as an editor sees them: where the line around an offset starts and ends, whether
// a character is a break at all, and what a text is written with.
//
// Separate from lines.ts, which answers the same kind of question against a precomputed table of
// line starts. The two have different costs — a table pays once and answers many times, these
// count characters around one offset — so a caller picks rather than being given one of them.
// A write into a file asks about one place, which is why these exist.

/** The 1-based line an offset falls on, counted rather than looked up. */
export function lineAt(text: string, offset: number): number {
  return (text.slice(0, offset).match(/\r\n|\n|\r/g)?.length ?? 0) + 1;
}

/** The first character of the line an offset falls on. */
export function lineStartAt(text: string, offset: number): number {
  for (let index = offset - 1; index >= 0; index -= 1) {
    if (isBreak(text[index])) {
      return index + 1;
    }
  }
  return 0;
}

/**
 * Just past the line an offset ends on, its line break included. A value that already ended with
 * its break — a block scalar, a nested mapping — ends where it ends.
 */
export function lineEndAt(text: string, offset: number): number {
  if (offset === 0 || isBreak(text[offset - 1])) {
    return offset;
  }
  for (let index = offset; index < text.length; index += 1) {
    if (text[index] === '\r') {
      return text[index + 1] === '\n' ? index + 2 : index + 1;
    }
    if (text[index] === '\n') {
      return index + 1;
    }
  }
  return text.length;
}

export function isBreak(character: string | undefined): boolean {
  return character === '\n' || character === '\r';
}

export function endsWithBreak(text: string): boolean {
  return isBreak(text[text.length - 1]);
}

export function startsWithBreak(text: string): boolean {
  return isBreak(text[0]);
}

/** Whether a new value would run into whatever the file has after it. */
export function needsSpace(character: string | undefined): boolean {
  return character !== undefined && character !== ' ' && character !== '\t' && !isBreak(character);
}

/** The line ending a text is written with; a new file gets the one this repository writes. */
export function lineBreakOf(text: string): string {
  return /\r\n|\n|\r/.exec(text)?.[0] ?? '\n';
}
