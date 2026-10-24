// Rollable tables: the random-encounter list, the rumour table, the name generator a game master
// already keeps in the vault, made rollable where they stand.
//
// A heading whose text names a die — `d20`, `1d6`, `d100`, `d%` — makes the first list or table
// under it rollable. Nothing else is asked of the note: no fence, no frontmatter, no special
// syntax another Markdown tool would show as noise. A list rolls one item, uniformly. A table
// whose first column holds numbers or ranges (`1`, `2–4`, `5-6`, `00` for a hundred) rolls the
// heading's die and takes the row whose range holds it; any other table rolls a row uniformly.
//
// The same reading serves three readers: the renderer, which marks the heading and the block so
// the reader can draw a Roll button; the app, which rolls; and a template's `{{table:}}`.
import GithubSlugger from 'github-slugger';
import type { Heading, List, Nodes, Parent, Table } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { parseDice, rollDice, type DiceRoll } from './dice.js';
import { displayText, normaliseHeadingText } from './parse.js';
import { remarkWikilink } from './remark-wikilink.js';

export interface RollableEntry {
  /** The item or the row as the note writes it, on one line; a table row's cells joined by ` — `. */
  text: string;
  /** Its place among the list's items or the table's body rows, which is how the page finds it. */
  index: number;
  line: number;
  /** The range a range table gives the row, both ends included. */
  low?: number;
  high?: number;
}

export interface Rollable {
  heading: string;
  /** The heading's slug, as the renderer gives it its id. */
  slug: string;
  /** The line the heading stands on: what the page names the table by. */
  line: number;
  /** The die the heading names, as the notation reads back. */
  die: string;
  kind: 'list' | 'ranges' | 'rows';
  entries: RollableEntry[];
}

export interface TableRoll {
  /** The entry the roll picked; nothing when a range table has no row for the number rolled. */
  entry?: RollableEntry;
  /** The die, for a range table; a uniform pick rolls no die anyone needs to see. */
  roll?: DiceRoll;
}

// The dialect the renderer parses, so that a heading's slug comes out the same here as there.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkWikilink)
  .freeze();

/** A die standing as a word of its own: `d6`, `1d20`, `d%`, not the `d6` inside `Ad6x`. */
const DIE = /(?:^|[^\p{L}\p{N}])(\d{0,3}d(?:\d{1,4}|%))(?![\p{L}\p{N}])/iu;

/** The die a heading names, or nothing when it names none. */
export function dieOfHeading(text: string): string | undefined {
  const match = DIE.exec(text);
  return match?.[1] === undefined ? undefined : parseDice(match[1])?.notation;
}

/** `1`, `2–4`, `5-6`, `97—00`: the numbers a range cell covers. `00` is a hundred. */
const RANGE = /^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/;

export function parseRange(cell: string): { low: number; high: number } | undefined {
  const match = RANGE.exec(cell.trim());
  if (match === null) {
    return undefined;
  }
  const number = (text: string): number => (text === '00' ? 100 : Number(text));
  const low = number(match[1] ?? '');
  const high = match[2] === undefined ? low : number(match[2]);
  return low <= high ? { low, high } : undefined;
}

/**
 * The heading-and-block pairs among one parent's children: a heading that names a die, and the
 * first list or table after it before the next heading. Exported for the renderer, which marks
 * the same pairs this module rolls.
 */
export function rollablePairs(
  parent: Parent,
): { heading: Heading; block: List | Table; die: string }[] {
  const pairs: { heading: Heading; block: List | Table; die: string }[] = [];
  const children = parent.children;
  for (const [index, child] of children.entries()) {
    if (child.type !== 'heading') {
      continue;
    }
    const die = dieOfHeading(displayText(child));
    if (die === undefined) {
      continue;
    }
    for (const next of children.slice(index + 1)) {
      if (next.type === 'heading') {
        break;
      }
      if (next.type === 'list' || next.type === 'table') {
        pairs.push({ heading: child, block: next, die });
        break;
      }
    }
  }
  return pairs;
}

/** Every rollable table of a note, in the order they appear. */
export function findRollables(markdown: string): Rollable[] {
  const tree = parser.parse(markdown);
  // Slugged in document order with one slugger, the way the renderer does it, so two headings
  // called `Rumours (d6)` get the same `-1` here as on the page.
  const slugger = new GithubSlugger();
  const slugs = new Map<Heading, string>();
  visit(tree, 'heading', (node) => {
    slugs.set(node, slugger.slug(displayText(node)));
  });

  const rollables: Rollable[] = [];
  const walk = (node: Nodes): void => {
    if (!('children' in node)) {
      return;
    }
    for (const { heading, block, die } of rollablePairs(node)) {
      const read =
        block.type === 'list' ? listEntries(block, markdown) : tableEntries(block, markdown);
      // A range table is one whose every row starts with a range; one row without makes the
      // whole table a list of rows, its first column read as words like the rest.
      const ranges =
        block.type === 'table' && read.length > 0 && read.every((entry) => entry.low !== undefined);
      rollables.push({
        heading: displayText(heading),
        slug: slugs.get(heading) ?? '',
        line: heading.position?.start.line ?? 0,
        die,
        kind: block.type === 'list' ? 'list' : ranges ? 'ranges' : 'rows',
        entries: read.map(({ full, low, high, ...entry }) =>
          ranges && low !== undefined && high !== undefined
            ? { ...entry, low, high }
            : { ...entry, text: full },
        ),
      });
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(tree);
  return rollables.sort((a, b) => a.line - b.line);
}

interface ReadEntry extends RollableEntry {
  /** A table row's every cell, for when the first column turns out not to be ranges. */
  full: string;
}

/** One line of source text: the note's own spelling, links and emphasis as written. */
function sourceOf(node: Nodes | undefined, markdown: string): string {
  return spanOf(node, node, markdown);
}

/** The source from the start of one node to the end of another, on one line. */
function spanOf(first: Nodes | undefined, last: Nodes | undefined, markdown: string): string {
  const start = first?.position?.start.offset;
  const end = last?.position?.end.offset;
  if (start === undefined || end === undefined) {
    return '';
  }
  return markdown.slice(start, end).replace(/\s+/g, ' ').trim();
}

function listEntries(list: List, markdown: string): ReadEntry[] {
  return list.children.flatMap((item, index) => {
    // The item's first paragraph: a nested list under it is detail, not the result.
    const text = sourceOf(item.children[0], markdown);
    return text === '' ? [] : [{ text, full: text, index, line: item.position?.start.line ?? 0 }];
  });
}

function tableEntries(table: Table, markdown: string): ReadEntry[] {
  // The first row is the header; the body rows are counted from the one after it, which is also
  // how the page numbers them inside its `tbody`.
  return table.children.slice(1).flatMap((row, index) => {
    // From the source, like a list item, so a `[[link]]` in a cell is still a link when the
    // result is written down. The cell's text is its children's; the pipes are not part of it.
    const cells = row.children.map((cell) =>
      spanOf(cell.children[0], cell.children.at(-1), markdown),
    );
    if (cells.every((cell) => cell === '')) {
      return [];
    }
    const line = row.position?.start.line ?? 0;
    const full = cells.filter((cell) => cell !== '').join(' — ');
    const range = parseRange(cells[0] ?? '');
    const rest = cells
      .slice(1)
      .filter((cell) => cell !== '')
      .join(' — ');
    return range === undefined || rest === ''
      ? [{ text: full, full, index, line }]
      : [{ text: rest, full, index, line, ...range }];
  });
}

/** Rolls on a table: the heading's die for a range table, a uniform pick otherwise. */
export function rollTable(rollable: Rollable, random: () => number = Math.random): TableRoll {
  if (rollable.kind === 'ranges') {
    const roll = rollDice(rollable.die, random);
    const total = roll?.total;
    const entry = rollable.entries.find(
      (each) =>
        total !== undefined &&
        each.low !== undefined &&
        each.high !== undefined &&
        each.low <= total &&
        total <= each.high,
    );
    return { ...(entry === undefined ? {} : { entry }), ...(roll === undefined ? {} : { roll }) };
  }
  const entry = rollable.entries[Math.floor(random() * rollable.entries.length)];
  return entry === undefined ? {} : { entry };
}

/**
 * The line a table roll is written down as: `Rumours (d6) → 4: The bell rang thirteen times`.
 * The heading says which table, the number says what the die showed, and a number no row holds
 * is written down as it fell rather than quietly rerolled.
 */
export function describeTableRoll(rollable: Rollable, result: TableRoll): string {
  const rolled = result.roll === undefined ? '' : `${String(result.roll.total)}: `;
  const text = result.entry?.text ?? '';
  return `${rollable.heading} → ${rolled}${text}`.replace(/:\s*$/, '').trim();
}

/**
 * The table a `Note#Heading` reference names among a note's tables: by the heading's words, case
 * folded, or by its slug, which is what a link copied out of the address bar holds.
 */
export function findRollable(
  rollables: readonly Rollable[],
  heading: string,
): Rollable | undefined {
  const wanted = normaliseHeadingText(heading).toLowerCase();
  return rollables.find(
    (rollable) => rollable.heading.toLowerCase() === wanted || rollable.slug === wanted,
  );
}
