// The open note's document: loading it, saving it, and keeping it in step with the file on
// disk. One hook rather than three, because these are one thing — every part of it reaches the
// same three refs, and a save in flight is exactly what decides whether an outside change may
// be taken over.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import type { NoteDocument } from '@rhizom/core';

import { api, ApiRequestError, isAbortError } from '../../api/client.js';
import type { IndexRevisions } from '../../app/outlet.js';
import { revisionOf } from '../../app/useIndexEvents.js';
import { useVaultStore } from '../../store/vault.js';

export type LoadState = 'loading' | 'ready' | 'missing' | 'error';
export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

/** How long typing has to stop before the draft is written back. */
const AUTOSAVE_MS = 800;

export function useNoteDocument(path: string, revisions: IndexRevisions, t: TFunction) {
  const refreshVault = useVaultStore((state) => state.refresh);

  /**
   * What the block-link command has just said, shown beside the save state. Its own line
   * rather than the save state's: nothing here is about saving, and the save state's failure
   * is framed as "Could not save …", which a link that did not reach the clipboard has
   * nothing to do with. A save clears it, which is why it is kept here.
   */
  const [notice, setNotice] = useState('');
  const [doc, setDoc] = useState<NoteDocument | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');

  const [externalContent, setExternalContent] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');

  // Kept in refs so the debounced save always sees the latest values without re-arming.
  const pending = useRef<string | null>(null);
  const hashRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyLoaded = useCallback((loaded: NoteDocument) => {
    hashRef.current = loaded.hash;
    pending.current = null;
    setDoc(loaded);
    setDraft(loaded.content);
    setExternalContent(undefined);
    setState('ready');
    setSaveState('idle');
    setMessage('');
    setNotice('');
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
      // Typing moves on from whatever the last command said. The block-link command writes its
      // marker before it reports, so its own notice is set after this one clears it.
      setNotice('');
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

  /**
   * Writes what is in the editor to disk and says whether it got there. False means the save
   * was refused — a conflict, with the banner already saying so — and the caller must not go on
   * to do something that assumes the file on disk holds what is on screen.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    const unsaved = pending.current;
    if (unsaved === null) {
      return true;
    }
    await save(unsaved);
    return pending.current === null;
  }, [save]);

  /** Forgets a scheduled autosave, for when the file is about to be moved or deleted. */
  const cancelPending = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
  }, []);

  /** The newest text there is: what is waiting to be saved, or what was last loaded. */
  const currentText = useCallback((fallback: string): string => pending.current ?? fallback, []);

  /** The hash of the file as it stands now, which a rename needs after a flush. */
  const currentHash = useCallback((): string | undefined => hashRef.current ?? undefined, []);

  /** Saves over whatever is on disk, which is what answering a conflict with "keep mine" means. */
  const overwrite = useCallback(
    (fallback: string): void => {
      hashRef.current = null;
      void save(pending.current ?? fallback);
    },
    [save],
  );

  return {
    doc,
    notice,
    setNotice,
    state,
    saveState,
    message,
    draft,
    externalContent,
    setDoc,
    setState,
    setSaveState,
    setMessage,
    setDraft,
    setExternalContent,
    applyLoaded,
    reload,
    save,
    scheduleSave,
    flush,
    cancelPending,
    currentText,
    currentHash,
    overwrite,
  };
}
