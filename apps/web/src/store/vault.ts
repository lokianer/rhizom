// What the server knows about the vault: the note list, the folder tree and the tags. One
// store for the whole app, reloaded when the index reports a change.
import type { NoteSummary, TagCount, TreeEntry, VaultInfo } from '@rhizom/core';
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
  /** Loads everything; shows the loading state on the first call. */
  load: () => Promise<void>;
  /** Reloads in the background, for index events. */
  refresh: () => Promise<void>;
}

async function fetchAll(): Promise<Pick<VaultState, 'info' | 'notes' | 'tree' | 'tags'>> {
  const [info, notes, tree, tags] = await Promise.all([
    api.vault(),
    api.notes(),
    api.tree(),
    api.tags(),
  ]);
  return { info, notes, tree, tags };
}

export const useVaultStore = create<VaultState>()((set, get) => ({
  status: 'idle',
  error: null,
  noVault: false,
  info: null,
  notes: [],
  tree: [],
  tags: [],
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
      set({ ...(await fetchAll()), status: 'ready', error: null, noVault: false });
    } catch {
      // A failed background refresh keeps the previous data; the next event tries again.
    }
  },
}));
