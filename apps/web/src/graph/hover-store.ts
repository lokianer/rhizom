// The note under the pointer: written by the controller, read by the info bar alone, so a sweep
// of the pointer across the field renders nothing else again.
import type { HoverInfo } from './controller.js';

/** The note under the pointer, written by the controller and read by the info bar alone. */
export interface HoverStore {
  get: () => HoverInfo | null;
  set: (info: HoverInfo | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createHoverStore(): HoverStore {
  let value: HoverInfo | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (info) => {
      if (info === value) {
        return;
      }
      value = info;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
