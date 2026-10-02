// A parsed stat block drawn as HTML. Built as a hast tree and stringified, like the query results
// next door: every value in a stat block is text out of somebody's vault, and a name written as
// `<script>` has to show up as those eight characters. The words around the values are the
// app's, because core carries no language; without them a key is shown as it was written.
import type { Element, ElementContent, Root as HastRoot, Text } from 'hast';
import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';

import { abilityModifier, type Statblock, type StatLine } from './statblock.js';

export interface StatblockLabels {
  /** What a key is called on screen: `ac` → "Armor Class", `actions` → "Actions". */
  fields: Partial<Record<string, string>>;
  /** The six ability names, in the order STR DEX CON INT WIS CHA. */
  abilities: readonly string[];
  /** The notice above a stat block that could not be read. */
  problem: (message: string) => string;
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const compiler = unified().use(rehypeStringify).freeze();

export function renderStatblock(block: Statblock, labels?: StatblockLabels): string {
  // Own properties only: a block may well have a key called `constructor` or `toString`, and what
  // every object inherits under those names is a function, not a word.
  const label = (key: string): string => {
    const word =
      labels !== undefined && Object.hasOwn(labels.fields, key) ? labels.fields[key] : undefined;
    return typeof word === 'string' ? word : key.replaceAll('_', ' ');
  };
  const children: ElementContent[] = [];
  if (block.name !== undefined) {
    children.push(element('p', ['rz-statblock-name'], [text(block.name)]));
  }
  if (block.meta !== undefined) {
    children.push(element('p', ['rz-statblock-meta'], [text(block.meta)]));
  }
  const lines = (entries: StatLine[]): void => {
    if (entries.length > 0) {
      children.push(
        element(
          'dl',
          ['rz-statblock-lines'],
          entries.map((entry) =>
            element(
              'div',
              [],
              [element('dt', [], [text(label(entry.key))]), element('dd', [], [text(entry.value)])],
            ),
          ),
        ),
      );
    }
  };
  lines(block.top);
  if (block.abilities !== undefined) {
    children.push(abilityTable(block.abilities, labels));
  }
  lines(block.details);
  lines(block.other);
  for (const section of block.sections) {
    children.push(
      element(
        'div',
        ['rz-statblock-section'],
        [
          element('p', ['rz-statblock-section-title'], [text(label(section.key))]),
          ...section.entries.map((entry) =>
            element(
              'p',
              [],
              [
                // An entry may be a description alone, such as the paragraph that opens a list
                // of legendary actions.
                ...(entry.name === '' ? [] : [element('strong', [], [text(`${entry.name}.`)])]),
                ...(entry.desc === ''
                  ? []
                  : [text(entry.name === '' ? entry.desc : ` ${entry.desc}`)]),
              ],
            ),
          ),
        ],
      ),
    );
  }
  const root: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'div',
        properties: { className: ['rz-statblock'], dataLayout: block.layout },
        children,
      },
    ],
  };
  return compiler.stringify(root);
}

function abilityTable(scores: number[], labels: StatblockLabels | undefined): Element {
  const names = ABILITY_KEYS.map((key, index) => labels?.abilities[index] ?? key.toUpperCase());
  return element(
    'table',
    ['rz-statblock-abilities'],
    [
      element(
        'thead',
        [],
        [
          element(
            'tr',
            [],
            names.map((name) => element('th', [], [text(name)])),
          ),
        ],
      ),
      element(
        'tbody',
        [],
        [
          element(
            'tr',
            [],
            scores.map((score) =>
              element('td', [], [text(`${String(score)} (${signed(abilityModifier(score))})`)]),
            ),
          ),
        ],
      ),
    ],
  );
}

/** `+3`, `+0`, `−1` — with a real minus sign, the way the books print it. */
function signed(value: number): string {
  return value < 0 ? `−${String(-value)}` : `+${String(value)}`;
}

function element(tagName: string, classes: string[], children: ElementContent[]): Element {
  return {
    type: 'element',
    tagName,
    properties: classes.length === 0 ? {} : { className: classes },
    children,
  };
}

function text(value: string): Text {
  return { type: 'text', value };
}
