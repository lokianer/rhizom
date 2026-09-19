// Templates: the text a note is started from, and the placeholders that make it about today.
//
// The syntax is Obsidian's, because an existing vault's templates have to keep working: `{{title}}`,
// `{{date}}` and `{{time}}`, each optionally with a format — `{{date:YYYY-MM-DD}}` — in the Moment
// tokens Obsidian documents. Rhizom adds `{{roll:2d6+3}}`, `{{path}}` and `{{cursor}}`.
//
// Anything else in double braces is left exactly as it stands, and so is a placeholder whose
// format makes no sense. A template is a Markdown file like any other, and files in a vault hold
// all sorts of braces; replacing what we do not understand would quietly corrupt them, while
// leaving it alone costs the reader one deletion.
//
// Code is left alone as well. `B{{date}}` in a Mermaid diagram is a hexagon node, and a note
// explaining templates has to be able to show `{{date}}` in a code span without it turning into
// a date — that code span is the only way to write one literally.
//
// Expansion is a pure function of its context: the clock is handed in, so a test can say what
// today is, and it happens once, when the text is inserted. A note is the file on disk, not a
// thing that reads differently tomorrow.
import type { Nodes, Parent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** What a placeholder is filled from. */
export interface TemplateContext {
  /** The title of the note the text is going into. */
  title: string;
  /** Its vault path, for `{{path}}`. Without one, `{{path}}` stays as it is written. */
  path?: string;
  /** The moment the template is being used. */
  now: Date;
  /** What `{{date}}` means without a format of its own; the vault's setting, or ISO. */
  dateFormat?: string;
  /** What `{{time}}` means without a format of its own. */
  timeFormat?: string;
  /** Numbers in [0, 1) for `{{roll:2d6}}`. Handed in so a test can make a die show a six. */
  random?: () => number;
  /** BCP 47 tag for month and weekday names; the numeric formats do not need it. */
  locale?: string;
}

export interface ExpandedTemplate {
  text: string;
  /**
   * Where `{{cursor}}` stood, as an offset into `text`, or `undefined` when the template did not
   * say. Only the first one counts — a text has one cursor.
   */
  cursor?: number;
}

const DEFAULT_DATE = 'YYYY-MM-DD';
const DEFAULT_TIME = 'HH:mm';

/**
 * `{{name}}` or `{{name:argument}}`. The argument runs to the closing braces but never past the
 * end of the line: a `{{date:` somebody left open would otherwise reach for the next `}}` in the
 * file and swallow every paragraph in between.
 */
const PLACEHOLDER = /\{\{([a-z]+)(?::([^{}\r\n]*))?\}\}/gi;

/** `2d6`, `1d100`, `3d8+2`, `1d20-1`. Case-insensitive, spaces allowed around the sign. */
const DICE = /^(\d{1,3})?\s*d\s*(\d{1,4})\s*(?:([+-])\s*(\d{1,4}))?$/i;

/** How many dice one roll may ask for, so a stray `{{roll:999d6}}` cannot hold up a keystroke. */
const MAX_DICE = 100;

// The same dialect the indexer parses, minus what finding code does not need. Frozen once:
// `.use()` after the first run throws, and building the pipeline is the expensive part.
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']).freeze();

interface Range {
  start: number;
  end: number;
}

/**
 * Fills the placeholders in a template. Unknown ones, ones whose argument makes no sense, and
 * ones standing in code are left as they were written.
 */
export function expandTemplate(source: string, context: TemplateContext): ExpandedTemplate {
  const code = codeRanges(source);
  let cursor: number | undefined;
  let text = '';
  let last = 0;
  PLACEHOLDER.lastIndex = 0;
  let match = PLACEHOLDER.exec(source);
  while (match !== null) {
    const [whole, rawName = '', argument] = match;
    const name = rawName.toLowerCase();
    text += source.slice(last, match.index);
    if (inCode(code, match.index)) {
      text += whole;
    } else if (name === 'cursor' && argument === undefined) {
      // The cursor is a position, not a text: it leaves nothing behind, and where it lands is
      // simply how much text has been written by then.
      cursor ??= text.length;
    } else {
      text += fill(name, argument, context) ?? whole;
    }
    last = match.index + whole.length;
    match = PLACEHOLDER.exec(source);
  }
  text += source.slice(last);
  return cursor === undefined ? { text } : { text, cursor };
}

/** The text a placeholder stands for, or nothing when it is not one we can fill. */
function fill(
  name: string,
  argument: string | undefined,
  context: TemplateContext,
): string | undefined {
  switch (name) {
    case 'title':
      return argument === undefined ? context.title : undefined;
    case 'path':
      return argument === undefined ? context.path : undefined;
    case 'date':
      return formatted(context, argument, context.dateFormat ?? DEFAULT_DATE);
    case 'time':
      return formatted(context, argument, context.timeFormat ?? DEFAULT_TIME);
    case 'roll':
      return argument === undefined ? undefined : roll(argument, context.random);
    default:
      return undefined;
  }
}

/** A formatted date, or nothing when the format says nothing — `{{date:}}` is not a date. */
function formatted(
  context: TemplateContext,
  argument: string | undefined,
  fallback: string,
): string | undefined {
  // A placeholder that names an empty format asked for something; writing nothing in its place
  // would be a deletion nobody typed. Only a placeholder without a colon falls back.
  if (argument?.trim() === '') {
    return undefined;
  }
  const result = formatDate(context.now, argument ?? fallback, context.locale);
  return result === '' ? undefined : result;
}

/** Every stretch of the source that is code, in document order. */
function codeRanges(markdown: string): Range[] {
  const ranges: Range[] = [];
  const walk = (node: Nodes): void => {
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        ranges.push({ start, end });
      }
      return;
    }
    if ('children' in node) {
      for (const child of (node as Parent).children) {
        walk(child);
      }
    }
  };
  walk(parser.parse(markdown));
  return ranges;
}

function inCode(ranges: readonly Range[], offset: number): boolean {
  return ranges.some((range) => offset >= range.start && offset < range.end);
}

/** Moment's tokens, longest spelling of each first, because the first alternative wins. */
const TOKEN =
  /YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|Do|D|dddd|ddd|dd|GGGG|GG|gggg|gg|WW|W|ww|w|Q|HH|H|hh|h|mm|m|ss|s|A|a|X|x|ZZ|Z/g;

/**
 * Formats a date with the Moment tokens Obsidian's own templates use. Text in square brackets is
 * taken literally, as Moment takes it, so `[Week] ww` reads as it looks — and a bracket that is
 * never closed takes the rest of the format with it, rather than letting a token hide in a word.
 *
 * Two deliberate differences from Moment: the week tokens (`w`, `ww`, `gggg` and their `W`/`G`
 * spellings) are always the ISO week, whatever the locale says a week starts on, and `Do` writes
 * an English ordinal. Everything a format can be given to is a file that travels.
 */
export function formatDate(date: Date, format: string, locale = 'en'): string {
  let result = '';
  let index = 0;
  while (index < format.length) {
    if (format[index] === '[') {
      const end = format.indexOf(']', index + 1);
      if (end === -1) {
        result += format.slice(index + 1);
        break;
      }
      result += format.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(format);
    // Everything between here and the next token is literal, and the scan has already been
    // over it: copying it one character at a time and scanning again from the next one is what
    // turns a long run of plain text into a wait. It stops at a bracket, which the top of the
    // loop opens.
    const literalEnd = match === null ? format.length : match.index;
    if (literalEnd > index) {
      const bracket = format.indexOf('[', index);
      const stop = bracket !== -1 && bracket < literalEnd ? bracket : literalEnd;
      result += format.slice(index, stop);
      index = stop;
      continue;
    }
    if (match === null) {
      break;
    }
    result += token(match[0], date, locale);
    index += match[0].length;
  }
  return result;
}

function token(name: string, date: Date, locale: string): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const hours = date.getHours();
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  switch (name) {
    case 'YYYY':
      return pad(date.getFullYear(), 4);
    case 'YY':
      return pad(date.getFullYear() % 100);
    case 'MMMM':
      return named(date, locale, { month: 'long' });
    case 'MMM':
      return named(date, locale, { month: 'short' });
    case 'MM':
      return pad(date.getMonth() + 1);
    case 'M':
      return String(date.getMonth() + 1);
    case 'DDDD':
      return pad(dayOfYear(date), 3);
    case 'DDD':
      return String(dayOfYear(date));
    case 'DD':
      return pad(date.getDate());
    case 'Do':
      return ordinal(date.getDate());
    case 'D':
      return String(date.getDate());
    case 'dddd':
      return named(date, locale, { weekday: 'long' });
    case 'ddd':
      return named(date, locale, { weekday: 'short' });
    case 'dd':
      // Moment's `dd` is two letters — "Tu", "Th", "Sa", "Su". Intl has no width for that:
      // `narrow` gives one letter, which reads Tuesday and Thursday as the same day, so this
      // takes the short form and keeps two characters of it. German is already two.
      return [...named(date, locale, { weekday: 'short' })].slice(0, 2).join('');
    case 'GGGG':
    case 'gggg':
      return pad(isoWeek(date).year, 4);
    case 'GG':
    case 'gg':
      return pad(isoWeek(date).year % 100);
    case 'WW':
    case 'ww':
      return pad(isoWeek(date).week);
    case 'W':
    case 'w':
      return String(isoWeek(date).week);
    case 'Q':
      return String(Math.floor(date.getMonth() / 3) + 1);
    case 'HH':
      return pad(hours);
    case 'H':
      return String(hours);
    case 'hh':
      return pad(twelve);
    case 'h':
      return String(twelve);
    case 'mm':
      return pad(date.getMinutes());
    case 'm':
      return String(date.getMinutes());
    case 'ss':
      return pad(date.getSeconds());
    case 's':
      return String(date.getSeconds());
    case 'A':
      return hours < 12 ? 'AM' : 'PM';
    case 'a':
      return hours < 12 ? 'am' : 'pm';
    case 'X':
      return String(Math.floor(date.getTime() / 1000));
    case 'x':
      return String(date.getTime());
    case 'ZZ':
      return offset(date, '');
    case 'Z':
      return offset(date, ':');
    default:
      return name;
  }
}

function named(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** Whole days since 1 January, counted from the calendar rather than the clock, so a DST
 * changeover cannot make a day 23 hours long. */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((today - start) / 86_400_000) + 1;
}

/** The ISO week and the year that week belongs to, which near New Year is not this one. */
function isoWeek(date: Date): { week: number; year: number } {
  // The Thursday of this week decides both: an ISO week belongs to the year its Thursday is in.
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { week, year };
}

function ordinal(day: number): string {
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) {
    return `${String(day)}th`;
  }
  switch (day % 10) {
    case 1:
      return `${String(day)}st`;
    case 2:
      return `${String(day)}nd`;
    case 3:
      return `${String(day)}rd`;
    default:
      return `${String(day)}th`;
  }
}

function offset(date: Date, separator: string): string {
  // getTimezoneOffset counts the other way round: minutes to add to local time to reach UTC.
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  return `${sign}${hours}${separator}${String(absolute % 60).padStart(2, '0')}`;
}

/**
 * Rolls `2d6+3` and returns the total. Nothing when the notation is not one — the template then
 * keeps the words it had, which is more use than a zero.
 */
export function roll(notation: string, random: () => number = Math.random): string | undefined {
  const match = DICE.exec(notation.trim());
  if (match === null) {
    return undefined;
  }
  const count = Number(match[1] ?? '1');
  const sides = Number(match[2]);
  if (count < 1 || count > MAX_DICE || sides < 1) {
    return undefined;
  }
  let total = 0;
  for (let die = 0; die < count; die += 1) {
    total += Math.floor(random() * sides) + 1;
  }
  const modifier = match[4] === undefined ? 0 : Number(match[4]);
  return String(match[3] === '-' ? total - modifier : total + modifier);
}
