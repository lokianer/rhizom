// What the server knows about the vault: the note list, the folder tree and the tags. One
// store for the whole app, reloaded when the index reports a change.
import type {
  AssetSummary,
  NoteSummary,
  TagCount,
  TreeEntry,
  VaultInfo,
  VaultTerm,
} from '@rhizom/core';
import { glossaryTerms } from '@rhizom/core';
import { create } from 'zustand';

import { api, ApiRequestError, isAbortError } from '../api/client.js';

export type VaultStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface VaultState {
  status: VaultStatus;
  error: string | null;
  /** The server runs, but no vault is configured. */
  noVault: boolean;
  info: VaultInfo | null;
  notes: NoteSummary[];
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

export const useVaultStore = create<VaultState>()((set, get) => ({
  status: 'idle',
  error: null,
  noVault: false,
  info: null,
  notes: [],
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
      set({ ...(await fetchAll()), status: 'ready', error: null, noVault: false });
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
    try {
      const loaded = await fetchAll();
      set((state) => ({
        ...loaded,
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
