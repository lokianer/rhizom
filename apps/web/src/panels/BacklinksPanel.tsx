// What points here and where this note points. Both lists are fetched together and the
// request is aborted when the open note changes, so a slow answer never lands on a note it
// does not belong to.
//
// The lists also go stale without this note being touched: a rename elsewhere rewrites the
// links in other files, and nothing in this panel would hear about it. So it refetches when a
// note other than this one is reindexed, after the same settle the mentions panel waits: one
// rename writes several files and the watcher may report them in more than one batch.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Backlink, NoteLink } from '@rhizom/core';

import { api, isAbortError } from '../api/client.js';
import { noteHref } from '../app/paths.js';
import { groupBacklinks, outgoingLinks } from './backlink-model.js';
import './panels.css';

export interface BacklinksPanelProps {
  path: string | null;
  /** How often a note other than this one has been reindexed; a change means refetch. */
  elsewhere: number;
  onOpen: (path: string) => void;
}

/** How long a change elsewhere has to settle before the lists are fetched again. */
const REFETCH_DELAY_MS = 400;

interface Loaded {
  path: string;
  backlinks: Backlink[];
  links: NoteLink[];
}

export function BacklinksPanel({ path, elsewhere, onOpen }: BacklinksPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);

  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (path === null) {
      return undefined;
    }
    const first = opened.current !== path;
    opened.current = path;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const timer = setTimeout(
      () => {
        void Promise.all([api.backlinks(path, options), api.links(path, options)])
          .then(([backlinks, links]) => {
            setLoaded({ path, backlinks, links });
            setFailure(null);
          })
          .catch((error: unknown) => {
            if (!isAbortError(error)) {
              setFailure({ path, message: error instanceof Error ? error.message : String(error) });
            }
          });
      },
      first ? 0 : REFETCH_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, elsewhere]);

  if (path === null) {
    return null;
  }

  const current = loaded !== null && loaded.path === path ? loaded : null;
  const error = failure !== null && failure.path === path ? failure.message : null;
  const groups = current === null ? [] : groupBacklinks(current.backlinks);
  const outgoing = current === null ? [] : outgoingLinks(current.links);

  return (
    <aside className="rz-backlinks" aria-labelledby={titleId}>
      <h2 className="rz-backlinks-title" id={titleId}>
        {t('backlinks.label')}
        {current === null ? null : (
          <span className="rz-backlinks-count">
            {t('backlinks.count', { count: current.backlinks.length })}
          </span>
        )}
      </h2>

      {error !== null ? <p className="rz-error">{t('status.error', { message: error })}</p> : null}

      {error === null && current === null ? (
        <p className="rz-panel-status">{t('note.loading')}</p>
      ) : null}

      {current !== null && groups.length === 0 ? (
        <p className="rz-panel-empty">{t('backlinks.empty')}</p>
      ) : null}

      {groups.length > 0 ? (
        <ul className="rz-backlink-list">
          {groups.map((group) => (
            <li key={group.source}>
              <NoteAnchor path={group.source} label={group.title} onOpen={onOpen} />
              <ul className="rz-backlink-contexts">
                {group.mentions.map((mention) => (
                  <li key={mention.line} className="rz-backlink-context">
                    {mention.context}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      {outgoing.length > 0 ? (
        <>
          <h3 className="rz-backlinks-subtitle">{t('backlinks.outgoing')}</h3>
          <ul className="rz-link-list">
            {outgoing.map((link) => (
              <li key={`${String(link.line)}:${link.target ?? link.label}`}>
                {link.target === null ? (
                  <span className="rz-link-missing">
                    {link.label}
                    <span className="rz-badge">{t('backlinks.unresolved')}</span>
                  </span>
                ) : (
                  <NoteAnchor path={link.target} label={link.label} onOpen={onOpen} />
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}

interface NoteAnchorProps {
  path: string;
  label: string;
  onOpen: (path: string) => void;
}

/** A real link, so it can be opened in a new tab, that navigates inside the app on a click. */
function NoteAnchor({ path, label, onOpen }: NoteAnchorProps) {
  return (
    <a
      className="rz-note-link"
      href={noteHref(path)}
      title={path}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onOpen(path);
      }}
    >
      {label}
    </a>
  );
}
