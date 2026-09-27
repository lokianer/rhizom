// YAML anchors can make a value contain itself: `a: &x { b: *x }`. Such a value cannot be
// stored as JSON or sent over the API, so both frontmatter readers turn it away.

/** The complaint a note gets for frontmatter that contains itself. */
export const CIRCULAR_FRONTMATTER = 'The frontmatter refers to itself through a YAML alias';

/** Whether a parsed value contains itself. An alias that only repeats a value is fine. */
export function refersToItself(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (ancestors.has(value)) {
    return true;
  }
  ancestors.add(value);
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
  const found = children.some((child) => refersToItself(child, ancestors));
  ancestors.delete(value);
  return found;
}
