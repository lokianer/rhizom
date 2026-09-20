/// <reference lib="webworker" />
// The force layout, off the main thread: a tick of a few thousand nodes costs tens of
// milliseconds, which on the page would mean a frozen canvas for the whole settling time.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

import { alphaDecayFor, layoutTuning, linkDistance, type LayoutPayload } from './layout-model.js';

export type LayoutRequest =
  | ({ type: 'data'; alpha: number } & LayoutPayload)
  | { type: 'alpha'; alpha: number }
  | { type: 'target'; alphaTarget: number }
  | { type: 'pin'; index: number; x: number; y: number }
  | { type: 'unpin'; index: number }
  | { type: 'stop' };

export interface LayoutResponse {
  type: 'positions';
  positions: Float32Array;
  /** True once the layout has settled and no further messages follow. */
  settled: boolean;
}

interface Node extends SimulationNodeDatum {
  degree: number;
  r: number;
}

interface Link extends SimulationLinkDatum<Node> {
  source: Node;
  target: Node;
}

/** At most one message per frame: the page cannot draw faster than that anyway. */
const MIN_POST_INTERVAL_MS = 16;

let simulation: Simulation<Node, Link> | null = null;
let nodes: Node[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastPost = 0;

function post(settled: boolean): void {
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => {
    positions[index * 2] = node.x ?? 0;
    positions[index * 2 + 1] = node.y ?? 0;
  });
  const message: LayoutResponse = { type: 'positions', positions, settled };
  postMessage(message, [positions.buffer]);
  lastPost = Date.now();
}

function step(): void {
  timer = null;
  if (!simulation) {
    return;
  }
  simulation.tick();
  const settled = simulation.alpha() < simulation.alphaMin();
  if (settled || Date.now() - lastPost >= MIN_POST_INTERVAL_MS) {
    post(settled);
  }
  if (!settled) {
    // setTimeout rather than a tight loop: incoming messages (a drag, new data) get their turn.
    timer = setTimeout(step, 0);
  }
}

function run(): void {
  timer ??= setTimeout(step, 0);
}

function build(request: Extract<LayoutRequest, { type: 'data' }>): void {
  const tuning = layoutTuning(request.degrees.length);
  nodes = Array.from(request.degrees, (degree, index) => {
    const x = request.positions[index * 2];
    const y = request.positions[index * 2 + 1];
    const node: Node = { degree, r: request.radii[index] ?? 3 };
    // A node that has never been placed is left to d3's phyllotaxis spiral.
    if (x !== undefined && Number.isFinite(x) && y !== undefined && Number.isFinite(y)) {
      node.x = x;
      node.y = y;
    }
    return node;
  });

  const links: Link[] = [];
  for (let i = 0; i + 1 < request.edges.length; i += 2) {
    const source = nodes[request.edges[i] ?? -1];
    const target = nodes[request.edges[i + 1] ?? -1];
    if (source && target) {
      links.push({ source, target });
    }
  }

  const existing = simulation;
  if (existing) {
    existing.stop();
  }
  const next = forceSimulation<Node, Link>(nodes)
    .force(
      'link',
      forceLink<Node, Link>(links).distance((edge) => linkDistance(edge)),
    )
    .force(
      'charge',
      forceManyBody<Node>()
        .strength((node) => -40 - 8 * Math.sqrt(node.degree))
        .theta(tuning.theta)
        .distanceMax(tuning.distanceMax),
    )
    // Weak positional gravity instead of forceCenter: islands stay in the field without the
    // rigid re-centring translation.
    .force('x', forceX<Node>(0).strength(0.03))
    .force('y', forceY<Node>(0).strength(0.03))
    .alphaDecay(alphaDecayFor(tuning.ticks))
    .velocityDecay(0.5)
    .stop();
  if (tuning.collide) {
    next.force('collide', forceCollide<Node>((node) => node.r + 1.5).strength(0.7));
  }
  next.alpha(request.alpha);
  simulation = next;
  run();
}

onmessage = (event: MessageEvent<LayoutRequest>): void => {
  const request = event.data;
  switch (request.type) {
    case 'data':
      build(request);
      return;
    case 'alpha':
      simulation?.alpha(request.alpha);
      run();
      return;
    case 'target':
      simulation?.alphaTarget(request.alphaTarget);
      run();
      return;
    case 'pin': {
      const node = nodes[request.index];
      if (node) {
        node.fx = request.x;
        node.fy = request.y;
      }
      run();
      return;
    }
    case 'unpin': {
      const node = nodes[request.index];
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      return;
    }
    case 'stop':
      simulation?.stop();
      simulation = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      return;
  }
};
