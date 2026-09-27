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
  /**
   * When the collision force joins, as the alpha below which it is added: 1 from the start, a
   * lower value only once the field has spread out. Collision is the priciest force, so a large
   * field adds it after its first third, when the many-body force has done the spreading.
   */
  collideBelowAlpha: number;
  /**
   * How hard it pushes, and how many passes a tick makes. A dense large field packs its bubbles
   * so tightly that one pass at 0.7 leaves one bubble in twenty with its centre inside another —
   * a ball pit once somebody zooms in; full strength and two passes bring that under one in 300.
   * A tick with it costs about twice one without (7 → 16 ms), in the worker, where the page does
   * not feel it (measured on 2,000 notes, 17,000 links).
   */
  collideStrength: number;
  collideIterations: number;
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
    // Alpha falls from 1 to 0.001 geometrically over the ticks: 0.1 is a third of the way.
    collideBelowAlpha: large ? 0.1 : 1,
    collideStrength: large ? 1 : 0.7,
    collideIterations: large ? 2 : 1,
    theta: large ? 1.2 : 0.9,
    distanceMax: large ? 300 : 500,
    ticks: large ? 300 : 600,
  };
}

/**
 * Whether a payload continues a layout rather than starting one: more than half of its nodes
 * already have a place. A refresh keeps the positions of every note that survives it and seeds
 * new ones next to a neighbour, so only a first layout is mostly unplaced.
 */
export function continuesLayout(positions: Float32Array): boolean {
  const count = Math.floor(positions.length / 2);
  let placed = 0;
  for (let index = 0; index < count; index += 1) {
    if (Number.isFinite(positions[index * 2]) && Number.isFinite(positions[index * 2 + 1])) {
      placed += 1;
    }
  }
  return placed * 2 > count;
}

/**
 * The alpha below which the worker adds the collision force. A large field holds it back only
 * for a first layout: its nodes start on d3's tight spiral, and collision would pay its full
 * price while the many-body force does the spreading anyway. A field that is already laid out —
 * refreshed by a colour switch, a tag filter or a changed local graph, or sent to a worker woken
 * from its sleep — has its bubbles apart already; without collision from the first tick they
 * would sink into each other and be pushed apart again a third of the way through, a visible
 * pulse across the whole field.
 */
export function collideBelowAlpha(tuning: LayoutTuning, positions: Float32Array): number {
  return continuesLayout(positions) ? 1 : tuning.collideBelowAlpha;
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
