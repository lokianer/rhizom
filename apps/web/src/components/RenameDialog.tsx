// Renaming a note is the one edit that reaches into files the reader is not looking at, so it
// is shown before it happens: every link that would change, every link that would not, and why.
// The preview comes from the server, because only the server has read the other notes; this
// dialog asks for one while the name is being typed and confirms the very preview it showed.
import type { RenamePreview } from '@rhizom/core';
import { noteNameOf } from '@rhizom/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, isAbortError } from '../api/client.js';
import { noteHref } from '../app/paths.js';
import { countsOf, refusalKey, targetPathFor } from '../panels/rename-model.js';

export interface RenameDialogProps {
  /** The note being renamed, or null when the dialog is closed. */
  note: { path: string; title: string } | null;
  onCancel: () => void;
  /** Called with the preview the reader confirmed; resolves when the rename is finished. */
  onConfirm: (preview: RenamePreview) => Promise<void>;
}

/**
 * How long typing has to settle before a preview is asked for. A preview reads every note that
 * links here, so it is not a keystroke's worth of work.
 */
const PREVIEW_DELAY_MS = 300;

/** Why a link stays as it is. Both reasons are worth reading, so both have words of their own. */
const SKIP_REASON_KEYS = {
  alias: 'rename.skipped.alias',
  stillResolves: 'rename.skipped.stillResolves',
} as const;

export function RenameDialog({ note, onCancel, onConfirm }: RenameDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The note the prefilled name was selected for, so it is selected once and not again while
  // the reader edits it back to what it was.
  const selectedFor = useRef<string | null>(null);
  // What was typed, and for which note. Both pieces of state below carry the note and the target
  // they belong to, so opening the dialog on another note needs no resetting: what does not
  // belong to the note now open simply does not apply.
  const [typed, setTyped] = useState<{ from: string | null; value: string }>({
    from: null,
    value: '',
  });
  const [loaded, setLoaded] = useState<{ from: string; to: string; preview: RenamePreview } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ from: string; to: string; message: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);

  const from = note?.path ?? null;
  const open = from !== null;
  const name = typed.from === from ? typed.value : from === null ? '' : noteNameOf(from);
  const to = from === null ? '' : targetPathFor(from, name);
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
    if (input === null || selectedFor.current === from || input.value !== noteNameOf(from)) {
      return;
    }
    selectedFor.current = from;
    input.select();
  }, [from, name]);

  // One preview per name that has settled; typing on cancels the request it was waiting for.
  useEffect(() => {
    if (from === null || unchanged) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .renamePreview(from, to, { signal: controller.signal })
        .then((preview) => {
          setLoaded({ from, to, preview });
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) {
            return;
          }
          setFailure({
            from,
            to,
            message: error instanceof Error ? error.message : String(error),
          });
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
  const refusal = current === null ? null : refusalKey(current.refusal);
  const counts = current === null ? null : countsOf(current);
  // No preview for the name as it now reads, and nothing to say about why: one is on its way.
  const pending = !unchanged && current === null && error === null;
  const canConfirm = current !== null && refusal === null && !renaming && !unchanged;

  // Closing puts the dialog back to the note's own name: an abandoned attempt is not a draft,
  // and the next open should read as the first one did.
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

  if (note === null) {
    return null;
  }

  const summary =
    counts === null
      ? ''
      : [
          t('rename.files', { count: counts.files }),
          t('rename.refs', { count: counts.refs }),
          ...(counts.leftAlone > 0 ? [t('rename.leftAlone', { count: counts.leftAlone })] : []),
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
        <h2 id={`${id}-title`}>{t('rename.title')}</h2>
        <p className="rz-dialog-hint">{note.path}</p>
        <label htmlFor={`${id}-name`}>{t('rename.nameLabel')}</label>
        <input
          id={`${id}-name`}
          ref={inputRef}
          value={name}
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
                        key={`${String(ref.line)}:${String(ref.start)}`}
                        className={
                          ref.rewrite ? 'rz-rename-ref' : 'rz-rename-ref rz-rename-left-alone'
                        }
                      >
                        <span className="rz-rename-line">{ref.line}</span>
                        <code className="rz-rename-before">{ref.before}</code>
                        {/* A link that stays as it is has no second reading to show. */}
                        {ref.after === ref.before ? null : (
                          <>
                            <span className="rz-rename-arrow" aria-hidden="true">
                              →
                            </span>
                            <code className="rz-rename-after">{ref.after}</code>
                          </>
                        )}
                        {ref.inHeading ? (
                          <span className="rz-badge">{t('rename.inHeading')}</span>
                        ) : null}
                        {ref.rewrite || ref.skipReason === undefined ? null : (
                          <span className="rz-rename-reason">
                            {t(SKIP_REASON_KEYS[ref.skipReason])}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {file.more > 0 ? (
                    <p className="rz-rename-note">{t('rename.more', { count: file.more })}</p>
                  ) : null}
                </section>
              ))}

              <p className="rz-rename-note">{t('rename.unseenForms')}</p>

              {current.nameClash.length === 0 ? null : (
                <p className="rz-rename-warning">
                  {t('rename.nameClash', { notes: current.nameClash.join(', ') })}
                </p>
              )}

              <p className="rz-rename-note">
                {current.titleFollowsFileName
                  ? t('rename.titleFollowsFileName', { title: current.title })
                  : t('rename.titleStays', { title: current.title })}
              </p>
            </>
          )}
        </div>

        <div className="rz-dialog-actions">
          <button type="button" onClick={dismiss} disabled={renaming}>
            {t('note.cancel')}
          </button>
          <button type="submit" disabled={!canConfirm}>
            {t('rename.button')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
