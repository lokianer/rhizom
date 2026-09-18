import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface NewNoteDialogProps {
  /** The folder the note goes into, '' for the vault root; null keeps the dialog closed. */
  folder: string | null;
  onCancel: () => void;
  onCreate: (path: string) => void;
}

export function NewNoteDialog({ folder, onCancel, onCreate }: NewNoteDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');

  const open = folder !== null;
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

  return (
    <dialog
      ref={dialogRef}
      className="rz-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onCancel}
      onCancel={onCancel}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed === '' || folder === null) {
            return;
          }
          setName('');
          onCreate(folder === '' ? trimmed : `${folder}/${trimmed}`);
        }}
      >
        <h2 id={`${id}-title`}>{t('tree.newNote')}</h2>
        <p className="rz-dialog-hint">
          {folder === null || folder === '' ? t('note.atRoot') : t('note.inFolder', { folder })}
        </p>
        <label htmlFor={`${id}-name`}>{t('note.nameLabel')}</label>
        <input
          id={`${id}-name`}
          value={name}
          autoFocus
          placeholder={t('note.namePlaceholder')}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <div className="rz-dialog-actions">
          <button type="button" onClick={onCancel}>
            {t('note.cancel')}
          </button>
          <button type="submit" disabled={name.trim() === ''}>
            {t('note.createButton')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
