// The graph page, in two layouts. The bubble field is the whole vault, or the neighbourhood of
// the open note, optionally narrowed to a few tags; the canvas owns its own layout and this page
// only feeds it data. The milieu field is the same vault laid out between two axes a note names,
// and lives in ../milieu.
import type { GraphResponse } from '@rhizom/core';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { api, isAbortError } from '../api/client.js';
import { downloadBlob, GraphCanvas, type GraphCanvasHandle } from '../graph/index.js';
import { MilieuLayout } from '../milieu/MilieuLayout.js';
import { matchesTags } from '../panels/tag-model.js';
import { useUiStore } from '../store/ui.js';
import { useVaultStore } from '../store/vault.js';
import { GraphLayoutSelect } from './GraphLayoutSelect.js';
import { noteHref } from './paths.js';

const DEPTHS = [0, 1, 2, 3];

export function GraphPage(): JSX.Element {
  const layout = useUiStore((state) => state.graphLayout);
  return layout === 'milieu' ? <MilieuLayout /> : <BubbleLayout />;
}

function BubbleLayout(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const note = searchParams.get('note');
  const notes = useVaultStore((state) => state.notes);
  const clusterBy = useUiStore((state) => state.clusterBy);
  const setClusterBy = useUiStore((state) => state.setClusterBy);
  const depth = useUiStore((state) => state.graphDepth);
  const setGraphDepth = useUiStore((state) => state.setGraphDepth);
  const graphTags = useUiStore((state) => state.graphTags);

  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState('');
  const canvasRef = useRef<GraphCanvasHandle>(null);

  const local = depth > 0 && note !== null;

  useEffect(() => {
    const controller = new AbortController();
    const request = local
      ? api.localGraph(note, depth, clusterBy, { signal: controller.signal })
      : api.graph(clusterBy, { signal: controller.signal });
    request.then(setGraph).catch((cause: unknown) => {
      if (!isAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => {
      controller.abort();
    };
  }, [clusterBy, depth, local, note]);

  // Tag filtering happens here rather than on the server: the note list is already loaded,
  // and switching filters then costs no round trip.
  const filtered = useMemo<GraphResponse | null>(() => {
    if (graph === null || graphTags.length === 0) {
      return graph;
    }
    const tagged = new Set(
      notes.filter((entry) => matchesTags(entry.tags, graphTags)).map((e) => e.path),
    );
    const nodes = graph.nodes.filter((node) => tagged.has(node.path));
    const kept = new Set(nodes.map((node) => node.path));
    return {
      nodes,
      edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
      clusters: [...new Set(nodes.map((node) => node.cluster))].sort(),
    };
  }, [graph, graphTags, notes]);

  const openNote = useCallback(
    (path: string) => {
      void navigate(noteHref(path));
    },
    [navigate],
  );

  if (error !== '') {
    return <p className="rz-page rz-error">{t('status.error', { message: error })}</p>;
  }

  return (
    <div className="rz-graph-page">
      <div className="rz-graph-controls">
        <GraphLayoutSelect />

        <div className="rz-field">
          <label htmlFor="rz-cluster-by">{t('graph.clusterBy')}</label>{' '}
          <select
            id="rz-cluster-by"
            value={clusterBy}
            onChange={(event) => {
              setClusterBy(event.target.value === 'tag' ? 'tag' : 'folder');
            }}
          >
            <option value="folder">{t('graph.folder')}</option>
            <option value="tag">{t('graph.tag')}</option>
          </select>
        </div>

        <div className="rz-field">
          <label htmlFor="rz-graph-depth">{t('graph.depth')}</label>{' '}
          <select
            id="rz-graph-depth"
            value={depth}
            disabled={note === null}
            onChange={(event) => {
              setGraphDepth(Number(event.target.value));
            }}
          >
            {DEPTHS.map((value) => (
              <option key={value} value={value}>
                {value === 0 ? t('graph.wholeVault') : t('graph.depthOf', { count: value })}
              </option>
            ))}
          </select>
        </div>

        <span className="rz-muted">
          {t('graph.nodes', { count: filtered?.nodes.length ?? 0 })} ·{' '}
          {t('graph.edges', { count: filtered?.edges.length ?? 0 })}
        </span>

        <button
          type="button"
          onClick={() => {
            canvasRef.current?.resetView();
          }}
        >
          {t('graph.resetView')}
        </button>
        <button
          type="button"
          onClick={() => {
            const svg = canvasRef.current?.toSvg();
            if (svg !== undefined) {
              downloadBlob(
                new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
                'rhizom-graph.svg',
              );
            }
          }}
        >
          {t('graph.exportSvg')}
        </button>
        <button
          type="button"
          onClick={() => {
            void canvasRef.current?.toPng().then((blob) => {
              downloadBlob(blob, 'rhizom-graph.png');
            });
          }}
        >
          {t('graph.exportPng')}
        </button>
      </div>

      <div className="rz-graph-stage">
        {filtered === null ? (
          <p className="rz-page">{t('status.loading')}</p>
        ) : filtered.nodes.length === 0 ? (
          <p className="rz-page">{t('graph.empty')}</p>
        ) : (
          <GraphCanvas
            ref={canvasRef}
            data={filtered}
            selected={note}
            label={t('graph.label')}
            onOpenNote={openNote}
          />
        )}
      </div>
    </div>
  );
}
