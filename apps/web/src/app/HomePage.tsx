import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useVaultStore } from '../store/vault.js';
import { noteHref } from './paths.js';

/** Shown when no note is open: what this vault holds and the most recently changed notes. */
export function HomePage() {
  const { t } = useTranslation();
  const info = useVaultStore((state) => state.info);
  const notes = useVaultStore((state) => state.notes);

  const recent = [...notes].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 10);

  return (
    <div className="rz-page rz-home">
      <h2>{info?.name ?? t('app.name')}</h2>
      <p className="rz-muted">{t('tree.notes', { count: info?.noteCount ?? notes.length })}</p>
      {recent.length === 0 ? (
        <p>{t('sidebar.empty')}</p>
      ) : (
        <ul className="rz-recent">
          {recent.map((note) => (
            <li key={note.path}>
              <Link to={noteHref(note.path)}>{note.title}</Link>{' '}
              <span className="rz-muted">{note.folder}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
