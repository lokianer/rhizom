import { describe, expect, it } from 'vitest';

import { abilityModifier, parseStatblock } from './statblock.js';

const MIRA = `name: Mira Voss
size: Medium
type: humanoid
subtype: half-elf
alignment: lawful evil
ac: 15
hp: 66
hit_dice: 12d8 + 12
speed: 30 ft.
stats: [10, 16, 12, 18, 14, 17]
saves:
  - dex: 6
  - int: "+7"
skillsaves:
  - insight: 8
senses: passive Perception 12
languages: Common, Elvish, Thieves' cant
cr: 6
ledger_pages: 412
traits:
  - name: Cunning Action
    desc: Dash, Disengage or Hide as a bonus action.
actions:
  - name: Rapier
    desc: "Melee Weapon Attack: +6 to hit."
debts:
  - name: Orrin Quill
    desc: 300 gp
`;

describe('parseStatblock', () => {
  it('lays a 5e block out in the classic order, unknown keys after the known', () => {
    const block = parseStatblock(MIRA);
    if ('problem' in block) {
      throw new Error(block.message);
    }
    expect(block.layout).toBe('5e');
    expect(block.name).toBe('Mira Voss');
    expect(block.meta).toBe('Medium humanoid (half-elf), lawful evil');
    expect(block.top).toEqual([
      { key: 'ac', value: '15' },
      { key: 'hp', value: '66 (12d8 + 12)' },
      { key: 'speed', value: '30 ft.' },
    ]);
    expect(block.abilities).toEqual([10, 16, 12, 18, 14, 17]);
    expect(block.details).toEqual([
      { key: 'saves', value: 'Dex +6, Int +7' },
      { key: 'skillsaves', value: 'Insight +8' },
      { key: 'senses', value: 'passive Perception 12' },
      { key: 'languages', value: "Common, Elvish, Thieves' cant" },
      { key: 'cr', value: '6' },
    ]);
    expect(block.other).toEqual([{ key: 'ledger_pages', value: '412' }]);
    expect(block.sections.map((section) => section.key)).toEqual(['traits', 'actions', 'debts']);
    expect(block.sections[1]?.entries).toEqual([
      { name: 'Rapier', desc: 'Melee Weapon Attack: +6 to hit.' },
    ]);
  });

  it('lays out a system it has never heard of in the order it was written', () => {
    const block = parseStatblock(
      'name: Sable\nharm: 3\nstress: 2\nmoves:\n  - name: Vanish\n    desc: Gone.\nedge: Quick',
    );
    if ('problem' in block) {
      throw new Error(block.message);
    }
    expect(block.layout).toBe('generic');
    expect(block.name).toBe('Sable');
    expect(block.abilities).toBeUndefined();
    expect(block.other).toEqual([
      { key: 'harm', value: '3' },
      { key: 'stress', value: '2' },
      { key: 'edge', value: 'Quick' },
    ]);
    expect(block.sections).toEqual([
      { key: 'moves', entries: [{ name: 'Vanish', desc: 'Gone.' }] },
    ]);
  });

  it('takes five scores, or words among them, as no 5e block at all', () => {
    const five = parseStatblock('stats: [10, 11, 12, 13, 14]');
    const words = parseStatblock('stats: [10, 11, 12, 13, 14, high]');
    expect('problem' in five ? five : five.layout).toBe('generic');
    expect('problem' in words ? words : words.layout).toBe('generic');
  });

  it('says what is wrong with YAML that does not parse or is not a mapping', () => {
    expect(parseStatblock('name: [unclosed')).toMatchObject({ problem: 'yaml' });
    expect(parseStatblock('- just\n- a list')).toMatchObject({ problem: 'not-a-mapping' });
    expect(parseStatblock('')).toMatchObject({ problem: 'not-a-mapping' });
  });
});

describe('a 5e block that does not fit its slots', () => {
  const parse = (source: string) => {
    const block = parseStatblock(`stats: [10, 10, 10, 10, 10, 10]\n${source}`);
    if ('problem' in block) {
      throw new Error(block.message);
    }
    return block;
  };

  it('keeps actions written as plain lines', () => {
    expect(parse('actions: ["Bite. +4 to hit"]\ntraits: None').other).toEqual([
      { key: 'actions', value: 'Bite. +4 to hit' },
      { key: 'traits', value: 'None' },
    ]);
  });

  it('keeps an entry without a name, such as the intro to legendary actions', () => {
    const block = parse(
      'legendary_actions:\n  - desc: The dragon can take 3 actions.\n  - name: Tail\n    desc: Swish.',
    );
    expect(block.sections).toEqual([
      {
        key: 'legendary_actions',
        entries: [
          { name: '', desc: 'The dragon can take 3 actions.' },
          { name: 'Tail', desc: 'Swish.' },
        ],
      },
    ]);
  });

  it('shows hit dice on their own when there are no hit points, and a section-shaped sense as a section', () => {
    const block = parse('hit_dice: 4d8\nsenses:\n  - name: Darkvision\n    desc: 60 ft.');
    expect(block.top).toEqual([{ key: 'hit_dice', value: '4d8' }]);
    expect(block.sections).toEqual([
      { key: 'senses', entries: [{ name: 'Darkvision', desc: '60 ft.' }] },
    ]);
  });
});

describe('abilityModifier', () => {
  it('rounds down, the way the tables print it', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(9)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
  });
});
