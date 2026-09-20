// Renaming a tag reaches into files nobody is looking at, so it is shown before it happens: the
// files it would touch, the line each occurrence stands on, and what that line would read
// afterwards. The same shape the note rename has, because it is the same promise.
//
// One thing is different and is said out loud. A note keeps its identity when it is renamed; a
// tag is only its name, so renaming one onto a tag that already exists makes them one tag and
// nothing remembers they were two. The dialog warns and lets the reader decide.
import type { TagRenamePreview } from '@rhizom/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, isAbortError } from '../api/client.js';
import { noteHref } from '../app/paths.js';

export interface TagRenameDialogProps {
  /** The tag being renamed, or null when the dialog is closed. */
  tag: string | null;
  onCancel: () => void;
  /** Called with the preview the reader confirmed; resolves when the rename is finished. */
  onConfirm: (preview: TagRenamePreview) => Promise<void>;
}

/** How long typing has to settle before a preview is asked for: it reads every tagged note. */
const PREVIEW_DELAY_MS = 300;

const REFUSAL_KEYS = {
  notFound: 'tagRename.refusal.notFound',
  unwritableName: 'tagRename.refusal.unwritableName',
  same: 'tagRename.refusal.same',
  tooMany: 'tagRename.refusal.tooMany',
} as const;

export function TagRenameDialog({ tag, onCancel, onConfirm }: TagRenameDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedFor = useRef<string | null>(null);
  // What was typed, and for which tag: opening the dialog on another tag needs no resetting,
  // because what does not belong to the tag now open simply does not apply.
  const [typed, setTyped] = useState<{ from: string | null; value: string }>({
    from: null,
    value: '',
  });
  const [loaded, setLoaded] = useState<{
    from: string;
    to: string;
    preview: TagRenamePreview;
  } | null>(null);
  const [failure, setFailure] = useState<{ from: string; to: string; message: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);

  const from = tag;
  const open = from !== null;
  const to = (typed.from === from ? typed.value : (from ?? '')).trim();
  const unchanged = to === '' || to === from;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The prefilled name is there to be typed over, so it starts selected.
  useEffect(() => {
    const input = inputRef.current;
    if (from === null) {
      selectedFor.current = null;
      return;
    }
    if (input === null || selectedFor.current === from || input.value !== from) {
      return;
    }
    selectedFor.current = from;
    input.select();
  }, [from, to]);

  // One preview per name that has settled; typing on cancels the request it was waiting for.
  useEffect(() => {
    if (from === null || unchanged) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .tagRenamePreview(from, to, { signal: controller.signal })
        .then((preview) => {
          setLoaded({ from, to, preview });
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) {
            return;
          }
          setFailure({ from, to, message: error instanceof Error ? error.message : String(error) });
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [from, to, unchanged]);

  // Only a preview of the name as it now reads may be shown, let alone confirmed: an older one
  // describes a rename nobody asked for.
  const current =
    loaded !== null && loaded.from === from && loaded.to === to ? loaded.preview : null;
  const error = failure !== null && failure.from === from && failure.to === to ? failure : null;
  const refusal = current?.refusal === undefined ? null : REFUSAL_KEYS[current.refusal];
  const pending = !unchanged && current === null && error === null;
  const canConfirm = current !== null && refusal === null && !renaming && !unchanged;

  function dismiss(): void {
    setTyped({ from: null, value: '' });
    setLoaded(null);
    setFailure(null);
    onCancel();
  }

  function confirm(): void {
    if (current === null || !canConfirm || from === null) {
      return;
    }
    setRenaming(true);
    setFailure(null);
    onConfirm(current)
      .catch((reason: unknown) => {
        // The dialog stays open on a failure: the reader should read it, not guess at it.
        setFailure({
          from,
          to,
          message: reason instanceof Error ? reason.message : String(reason),
        });
      })
      .finally(() => {
        setRenaming(false);
      });
  }

  if (tag === null) {
    return null;
  }

  const occurrences =
    current === null
      ? 0
      : current.files.reduce((sum, file) => sum + file.refs.length + file.more, 0);
  const summary =
    current === null
      ? ''
      : [
          t('tagRename.files', { count: current.files.length }),
          t('tagRename.occurrences', { count: occurrences }),
        ].join(', ');

  return (
    <dialog
      ref={dialogRef}
      className="rz-dialog rz-rename"
      aria-labelledby={`${id}-title`}
      onClose={dismiss}
      onCancel={dismiss}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <h2 id={`${id}-title`}>{t('tagRename.title')}</h2>
        <p className="rz-dialog-hint">#{tag}</p>
        <label htmlFor={`${id}-name`}>{t('tagRename.nameLabel')}</label>
        <input
          id={`${id}-name`}
          ref={inputRef}
          value={typed.from === from ? typed.value : tag}
          autoFocus
          disabled={renaming}
          onChange={(event) => {
            setTyped({ from, value: event.target.value });
          }}
        />

        <div className="rz-rename-body">
          {error === null ? null : (
            <p className="rz-error" role="alert">
              {t('status.error', { message: error.message })}
            </p>
          )}
          {refusal === null ? null : (
            <p className="rz-error" role="alert">
              {t(refusal)}
            </p>
          )}
          {pending ? <p className="rz-rename-note">{t('note.loading')}</p> : null}

          {current === null || refusal !== null ? null : (
            <>
              <p className="rz-rename-summary" role="status">
                {summary}
              </p>

              {current.files.map((file) => (
                <section key={file.source} className="rz-rename-file">
                  <h3 className="rz-rename-file-title">
                    <a
                      className="rz-note-link"
                      href={noteHref(file.source)}
                      title={file.source}
                      // The dialog is modal and a rename is half-made: following a link in place
                      // would throw it away, so the source opens beside it.
                      target="_blank"
                      rel="noreferrer"
                    >
                      {file.sourceTitle}
                    </a>
                  </h3>
                  <ul className="rz-rename-refs">
                    {file.refs.map((ref) => (
                      <li
                        key={`${ref.where}:${String(ref.line)}:${ref.before}`}
                        className="rz-rename-ref"
                      >
                        <span className="rz-rename-line">{ref.line}</span>
                        <code className="rz-rename-before">{ref.before}</code>
                        <span className="rz-rename-arrow" aria-hidden="true">
                          →
                        </span>
                        <code className="rz-rename-after">{ref.after}</code>
                        {ref.where === 'frontmatter' ? (
                          <span className="rz-badge">{t('tagRename.inFrontmatter')}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {file.more > 0 ? (
                    <p className="rz-rename-note">{t('tagRename.more', { count: file.more })}</p>
                  ) : null}
                </section>
              ))}

              <p className="rz-rename-note">{t('tagRename.unseenForms')}</p>

              {current.merges.length === 0 ? null : (
                <p className="rz-rename-warning">
                  {t('tagRename.merges', { tags: current.merges.join(', ') })}
                </p>
              )}
            </>
          )}
        </div>

        <div className="rz-dialog-actions">
          <button type="button" onClick={dismiss} disabled={renaming}>
            {t('note.cancel')}
          </button>
          <button type="submit" disabled={!canConfirm}>
            {t('tagRename.button')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
