// Wiki mode: the vault as a read-only site. The same Markdown pipeline as the indexer turns
// the note into sanitised HTML; links stay inside the app.
import type { NoteDocument } from '@rhizom/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext, useParams } from 'react-router';

import { api, isAbortError } from '../api/client.js';
import { NotePreview } from './NotePreview.js';
import type { OutletContext } from '../app/outlet.js';
import { noteHref, notePathFromParam } from '../routing/paths.js';
import { revisionOf } from '../app/useIndexEvents.js';

export function WikiPage() {
  const { t } = useTranslation();
  const { revisions } = useOutletContext<OutletContext>();
  const params = useParams();
  const path = notePathFromParam(params['*']);

  if (path === null) {
    return <p className="rz-page">{t('note.missing')}</p>;
  }
  // Keyed like the editor page: another note starts from nothing, instead of an effect
  // having to clear the previous one's state first.
  return <WikiView key={path} path={path} revisions={revisions} />;
}

function WikiView({ path, revisions }: { path: string } & OutletContext) {
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

  // Read-only does not mean frozen: the file may change under the reader, through Git, another
  // editor or the app's own editor in a second tab. Without this the body would stay as it was
  // for as long as the tab stays open, and a transcluded body with it.
  const revision = revisionOf(revisions, path);
  const applied = useRef(revision);
  useEffect(() => {
    // The effect above already fetched what the page mounted with, so only a *change* counts.
    if (applied.current === revision) {
      return;
    }
    applied.current = revision;
    const controller = new AbortController();
    api
      .note(path, { signal: controller.signal })
      .then(setDoc)
      .catch(() => {
        // A failed refresh keeps what is on screen; the next change tries again.
      });
    return () => {
      controller.abort();
    };
  }, [revision, path]);

  if (error !== '') {
    return <p className="rz-page rz-error">{t('status.error', { message: error })}</p>;
  }
  if (doc === null) {
    return <p className="rz-page">{t('note.loading')}</p>;
  }

  return (
    <article className="rz-page rz-wiki" aria-label={t('wiki.label')}>
      <header className="rz-note-header">
        {/* A note that opens with its own title should not have it printed twice. */}
        {doc.headings.some((heading) => heading.level === 1 && heading.text === doc.title) ? (
          <p className="rz-muted">{doc.path}</p>
        ) : (
          <h2>{doc.title}</h2>
        )}
        <nav className="rz-note-actions">
          <Link to={noteHref(doc.path)}>{t('wiki.toEditor')}</Link>
        </nav>
      </header>
      <NotePreview path={doc.path} content={doc.content} mode="wiki" />
    </article>
  );
}
