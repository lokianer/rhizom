import { folderOf, noteNameOf } from './paths.js';

export interface GraphNote {
  path: string;
  tags: readonly string[];
}

export interface GraphLink {
  source: string;
  /** Resolved target path, or null for a link to a note that does not exist. */
  target: string | null;
}

export interface GraphNode {
  path: string;
  name: string;
  folder: string;
  /** Top-level folder or first tag, depending on the clustering option; empty for the vault root / untagged. */
  cluster: string;
  /** Number of distinct neighbours, counting both directions. */
  degree: number;
  inDegree: number;
  outDegree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** How many links point from source to target. */
  count: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Sorted, distinct cluster keys present in the graph. */
  clusters: string[];
}

export interface GraphOptions {
  clusterBy: 'folder' | 'tag';
}

/**
 * Builds the bubble graph from indexed notes and resolved links: one node per note, one edge
 * per linked pair (repeated links only raise the count), no self links, no unresolved links.
 */
export function buildGraph(
  notes: readonly GraphNote[],
  links: readonly GraphLink[],
  options: GraphOptions,
): GraphData {
  const nodes = new Map<string, GraphNode>();
  for (const note of notes) {
    nodes.set(note.path, {
      path: note.path,
      name: noteNameOf(note.path),
      folder: folderOf(note.path),
      cluster: clusterOf(note, options.clusterBy),
      degree: 0,
      inDegree: 0,
      outDegree: 0,
    });
  }

  const edges = new Map<string, GraphEdge>();
  for (const link of links) {
    if (link.target === null || link.target === link.source) {
      continue;
    }
    if (!nodes.has(link.source) || !nodes.has(link.target)) {
      continue;
    }
    const key = `${link.source} -> ${link.target}`;
    const existing = edges.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      edges.set(key, { source: link.source, target: link.target, count: 1 });
    }
  }

  for (const edge of edges.values()) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source && target) {
      source.outDegree += 1;
      source.degree += 1;
      target.inDegree += 1;
      target.degree += 1;
    }
  }

  const nodeList = [...nodes.values()];
  return { nodes: nodeList, edges: [...edges.values()], clusters: clustersOf(nodeList) };
}

/** The ego network of one note: every node within `depth` hops in either direction. */
export function localGraph(graph: GraphData, centerPath: string, depth: number): GraphData {
  if (!graph.nodes.some((node) => node.path === centerPath)) {
    return { nodes: [], edges: [], clusters: [] };
  }

  const neighbours = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    (neighbours.get(edge.source) ?? neighbours.set(edge.source, new Set()).get(edge.source))?.add(
      edge.target,
    );
    (neighbours.get(edge.target) ?? neighbours.set(edge.target, new Set()).get(edge.target))?.add(
      edge.source,
    );
  }

  const included = new Set<string>([centerPath]);
  let frontier = [centerPath];
  for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const neighbour of neighbours.get(path) ?? []) {
        if (!included.has(neighbour)) {
          included.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
  }

  const nodes = graph.nodes.filter((node) => included.has(node.path));
  const edges = graph.edges.filter(
    (edge) => included.has(edge.source) && included.has(edge.target),
  );
  return { nodes, edges, clusters: clustersOf(nodes) };
}

/** Deterministic palette slot for a cluster key (FNV-1a hash modulo the palette size). */
export function clusterColorIndex(cluster: string, paletteSize: number): number {
  let hash = 0x811c9dc5;
  for (const character of cluster) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % paletteSize;
}

function clusterOf(note: GraphNote, clusterBy: GraphOptions['clusterBy']): string {
  if (clusterBy === 'tag') {
    return note.tags[0] ?? '';
  }
  const folder = folderOf(note.path);
  const slash = folder.indexOf('/');
  return slash === -1 ? folder : folder.slice(0, slash);
}

function clustersOf(nodes: readonly GraphNode[]): string[] {
  return [...new Set(nodes.map((node) => node.cluster))].sort((a, b) => a.localeCompare(b));
}
