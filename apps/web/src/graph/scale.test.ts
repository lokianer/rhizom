import { describe, expect, it } from 'vitest';

import {
  edgeDensity,
  labelSizeOf,
  symbolScale,
  SYMBOL_SCALE_FROM,
  SYMBOL_SCALE_MIN,
} from './scale.js';
import { LabelSize } from './types.js';

describe('symbolScale', () => {
  const fitK = 0.4;

  it('leaves a vault of fewer than 300 notes at true size', () => {
    expect(symbolScale(fitK, fitK, SYMBOL_SCALE_FROM - 1)).toBe(1);
    expect(symbolScale(0.01, fitK, 12)).toBe(1);
  });

  it('shrinks a large vault seen whole', () => {
    expect(symbolScale(fitK, fitK, 2000)).toBe(SYMBOL_SCALE_MIN);
    expect(symbolScale(fitK / 4, fitK, 2000)).toBe(SYMBOL_SCALE_MIN);
  });

  it('is back at true size from three times the fitted zoom', () => {
    expect(symbolScale(3 * fitK, fitK, 2000)).toBe(1);
    expect(symbolScale(20 * fitK, fitK, 2000)).toBe(1);
  });

  it('grows in log scale: halfway at the geometric middle', () => {
    expect(symbolScale(Math.sqrt(3) * fitK, fitK, 2000)).toBeCloseTo(0.8, 12);
  });

  it('only ever grows as the view zooms in', () => {
    let previous = 0;
    for (let step = 0; step <= 60; step += 1) {
      const scale = symbolScale(fitK * 2 ** (step / 10 - 1), fitK, 500);
      expect(scale).toBeGreaterThanOrEqual(previous);
      previous = scale;
    }
  });

  it('stays at true size while the fitted zoom is unknown', () => {
    expect(symbolScale(1, 0, 2000)).toBe(1);
    expect(symbolScale(1, Number.NaN, 2000)).toBe(1);
    expect(symbolScale(0, fitK, 2000)).toBe(1);
  });
});

describe('edgeDensity', () => {
  const screen = 1920 * 937;

  it('keeps the links of a small vault at full strength', () => {
    expect(edgeDensity(150, screen)).toBe(1);
    expect(edgeDensity(1200, screen)).toBe(1);
  });

  it('thins a large vault seen whole to a web', () => {
    const factor = edgeDensity(17_000, screen);
    expect(factor).toBeGreaterThan(0.25);
    expect(factor).toBeLessThan(0.3);
  });

  it('falls with the inverse square root of the density', () => {
    const a = edgeDensity(4000, screen);
    const b = edgeDensity(16_000, screen);
    expect(b / a).toBeCloseTo(0.5, 12);
  });

  it('depends on the density only: half the screen counts as twice the links', () => {
    expect(edgeDensity(5000, screen / 2)).toBeCloseTo(edgeDensity(10_000, screen), 12);
  });

  it('never fades a thread out of sight', () => {
    expect(edgeDensity(10_000_000, screen)).toBe(0.2);
  });

  it('reads no links or no screen as full strength', () => {
    expect(edgeDensity(0, screen)).toBe(1);
    expect(edgeDensity(500, 0)).toBe(1);
    expect(edgeDensity(Number.NaN, screen)).toBe(1);
  });
});

describe('labelSizeOf', () => {
  it('gives the top 3 %, then 15 %, of a large vault the larger labels', () => {
    expect(labelSizeOf(0, 2000)).toBe(LabelSize.large);
    expect(labelSizeOf(59, 2000)).toBe(LabelSize.large);
    expect(labelSizeOf(60, 2000)).toBe(LabelSize.medium);
    expect(labelSizeOf(359, 2000)).toBe(LabelSize.medium);
    expect(labelSizeOf(360, 2000)).toBe(LabelSize.small);
    expect(labelSizeOf(1999, 2000)).toBe(LabelSize.small);
  });

  it('gives a tiny vault its top three large labels', () => {
    expect(labelSizeOf(2, 10)).toBe(LabelSize.large);
    expect(labelSizeOf(3, 10)).toBe(LabelSize.medium);
    expect(labelSizeOf(4, 10)).toBe(LabelSize.medium);
    expect(labelSizeOf(5, 10)).toBe(LabelSize.small);
    expect(labelSizeOf(0, 1)).toBe(LabelSize.large);
  });

  it('reads a rank outside the vault as small', () => {
    expect(labelSizeOf(-1, 10)).toBe(LabelSize.small);
    expect(labelSizeOf(10, 10)).toBe(LabelSize.small);
    expect(labelSizeOf(Number.NaN, 10)).toBe(LabelSize.small);
  });
});
