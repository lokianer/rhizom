// The key to the field's colours: one row per cluster with its count. Hovering or focusing a row
// lifts that cluster out of the field; clicking it flies there.
import { useCallback, useId, useLayoutEffect, useRef, useState, type JSX, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

export interface LegendEntry {
  readonly key: string;
  readonly count: number;
  /** Palette slot the cluster's notes are drawn in. */
  readonly slot: number;
}

export interface GraphLegendProps {
  entries: readonly LegendEntry[];
  clusterBy: 'folder' | 'tag';
  onFocusCluster: (cluster: string | null) => void;
  onFlyToCluster: (cluster: string) => void;
  ref?: Ref<HTMLElement>;
}

/**
 * A field smaller than this, in rem, starts with the legend folded: open, its rows would cover
 * most of what they are the key to. The zoom control lies down in a row under the same sizes
 * (graph.css).
 */
const CRAMPED_WIDTH_REM = 36;
const CRAMPED_HEIGHT_REM = 20;

function cramped(field: HTMLElement): boolean {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return (
    field.clientWidth < CRAMPED_WIDTH_REM * rem || field.clientHeight < CRAMPED_HEIGHT_REM * rem
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export function GraphLegend({
  entries,
  clusterBy,
  onFocusCluster,
  onFlyToCluster,
  ref,
}: GraphLegendProps): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const sectionRef = useRef<HTMLElement | null>(null);
  const hintId = useId();
  const title = clusterBy === 'tag' ? t('graph.legendTags') : t('graph.legendFolders');

  const attach = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  // Once, before the first paint, so a small field never shows the legend open for a frame.
  useLayoutEffect(() => {
    const field = sectionRef.current?.parentElement;
    if (field && cramped(field)) {
      setOpen(false);
    }
  }, []);

  return (
    <section
      ref={attach}
      className="rz-graph-legend"
      aria-label={title}
      onPointerLeave={(event) => {
        // Back to the row that holds the keyboard focus, if one does: the pointer only passed by.
        const focused = document.activeElement;
        onFocusCluster(
          focused instanceof HTMLElement &&
            event.currentTarget.contains(focused) &&
            focused.dataset.cluster !== undefined
            ? focused.dataset.cluster
            : null,
        );
      }}
    >
      <button
        type="button"
        className="rz-graph-legend-head"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          onFocusCluster(null);
        }}
      >
        <span>{title}</span>
        <span className="rz-graph-legend-count">{t('graph.nodes', { count: sum(entries) })}</span>
      </button>
      {open ? (
        <ul className="rz-graph-legend-list">
          {entries.map((entry) => {
            const name =
              entry.key === ''
                ? clusterBy === 'tag'
                  ? t('graph.untagged')
                  : t('graph.vaultRoot')
                : entry.key;
            // No aria-label: the row's own words, the name and the count, are its name, so a
            // screen reader hears the count a sighted reader sees. What a click does is the
            // description.
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  className="rz-graph-legend-row"
                  data-cluster={entry.key}
                  aria-describedby={hintId}
                  onPointerEnter={() => {
                    onFocusCluster(entry.key);
                  }}
                  onFocus={() => {
                    onFocusCluster(entry.key);
                  }}
                  onBlur={() => {
                    onFocusCluster(null);
                  }}
                  onClick={() => {
                    onFlyToCluster(entry.key);
                  }}
                >
                  <span
                    className="rz-graph-swatch"
                    style={{ background: `var(--rz-cluster-${String(entry.slot + 1)})` }}
                    aria-hidden="true"
                  />
                  {/* The name may be cut short with an ellipsis; the tooltip has all of it. */}
                  <span className="rz-graph-legend-name" title={name}>
                    {name}
                  </span>
                  <span className="rz-graph-legend-count">{entry.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <span id={hintId} hidden>
        {clusterBy === 'tag' ? t('graph.flyToTag') : t('graph.flyToFolder')}
      </span>
    </section>
  );
}

function sum(entries: readonly LegendEntry[]): number {
  return entries.reduce((total, entry) => total + entry.count, 0);
}
