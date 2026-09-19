// Keeps the open app in step with the files on disk: the server streams what it re-indexed,
// the vault store reloads, and whoever cares about one note learns that it changed.
import { useEffect, useState } from 'react';

import { subscribeToIndexEvents } from '../api/events.js';
import { useNoteSources } from '../store/notes.js';
import { useVaultStore } from '../store/vault.js';
import type { IndexRevisions } from './outlet.js';

const NOTHING_YET: IndexRevisions = { notes: {}, rebuilds: 0, events: 0 };

/**
 * How often the index has reported each note changed. A count rather than the last event,
 * because one watcher batch can produce two events in the same tick — an `indexed` and a
 * `removed` — and a page holding only the last of them would never hear about the first.
 */
export function useIndexEvents(): IndexRevisions {
  const [revisions, setRevisions] = useState<IndexRevisions>(NOTHING_YET);

  useEffect(() => {
    return subscribeToIndexEvents((event) => {
      setRevisions((previous) => {
        const events = previous.events + 1;
        if (event.type === 'rebuilt') {
          // The per-note counts are kept rather than cleared: a page compares a number with the
          // one it last acted on, and a count that dropped back could land on the same value.
          return { notes: previous.notes, rebuilds: previous.rebuilds + 1, events };
        }
        const notes = { ...previous.notes };
        for (const path of event.paths) {
          notes[path] = (notes[path] ?? 0) + 1;
        }
        return { notes, rebuilds: previous.rebuilds, events };
      });
      void useVaultStore.getState().refresh();
      // A transcluded body has to follow the file it came from, not the note it is shown in.
      useNoteSources.getState().invalidate(event.type === 'rebuilt' ? null : event.paths);
    });
  }, []);

  return revisions;
}

/**
 * A number that changes whenever the index reports that this note changed, and never goes
 * backwards. A page compares it with the one it last acted on rather than reacting to an event,
 * so nothing is missed when two events arrive in one render.
 */
export function revisionOf(revisions: IndexRevisions, path: string | null): number {
  return revisions.rebuilds + (path === null ? 0 : (revisions.notes[path] ?? 0));
}

/**
 * A number that changes whenever the index reports a note *other than this one* changed — the
 * difference between all events and the ones about this note. Both counts only ever rise and
 * rise together for this note, so the difference never goes backwards either.
 *
 * It is what a panel showing other notes should watch: saving the open note fires an event too,
 * and a panel that scans the vault on every keystroke's autosave is a panel nobody can type next
 * to.
 */
export function revisionElsewhere(revisions: IndexRevisions, path: string | null): number {
  return revisions.events - (path === null ? 0 : (revisions.notes[path] ?? 0));
}
