// The frontmatter vocabulary Rhizom reserves. A vault stays plain Markdown that other editors
// open too, so the vocabulary is deliberately flat and small: one `type` key saying what a note
// is, beside the `aliases` and `tags` keys Obsidian established. A value Rhizom does not know
// belongs to the vault, means nothing special here and is never rewritten (see DECISIONS.md).

/** What a note is, when it is more than prose. */
export type NoteType = 'definition' | 'template' | 'query' | 'axes';

/** Every reserved value of `type:`, in the order an interface would list them. */
export const NOTE_TYPES: readonly NoteType[] = ['definition', 'template', 'query', 'axes'];

const RESERVED: ReadonlySet<string> = new Set(NOTE_TYPES);

/**
 * Reads the reserved `type` key. Case and surrounding space do not matter, so `Definition` and
 * `definition ` mean the same thing; anything else reads as undefined, which is not an error but
 * simply a note of no special kind to Rhizom.
 */
export function noteTypeOf(frontmatter: Record<string, unknown>): NoteType | undefined {
  const value = frontmatter.type;
  if (typeof value !== 'string') {
    return undefined;
  }
  const folded = value.trim().toLowerCase();
  return RESERVED.has(folded) ? (folded as NoteType) : undefined;
}
