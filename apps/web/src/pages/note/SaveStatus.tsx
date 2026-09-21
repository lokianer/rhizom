// The one line under the editor that says whether the note is written to disk.
import { useTranslation } from 'react-i18next';

import type { SaveState } from './useNoteDocument.js';

export function SaveStatus({ state, message }: { state: SaveState; message: string }) {
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
