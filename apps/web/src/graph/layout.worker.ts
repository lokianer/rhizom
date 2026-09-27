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

import {
  alphaDecayFor,
  collideBelowAlpha,
  layoutTuning,
  linkDistance,
  type LayoutPayload,
} from './layout-model.js';

/** What the page asks of the worker; a data set carries an `epoch` the worker echoes back. */
export type LayoutRequest =
  | ({ type: 'data'; alpha: number; epoch: number } & LayoutPayload)
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
  /**
   * How many requests the worker had handled when it posted this. Messages cross in flight: a
   * settle posted just before a hold, a pin or new data arrived says nothing about the layout
   * after them, and the page can only tell by comparing this with the number it has sent.
   */
  handled: number;
  /** The epoch of the data set these positions belong to; older ones index other nodes. */
  epoch: number;
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
/** When and how the collision force joins; see LayoutTuning. */
let collide = { belowAlpha: 1, strength: 0.7, iterations: 1 };
/** Requests handled so far and the data set in hand, echoed in every response. */
let handled = 0;
let epoch = 0;

function post(settled: boolean): void {
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => {
    positions[index * 2] = node.x ?? 0;
    positions[index * 2 + 1] = node.y ?? 0;
  });
  const message: LayoutResponse = { type: 'positions', positions, settled, handled, epoch };
  postMessage(message, [positions.buffer]);
  lastPost = Date.now();
}

/**
 * How long one slice of ticks may run before the worker looks at its messages again. One tick
 * per timer made the settling as slow as the browser's timer clamp rather than as slow as the
 * field: a small field waited 4 ms between ticks of a tenth of that, and a large one lost a few
 * seconds of its settling to the waits.
 */
const SLICE_MS = 8;

function step(): void {
  timer = null;
  const current = simulation;
  if (!current) {
    return;
  }
  const until = performance.now() + SLICE_MS;
  let settled: boolean;
  do {
    if (current.alpha() <= collide.belowAlpha && !current.force('collide')) {
      current.force(
        'collide',
        forceCollide<Node>((node) => node.r + 1.5)
          .strength(collide.strength)
          .iterations(collide.iterations),
      );
    }
    current.tick();
    settled = current.alpha() < current.alphaMin();
  } while (!settled && performance.now() < until);
  if (settled || Date.now() - lastPost >= MIN_POST_INTERVAL_MS) {
    post(settled);
  }
  if (!settled) {
    // A timer between slices rather than a tight loop: incoming messages (a drag, new data) get
    // their turn.
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
  // The collision force is added by step() once the alpha falls below this — at once for a
  // small field or one already laid out, a third of the way through a large first layout.
  collide = {
    belowAlpha: collideBelowAlpha(tuning, request.positions),
    strength: tuning.collideStrength,
    iterations: tuning.collideIterations,
  };
  epoch = request.epoch;
  next.alpha(request.alpha);
  simulation = next;
  run();
}

// Every request but 'stop' runs at least one step, so every request gets an answer — also one
// that leaves the layout at rest: the page lets the worker sleep only on a settle that has seen
// all its requests, and would otherwise wait for it forever.
onmessage = (event: MessageEvent<LayoutRequest>): void => {
  // Counted first, so a request that fails is still counted and the page is not left waiting.
  handled += 1;
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
      run();
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
