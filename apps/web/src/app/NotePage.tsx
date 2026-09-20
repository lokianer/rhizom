// One open note: loaded from the server, edited in CodeMirror, saved with the hash it was
// loaded with, and reloaded when the file changes on disk while nothing is unsaved.
import {
  createTermMatcher,
  type NoteDocument,
  type RenamePreview,
  type TemplateSettings,
} from '@rhizom/core';
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';

import { api, ApiRequestError, isAbortError } from '../api/client.js';
import { RenameDialog } from '../components/RenameDialog.js';
import { MarkdownEditor, SLASH_COMMANDS } from '../editor/index.js';
import { BacklinksPanel, MentionsPanel } from '../panels/index.js';
import { filesFor } from '../panels/rename-model.js';
import { useUiStore } from '../store/ui.js';
import { useVaultStore } from '../store/vault.js';
import { createResolver } from './links.js';
import type { OutletContext } from './outlet.js';
import { noteHref, notePathFromParam } from './paths.js';
import { revisionElsewhere, revisionOf } from './useIndexEvents.js';

/** A vault that has not said where its templates are; frozen, so the editor sees one identity. */
const NO_TEMPLATES: TemplateSettings = Object.freeze({
  folder: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
});

// The preview brings the whole Markdown renderer, which someone who only writes never needs.
const NotePreview = lazy(async () => ({ default: (await import('./NotePreview.js')).NotePreview }));

const AUTOSAVE_MS = 800;

type LoadState = 'loading' | 'ready' | 'missing' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export function NotePage() {
  const { revisions } = useOutletContext<OutletContext>();
  const { t } = useTranslation();
  const params = useParams();
  const path = notePathFromParam(params['*']);

  if (path === null) {
    return <p className="rz-page">{t('note.missing')}</p>;
  }
  // Another note is another document: the key resets editor, save state and pending edits,
  // instead of an effect having to undo the previous note's state.
  return <NoteView key={path} path={path} revisions={revisions} />;
}

interface NoteViewProps extends OutletContext {
  path: string;
}

function NoteView({ path, revisions }: NoteViewProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const notes = useVaultStore((state) => state.notes);
  const terms = useVaultStore((state) => state.terms);
  const templates = useVaultStore((state) => state.info?.templates) ?? NO_TEMPLATES;
  const refreshVault = useVaultStore((state) => state.refresh);
  const splitView = useUiStore((state) => state.splitView);
  const toggleSplitView = useUiStore((state) => state.toggleSplitView);
  const renameRequest = useUiStore((state) => state.renameRequest);

  const [doc, setDoc] = useState<NoteDocument | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [externalContent, setExternalContent] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Rendering the preview yields to typing: the editor never waits for it.
  const previewContent = useDeferredValue(draft);

  // Kept in refs so the debounced save always sees the latest values without re-arming.
  const pending = useRef<string | null>(null);
  const hashRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolver = useMemo(() => createResolver(notes), [notes]);
  // Memoised on the term list, not on the context: the vault store replaces every array after
  // each save, and rebuilding the matcher would rebuild every decoration layer with it.
  const matcher = useMemo(() => createTermMatcher(terms), [terms]);
  // The slash menu reads its labels here, because a CodeMirror extension has no translator.
  const commandLabels = useMemo(
    () => Object.fromEntries(SLASH_COMMANDS.map((id) => [id, t(`editor.slash.${id}`)])),
    [t],
  );

  const applyLoaded = useCallback((loaded: NoteDocument) => {
    hashRef.current = loaded.hash;
    pending.current = null;
    setDoc(loaded);
    setDraft(loaded.content);
    setExternalContent(undefined);
    setState('ready');
    setSaveState('idle');
    setMessage('');
  }, []);

  const applyLoadFailure = useCallback((error: unknown) => {
    if (isAbortError(error)) {
      return;
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      setDoc(null);
      setState('missing');
      return;
    }
    setState('error');
    setMessage(error instanceof Error ? error.message : String(error));
  }, []);

  const reload = useCallback(() => {
    setState('loading');
    api.note(path).then(applyLoaded).catch(applyLoadFailure);
  }, [applyLoaded, applyLoadFailure, path]);

  useEffect(() => {
    const controller = new AbortController();
    api.note(path, { signal: controller.signal }).then(applyLoaded).catch(applyLoadFailure);
    return () => {
      controller.abort();
    };
  }, [applyLoaded, applyLoadFailure, path]);

  const save = useCallback(
    async (content: string) => {
      setSaveState('saving');
      try {
        const saved = await api.saveNote(path, { content }, hashRef.current ?? undefined);
        hashRef.current = saved.hash;
        pending.current = null;
        setDoc(saved);
        setSaveState('saved');
        setMessage('');
        void refreshVault();
      } catch (error) {
        if (error instanceof ApiRequestError && error.isConflict) {
          setSaveState('conflict');
          setMessage(t('editor.conflict'));
          return;
        }
        setSaveState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [path, refreshVault, t],
  );

  const scheduleSave = useCallback(
    (content: string) => {
      pending.current = content;
      setDraft(content);
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        void save(content);
      }, AUTOSAVE_MS);
    },
    [save],
  );

  // A pending edit must not be lost when the note is closed or the page unmounts.
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const unsaved = pending.current;
      if (unsaved !== null) {
        void api.saveNote(path, { content: unsaved }, hashRef.current ?? undefined);
      }
    };
  }, [path]);

  // The file changed outside Rhizom: take the new text over when nothing is unsaved.
  // Counted rather than signalled: one watcher batch can report two events in a single render,
  // and a page holding only the last of them would never hear about the first.
  const revision = revisionOf(revisions, path);
  const applied = useRef(revision);
  useEffect(() => {
    if (applied.current === revision || pending.current !== null) {
      return;
    }
    applied.current = revision;
    const controller = new AbortController();
    api
      .note(path, { signal: controller.signal })
      .then((fresh) => {
        if (fresh.hash !== hashRef.current) {
          hashRef.current = fresh.hash;
          setDoc(fresh);
          setDraft(fresh.content);
          setExternalContent(fresh.content);
        }
      })
      .catch(() => {
        // The note may have been deleted; the refreshed vault store shows that.
      });
    return () => {
      controller.abort();
    };
  }, [revision, path]);

  // The palette can ask for a rename from anywhere; only this page knows whether the note has
  // unsaved text, so the request arrives as a counter and is answered here.
  const askedRename = useRef(renameRequest);
  useEffect(() => {
    if (askedRename.current === renameRequest) {
      return;
    }
    askedRename.current = renameRequest;
    setRenaming(true);
  }, [renameRequest]);

  const confirmRename = useCallback(
    async (preview: RenamePreview) => {
      // What is in the editor goes to disk first: the rename reads every file from disk, and a
      // draft saved afterwards would be written back to a path that is no longer there.
      const unsaved = pending.current;
      if (unsaved !== null) {
        await save(unsaved);
        if (pending.current !== null) {
          // The save was refused — a conflict, and the banner says so. Renaming on top of that
          // would move a file whose text is not the one on screen.
          return;
        }
      }
      // The three lines `remove` has, for the same reason: a pending autosave would write the
      // note straight back to the path it was just moved away from.
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      pending.current = null;

      const result = await api.renameNote({
        from: preview.from,
        to: preview.to,
        // The hash of the file as it stands now, which is not the preview's once a draft was
        // just flushed to disk.
        hash: hashRef.current ?? preview.fromHash,
        files: filesFor(preview),
      });
      setRenaming(false);
      await refreshVault();
      // Replace, not push: without it the Back button lands on the old path, which now offers
      // to create the note that was just moved away.
      void navigate(noteHref(result.to), { replace: true });
    },
    [navigate, refreshVault, save],
  );

  const remove = useCallback(() => {
    setAskDelete(false);
    // A pending autosave would recreate the file right after it was moved away.
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    void api
      .deleteNote(path)
      .then(() => refreshVault())
      .then(() => navigate('/'));
  }, [navigate, path, refreshVault]);

  const openTarget = useCallback(
    (target: string) => {
      const resolution = resolver.resolve(target, path);
      const next = resolution.resolved ? resolution.path : resolution.createPath;
      if (next !== undefined) {
        void navigate(noteHref(next));
      }
    },
    [navigate, path, resolver],
  );

  if (state === 'missing') {
    return (
      <div className="rz-page">
        <h2>{path}</h2>
        <p>{t('note.missing')}</p>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            void api
              .createNote({ path })
              .then(() => refreshVault())
              .then(reload);
          }}
        >
          {t('note.create', { path })}
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return <p className="rz-page rz-error">{t('status.error', { message })}</p>;
  }

  if (state === 'loading' || doc === null) {
    return <p className="rz-page">{t('note.loading')}</p>;
  }

  return (
    <div className="rz-note">
      <header className="rz-note-header">
        <h2>{doc.title}</h2>
        <p className="rz-muted">
          {doc.path}
          <SaveStatus state={saveState} message={message} />
        </p>
        <nav className="rz-note-actions">
          <button type="button" aria-pressed={splitView} onClick={toggleSplitView}>
            {t('editor.preview')}
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(true);
            }}
          >
            {t('rename.action')}
          </button>
          {askDelete ? (
            <>
              <span className="rz-muted">{t('note.confirmDelete', { name: doc.title })}</span>
              <button type="button" onClick={remove}>
                {t('note.delete')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAskDelete(false);
                }}
              >
                {t('note.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAskDelete(true);
              }}
            >
              {t('note.delete')}
            </button>
          )}
          <Link to={noteHref(doc.path, 'wiki')}>{t('wiki.toWiki')}</Link>
          {saveState === 'conflict' ? (
            <>
              <button type="button" onClick={reload}>
                {t('editor.reload')}
              </button>
              <button
                type="button"
                onClick={() => {
                  // Deliberately without If-Match: the file on disk gets this text.
                  hashRef.current = null;
                  void save(pending.current ?? doc.content);
                }}
              >
                {t('editor.overwrite')}
              </button>
            </>
          ) : null}
        </nav>
      </header>

      <div className={`rz-note-body${splitView ? ' rz-note-split' : ''}`}>
        <MarkdownEditor
          path={doc.path}
          content={doc.content}
          externalContent={externalContent}
          notes={notes}
          terms={matcher}
          templates={templates}
          commandLabels={commandLabels}
          locale={i18n.language}
          ariaLabel={t('editor.label')}
          onChange={scheduleSave}
          onSave={(content) => {
            void save(content);
          }}
          onOpenLink={openTarget}
          onReadNote={async (target) => {
            try {
              return (await api.note(target)).content;
            } catch (error) {
              // The editor puts the typed command back; this says why nothing was inserted.
              setSaveState('error');
              setMessage(
                t('editor.templateFailed', {
                  name: target,
                  message: error instanceof Error ? error.message : String(error),
                }),
              );
              throw error;
            }
          }}
          onUpload={async (file) => {
            try {
              return (await api.uploadAsset(file)).path;
            } catch (error) {
              setSaveState('error');
              setMessage(
                t('editor.uploadFailed', {
                  name: file.name,
                  message: error instanceof Error ? error.message : String(error),
                }),
              );
              throw error;
            }
          }}
        />
        {splitView ? (
          <div className="rz-note-preview">
            <Suspense fallback={<p className="rz-muted">{t('note.loading')}</p>}>
              <NotePreview path={doc.path} content={previewContent} label={t('wiki.label')} />
            </Suspense>
          </div>
        ) : null}
      </div>

      <BacklinksPanel
        path={doc.path}
        elsewhere={revisionElsewhere(revisions, doc.path)}
        onOpen={(target) => {
          void navigate(noteHref(target));
        }}
      />

      <MentionsPanel
        path={doc.path}
        elsewhere={revisionElsewhere(revisions, doc.path)}
        onOpen={(target) => {
          void navigate(noteHref(target));
        }}
      />

      <RenameDialog
        note={renaming ? { path: doc.path, title: doc.title } : null}
        onCancel={() => {
          setRenaming(false);
        }}
        onConfirm={confirmRename}
      />
    </div>
  );
}

function SaveStatus({ state, message }: { state: SaveState; message: string }) {
  const { t } = useTranslation();
  switch (state) {
    case 'saving':
      return <> · {t('editor.saving')}</>;
    case 'saved':
      return <> · {t('editor.saved')}</>;
    case 'conflict':
      return (
        <>
          {' '}
          · <span className="rz-error">{t('editor.conflict')}</span>
        </>
      );
    case 'error':
      return (
        <>
          {' '}
          · <span className="rz-error">{t('editor.failed', { message })}</span>
        </>
      );
    default:
      return null; // nothing to say while the note simply sits there
  }
}
