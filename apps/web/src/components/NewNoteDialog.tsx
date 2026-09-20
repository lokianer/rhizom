import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface NewNoteDialogProps {
  /** The folder the note goes into, '' for the vault root; null keeps the dialog closed. */
  folder: string | null;
  /** The vault's templates, by path and by the file name they are offered under. */
  templates: readonly { path: string; name: string }[];
  onCancel: () => void;
  onCreate: (path: string, template: string | null) => void;
}

export function NewNoteDialog({ folder, templates, onCancel, onCreate }: NewNoteDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  // '' is the empty note. The choice is not remembered between notes: the next one is far more
  // often a plain note than another of the same kind.
  const [template, setTemplate] = useState('');

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
          setTemplate('');
          onCreate(
            folder === '' ? trimmed : `${folder}/${trimmed}`,
            template === '' ? null : template,
          );
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
        {templates.length === 0 ? null : (
          <>
            <label htmlFor={`${id}-template`}>{t('note.templateLabel')}</label>
            <select
              id={`${id}-template`}
              value={template}
              onChange={(event) => {
                setTemplate(event.target.value);
              }}
            >
              <option value="">{t('note.noTemplate')}</option>
              {templates.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {entry.name}
                </option>
              ))}
            </select>
          </>
        )}
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
