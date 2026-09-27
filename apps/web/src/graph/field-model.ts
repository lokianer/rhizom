// One data set turned into what the renderers and the overlay read: flat arrays by node index.
// Built once per data set, never per frame; pure, so the tests run it without a DOM.
import { buildAdjacency, type Adjacency } from './focus.js';
import { territoryFlags } from './regions.js';
import type { SimLink, SimNode } from './simulation.js';
import type { FieldData } from './types.js';

export interface FieldModel {
  readonly data: FieldData;
  readonly adjacency: Adjacency;
  /** Index into `clusters` by node index. */
  readonly clusterOfNode: Uint16Array;
  /** Cluster keys, in the order the graph response lists them. */
  readonly clusters: readonly string[];
  /** Notes per cluster, by cluster index. */
  readonly clusterSizes: Uint32Array;
  /** Palette slot per cluster index: the slot its notes are drawn in. */
  readonly clusterSlots: Uint8Array;
  /** Node indices, best linked first (then by name): the order labels are placed in. */
  readonly labelOrder: Uint32Array;
  /** 1-based position of each node in labelOrder — "rank 3 of 41" in the info bar. */
  readonly rank: Uint32Array;
  /** Node index by note path. */
  readonly indexOf: ReadonlyMap<string, number>;
}

export function buildFieldModel(
  nodes: readonly SimNode[],
  links: readonly SimLink[],
  clusterKeys: readonly string[],
): FieldModel {
  const count = nodes.length;
  const indexOf = new Map<string, number>();
  nodes.forEach((node, index) => {
    indexOf.set(node.id, index);
  });

  const clusters = [...clusterKeys];
  const clusterIndex = new Map(clusters.map((key, index) => [key, index]));
  const clusterOfNode = new Uint16Array(count);
  nodes.forEach((node, index) => {
    let cluster = clusterIndex.get(node.cluster);
    if (cluster === undefined) {
      // A key the response did not list; give it an index rather than lumping it with another.
      cluster = clusters.length;
      clusters.push(node.cluster);
      clusterIndex.set(node.cluster, cluster);
    }
    clusterOfNode[index] = cluster;
  });
  const clusterSizes = new Uint32Array(clusters.length);
  const clusterSlots = new Uint8Array(clusters.length);
  clusterOfNode.forEach((cluster, node) => {
    clusterSizes[cluster] = (clusterSizes[cluster] ?? 0) + 1;
    clusterSlots[cluster] = nodes[node]?.colorIndex ?? 0;
  });

  const edges = new Uint32Array(links.length * 2);
  let written = 0;
  for (const link of links) {
    const source = indexOf.get(link.source.id);
    const target = indexOf.get(link.target.id);
    if (source === undefined || target === undefined) {
      continue; // an endpoint outside the node set
    }
    edges[written] = source;
    edges[written + 1] = target;
    written += 2;
  }
  const pairs = edges.subarray(0, written);

  const radius = new Float32Array(count);
  const slot = new Uint8Array(count);
  const degree = new Float32Array(count);
  nodes.forEach((node, index) => {
    radius[index] = node.r;
    slot[index] = node.colorIndex;
    degree[index] = node.degree;
  });

  const order = Array.from({ length: count }, (_, index) => index).sort((a, b) => {
    const byDegree = (nodes[b]?.degree ?? 0) - (nodes[a]?.degree ?? 0);
    return byDegree !== 0 ? byDegree : (nodes[a]?.label ?? '').localeCompare(nodes[b]?.label ?? '');
  });
  const labelOrder = Uint32Array.from(order);
  const rank = new Uint32Array(count);
  labelOrder.forEach((node, position) => {
    rank[node] = position + 1;
  });

  return {
    data: {
      nodes: {
        count,
        radius,
        slot,
        degree,
        territory: territoryFlags(clusterOfNode, clusterSizes),
      },
      edges: pairs,
    },
    adjacency: buildAdjacency(count, pairs),
    clusterOfNode,
    clusters,
    clusterSizes,
    clusterSlots,
    labelOrder,
    rank,
    indexOf,
  };
}
