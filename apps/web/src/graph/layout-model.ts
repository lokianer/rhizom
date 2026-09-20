// What crosses the line between the page and the layout worker: flat typed arrays, no objects.
// Pure on purpose — the worker cannot be unit-tested, this can.
import type { SimLink, SimNode } from './simulation.js';

export interface LayoutPayload {
  /** One entry per node, in the order of the node array. */
  degrees: Float32Array;
  radii: Float32Array;
  /** x, y per node; NaN for a node that has never been placed. */
  positions: Float32Array;
  /** Flat pairs of node indices: [source0, target0, source1, target1, …]. */
  edges: Uint32Array;
}

/**
 * How long an edge wants to be. Both simulations — the one in the worker and the one on the
 * main thread — ask this, so the field looks the same whichever is drawing it; it used to be
 * written out twice and the two could drift.
 *
 * The length grows with the *lesser* of the two degrees: an edge between two well-connected
 * notes needs room, while a leaf hanging off a hub should sit close to it. The square root
 * keeps a hub with forty links from pushing everything to the rim.
 */
export function linkDistance(edge: {
  source: { degree: number };
  target: { degree: number };
}): number {
  return 36 + 9.6 * Math.sqrt(Math.min(edge.source.degree, edge.target.degree));
}

/** How hard the layout may work: the per-tick cost has to stay bearable on large vaults. */
export interface LayoutTuning {
  /** Collision is the priciest force and only cosmetic, so large fields go without it. */
  collide: boolean;
  /** Barnes–Hut approximation: coarser for large fields. */
  theta: number;
  /** Charges beyond this distance are ignored. */
  distanceMax: number;
  /** Ticks until the layout is considered settled. */
  ticks: number;
}

export function layoutTuning(nodeCount: number): LayoutTuning {
  const large = nodeCount > 1200;
  return {
    collide: !large,
    theta: large ? 1.2 : 0.9,
    distanceMax: large ? 300 : 500,
    ticks: large ? 300 : 600,
  };
}

/** ⌈log(alphaMin) / log(1 − decay)⌉ ticks until a simulation settles; this is the inverse. */
export function alphaDecayFor(ticks: number): number {
  return 1 - 0.001 ** (1 / ticks);
}

export function toLayoutPayload(
  nodes: readonly SimNode[],
  links: readonly SimLink[],
): LayoutPayload {
  const indexOf = new Map<SimNode, number>();
  const degrees = new Float32Array(nodes.length);
  const radii = new Float32Array(nodes.length);
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => {
    indexOf.set(node, index);
    degrees[index] = node.degree;
    radii[index] = node.r;
    positions[index * 2] = node.x ?? Number.NaN;
    positions[index * 2 + 1] = node.y ?? Number.NaN;
  });

  const edges = new Uint32Array(links.length * 2);
  let written = 0;
  for (const link of links) {
    const source = indexOf.get(link.source);
    const target = indexOf.get(link.target);
    if (source === undefined || target === undefined) {
      continue; // an endpoint outside the node set; the renderer skips it too
    }
    edges[written] = source;
    edges[written + 1] = target;
    written += 2;
  }

  return { degrees, radii, positions, edges: edges.subarray(0, written) };
}

/** Copies the worker's answer back onto the nodes the renderer draws. */
export function applyPositions(nodes: readonly SimNode[], positions: Float32Array): void {
  const count = Math.min(nodes.length, positions.length / 2);
  for (let index = 0; index < count; index += 1) {
    const node = nodes[index];
    if (node === undefined) {
      continue;
    }
    node.x = positions[index * 2];
    node.y = positions[index * 2 + 1];
  }
}
