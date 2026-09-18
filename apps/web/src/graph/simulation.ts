// The force layout. No DOM: everything here runs in Node as well, which keeps it testable.
import type { GraphData } from '@rhizom/core';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

import { clusterSlot } from './palette.js';

export interface SimNode extends SimulationNodeDatum {
  /** Note path — the identity that survives a data refresh. */
  id: string;
  label: string;
  cluster: string;
  degree: number;
  /** Bubble radius in graph units. */
  r: number;
  /** Palette slot 0 … 7. */
  colorIndex: number;
}

/** Endpoints are resolved to node objects up front, so forceLink never looks an id up. */
export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  count: number;
}

/** Well-linked notes grow, but slowly: area, not radius, follows the degree. */
export function radiusOf(degree: number): number {
  return 3 + 2.5 * Math.sqrt(degree);
}

export interface FieldSimulation {
  nodes: () => readonly SimNode[];
  links: () => readonly SimLink[];
  setData: (data: GraphData) => void;
  reheat: (alpha?: number) => void;
  /** Keeps the layout warm while a bubble is held. */
  hold: () => void;
  release: () => void;
  /** Holds a bubble at a position while it is dragged. */
  pin: (node: SimNode, x: number, y: number) => void;
  unpin: (node: SimNode) => void;
  destroy: () => void;
}

export interface Field {
  nodes: SimNode[];
  links: SimLink[];
}

/** New nodes appear next to a neighbour instead of on d3's phyllotaxis spiral. */
function seedNear(node: SimNode, anchor: SimNode): void {
  if (node.x !== undefined || anchor.x === undefined || anchor.y === undefined) {
    return;
  }
  node.x = anchor.x + (Math.random() - 0.5) * 30;
  node.y = anchor.y + (Math.random() - 0.5) * 30;
}

/**
 * Turns graph data into simulation nodes and links, reusing the node objects of the previous
 * field so positions and velocities survive a refresh and the layout does not jump.
 */
export function buildField(previousNodes: readonly SimNode[], data: GraphData): Field {
  const previous = new Map(previousNodes.map((node) => [node.id, node]));
  const byId = new Map<string, SimNode>();
  const nodes = data.nodes.map((node) => {
    const patch = {
      label: node.name,
      cluster: node.cluster,
      degree: node.degree,
      r: radiusOf(node.degree),
      colorIndex: clusterSlot(node.cluster),
    };
    const before = previous.get(node.path);
    const merged: SimNode = before ? Object.assign(before, patch) : { id: node.path, ...patch };
    byId.set(merged.id, merged);
    return merged;
  });

  const links: SimLink[] = [];
  for (const edge of data.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      continue; // an endpoint outside the node set; forceLink would throw on it
    }
    links.push({ source, target, count: edge.count });
    seedNear(source, target);
    seedNear(target, source);
  }

  return { nodes, links };
}

export interface SimulationEvents {
  onTick: () => void;
  onEnd: () => void;
}

/**
 * A calm bubble field: weak positional gravity instead of forceCenter, so disconnected islands
 * stay in the field without the rigid re-centring translation, and a finite charge distance,
 * which is the single biggest per-tick saving on large vaults.
 */
export function createFieldSimulation(events: SimulationEvents): FieldSimulation {
  let nodes: SimNode[] = [];
  let links: SimLink[] = [];

  // Force accessors are evaluated once per initialize, after the endpoints are node objects.
  const link: ForceLink<SimNode, SimLink> = forceLink<SimNode, SimLink>().distance(
    (edge) => 30 + 8 * Math.sqrt(Math.min(edge.source.degree, edge.target.degree)),
  );

  const simulation: Simulation<SimNode, SimLink> = forceSimulation<SimNode, SimLink>()
    .force('link', link)
    .force(
      'charge',
      forceManyBody<SimNode>()
        .strength((node) => -40 - 8 * Math.sqrt(node.degree))
        .theta(0.9)
        .distanceMax(500),
    )
    .force('collide', forceCollide<SimNode>((node) => node.r + 1.5).strength(0.7))
    .force('x', forceX<SimNode>(0).strength(0.03))
    .force('y', forceY<SimNode>(0).strength(0.03))
    // ⌈log(alphaMin) / log(1 − alphaDecay)⌉ ticks until it settles: ~600 instead of d3's 300.
    .alphaDecay(1 - 0.001 ** (1 / 600))
    .velocityDecay(0.5)
    .on('tick', events.onTick)
    .on('end', events.onEnd)
    .stop(); // forceSimulation() starts on its own; the first data set starts it for real

  function setData(data: GraphData): void {
    const field = buildField(nodes, data);
    nodes = field.nodes;
    links = field.links;
    simulation.nodes(nodes); // re-initialises every force, so the accessors above run again
    link.links(links);
  }
  return {
    nodes: () => nodes,
    links: () => links,
    setData,
    reheat: (alpha = 0.3) => {
      simulation.alpha(alpha).restart();
    },
    hold: () => {
      simulation.alphaTarget(0.3).restart();
    },
    release: () => {
      simulation.alphaTarget(0);
    },
    pin: (node, x, y) => {
      node.fx = x;
      node.fy = y;
    },
    unpin: (node) => {
      node.fx = null;
      node.fy = null;
    },
    destroy: () => {
      simulation.on('tick', null).on('end', null).stop();
    },
  };
}
