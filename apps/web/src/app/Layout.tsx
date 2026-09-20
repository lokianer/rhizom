// The frame around every view: header, the sidebar with its four panels, and the command
// palette. Everything that needs the whole app (theme, shortcuts, note creation) lives here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { expandTemplate, noteNameOf, type TemplateSettings } from '@rhizom/core';

import { api, ApiRequestError } from '../api/client.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import { NewNoteDialog } from '../components/NewNoteDialog.js';
import { TagRenameDialog } from '../components/TagRenameDialog.js';
import { ThemeSwitch } from '../components/ThemeSwitch.js';
import { CommandPalette, type PaletteCommand } from '../palette/index.js';
import { FileTree, OutlinePanel, SearchPanel, SmartFolders, TagList } from '../panels/index.js';
import { useUiStore, type SidebarTab } from '../store/ui.js';
import { useVaultStore } from '../store/vault.js';
import { copyPath, randomNotePath } from './commands-model.js';
import { dailyNotePath } from './daily.js';
import { headingHref, noteHref, notePathFromLocation } from './paths.js';
import { applyTheme } from './theme.js';
import { revisionOf, useIndexEvents } from './useIndexEvents.js';

/** The sidebar's tabs in the order they stand, each with the key that names it. */
const SIDEBAR_TABS = [
  { tab: 'tree', label: 'sidebar.files' },
  { tab: 'search', label: 'sidebar.search' },
  { tab: 'tags', label: 'sidebar.tags' },
  { tab: 'outline', label: 'sidebar.outline' },
] as const satisfies readonly { tab: SidebarTab; label: string }[];

/** The modifier the shortcuts use, Command on Apple systems and Control everywhere else. */
function modifierLabel(): string {
  return navigator.platform.startsWith('Mac') || navigator.platform === 'iPhone' ? '⌘' : 'Ctrl';
}

/**
 * The text a new day starts from: the vault's own daily template, expanded the way the slash
 * menu expands one, so `{{date}}` and `{{title}}` mean here what they mean there. A template
 * the setting names and the vault no longer holds is not an error — the day starts empty, which
 * is what it would have done without a template at all.
 */
async function dailyTemplateText(
  template: string | null,
  path: string,
  templates: TemplateSettings | undefined,
  locale: string,
): Promise<string> {
  if (template === null) {
    return '';
  }
  try {
    const source = await api.note(template);
    return expandTemplate(source.content, {
      title: noteNameOf(path),
      path,
      now: new Date(),
      dateFormat: templates?.dateFormat ?? 'YYYY-MM-DD',
      timeFormat: templates?.timeFormat ?? 'HH:mm',
      locale,
    }).text;
  } catch {
    return '';
  }
}

export function Layout() {
  const { t, i18n } = useTranslation();
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
  const templates = useVaultStore((state) => state.info?.templates);

  const revisions = useIndexEvents();
  const [newNoteFolder, setNewNoteFolder] = useState<string | null>(null);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The one way into a note from the sidebar. A fragment names a heading in it: the outline
  // sends one, everything else opens the note at the top and leaves the argument out.
  const openNote = useCallback(
    (path: string, fragment?: string) => {
      void navigate(fragment === undefined ? noteHref(path) : headingHref(path, fragment));
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

  // Today's note: the vault says where it goes and what a day is called, and the note is made
  // from the vault's own template when it does not exist yet. The command is not offered at all
  // when the vault keeps no daily notes.
  const openToday = useCallback(async () => {
    const path = daily === undefined ? null : dailyNotePath(daily, new Date(), i18n.language);
    if (path === null) {
      return;
    }
    try {
      await api.note(path);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 404) {
        throw error;
      }
      await api.createNote({
        path,
        content: await dailyTemplateText(daily?.template ?? null, path, templates, i18n.language),
      });
      await refresh();
    }
    void navigate(noteHref(path));
  }, [daily, i18n.language, navigate, refresh, templates]);

  // Duplicating a note: the same words under the next free name beside it. Nothing is renamed and
  // no link is rewritten — a copy is a new note that happens to say the same thing, and what the
  // original pointed at, the copy points at too.
  const duplicateNote = useCallback(async () => {
    if (openNotePath === null) {
      return;
    }
    const source = await api.note(openNotePath);
    const taken = new Set(notes.map((note) => note.path));
    // The note list is a moment old, so a name it believes free may have been taken since. The
    // server's refusal (409) is an answer rather than a failure: that name is gone, and the next
    // one in the series is asked for instead. Five tries, then it is a failure like any other.
    for (let attempt = 0; ; attempt += 1) {
      const path = copyPath(openNotePath, taken);
      try {
        const created = await api.createNote({ path, content: source.content });
        await refresh();
        void navigate(noteHref(created.path));
        return;
      } catch (error) {
        const nameTaken = error instanceof ApiRequestError && error.status === 409;
        if (!nameTaken || attempt >= 4) {
          throw error;
        }
        taken.add(path);
      }
    }
  }, [navigate, notes, openNotePath, refresh]);

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
    ],
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
        onCancel={() => {
          setNewNoteFolder(null);
        }}
        onCreate={(path) => {
          void createNote(path);
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
