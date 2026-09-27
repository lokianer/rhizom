// What the renderers work out once per data set from its links and its radii: the links of each
// note, so a focus costs its degree rather than a pass over every link, and the order the bubbles
// are drawn in. Pure, and shared by the WebGL field (gl/derive.ts), the Canvas 2D fallback and,
// for the order, the SVG export, so the three cannot disagree on either.
import type { FieldNodes } from './types.js';

/**
 * The links of every note in compressed sparse rows: node i's links are
 * links[offsets[i] … offsets[i + 1]), each a link number — its pair's index into
 * FieldData.edges, halved.
 */
export interface Incidence {
  /** count + 1 entries. */
  readonly offsets: Uint32Array;
  readonly links: Uint32Array;
}

/**
 * Groups the links of flat index pairs [s0, t0, s1, t1, …] by node. A link with an end outside
 * 0 … count − 1 is left out; a self-link is listed once, under its one node.
 */
export function buildIncidence(count: number, pairs: Uint32Array): Incidence {
  const offsets = new Uint32Array(count + 1);
  const total = pairs.length >> 1;
  for (let link = 0; link < total; link += 1) {
    const a = pairs[link * 2] ?? count;
    const b = pairs[link * 2 + 1] ?? count;
    if (a >= count || b >= count) {
      continue;
    }
    offsets[a + 1] = (offsets[a + 1] ?? 0) + 1;
    if (b !== a) {
      offsets[b + 1] = (offsets[b + 1] ?? 0) + 1;
    }
  }
  for (let index = 0; index < count; index += 1) {
    offsets[index + 1] = (offsets[index + 1] ?? 0) + (offsets[index] ?? 0);
  }
  const links = new Uint32Array(offsets[count] ?? 0);
  const next = offsets.slice(0, count);
  for (let link = 0; link < total; link += 1) {
    const a = pairs[link * 2] ?? count;
    const b = pairs[link * 2 + 1] ?? count;
    if (a >= count || b >= count) {
      continue;
    }
    const at = next[a] ?? 0;
    links[at] = link;
    next[a] = at + 1;
    if (b !== a) {
      const bt = next[b] ?? 0;
      links[bt] = link;
      next[b] = bt + 1;
    }
  }
  return { offsets, links };
}

/** Node indices from the smallest bubble to the largest, ties by index: hubs are drawn last. */
export function sizeOrder(nodes: Pick<FieldNodes, 'count' | 'radius'>): Uint32Array {
  const order = new Uint32Array(nodes.count);
  for (let index = 0; index < nodes.count; index += 1) {
    order[index] = index;
  }
  return order.sort((p, q) => (nodes.radius[p] ?? 0) - (nodes.radius[q] ?? 0) || p - q);
}
