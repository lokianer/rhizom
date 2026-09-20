// Saved searches in the sidebar, above the file tree.
//
// A note that declares `type: query` is a folder here: open it and the index fills it with
// whatever its first `rhizom-query` block finds. The searches themselves are found the same way,
// by asking `/api/query` for `type: query` — so this panel is two questions and no settings at
// all, and a vault that saves no searches shows no section.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SETTLE_MS } from '../api/client.js';
import { noteHref } from '../app/paths.js';
import { useNoteSources } from '../store/notes.js';
import { useQueryResults } from '../store/queries.js';
import {
  folderContents,
  folderCount,
  folderNote,
  pendingBody,
  SAVED_SEARCH_QUERY,
  smartFolders,
  type AnsweredFolder,
  type SmartFolder,
} from './smart-folder-model.js';
import './panels.css';

export interface SmartFoldersProps {
  activePath: string | null;
  onOpen: (path: string) => void;
}

export function SmartFolders({ activePath, onOpen }: SmartFoldersProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const answers = useQueryResults((state) => state.results);
  const requestQuery = useQueryResults((state) => state.request);
  // Which folders stand open. Component state rather than the UI store: that one is written to
  // localStorage, and what belongs there is what the reader chose to keep, not which of today's
  // saved searches happened to be unfolded.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const listed = answers[SAVED_SEARCH_QUERY];
  useAsk(listed === undefined ? SAVED_SEARCH_QUERY : null, requestQuery);
  const folders = useMemo(() => smartFolders(listed), [listed]);

  if (folders.length === 0) {
    return null;
  }

  return (
    <section className="rz-smart" aria-labelledby={titleId}>
      <h2 className="rz-smart-title" id={titleId}>
        {t('smartFolders.title')}
      </h2>
      <ul className="rz-smart-list">
        {folders.map((folder) => (
          <SmartFolderRow
            key={folder.path}
            folder={folder}
            open={expanded.has(folder.path)}
            activePath={activePath}
            onToggle={() => {
              setExpanded((previous) => {
                const next = new Set(previous);
                if (!next.delete(folder.path)) {
                  next.add(folder.path);
                }
                return next;
              });
            }}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

interface SmartFolderRowProps {
  folder: SmartFolder;
  open: boolean;
  activePath: string | null;
  onToggle: () => void;
  onOpen: (path: string) => void;
}

function SmartFolderRow({ folder, open, activePath, onToggle, onOpen }: SmartFolderRowProps) {
  const { t } = useTranslation();
  const contentsId = useId();
  const sources = useNoteSources((state) => state.sources);
  const requestSource = useNoteSources((state) => state.request);
  const answers = useQueryResults((state) => state.results);
  const requestQuery = useQueryResults((state) => state.request);

  // A closed folder asks for nothing: no note, and therefore no query either.
  const content = open ? sources[folder.path]?.content : undefined;
  useAsk(open && content === undefined ? folder.path : null, requestSource);

  // Memoised on the text alone, so that another note arriving in the store does not send this
  // one through the Markdown parser again.
  const note = useMemo(() => folderNote(content), [content]);
  useAsk(pendingBody(note, answers), requestQuery);

  const contents = open ? folderContents(note, answers) : null;
  const count = folderCount(contents);

  return (
    <li className="rz-smart-folder">
      <button
        type="button"
        className="rz-tree-row rz-tree-row-folder rz-smart-row"
        aria-expanded={open}
        {...(open ? { 'aria-controls': contentsId } : {})}
        title={folder.path}
        onClick={onToggle}
      >
        <span className="rz-tree-twisty" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="rz-tree-label">{folder.title}</span>
        {count === null ? null : (
          <span className="rz-smart-count">{t('smartFolders.notes', { count })}</span>
        )}
      </button>

      {contents === null ? null : (
        <div id={contentsId}>
          {contents.state === 'loading' ? (
            <p className="rz-smart-line">{t('query.loading')}</p>
          ) : null}
          {contents.state === 'noBlock' ? (
            <p className="rz-smart-line">{t('smartFolders.noBlock')}</p>
          ) : null}
          {contents.state === 'failed' ? (
            <p className="rz-smart-line">
              {t('smartFolders.error', { message: contents.message })}
            </p>
          ) : null}
          {contents.state === 'ready' ? (
            <SmartFolderResult
              contents={contents}
              label={folder.title}
              activePath={activePath}
              onOpen={onOpen}
            />
          ) : null}
        </div>
      )}
    </li>
  );
}

interface SmartFolderResultProps {
  contents: AnsweredFolder;
  /** The folder's own name, so the list of notes under it says whose it is. */
  label: string;
  activePath: string | null;
  onOpen: (path: string) => void;
}

function SmartFolderResult({ contents, label, activePath, onOpen }: SmartFolderResultProps) {
  const { t } = useTranslation();
  const { rows, total, problems } = contents.result;

  return (
    <>
      {rows.length === 0 ? <p className="rz-smart-line">{t('query.empty')}</p> : null}
      {rows.length === 0 ? null : (
        <ul className="rz-smart-notes" aria-label={label}>
          {rows.map((row) => (
            <li key={row.path}>
              <a
                className={`rz-tree-row rz-tree-row-note rz-smart-row${
                  row.path === activePath ? ' rz-tree-row-active' : ''
                }`}
                href={noteHref(row.path)}
                title={row.path}
                aria-current={row.path === activePath ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                    return;
                  }
                  event.preventDefault();
                  onOpen(row.path);
                }}
              >
                <span className="rz-tree-twisty" aria-hidden="true" />
                <span className="rz-tree-label">{row.title}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {total > rows.length ? (
        <p className="rz-smart-line">{t('query.more', { shown: rows.length, total })}</p>
      ) : null}
      {contents.blocks > 1 ? (
        <p className="rz-smart-line">{t('smartFolders.firstBlock', { total: contents.blocks })}</p>
      ) : null}
      {problems.length === 0 ? null : (
        <ul className="rz-smart-problems">
          {problems.map((problem) => (
            <li key={`${String(problem.line)}:${problem.message}`}>
              {/* A line of 0 is the parser saying the complaint is about the block as a whole;
                  the rendered block words it the same way. */}
              {problem.line === 0
                ? t('query.blockProblem', { message: problem.message })
                : t('query.problem', { line: problem.line, message: problem.message })}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Asks for something — a note to fetch, a query body to answer — and waits a moment first when it
 * has asked for that same thing before.
 *
 * A second asking only ever comes from the index: both stores drop what they are holding when the
 * vault changes, and the panel then wants it all again. The first asking is somebody waiting for
 * the panel to appear or for a folder to unfold, and waits for nothing.
 */
function useAsk(wanted: string | null, ask: (wanted: string) => void): void {
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (wanted === null) {
      return undefined;
    }
    if (!asked.current.has(wanted)) {
      asked.current.add(wanted);
      ask(wanted);
      return undefined;
    }
    const timer = setTimeout(() => {
      ask(wanted);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [wanted, ask]);
}
