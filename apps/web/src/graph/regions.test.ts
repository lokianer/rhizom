import { describe, expect, it } from 'vitest';

import type { Palette } from './palette.js';
import {
  medianOf,
  nameFlags,
  nameMin,
  regionAlpha,
  regionAnchors,
  REGION_NAME_CHARS,
  regionLabels,
  regionNames,
  selectKth,
  territoryFlags,
  territoryMin,
  type RegionLabel,
  type RegionNamesInput,
} from './regions.js';
import type { RegionName } from './types.js';

const palette: Palette = {
  bg: 'rgb(20, 17, 15)',
  edge: 'rgba(236, 229, 218, 0.32)',
  edgeActive: 'rgba(236, 229, 218, 0.75)',
  label: 'rgb(232, 225, 214)',
  labelHalo: 'rgb(20, 17, 15)',
  accent: 'rgb(221, 184, 95)',
  plate: 'rgba(38, 33, 29, 0.92)',
  glow: 'rgb(243, 223, 176)',
  inkLight: 'rgb(251, 249, 244)',
  inkDark: 'rgb(20, 17, 15)',
  clusters: ['rgb(127, 157, 97)', 'rgb(201, 162, 75)', 'rgb(180, 90, 70)'],
  fontSans: 'ui-sans-serif, system-ui',
};

/** Cluster ids with the given sizes, in order: sizes [2, 3] → [0, 0, 1, 1, 1]. */
function clustersOfSizes(sizes: readonly number[]): number[] {
  return sizes.flatMap((size, cluster) => Array.from({ length: size }, () => cluster));
}

describe('thresholds', () => {
  it('gives a small vault territories from three notes and names from five', () => {
    expect(territoryMin(10)).toBe(3);
    expect(territoryMin(100)).toBe(3);
    expect(nameMin(10)).toBe(5);
    expect(nameMin(100)).toBe(5);
  });

  it('asks 3 % of a large vault for both', () => {
    expect(territoryMin(2000)).toBe(60);
    expect(nameMin(2000)).toBe(60);
    expect(territoryMin(250)).toBe(8); // 7.5 rounds up: a milieu is at least its share
  });
});

describe('territoryFlags', () => {
  it('gives clusters of one or two notes no territory', () => {
    const ids = clustersOfSizes([1, 2, 3, 4]);
    const flags = territoryFlags(ids, [1, 2, 3, 4]);
    expect([...flags]).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('takes a typed array of ids as well', () => {
    const flags = territoryFlags(Uint16Array.from([0, 0, 0, 1]), Uint32Array.from([3, 1]));
    expect([...flags]).toEqual([1, 1, 1, 0]);
  });

  it('asks a cluster of a large vault for 3 % of its notes', () => {
    const sizes = [59, 60, 1881];
    const flags = territoryFlags(clustersOfSizes(sizes), sizes);
    expect(flags[0]).toBe(0);
    expect(flags[59]).toBe(1);
    expect(flags[1999]).toBe(1);
  });
});

describe('nameFlags', () => {
  it('names clusters of five notes and more in a small vault', () => {
    expect([...nameFlags([4, 5, 12])]).toEqual([0, 1, 1]);
  });

  it('asks a large vault for 3 % of its notes, counted from the sizes', () => {
    expect([...nameFlags([59, 60, 1881])]).toEqual([0, 1, 1]);
  });
});

describe('regionLabels', () => {
  it('names the large clusters, most notes first, and passes their slots on', () => {
    const labels = regionLabels(['a', 'b', 'c', 'd'], [6, 2, 20, 6], [3, 4, 5, 6]);
    expect(labels).toEqual([
      { cluster: 2, text: 'c', slot: 5 },
      { cluster: 0, text: 'a', slot: 3 },
      { cluster: 3, text: 'd', slot: 6 },
    ]);
  });

  it('cuts a very long name down before it becomes a glyph sprite', () => {
    const [label] = regionLabels(['w'.repeat(60_000)], [10], [0]);
    expect(label?.text).toHaveLength(REGION_NAME_CHARS);
    expect(label?.text.endsWith('…')).toBe(true);
  });

  it('gives a cluster without a name none, however large', () => {
    const labels = regionLabels(['', 'notes'], [40, 10], [0, 1]);
    expect(labels.map((label) => label.text)).toEqual(['notes']);
  });
});

describe('selectKth', () => {
  it('agrees with a sort for every rank, duplicates included', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const length of [1, 2, 3, 10, 57]) {
      const values = Array.from({ length }, () => Math.floor(random() * 12));
      const sorted = [...values].sort((a, b) => a - b);
      for (let k = 0; k < length; k += 1) {
        expect(selectKth(Float64Array.from(values), length, k)).toBe(sorted[k]);
      }
    }
  });

  it('looks only at the first `length` values', () => {
    expect(selectKth(Float64Array.from([5, 1, 3, -100, -200]), 3, 0)).toBe(1);
  });
});

describe('medianOf', () => {
  it('takes the middle value, the upper one of an even count, and NaN of nothing', () => {
    expect(medianOf([9, 1, 5])).toBe(5);
    expect(medianOf(Float32Array.from([4, 1, 3, 2]))).toBe(3);
    expect(medianOf([])).toBeNaN();
  });

  it('leaves its input alone', () => {
    const radii = Float32Array.from([3, 1, 2]);
    medianOf(radii);
    expect([...radii]).toEqual([3, 1, 2]);
  });
});

describe('regionAnchors', () => {
  function positionsOf(points: readonly (readonly [number, number])[]): Float32Array {
    return Float32Array.from(points.flat());
  }

  it('anchors each cluster on the member nearest its median', () => {
    const positions = positionsOf([
      [0, 0],
      [10, 0],
      [20, 0],
      [100, 100],
      [110, 100],
      [120, 100],
    ]);
    const anchors = regionAnchors(positions, [0, 0, 0, 1, 1, 1], [1, 1]);
    expect([...anchors]).toEqual([1, 4]);
  });

  it('keeps the name on the bulk of a cluster that has a far outlier', () => {
    const positions = positionsOf([
      [0, 0],
      [4, 1],
      [2, 3],
      [3, -2],
      [5000, 5000],
    ]);
    const anchor = regionAnchors(positions, [0, 0, 0, 0, 0], [1])[0] ?? -1;
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeLessThan(4);
  });

  it('sets the name on a member of a ring, never in the empty middle', () => {
    const ring = Array.from({ length: 12 }, (_, i): [number, number] => [
      Math.cos((i / 12) * Math.PI * 2) * 100,
      Math.sin((i / 12) * Math.PI * 2) * 100,
    ]);
    const anchors = regionAnchors(positionsOf(ring), new Array<number>(12).fill(0), [1]);
    const anchor = anchors[0] ?? -1;
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(ring[anchor]?.[0] ?? 0, ring[anchor]?.[1] ?? 0)).toBeCloseTo(100, 3);
  });

  it('leaves clusters that are not eligible or not placed without an anchor', () => {
    const positions = Float32Array.from([0, 0, 1, 1, Number.NaN, Number.NaN, Number.NaN, 5]);
    const anchors = regionAnchors(positions, [0, 0, 1, 1], [0, 1]);
    expect([...anchors]).toEqual([-1, -1]);
  });

  it('skips members that have not been placed yet', () => {
    const positions = Float32Array.from([Number.NaN, Number.NaN, 40, 40, 42, 40]);
    const anchors = regionAnchors(positions, [0, 0, 0], [1]);
    expect(anchors[0]).toBeGreaterThan(0);
  });

  it('writes into the array it is given when it has one entry per cluster', () => {
    const out = new Int32Array(2);
    const positions = Float32Array.from([0, 0, 5, 5]);
    expect(regionAnchors(positions, [1, 1], [0, 1], out)).toBe(out);
    expect([...out]).toEqual([-1, 1]);
    expect(regionAnchors(positions, [1, 1], [0, 1], new Int32Array(5))).toHaveLength(2);
  });

  it('works with more nodes than any call before it', () => {
    const count = 3000;
    const positions = new Float32Array(count * 2).map((_, i) => i);
    const anchors = regionAnchors(positions, new Uint16Array(count), [1]);
    expect(anchors[0]).toBe(count / 2);
  });
});

describe('regionAlpha', () => {
  it('shows the names while bubbles are dots and hides them once they are bubbles', () => {
    expect(regionAlpha(2)).toBe(1);
    expect(regionAlpha(8.5)).toBe(1);
    expect(regionAlpha(10.5)).toBeCloseTo(0.5, 12);
    expect(regionAlpha(12.5)).toBe(0);
    expect(regionAlpha(40)).toBe(0);
    expect(regionAlpha(Number.NaN)).toBe(0);
  });
});

describe('regionNames', () => {
  const regions: RegionLabel[] = [
    { cluster: 1, text: 'Projects', slot: 2 },
    { cluster: 0, text: 'Journal', slot: 7 },
  ];
  const positions = Float32Array.from([10, 20, 30, 40, 50, 60]);

  function input(overrides: Partial<RegionNamesInput> = {}): RegionNamesInput {
    return {
      regions,
      anchors: Int32Array.from([0, 2]),
      positions,
      transform: { k: 2, x: 5, y: -10 },
      width: 400,
      height: 300,
      alpha: 0.8,
      hovered: -1,
      palette,
      ...overrides,
    };
  }

  it('sets each name at its anchor in CSS px, in the order of the regions', () => {
    expect(regionNames(input())).toEqual([
      { text: 'Projects', x: 105, y: 110, alpha: 0.8, color: palette.clusters[2] },
      { text: 'Journal', x: 25, y: 30, alpha: 0.8, color: palette.label },
    ]);
  });

  it('hides every name while a note is hovered', () => {
    const names = regionNames(input({ hovered: 1 }));
    expect(names.map((name) => name.alpha)).toEqual([0, 0]);
  });

  it('hides a name whose anchor is off screen or not placed', () => {
    const names = regionNames(
      input({ anchors: Int32Array.from([-1, 2]), transform: { k: 10, x: 0, y: 0 } }),
    );
    expect(names.map((name) => name.alpha)).toEqual([0, 0]);
  });

  it('clamps the alpha it is given', () => {
    expect(regionNames(input({ alpha: 3 }))[0]?.alpha).toBe(1);
    expect(regionNames(input({ alpha: -1 }))[0]?.alpha).toBe(0);
  });

  it('reuses the objects of the previous result', () => {
    const out: RegionName[] = [];
    const first = regionNames(input(), out);
    const kept = first[0];
    const second = regionNames(input({ transform: { k: 1, x: 0, y: 0 } }), out);
    expect(second).toBe(out);
    expect(second[0]).toBe(kept);
    expect(second[0]?.x).toBe(50);
  });

  it('hides the name of the smaller milieu where two names would overlap', () => {
    const three: RegionLabel[] = [...regions, { cluster: 2, text: 'Reading', slot: 1 }];
    // On screen: Projects at (100, 100), Journal at (150, 105), Reading at (200, 100).
    const at = input({
      regions: three,
      anchors: Int32Array.from([1, 0, 2]),
      positions: Float32Array.from([100, 100, 150, 105, 200, 100]),
      transform: { k: 1, x: 0, y: 0 },
    });
    const wide = regionNames({ ...at, halfWidths: [40, 30, 30], halfHeight: 12 });
    // Projects (first, most notes) keeps its name; Journal overlaps it and goes; Reading overlaps
    // only the hidden Journal, which blocks nothing, so it stays.
    expect(wide.map((name) => name.alpha)).toEqual([0.8, 0, 0.8]);
    const narrow = regionNames({ ...at, halfWidths: [10, 10, 10], halfHeight: 12 });
    expect(narrow.map((name) => name.alpha)).toEqual([0.8, 0.8, 0.8]);
    // Without the widths nothing is measured, so nothing is hidden.
    expect(regionNames(at).map((name) => name.alpha)).toEqual([0.8, 0.8, 0.8]);
  });

  it('follows the number of regions when it changes', () => {
    const out = regionNames(input());
    expect(regionNames(input({ regions: regions.slice(0, 1) }), out)).toHaveLength(1);
    expect(regionNames(input({ regions: [] }), out)).toHaveLength(0);
  });
});
