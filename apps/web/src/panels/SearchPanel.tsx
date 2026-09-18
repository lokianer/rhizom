// Full-text search over the vault. The request is debounced and the pending one is aborted
// when the query moves on, so the list always belongs to what is typed: a result is only
// shown while its query still matches the field.
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { folderOf } from '@rhizom/core';
import type { SearchHit } from '@rhizom/core';

import { api, isAbortError } from '../api/client.js';
import { noteHref } from '../app/paths.js';
import './panels.css';

export interface SearchPanelProps {
  activePath: string | null;
  onOpen: (path: string) => void;
}

/** Shorter queries match half the vault and are not worth a round trip. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 150;

type Outcome = { query: string; hits: SearchHit[] } | { query: string; error: string };

export function SearchPanel({ activePath, onOpen }: SearchPanelProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api
        .search(term, { signal: controller.signal })
        .then((response) => {
          setOutcome({ query: term, hits: response.hits });
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) {
            setOutcome({
              query: term,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const term = query.trim();
  const ready = term.length >= MIN_QUERY;
  const current = outcome !== null && outcome.query === term ? outcome : null;
  const hits = current !== null && 'hits' in current ? current.hits : null;

  const status = (): string => {
    if (!ready) {
      return t('search.hint');
    }
    if (current === null) {
      return t('note.loading');
    }
    if ('error' in current) {
      return t('status.error', { message: current.error });
    }
    return current.hits.length === 0
      ? t('search.noResults', { query: term })
      : t('search.results', { count: current.hits.length });
  };

  return (
    <div className="rz-panel">
      <div className="rz-panel-bar">
        <label className="rz-visually-hidden" htmlFor={inputId}>
          {t('search.label')}
        </label>
        <input
          id={inputId}
          type="search"
          className="rz-search-input"
          value={query}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>

      <p className="rz-panel-status" role="status">
        {status()}
      </p>

      {hits !== null && hits.length > 0 ? (
        <ul className="rz-hits" aria-label={t('search.label')}>
          {hits.map((hit) => (
            <li key={hit.path}>
              <a
                className="rz-hit"
                href={noteHref(hit.path)}
                aria-current={hit.path === activePath ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                  }
                  event.preventDefault();
                  onOpen(hit.path);
                }}
              >
                <span className="rz-hit-title">{hit.title}</span>
                {folderOf(hit.path) === '' ? null : (
                  <span className="rz-hit-folder">{folderOf(hit.path)}</span>
                )}
                {/*
                  The server escapes the note text and then wraps the matched terms in <mark>,
                  so the snippet carries no markup of its own and cannot inject any.
                */}
                <span
                  className="rz-hit-snippet"
                  dangerouslySetInnerHTML={{ __html: hit.snippet }}
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
