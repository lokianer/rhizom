// The player view: the vault as the table knows it, at a session. Everything on this page comes
// from the `table` routes, which cut what the players may read on the server; the page never asks
// for the GM lens's note list, tree or tags, so nothing the table has not met is ever in it — not
// even as a name to resolve a link against.
import {
  parseNote,
  renderNoteWithEmbeds,
  type EmbedSource,
  type PublicNote,
  type PublicNoteDocument,
  type SearchHit,
} from '@rhizom/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { api, ApiRequestError, isAbortError, SETTLE_MS } from '../api/client.js';
import { useRenderLabels } from '../pages/render-labels.js';
import { vaultHref } from '../routing/vault.js';
import { notePathOfSplat, sessionOf, tableHref, tableResolver } from './table-model.js';

const assetUrlOf = (path: string): string => api.assetUrl(path);

type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error' };

export function TablePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { '*': splat } = useParams();
  const [params] = useSearchParams();
  const path = notePathOfSplat(splat);

  const [sessions, setSessions] = useState<Loaded<{ campaign: boolean; sessions: number[] }>>({
    state: 'loading',
  });
  useEffect(() => {
    const controller = new AbortController();
    api.tableSessions({ signal: controller.signal }).then(
      (value) => {
        setSessions({ state: 'ready', value });
      },
      (error: unknown) => {
        if (!isAbortError(error)) {
          setSessions({ state: 'error' });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, []);

  const list = sessions.state === 'ready' ? sessions.value.sessions : [];
  const session = sessionOf(params.get('session'), list);

  const [notes, setNotes] = useState<PublicNote[]>([]);
  useEffect(() => {
    if (sessions.state !== 'ready') {
      return undefined;
    }
    const controller = new AbortController();
    api.tableNotes(session, { signal: controller.signal }).then(setNotes, () => {
      setNotes([]);
    });
    return () => {
      controller.abort();
    };
  }, [session, sessions.state]);

  if (sessions.state === 'loading') {
    return <main className="rz-table" aria-busy="true" />;
  }
  if (sessions.state === 'error' || !sessions.value.campaign) {
    return (
      <main className="rz-table">
        <TableHeader session={session} sessions={list} />
        <p className="rz-table-empty">{t('table.noCampaign')}</p>
      </main>
    );
  }

  return (
    <main className="rz-table">
      <TableHeader session={session} sessions={list} />
      <p className="rz-table-banner" role="note">
        {t('table.banner')}
      </p>
      <div className="rz-table-body">
        <aside className="rz-table-side">
          <TableSearch session={session} />
          <h2>{t('table.notes')}</h2>
          {notes.length === 0 ? (
            <p className="rz-table-empty">{t('table.nothingYet')}</p>
          ) : (
            <ul className="rz-table-list">
              {notes.map((note) => (
                <li key={note.path}>
                  <Link
                    to={tableHref(note.path, session)}
                    aria-current={note.path === path ? 'page' : undefined}
                  >
                    {note.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="rz-table-note">
          {path === null ? (
            <p className="rz-table-empty">{t('table.pick')}</p>
          ) : (
            <TableNote
              key={`${path}@${String(session)}`}
              path={path}
              session={session}
              visible={notes.map((note) => note.path)}
              onNavigate={(href) => {
                void navigate(href);
              }}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function TableHeader({ session, sessions }: { session: number; sessions: number[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { '*': splat } = useParams();
  const path = notePathOfSplat(splat);
  const first = sessions[0] ?? 0;
  const last = sessions.at(-1) ?? 0;
  return (
    <header className="rz-table-header">
      <h1>{t('table.title')}</h1>
      {sessions.length === 0 ? null : (
        <label className="rz-table-session">
          <span>
            {session < first ? t('table.beforeFirst') : t('table.session', { n: session })}
          </span>
          <input
            type="range"
            min={Math.max(0, first - 1)}
            max={last}
            step={1}
            value={session}
            aria-label={t('table.sessionLabel')}
            onChange={(event) => {
              void navigate(tableHref(path, Number(event.target.value)), { replace: true });
            }}
          />
        </label>
      )}
      <Link className="rz-table-back" to={vaultHref('/')}>
        {t('table.back')}
      </Link>
    </header>
  );
}

function TableSearch({ session }: { session: number }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; hits: SearchHit[] }>({
    query: '',
    hits: [],
  });
  // The hits belong to the words they were found for; an emptied field shows none.
  const hits = query.trim() !== '' && found.query === query ? found.hits : [];
  useEffect(() => {
    if (query.trim() === '') {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.tableSearch(query, session, { signal: controller.signal }).then(
        (result) => {
          setFound({ query, hits: result });
        },
        () => {
          setFound({ query, hits: [] });
        },
      );
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, session]);
  return (
    <div className="rz-table-search">
      <input
        type="search"
        value={query}
        placeholder={t('table.search')}
        aria-label={t('table.search')}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {hits.length === 0 ? null : (
        <ul className="rz-table-list">
          {hits.map((hit) => (
            <li key={hit.path}>
              <Link to={tableHref(hit.path, session)}>{hit.title}</Link>
              {/* The snippet is escaped on the server and carries <mark> alone. */}
              <span
                className="rz-table-snippet"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TableNote({
  path,
  session,
  visible,
  onNavigate,
}: {
  path: string;
  session: number;
  visible: string[];
  onNavigate: (href: string) => void;
}) {
  const { t } = useTranslation();
  const { labels, calloutLabels, statblockLabels } = useRenderLabels();
  const [document, setDocument] = useState<Loaded<PublicNoteDocument> | { state: 'missing' }>({
    state: 'loading',
  });
  const [embeds, setEmbeds] = useState<Map<string, EmbedSource>>(new Map());

  useEffect(() => {
    // A fresh component per note and session (see the key where it is used), so nothing of the
    // last note is left in its state.
    const controller = new AbortController();
    api.tableNote(path, session, { signal: controller.signal }).then(
      (value) => {
        setDocument({ state: 'ready', value });
      },
      (error: unknown) => {
        if (isAbortError(error)) {
          return;
        }
        setDocument(
          error instanceof ApiRequestError && error.status === 404
            ? { state: 'missing' }
            : { state: 'error' },
        );
      },
    );
    return () => {
      controller.abort();
    };
  }, [path, session]);

  const resolveLink = useMemo(() => tableResolver(visible, session), [session, visible]);

  const rendered = useMemo(() => {
    if (document.state !== 'ready') {
      return undefined;
    }
    return renderNoteWithEmbeds(document.value.markdown, {
      sourcePath: path,
      resolveLink,
      assetUrl: assetUrlOf,
      readNote: (target) => embeds.get(target),
      labels,
      calloutLabels,
      statblockLabels,
    });
  }, [calloutLabels, document, embeds, labels, path, resolveLink, statblockLabels]);

  // Embedded notes are fetched through the view too, so an embed can show only what the table
  // may read of the note it names.
  const pending = rendered?.pending.join('\u0000') ?? '';
  useEffect(() => {
    if (pending === '') {
      return undefined;
    }
    const controller = new AbortController();
    for (const target of pending.split('\u0000')) {
      api.tableNote(target, session, { signal: controller.signal }).then(
        (value) => {
          setEmbeds((previous) =>
            new Map(previous).set(target, {
              markdown: value.markdown,
              headings: parseNote(value.markdown, { fallbackTitle: value.title }).headings,
            }),
          );
        },
        () => undefined,
      );
    }
    return () => {
      controller.abort();
    };
  }, [pending, session]);

  if (document.state === 'loading') {
    return <p className="rz-table-empty" aria-busy="true" />;
  }
  if (document.state !== 'ready' || rendered === undefined) {
    return <p className="rz-table-empty">{t('table.missing')}</p>;
  }
  return (
    <article
      className="rz-prose"
      onClick={(event) => {
        const href = (event.target as HTMLElement).closest('a')?.getAttribute('href') ?? '';
        if (href.startsWith('/')) {
          event.preventDefault();
          onNavigate(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}
