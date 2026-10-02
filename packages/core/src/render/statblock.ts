// A stat block as it is written in a note: a ` ```statblock ` fence holding YAML, in the layout of
// the Obsidian plugin Fantasy Statblocks, so a vault that uses the plugin opens with its stat
// blocks drawn here too. This file reads the YAML into what the renderer lays out; it computes
// nothing but the ability modifiers the classic 5e block prints beside the scores.
//
// Two layouts. A block with six ability scores is a 5e block and gets the classic order. Anything
// else is a system Rhizom has never heard of, and its keys are laid out in the order they were
// written — never refused, because the vault knows its game better than Rhizom does.
import { parseDocument } from 'yaml';

/** One `label: value` line of a stat block, already formatted. */
export interface StatLine {
  key: string;
  value: string;
}

/** A list of named entries: traits, actions, reactions, or whatever a system calls them. */
export interface StatSection {
  key: string;
  entries: { name: string; desc: string }[];
}

export interface Statblock {
  layout: '5e' | 'generic';
  name?: string;
  /** The 5e line under the name: size, type, subtype and alignment. */
  meta?: string;
  /** Armour class, hit points and speed, above the ability scores. */
  top: StatLine[];
  /** The six scores, in the order STR DEX CON INT WIS CHA; only in the 5e layout. */
  abilities?: number[];
  /** The 5e lines below the scores: saves, skills, defences, senses, languages, challenge. */
  details: StatLine[];
  /** Every other key, in the order it was written. */
  other: StatLine[];
  sections: StatSection[];
}

export interface StatblockProblem {
  problem: 'yaml' | 'not-a-mapping';
  message: string;
}

/** The modifier printed beside an ability score: `16 (+3)`. Layout, not rules. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

const META_KEYS = ['size', 'type', 'subtype', 'alignment'];
const TOP_KEYS = ['ac', 'hp', 'speed'];
const DETAIL_KEYS = [
  'saves',
  'skillsaves',
  'damage_vulnerabilities',
  'damage_resistances',
  'damage_immunities',
  'condition_immunities',
  'senses',
  'languages',
  'cr',
];
const SECTION_KEYS = ['traits', 'actions', 'bonus_actions', 'reactions', 'legendary_actions'];
/** Keys the 5e layout spends on something other than a line of their own. */
const CONSUMED = new Set(['name', 'stats', 'hit_dice', ...META_KEYS]);

// YAML anchors can expand a few lines into millions of nodes; a stat block has no use for that.
const MAX_ALIASES = 100;

export function parseStatblock(source: string): Statblock | StatblockProblem {
  const document = parseDocument(source);
  const error = document.errors[0];
  if (error !== undefined) {
    return { problem: 'yaml', message: error.message.split('\n')[0] ?? error.message };
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: MAX_ALIASES });
  } catch (cause) {
    return { problem: 'yaml', message: cause instanceof Error ? cause.message : String(cause) };
  }
  if (!isMapping(value)) {
    return { problem: 'not-a-mapping', message: 'A stat block is a list of keys and values.' };
  }
  const abilities = abilitiesOf(value.stats);
  return abilities === undefined ? generic(value) : fifthEdition(value, abilities);
}

function fifthEdition(block: Record<string, unknown>, abilities: number[]): Statblock {
  // Only what found a place counts as placed. A known key whose value does not fit its slot —
  // actions written as plain lines, a sense written as a named entry — falls through to the rest
  // in written order, so nothing a game master wrote goes missing from the table.
  const placed = new Set(CONSUMED);
  const hasHp = Object.hasOwn(block, 'hp') && block.hp !== null && block.hp !== undefined;
  const line = (key: string): StatLine[] => {
    const value = Object.hasOwn(block, key) ? block[key] : undefined;
    if (value === undefined || value === null || sectionOf(value) !== undefined) {
      return [];
    }
    let text = format(value);
    if (key === 'hp' && block.hit_dice !== undefined && block.hit_dice !== null) {
      text = `${text} (${format(block.hit_dice)})`;
    }
    if (text === '') {
      return [];
    }
    placed.add(key);
    return [{ key, value: text }];
  };
  const topKeys = hasHp
    ? TOP_KEYS
    : TOP_KEYS.flatMap((key) => (key === 'hp' ? ['hit_dice'] : [key]));
  if (!hasHp) {
    placed.delete('hit_dice');
  }
  const name = nameOf(block.name);
  const meta = metaOf(block);
  const sections: StatSection[] = [];
  for (const key of SECTION_KEYS) {
    const entries = Object.hasOwn(block, key) ? sectionOf(block[key]) : undefined;
    if (entries !== undefined) {
      sections.push({ key, entries });
      placed.add(key);
    }
  }
  const top = topKeys.flatMap(line);
  const details = DETAIL_KEYS.flatMap(line);
  const rest = restOf(block, placed);
  return {
    layout: '5e',
    ...(name === undefined ? {} : { name }),
    ...(meta === '' ? {} : { meta }),
    top,
    abilities,
    details,
    other: rest.other,
    sections: [...sections, ...rest.sections],
  };
}

function generic(block: Record<string, unknown>): Statblock {
  const name = nameOf(block.name);
  const rest = restOf(block, new Set(['name']));
  return {
    layout: 'generic',
    ...(name === undefined ? {} : { name }),
    top: [],
    details: [],
    other: rest.other,
    sections: rest.sections,
  };
}

/** Every key not in `known`, in written order: lists of named entries as sections, the rest as lines. */
function restOf(
  block: Record<string, unknown>,
  known: ReadonlySet<string>,
): { other: StatLine[]; sections: StatSection[] } {
  const other: StatLine[] = [];
  const sections: StatSection[] = [];
  for (const [key, value] of Object.entries(block)) {
    if (known.has(key) || value === undefined || value === null) {
      continue;
    }
    const entries = sectionOf(value);
    if (entries !== undefined) {
      sections.push({ key, entries });
      continue;
    }
    const text = format(value);
    if (text !== '') {
      other.push({ key, value: text });
    }
  }
  return { other, sections };
}

function metaOf(block: Record<string, unknown>): string {
  const word = (key: string): string => {
    const value = block[key];
    return value === undefined || value === null ? '' : format(value);
  };
  const kind = [word('size'), word('type')].filter((part) => part !== '').join(' ');
  const subtype = word('subtype');
  const described = subtype === '' ? kind : `${kind} (${subtype})`.trim();
  return [described, word('alignment')].filter((part) => part !== '').join(', ');
}

function abilitiesOf(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== 6) {
    return undefined;
  }
  return value.every((score) => typeof score === 'number' && Number.isFinite(score))
    ? (value as number[])
    : undefined;
}

function nameOf(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const name = format(value);
  return name === '' ? undefined : name;
}

/** A non-empty list of entries with a name, a description or both: traits, actions and their kin. */
function sectionOf(value: unknown): StatSection['entries'] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const entries: StatSection['entries'] = [];
  for (const item of value) {
    if (!isMapping(item)) {
      return undefined;
    }
    const name = Object.hasOwn(item, 'name') ? format(item.name) : '';
    const desc = Object.hasOwn(item, 'desc') ? format(item.desc) : '';
    // An entry with neither is not an entry; one with only a description is — the paragraph that
    // opens a dragon's legendary actions is written exactly so.
    if (name === '' && desc === '') {
      return undefined;
    }
    entries.push({ name, desc });
  }
  return entries;
}

/** A value as one line of text. `- dex: 5` becomes `Dex +5`, the way the plugin writes saves. */
function format(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map(formatItem)
      .filter((part) => part !== '')
      .join(', ');
  }
  if (isMapping(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key} ${format(entry)}`.trim())
      .join(', ');
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  // YAML gives nothing else once arrays, mappings and dates are taken out.
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

function formatItem(item: unknown): string {
  if (isMapping(item)) {
    const entries = Object.entries(item);
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) {
      const [key, value] = only;
      const bonus =
        typeof value === 'number'
          ? value < 0
            ? String(value)
            : `+${String(value)}`
          : format(value);
      return `${key.charAt(0).toUpperCase()}${key.slice(1)} ${bonus}`;
    }
  }
  return format(item);
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}
