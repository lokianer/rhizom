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
  /** Folders opened in the file tree, as vault paths. */
  expandedFolders: string[];
  clusterBy: ClusterBy;
  graphLayout: GraphLayout;
  /**
   * Vault path of the `type: axes` note the milieu field is drawn from, or null for whichever
   * the vault lists first. Remembered, but never trusted: the field is only drawn from it while
   * the vault still lists that note, so a field somebody deleted cannot strand them in an empty
   * view they have no control to get out of.
   */
  milieuPath: string | null;
  /** 0 shows the whole vault; 1–3 show the neighbourhood of the open note. */
  graphDepth: number;
  /** Tags the graph is filtered by; empty means every note. */
  graphTags: string[];
  paletteOpen: boolean;
  /**
   * Bumped whenever something asks for the open note to be renamed. A counter rather than a
   * flag: the note page owns the dialog, and two requests in a row have to reach it as two.
   */
  renameRequest: number;
  setTheme: (theme: ThemeChoice) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  toggleSplitView: () => void;
  toggleZen: () => void;
  leaveZen: () => void;
  toggleVimMode: () => void;
  toggleFolder: (path: string) => void;
  expandFolders: (paths: readonly string[]) => void;
  setClusterBy: (clusterBy: ClusterBy) => void;
  setGraphLayout: (layout: GraphLayout) => void;
  setMilieuPath: (path: string) => void;
  setGraphDepth: (depth: number) => void;
  toggleGraphTag: (tag: string) => void;
  clearGraphTags: () => void;
  setPaletteOpen: (open: boolean) => void;
  requestRename: () => void;
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
      expandedFolders: [],
      clusterBy: 'folder',
      graphLayout: 'bubbles',
      milieuPath: null,
      graphDepth: 0,
      graphTags: [],
      paletteOpen: false,
      renameRequest: 0,
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
      setClusterBy: (clusterBy) => {
        set({ clusterBy });
      },
      setGraphLayout: (graphLayout) => {
        set({ graphLayout });
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
      setPaletteOpen: (paletteOpen) => {
        set({ paletteOpen });
      },
      requestRename: () => {
        set((state) => ({ renameRequest: state.renameRequest + 1 }));
      },
    }),
    {
      name: 'rhizom.ui',
      version: 1,
      // The open palette and the sidebar tab are per-visit; the rest is worth remembering.
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        splitView: state.splitView,
        vimMode: state.vimMode,
        expandedFolders: state.expandedFolders,
        clusterBy: state.clusterBy,
        graphLayout: state.graphLayout,
        milieuPath: state.milieuPath,
        graphDepth: state.graphDepth,
      }),
    },
  ),
);
