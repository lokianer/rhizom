import { CLUSTER_COUNT } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import {
  clusterSlot,
  clusterSlots,
  groundOf,
  luminance,
  parseColor,
  type Palette,
} from './palette.js';

describe('parseColor', () => {
  it('reads what the palette probe serialises', () => {
    expect(parseColor('rgb(255, 0, 51)')).toEqual([1, 0, 0.2, 1]);
    expect(parseColor('rgba(236, 229, 218, 0.32)')).toEqual([
      236 / 255,
      229 / 255,
      218 / 255,
      0.32,
    ]);
    expect(parseColor('rgb(20 17 15 / 50%)')).toEqual([20 / 255, 17 / 255, 15 / 255, 0.5]);
  });

  it('reads hex, short and long', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseColor('#14110F')).toEqual([20 / 255, 17 / 255, 15 / 255, 1]);
  });

  it('reads anything else as opaque black rather than throwing', () => {
    expect(parseColor('color(display-p3 1 0 0)')).toEqual([0, 0, 0, 1]);
    expect(parseColor('#12')).toEqual([0, 0, 0, 1]);
    expect(parseColor('rgb(1, 2)')).toEqual([0, 0, 0, 1]);
  });
});

describe('groundOf', () => {
  const base = { bg: '' } as Palette;

  it('tells soil from chalk by the luminance of the background', () => {
    expect(groundOf({ ...base, bg: 'rgb(20, 17, 15)' })).toBe('humus');
    expect(groundOf({ ...base, bg: 'rgb(244, 241, 234)' })).toBe('kalk');
    expect(luminance([1, 1, 1, 1])).toBeCloseTo(1, 5);
  });
});

describe('clusterSlots', () => {
  it('gives every cluster a slot of its own while there are colours to go round', () => {
    const names = [
      'Archive',
      'Campaign',
      'Daily',
      'Ideas',
      'People',
      'Projects',
      'Reading',
      'Research',
    ];
    const slots = clusterSlots(names);
    expect(new Set(slots.values()).size).toBe(names.length);
  });

  it('keeps a cluster on its hash slot unless an earlier one holds it', () => {
    const slots = clusterSlots(['Only']);
    expect(slots.get('Only')).toBe(clusterSlot('Only'));
  });

  it('does not depend on the order the clusters come in, or on repeats', () => {
    const one = clusterSlots(['b', 'a', 'c', 'a']);
    const two = clusterSlots(['c', 'b', 'a']);
    expect([...one.entries()].sort()).toEqual([...two.entries()].sort());
  });

  it('lets clusters past the eighth share, from their hash slot', () => {
    const names = Array.from(
      { length: CLUSTER_COUNT + 3 },
      (_, index) => `folder ${String(index)}`,
    );
    const slots = clusterSlots(names);
    expect(slots.size).toBe(names.length);
    for (const slot of slots.values()) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(CLUSTER_COUNT);
    }
  });
});
