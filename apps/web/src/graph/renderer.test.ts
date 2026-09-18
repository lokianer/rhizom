import { describe, expect, it } from 'vitest';

import type { Palette } from './palette.js';
import {
  buildIndex,
  identity,
  pick,
  sceneLabels,
  toGraph,
  wheelDelta,
  zoomAround,
  type Scene,
  type ViewTransform,
} from './renderer.js';
import type { SimNode } from './simulation.js';

const palette: Palette = {
  bg: 'rgb(20, 17, 15)',
  edge: 'rgba(236, 229, 218, 0.32)',
  edgeActive: 'rgba(236, 229, 218, 0.75)',
  label: 'rgb(232, 225, 214)',
  labelHalo: 'rgb(20, 17, 15)',
  accent: 'rgb(221, 184, 95)',
  clusters: ['rgb(127, 157, 97)', 'rgb(201, 162, 75)'],
  fontSans: 'ui-sans-serif, system-ui',
};

function node(id: string, x: number, y: number, colorIndex = 0, r = 8): SimNode {
  return { id, label: id, cluster: 'notes', degree: 1, r, colorIndex, x, y };
}

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    nodes: [],
    links: [],
    transform: identity,
    width: 400,
    height: 300,
    pixelRatio: 1,
    palette,
    hovered: null,
    selected: null,
    ...overrides,
  };
}

describe('toGraph', () => {
  it('inverts the screen transform', () => {
    const transform: ViewTransform = { k: 2, x: 30, y: -10 };
    expect(toGraph(transform, 130, 90)).toEqual([50, 50]);
  });
});

describe('zoomAround', () => {
  it('keeps the graph point under the pointer in place', () => {
    const before: ViewTransform = { k: 1.5, x: 40, y: 20 };
    const [gx, gy] = toGraph(before, 200, 120);
    const after = zoomAround(before, 3, 200, 120);
    const [gx2, gy2] = toGraph(after, 200, 120);
    expect(after.k).toBe(3);
    expect(gx2).toBeCloseTo(gx, 10);
    expect(gy2).toBeCloseTo(gy, 10);
  });
});

describe('wheelDelta', () => {
  it('scales pixels, lines and pages differently', () => {
    expect(wheelDelta({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(0.2);
    expect(wheelDelta({ deltaY: -100, deltaMode: 1, ctrlKey: false })).toBeCloseTo(5);
    expect(wheelDelta({ deltaY: -100, deltaMode: 2, ctrlKey: false })).toBeCloseTo(100);
  });

  it('treats a trackpad pinch, which arrives with ctrlKey, ten times as strong', () => {
    expect(wheelDelta({ deltaY: -100, deltaMode: 0, ctrlKey: true })).toBeCloseTo(2);
  });
});

describe('pick', () => {
  const nodes = [node('a.md', 0, 0), node('b.md', 50, 0)];
  const index = buildIndex(nodes);

  it('finds the bubble under the pointer', () => {
    expect(pick(index, identity, 3, 3, 8)?.id).toBe('a.md');
    expect(pick(index, identity, 50, 0, 8)?.id).toBe('b.md');
  });

  it('returns nothing for a point outside every bubble', () => {
    expect(pick(index, identity, 25, 0, 8)).toBeNull();
  });

  it('works through the view transform', () => {
    const transform: ViewTransform = { k: 2, x: 100, y: 100 };
    expect(pick(index, transform, 200, 100, 8)?.id).toBe('b.md');
  });
});

describe('sceneLabels', () => {
  const nodes = [node('near.md', 100, 75), node('far.md', 5000, 5000)];

  it('labels nothing while the view is zoomed out', () => {
    expect(sceneLabels(makeScene({ nodes }))).toEqual([]);
  });

  it('labels the visible bubbles once the view is zoomed in', () => {
    const labels = sceneLabels(makeScene({ nodes, transform: { k: 2, x: 0, y: 0 } }));
    expect(labels.map((label) => label.text)).toEqual(['near.md']);
  });

  it('always labels the hovered and the open note', () => {
    const labels = sceneLabels(makeScene({ nodes, hovered: 'near.md', selected: 'far.md' }));
    expect(labels.map((label) => label.text)).toEqual(['near.md', 'far.md']);
  });

  it('places the label below the bubble', () => {
    const [label] = sceneLabels(makeScene({ nodes, hovered: 'near.md' }));
    expect(label?.x).toBe(100);
    expect(label?.y).toBeGreaterThan(75 + 8);
  });
});
