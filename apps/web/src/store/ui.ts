// Interface state: what the person chose, not what the server knows. The parts worth keeping
// between visits go to localStorage; everything else starts fresh.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeChoice = 'humus' | 'kalk' | 'system';
export type SidebarTab = 'tree' | 'search' | 'tags' | 'outline';
export type ClusterBy = 'folder' | 'tag';
/** The two ways the graph page draws a vault: the force-directed bubbles, or a milieu field. */
export type GraphLayout = 'bubbles' | 'milieu';

export interface UiState {
  theme: ThemeChoice;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  /** Show the rendered note next to the editor. */
  splitView: boolean;
  /**
   * Nothing but the text: no header, no sidebar, none of the shelves under the editor. Not
   * remembered between visits, unlike the rest of this — coming back to an application with no
   * interface and no memory of having asked for that is a bad morning.
   */
  zen: boolean;
  /**
   * Vim keybindings in the editor. Remembered, unlike zen: this one is about how a person
   * types, and someone who uses Vim uses it tomorrow as well.
   */
  vimMode: boolean;
  clusterBy: ClusterBy;
  graphLayout: GraphLayout;
  paletteOpen: boolean;
  /**
   * Bumped whenever something asks for the open note to be renamed. A counter rather than a
   * flag: the note page owns the dialog, and two requests in a row have to reach it as two.
   */
  renameRequest: number;
  /**
   * Bumped whenever something asks for a link to the block the cursor stands in. A counter for
   * the same reason the rename is one — only the open editor knows where the cursor is, and two
   * requests in a row have to reach it as two.
   */
  blockLinkRequest: number;
  setTheme: (theme: ThemeChoice) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  toggleSplitView: () => void;
  toggleZen: () => void;
  leaveZen: () => void;
  toggleVimMode: () => void;
  setClusterBy: (clusterBy: ClusterBy) => void;
  setGraphLayout: (layout: GraphLayout) => void;
  setPaletteOpen: (open: boolean) => void;
  requestRename: () => void;
  requestBlockLink: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'humus',
      sidebarTab: 'tree',
      sidebarOpen: true,
      splitView: false,
      zen: false,
      vimMode: false,
      clusterBy: 'folder',
      graphLayout: 'bubbles',
      paletteOpen: false,
      renameRequest: 0,
      blockLinkRequest: 0,
      setTheme: (theme) => {
        set({ theme });
      },
      setSidebarTab: (sidebarTab) => {
        set({ sidebarTab, sidebarOpen: true });
      },
      toggleSidebar: () => {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }));
      },
      toggleSplitView: () => {
        set((state) => ({ splitView: !state.splitView }));
      },
      toggleZen: () => {
        set((state) => ({ zen: !state.zen }));
      },
      leaveZen: () => {
        set({ zen: false });
      },
      toggleVimMode: () => {
        set((state) => ({ vimMode: !state.vimMode }));
      },
      setClusterBy: (clusterBy) => {
        set({ clusterBy });
      },
      setGraphLayout: (graphLayout) => {
        set({ graphLayout });
      },
      setPaletteOpen: (paletteOpen) => {
        set({ paletteOpen });
      },
      requestRename: () => {
        set((state) => ({ renameRequest: state.renameRequest + 1 }));
      },
      requestBlockLink: () => {
        set((state) => ({ blockLinkRequest: state.blockLinkRequest + 1 }));
      },
    }),
    {
      name: 'rhizom.ui',
      // Version 2 moved the open folders, the milieu field and the graph depth to vault-ui.ts,
      // one store per vault. What an older version saved of them is dropped on the next write.
      version: 2,
      migrate: (persisted) => persisted as UiState,
      // The open palette and the sidebar tab are per-visit; the rest is worth remembering.
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        splitView: state.splitView,
        vimMode: state.vimMode,
        clusterBy: state.clusterBy,
        graphLayout: state.graphLayout,
      }),
    },
  ),
);
