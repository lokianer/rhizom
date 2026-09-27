import { describe, expect, it } from 'vitest';

import { EDGE_BEND, edgeControl, quadraticPoint } from './geometry.js';
import { GLSL_EDGE_BEND } from './gl/shaders.js';

describe('EDGE_BEND', () => {
  it('is the bend the edge shader draws, so the screen and the SVG show one curve', () => {
    const glsl = /EDGE_BEND\s*=\s*([0-9.]+)/.exec(GLSL_EDGE_BEND)?.[1];
    expect(Number(glsl)).toBe(EDGE_BEND);
  });
});

describe('edgeControl', () => {
  it('gives a pair the same control point whichever way round the link was written', () => {
    const forward = edgeControl(3, 10, 20, 8, 110, -40);
    const backward = edgeControl(8, 110, -40, 3, 10, 20);
    expect(backward[0]).toBeCloseTo(forward[0], 12);
    expect(backward[1]).toBeCloseTo(forward[1], 12);
  });

  it('bows out by a tenth of the length, square to the line through its middle', () => {
    const [ax, ay, bx, by] = [-30, 12, 90, 62];
    const [cx, cy] = edgeControl(0, ax, ay, 1, bx, by);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const length = Math.hypot(bx - ax, by - ay);
    expect(Math.hypot(cx - mx, cy - my)).toBeCloseTo(EDGE_BEND * length, 9);
    expect((cx - mx) * (bx - ax) + (cy - my) * (by - ay)).toBeCloseTo(0, 9);
  });

  it('bows to the left of the line from the lower index to the higher', () => {
    expect(edgeControl(0, 0, 0, 1, 10, 0)).toEqual([5, 1]);
    expect(edgeControl(1, 10, 0, 0, 0, 0)).toEqual([5, 1]);
  });

  it('bows to the other side of a line whose lower index sits at the other end', () => {
    const [, low] = edgeControl(0, 0, 0, 1, 10, 0);
    const [, high] = edgeControl(5, 0, 0, 2, 10, 0);
    expect(Math.sign(low)).toBe(-Math.sign(high));
  });

  it('collapses onto the point for a link of no length', () => {
    expect(edgeControl(0, 4, 7, 1, 4, 7)).toEqual([4, 7]);
  });

  it('scales with the link, so the shape is the same at every size', () => {
    const [cx, cy] = edgeControl(0, 0, 0, 1, 200, 100);
    const [sx, sy] = edgeControl(0, 0, 0, 1, 20, 10);
    expect(cx).toBeCloseTo(sx * 10, 12);
    expect(cy).toBeCloseTo(sy * 10, 12);
  });
});

describe('quadraticPoint', () => {
  const [x0, y0, cx, cy, x1, y1] = [0, 0, 50, 30, 100, -10];

  it('starts at the first end and stops at the second', () => {
    expect(quadraticPoint(x0, y0, cx, cy, x1, y1, 0)).toEqual([x0, y0]);
    expect(quadraticPoint(x0, y0, cx, cy, x1, y1, 1)).toEqual([x1, y1]);
  });

  it('passes a quarter of each end and half the control point at its middle', () => {
    const [mx, my] = quadraticPoint(x0, y0, cx, cy, x1, y1, 0.5);
    expect(mx).toBeCloseTo((x0 + 2 * cx + x1) / 4, 12);
    expect(my).toBeCloseTo((y0 + 2 * cy + y1) / 4, 12);
  });

  it('puts the middle of a link half a bend away from the straight line', () => {
    const [ax, ay, bx, by] = [0, 0, 80, 60];
    const [kx, ky] = edgeControl(0, ax, ay, 1, bx, by);
    const [mx, my] = quadraticPoint(ax, ay, kx, ky, bx, by, 0.5);
    const offset = Math.hypot(mx - (ax + bx) / 2, my - (ay + by) / 2);
    expect(offset).toBeCloseTo((EDGE_BEND * Math.hypot(bx - ax, by - ay)) / 2, 9);
  });

  it('is a straight line when the control point lies on it', () => {
    const [x, y] = quadraticPoint(0, 0, 5, 5, 10, 10, 0.3);
    expect(x).toBeCloseTo(3, 12);
    expect(y).toBeCloseTo(3, 12);
  });
});
