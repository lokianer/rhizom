// The command palette's entries. Lifted out of Layout because the list is long and flat and
// reads as a table of contents for the app: every command the palette offers, in the order it
// offers them. What each command needs is handed in rather than closed over, so the list can be
// read - and a command added to it - without the component around it.
import type { DailySettings, NoteSummary } from '@rhizom/core';
import type { TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router';

import { api } from '../../api/client.js';
import type { PaletteCommand } from '../../palette/index.js';
import type { SidebarTab, ThemeChoice } from '../../store/ui.js';
import { randomNotePath } from './commands-model.js';
import { noteHref } from '../../routing/paths.js';

/** Everything the commands reach for. One field per value the list used to close over. */
export interface CommandContext {
  daily: DailySettings | undefined;
  setNewNoteFolder: (folder: string | null) => void;
  duplicateNote: () => Promise<void>;
  navigate: NavigateFunction;
  notes: NoteSummary[];
  openNote: (path: string, fragment?: string) => void;
  openNotePath: string | null;
  openToday: () => Promise<void>;
  refresh: () => Promise<void>;
  requestBlockLink: () => void;
  requestRename: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setTheme: (theme: ThemeChoice) => void;
  t: TFunction;
  theme: ThemeChoice;
  toggleSidebar: () => void;
  toggleSplitView: () => void;
  toggleVimMode: () => void;
  toggleZen: () => void;
}

export function paletteCommands({
  daily,
  setNewNoteFolder,
  duplicateNote,
  navigate,
  notes,
  openNote,
  openNotePath,
  openToday,
  refresh,
  requestBlockLink,
  requestRename,
  setSidebarTab,
  setTheme,
  t,
  theme,
  toggleSidebar,
  toggleSplitView,
  toggleVimMode,
  toggleZen,
}: CommandContext): PaletteCommand[] {
  return [
    {
      id: 'newNote',
      label: t('palette.commandNames.newNote'),
      run: () => {
        setNewNoteFolder('');
      },
    },
    {
      id: 'toggleTheme',
      label: t('palette.commandNames.toggleTheme'),
      run: () => {
        setTheme(theme === 'kalk' ? 'humus' : 'kalk');
      },
    },
    {
      id: 'openGraph',
      label: t('palette.commandNames.openGraph'),
      run: () => {
        void navigate(
          openNotePath === null ? '/graph' : `/graph?note=${encodeURIComponent(openNotePath)}`,
        );
      },
    },
    {
      id: 'openGlossary',
      label: t('palette.commandNames.openGlossary'),
      run: () => {
        void navigate('/glossary');
      },
    },
    {
      id: 'openWiki',
      label: t('palette.commandNames.openWiki'),
      run: () => {
        if (openNotePath !== null) {
          void navigate(noteHref(openNotePath, 'wiki'));
        }
      },
    },
    ...(daily?.folder === undefined || daily.folder === null
      ? []
      : [
          {
            id: 'openToday',
            label: t('palette.commandNames.openToday'),
            run: () => {
              void openToday();
            },
          },
        ]),
    // Nothing to open at random in a vault with no notes in it.
    ...(notes.length === 0
      ? []
      : [
          {
            id: 'randomNote',
            label: t('palette.commandNames.randomNote'),
            run: () => {
              const path = randomNotePath(notes, openNotePath);
              if (path !== null) {
                openNote(path);
              }
            },
          },
        ]),
    // Only with a note open: there is nothing to copy otherwise.
    ...(openNotePath === null
      ? []
      : [
          {
            id: 'duplicateNote',
            label: t('palette.commandNames.duplicateNote'),
            run: () => {
              void duplicateNote();
            },
          },
          {
            id: 'copyBlockLink',
            label: t('palette.commandNames.copyBlockLink'),
            // Like the rename: only the open editor knows where the cursor is, so all this
            // does is ask, and the editor answers with the key's own command.
            run: requestBlockLink,
          },
        ]),
    {
      id: 'renameNote',
      label: t('palette.commandNames.renameNote'),
      // The dialog belongs to the note page, which is the only place that can see whether
      // anything is still unsaved; all this does is ask for it.
      run: () => {
        if (openNotePath !== null) {
          requestRename();
        }
      },
    },
    {
      id: 'search',
      label: t('palette.commandNames.search'),
      run: () => {
        setSidebarTab('search');
      },
    },
    {
      id: 'openOutline',
      label: t('palette.commandNames.openOutline'),
      run: () => {
        setSidebarTab('outline');
      },
    },
    {
      id: 'toggleSidebar',
      label: t('palette.commandNames.toggleSidebar'),
      run: toggleSidebar,
    },
    {
      id: 'togglePreview',
      label: t('palette.commandNames.togglePreview'),
      run: toggleSplitView,
    },
    {
      id: 'toggleZen',
      label: t('palette.commandNames.toggleZen'),
      run: toggleZen,
    },
    {
      id: 'toggleVim',
      label: t('palette.commandNames.toggleVim'),
      // The editor fetches the keymap itself the first time this is asked for; whoever never
      // asks never downloads it.
      run: toggleVimMode,
    },
    {
      id: 'rebuild',
      label: t('palette.commandNames.rebuild'),
      run: () => {
        void api.rebuildIndex().then(() => refresh());
      },
    },
  ];
}
