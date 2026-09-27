import type { GraphData } from '@rhizom/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutRequest, LayoutResponse } from './layout.worker.js';
import type { FieldSimulation } from './simulation.js';
import { createWorkerLayout, WORKER_SLEEP_MS, type LayoutWorker } from './worker-layout.js';

/** Where a worker stood when it posted: requests handled, and the data set it was laying out. */
interface Moment {
  handled: number;
  epoch: number;
  nodeCount: number;
}

/** Records what the page sends and answers only when a test says so, like a worker would. */
class FakeWorker implements LayoutWorker {
  onmessage: LayoutWorker['onmessage'] = null;
  onerror: LayoutWorker['onerror'] = null;
  readonly received: LayoutRequest[] = [];
  terminated = false;

  postMessage(message: LayoutRequest): void {
    if (this.terminated) {
      throw new Error('posted to a terminated worker');
    }
    this.received.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** What a worker whose script did not load reports, some time after it was constructed. */
  fail(): void {
    this.onerror?.({} as ErrorEvent);
  }

  /** The worker having handled everything it has been sent. */
  now(): Moment {
    let data: Extract<LayoutRequest, { type: 'data' }> | undefined;
    for (const message of this.received) {
      if (message.type === 'data') {
        data = message;
      }
    }
    return {
      handled: this.received.length,
      epoch: data?.epoch ?? 0,
      nodeCount: data?.degrees.length ?? 0,
    };
  }

  /**
   * Posts positions (every coordinate `fill`) as of a moment: now by default, or one kept from
   * earlier — a message that was on its way while the page sent more.
   */
  answer(settled: boolean, at: Moment = this.now(), fill = 1): void {
    const response: LayoutResponse = {
      type: 'positions',
      positions: new Float32Array(at.nodeCount * 2).fill(fill),
      settled,
      handled: at.handled,
      epoch: at.epoch,
    };
    this.onmessage?.({ data: response } as MessageEvent<LayoutResponse>);
  }
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return item;
}

/** A chain of notes, linked in the order given. */
function graph(...paths: string[]): GraphData {
  return {
    nodes: paths.map((path) => ({
      path,
      name: path,
      folder: '',
      cluster: '',
      degree: 1,
      inDegree: 1,
      outDegree: 1,
    })),
    edges: paths.slice(1).map((target, index) => ({ source: at(paths, index), target, count: 1 })),
    clusters: [''],
  };
}

/** A layout over fake workers; the starts listed in `failing` (1 = the first) throw instead. */
function setup(failing: number[] = []) {
  const workers: FakeWorker[] = [];
  const onTick = vi.fn();
  const onEnd = vi.fn();
  let starts = 0;
  const start = (): FakeWorker => {
    starts += 1;
    if (failing.includes(starts)) {
      throw new Error('workers unavailable');
    }
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  };
  const layout = createWorkerLayout({ onTick, onEnd }, start);
  if (layout === null) {
    throw new Error('expected a worker layout');
  }
  return { layout, workers, onTick, onEnd };
}

/** What the controller does with a new field: send it, then start the layout. */
function load(layout: FieldSimulation, data: GraphData): void {
  layout.setData(data);
  layout.reheat(1);
}

describe('createWorkerLayout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null where no worker can be started', () => {
    const layout = createWorkerLayout({ onTick: vi.fn(), onEnd: vi.fn() }, () => {
      throw new Error('workers unavailable');
    });
    expect(layout).toBeNull();
  });

  it('lets a settled worker sleep and wakes a new one from the current positions', () => {
    const { layout, workers, onEnd } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(false, worker.now(), 7);
    worker.answer(true, worker.now(), 7);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WORKER_SLEEP_MS - 1);
    expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(worker.terminated).toBe(true);

    layout.reheat(0.5);
    const woken = at(workers, 1);
    expect(woken.received.map((message) => message.type)).toEqual(['data', 'alpha']);
    const data = at(woken.received, 0);
    expect(data).toMatchObject({ type: 'data', alpha: 0.5 });
    expect(data.type === 'data' && Array.from(data.positions)).toEqual([7, 7, 7, 7]);
  });

  it('ignores a settle posted before a hold reached the worker, and sleeps after the real one', () => {
    const { layout, workers, onEnd, onTick } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(false);
    // The worker comes to rest and posts; before the page reads it, a drag begins.
    const atRest = worker.now();
    const node = at(layout.nodes(), 0);
    layout.pin(node, 0, 0);
    layout.hold();
    onTick.mockClear();
    worker.answer(true, atRest);
    // Its positions are the current field's and are drawn; its settle is not believed.
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    // The reader holds the bubble still for a while, then drags it and lets go.
    vi.advanceTimersByTime(WORKER_SLEEP_MS * 2);
    expect(worker.terminated).toBe(false);
    layout.pin(node, 5, 5);
    layout.unpin(node);
    layout.release();
    worker.answer(false);
    worker.answer(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WORKER_SLEEP_MS);
    expect(worker.terminated).toBe(true);
    expect(workers).toHaveLength(1);
  });

  it('ignores a settle from an older data set until the new layout settles', () => {
    const { layout, workers, onEnd } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(false);
    const before = worker.now();
    load(layout, graph('a', 'b', 'c'));
    worker.answer(true, before);
    expect(onEnd).not.toHaveBeenCalled();
    for (let second = 0; second < 3; second += 1) {
      vi.advanceTimersByTime(1000);
      worker.answer(false);
    }
    expect(worker.terminated).toBe(false);
    worker.answer(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WORKER_SLEEP_MS);
    expect(worker.terminated).toBe(true);
  });

  it('drops positions laid out for an older data set', () => {
    const { layout, workers, onTick } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(false, worker.now(), 7);
    expect(layout.nodes().map((node) => node.x)).toEqual([7, 7]);
    const before = worker.now();
    // The same notes in another order, and one more: old indices point at other notes now.
    layout.setData(graph('c', 'b', 'a'));
    const sent = layout.positions();
    onTick.mockClear();
    worker.answer(false, before, 99);
    expect(layout.positions()).toBe(sent);
    expect(onTick).not.toHaveBeenCalled();
    expect(layout.nodes().map((node) => node.x)).not.toContain(99);

    worker.answer(false, worker.now(), 3);
    expect(layout.nodes().map((node) => node.x)).toEqual([3, 3, 3]);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('tells a new data set about the drag in progress', () => {
    const { layout, workers } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(true);
    const b = at(layout.nodes(), 1);
    layout.pin(b, 4, 5);
    layout.hold();
    const before = worker.received.length;
    // b moves to index 2.
    layout.setData(graph('c', 'a', 'b'));
    expect(worker.received.slice(before)).toEqual([
      expect.objectContaining({ type: 'data', alpha: 1 }),
      { type: 'target', alphaTarget: 0.3 },
      { type: 'pin', index: 2, x: 4, y: 5 },
    ]);
  });

  it('re-sends a pin kept through the sleep to the woken worker', () => {
    const { layout, workers } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    const b = at(layout.nodes(), 1);
    layout.pin(b, 4, 5);
    worker.answer(true);
    vi.advanceTimersByTime(WORKER_SLEEP_MS);
    expect(worker.terminated).toBe(true);

    layout.reheat(0.5);
    expect(at(workers, 1).received).toEqual([
      expect.objectContaining({ type: 'data', alpha: 0.5 }),
      { type: 'pin', index: 1, x: 4, y: 5 },
      { type: 'alpha', alpha: 0.5 },
    ]);
  });

  it('re-sends the hold and the pin to a worker started after one failed to', () => {
    // The wake-ups for the pin and the hold that begin a drag fail; the next move's succeeds.
    const { layout, workers } = setup([2, 3]);
    load(layout, graph('a', 'b'));
    at(workers, 0).answer(true);
    vi.advanceTimersByTime(WORKER_SLEEP_MS);

    const a = at(layout.nodes(), 0);
    layout.pin(a, 1, 2);
    layout.hold();
    expect(workers).toHaveLength(1);
    layout.pin(a, 3, 4);
    expect(at(workers, 1).received).toEqual([
      expect.objectContaining({ type: 'data', alpha: 0 }),
      { type: 'target', alphaTarget: 0.3 },
      { type: 'pin', index: 0, x: 1, y: 2 },
      { type: 'pin', index: 0, x: 3, y: 4 },
    ]);
  });

  it('keeps the worker of a held bubble even when its layout settles', () => {
    const { layout, workers } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(false);
    const a = at(layout.nodes(), 0);
    layout.pin(a, 0, 0);
    layout.hold();
    worker.answer(true);
    vi.advanceTimersByTime(WORKER_SLEEP_MS * 3);
    expect(worker.terminated).toBe(false);

    layout.unpin(a);
    layout.release();
    worker.answer(true);
    vi.advanceTimersByTime(WORKER_SLEEP_MS);
    expect(worker.terminated).toBe(true);
  });

  it('hands the layout to the main thread when the worker script does not load', () => {
    const { layout, workers, onTick } = setup();
    load(layout, graph('a', 'b', 'c'));
    const worker = at(workers, 0);
    worker.fail();
    expect(worker.terminated).toBe(true);
    vi.advanceTimersByTime(100);
    expect(onTick).toHaveBeenCalled();
    expect(layout.nodes().map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(Array.from(layout.positions()).every(Number.isFinite)).toBe(true);
    // It stays there: nothing starts another worker.
    layout.reheat(0.5);
    layout.setData(graph('a', 'b'));
    expect(workers).toHaveLength(1);
    expect(layout.nodes()).toHaveLength(2);
    layout.destroy();
  });

  it('keeps a worker that errs after it has answered', () => {
    const { layout, workers } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(false);
    worker.fail();
    expect(worker.terminated).toBe(false);
    layout.destroy();
  });

  it('destroy stops the worker, terminates it and clears its timer', () => {
    const { layout, workers, onTick } = setup();
    load(layout, graph('a', 'b'));
    const worker = at(workers, 0);
    worker.answer(true);
    expect(vi.getTimerCount()).toBe(1);

    layout.destroy();
    expect(worker.received.at(-1)).toEqual({ type: 'stop' });
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // Nothing wakes it again.
    onTick.mockClear();
    layout.setData(graph('a', 'b', 'c'));
    layout.reheat();
    layout.hold();
    layout.pin(at(layout.nodes(), 0), 1, 1);
    expect(workers).toHaveLength(1);
    expect(onTick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
