// The text of notes other than the one on screen, so a `![[Note]]` can show what it embeds.
//
// Deliberately not part of the vault store: that one reloads its whole `Promise.all` on every
// index event, i.e. after every autosave, and an embed needs one note rather than the list of
// all of them. Here a note is fetched once, kept, and dropped again when the index says it
// changed.
import type { Heading } from '@rhizom/core';
import { create } from 'zustand';

import { api, ApiRequestError } from '../api/client.js';

export interface NoteSource {
  content: string;
  headings: Heading[];
}

interface NoteSourceState {
  sources: Record<string, NoteSource>;
  /** Fetches a note unless it is already here or already on its way. */
  request: (path: string) => void;
  /** Forgets the given notes, or all of them after a rebuild. */
  invalidate: (paths: readonly string[] | null) => void;
}

const inFlight = new Set<string>();
// A note the index still lists but the server answers 404 for: the vault changed underneath us.
// Not retried, or a render that asks for it again would fetch in a loop. The removal event that
// follows clears this, and the link then resolves to nothing, which the reader can see. Any
// other failure — a restarted server, a dropped connection — stays retryable.
const gone = new Set<string>();

// What a note looked like when a request for it started. A response that comes back after the
// index said that note changed describes the old file, and must not be kept: `request` would
// then never ask again.
const generation = new Map<string, number>();
let rebuilds = 0;

function stampOf(path: string): string {
  return `${String(rebuilds)}:${String(generation.get(path) ?? 0)}`;
}

export const useNoteSources = create<NoteSourceState>()((set, get) => ({
  sources: {},
  request: (path) => {
    if (inFlight.has(path) || gone.has(path) || get().sources[path] !== undefined) {
      return;
    }
    inFlight.add(path);
    const started = stampOf(path);
    api
      .note(path)
      .then((doc) => {
        if (stampOf(path) !== started) {
          return;
        }
        set((state) => ({
          sources: {
            ...state.sources,
            [path]: { content: doc.content, headings: doc.headings },
          },
        }));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && error.status === 404) {
          gone.add(path);
        }
      })
      .finally(() => {
        inFlight.delete(path);
      });
  },
  invalidate: (paths) => {
    if (paths === null) {
      rebuilds += 1;
      gone.clear();
      set({ sources: {} });
      return;
    }
    for (const path of paths) {
      generation.set(path, (generation.get(path) ?? 0) + 1);
      gone.delete(path);
    }
    set((state) => {
      const next = { ...state.sources };
      let changed = false;
      for (const path of paths) {
        if (next[path] !== undefined) {
          delete next[path];
          changed = true;
        }
      }
      return changed ? { sources: next } : state;
    });
  },
}));
