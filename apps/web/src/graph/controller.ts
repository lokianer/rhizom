// Everything the canvas needs and React must not re-render for: the simulation, the view
// transform, the pointer gestures and the frame loop.
import type { GraphData } from '@rhizom/core';

import { resolvePalette } from './palette.js';
import {
  buildIndex,
  createFrameLoop,
  buildScenePaths,
  drawScene,
  identity,
  pick,
  toGraph,
  wheelDelta,
  zoomAround,
  type FrameLoop,
  type NodeIndex,
  type Scene,
  type ScenePaths,
  type ViewTransform,
} from './renderer.js';
import { createFieldSimulation, type FieldSimulation, type SimNode } from './simulation.js';
import { createWorkerLayout } from './worker-layout.js';

export interface GraphHandlers {
  onOpen: (path: string) => void;
  onHover: (path: string | null) => void;
}

const K_MIN = 0.1;
const K_MAX = 8;
/** A pointer that travelled less than this on screen still counts as a click. */
const CLICK_SLOP_PX = 4;

type Gesture =
  { kind: 'pan'; x0: number; y0: number; from: ViewTransform } | { kind: 'drag'; node: SimNode };

export class GraphController {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #handlers: GraphHandlers;
  readonly #sim: FieldSimulation;
  readonly #loop: FrameLoop;
  readonly #resize: ResizeObserver;
  #scene: Scene;
  /** null means stale; the index is rebuilt on the next pointer query, not on every tick. */
  #index: NodeIndex | null = null;
  /** Edge and bubble geometry; null after the layout moved. */
  #paths: ScenePaths | null = null;

  #maxRadius = 0;
  #gesture: Gesture | null = null;
  #pointerId: number | null = null;
  #downX = 0;
  #downY = 0;
  #centred = false;
  #destroyed = false;
  #pixelRatioQuery: MediaQueryList | null = null;

  constructor(canvas: HTMLCanvasElement, handlers: GraphHandlers) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('The browser gave no 2D canvas context');
    }
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#handlers = handlers;
    this.#scene = {
      nodes: [],
      links: [],
      transform: identity,
      width: 0,
      height: 0,
      pixelRatio: window.devicePixelRatio,
      palette: resolvePalette(canvas.parentElement ?? document.body),
      hovered: null,
      selected: null,
    };
    this.#loop = createFrameLoop(() => {
      this.#draw();
    });
    const events = {
      onTick: () => {
        this.#index = null; // the positions moved
        this.#paths = null;
        this.#loop.request();
      },
      onEnd: () => {
        // Settled: from here on frames are drawn on demand.
      },
    };
    // A tick of a few thousand nodes costs tens of milliseconds, so the layout belongs off
    // the main thread; without workers it still runs here, just less smoothly.
    this.#sim = createWorkerLayout(events) ?? createFieldSimulation(events);

    this.#resize = new ResizeObserver((entries) => {
      this.#onResize(entries[0]);
    });
    try {
      // Exact device pixels, no rounding seam at fractional zoom levels.
      this.#resize.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.#resize.observe(canvas); // Safari: content box × devicePixelRatio instead
    }
    this.#watchPixelRatio();

    canvas.addEventListener('pointerdown', this.#onPointerDown);
    canvas.addEventListener('pointermove', this.#onPointerMove);
    canvas.addEventListener('pointerup', this.#onPointerUp);
    canvas.addEventListener('pointercancel', this.#onPointerUp);
    canvas.addEventListener('pointerleave', this.#onPointerLeave);
    canvas.addEventListener('wheel', this.#onWheel, { passive: false }); // else preventDefault is ignored
    canvas.style.cursor = 'grab';
  }

  setData(data: GraphData): void {
    const first = this.#scene.nodes.length === 0;
    const wasHovering = this.#scene.hovered !== null;
    this.#sim.setData(data);
    const nodes = this.#sim.nodes();
    this.#maxRadius = nodes.reduce((largest, node) => Math.max(largest, node.r), 0);
    this.#scene = { ...this.#scene, nodes, links: this.#sim.links(), hovered: null };
    this.#index = null;
    this.#paths = null;
    if (wasHovering) {
      this.#handlers.onHover(null); // the bubble under the pointer may be gone
    }
    this.#sim.reheat(first ? 1 : 0.3);
    this.#loop.request();
  }

  setSelected(path: string | null): void {
    if (path === this.#scene.selected) {
      return;
    }
    this.#scene = { ...this.#scene, selected: path };
    this.#loop.request();
  }

  /** After a theme change: the tokens now resolve to different colours. */
  refreshPalette(): void {
    this.#scene = {
      ...this.#scene,
      palette: resolvePalette(this.#canvas.parentElement ?? document.body),
    };
    this.#loop.request();
  }

  /** Back to the zoom and pan the graph started with. */
  resetView(): void {
    this.#scene = { ...this.#scene, transform: this.#centreTransform() };
    this.#loop.request();
  }

  /** The snapshot the exporters work from: same data, same transform, same resolved colours. */
  scene(): Scene {
    return this.#scene;
  }

  /** Idempotent: React StrictMode mounts, unmounts and mounts again in development. */
  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#resize.disconnect();
    this.#pixelRatioQuery?.removeEventListener('change', this.#onPixelRatioChange);
    this.#pixelRatioQuery = null;
    this.#loop.stop();
    this.#sim.destroy();
    const canvas = this.#canvas;
    canvas.removeEventListener('pointerdown', this.#onPointerDown);
    canvas.removeEventListener('pointermove', this.#onPointerMove);
    canvas.removeEventListener('pointerup', this.#onPointerUp);
    canvas.removeEventListener('pointercancel', this.#onPointerUp);
    canvas.removeEventListener('pointerleave', this.#onPointerLeave);
    canvas.removeEventListener('wheel', this.#onWheel);
  }

  #centreTransform(): ViewTransform {
    // The positional forces pull towards the graph origin, so that is what belongs in the middle.
    return { k: 1, x: this.#scene.width / 2, y: this.#scene.height / 2 };
  }

  #draw(): void {
    this.#paths ??= buildScenePaths(this.#scene);
    drawScene(this.#ctx, this.#scene, this.#paths);
  }

  #onResize(entry: ResizeObserverEntry | undefined): void {
    if (!entry || this.#destroyed) {
      return;
    }
    const ratio = window.devicePixelRatio;
    // Typed as always present, but Safari leaves it out — hence the widened local.
    const boxes: readonly ResizeObserverSize[] | undefined = entry.devicePixelContentBoxSize;
    const box = boxes?.[0];
    this.#applySize(
      box ? box.inlineSize : Math.round(entry.contentRect.width * ratio),
      box ? box.blockSize : Math.round(entry.contentRect.height * ratio),
      ratio,
    );
  }

  #applySize(deviceWidth: number, deviceHeight: number, ratio: number): void {
    const canvas = this.#canvas;
    if (canvas.width !== deviceWidth) {
      canvas.width = deviceWidth; // resets the whole context state; drawScene re-applies it
    }
    if (canvas.height !== deviceHeight) {
      canvas.height = deviceHeight;
    }
    const width = deviceWidth / ratio;
    const height = deviceHeight / ratio;
    let transform = this.#scene.transform;
    if (!this.#centred && width > 0 && height > 0) {
      transform = { k: 1, x: width / 2, y: height / 2 };
      this.#centred = true;
    }
    this.#scene = { ...this.#scene, width, height, pixelRatio: ratio, transform };
    this.#loop.request();
  }

  /**
   * Browser zoom changes devicePixelRatio. With a device-pixel content box the observer above
   * already reports it; on the fallback path this query is the only signal.
   */
  #watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    query.addEventListener('change', this.#onPixelRatioChange, { once: true });
    this.#pixelRatioQuery = query;
  }

  readonly #onPixelRatioChange = (): void => {
    if (this.#destroyed) {
      return;
    }
    const ratio = window.devicePixelRatio;
    const rect = this.#canvas.getBoundingClientRect();
    this.#applySize(Math.round(rect.width * ratio), Math.round(rect.height * ratio), ratio);
    this.#watchPixelRatio();
  };

  #pickAt(offsetX: number, offsetY: number): SimNode | null {
    this.#index ??= buildIndex(this.#scene.nodes);
    return pick(this.#index, this.#scene.transform, offsetX, offsetY, this.#maxRadius);
  }

  #setHovered(node: SimNode | null): void {
    const id = node?.id ?? null;
    if (id === this.#scene.hovered) {
      return;
    }
    this.#scene = { ...this.#scene, hovered: id };
    this.#handlers.onHover(id);
    this.#loop.request();
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#gesture) {
      return;
    }
    this.#canvas.setPointerCapture(event.pointerId); // keep the gesture outside the canvas too
    this.#pointerId = event.pointerId;
    this.#downX = event.offsetX;
    this.#downY = event.offsetY;
    const node = this.#pickAt(event.offsetX, event.offsetY);
    if (node) {
      this.#gesture = { kind: 'drag', node };
      this.#sim.pin(node, node.x ?? 0, node.y ?? 0);
      this.#sim.hold();
    } else {
      this.#gesture = {
        kind: 'pan',
        x0: event.offsetX,
        y0: event.offsetY,
        from: this.#scene.transform,
      };
      this.#canvas.style.cursor = 'grabbing';
    }
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (!gesture) {
      const node = this.#pickAt(event.offsetX, event.offsetY);
      this.#canvas.style.cursor = node ? 'pointer' : 'grab';
      this.#setHovered(node);
      return;
    }
    if (event.pointerId !== this.#pointerId) {
      return;
    }
    if (gesture.kind === 'drag') {
      const [gx, gy] = toGraph(this.#scene.transform, event.offsetX, event.offsetY);
      // The warm simulation ticks, and the tick handler draws.
      this.#sim.pin(gesture.node, gx, gy);
      return;
    }
    this.#scene = {
      ...this.#scene,
      transform: {
        k: gesture.from.k,
        x: gesture.from.x + (event.offsetX - gesture.x0),
        y: gesture.from.y + (event.offsetY - gesture.y0),
      },
    };
    this.#loop.request();
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (!gesture || event.pointerId !== this.#pointerId) {
      return;
    }
    this.#gesture = null;
    this.#pointerId = null;
    this.#canvas.style.cursor = 'grab';
    if (gesture.kind !== 'drag') {
      return;
    }
    this.#sim.unpin(gesture.node);
    this.#sim.release();
    const dx = event.offsetX - this.#downX;
    const dy = event.offsetY - this.#downY;
    const click = dx * dx + dy * dy <= CLICK_SLOP_PX * CLICK_SLOP_PX;
    if (click && event.type === 'pointerup') {
      this.#handlers.onOpen(gesture.node.id);
    }
  };

  readonly #onPointerLeave = (): void => {
    if (!this.#gesture) {
      this.#setHovered(null);
    }
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const transform = this.#scene.transform;
    const scaled = transform.k * 2 ** wheelDelta(event);
    const k1 = Math.min(K_MAX, Math.max(K_MIN, scaled));
    if (k1 === transform.k) {
      return;
    }
    this.#scene = {
      ...this.#scene,
      transform: zoomAround(transform, k1, event.offsetX, event.offsetY),
    };
    this.#loop.request();
  };
}
