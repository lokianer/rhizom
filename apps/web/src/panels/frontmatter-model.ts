// Shaping for the frontmatter form: a note's head read into rows a form can show, and what a
// changed row hands back to `setFrontmatter`. Kept apart from the component because the web unit
// tests run without a DOM (the reason is written out in mention-model.ts), so anything worth
// asserting has to be a plain function.
//
// Everything here is traffic between two shapes that do not quite match: YAML holds values, a box
// holds text. Going in, a value becomes what its box can carry; coming back, the text becomes a
// value again. Nothing in between folds case, trims or shortens what somebody typed, and nothing
// measures it either — `'👨‍👩‍👧'.length` is 8, and a form that counted that way would refuse a key
// its author can read perfectly well.
import { findFrontmatter, frontmatterFields, type FieldKind } from '@rhizom/core';

/** The kinds a new key can be given, in the order the form offers them. */
export const ADDABLE_KINDS = ['text', 'number', 'boolean', 'date', 'list'] as const;

/** A kind a form can write. `unsupported` is shown and never written, so it is not one of them. */
export type AddableKind = (typeof ADDABLE_KINDS)[number];

/** What a box carries for a field: a list its entries, a date the text `2024-05-01`. */
export type FieldValue = string | number | boolean | readonly string[];

/** One row of the form. */
export interface FormField {
  key: string;
  kind: FieldKind;
  value: FieldValue;
}

/** The whole form, or the complaint that stops it from being one. */
export interface FrontmatterForm {
  /** The rows, in the order the file writes them; none when the note has no frontmatter. */
  fields: FormField[];
  /** What the YAML parser could not read. With one, nothing is editable — nor would a save be. */
  error?: string;
}

/**
 * The note's head as a form shows it.
 *
 * A note without frontmatter is not an error and not empty either: it is a form with no rows yet,
 * and adding the first key writes the block. A head nobody could parse is the one case where the
 * form has nothing to offer, because `setFrontmatter` refuses it too and every value it holds
 * would be a guess.
 */
export function frontmatterForm(content: string): FrontmatterForm {
  const block = findFrontmatter(content);
  if (block === undefined) {
    return { fields: [] };
  }
  if (block.error !== undefined) {
    return { fields: [], error: block.error };
  }
  return {
    fields: frontmatterFields(block).map((field) => ({
      key: field.key,
      kind: field.kind,
      value: inputValue(field.kind, field.value),
    })),
  };
}

/**
 * What one changed row asks `setFrontmatter` for. An empty object asks for nothing, and a key
 * set to `undefined` asks for it to go.
 */
export function fieldChange(
  key: string,
  kind: FieldKind,
  value: FieldValue,
): Record<string, unknown> {
  switch (kind) {
    case 'text':
      return { [key]: boxText(value) };
    case 'number':
      return numberChange(key, boxText(value));
    case 'boolean':
      return { [key]: value === true };
    case 'date': {
      const typed = boxText(value);
      // A date box that has been cleared holds no date, and `when: ""` is a value no reader of
      // the vault can do anything with. The key goes, the way an empty number's does.
      return { [key]: blank(typed) ? undefined : typed };
    }
    case 'list':
      return { [key]: linesOf(value) };
    case 'unsupported':
      // A nested value is shown and never written: no box has its shape, and a save that guessed
      // at one would flatten what somebody arranged by hand.
      return {};
  }
}

/**
 * What a key gets when it is added. The rows are derived from the file on every render, so the
 * value has to be one of the kind that was chosen: a new `count` written empty would come back
 * as a text box, and a new `when` too.
 */
export function blankValue(kind: AddableKind, today: string): FieldValue {
  switch (kind) {
    case 'text':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'date':
      return today;
    case 'list':
      return [];
  }
}

/** What a box shows for a value: a list one entry per line, anything else as its text. */
export function boxText(value: FieldValue): string {
  return typeof value === 'object' ? value.join('\n') : String(value);
}

/**
 * Whether a typed name can become a key. It may not be empty, it may not be a key the block
 * already has — YAML keys are case-sensitive, so `Title` beside `title` is two keys and not a
 * clash — and it may not carry a `.` or a `[`, which are how a path into a nested value is
 * written and nothing this form edits.
 */
export function canAddKey(name: string, keys: readonly string[]): boolean {
  if (blank(name) || keys.includes(name)) {
    return false;
  }
  return !name.includes('.') && !name.includes('[');
}

/**
 * Today where the reader is, as a date field writes it. Deliberately not
 * `toISOString().slice(0, 10)`: that is the day in UTC, which is already tomorrow for anyone
 * east of it in the evening.
 */
export function todayIso(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The value a box starts out holding. */
function inputValue(kind: FieldKind, value: unknown): FieldValue {
  switch (kind) {
    case 'number':
      return typeof value === 'number' ? value : 0;
    case 'boolean':
      return value === true;
    case 'list':
      return Array.isArray(value) ? value.map(plainText) : [];
    case 'text':
    case 'date':
    case 'unsupported':
      return plainText(value);
  }
}

/**
 * A value as the text a box shows it in.
 *
 * A date is a day and not a moment: YAML reads `2024-05-01` as midnight UTC, and reading it back
 * in the reader's own zone would move it to the day before everywhere the clocks stand behind
 * UTC. A key with nothing behind it reads as null and shows as an empty box, which is what a key
 * waiting to be filled in looks like; so does a value that has no text form at all.
 */
function plainText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function numberChange(key: string, typed: string): Record<string, unknown> {
  if (blank(typed)) {
    // `Number('')` is 0, and a form that wrote that would put a figure in somebody's note that
    // nobody typed. An empty box means the key has no number, so the key goes.
    return { [key]: undefined };
  }
  const value = Number(typed);
  // A number box can still be handed text — a paste, a browser that lets one through. Writing
  // NaN is no option and guessing is worse, so the key keeps whatever the file gave it.
  return Number.isFinite(value) ? { [key]: value } : {};
}

/** The entries of a list box: one per line, and a line with nothing on it is not an entry. */
function linesOf(value: FieldValue): string[] {
  return boxText(value)
    .split(/\r\n|\n|\r/)
    .filter((line) => !blank(line));
}

/**
 * Whether a box is empty. Space alone counts as empty, because a line of spaces is nothing
 * anybody meant to write down. The answer is all this takes from the text: what is kept is kept
 * as it was typed, spaces and all.
 */
function blank(text: string): boolean {
  return text.trim() === '';
}
