// The view transform and the geometry of looking at the field: pure, so the camera, the exports
// and the unit tests share it without a DOM.
import type { Rect } from './types.js';

/** screen (CSS px) = graph · k + (x, y) — d3-zoom's convention, without the dependency. */
export interface ViewTransform {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

export const identity: ViewTransform = { k: 1, x: 0, y: 0 };

export function toGraph(t: ViewTransform, sx: number, sy: number): [number, number] {
  return [(sx - t.x) / t.k, (sy - t.y) / t.k];
}

/** Structural, so the tests can pass a plain object where the browser passes a WheelEvent. */
export interface WheelLike {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}

/**
 * d3-zoom's wheelDelta, kept because it is tuned for every input device: pixels, lines, pages,
 * and the trackpad pinch that browsers report as a wheel event with ctrlKey set. Scale = 2^Δ.
 */
export function wheelDelta(event: WheelLike): number {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
  return -event.deltaY * unit * (event.ctrlKey ? 10 : 1);
}

/** What fitTransform needs of a bubble. */
export interface Placed {
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly r: number;
}

export interface FitOptions {
  padding?: number;
  maxScale?: number;
  minScale?: number;
  /**
   * Screen areas covered by something drawn over the field (the legend, the zoom control). The
   * fitted field keeps clear of them where it can, so no note starts out hidden under a panel.
   */
  reserved?: readonly Rect[];
}

/** The view that shows every bubble, with a little air around the field. */
export function fitTransform(
  nodes: readonly Placed[],
  width: number,
  height: number,
  options: FitOptions = {},
): ViewTransform {
  const padding = options.padding ?? 48;
  const maxScale = options.maxScale ?? 1.5;
  const minScale = options.minScale ?? 0.1;
  const centre = { k: 1, x: width / 2, y: height / 2 };
  if (nodes.length === 0 || width <= 0 || height <= 0) {
    return centre;
  }

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const x = node.x;
    const y = node.y;
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue; // a node the layout has not placed yet
    }
    left = Math.min(left, x - node.r);
    right = Math.max(right, x + node.r);
    top = Math.min(top, y - node.r);
    bottom = Math.max(bottom, y + node.r);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return centre;
  }

  const area = usableArea(width, height, options.reserved ?? []);
  const fieldWidth = Math.max(right - left, 1);
  const fieldHeight = Math.max(bottom - top, 1);
  const usableWidth = Math.max(area.right - area.left - padding * 2, 1);
  const usableHeight = Math.max(area.bottom - area.top - padding * 2, 1);
  // Never magnify a small vault beyond maxScale: three notes should not fill the screen.
  const k = Math.min(
    maxScale,
    Math.max(minScale, Math.min(usableWidth / fieldWidth, usableHeight / fieldHeight)),
  );
  return {
    k,
    x: (area.left + area.right) / 2 - ((left + right) / 2) * k,
    y: (area.top + area.bottom) / 2 - ((top + bottom) / 2) * k,
  };
}

/**
 * How close to an edge a reserved rectangle may stand and still count as hugging it. The panels
 * over the field keep a small margin from the edges, and a panel inset by that margin covers the
 * field just as much as one flush with the edge.
 */
export const EDGE_HUG_PX = 48;

/**
 * The largest part of the screen left over when each reserved rectangle is cut away along the
 * side it hugs. A rectangle further than EDGE_HUG_PX from every edge is ignored: it floats over
 * the field and cutting it away would cost more room than it saves.
 */
export function usableArea(width: number, height: number, reserved: readonly Rect[]): Rect {
  let area: Rect = { left: 0, top: 0, right: width, bottom: height };
  for (const rect of reserved) {
    const candidates: Rect[] = [];
    if (rect.left <= area.left + EDGE_HUG_PX) {
      candidates.push({ ...area, left: Math.max(area.left, rect.right) });
    }
    if (rect.right >= area.right - EDGE_HUG_PX) {
      candidates.push({ ...area, right: Math.min(area.right, rect.left) });
    }
    if (rect.top <= area.top + EDGE_HUG_PX) {
      candidates.push({ ...area, top: Math.max(area.top, rect.bottom) });
    }
    if (rect.bottom >= area.bottom - EDGE_HUG_PX) {
      candidates.push({ ...area, bottom: Math.min(area.bottom, rect.top) });
    }
    const best = candidates.reduce<Rect | null>(
      (winner, next) => (winner === null || areaOf(next) > areaOf(winner) ? next : winner),
      null,
    );
    if (best !== null && areaOf(best) > 0) {
      area = best;
    }
  }
  return area;
}

function areaOf(rect: Rect): number {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}
