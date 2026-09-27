import { describe, expect, it, vi } from 'vitest';

import type { HoverInfo } from './controller.js';
import { createHoverStore } from './hover-store.js';

const note: HoverInfo = {
  path: 'a.md',
  name: 'a',
  folder: '',
  cluster: '',
  slot: 0,
  inDegree: 1,
  outDegree: 2,
  rank: 1,
  total: 3,
};

describe('createHoverStore', () => {
  it('tells its listeners when the note changes, and only then', () => {
    const store = createHoverStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(note);
    store.set(note);
    store.set(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toBeNull();
  });

  it('stops telling a listener that unsubscribed', () => {
    const store = createHoverStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(note);
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe(note);
  });
});
