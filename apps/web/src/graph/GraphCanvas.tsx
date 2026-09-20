import { useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react';
import type { GraphData } from '@rhizom/core';
import type { JSX, Ref, RefObject } from 'react';

import './graph.css';
import { GraphController } from './controller.js';
import { sceneToPng, sceneToSvg } from './export.js';
import { watchPalette } from './palette.js';

export interface GraphCanvasHandle {
  /** The current view as an SVG document. */
  toSvg: () => string;
  /** The current view as a PNG blob at `scale`× the on-screen size (default 2). */
  toPng: (scale?: number) => Promise<Blob>;
  /** Back to the initial zoom and pan. */
  resetView: () => void;
}

export interface GraphCanvasProps {
  data: GraphData;
  /** Path of the open note; drawn emphasised. */
  selected?: string | null | undefined;
  /** Accessible name, already translated. */
  label: string;
  onOpenNote: (path: string) => void;
  onHoverNote?: ((path: string | null) => void) | undefined;
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
 * The bubble field. The canvas belongs to the controller, not to React: the simulation ticks,
 * the pointer moves and the view transform changes without a single re-render.
 */
export function GraphCanvas({
  data,
  selected,
  label,
  onOpenNote,
  onHoverNote,
  ref,
}: GraphCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GraphController | null>(null);

  // Effect Events always see the current props without restarting the effect below.
  const handleOpen = useEffectEvent((path: string) => {
    onOpenNote(path);
  });
  const handleHover = useEffectEvent((path: string | null) => {
    onHoverNote?.(path);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const controller = new GraphController(canvas, {
      onOpen: (path) => {
        handleOpen(path);
      },
      onHover: (path) => {
        handleHover(path);
      },
    });
    controllerRef.current = controller;
    const unwatch = watchPalette(() => {
      controller.refreshPalette();
    });
    return () => {
      unwatch();
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  // Effects run in the order they are declared, so the controller exists by now. Nodes keep
  // their position across a refresh, so the layout does not jump.
  useEffect(() => {
    controllerRef.current?.setData(data);
  }, [data]);

  useEffect(() => {
    controllerRef.current?.setSelected(selected ?? null);
  }, [selected]);

  useImperativeHandle(
    ref,
    () => ({
      toSvg: () => sceneToSvg(mounted(controllerRef).scene()),
      toPng: (scale?: number) => sceneToPng(mounted(controllerRef).scene(), scale),
      resetView: () => {
        mounted(controllerRef).resetView();
      },
    }),
    [],
  );

  return <canvas ref={canvasRef} className="rz-graph" role="img" aria-label={label} />;
}
