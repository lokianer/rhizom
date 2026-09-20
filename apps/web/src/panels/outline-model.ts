// The shape of an outline: the headings the API reports for a note, turned into the rows the
// sidebar draws. Kept apart from the component because the web unit tests run without a DOM
// (the reason is written in mention-model.ts), so everything worth asserting about an outline —
// how far in a row sits, which heading a reader is inside — is a plain function here.
import type { Heading } from '@rhizom/core';

export interface OutlineRow {
  /** The heading as written. Empty when the note wrote `##` and nothing after it. */
  text: string;
  /** The level the note gave it, 1 to 6. */
  level: number;
  /** The id the renderer puts on the heading, and the fragment a link to it carries. */
  slug: string;
  /** 1-based line of the heading in the note. */
  line: number;
  /**
   * How many steps in the row is drawn, counted from the headings it hangs under rather than
   * from its level number. A note that opens at `##` — which is most notes whose title is in
   * the file name — starts flush left instead of looking as if an `#` had gone missing, and
   * a `#` followed by a `###` is one step in rather than two.
   */
  depth: number;
}

/**
 * The outline of a note, in the order the headings stand in it. The order is the note's own;
 * an outline that sorted itself would stop being a table of contents.
 */
export function outlineRows(headings: readonly Heading[]): OutlineRow[] {
  // The levels of the headings this one hangs under, outermost first. A heading closes every
  // open level that is not deeper than itself, and what is left is how far in it belongs.
  const open: number[] = [];
  const rows: OutlineRow[] = [];

  for (const heading of headings) {
    let above = open.at(-1);
    while (above !== undefined && above >= heading.level) {
      open.pop();
      above = open.at(-1);
    }
    rows.push({
      text: heading.text,
      level: heading.level,
      slug: heading.slug,
      line: heading.line,
      depth: open.length,
    });
    open.push(heading.level);
  }

  return rows;
}

/**
 * The heading a line of the note sits under: the last one at or above that line. Null for a
 * line before the first heading — frontmatter, or an opening paragraph — where the reader is
 * in the note but not yet in any part of it.
 */
export function headingAt(rows: readonly OutlineRow[], line: number): OutlineRow | null {
  let found: OutlineRow | null = null;
  for (const row of rows) {
    if (row.line > line) {
      break;
    }
    found = row;
  }
  return found;
}

/**
 * The heading a `#fragment` in the address names, slugged the way `outlineRows` reports it.
 * Browsers hand out a percent-encoded fragment for anything outside ASCII, and a heading in
 * German or in another script has exactly such a slug.
 */
export function slugFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '') {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    // A fragment nothing encoded, carrying a stray `%`: it is still what the address says.
    return raw;
  }
}
