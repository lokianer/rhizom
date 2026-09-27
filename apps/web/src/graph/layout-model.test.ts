import { describe, expect, it } from 'vitest';

import { collideBelowAlpha, continuesLayout, layoutTuning } from './layout-model.js';

const NaN2 = [Number.NaN, Number.NaN];

describe('continuesLayout', () => {
  it('reads a payload with most of its nodes placed as a layout to continue', () => {
    expect(continuesLayout(Float32Array.from([0, 0, 5, -5, ...NaN2]))).toBe(true);
    expect(continuesLayout(Float32Array.from([0, 0, ...NaN2, ...NaN2]))).toBe(false);
  });

  it('wants more than half, both coordinates, and some nodes at all', () => {
    expect(continuesLayout(Float32Array.from([0, 0, ...NaN2]))).toBe(false);
    expect(continuesLayout(Float32Array.from([3, Number.NaN, 4, 4, 5, 5]))).toBe(true);
    expect(continuesLayout(Float32Array.from([3, Number.NaN, 4, Number.NaN, 5, 5]))).toBe(false);
    expect(continuesLayout(new Float32Array(0))).toBe(false);
  });
});

describe('collideBelowAlpha', () => {
  const large = layoutTuning(2000);
  const small = layoutTuning(100);
  const unplaced = (count: number) => new Float32Array(count * 2).fill(Number.NaN);
  const placed = (count: number) => new Float32Array(count * 2);

  it('holds collision back for the first layout of a large field', () => {
    expect(large.collideBelowAlpha).toBeLessThan(1);
    expect(collideBelowAlpha(large, unplaced(2000))).toBe(large.collideBelowAlpha);
  });

  it('adds it at once to a large field that is already laid out', () => {
    expect(collideBelowAlpha(large, placed(2000))).toBe(1);
  });

  it('adds it at once to a small field either way', () => {
    expect(collideBelowAlpha(small, unplaced(100))).toBe(1);
    expect(collideBelowAlpha(small, placed(100))).toBe(1);
  });
});
