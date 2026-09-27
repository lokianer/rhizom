import { describe, expect, it } from 'vitest';

import { buildFieldModel } from './field-model.js';
import { RegionLayer } from './field-regions.js';
import type { Palette } from './palette.js';
import type { SimNode } from './simulation.js';
import type { MeasureText } from './types.js';

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
  clusters: Array.from({ length: 8 }, () => 'rgb(127, 157, 97)'),
  fontSans: 'ui-sans-serif, system-ui',
};

/** Twelve notes in one cluster around (0, 0) and one in a cluster too small to be named. */
function field(): SimNode[] {
  const nodes: SimNode[] = Array.from({ length: 12 }, (_, index) => ({
    id: `r${String(index)}.md`,
    label: `r${String(index)}`,
    cluster: 'Research',
    degree: 1,
    r: 4,
    colorIndex: 0,
    x: Math.cos(index) * 20,
    y: Math.sin(index) * 20,
  }));
  nodes.push({
    id: 'x.md',
    label: 'x',
    cluster: 'Loose',
    degree: 0,
    r: 4,
    colorIndex: 1,
    x: 90,
    y: 0,
  });
  return nodes;
}

function positionsOf(nodes: readonly SimNode[]): Float32Array {
  return Float32Array.from(nodes.flatMap((node) => [node.x ?? 0, node.y ?? 0]));
}

describe('RegionLayer', () => {
  const nodes = field();
  const model = buildFieldModel(nodes, [], ['Loose', 'Research']);
  const positions = positionsOf(nodes);
  let measured = 0;
  const measure: MeasureText = (text, fontPx) => {
    measured += 1;
    return text.length * fontPx * 0.6;
  };
  const centre = { k: 1, x: 200, y: 150 };

  it('names only the clusters large enough, at the bubble nearest their middle', () => {
    const layer = new RegionLayer(model, palette);
    layer.moved(positions);
    const names = layer.names(positions, centre, 400, 300, 1, 1, palette, measure);
    expect(names.map((name) => name.text)).toEqual(['Research']);
    expect(names[0]?.alpha).toBeGreaterThan(0.5);
    expect(Math.hypot((names[0]?.x ?? 0) - 200, (names[0]?.y ?? 0) - 150)).toBeLessThan(25);
  });

  it('fades the names with the fade it is given, and out as bubbles grow on screen', () => {
    const layer = new RegionLayer(model, palette);
    layer.moved(positions);
    const full = layer.names(positions, centre, 400, 300, 1, 1, palette, measure)[0]?.alpha ?? 0;
    const half = layer.names(positions, centre, 400, 300, 1, 0.5, palette, measure)[0]?.alpha ?? 0;
    expect(half).toBeCloseTo(full / 2, 5);
    expect(layer.visibility({ k: 10, x: 0, y: 0 }, 1)).toBe(0);
  });

  it('measures the names once per measuring function, not per frame', () => {
    const layer = new RegionLayer(model, palette);
    layer.moved(positions);
    measured = 0;
    layer.names(positions, centre, 400, 300, 1, 1, palette, measure);
    const first = measured;
    layer.names(positions, centre, 400, 300, 1, 1, palette, measure);
    expect(first).toBeGreaterThan(0);
    expect(measured).toBe(first);
  });

  it('returns the same array on every frame', () => {
    const layer = new RegionLayer(model, palette);
    layer.moved(positions);
    const one = layer.names(positions, centre, 400, 300, 1, 1, palette, measure);
    const two = layer.names(positions, centre, 400, 300, 1, 1, palette, measure);
    expect(two).toBe(one);
  });
});
