// What a note is in the network, in a bar under the field rather than a card over it: the field
// is the thing being read, and nothing that describes one note may cover its neighbours. Shows
// the note under the pointer, else the open note, else a line on how to get either.
import { useSyncExternalStore, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

import type { HoverInfo } from './controller.js';
import type { HoverStore } from './hover-store.js';

export interface GraphInfoProps {
  hover: HoverStore;
  /** The open note, shown while the pointer rests on none. */
  open: HoverInfo | null;
  /** How the clusters were formed: the words beside the swatch name what its colour stands for. */
  clusterBy: 'folder' | 'tag';
}

export function GraphInfo({ hover, open, clusterBy }: GraphInfoProps): JSX.Element {
  const { t } = useTranslation();
  const info = useSyncExternalStore(hover.subscribe, hover.get) ?? open;
  if (info === null) {
    return (
      <div className="rz-graph-info" aria-live="off">
        <span className="rz-graph-info-hint">{t('graph.infoHint')}</span>
      </div>
    );
  }
  const links = info.inDegree + info.outDegree;
  const incoming = links === 0 ? 0 : info.inDegree / links;
  return (
    <div className="rz-graph-info" aria-live="off">
      <span
        className="rz-graph-swatch"
        style={{ background: `var(--rz-cluster-${String(info.slot + 1)})` }}
        aria-hidden="true"
      />
      <span className="rz-graph-info-name">{info.name}</span>
      {/* Coloured by tag, the swatch stands for the note's tag, which its folder does not name. */}
      {clusterBy === 'tag' ? (
        <span className="rz-graph-info-cluster">
          {info.cluster === '' ? t('graph.untagged') : info.cluster}
        </span>
      ) : (
        <span className="rz-graph-info-folder">
          {info.folder === '' ? t('graph.vaultRoot') : info.folder}
        </span>
      )}
      <dl className="rz-graph-info-figures">
        <div>
          <dt>{t('graph.backlinks')}</dt>
          <dd>{info.inDegree}</dd>
        </div>
        <div>
          <dt>{t('graph.outgoing')}</dt>
          <dd>{info.outDegree}</dd>
        </div>
        <div>
          <dt>{t('graph.rank')}</dt>
          <dd>
            {info.rank}{' '}
            <span className="rz-graph-info-of">{t('graph.rankOf', { total: info.total })}</span>
          </dd>
        </div>
      </dl>
      <span className="rz-graph-info-bar" aria-hidden="true">
        <span style={{ flexGrow: incoming }} />
        <span style={{ flexGrow: 1 - incoming }} />
      </span>
    </div>
  );
}
