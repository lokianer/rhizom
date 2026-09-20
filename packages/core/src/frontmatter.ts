// The frontmatter vocabulary Rhizom reserves. A vault stays plain Markdown that other editors
// open too, so the vocabulary is deliberately flat and small: one `type` key saying what a note
// is, beside the `aliases` and `tags` keys Obsidian established. A value Rhizom does not know
// belongs to the vault, means nothing special here and is never rewritten (see DECISIONS.md).
//
// Under that vocabulary sits the text surgery a frontmatter form needs: where the block is, what
// a form should show for each key, and how one key is written back. The block belongs to whoever
// typed it — its comments, its blank lines, the order it puts its keys in, the way it quotes them
// — so a save rewrites the fields it was given and nothing else. Re-serialising the whole block
// would be a line of code and would throw all of that away the first time anybody pressed save.
import { Document, isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml';

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

/** Where a note's frontmatter block stands, and what is in it. */
export interface FrontmatterBlock {
  /** UTF-16 offsets of the whole block including both `---` fences and the newline after. */
  start: number;
  end: number;
  /** The YAML between the fences, without the fences: it ends with the newline before the second. */
  body: string;
  /** Parsed values; empty when the YAML could not be read, or when it is not a mapping. */
  values: Record<string, unknown>;
  /** The YAML parser's complaint, when there is one. */
  error?: string;
}

/** What a form should show for one key. */
export type FieldKind = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'unsupported';

export interface FrontmatterField {
  key: string;
  kind: FieldKind;
  value: unknown;
  /**
   * 1-based line of the key inside the block, for reporting; the line in the file is one more,
   * because a block only counts when it opens on the first line. 0 when the key is not in the
   * block's text at all, the way `parseNote` reports a node without a position.
   */
  line: number;
}

// The opening fence has to be the first thing in the file, and the closing fence has to be a line
// of its own. Both may carry trailing spaces or tabs and nothing else, and four dashes are not a
// fence but a thematic break — all of that is what remark's frontmatter extension does, and the
// index and the editor have to see the same block or a save would land in the wrong place.
const OPEN_FENCE = /^---[ \t]*(\r\n|\n|\r)/;
const CLOSE_FENCE = /^---[ \t]*(?:\r\n|\n|\r|$)/gm;

/** A date as a form and a vault write one: `2024-05-01`, no time, no zone. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How long a rewritten line may get before a list is easier to read one item per line. It is the
 * line in somebody's note that this measures, not our source, so it is not the printer's width.
 */
const FLOW_WIDTH = 80;

/** A stand-in key, so a rewritten value can be cut off a pair whose key we already know. */
const SAMPLE_KEY = 'k';

/** The block, or nothing when the note has none. */
export function findFrontmatter(markdown: string): FrontmatterBlock | undefined {
  return locate(markdown)?.block;
}

/** The fields of a block, in the order the file writes them. */
export function frontmatterFields(block: FrontmatterBlock): FrontmatterField[] {
  if (block.error !== undefined) {
    // Nothing in a block we could not read is worth showing as a field: the values are guesses at
    // best, and a form that shows them invites a save over text nobody has understood yet.
    return [];
  }
  const ranges = keyRanges(block.body);
  return Object.entries(block.values).map(([key, value]) => {
    const range = ranges?.get(key);
    return {
      key,
      kind: kindOf(value),
      value,
      line: range === undefined ? 0 : lineAt(block.body, range.keyStart),
    };
  });
}

/**
 * A note with these keys set to these values, and nothing else in the file changed.
 * A value of `undefined` removes the key. Returns the markdown unchanged when there is
 * nothing to do.
 *
 * Nothing to do covers more than an empty `changes`: a value the block already holds, a key to
 * remove that is not there, a block whose YAML does not parse, and a value YAML has no way to
 * write. In every one of those the input string comes back as it went in, so a form that renders
 * a note and touches nothing never marks it dirty.
 */
export function setFrontmatter(
  markdown: string,
  changes: Readonly<Record<string, unknown>>,
): string {
  const entries = Object.entries(changes);
  if (entries.length === 0) {
    return markdown;
  }
  const found = locate(markdown);
  if (found === undefined) {
    return openBlock(markdown, entries);
  }
  const { block, bodyStart, eol } = found;
  if (block.error !== undefined) {
    // A head nobody could parse is a head nobody may rewrite: the offsets we would cut at come
    // out of that same failed parse. The form reports the error; the file keeps its text.
    return markdown;
  }
  const ranges = keyRanges(block.body);
  if (ranges === undefined) {
    // The fences hold something other than a mapping — a list, a bare string. It is not a form's
    // frontmatter, and hanging `key: value` under it would turn it into broken YAML.
    return markdown;
  }

  const edits: Edit[] = [];
  const added: string[] = [];
  const indent = indentOf(block.body, ranges);
  for (const [key, value] of entries) {
    const range = ranges.get(key);
    if (range === undefined) {
      if (value === undefined) {
        continue;
      }
      if (key in block.values) {
        // The block has the key in a shape the surgery cannot aim at — a key that is not a
        // scalar, a key with no value node. A second one would make the block invalid.
        continue;
      }
      // A key the block does not have goes to the end. The top is where the author's own
      // ordering begins, and pushing in there shuffles a block somebody arranged by hand.
      const line = pairText(key, value, eol);
      if (line !== undefined) {
        added.push(indent + withIndent(line, indent, eol));
      }
      continue;
    }
    if (value === undefined) {
      edits.push({
        start: lineStartAt(block.body, range.keyStart),
        end: lineEndAt(block.body, range.valueEnd),
        text: '',
      });
      continue;
    }
    const suffix = valueSuffix(key, value, eol);
    if (suffix === undefined || suffix === valueSuffix(key, block.values[key], eol)) {
      // Either YAML cannot write this value, or the file already says it — in another spelling
      // perhaps, a block list where the form hands back an array, which is not a change.
      continue;
    }
    edits.push(rewrite(block.body, range, withIndent(suffix, indent, eol), eol));
  }
  if (edits.length === 0 && added.length === 0) {
    return markdown;
  }

  let body = block.body;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  }
  if (added.length > 0) {
    body += added.join(eol) + eol;
  }
  return markdown.slice(0, bodyStart) + body + markdown.slice(bodyStart + block.body.length);
}

/** Everything the surgery needs about a key already in the block, as offsets into the body. */
interface KeyRange {
  keyStart: number;
  /** Just after the key, before its colon. */
  keyEnd: number;
  /** Just after the value — a same-line comment lies past it and is none of our business. */
  valueEnd: number;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Located {
  block: FrontmatterBlock;
  /** Offset of the first character of the YAML in the note. */
  bodyStart: number;
  /** The line ending the block is written with, so what we add is written with it too. */
  eol: string;
}

function locate(markdown: string): Located | undefined {
  const open = OPEN_FENCE.exec(markdown);
  if (open === null) {
    return undefined;
  }
  const bodyStart = open[0].length;
  CLOSE_FENCE.lastIndex = bodyStart;
  const close = CLOSE_FENCE.exec(markdown);
  if (close === null) {
    // An opening fence with no closing one is not frontmatter at all; it is a thematic break and
    // a note that happens to start with one.
    return undefined;
  }
  const body = markdown.slice(bodyStart, close.index);
  const block: FrontmatterBlock = {
    start: 0,
    end: close.index + close[0].length,
    body,
    values: {},
  };
  const document = parseDocument(body);
  const failure = document.errors[0];
  if (failure === undefined) {
    const parsed: unknown = document.toJS();
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      block.values = parsed as Record<string, unknown>;
    }
  } else {
    block.error = failure.message;
  }
  return { block, bodyStart, eol: open[1] ?? '\n' };
}

/**
 * Where every key of the block stands. Nothing when the fences hold something that is not a
 * mapping; an empty map when they hold nothing at all, which is a block a key can still be
 * added to.
 */
function keyRanges(body: string): Map<string, KeyRange> | undefined {
  const contents = parseDocument(body).contents;
  const ranges = new Map<string, KeyRange>();
  if (contents === null) {
    return ranges;
  }
  if (!isMap(contents)) {
    return undefined;
  }
  for (const pair of contents.items) {
    const key: unknown = pair.key;
    const value: unknown = pair.value;
    if (!isScalar(key) || !isNode(value)) {
      continue;
    }
    const keyRange = key.range;
    const valueRange = value.range;
    if (
      keyRange === undefined ||
      keyRange === null ||
      valueRange === undefined ||
      valueRange === null
    ) {
      continue;
    }
    ranges.set(String(key.value), {
      keyStart: keyRange[0],
      keyEnd: keyRange[1],
      valueEnd: valueRange[1],
    });
  }
  return ranges;
}

/**
 * The column the block keeps its keys in. It is 0 in every file a tool ever wrote one, but YAML
 * allows a whole mapping to sit further in, and a line we added at column 0 would then not belong
 * to the same mapping at all.
 */
function indentOf(body: string, ranges: ReadonlyMap<string, KeyRange>): string {
  const first = [...ranges.values()][0];
  return first === undefined ? '' : ' '.repeat(first.keyStart - lineStartAt(body, first.keyStart));
}

/** Written text moved into that column: every line after the first carries the indent too. */
function withIndent(text: string, indent: string, eol: string): string {
  return indent === '' ? text : text.split(eol).join(eol + indent);
}

/** The edit that puts a new value on an existing key's line, or under it. */
function rewrite(body: string, range: KeyRange, suffix: string, eol: string): Edit {
  let text = suffix;
  if (endsWithBreak(body.slice(range.keyEnd, range.valueEnd))) {
    // The old value ran to the end of its last line and the span takes that line break with it.
    // Without one back the next key lands on this key's line.
    text += eol;
  } else if (needsSpace(body[range.valueEnd])) {
    // `title: # why` has no value to replace, only the point between the colon and the comment.
    // Written straight in, the new value would disappear into that comment.
    text += ' ';
  }
  return { start: range.keyEnd, end: range.valueEnd, text };
}

/** A note that had no frontmatter, with a block in front of it. */
function openBlock(markdown: string, entries: readonly (readonly [string, unknown])[]): string {
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

/** What a form should show for a value, from the value alone. */
function kindOf(value: unknown): FieldKind {
  if (value === null || value === undefined) {
    // `summary:` with nothing behind it is an empty text field, not a broken one: that is how a
    // key waiting to be filled in looks in a file.
    return 'text';
  }
  if (value instanceof Date) {
    return 'date';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'string') {
    return dateOf(value) === undefined ? 'text' : 'date';
  }
  if (Array.isArray(value)) {
    // A list of plain values is a list. A list of mappings is a structure, and a form that showed
    // it as a list would flatten it on the first save.
    return value.every(isPlainValue) ? 'list' : 'unsupported';
  }
  return 'unsupported';
}

function isPlainValue(value: unknown): boolean {
  return (
    value === null ||
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** `key: value` as YAML writes it, without its line break; nothing when YAML cannot write it. */
function pairText(key: string, value: unknown, eol: string): string | undefined {
  return write(key, value, useFlow(key, value))?.replaceAll('\n', eol);
}

/**
 * The `: value` half of a pair. A rewrite replaces only this much of a line, so the key keeps the
 * spelling the file gave it and a comment behind the value is left where its author put it.
 */
function valueSuffix(key: string, value: unknown, eol: string): string | undefined {
  return write(SAMPLE_KEY, value, useFlow(key, value))
    ?.slice(SAMPLE_KEY.length)
    .replaceAll('\n', eol);
}

/** Whether the value belongs on the key's line as `[a, b]` rather than one item per line. */
function useFlow(key: string, value: unknown): boolean {
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

function isEmptyMapping(value: unknown): boolean {
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
function write(key: string, value: unknown, flow: boolean): string | undefined {
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
function forYaml(value: unknown): unknown {
  if (typeof value === 'string') {
    return dateOf(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(forYaml);
  }
  return value;
}

/**
 * The date a text spells, or nothing when it is not one. The round trip is the whole test:
 * `Date.parse` rolls `2024-02-30` forward into March rather than refusing it, and a date field
 * that silently moved a day is worse than a text field that kept what somebody typed.
 */
function dateOf(text: string): Date | undefined {
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

/** The 1-based line an offset falls on. */
function lineAt(text: string, offset: number): number {
  return (text.slice(0, offset).match(/\r\n|\n|\r/g)?.length ?? 0) + 1;
}

/** The first character of the line an offset falls on. */
function lineStartAt(text: string, offset: number): number {
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
function lineEndAt(text: string, offset: number): number {
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

function isBreak(character: string | undefined): boolean {
  return character === '\n' || character === '\r';
}

function endsWithBreak(text: string): boolean {
  return isBreak(text[text.length - 1]);
}

function startsWithBreak(text: string): boolean {
  return isBreak(text[0]);
}

/** Whether a new value would run into whatever the file has after it. */
function needsSpace(character: string | undefined): boolean {
  return character !== undefined && character !== ' ' && character !== '\t' && !isBreak(character);
}

/** The line ending a text is written with; a new file gets the one this repository writes. */
function lineBreakOf(text: string): string {
  return /\r\n|\n|\r/.exec(text)?.[0] ?? '\n';
}
