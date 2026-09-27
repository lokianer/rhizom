// What the WebGL field works out once per data set: the per-node texture contents, the links
// with both ends valid, each note's links for an O(degree) hover, and the order the bubbles are
// drawn in. Pure, so it can be tested without a context, and kept by the renderer so a lost
// context can be rebuilt from it.
import { buildIncidence, sizeOrder } from '../topology.js';
import type { FieldData } from '../types.js';
import { nodeTextureSize, type TextureSize } from './shaders.js';

/** The first palette slot whose territory lives in the second of the two territory textures. */
export const HIGH_SLOT = 4;

/** At most this many links are measured for the typical link length (see typicalLinkLength). */
export const LENGTH_SAMPLES = 1024;

export interface Derived {
  readonly count: number;
  readonly size: TextureSize;
  /** radius, slot, degree, territory per texel. */
  readonly attributes: Float32Array;
  /** Index pairs with both ends in range and no loops. */
  readonly edges: Uint32Array;
  /**
   * The links of each node, as indices into the pairs: node i's are
   * incident[incidentStart[i] … incidentStart[i + 1]) (topology.ts buildIncidence). A hover then
   * gathers its links in O(degree) rather than walking all of them.
   */
  readonly incidentStart: Uint32Array;
  readonly incident: Uint32Array;
  /** Node indices by radius, smallest first (topology.ts sizeOrder): hubs are drawn on top. */
  readonly order: Uint32Array;
  /** Room for every pair; the lit and the selected layers are assembled here before upload. */
  readonly scratch: Uint32Array;
  readonly maxRadius: number;
  /** Some note has a territory. */
  readonly anyTerritory: boolean;
  /** Some note with a territory uses a palette slot of HIGH_SLOT or above. */
  readonly highSlots: boolean;
}

/** Works out everything the renderer keeps for one data set; malformed pairs are dropped. */
export function derive(data: FieldData): Derived {
  const { nodes } = data;
  const count = nodes.count;
  const size = nodeTextureSize(count);
  const attributes = new Float32Array(size.width * size.height * 4);
  let maxRadius = 0;
  let anyTerritory = false;
  let highSlots = false;
  for (let i = 0; i < count; i += 1) {
    const radius = nodes.radius[i] ?? 0;
    const slot = (nodes.slot[i] ?? 0) & 7;
    const territory = nodes.territory[i] === 1 ? 1 : 0;
    attributes[i * 4] = radius;
    attributes[i * 4 + 1] = slot;
    attributes[i * 4 + 2] = nodes.degree[i] ?? 0;
    attributes[i * 4 + 3] = territory;
    maxRadius = Math.max(maxRadius, radius);
    anyTerritory ||= territory === 1;
    highSlots ||= territory === 1 && slot >= HIGH_SLOT;
  }
  const source = data.edges;
  const pairs = new Uint32Array(source.length - (source.length % 2));
  let written = 0;
  for (let i = 0; i + 1 < source.length; i += 2) {
    const a = source[i] ?? count;
    const b = source[i + 1] ?? count;
    if (a < count && b < count && a !== b) {
      pairs[written] = a;
      pairs[written + 1] = b;
      written += 2;
    }
  }
  const edges = pairs.subarray(0, written);
  const incidence = buildIncidence(count, edges);
  return {
    count,
    size,
    attributes,
    edges,
    incidentStart: incidence.offsets,
    incident: incidence.links,
    order: sizeOrder(nodes),
    scratch: new Uint32Array(Math.max(2, written)),
    maxRadius,
    anyTerritory,
    highSlots,
  };
}

/**
 * The mean length of the links in graph units, measured on at most LENGTH_SAMPLES of them spread
 * evenly over the list, skipping any end the layout has not placed yet; 0 without a measurable
 * link. Cheap enough for every layout tick, and it allocates nothing.
 */
export function typicalLinkLength(edges: Uint32Array, xy: Float32Array): number {
  const links = edges.length >> 1;
  const stride = Math.max(1, Math.ceil(links / LENGTH_SAMPLES));
  let sum = 0;
  let measured = 0;
  for (let link = 0; link < links; link += stride) {
    const a = edges[link * 2] ?? 0;
    const b = edges[link * 2 + 1] ?? 0;
    const length = Math.hypot(
      (xy[b * 2] ?? Number.NaN) - (xy[a * 2] ?? Number.NaN),
      (xy[b * 2 + 1] ?? Number.NaN) - (xy[a * 2 + 1] ?? Number.NaN),
    );
    if (Number.isFinite(length)) {
      sum += length;
      measured += 1;
    }
  }
  return measured > 0 ? sum / measured : 0;
}
