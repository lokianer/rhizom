// The shape of a link. The WebGL vertex shader and the SVG export draw the same curve, so the
// formula lives here once and the shader's copy is checked against it by the tests (see
// gl/shaders.ts, GLSL_EDGE_BEND). The Canvas 2D fallback draws its links straight.

/** How far a link bows out of the straight line, as a fraction of its length. */
export const EDGE_BEND = 0.1;

/**
 * The control point of the quadratic curve from node a to node b. The curve always bows to the
 * same side of the line from the lower index to the higher one, so the pair keeps its shape
 * whichever way round the link was written, and two links of a pair never cross each other.
 */
export function edgeControl(
  a: number,
  ax: number,
  ay: number,
  b: number,
  bx: number,
  by: number,
): [number, number] {
  const flip = a > b ? -1 : 1;
  const dx = bx - ax;
  const dy = by - ay;
  // (-dy, dx) is the left normal with the length of the link; the bend scales it.
  return [(ax + bx) / 2 - dy * EDGE_BEND * flip, (ay + by) / 2 + dx * EDGE_BEND * flip];
}

/** The point at t ∈ [0, 1] on the quadratic curve p0 → c → p1. */
export function quadraticPoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
}
