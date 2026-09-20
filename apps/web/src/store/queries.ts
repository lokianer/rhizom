// The answers to the query blocks on screen, keyed by the text between the fences.
//
// The body is the key because it is the question: two notes asking the same thing get one answer,
// and a block that has not changed keeps the answer it already has while a neighbour fetches its
// own. That matters most in the editor, whose preview renders on every keystroke — a half-typed
// block is simply a body nobody has asked about yet, so nothing that is already on screen is
// thrown away on the way to the next character.
//
// Deliberately not part of the vault store: that one reloads the whole note list after every
// autosave, and a query is one question rather than the list of all notes.
import type { QueryResult } from '@rhizom/core';
import { create } from 'zustand';

import { api } from '../api/client.js';

/** What became of one block: the answer, or the reason there is none. */
export type QueryAnswer =
  { state: 'ready'; result: QueryResult } | { state: 'failed'; message: string };

interface QueryState {
  results: Record<string, QueryAnswer>;
  /** Asks the index about a body unless it is already answered or already on its way. */
  request: (body: string) => void;
  /** Forgets every answer, because the vault they described has changed. */
  invalidate: () => void;
}

const inFlight = new Set<string>();

// Answers given before the index changed describe a vault that is no longer there. The counter
// rises with every invalidation; a response that started under an older one is dropped rather
// than stored, or `request` would never ask about that body again.
let generation = 0;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useQueryResults = create<QueryState>()((set, get) => ({
  results: {},
  request: (body) => {
    if (inFlight.has(body) || get().results[body] !== undefined) {
      return;
    }
    inFlight.add(body);
    const started = generation;
    const keep = (answer: QueryAnswer) => {
      if (started === generation) {
        set((state) => ({ results: { ...state.results, [body]: answer } }));
      }
    };
    api
      .runQuery(body)
      .then((result) => {
        keep({ state: 'ready', result });
      })
      .catch((error: unknown) => {
        // A failure is kept, not retried. The renderer asks about every block it draws, and it
        // draws on every keystroke; a query the server cannot answer would otherwise be sent
        // once per character for as long as the note stays open. The reader is told instead,
        // and the next index event clears the slate.
        keep({ state: 'failed', message: messageOf(error) });
      })
      .finally(() => {
        inFlight.delete(body);
      });
  },
  invalidate: () => {
    generation += 1;
    set({ results: {} });
  },
}));
