// Dice notation: what `{{roll:}}`, `/roll`, a `dice:` chip and a rollable table's heading all mean
// by `2d6+3`. One grammar, so a roll typed into the capture bar and one written into a template
// cannot disagree about what the same words ask for.
//
// It is dice and nothing else. Terms are `NdM` with an optional keep (`4d6kh3`, `2d20kl1`), whole
// numbers, joined by `+` and `-`; `d%` is a hundred-sided die. Nothing is exploded, pooled or
// computed from a stat block — a rules engine is not what a game master reaches for mid-sentence.
//
// The limits are there so that a stray `999d999999` cannot hold up a keystroke or fill a note:
// a hundred dice in all, a thousand sides, twenty terms. Past them the notation is not one.

/** One part of a roll: some dice, or a number added or taken away. */
export type DiceTerm =
  | {
      kind: 'dice';
      sign: 1 | -1;
      count: number;
      sides: number;
      /** `kh3` keeps the three highest, `kl1` the lowest one; without it every die counts. */
      keep?: { which: 'highest' | 'lowest'; count: number };
    }
  | { kind: 'constant'; sign: 1 | -1; value: number };

export interface DiceExpression {
  /** The notation as it reads back: no spaces, lower case. */
  notation: string;
  terms: DiceTerm[];
}

export interface RolledDie {
  value: number;
  /** False for a die a keep left out; it is shown, struck through, but not counted. */
  kept: boolean;
}

export type RolledTerm =
  | { kind: 'dice'; sign: 1 | -1; dice: RolledDie[] }
  | { kind: 'constant'; sign: 1 | -1; value: number };

export interface DiceRoll {
  notation: string;
  total: number;
  terms: RolledTerm[];
  /** One line, ready to write into a note: `2d6+3 → 11 (4, 4, +3)`. */
  text: string;
}

const MAX_DICE = 100;
const MAX_SIDES = 1000;
const MAX_TERMS = 20;

/** One term, read where the last one ended. Sticky, so nothing between two terms is skipped. */
const TERM = /([+-]?)(?:(\d{0,3})d(\d{1,4}|%)(?:(kh|kl)(\d{1,3}))?|(\d{1,6}))/y;

/** Reads a notation, or nothing when it is not one. Spaces anywhere and any case are fine. */
export function parseDice(notation: string): DiceExpression | undefined {
  const text = notation.replace(/\s+/g, '').toLowerCase();
  if (text === '') {
    return undefined;
  }
  const terms: DiceTerm[] = [];
  let dice = 0;
  let at = 0;
  while (at < text.length) {
    TERM.lastIndex = at;
    const match = TERM.exec(text);
    // Every term after the first has to say how it joins the one before; `2d6 3` is two numbers
    // somebody forgot an operator between, not a sum.
    if (match === null || match[0] === '' || (terms.length > 0 && match[1] === '')) {
      return undefined;
    }
    const [, signText, countText, sidesText, keepText, keepCount, constant] = match;
    const sign = signText === '-' ? -1 : 1;
    if (constant !== undefined) {
      terms.push({ kind: 'constant', sign, value: Number(constant) });
    } else {
      const count = countText === undefined || countText === '' ? 1 : Number(countText);
      const sides = sidesText === '%' ? 100 : Number(sidesText);
      if (count < 1 || sides < 1 || sides > MAX_SIDES) {
        return undefined;
      }
      dice += count;
      const term: DiceTerm = { kind: 'dice', sign, count, sides };
      if (keepText !== undefined) {
        const kept = Number(keepCount);
        if (kept < 1 || kept > count) {
          return undefined;
        }
        term.keep = { which: keepText === 'kh' ? 'highest' : 'lowest', count: kept };
      }
      terms.push(term);
    }
    if (terms.length > MAX_TERMS || dice > MAX_DICE) {
      return undefined;
    }
    at = TERM.lastIndex;
  }
  return { notation: text.replace(/^\+/, ''), terms };
}

/**
 * Rolls a notation. `random` gives numbers in [0, 1) and is handed in, so a test can say what the
 * dice show. Nothing when the notation is not one.
 */
export function rollDice(
  notation: string | DiceExpression,
  random: () => number = Math.random,
): DiceRoll | undefined {
  const expression = typeof notation === 'string' ? parseDice(notation) : notation;
  if (expression === undefined) {
    return undefined;
  }
  let total = 0;
  const terms: RolledTerm[] = expression.terms.map((term) => {
    if (term.kind === 'constant') {
      total += term.sign * term.value;
      return term;
    }
    const values: number[] = [];
    for (let die = 0; die < term.count; die += 1) {
      values.push(Math.floor(random() * term.sides) + 1);
    }
    const kept = keptIndices(values, term.keep);
    const dice = values.map((value, index) => ({ value, kept: kept.has(index) }));
    for (const die of dice) {
      if (die.kept) {
        total += term.sign * die.value;
      }
    }
    return { kind: 'dice', sign: term.sign, dice };
  });
  const roll = { notation: expression.notation, total, terms };
  return { ...roll, text: describeRoll(roll) };
}

/** Which of the dice a keep counts. Ties go to the die rolled first, so the result is stable. */
function keptIndices(
  values: readonly number[],
  keep: { which: 'highest' | 'lowest'; count: number } | undefined,
): Set<number> {
  const order = values.map((_, index) => index);
  if (keep === undefined) {
    return new Set(order);
  }
  const direction = keep.which === 'highest' ? -1 : 1;
  order.sort((a, b) => direction * ((values[a] ?? 0) - (values[b] ?? 0)) || a - b);
  return new Set(order.slice(0, keep.count));
}

/**
 * The line a roll is written down as. Every die is shown, a dropped one struck through, and a
 * number added is shown with its sign; a single die with nothing beside it is just its total,
 * because `d20 → 14 (14)` says the same thing twice.
 */
export function describeRoll(roll: Omit<DiceRoll, 'text'>): string {
  const parts: string[] = [];
  for (const term of roll.terms) {
    if (term.kind === 'constant') {
      parts.push(`${term.sign < 0 ? '-' : '+'}${String(term.value)}`);
      continue;
    }
    for (const die of term.dice) {
      const value = `${term.sign < 0 ? '-' : ''}${String(die.value)}`;
      parts.push(die.kept ? value : `~~${value}~~`);
    }
  }
  const total = String(roll.total);
  return parts.length === 1 && parts[0] === total
    ? `${roll.notation} → ${total}`
    : `${roll.notation} → ${total} (${parts.join(', ')})`;
}
