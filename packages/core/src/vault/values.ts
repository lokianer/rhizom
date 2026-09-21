// What a frontmatter value is, as far as a form and a writer both need to know. Neither side
// owns these: the reader asks so it can offer the right kind of box, and the writer asks so it
// can decide whether a list fits on one line and whether a piece of text is really a date.

/** A date as a form and a vault write one: `2024-05-01`, no time, no zone. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isPlainValue(value: unknown): boolean {
  return (
    value === null ||
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * The date a text spells, or nothing when it is not one. The round trip is the whole test:
 * `Date.parse` rolls `2024-02-30` forward into March rather than refusing it, and a date field
 * that silently moved a day is worse than a text field that kept what somebody typed.
 */
export function dateOf(text: string): Date | undefined {
  if (!ISO_DATE.test(text)) {
    return undefined;
  }
  const time = Date.parse(text);
  if (Number.isNaN(time)) {
    return undefined;
  }
  const date = new Date(time);
  return date.toISOString().startsWith(text) ? date : undefined;
}
