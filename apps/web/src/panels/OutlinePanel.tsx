// The open note's headings, as the fourth panel of the sidebar: the table of contents the note
// writes itself. Nothing is stored — a heading typed into the note grows a row here as soon as
// the file is saved and the index says so.
//
// A row leads to `/notes/…#slug`, the address the renderer gives that heading and the one a
// `[[Note#Heading]]` link resolves to. Nothing in the app scrolls to a fragment yet, so for now
// following a row opens the note and records where in it the reader wanted to be; the day the
// note page reads the fragment, these links arrive there without being changed.
import type { Heading } from '@rhizom/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { api, isAbortError, SETTLE_MS } from '../api/client.js';
import { headingHref } from '../routing/paths.js';
import { outlineRows, slugFromHash } from './outline-model.js';
import './panels.css';

export interface OutlinePanelProps {
  /** The note on screen, whose headings this lists; null when no note is open. */
  activePath: string | null;
  /**
   * How often the index has reported *this* note changed. The other panels watch the rest of
   * the vault and deliberately ignore the open note's own saves; an outline is the one thing
   * in the sidebar that has to follow them, because writing a heading is what changes it.
   */
  revision: number;
  /** Opens a note, at one of its headings when a fragment is given. */
  onOpen: (path: string, fragment?: string) => void;
}

interface Loaded {
  path: string;
  headings: Heading[];
}

export function OutlinePanel({ activePath, revision, onOpen }: OutlinePanelProps) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  // Another note is fetched at once; the same note again has changed under the reader and can
  // wait for the writing to stop.
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (activePath === null) {
      return undefined;
    }
    const first = opened.current !== activePath;
    opened.current = activePath;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        api
          .note(activePath, { signal: controller.signal })
          .then((doc) => {
            setLoaded({ path: activePath, headings: doc.headings });
            setFailure(null);
          })
          .catch((error: unknown) => {
            if (!isAbortError(error)) {
              setFailure({
                path: activePath,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          });
      },
      first ? 0 : SETTLE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activePath, revision]);

  if (activePath === null) {
    return (
      <div className="rz-panel">
        <p className="rz-panel-empty">{t('outline.noNote')}</p>
      </div>
    );
  }

  // Anything loaded for another note belongs to that one; this panel shows nothing it cannot
  // vouch for.
  const current = loaded !== null && loaded.path === activePath ? loaded : null;
  const error = failure !== null && failure.path === activePath ? failure.message : null;
  const rows = current === null ? [] : outlineRows(current.headings);
  // Where the reader last asked to be. The address is the only thing that knows it: the editor
  // does not say which line the cursor is on, so `headingAt` has nothing to read yet.
  const here = slugFromHash(hash);

  return (
    <div className="rz-panel">
      {error !== null ? (
        <p className="rz-panel-empty rz-error">{t('status.error', { message: error })}</p>
      ) : null}
      {error === null && current === null ? (
        <p className="rz-panel-empty">{t('note.loading')}</p>
      ) : null}
      {error === null && current !== null && rows.length === 0 ? (
        <p className="rz-panel-empty">{t('outline.empty')}</p>
      ) : null}

      {rows.length === 0 ? null : (
        <div className="rz-outline">
          <ul className="rz-outline-list" aria-label={t('outline.label')}>
            {rows.map((row) => {
              const marked = here !== null && row.slug === here;
              return (
                <li key={`${String(row.line)}:${row.slug}`}>
                  <a
                    className={`rz-tree-row rz-tree-row-note rz-outline-row${
                      marked ? ' rz-tree-row-active' : ''
                    }`}
                    style={{ paddingInlineStart: indentOf(row.depth) }}
                    data-depth={row.depth}
                    href={headingHref(activePath, row.slug)}
                    title={row.text}
                    aria-current={marked ? 'location' : undefined}
                    onClick={(event) => {
                      // A modified click is the reader asking the browser for a second tab or
                      // a window; the href is a real address, so leave it to them.
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                        return;
                      }
                      event.preventDefault();
                      onOpen(activePath, row.slug);
                    }}
                  >
                    <span className="rz-tree-twisty" aria-hidden="true" />
                    <span className="rz-tree-label">
                      {row.text === '' ? t('outline.untitled') : row.text}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One step per heading the row hangs under, the same step the file tree indents by. */
function indentOf(depth: number): string {
  return `calc(var(--rz-space-2) + ${String(depth)} * var(--rz-space-4))`;
}
