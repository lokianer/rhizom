import { describe, expect, it } from 'vitest';

import type { Rect } from './types.js';
import {
  fitTransform,
  identity,
  toGraph,
  usableArea,
  EDGE_HUG_PX,
  wheelDelta,
  type Placed,
  type ViewTransform,
} from './view.js';

/** Where a graph point lands on screen: the transform itself, the inverse of toGraph. */
function toScreen(t: ViewTransform, gx: number, gy: number): [number, number] {
  return [gx * t.k + t.x, gy * t.k + t.y];
}

describe('toGraph', () => {
  it('inverts the screen transform', () => {
    const transform: ViewTransform = { k: 2, x: 30, y: -10 };
    expect(toGraph(transform, 130, 90)).toEqual([50, 50]);
  });

  it('round-trips a point', () => {
    const transform: ViewTransform = { k: 0.37, x: -412.5, y: 88 };
    const [gx, gy] = toGraph(transform, 17, 903);
    const [sx, sy] = toScreen(transform, gx, gy);
    expect(sx).toBeCloseTo(17, 9);
    expect(sy).toBeCloseTo(903, 9);
  });

  it('is the identity for the identity transform', () => {
    expect(toGraph(identity, 12, -4)).toEqual([12, -4]);
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

  it('zooms out for a wheel turned towards the reader', () => {
    expect(wheelDelta({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(-0.2);
  });
});

describe('fitTransform', () => {
  const nodes: Placed[] = [
    { x: -100, y: -50, r: 10 },
    { x: 100, y: 50, r: 10 },
  ];

  it('centres an empty field, or one on a screen of no size', () => {
    expect(fitTransform([], 800, 600)).toEqual({ k: 1, x: 400, y: 300 });
    expect(fitTransform(nodes, 0, 600)).toEqual({ k: 1, x: 0, y: 300 });
  });

  it('fits every bubble inside the padding and centres the field', () => {
    const t = fitTransform(nodes, 800, 600, { padding: 50, maxScale: 100 });
    // The field is 220 × 120 graph units; the usable screen 700 × 500.
    expect(t.k).toBeCloseTo(700 / 220, 10);
    const [left, top] = toScreen(t, -110, -60);
    const [right, bottom] = toScreen(t, 110, 60);
    expect(left).toBeCloseTo(50, 9);
    expect(right).toBeCloseTo(750, 9);
    expect((top + bottom) / 2).toBeCloseTo(300, 9);
    expect(top).toBeGreaterThanOrEqual(50);
    expect(bottom).toBeLessThanOrEqual(550);
  });

  it('never magnifies a small vault beyond maxScale', () => {
    const tiny: Placed[] = [{ x: 0, y: 0, r: 5 }];
    expect(fitTransform(tiny, 800, 600).k).toBe(1.5);
    expect(fitTransform(tiny, 800, 600, { maxScale: 3 }).k).toBe(3);
  });

  it('never shrinks a huge field below minScale', () => {
    const huge: Placed[] = [
      { x: -1e6, y: 0, r: 1 },
      { x: 1e6, y: 0, r: 1 },
    ];
    expect(fitTransform(huge, 800, 600).k).toBe(0.1);
    expect(fitTransform(huge, 800, 600, { minScale: 0.001 }).k).toBe(0.001);
    expect(fitTransform(huge, 800, 600, { minScale: 1e-6 }).k).toBeCloseTo(704 / 2_000_002, 12);
  });

  it('leaves out the notes the layout has not placed yet', () => {
    const withUnplaced: Placed[] = [
      ...nodes,
      { r: 10 },
      { x: 5000, r: 10 },
      { x: Number.NaN, y: 0, r: 10 },
      { x: 0, y: Number.POSITIVE_INFINITY, r: 10 },
    ];
    expect(fitTransform(withUnplaced, 800, 600)).toEqual(fitTransform(nodes, 800, 600));
  });

  it('centres the view when no note is placed at all', () => {
    expect(fitTransform([{ r: 4 }, { r: 6 }], 800, 600)).toEqual({ k: 1, x: 400, y: 300 });
  });

  it('keeps clear of a panel along the left edge', () => {
    const reserved: Rect[] = [{ left: 0, top: 0, right: 200, bottom: 600 }];
    const t = fitTransform(nodes, 800, 600, { reserved, maxScale: 100 });
    const [left] = toScreen(t, -110, 0);
    const [centreX] = toScreen(t, 0, 0);
    expect(left).toBeGreaterThanOrEqual(200 + 48 - 1e-9);
    expect(centreX).toBeCloseTo(500, 9);
  });
});

describe('usableArea', () => {
  const width = 1000;
  const height = 800;
  const whole: Rect = { left: 0, top: 0, right: width, bottom: height };

  it('is the whole screen when nothing is reserved', () => {
    expect(usableArea(width, height, [])).toEqual(whole);
  });

  it('cuts away a panel along each edge', () => {
    expect(usableArea(width, height, [{ left: 0, top: 100, right: 240, bottom: 500 }])).toEqual({
      ...whole,
      left: 240,
    });
    expect(usableArea(width, height, [{ left: 820, top: 100, right: 1000, bottom: 500 }])).toEqual({
      ...whole,
      right: 820,
    });
    expect(usableArea(width, height, [{ left: 300, top: 0, right: 600, bottom: 64 }])).toEqual({
      ...whole,
      top: 64,
    });
    expect(usableArea(width, height, [{ left: 300, top: 700, right: 600, bottom: 800 }])).toEqual({
      ...whole,
      bottom: 700,
    });
  });

  it('counts a panel inset a little from an edge as hugging it', () => {
    // The legend stands 16 px in from the corner; the field must still keep clear of it.
    expect(usableArea(width, height, [{ left: 16, top: 16, right: 250, bottom: 300 }])).toEqual({
      ...whole,
      left: 250,
    });
    expect(
      usableArea(width, height, [{ left: EDGE_HUG_PX + 1, top: 200, right: 150, bottom: 300 }]),
    ).toEqual(whole);
  });

  it('ignores a rectangle that floats over the field', () => {
    expect(usableArea(width, height, [{ left: 400, top: 300, right: 600, bottom: 500 }])).toEqual(
      whole,
    );
  });

  it('cuts a corner panel away along the side that costs less room', () => {
    // 300 wide and 100 tall in the top right corner: losing 100 rows beats losing 300 columns.
    expect(usableArea(width, height, [{ left: 700, top: 0, right: 1000, bottom: 100 }])).toEqual({
      ...whole,
      top: 100,
    });
  });

  it('takes several panels in turn', () => {
    const area = usableArea(width, height, [
      { left: 0, top: 0, right: 220, bottom: 800 },
      { left: 880, top: 740, right: 1000, bottom: 800 },
    ]);
    expect(area).toEqual({ left: 220, top: 0, right: 1000, bottom: 740 });
  });

  it('keeps the screen rather than cut away everything', () => {
    expect(usableArea(width, height, [{ left: 0, top: 0, right: 1000, bottom: 800 }])).toEqual(
      whole,
    );
  });
});
