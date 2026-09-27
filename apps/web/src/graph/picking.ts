// Which bubble is under the pointer. A quadtree over the bubble centres, rebuilt after the
// positions moved; pure, so the tests run it without a DOM.
import { quadtree, type Quadtree } from 'd3-quadtree';

import type { SimNode } from './simulation.js';
import { toGraph, type ViewTransform } from './view.js';

export type NodeIndex = Quadtree<SimNode>;

/** Coordinates must not move while indexed, so this is rebuilt after the positions change. */
export function buildIndex(nodes: readonly SimNode[]): NodeIndex {
  return quadtree<SimNode>()
    .x((node) => node.x ?? 0)
    .y((node) => node.y ?? 0)
    .addAll(nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
}

/**
 * Screen point (CSS px) → the bubble under it. find() is nearest-centre, so the circle is checked
 * afterwards. `scale` is what the renderer multiplies every radius by (the symbol scale of a
 * large vault at overview, the entry growth), so a bubble drawn small is also picked small.
 */
export function pick(
  index: NodeIndex,
  transform: ViewTransform,
  sx: number,
  sy: number,
  maxRadius: number,
  scale = 1,
  slopPx = 4,
): SimNode | null {
  const [gx, gy] = toGraph(transform, sx, sy);
  const slop = slopPx / transform.k;
  const nearest = index.find(gx, gy, maxRadius * scale + slop);
  if (!nearest) {
    return null;
  }
  const dx = gx - (nearest.x ?? 0);
  const dy = gy - (nearest.y ?? 0);
  return dx * dx + dy * dy <= (nearest.r * scale + slop) ** 2 ? nearest : null;
}
