// The same field simulation, computed in a worker. The page keeps the nodes it draws and
// hit-tests; the worker owns the physics and sends positions back.
import type { GraphData } from '@rhizom/core';

import { applyPositions, toLayoutPayload } from './layout-model.js';
import type { LayoutRequest, LayoutResponse } from './layout.worker.js';
import {
  buildField,
  createFieldSimulation,
  type FieldSimulation,
  type SimLink,
  type SimNode,
  type SimulationEvents,
} from './simulation.js';

/**
 * How long a settled worker is kept before it is terminated. A worker's heap grows to several
 * times its live set while d3 rebuilds its quadtree on every tick — 65 to 80 MB for 2,000 notes
 * — and V8 keeps that heap for as long as the worker lives, so a field that has come to rest
 * gives it back. The next drag or data set starts a fresh worker from the current positions,
 * which costs a few milliseconds.
 */
export const WORKER_SLEEP_MS = 2000;

/** The alpha a held bubble keeps the layout at, as on the main thread. */
const HOLD_TARGET = 0.3;

/** The part of a Worker this module uses, so the tests can stand in a fake for it. */
export interface LayoutWorker {
  onmessage: ((event: MessageEvent<LayoutResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: LayoutRequest, transfer: Transferable[]) => void;
  terminate: () => void;
}

/** Vite finds the worker by this exact expression and bundles it; keep it written out. */
function startLayoutWorker(): LayoutWorker {
  return new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' });
}

/**
 * Returns null where workers are unavailable, so the caller can fall back to the layout on the
 * main thread rather than showing nothing.
 */
export function createWorkerLayout(
  events: SimulationEvents,
  startWorker: () => LayoutWorker = startLayoutWorker,
): FieldSimulation | null {
  let worker: LayoutWorker | null = null;
  /** Requests posted to the current worker, compared with the count it echoes back. */
  let sent = 0;
  /** Data sets posted, across workers; positions from an earlier one index other nodes. */
  let epoch = 0;

  let nodes: readonly SimNode[] = [];
  let links: readonly SimLink[] = [];
  /** Positions by node index, the array the renderer uploads; replaced by every worker message. */
  let positions: Float32Array = new Float32Array(0);
  const indexOf = new Map<SimNode, number>();
  let settled = true;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  /**
   * The drag in progress. The worker starts every data set from rest with nothing pinned, so a
   * worker that receives one — new data, or a worker woken from its sleep — is told both again.
   * The pin keeps its node rather than its index, which a data set may change.
   */
  let held = false;
  let pinned: { node: SimNode; x: number; y: number } | null = null;
  /**
   * The layout on the main thread, once a worker has failed to start. A Worker whose script does
   * not load throws nothing where it is constructed; it reports an error later, and without this
   * the field would wait for positions that never come.
   */
  let fallback: FieldSimulation | null = null;
  /** Whether the current worker has answered at all: an error after that is not a load failure. */
  let heard = false;
  let lastData: GraphData | null = null;

  const receive = (response: LayoutResponse): void => {
    heard = true;
    if (response.epoch !== epoch) {
      return;
    }
    positions = response.positions;
    applyPositions(nodes, positions);
    events.onTick();
    // Only a settle that has seen every request counts: one posted before a later hold, pin or
    // reheat reached the worker would put it to sleep in the middle of what those started, or
    // mark the field settled early and leave the worker running after the real settle.
    if (response.settled && response.handled === sent && !settled) {
      settled = true;
      events.onEnd();
      scheduleSleep();
    }
  };

  const cancelSleep = (): void => {
    if (sleepTimer !== null) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
  };

  const retire = (): void => {
    if (worker !== null) {
      worker.onmessage = null;
      worker.terminate();
      worker = null;
    }
  };

  function scheduleSleep(): void {
    cancelSleep();
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      // A held bubble keeps its worker: a fresh one would restart the drag from a field at rest.
      if (settled && !held) {
        retire();
      }
    }, WORKER_SLEEP_MS);
  }

  /** A new worker as the current one, or null where it cannot be started. */
  const spawn = (): LayoutWorker | null => {
    let fresh: LayoutWorker;
    try {
      fresh = startWorker();
    } catch {
      return null;
    }
    // The page's messages ahead of the ones it has handled are counted per worker.
    sent = 0;
    heard = false;
    fresh.onerror = () => {
      if (fresh === worker && !heard) {
        runOnMainThread();
      }
    };
    // A retired worker may still have a message on its way; only the current one is heard.
    fresh.onmessage = (event) => {
      if (fresh === worker) {
        receive(event.data);
      }
    };
    worker = fresh;
    return fresh;
  };

  const post = (
    target: LayoutWorker,
    request: LayoutRequest,
    transfer: Transferable[] = [],
  ): void => {
    sent += 1;
    target.postMessage(request, transfer);
  };

  /** Sends the whole field: every data set, and to a worker woken from its sleep. */
  const sendData = (target: LayoutWorker, alpha: number): void => {
    const payload = toLayoutPayload(nodes, links);
    // The payload's buffers are transferred and gone from this side once posted.
    positions = payload.positions.slice();
    epoch += 1;
    post(target, { type: 'data', alpha, epoch, ...payload }, [
      payload.degrees.buffer,
      payload.radii.buffer,
      payload.positions.buffer,
      // edges is a subarray: its buffer may be larger than the view, which transfers fine.
      payload.edges.buffer,
    ]);
    if (held) {
      post(target, { type: 'target', alphaTarget: HOLD_TARGET });
    }
    const index = pinned === null ? undefined : indexOf.get(pinned.node);
    if (pinned !== null && index !== undefined) {
      post(target, { type: 'pin', index, x: pinned.x, y: pinned.y });
    }
  };

  /**
   * Posts a request, waking the worker with the current positions if it was asleep. Every
   * request unsettles the field until the worker answers one that has seen it.
   */
  const request = (message: LayoutRequest, alpha = 0): void => {
    cancelSleep();
    settled = false;
    if (destroyed) {
      return;
    }
    let target = worker;
    if (target === null) {
      target = spawn();
      if (target === null) {
        return;
      }
      sendData(target, alpha);
    }
    post(target, message);
  };

  /** Hands the layout to the main thread for good, starting from the last data set. */
  function runOnMainThread(): void {
    cancelSleep();
    retire();
    if (destroyed || fallback !== null) {
      return;
    }
    fallback = createFieldSimulation(events);
    if (lastData !== null) {
      fallback.setData(lastData);
      fallback.reheat(1);
    }
  }

  if (spawn() === null) {
    return null;
  }

  // Each method posts its request before it records the new state: a worker woken by the
  // request is told the state as it was, then the request itself, and gets nothing twice.
  return {
    nodes: () => fallback?.nodes() ?? nodes,
    links: () => fallback?.links() ?? links,
    positions: () => fallback?.positions() ?? positions,
    setData: (data: GraphData) => {
      lastData = data;
      if (fallback) {
        fallback.setData(data);
        return;
      }
      const field = buildField(nodes, data);
      nodes = field.nodes;
      links = field.links;
      indexOf.clear();
      nodes.forEach((node, index) => {
        indexOf.set(node, index);
      });
      cancelSleep();
      settled = false;
      if (destroyed) {
        return;
      }
      const target = worker ?? spawn();
      if (target !== null) {
        sendData(target, 1);
      }
    },
    reheat: (alpha = 0.3) => {
      if (fallback) {
        fallback.reheat(alpha);
        return;
      }
      request({ type: 'alpha', alpha }, alpha);
    },
    hold: () => {
      if (fallback) {
        fallback.hold();
        return;
      }
      request({ type: 'target', alphaTarget: HOLD_TARGET });
      held = true;
    },
    release: () => {
      if (fallback) {
        fallback.release();
        return;
      }
      request({ type: 'target', alphaTarget: 0 });
      held = false;
    },
    pin: (node, x, y) => {
      if (fallback) {
        fallback.pin(node, x, y);
        return;
      }
      const index = indexOf.get(node);
      if (index !== undefined) {
        request({ type: 'pin', index, x, y });
        pinned = { node, x, y };
      }
    },
    unpin: (node) => {
      if (fallback) {
        fallback.unpin(node);
        return;
      }
      const index = indexOf.get(node);
      if (index !== undefined) {
        request({ type: 'unpin', index });
      }
      if (pinned?.node === node) {
        pinned = null;
      }
    },
    destroy: () => {
      destroyed = true;
      fallback?.destroy();
      cancelSleep();
      worker?.postMessage({ type: 'stop' }, []);
      retire();
    },
  };
}
