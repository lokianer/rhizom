// Finds the terms a vault defines inside running text. One scan serves three features — the
// definition tooltip, the glossary and the unlinked mentions — so it lives here rather than in
// any one of them.
//
// The scan is written by hand instead of pulling in an Aho–Corasick package. A vault defines
// terms in the hundreds while the haystack is one note at a time, so bucketing the terms by
// their first word and comparing word runs is both faster than building an automaton per
// request and short enough to read. It also gets three things right that a plain substring
// search does not: a term only matches on word boundaries; the space inside a term may be any
// run of whitespace, so a mention a hard-wrapped paragraph broke across two lines is still
// found; and the punctuation a term carries at its edges is part of it, so a note called `C++`
// does not claim every lone `C`.
//
// It knows nothing about Markdown. Over a raw note it will also match inside `[[a wikilink]]`,
// a code span or the frontmatter, so a caller that means *unlinked* mentions has to keep those
// ranges to itself and drop what falls inside them.
import { noteTypeOf } from './frontmatter.js';

/** A term a note declares: what it is called and which note it belongs to. */
export interface DefinedTerm {
  /** The term as written, for display. */
  surface: string;
  /** Vault path of the note that defines it. */
  path: string;
  /** True when the surface comes from `aliases:` rather than from the note's title. */
  alias: boolean;
}

/** A defined term as the reader meets it: with the first block of the note explaining it. */
export interface VaultTerm extends DefinedTerm {
  /** The defining note's first block, for the tooltip on a mention. Empty if it has none. */
  summary: string;
}

const SUMMARY_LENGTH = 400;

/**
 * The first block of a note that is not its own title, cut at a word boundary. It is what the
 * glossary lists and what the tooltip over a term shows, so it is decided here once rather than
 * in each of them; the note itself remains one click away.
 */
export function summaryOf(text: string, title: string): string {
  const folded = foldTerm(title);
  for (const line of text.split('\n')) {
    const block = line.trim();
    if (block === '' || foldTerm(block) === folded) {
      continue;
    }
    if (block.length <= SUMMARY_LENGTH) {
      return block;
    }
    const cut = block.lastIndexOf(' ', SUMMARY_LENGTH);
    return `${block.slice(0, cut === -1 ? SUMMARY_LENGTH : cut)}…`;
  }
  return '';
}

/** One occurrence of a term in a text, as UTF-16 offsets into that text. */
export interface TermMatch {
  term: VaultTerm;
  /** The occurrence exactly as it stands in the text; case and spacing may differ. */
  text: string;
  start: number;
  end: number;
}

export interface TermMatcher {
  /** Every occurrence, left to right and without overlaps; the longest term wins a tie. */
  find(text: string): TermMatch[];
  /** How many distinct terms are being looked for. */
  readonly size: number;
}

// A word is letters and digits, plus combining marks, which are neither but which belong to the
// letter before them: a decomposed `Rhône` would otherwise break into two words and never
// match the composed `Rhône`, because folding to NFC happens per word. An underscore counts only
// *between* two of those, which settles the one Markdown delimiter that is also a word
// character: `_spring tides_` is emphasis and has to match `spring tides`, while `spring_tide`
// is one word and must not be matched by `tide`.
const WORD = /[\p{L}\p{N}\p{M}](?:[\p{L}\p{N}\p{M}_]*[\p{L}\p{N}\p{M}])?/gu;
const CONTAINS_WORD = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s+/gu;
// A blank line ends a block. A term may span the soft break of a hard-wrapped paragraph, but
// not a paragraph boundary, where two neighbouring words have nothing to do with each other.
const PARAGRAPH_BREAK = /\n[^\S\n]*\n/u;

/**
 * The comparable form of a term: NFC so that composed and decomposed accents match, lower case
 * so that a sentence-initial mention matches, and no further than that — dropping accents would
 * make `Rhone` match `Rhône`, which is a different word. `toLowerCase` rather than its locale
 * variant on purpose: a vault must read the same on every machine.
 */
export function foldTerm(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/** Code-unit order. Used wherever an order only has to be the same everywhere, not readable. */
function compareRaw(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The terms a note defines: nothing unless it declares `type: definition`, then its title and
 * every alias. Aliases are what make a definition findable under the words people actually
 * write, so they are terms in their own right.
 */
export function definedTerms(note: {
  path: string;
  title: string;
  aliases: readonly string[];
  frontmatter: Record<string, unknown>;
}): DefinedTerm[] {
  if (noteTypeOf(note.frontmatter) !== 'definition') {
    return [];
  }
  // Mapped before filtering, so that a title without a word does not hand its place — and with
  // it the `alias: false` that marks the note's own name — to the first alias.
  return [note.title, ...note.aliases]
    .map((surface, index) => ({ surface: surface.trim(), path: note.path, alias: index > 0 }))
    .filter((term) => CONTAINS_WORD.test(term.surface));
}

/**
 * Every term a glossary carries: each note's title and each of its aliases, all sharing that
 * note's summary.
 *
 * The wire carries one entry per note rather than one per surface on purpose. A note with nine
 * names would otherwise send its summary nine times, and the browser reloads this list after
 * every save: measured on a vault of 300 definitions with nine names apiece, one entry per note
 * is 171 kB where one per surface was 1,268 kB.
 */
export function glossaryTerms(
  entries: readonly { path: string; title: string; aliases: readonly string[]; summary: string }[],
): VaultTerm[] {
  const terms: VaultTerm[] = [];
  for (const entry of entries) {
    // A note whose title and alias differ only in case says the same word twice; the title
    // keeps the place, because it is the name the glossary lists the note under.
    const seen = new Set<string>();
    for (const [index, surface] of [entry.title, ...entry.aliases].entries()) {
      const trimmed = surface.trim();
      const folded = foldTerm(trimmed);
      if (CONTAINS_WORD.test(trimmed) && !seen.has(folded)) {
        seen.add(folded);
        terms.push({
          surface: trimmed,
          path: entry.path,
          alias: index > 0,
          summary: entry.summary,
        });
      }
    }
  }
  return terms;
}

interface Word {
  /** Folded, so comparisons need no further work. */
  text: string;
  start: number;
  end: number;
}

interface Candidate {
  term: VaultTerm;
  /** The term's words, folded. */
  words: string[];
  /** What stands between consecutive words, every whitespace run collapsed to one space. */
  gaps: string[];
  /** Folded punctuation before the first word and after the last, as in `.NET` or `C++`. */
  prefix: string;
  suffix: string;
}

function wordsOf(text: string): Word[] {
  const found: Word[] = [];
  let match = WORD.exec(text);
  while (match !== null) {
    found.push({
      text: foldTerm(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
    match = WORD.exec(text);
  }
  WORD.lastIndex = 0;
  return found;
}

/**
 * The comparable form of what stands between two words: whitespace counts as a single space
 * wherever it stands, so a wrapped mention reads as one term. Undefined across a blank line,
 * which no term may span.
 */
function gapOf(text: string): string | undefined {
  return PARAGRAPH_BREAK.test(text) ? undefined : text.replace(WHITESPACE, ' ');
}

function candidateOf(term: VaultTerm, parts: readonly Word[]): Candidate {
  const gaps: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    const previous = parts[index - 1];
    const current = parts[index];
    if (previous !== undefined && current !== undefined) {
      gaps.push(gapOf(term.surface.slice(previous.end, current.start)) ?? '');
    }
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  return {
    term,
    words: parts.map((part) => part.text),
    gaps,
    prefix: foldTerm(term.surface.slice(0, first?.start ?? 0)),
    suffix: foldTerm(term.surface.slice(last?.end ?? 0)),
  };
}

/** Whether a candidate's remaining words and separators continue at `index` in the haystack. */
function fits(
  candidate: Candidate,
  haystack: readonly Word[],
  index: number,
  text: string,
): boolean {
  if (index + candidate.words.length > haystack.length) {
    return false;
  }
  for (let offset = 1; offset < candidate.words.length; offset += 1) {
    const previous = haystack[index + offset - 1];
    const current = haystack[index + offset];
    if (previous === undefined || current === undefined) {
      return false;
    }
    if (current.text !== candidate.words[offset]) {
      return false;
    }
    const gap = gapOf(text.slice(previous.end, current.start));
    if (gap === undefined || gap !== candidate.gaps[offset - 1]) {
      return false;
    }
  }
  const first = haystack[index];
  const last = haystack[index + candidate.words.length - 1];
  if (first === undefined || last === undefined) {
    return false;
  }
  return (
    foldTerm(text.slice(first.start - candidate.prefix.length, first.start)) === candidate.prefix &&
    foldTerm(text.slice(last.end, last.end + candidate.suffix.length)) === candidate.suffix
  );
}

export function createTermMatcher(terms: Iterable<VaultTerm>): TermMatcher {
  const buckets = new Map<string, Candidate[]>();
  let size = 0;
  for (const term of terms) {
    const parts = wordsOf(term.surface);
    const first = parts[0];
    if (first === undefined) {
      continue;
    }
    const bucket = buckets.get(first.text);
    if (bucket === undefined) {
      buckets.set(first.text, [candidateOf(term, parts)]);
    } else {
      bucket.push(candidateOf(term, parts));
    }
    size += 1;
  }
  // Longest first, so `Grüne Insel` wins over `Grüne` at the same position; then by path and
  // surface in code-unit order, so the same vault yields the same matches on every machine,
  // whatever order the rows arrive in and whatever locale the host runs under.
  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) =>
        b.words.length - a.words.length ||
        b.suffix.length + b.prefix.length - (a.suffix.length + a.prefix.length) ||
        compareRaw(a.term.path, b.term.path) ||
        compareRaw(a.term.surface, b.term.surface),
    );
  }

  return {
    size,
    find(text: string): TermMatch[] {
      if (buckets.size === 0) {
        return [];
      }
      const haystack = wordsOf(text);
      const matches: TermMatch[] = [];
      let index = 0;
      while (index < haystack.length) {
        const start = haystack[index];
        const bucket = start === undefined ? undefined : buckets.get(start.text);
        const hit = bucket?.find((candidate) => fits(candidate, haystack, index, text));
        const last = hit === undefined ? undefined : haystack[index + hit.words.length - 1];
        if (hit === undefined || start === undefined || last === undefined) {
          index += 1;
          continue;
        }
        const from = start.start - hit.prefix.length;
        const to = last.end + hit.suffix.length;
        matches.push({ term: hit.term, text: text.slice(from, to), start: from, end: to });
        index += hit.words.length;
      }
      return matches;
    },
  };
}
