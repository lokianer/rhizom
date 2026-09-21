// Fuzzy matching for the [[ autocomplete and the command palette: the query must appear as a
// subsequence of the text; matches at word starts and consecutive matches score higher, gaps
// and long texts lower. Fast enough for a few thousand candidates per keystroke.

export interface FuzzyMatch {
  score: number;
  /** Indices of the matched characters in the text, for highlighting. */
  positions: number[];
}

export interface FuzzyRanked<T> extends FuzzyMatch {
  item: T;
}

const SCORE_START = 12;
const SCORE_WORD_START = 10;
const SCORE_CONSECUTIVE = 8;
const GAP_PENALTY_MAX = 8;
const LENGTH_PENALTY = 0.1;

/** Matches `query` against `text`; null when the query is not a subsequence of the text. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  if (query === '') {
    return { score: 0, positions: [] };
  }
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  if (lowerQuery.length > lowerText.length) {
    return null;
  }

  // Latest position each query character may take so that the rest still fits behind it.
  const latest = new Array<number>(lowerQuery.length);
  let limit = lowerText.length - 1;
  for (let i = lowerQuery.length - 1; i >= 0; i -= 1) {
    const found = lowerText.lastIndexOf(lowerQuery.charAt(i), limit);
    if (found === -1) {
      return null;
    }
    latest[i] = found;
    limit = found - 1;
  }

  const positions: number[] = [];
  let score = 0;
  let previous = -1;
  for (let i = 0; i < lowerQuery.length; i += 1) {
    const character = lowerQuery.charAt(i);
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let position = previous + 1; position <= (latest[i] ?? -1); position += 1) {
      if (lowerText.charAt(position) !== character) {
        continue;
      }
      let candidate =
        position === 0 ? SCORE_START : isWordStart(text, position) ? SCORE_WORD_START : 0;
      if (previous !== -1) {
        candidate +=
          position === previous + 1
            ? SCORE_CONSECUTIVE
            : -Math.min(GAP_PENALTY_MAX, position - previous - 1);
      }
      if (candidate > bestScore) {
        bestScore = candidate;
        best = position;
      }
    }
    positions.push(best);
    score += bestScore;
    previous = best;
  }

  return { score: score - text.length * LENGTH_PENALTY, positions };
}

/** Ranks items by fuzzy score (best first); an empty query keeps the original order. */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  limit = Number.POSITIVE_INFINITY,
): FuzzyRanked<T>[] {
  const trimmed = query.trim();
  const ranked: (FuzzyRanked<T> & { length: number; order: number })[] = [];
  for (const [order, item] of items.entries()) {
    const text = getText(item);
    const match = fuzzyMatch(trimmed, text);
    if (match !== null) {
      ranked.push({ item, ...match, length: text.length, order });
    }
  }
  if (trimmed !== '') {
    ranked.sort((a, b) => b.score - a.score || a.length - b.length || a.order - b.order);
  }
  return ranked.slice(0, limit).map(({ item, score, positions }) => ({ item, score, positions }));
}

function isWordStart(text: string, position: number): boolean {
  const previous = text.charAt(position - 1);
  const current = text.charAt(position);
  if (!/[\p{L}\p{N}]/u.test(previous)) {
    return true;
  }
  // camelCase: a lower-case letter followed by an upper-case one.
  return (
    previous === previous.toLowerCase() &&
    current !== current.toLowerCase() &&
    /\p{L}/u.test(previous)
  );
}
