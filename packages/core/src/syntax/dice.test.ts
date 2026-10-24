import { describe, expect, it } from 'vitest';

import { parseDice, rollDice } from './dice.js';

/** Dice that show the given faces in turn, for a die of `sides` sides. */
function faces(sides: number, ...values: number[]): () => number {
  let at = 0;
  return () => {
    const value = values[at % values.length] ?? 1;
    at += 1;
    return (value - 1) / sides;
  };
}

describe('parseDice', () => {
  it('reads dice, constants, signs and keeps', () => {
    expect(parseDice('2d6+3')?.terms).toEqual([
      { kind: 'dice', sign: 1, count: 2, sides: 6 },
      { kind: 'constant', sign: 1, value: 3 },
    ]);
    expect(parseDice('4d6kh3')?.terms).toEqual([
      { kind: 'dice', sign: 1, count: 4, sides: 6, keep: { which: 'highest', count: 3 } },
    ]);
    expect(parseDice('1d20 - 1d4')?.terms[1]).toEqual({
      kind: 'dice',
      sign: -1,
      count: 1,
      sides: 4,
    });
  });

  it('reads d% as a hundred-sided die and gives the notation back without spaces', () => {
    expect(parseDice('D%')?.terms).toEqual([{ kind: 'dice', sign: 1, count: 1, sides: 100 }]);
    expect(parseDice(' 3 D 8 + 1 ')?.notation).toBe('3d8+1');
  });

  it('refuses what is not a roll', () => {
    for (const notation of [
      '',
      'd',
      '1d',
      'two d6',
      '1d6+',
      '0d6',
      '101d6',
      '60d6+60d6',
      '1d0',
      '1d1001',
      '1e6',
      '4d6kh5',
      '4d6kh0',
      '2d6 & 3',
      Array.from({ length: 21 }, () => '1').join('+'),
    ]) {
      expect(parseDice(notation), notation).toBeUndefined();
    }
  });
});

describe('rollDice', () => {
  it('adds the dice and the constants', () => {
    const roll = rollDice('2d6+3', faces(6, 4, 4));
    expect(roll?.total).toBe(11);
    expect(roll?.text).toBe('2d6+3 → 11 (4, 4, +3)');
  });

  it('keeps the highest or the lowest and strikes the rest through', () => {
    expect(rollDice('4d6kh3', faces(6, 1, 6, 5, 2))?.text).toBe('4d6kh3 → 13 (~~1~~, 6, 5, 2)');
    expect(rollDice('2d20kl1', faces(20, 15, 3))?.text).toBe('2d20kl1 → 3 (~~15~~, 3)');
  });

  it('gives a tie to the die rolled first', () => {
    const roll = rollDice('2d6kh1', faces(6, 4, 4));
    expect(roll?.terms[0]).toEqual({
      kind: 'dice',
      sign: 1,
      dice: [
        { value: 4, kept: true },
        { value: 4, kept: false },
      ],
    });
  });

  it('takes away what a minus stands before', () => {
    const shown = [14 / 20, 1 / 4];
    const roll = rollDice('1d20-1d4-1', () => shown.shift() ?? 0);
    expect(roll?.total).toBe(12);
    expect(roll?.text).toBe('1d20-1d4-1 → 12 (15, -2, -1)');
  });

  it('writes a single die as its total alone', () => {
    expect(rollDice('d20', faces(20, 14))?.text).toBe('d20 → 14');
  });

  it('stays inside the sides of the die', () => {
    expect(rollDice('1d6', () => 0)?.total).toBe(1);
    expect(rollDice('1d6', () => 0.999_999)?.total).toBe(6);
    expect(rollDice('d%', () => 0.999_999)?.total).toBe(100);
  });

  it('rolls nothing for a notation that is not one', () => {
    expect(rollDice('2d6+', () => 0.5)).toBeUndefined();
  });
});
