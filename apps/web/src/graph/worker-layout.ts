// The same field simulation, computed in a worker. The page keeps the nodes it draws and
// hit-tests; the worker owns the physics and sends positions back.
import type { GraphData } from '@rhizom/core';

import { applyPositions, toLayoutPayload } from './layout-model.js';
import type { LayoutRequest, LayoutResponse } from './layout.worker.js';
import {
  buildField,
  type FieldSimulation,
  type SimLink,
  type SimNode,
  type SimulationEvents,
} from './simulation.js';

/**
 * Returns null where workers are unavailable, so the caller can fall back to the layout on the
 * main thread rather than showing nothing.
 */
export function createWorkerLayout(events: SimulationEvents): FieldSimulation | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  let nodes: readonly SimNode[] = [];
  let links: readonly SimLink[] = [];
  const indexOf = new Map<SimNode, number>();
  let settled = true;

  const send = (request: LayoutRequest, transfer: Transferable[] = []): void => {
    worker.postMessage(request, transfer);
  };

  worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
    applyPositions(nodes, event.data.positions);
    events.onTick();
    if (event.data.settled && !settled) {
      settled = true;
      events.onEnd();
    }
  };

  return {
    nodes: () => nodes,
    links: () => links,
    setData: (data: GraphData) => {
      const field = buildField(nodes, data);
      nodes = field.nodes;
      links = field.links;
      indexOf.clear();
      nodes.forEach((node, index) => {
        indexOf.set(node, index);
      });
      const payload = toLayoutPayload(nodes, links);
      settled = false;
      send({ type: 'data', alpha: 1, ...payload }, [
        payload.degrees.buffer,
        payload.radii.buffer,
        payload.positions.buffer,
        // edges is a subarray: its buffer may be larger than the view, which transfers fine.
        payload.edges.buffer,
      ]);
    },
    reheat: (alpha = 0.3) => {
      settled = false;
      send({ type: 'alpha', alpha });
    },
    hold: () => {
      settled = false;
      send({ type: 'target', alphaTarget: 0.3 });
    },
    release: () => {
      send({ type: 'target', alphaTarget: 0 });
    },
    pin: (node, x, y) => {
      const index = indexOf.get(node);
      if (index !== undefined) {
        send({ type: 'pin', index, x, y });
      }
    },
    unpin: (node) => {
      const index = indexOf.get(node);
      if (index !== undefined) {
        send({ type: 'unpin', index });
      }
    },
    destroy: () => {
      send({ type: 'stop' });
      worker.terminate();
    },
  };
}
