// Wiki mode: the vault as a read-only site. The same Markdown pipeline as the indexer turns
// the note into sanitised HTML; links stay inside the app.
import type { NoteDocument } from '@rhizom/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { api, isAbortError } from '../api/client.js';
import { NotePreview } from './NotePreview.js';
import { noteHref, notePathFromParam } from './paths.js';

export function WikiPage() {
  const { t } = useTranslation();
  const params = useParams();
  const path = notePathFromParam(params['*']);

  if (path === null) {
    return <p className="rz-page">{t('note.missing')}</p>;
  }
  // Keyed like the editor page: another note starts from nothing, instead of an effect
  // having to clear the previous one's state first.
  return <WikiView key={path} path={path} />;
}

function WikiView({ path }: { path: string }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<NoteDocument | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api
      .note(path, { signal: controller.signal })
      .then(setDoc)
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      controller.abort();
    };
  }, [path]);

  if (error !== '') {
    return <p className="rz-page rz-error">{t('status.error', { message: error })}</p>;
  }
  if (doc === null) {
    return <p className="rz-page">{t('note.loading')}</p>;
  }

  return (
    <article className="rz-page rz-wiki" aria-label={t('wiki.label')}>
      <header className="rz-note-header">
        <h2>{doc.title}</h2>
        <nav className="rz-note-actions">
          <Link to={noteHref(doc.path)}>{t('wiki.toEditor')}</Link>
        </nav>
      </header>
      <NotePreview path={doc.path} content={doc.content} mode="wiki" />
    </article>
  );
}
