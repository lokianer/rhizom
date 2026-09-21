// Where this note is named without a link leading to it, and the one button that changes that.
//
// The list refetches when the index reports a change, because "Link all" rewrites other notes
// and the list it was built from is stale the moment it does. Each mention carries the hash of
// the file it was found in; the server refuses a file that changed meanwhile rather than
// overwriting it, and says which ones it refused.
import type { MentionsResponse } from '@rhizom/core';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, isAbortError, SETTLE_MS } from '../api/client.js';
import { noteHref } from '../routing/paths.js';
import {
  countMentions,
  keepSelection,
  keyOf,
  linkableKeys,
  noteCount,
  writesFor,
  type MentionKey,
} from './mention-model.js';
import './panels.css';

export interface MentionsPanelProps {
  path: string | null;
  /**
   * How often the index has reported a note *other than this one* changed. Typing in the open
   * note cannot add a mention of it to another note, so its own saves are deliberately not a
   * reason to scan again: a scan is a full-text query plus up to two hundred file reads.
   */
  elsewhere: number;
  onOpen: (path: string) => void;
}

interface Loaded {
  path: string;
  response: MentionsResponse;
}

export function MentionsPanel({ path, elsewhere, onOpen }: MentionsPanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<MentionKey>>(new Set());
  const [writing, setWriting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Every mention this panel has already offered for the note now open. A scan that finds one
  // of them again must not re-tick it: an unticked box is an answer, and a batch write that
  // rewrites the notes the reader took out of it is the one thing this panel may never do.
  const offered = useRef<{ path: string | null; keys: ReadonlySet<MentionKey> }>({
    path: null,
    keys: new Set(),
  });

  useEffect(() => {
    if (path === null) {
      return undefined;
    }
    const first = offered.current.path !== path;
    if (first) {
      offered.current = { path, keys: new Set() };
      setOutcome(null);
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        api
          .mentions(path, { signal: controller.signal })
          .then((response) => {
            setLoaded({ path, response });
            setFailure(null);
            const linkable = linkableKeys(response.groups);
            const known = offered.current.keys;
            setSelected((previous) => keepSelection(previous, linkable, known));
            offered.current = { path, keys: new Set([...known, ...linkable]) };
          })
          .catch((error: unknown) => {
            if (!isAbortError(error)) {
              setFailure({ path, message: error instanceof Error ? error.message : String(error) });
            }
          });
      },
      first ? 0 : SETTLE_MS,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, elsewhere, reload]);

  const current = loaded !== null && loaded.path === path ? loaded.response : null;
  const groups = current?.groups ?? [];
  const writes = writesFor(groups, selected);

  const linkSelected = useCallback(() => {
    if (path === null || writes.length === 0) {
      return;
    }
    setWriting(true);
    setOutcome(null);
    api
      .linkMentions({ path, writes })
      .then((result) => {
        const linked = result.linked.reduce((total, entry) => total + entry.count, 0);
        const done = t('mentions.linked', { count: linked });
        setOutcome(
          result.skipped.length === 0
            ? done
            : `${done} ${t('mentions.conflicts', { count: result.skipped.length })}`,
        );
        if (result.linked.length === 0) {
          // Nothing was written, so no index event is coming — but every hash in the list is
          // stale, and scanning again is what turns a second attempt into a working one.
          setReload((previous) => previous + 1);
        }
      })
      .catch((error: unknown) => {
        setOutcome(t('status.error', { message: error instanceof Error ? error.message : '' }));
      })
      .finally(() => {
        setWriting(false);
      });
  }, [path, t, writes]);

  if (path === null) {
    return null;
  }

  const error = failure !== null && failure.path === path ? failure.message : null;
  const total = countMentions(groups);

  return (
    <aside className="rz-mentions" aria-labelledby={titleId}>
      <h3 id={titleId}>{t('mentions.title')}</h3>

      {error !== null ? <p className="rz-error">{t('status.error', { message: error })}</p> : null}
      {error === null && current === null ? <p className="rz-muted">{t('note.loading')}</p> : null}
      {error === null && current !== null && total === 0 ? (
        <p className="rz-muted">{t('mentions.empty')}</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.source} className="rz-mention-group">
          <h4>
            <a
              className="rz-note-link"
              href={noteHref(group.source)}
              title={group.source}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                  return;
                }
                event.preventDefault();
                onOpen(group.source);
              }}
            >
              {group.sourceTitle}
            </a>
          </h4>
          <ul className="rz-mention-list">
            {group.mentions.map((mention) => {
              const key = keyOf(group.source, mention.start);
              return (
                <li key={key} className="rz-mention">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={!mention.linkable || writing}
                      // The line alone does not say which note it is in, and the heading above
                      // it is out of earshot once a reader is stepping from box to box. The
                      // placeholder is `line` rather than `context`, which i18next spends on
                      // picking a variant key.
                      aria-label={t('mentions.mentionLabel', {
                        note: group.sourceTitle,
                        line: mention.context,
                      })}
                      onChange={() => {
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (next.has(key)) {
                            next.delete(key);
                          } else {
                            next.add(key);
                          }
                          return next;
                        });
                      }}
                    />
                    <span className="rz-mention-context">{mention.context}</span>
                  </label>
                  {mention.inHeading ? (
                    <span className="rz-mention-note rz-muted">{t('mentions.inHeading')}</span>
                  ) : null}
                  {mention.linkable ? null : (
                    <span className="rz-mention-note rz-muted">{t('mentions.notLinkable')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {current?.truncated === true ? <p className="rz-muted">{t('mentions.truncated')}</p> : null}

      {writes.length === 0 ? null : (
        <div className="rz-mention-actions">
          <button type="button" onClick={linkSelected} disabled={writing}>
            {writing ? t('mentions.linking') : t('mentions.linkAll', { count: noteCount(writes) })}
          </button>
        </div>
      )}
      {outcome === null ? null : (
        <p className="rz-muted" role="status">
          {outcome}
        </p>
      )}
    </aside>
  );
}
