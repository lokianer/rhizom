// What the interface remembers about one vault: which folders are open, which field the milieu
// view draws, how far the graph reaches. Kept per vault, so two vaults never share a tree; the
// `/v/:vault` loader points the store at the right vault before anything reads it.
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export interface VaultUiState {
  /** Folders opened in the file tree, as vault paths. */
  expandedFolders: string[];
  /**
   * Vault path of the `type: axes` note the milieu field is drawn from, or null for whichever
   * the vault lists first. Remembered, but never trusted: the field is only drawn from it while
   * the vault still lists that note, so a field somebody deleted cannot strand them in an empty
   * view they have no control to get out of.
   */
  milieuPath: string | null;
  /** 0 shows the whole vault; 1–3 show the neighbourhood of the open note. */
  graphDepth: number;
  /** Tags the graph is filtered by; empty means every note. Not remembered between visits. */
  graphTags: string[];
  toggleFolder: (path: string) => void;
  expandFolders: (paths: readonly string[]) => void;
  setMilieuPath: (path: string) => void;
  setGraphDepth: (depth: number) => void;
  toggleGraphTag: (tag: string) => void;
  clearGraphTags: () => void;
}

type VaultUiData = Pick<
  VaultUiState,
  'expandedFolders' | 'milieuPath' | 'graphDepth' | 'graphTags'
>;

function fresh(): VaultUiData {
  return { expandedFolders: [], milieuPath: null, graphDepth: 0, graphTags: [] };
}

// localStorage reached on every call rather than once when the module loads: blocked storage
// then costs the memory of open folders, not the store.
const storage: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Full or blocked: the state lives on in memory for this visit.
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // As above.
    }
  },
};

export function vaultUiKey(id: string): string {
  return `rhizom.vault.${id}.ui`;
}

export const useVaultUiStore = create<VaultUiState>()(
  persist(
    (set) => ({
      ...fresh(),
      toggleFolder: (path) => {
        set((state) => ({
          expandedFolders: state.expandedFolders.includes(path)
            ? state.expandedFolders.filter((folder) => folder !== path)
            : [...state.expandedFolders, path],
        }));
      },
      expandFolders: (paths) => {
        set((state) => ({
          expandedFolders: [
            ...state.expandedFolders,
            ...paths.filter((path) => !state.expandedFolders.includes(path)),
          ],
        }));
      },
      setMilieuPath: (milieuPath) => {
        set({ milieuPath });
      },
      setGraphDepth: (graphDepth) => {
        set({ graphDepth });
      },
      toggleGraphTag: (tag) => {
        set((state) => ({
          graphTags: state.graphTags.includes(tag)
            ? state.graphTags.filter((entry) => entry !== tag)
            : [...state.graphTags, tag],
        }));
      },
      clearGraphTags: () => {
        set({ graphTags: [] });
      },
    }),
    {
      name: vaultUiKey('default'),
      version: 1,
      storage: createJSONStorage(() => storage),
      // Read when the loader names the vault, not when the module loads.
      skipHydration: true,
      // A vault starts from nothing plus what it saved itself, never from the vault before it.
      merge: (persisted, current) => ({
        ...current,
        ...fresh(),
        ...(persisted as Partial<VaultUiData> | undefined),
      }),
      partialize: (state) => ({
        expandedFolders: state.expandedFolders,
        milieuPath: state.milieuPath,
        graphDepth: state.graphDepth,
      }),
    },
  ),
);

/** Points the store at another vault's saved state. */
export async function switchVaultUi(id: string): Promise<void> {
  // Not setState(fresh()) first: that would save the empty state under the old vault's key.
  useVaultUiStore.persist.setOptions({ name: vaultUiKey(id) });
  await useVaultUiStore.persist.rehydrate();
}
