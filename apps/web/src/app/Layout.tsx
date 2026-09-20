// The frame around every view: header, the sidebar with its three panels, and the command
// palette. Everything that needs the whole app (theme, shortcuts, note creation) lives here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { api } from '../api/client.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { NewNoteDialog } from '../components/NewNoteDialog.js';
import { ThemeSwitch } from '../components/ThemeSwitch.js';
import { CommandPalette, type PaletteCommand } from '../palette/index.js';
import { FileTree, SearchPanel, SmartFolders, TagList } from '../panels/index.js';
import { useUiStore } from '../store/ui.js';
import { useVaultStore } from '../store/vault.js';
import { noteHref, notePathFromLocation } from './paths.js';
import { applyTheme } from './theme.js';
import { useIndexEvents } from './useIndexEvents.js';

/** The modifier the shortcuts use, Command on Apple systems and Control everywhere else. */
function modifierLabel(): string {
  return navigator.platform.startsWith('Mac') || navigator.platform === 'iPhone' ? '⌘' : 'Ctrl';
}

export function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const openNotePath = notePathFromLocation(location.pathname);

  const status = useVaultStore((state) => state.status);
  const error = useVaultStore((state) => state.error);
  const noVault = useVaultStore((state) => state.noVault);
  const info = useVaultStore((state) => state.info);
  const notes = useVaultStore((state) => state.notes);
  const tree = useVaultStore((state) => state.tree);
  const tags = useVaultStore((state) => state.tags);
  const load = useVaultStore((state) => state.load);
  const refresh = useVaultStore((state) => state.refresh);

  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const toggleSplitView = useUiStore((state) => state.toggleSplitView);
  const sidebarTab = useUiStore((state) => state.sidebarTab);
  const setSidebarTab = useUiStore((state) => state.setSidebarTab);
  const graphTags = useUiStore((state) => state.graphTags);
  const toggleGraphTag = useUiStore((state) => state.toggleGraphTag);
  const paletteOpen = useUiStore((state) => state.paletteOpen);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const requestRename = useUiStore((state) => state.requestRename);

  const revisions = useIndexEvents();
  const [newNoteFolder, setNewNoteFolder] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const openNote = useCallback(
    (path: string) => {
      void navigate(noteHref(path));
    },
    [navigate],
  );

  const createNote = useCallback(
    async (path: string) => {
      setNewNoteFolder(null);
      const created = await api.createNote({ path });
      await refresh();
      void navigate(noteHref(created.path));
    },
    [navigate, refresh],
  );

  const commands = useMemo<PaletteCommand[]>(
    () => [
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
        id: 'rebuild',
        label: t('palette.commandNames.rebuild'),
        run: () => {
          void api.rebuildIndex().then(() => refresh());
        },
      },
    ],
    [
      navigate,
      openNotePath,
      refresh,
      requestRename,
      setSidebarTab,
      setTheme,
      t,
      theme,
      toggleSidebar,
      toggleSplitView,
    ],
  );

  // Ctrl/Cmd+P opens the palette. Captured on the window so it wins over the editor's keymap.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'p' || event.repeat || event.isComposing) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.altKey) {
        return;
      }
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [setPaletteOpen]);

  const isGraph = location.pathname.startsWith('/graph');

  return (
    <div className={`rz-app${sidebarOpen ? '' : ' rz-app-collapsed'}`}>
      <a className="rz-skip" href="#rz-main">
        {t('app.skipToContent')}
      </a>

      <header className="rz-header">
        <button type="button" className="rz-icon-button" onClick={toggleSidebar}>
          {t('sidebar.toggle')}
        </button>
        <NavLink to="/" className="rz-brand">
          {info?.name ?? t('app.name')}
        </NavLink>
        <nav className="rz-nav">
          <NavLink
            to={
              openNotePath === null ? '/graph' : `/graph?note=${encodeURIComponent(openNotePath)}`
            }
            className={isGraph ? 'active' : ''}
          >
            {t('graph.title')}
          </NavLink>
          <NavLink to="/glossary" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('glossary.title')}
          </NavLink>
          {openNotePath === null ? null : (
            <NavLink to={noteHref(openNotePath, 'wiki')}>{t('wiki.title')}</NavLink>
          )}
        </nav>
        <button
          type="button"
          className="rz-palette-button"
          onClick={() => {
            setPaletteOpen(true);
          }}
        >
          {t('palette.open')} <kbd>{modifierLabel()}+P</kbd>
        </button>
        <ThemeSwitch />
        <LanguageSwitch />
      </header>

      {sidebarOpen ? (
        <aside className="rz-sidebar">
          <div className="rz-tabs" role="tablist" aria-label={t('sidebar.toggle')}>
            {(['tree', 'search', 'tags'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={sidebarTab === tab}
                onClick={() => {
                  setSidebarTab(tab);
                }}
              >
                {t(
                  tab === 'tree'
                    ? 'sidebar.files'
                    : tab === 'search'
                      ? 'sidebar.search'
                      : 'sidebar.tags',
                )}
              </button>
            ))}
          </div>

          {sidebarTab === 'tree' ? (
            <>
              {/* Above the tree, and nothing at all in a vault that saves no searches. */}
              <SmartFolders activePath={openNotePath} onOpen={openNote} />
              <FileTree
                tree={tree}
                activePath={openNotePath}
                onOpen={openNote}
                onCreate={setNewNoteFolder}
              />
            </>
          ) : null}
          {sidebarTab === 'search' ? (
            <SearchPanel activePath={openNotePath} onOpen={openNote} />
          ) : null}
          {sidebarTab === 'tags' ? (
            <TagList tags={tags} selected={graphTags} onToggle={toggleGraphTag} />
          ) : null}
        </aside>
      ) : null}

      <main id="rz-main" className="rz-main">
        {status === 'error' ? (
          <div className="rz-page rz-error">
            <p>{noVault ? t('status.noVault') : t('status.error', { message: error ?? '' })}</p>
            <button
              type="button"
              onClick={() => {
                void load();
              }}
            >
              {t('status.retry')}
            </button>
          </div>
        ) : (
          <Outlet context={{ revisions }} />
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
        notes={notes}
        commands={commands}
        onOpenNote={openNote}
      />

      <NewNoteDialog
        folder={newNoteFolder}
        onCancel={() => {
          setNewNoteFolder(null);
        }}
        onCreate={(path) => {
          void createNote(path);
        }}
      />
    </div>
  );
}
