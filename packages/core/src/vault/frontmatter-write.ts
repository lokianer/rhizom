// Turning a value back into the YAML a note is written with. The reading side decides what a
// field is; this side decides how it goes back on disk.
//
// Two rules run through all of it. A file is edited, not regenerated: only the keys that
// changed are rewritten, so the author's spacing, comments and key order survive an edit they
// did not ask for. And the shape follows the value — a short list goes on one line, a long one
// gets a line each — because the next person to open the file in a text editor has to read it.
import { Document, isMap, isSeq } from 'yaml';

import { lineBreakOf, startsWithBreak } from '../text/breaks.js';
import { dateOf, isPlainValue } from './values.js';

/**
 * How long a rewritten line may get before a list is easier to read one item per line. It is the
 * line in somebody's note that this measures, not our source, so it is not the printer's width.
 */
export const FLOW_WIDTH = 80;

/** A stand-in key, so a rewritten value can be cut off a pair whose key we already know. */
export const SAMPLE_KEY = 'k';

/** Written text moved into that column: every line after the first carries the indent too. */
export function withIndent(text: string, indent: string, eol: string): string {
  return indent === '' ? text : text.split(eol).join(eol + indent);
}

/** A note that had no frontmatter, with a block in front of it. */
export function openBlock(
  markdown: string,
  entries: readonly (readonly [string, unknown])[],
): string {
  const eol = lineBreakOf(markdown);
  const lines: string[] = [];
  for (const [key, value] of entries) {
    if (value === undefined) {
      // Nothing to remove from a block that does not exist.
      continue;
    }
    const line = pairText(key, value, eol);
    if (line !== undefined) {
      lines.push(line);
    }
  }
  if (lines.length === 0) {
    return markdown;
  }
  // A blank line between the block and the prose, the way a hand-written note has it — unless the
  // note opens with one already, or there is no prose for it to stand between.
  const gap = markdown === '' || startsWithBreak(markdown) ? '' : eol;
  return `---${eol}${lines.join(eol)}${eol}---${eol}${gap}${markdown}`;
}

/** `key: value` as YAML writes it, without its line break; nothing when YAML cannot write it. */
export function pairText(key: string, value: unknown, eol: string): string | undefined {
  return write(key, value, useFlow(key, value))?.replaceAll('\n', eol);
}

/**
 * The `: value` half of a pair. A rewrite replaces only this much of a line, so the key keeps the
 * spelling the file gave it and a comment behind the value is left where its author put it.
 */
export function valueSuffix(key: string, value: unknown, eol: string): string | undefined {
  return write(SAMPLE_KEY, value, useFlow(key, value))
    ?.slice(SAMPLE_KEY.length)
    .replaceAll('\n', eol);
}

/** Whether the value belongs on the key's line as `[a, b]` rather than one item per line. */
export function useFlow(key: string, value: unknown): boolean {
  if (Array.isArray(value)) {
    if (!value.every(isPlainValue)) {
      return false;
    }
    const line = write(key, value, true);
    return line !== undefined && line.length <= FLOW_WIDTH;
  }
  // An empty collection is `{}` or `[]` on the key's line; nothing else can be written under a
  // key without inventing an entry for it.
  return isEmptyMapping(value);
}

export function isEmptyMapping(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    Object.keys(value).length === 0
  );
}

/**
 * One pair, serialised.
 *
 * It is written as YAML 1.1 although Rhizom reads YAML 1.2: 1.1 is the dialect of Obsidian's and
 * Python's readers, and it is the stricter one about what a bare word means — `yes`, `no`, `on`,
 * `1:30` are all values there, not text. Quoting what 1.1 would misread keeps a string a string
 * in every reader a vault might meet. Nothing else is touched: line folding is off, so a long
 * title stays on its line, and non-ASCII is never escaped, so `Über 🌱` stays `Über 🌱`.
 */
export function write(key: string, value: unknown, flow: boolean): string | undefined {
  try {
    const document = new Document({ [key]: forYaml(value) }, null, { version: '1.1' });
    if (flow) {
      const contents = document.contents;
      const node: unknown = isMap(contents) ? contents.items[0]?.value : undefined;
      if (isSeq(node) || isMap(node)) {
        node.flow = true;
      }
    }
    return document.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, '');
  } catch {
    // A value YAML has no tag for — a function, a symbol, whatever a caller passed by mistake.
    // Guessing at it would write nonsense into somebody's note; the key keeps what it had.
    return undefined;
  }
}

/**
 * The value as the writer should see it. A date arrives from a form as the text `2024-05-01`, and
 * YAML 1.1 reads that bare text as a date, so the writer would quote it to keep it a string —
 * which would put quotes into the file on every save of a date field, and take the date away from
 * every other reader. Handing the writer a real date writes it the way a date is written.
 */
export function forYaml(value: unknown): unknown {
  if (typeof value === 'string') {
    return dateOf(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(forYaml);
  }
  return value;
}
