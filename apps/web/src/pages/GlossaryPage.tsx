// Every term the vault defines, alphabetically. Generated from the notes that declare
// `type: definition` rather than written into the vault as a file: a glossary that is a note
// would go stale the moment a definition is renamed, and the vault already holds the truth.
import type { GlossaryEntry } from '@rhizom/core';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useOutletContext } from 'react-router';

import { api, isAbortError } from '../api/client.js';
import { groupByLetter } from './glossary-model.js';
import type { OutletContext } from '../app/outlet.js';
import { noteHref } from '../routing/paths.js';

export function GlossaryPage() {
  const { t } = useTranslation();
  const { revisions } = useOutletContext<OutletContext>();
  const headingId = useId();
  const [entries, setEntries] = useState<GlossaryEntry[] | null>(null);
  const [error, setError] = useState('');

  // A definition may be written, renamed or deleted in another tab; the glossary follows the
  // files like every other view. Any note can change what belongs in it, so this watches the
  // event count rather than any one path.
  const revision = revisions.events;

  useEffect(() => {
    const controller = new AbortController();
    api
      .glossary({ signal: controller.signal })
      .then((loaded) => {
        setEntries(loaded);
        setError('');
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      controller.abort();
    };
  }, [revision]);

  if (error !== '') {
    return <p className="rz-page rz-error">{t('status.error', { message: error })}</p>;
  }
  if (entries === null) {
    return <p className="rz-page">{t('note.loading')}</p>;
  }

  const groups = groupByLetter(entries);

  return (
    <section className="rz-page rz-glossary" aria-labelledby={headingId}>
      <header className="rz-note-header">
        <h2 id={headingId}>{t('glossary.title')}</h2>
        <p className="rz-muted">{t('glossary.count', { count: entries.length })}</p>
      </header>

      {entries.length === 0 ? (
        <p className="rz-glossary-empty">{t('glossary.empty')}</p>
      ) : (
        groups.map((group) => (
          <section key={group.letter} className="rz-glossary-group">
            <h3 className="rz-glossary-letter" aria-hidden="true">
              {group.letter}
            </h3>
            <dl>
              {group.entries.map((entry) => (
                <div key={entry.path} className="rz-glossary-entry">
                  <dt>
                    <Link to={noteHref(entry.path)}>{entry.title}</Link>{' '}
                    {entry.aliases.length === 0 ? null : (
                      <span className="rz-muted rz-glossary-aliases">
                        {t('glossary.alsoKnownAs', { aliases: entry.aliases.join(', ') })}
                      </span>
                    )}
                  </dt>
                  <dd>{entry.summary === '' ? t('glossary.noSummary') : entry.summary}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </section>
  );
}
