import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GraphData } from '@rhizom/core';
import type { JSX, Ref, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import './graph.css';
import { createCanvas2dFieldRenderer } from './canvas2d-renderer.js';
import { GraphController, type HoverInfo } from './controller.js';
import { sceneToPng, sceneToSvg } from './export.js';
import { GraphInfo } from './GraphInfo.js';
import { createHoverStore } from './hover-store.js';
import { GraphLegend, type LegendEntry } from './GraphLegend.js';
import { createGlFieldRenderer } from './gl/field-renderer.js';
import { LabelSprites } from './label-sprites.js';
import { drawOverlay } from './overlay.js';
import { clusterSlots, watchPalette } from './palette.js';
import type { Rect } from './types.js';

export interface GraphCanvasHandle {
  /** The current view as an SVG document. */
  toSvg: () => string;
  /** The current view as a PNG blob at twice the on-screen size. */
  toPng: () => Promise<Blob>;
}

export interface GraphCanvasProps {
  data: GraphData;
  /** Path of the open note; drawn emphasised. */
  selected?: string | null | undefined;
  /** How the clusters were formed, for the legend's words. */
  clusterBy: 'folder' | 'tag';
  /** Accessible name, already translated. */
  label: string;
  onOpenNote: (path: string) => void;
  /** A click on empty ground while a note is open. */
  onDeselect?: (() => void) | undefined;
  ref?: Ref<GraphCanvasHandle>;
}

function mounted(ref: RefObject<GraphController | null>): GraphController {
  const controller = ref.current;
  if (!controller) {
    throw new Error('The graph canvas is not mounted');
  }
  return controller;
}

/**
 * The bubble field. The canvases belong to the controller, not to React: the layout ticks, the
 * pointer moves and the camera glides without a single re-render. React owns the panels over
 * the field and under it — the legend, the zoom control and the info bar.
 */
export function GraphCanvas({
  data,
  selected,
  clusterBy,
  label,
  onOpenNote,
  onDeselect,
  ref,
}: GraphCanvasProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLOutputElement>(null);
  /** The zoom last reported, as a whole percentage of the fitted view. */
  const zoomPercentRef = useRef(100);
  const controllerRef = useRef<GraphController | null>(null);
  // "100%" in English, "100 %" in German, and "1,200%" once zoomed far in.
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }),
    [i18n.language],
  );
  // The note under the pointer changes with every sweep across the field; only the info bar
  // listens, so the legend and the zoom control are not rendered again each time.
  const [hover] = useState(createHoverStore);
  const [open, setOpen] = useState<HoverInfo | null>(null);

  // Effect Events always see the current props without restarting the effect below.
  const handleOpen = useEffectEvent((path: string) => {
    onOpenNote(path);
  });
  const handleDeselect = useEffectEvent(() => {
    onDeselect?.();
  });
  // The zoom readout is written straight into the DOM: it changes on every frame of a zoom, and
  // nothing else needs to render again for it.
  const showZoom = useEffectEvent((percent: number) => {
    zoomPercentRef.current = percent;
    if (percentRef.current) {
      percentRef.current.textContent = percentFormat.format(percent / 100);
    }
  });

  // First, and again in the new format whenever the language changes; before the paint, so the
  // readout is never seen empty.
  useLayoutEffect(() => {
    if (percentRef.current) {
      percentRef.current.textContent = percentFormat.format(zoomPercentRef.current / 100);
    }
  }, [percentFormat]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const controller = new GraphController(host, {
      onOpen: (path) => {
        handleOpen(path);
      },
      onDeselect: () => {
        handleDeselect();
      },
      onHover: (info) => {
        hover.set(info);
      },
      onZoom: (percent) => {
        showZoom(percent);
      },
    });
    controllerRef.current = controller;
    const unwatch = watchPalette(() => {
      controller.refreshPalette();
    });

    // The panels are obstacles for labels and for fitting the view; they change size with the
    // language, the legend's length and whether it is folded.
    const panels = new ResizeObserver(() => {
      controller.setReserved(reservedRects(host, [legendRef.current, zoomRef.current]));
    });
    // The field too: a panel anchored to a corner moves when the field resizes without
    // changing its own size.
    for (const element of [legendRef.current, zoomRef.current, host]) {
      if (element) {
        panels.observe(element);
      }
    }
    return () => {
      panels.disconnect();
      unwatch();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [hover]);

  // Effects run in the order they are declared, so the controller exists by now. Nodes keep
  // their position across a refresh, so the layout does not jump.
  useEffect(() => {
    controllerRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    controllerRef.current?.setSelected(selected ?? null);
  }, [selected]);

  // The open note's figures, for the info bar while nothing is hovered. After setData, which the
  // effect above this one has already run for the same data.
  useEffect(() => {
    setOpen(selected ? (controllerRef.current?.noteInfo(selected) ?? null) : null);
  }, [data, selected]);

  const legend = useMemo<LegendEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const node of data.nodes) {
      counts.set(node.cluster, (counts.get(node.cluster) ?? 0) + 1);
    }
    // The same slots the field draws in: buildField takes them from the same set of clusters.
    const slots = clusterSlots(counts.keys());
    return [...counts]
      .map(([key, count]) => ({ key, count, slot: slots.get(key) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [data]);

  useImperativeHandle(
    ref,
    () => ({
      toSvg: () => {
        const scene = mounted(controllerRef).scene();
        if (scene === null) {
          throw new Error('The graph has no data to export');
        }
        return sceneToSvg(scene);
      },
      toPng: () => {
        const scene = mounted(controllerRef).scene();
        if (scene === null) {
          return Promise.reject(new Error('The graph has no data to export'));
        }
        // Glyphs drawn at the export's scale are of no use to the screen: dropped once it is done.
        const sprites = new LabelSprites();
        return sceneToPng(
          scene,
          { gl: createGlFieldRenderer, canvas2d: createCanvas2dFieldRenderer },
          { overlay: drawOverlay, sprites },
        ).finally(() => {
          sprites.clear();
        });
      },
    }),
    [],
  );

  return (
    <div className="rz-graph-view">
      <div className="rz-graph-stage-field">
        <div ref={hostRef} className="rz-graph" role="img" aria-label={label} />
        <GraphLegend
          ref={legendRef}
          entries={legend}
          clusterBy={clusterBy}
          onFocusCluster={(cluster) => {
            controllerRef.current?.setClusterFocus(cluster);
          }}
          onFlyToCluster={(cluster) => {
            controllerRef.current?.flyToCluster(cluster);
          }}
        />
        <div ref={zoomRef} className="rz-graph-zoom" role="group" aria-label={t('graph.zoom')}>
          <output ref={percentRef} className="rz-graph-zoom-level" aria-live="off" />
          <button
            type="button"
            aria-label={t('graph.zoomIn')}
            title={t('graph.zoomIn')}
            onClick={() => {
              controllerRef.current?.zoomIn();
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label={t('graph.zoomOut')}
            title={t('graph.zoomOut')}
            onClick={() => {
              controllerRef.current?.zoomOut();
            }}
          >
            −
          </button>
          <button
            type="button"
            aria-label={t('graph.fit')}
            title={t('graph.fit')}
            onClick={() => {
              controllerRef.current?.resetView();
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </div>
      </div>
      <GraphInfo hover={hover} open={open} clusterBy={clusterBy} />
    </div>
  );
}

/** The panels' boxes relative to the field, in CSS px. */
function reservedRects(host: HTMLElement, panels: readonly (HTMLElement | null)[]): Rect[] {
  const origin = host.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const panel of panels) {
    if (!panel) {
      continue;
    }
    const box = panel.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      continue;
    }
    rects.push({
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top,
    });
  }
  return rects;
}
