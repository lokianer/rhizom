// The milieu half of the graph page: pick a field, draw it, and write a drag back into the note.
//
// A field is a note, the way a saved search is a note — `type: axes` in the frontmatter, six flat
// keys naming the two directions, and a `rhizom-query` block saying which notes stand in it. So
// this asks the index three questions and keeps no settings of its own: which notes declare a
// field, what the chosen one says, and what its block finds. The positions come back with that
// third answer, because `/api/query` will hand over any frontmatter key a caller names.
import {
  queryBlocks,
  readAxes,
  setFrontmatter,
  type AxesPoint,
  type AxesSettings,
  type QueryResult,
  type QueryRow,
} from '@rhizom/core';
import { useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useOutletContext } from 'react-router';

import { api, ApiRequestError, isAbortError } from '../api/client.js';
import { GraphLayoutSelect } from '../pages/GraphLayoutSelect.js';
import type { OutletContext } from '../app/outlet.js';
import { noteHref } from '../routing/paths.js';
import { revisionOf } from '../app/useIndexEvents.js';
import { downloadBlob } from '../graph/index.js';
import { useUiStore } from '../store/ui.js';
import { MilieuField, type MilieuFieldHandle } from './MilieuField.js';
import {
  awaitEcho,
  chosenField,
  fieldNotes,
  forgetEcho,
  indexedPosition,
  milieuFields,
  positionChanges,
  watchedEvents,
  writtenPosition,
  AXES_NOTES_QUERY,
  NO_ECHOES,
  type MilieuField as MilieuFieldNote,
  type PlacedNote,
  type UnplacedNote,
  type WrittenPositions,
} from './milieu-model.js';

/** What the note declaring the field says, once it has been read. */
interface FieldDeclaration {
  path: string;
  /** Null when the note names fewer than two keys, and so has begun a field rather than made one. */
  axes: AxesSettings | null;
  /** The first `rhizom-query` block, or undefined when the note holds none. */
  body: string | undefined;
}

/** An answer, stamped with the block it answers, so it is never read for a different field. */
interface AnsweredBlock {
  body: string;
  result: QueryResult;
}

/** One array, so a field with no answer yet does not hand the memo below a new one each render. */
const NO_ROWS: QueryRow[] = [];

export function MilieuLayout(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { revisions } = useOutletContext<OutletContext>();
  const clusterBy = useUiStore((state) => state.clusterBy);
  const setClusterBy = useUiStore((state) => state.setClusterBy);
  const remembered = useUiStore((state) => state.milieuPath);
  const setMilieuPath = useUiStore((state) => state.setMilieuPath);
  const fieldRef = useRef<MilieuFieldHandle>(null);

  const [ledger, setLedger] = useState(NO_ECHOES);
  const [fields, setFields] = useState<MilieuFieldNote[] | null>(null);
  const [declaration, setDeclaration] = useState<FieldDeclaration | null>(null);
  const [answered, setAnswered] = useState<AnsweredBlock | null>(null);
  const [written, setWritten] = useState<WrittenPositions>({});
  const [error, setError] = useState('');
  const [trouble, setTrouble] = useState('');

  // Every index event except the ones this view's own writing caused. Without the subtraction a
  // drag would send the whole field back to the index and bring the bubble home the long way.
  const watched = watchedEvents(ledger, revisions);

  useEffect(() => {
    const controller = new AbortController();
    api
      .runQuery(AXES_NOTES_QUERY, undefined, { signal: controller.signal })
      .then((result) => {
        setFields(milieuFields(result));
        setError('');
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) {
          setError(messageOf(cause));
        }
      });
    return () => {
      controller.abort();
    };
  }, [watched]);

  const chosen = fields === null ? null : chosenField(fields, remembered);
  const chosenPath = chosen?.path ?? null;
  const declarationRevision = revisionOf(revisions, chosenPath);

  // What is held is always stamped with the note or the block it belongs to, and read back only
  // when the stamp still matches. Nothing is cleared on the way out of one field and into the
  // next, because clearing state is what an effect may not do.
  useEffect(() => {
    if (chosenPath === null) {
      return undefined;
    }
    const controller = new AbortController();
    api
      .note(chosenPath, { signal: controller.signal })
      .then((doc) => {
        setDeclaration({
          path: doc.path,
          axes: readAxes(doc.frontmatter),
          body: queryBlocks(doc.content)[0],
        });
        setError('');
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) {
          setError(messageOf(cause));
        }
      });
    return () => {
      controller.abort();
    };
  }, [chosenPath, declarationRevision]);

  // Only read back while the stamp matches: between choosing another field and its note arriving,
  // what is held describes the one before, and drawing that would be worse than saying nothing.
  const declared = declaration?.path === chosenPath ? declaration : null;
  const axes = declared?.axes ?? null;
  const body = declared?.body;
  const xKey = axes?.x.key;
  const yKey = axes?.y.key;

  useEffect(() => {
    if (body === undefined || xKey === undefined || yKey === undefined) {
      return undefined;
    }
    const controller = new AbortController();
    api
      .runQuery(body, [xKey, yKey], { signal: controller.signal })
      .then((result) => {
        setAnswered({ body, result });
        setError('');
      })
      .catch((cause: unknown) => {
        if (!isAbortError(cause)) {
          setError(messageOf(cause));
        }
      });
    return () => {
      controller.abort();
    };
  }, [body, xKey, yKey, watched]);

  const answer = answerTo(answered, body);
  const rows = answer?.rows ?? NO_ROWS;

  const { placed, unplaced } = useMemo(
    () =>
      axes === null ? { placed: [], unplaced: [] } : fieldNotes(rows, axes, clusterBy, written),
    [rows, axes, clusterBy, written],
  );

  const openNote = (path: string): void => {
    void navigate(noteHref(path));
  };

  /**
   * A bubble was let go. One write, at the end of the gesture rather than on every step of it,
   * and the note is fetched first so the save can carry the hash the file had when it was read:
   * a change that arrived in between is refused rather than overwritten.
   */
  const placeNote = (path: string, point: AxesPoint): void => {
    if (axes === null) {
      return;
    }
    const changes = positionChanges(axes, point);
    if (changes === null) {
      return;
    }
    setTrouble('');
    // Where the pointer left it, before the round trip: the bubble stays put while the file
    // catches up, and nothing on screen moves twice for one gesture. What the index was saying
    // goes along with it, so the drawing gives way again as soon as the index says anything else.
    const before = indexedPosition(
      rows.find((row) => row.path === path),
      axes,
    );
    setWritten((previous) => ({ ...previous, [path]: writtenPosition(axes, changes, before) }));
    // Remembered before the write goes out, not after: the watcher may well have reported the
    // change before the response comes back.
    setLedger((previous) => awaitEcho(previous, path, revisions));

    const abandon = (message: string): void => {
      setLedger((previous) => forgetEcho(previous, path));
      setWritten((previous) => without(previous, path));
      setTrouble(message);
    };

    api
      .note(path)
      .then(async (doc) => {
        const content = setFrontmatter(doc.content, changes);
        if (content === doc.content) {
          // The note already says this. Nothing is written, so nothing will be reported back.
          setLedger((previous) => forgetEcho(previous, path));
          return;
        }
        await api.saveNote(path, { content }, doc.hash);
      })
      .catch((cause: unknown) => {
        abandon(
          cause instanceof ApiRequestError && cause.isConflict
            ? t('axes.changedOnDisk', { title: titleOf(path, placed, unplaced) })
            : t('axes.writeFailed', { message: messageOf(cause) }),
        );
      });
  };

  const exportSvg = (): void => {
    const svg = fieldRef.current?.toSvg();
    if (svg !== undefined) {
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'rhizom-milieu.svg');
    }
  };

  const exportPng = (): void => {
    void fieldRef.current?.toPng().then((blob) => {
      downloadBlob(blob, 'rhizom-milieu.png');
    });
  };

  return (
    <div className="rz-graph-page">
      <div className="rz-graph-controls">
        <GraphLayoutSelect />

        <div className="rz-field">
          <label htmlFor="rz-milieu-field-note">{t('axes.field')}</label>{' '}
          <select
            id="rz-milieu-field-note"
            value={chosenPath ?? ''}
            disabled={fields === null || fields.length === 0}
            onChange={(event) => {
              setMilieuPath(event.target.value);
            }}
          >
            {fields === null || fields.length === 0 ? (
              <option value="">{t('axes.noFields')}</option>
            ) : (
              fields.map((field) => (
                <option key={field.path} value={field.path}>
                  {field.title}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="rz-field">
          <label htmlFor="rz-milieu-cluster-by">{t('graph.clusterBy')}</label>{' '}
          <select
            id="rz-milieu-cluster-by"
            value={clusterBy}
            onChange={(event) => {
              setClusterBy(event.target.value === 'tag' ? 'tag' : 'folder');
            }}
          >
            <option value="folder">{t('graph.folder')}</option>
            <option value="tag">{t('graph.tag')}</option>
          </select>
        </div>

        <span className="rz-milieu-count">
          {t('axes.placed', { count: placed.length })} ·{' '}
          {t('axes.unplaced', { count: unplaced.length })}
        </span>

        <button type="button" disabled={axes === null} onClick={exportSvg}>
          {t('graph.exportSvg')}
        </button>
        <button type="button" disabled={axes === null} onClick={exportPng}>
          {t('graph.exportPng')}
        </button>

        {trouble === '' ? null : (
          <span className="rz-milieu-trouble" role="status">
            {trouble}
          </span>
        )}
      </div>

      <div className="rz-graph-stage">
        <Stage
          error={error}
          fields={fields}
          chosen={chosen}
          read={declared !== null}
          axes={axes}
          body={body}
          answer={answer}
          placed={placed}
          unplaced={unplaced}
          onOpenNote={openNote}
          onPlaceNote={placeNote}
          fieldRef={fieldRef}
        />
      </div>
    </div>
  );
}

interface StageProps {
  error: string;
  fields: MilieuFieldNote[] | null;
  chosen: MilieuFieldNote | null;
  /** Whether the chosen field's own note has been read; until then there is nothing to say. */
  read: boolean;
  axes: AxesSettings | null;
  body: string | undefined;
  answer: QueryResult | null;
  placed: readonly PlacedNote[];
  unplaced: readonly UnplacedNote[];
  onOpenNote: (path: string) => void;
  onPlaceNote: (path: string, point: AxesPoint) => void;
  fieldRef: RefObject<MilieuFieldHandle | null>;
}

/** The field, or the one sentence saying why there is none to draw. */
function Stage({
  error,
  fields,
  chosen,
  read,
  axes,
  body,
  answer,
  placed,
  unplaced,
  onOpenNote,
  onPlaceNote,
  fieldRef,
}: StageProps): JSX.Element {
  const { t } = useTranslation();

  if (error !== '') {
    return <p className="rz-page rz-error">{t('status.error', { message: error })}</p>;
  }
  if (fields === null) {
    return <p className="rz-page">{t('status.loading')}</p>;
  }
  if (chosen === null) {
    return <p className="rz-page">{t('axes.empty')}</p>;
  }
  if (!read) {
    return <p className="rz-page">{t('status.loading')}</p>;
  }
  if (axes === null) {
    return <p className="rz-page">{t('axes.noAxes')}</p>;
  }
  if (body === undefined) {
    return <p className="rz-page">{t('axes.noBlock')}</p>;
  }
  if (answer === null) {
    return <p className="rz-page">{t('query.loading')}</p>;
  }

  return (
    <MilieuField
      ref={fieldRef}
      axes={axes}
      placed={placed}
      unplaced={unplaced}
      label={t('axes.label', { title: chosen.title })}
      onOpenNote={onOpenNote}
      onPlaceNote={onPlaceNote}
    />
  );
}

/** The answer held, but only while it is the answer to the block the chosen field is asking. */
function answerTo(answered: AnsweredBlock | null, body: string | undefined): QueryResult | null {
  if (answered === null || body === undefined || answered.body !== body) {
    return null;
  }
  return answered.result;
}

/** The note's own name, for a message about it; the path is all there is when it is not listed. */
function titleOf(
  path: string,
  placed: readonly { path: string; title: string }[],
  unplaced: readonly { path: string; title: string }[],
): string {
  return [...placed, ...unplaced].find((note) => note.path === path)?.title ?? path;
}

function without(positions: WrittenPositions, path: string): WrittenPositions {
  const { [path]: _dropped, ...rest } = positions;
  return rest;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
