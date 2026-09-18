// Keeps the open app in step with the files on disk: the server streams what it re-indexed,
// the vault store reloads, and whoever cares about one note learns that it changed.
import type { IndexEvent } from '@rhizom/core';
import { useEffect, useState } from 'react';

import { subscribeToIndexEvents } from '../api/events.js';
import { useVaultStore } from '../store/vault.js';

/** The last index event, so a page can react to a change of the note it shows. */
export function useIndexEvents(): IndexEvent | null {
  const [lastEvent, setLastEvent] = useState<IndexEvent | null>(null);

  useEffect(() => {
    return subscribeToIndexEvents((event) => {
      setLastEvent(event);
      void useVaultStore.getState().refresh();
    });
  }, []);

  return lastEvent;
}

/** Whether an event says that this note changed on disk. */
export function eventTouches(event: IndexEvent | null, path: string | null): boolean {
  if (event === null || path === null) {
    return false;
  }
  return event.type === 'rebuilt' || event.paths.includes(path);
}
