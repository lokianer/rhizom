// What the server knows about the vault: the note list, the folder tree and the tags. One
// store for the whole app, reloaded when the index reports a change.
import type {
  AssetSummary,
  NoteIndex,
  NoteSummary,
  TagCount,
  TreeEntry,
  VaultInfo,
  VaultTerm,
} from '@rhizom/core';
import { glossaryTerms } from '@rhizom/core';
import { create } from 'zustand';

import { api, ApiRequestError, isAbortError } from '../api/client.js';
import { buildNoteIndex } from '../routing/links.js';

export type VaultStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface VaultState {
  status: VaultStatus;
  error: string | null;
  /** The server runs, but no vault is configured. */
  noVault: boolean;
  info: VaultInfo | null;
  notes: NoteSummary[];
  /**
   * The notes as a link resolver needs them: every path and the aliases it answers to. One for
   * the whole app, and a new one only when a path or an alias changed. A save changes neither —
   * only times, sizes and link counts — and every page that resolves links used to build its
   * own from `notes` after each save, which on a large vault was the costly part of a reload.
   */
  noteIndex: NoteIndex;
  tree: TreeEntry[];
  tags: TagCount[];
  /** Everything in the vault that is not a note, so embeds can find their file. */
  assets: AssetSummary[];
  /** Every term a definition note declares, for marking them where they are mentioned. */
  terms: VaultTerm[];
  /** Loads everything; shows the loading state on the first call. */
  load: () => Promise<void>;
  /** Reloads in the background, for index events. */
  refresh: () => Promise<void>;
}

async function fetchAll(): Promise<
  Pick<VaultState, 'info' | 'notes' | 'tree' | 'tags' | 'assets' | 'terms'>
> {
  const [info, notes, tree, tags, assets, glossary] = await Promise.all([
    api.vault(),
    api.notes(),
    api.tree(),
    api.tags(),
    api.assets(),
    api.glossary(),
  ]);
  return { info, notes, tree, tags, assets, terms: glossaryTerms(glossary) };
}

/**
 * Keeps the previous array when the server sent the same terms again. The store reloads after
 * every save, and a new array identity would rebuild the term matcher, reconfigure the editor's
 * facet and with it every decoration layer — for a list that did not change. Comparing a few
 * hundred terms costs nothing next to that.
 */
function keepTerms(previous: VaultTerm[], next: VaultTerm[]): VaultTerm[] {
  return signatureOf(previous) === signatureOf(next) ? previous : next;
}

// Unit and record separators: characters no path, term or summary can hold, so two different
// lists cannot produce the same signature. `vault-index.ts` joins its tags the same way.
const FIELD = String.fromCharCode(31);
const RECORD = String.fromCharCode(30);

function signatureOf(terms: readonly VaultTerm[]): string {
  return terms
    .map((term) => [term.path, term.surface, String(term.alias), term.summary].join(FIELD))
    .join(RECORD);
}

/**
 * Everything a NoteIndex is built from, and nothing else: paths and aliases, in order. JSON
 * rather than the separators above, because an alias is whatever the frontmatter says and YAML
 * can spell any character, those two included.
 */
function namesOf(notes: readonly NoteSummary[]): string {
  return JSON.stringify(notes.map((note) => [note.path, note.aliases]));
}

/** The names each index was built from, so a refresh serialises the new list only. */
const indexedNames = new WeakMap<NoteIndex, string>();

/** The previous index while the names it was built from are the same; a new one otherwise. */
function keepNoteIndex(
  previous: { noteIndex: NoteIndex },
  next: readonly NoteSummary[],
): NoteIndex {
  const names = namesOf(next);
  if (indexedNames.get(previous.noteIndex) === names) {
    return previous.noteIndex;
  }
  const index = buildNoteIndex(next);
  indexedNames.set(index, names);
  return index;
}

let refreshesStarted = 0;
/** The newest reload whose result is in the store; an older one that finishes later is dropped. */
let refreshApplied = 0;

/**
 * How many background reloads have begun so far. A caller that notes the number before a
 * request can tell afterwards whether the store has started reloading in the meantime — which
 * after a save it usually has, because the save's own index event arrives before its answer.
 */
export function refreshCount(): number {
  return refreshesStarted;
}

export const useVaultStore = create<VaultState>()((set, get) => ({
  status: 'idle',
  error: null,
  noVault: false,
  info: null,
  notes: [],
  noteIndex: buildNoteIndex([]),
  tree: [],
  tags: [],
  assets: [],
  terms: [],
  load: async () => {
    if (get().status === 'loading') {
      return;
    }
    set({ status: 'loading', error: null, noVault: false });
    try {
      const loaded = await fetchAll();
      set((state) => ({
        ...loaded,
        noteIndex: keepNoteIndex(state, loaded.notes),
        status: 'ready',
        error: null,
        noVault: false,
      }));
    } catch (error) {
      if (!isAbortError(error)) {
        set({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          noVault: error instanceof ApiRequestError && error.status === 503,
        });
      }
    }
  },
  refresh: async () => {
    refreshesStarted += 1;
    const started = refreshesStarted;
    try {
      const loaded = await fetchAll();
      // Reloads can overlap, and they finish in whatever order the network allows. A save no
      // longer runs a reload of its own after the answer, which used to paper over that, so the
      // newest one started wins and an older one arriving late is dropped.
      if (started < refreshApplied) {
        return;
      }
      refreshApplied = started;
      set((state) => ({
        ...loaded,
        noteIndex: keepNoteIndex(state, loaded.notes),
        terms: keepTerms(state.terms, loaded.terms),
        status: 'ready',
        error: null,
        noVault: false,
      }));
    } catch {
      // A failed background refresh keeps the previous data; the next event tries again.
    }
  },
}));
