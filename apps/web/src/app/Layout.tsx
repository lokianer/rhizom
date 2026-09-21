// The frame around every view: header, the sidebar with its four panels, and the command
// palette. Everything that needs the whole app (theme, shortcuts, note creation) lives here.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { api } from '../api/client.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { NewNoteDialog } from '../components/NewNoteDialog.js';
import { TagRenameDialog } from '../components/TagRenameDialog.js';
import { ThemeSwitch } from '../components/ThemeSwitch.js';
// Straight from the module, not through the editor's barrel: that barrel reaches MarkdownEditor,
// whose stylesheet import makes it a side effect no bundler may drop, and the frame would carry
// all of CodeMirror for the sake of one filter.
import { CommandPalette, type PaletteCommand } from '../palette/index.js';
import { FileTree, OutlinePanel, SearchPanel, SmartFolders, TagList } from '../panels/index.js';
import { useUiStore } from '../store/ui.js';
import { useVaultStore } from '../store/vault.js';
import { paletteCommands } from './layout/commands.js';
import { modifierLabel, SIDEBAR_TABS } from './layout/tabs.js';
import { useNoteCommands } from './layout/useNoteCommands.js';
import { noteHref, notePathFromLocation } from '../routing/paths.js';
import { applyTheme } from './theme.js';
import { revisionOf, useIndexEvents } from './useIndexEvents.js';

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
  const zen = useUiStore((state) => state.zen);
  const toggleZen = useUiStore((state) => state.toggleZen);
  const vimMode = useUiStore((state) => state.vimMode);
  const toggleVimMode = useUiStore((state) => state.toggleVimMode);
  const leaveZen = useUiStore((state) => state.leaveZen);
  const sidebarTab = useUiStore((state) => state.sidebarTab);
  const setSidebarTab = useUiStore((state) => state.setSidebarTab);
  const graphTags = useUiStore((state) => state.graphTags);
  const toggleGraphTag = useUiStore((state) => state.toggleGraphTag);
  const paletteOpen = useUiStore((state) => state.paletteOpen);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const requestRename = useUiStore((state) => state.requestRename);
  const requestBlockLink = useUiStore((state) => state.requestBlockLink);
  const daily = useVaultStore((state) => state.info?.daily);

  const revisions = useIndexEvents();
  const [renamingTag, setRenamingTag] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const {
    openNote,
    createNote,
    openToday,
    duplicateNote,
    templateChoices,
    newNoteFolder,
    setNewNoteFolder,
  } = useNoteCommands(openNotePath);

  const commands = useMemo<PaletteCommand[]>(
    () =>
      paletteCommands({
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
      }),
    [
      daily,
      duplicateNote,
      navigate,
      notes,
      openNote,
      openNotePath,
      openToday,
      refresh,
      requestBlockLink,
      requestRename,
      setNewNoteFolder,
      setSidebarTab,
      setTheme,
      t,
      theme,
      toggleSidebar,
      toggleSplitView,
      toggleVimMode,
      toggleZen,
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

  // Escape leaves zen. It is the key every full-screen thing on a computer answers to, and a
  // mode that hid the way out of itself would be a trap; it is only listened for while the mode
  // is on, so nothing else in the app loses an Escape to it.
  useEffect(() => {
    if (!zen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) {
        return;
      }
      // Except in Vim mode, where Escape is how you leave insert mode and so the most pressed
      // key in the editor. Being thrown out of zen on every one of them would make the two
      // modes unusable together; from anywhere else on the page Escape still means "out".
      if (vimMode && event.target instanceof Element && event.target.closest('.cm-editor')) {
        return;
      }
      leaveZen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [leaveZen, vimMode, zen]);

  const isGraph = location.pathname.startsWith('/graph');

  return (
    <div className={`rz-app${sidebarOpen ? '' : ' rz-app-collapsed'}${zen ? ' rz-app-zen' : ''}`}>
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
            {SIDEBAR_TABS.map(({ tab, label }) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={sidebarTab === tab}
                onClick={() => {
                  setSidebarTab(tab);
                }}
              >
                {t(label)}
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
            <TagList
              tags={tags}
              selected={graphTags}
              onToggle={toggleGraphTag}
              onRename={setRenamingTag}
            />
          ) : null}
          {sidebarTab === 'outline' ? (
            <OutlinePanel
              activePath={openNotePath}
              revision={revisionOf(revisions, openNotePath)}
              onOpen={openNote}
            />
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
        templates={templateChoices}
        onCancel={() => {
          setNewNoteFolder(null);
        }}
        onCreate={(path, template) => {
          void createNote(path, template);
        }}
      />

      <TagRenameDialog
        tag={renamingTag}
        onCancel={() => {
          setRenamingTag(null);
        }}
        onConfirm={async (preview) => {
          await api.renameTag({
            from: preview.from,
            to: preview.to,
            files: preview.files.map((file) => ({ source: file.source, hash: file.hash })),
          });
          setRenamingTag(null);
          // The tag chips, the filters and every note that carried the tag come from the index,
          // so one refresh is what puts the new name everywhere it is shown.
          await refresh();
        }}
      />
    </div>
  );
}
