// Everything the field needs and React must not re-render for: the layout, the camera, the focus,
// the frame loop, the pointer and the two canvases — the field below, the words above.
import type { GraphData, GraphNode } from '@rhizom/core';

import { Camera } from './camera.js';
import { createCanvas2dFieldRenderer } from './canvas2d-renderer.js';
import type { ExportScene } from './export.js';
import { buildFieldModel, type FieldModel } from './field-model.js';
import { RegionLayer } from './field-regions.js';
import { computeStates, FocusAnimator } from './focus.js';
import { createGlFieldRenderer } from './gl/field-renderer.js';
import { createTextMeasure, LabelSprites } from './label-sprites.js';
import { placeLabels } from './labels.js';
import { createMotionLoop, smoothstep, type MotionLoop } from './motion.js';
import { drawOverlay, regionBox, reticleStart, TICK_PX } from './overlay.js';
import { groundOf, resolvePalette, type Palette } from './palette.js';
import { buildIndex, pick, type NodeIndex } from './picking.js';
import { readRendererChoice } from './renderer-choice.js';
import { edgeDensity, labelSizeOf, symbolScale } from './scale.js';
import { createFieldSimulation, type FieldSimulation, type SimNode } from './simulation.js';
import { NodeFlag } from './types.js';
import type {
  FieldFrame,
  FieldRenderer,
  Ground,
  LabelCandidate,
  MeasureText,
  Mutable,
  OverlayFrame,
  PlacedLabel,
  Rect,
  RegionName,
  RingMark,
} from './types.js';
import { fitTransform, toGraph, wheelDelta, type ViewTransform } from './view.js';
import { createWorkerLayout } from './worker-layout.js';

/** What the info bar shows of the note under the pointer, or of the open note. */
export interface HoverInfo {
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly cluster: string;
  /** Palette slot of the note's cluster. */
  readonly slot: number;
  readonly inDegree: number;
  readonly outDegree: number;
  /** 1-based place among the notes by links; "3 of 41". */
  readonly rank: number;
  readonly total: number;
}

export interface GraphHandlers {
  onOpen: (path: string) => void;
  /** A click on empty ground while a note is open: the reader lets go of it. */
  onDeselect?: () => void;
  /** The note under the pointer changed; null when the pointer left every bubble. */
  onHover: (info: HoverInfo | null) => void;
  /** The zoom as a whole percentage of the fitted view, whenever that number changes. */
  onZoom?: (percent: number) => void;
}

/** A pointer that travelled less than this on screen still counts as a click. */
const CLICK_SLOP_PX = 4;
/** How long the field takes to grow in on first show. */
const GROW_MS = 1100;
/** How long the pointer's history reaches back when a pan is let go and carries on. */
const VELOCITY_WINDOW_MS = 80;
/** A context lost for longer than this is given up on, and the field falls back to Canvas 2D. */
const CONTEXT_GRACE_MS = 3000;
/** More candidates than this are never considered for labels: the budget is far below it anyway. */
const MAX_LABEL_CANDIDATES = 600;
/**
 * How many of the best-linked notes are candidates at the fitted zoom; the count grows with the
 * zoom (to the power 1.5, as the screen area per note does, roughly) and with nothing else. Which
 * notes may carry a label is therefore a question of the zoom alone — panning never reshuffles
 * them, only what enters or leaves the screen comes and goes.
 */
const LABEL_CANDIDATES_AT_FIT = 60;
/** A pan let go after the pointer rested this long does not carry on. */
const RELEASE_STALE_MS = 50;
/** How long a click on empty ground waits for a second one before it counts as a single click. */
const DOUBLE_CLICK_MS = 260;
const ZOOM_STEP = 1.6;
/** While the milieu names show, only this many of the best-linked notes are labelled regardless… */
const NAMED_LABEL_HUBS = 12;
/** …and other notes only once their bubble is this large on screen (CSS px). */
const NAMED_LABEL_MIN_RADIUS_PX = 7;

type Gesture =
  { kind: 'pan'; lastX: number; lastY: number } | { kind: 'drag'; node: SimNode; index: number };

interface Sample {
  x: number;
  y: number;
  t: number;
}

export class GraphController {
  readonly #host: HTMLElement;
  #field: HTMLCanvasElement;
  readonly #overlay: HTMLCanvasElement;
  readonly #overlayCtx: CanvasRenderingContext2D;
  #renderer: FieldRenderer;
  readonly #handlers: GraphHandlers;
  readonly #sim: FieldSimulation;
  readonly #camera = new Camera();
  readonly #focus = new FocusAnimator();
  readonly #loop: MotionLoop;
  readonly #sprites = new LabelSprites();
  readonly #resize: ResizeObserver;
  readonly #motionQuery: MediaQueryList;

  #palette: Palette;
  #ground: Ground;
  #width = 0;
  #height = 0;
  #pixelRatio = 1;
  #model: FieldModel | null = null;
  #regions: RegionLayer | null = null;
  #graphNodes = new Map<string, GraphNode>();
  #states = new Uint8Array(0);
  #clusterMembers: Uint8Array | null = null;
  #hovered = -1;
  #selected = -1;
  #selectedPath: string | null = null;
  #reserved: readonly Rect[] = [];
  /** null means stale; rebuilt on the next pointer query, not on every tick. */
  #index: NodeIndex | null = null;
  #maxRadius = 0;
  #fitK = 1;
  /** Once the reader has panned or zoomed, the view is theirs and is left alone. */
  #viewHeldByReader = false;
  #grow = 1;
  #gesture: Gesture | null = null;
  #pointerId: number | null = null;
  #downX = 0;
  #downY = 0;
  readonly #samples: Sample[] = [];
  #lastZoomPercent = -1;
  #lostTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;

  // Reused every frame, so drawing allocates nothing but what the label pass returns.
  readonly #frame: Mutable<FieldFrame>;
  readonly #candidates: Mutable<LabelCandidate>[] = [];
  /** Neighbours of the focused note in label order, refilled per frame. */
  readonly #focusOrder: number[] = [];
  /** The candidates of one frame: the same array, refilled. */
  readonly #candidateList: Mutable<LabelCandidate>[] = [];
  /** 1 for a note already taken this frame; cleared again before the frame ends. */
  #labelMark = new Uint8Array(0);
  /** What the label pass of one frame works with, read by #pushCandidate. */
  readonly #pass = {
    transform: { k: 1, x: 0, y: 0 } as ViewTransform,
    scale: 1,
    focus: 0,
    fadingOut: false,
    minRadius: 0,
    grown: 1,
  };
  readonly #selectedRing: Mutable<RingMark> = { x: 0, y: 0, r: 0 };
  readonly #hoveredRing: Mutable<RingMark> = { x: 0, y: 0, r: 0 };
  readonly #obstaclePool: Mutable<Rect>[] = [];
  /** A click on empty ground waits out a double click before it lets go of the open note. */
  #deselectTimer: ReturnType<typeof setTimeout> | null = null;
  /** The camera was gliding when the pointer went down: that tap only stops it. */
  #downStoppedGlide = false;
  /** Reduced motion: the layout is not shown settling. */
  #quietLayout = false;
  /** Whether this data set's positions have been shown at all. */
  #layoutShown = false;
  /** Positions the layout sent that the field has not taken yet (reduced motion). */
  #positionsPending = false;
  #labels: PlacedLabel[] = [];
  readonly #obstacles: Rect[] = [];
  #overlayFrame: Mutable<OverlayFrame> | null = null;
  #measure: MeasureText;
  /** The FocusAnimator's version the node states were last computed for. */
  #focusVersion = -1;

  constructor(host: HTMLElement, handlers: GraphHandlers) {
    this.#host = host;
    this.#handlers = handlers;
    this.#palette = resolvePalette(host);
    this.#ground = groundOf(this.#palette);

    this.#field = this.#makeCanvas('rz-graph-field');
    this.#overlay = this.#makeCanvas('rz-graph-overlay');
    const overlayCtx = this.#overlay.getContext('2d');
    if (!overlayCtx) {
      throw new Error('The browser gave no 2D canvas context');
    }
    this.#overlayCtx = overlayCtx;
    this.#measure = createTextMeasure(this.#palette.fontSans);
    this.#renderer = this.#createRenderer();

    this.#frame = {
      transform: this.#camera.transform,
      width: 0,
      height: 0,
      pixelRatio: 1,
      palette: this.#palette,
      ground: this.#ground,
      focusAmount: 0,
      focusIndex: -1,
      clusterFocus: false,
      selectedIndex: -1,
      drawOn: 0,
      grow: 1,
      symbolScale: 1,
      moving: false,
      edgeDensity: 1,
      territory: 1,
    };

    this.#loop = createMotionLoop({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => {
        cancelAnimationFrame(handle);
      },
      now: () => performance.now(),
      onFrame: () => {
        this.#draw();
      },
    });
    this.#motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.#applyReducedMotion();
    this.#motionQuery.addEventListener('change', this.#applyReducedMotion);
    document.addEventListener('visibilitychange', this.#onVisibility);

    const events = {
      onTick: () => {
        // Under reduced motion the field is not shown settling: the first positions appear, then
        // the settled ones, and nothing moves in between unless a bubble is being dragged.
        if (this.#quietLayout && this.#layoutShown && this.#gesture?.kind !== 'drag') {
          this.#positionsPending = true;
          return;
        }
        this.#layoutShown = true;
        this.#positionsMoved();
      },
      onEnd: () => {
        // Settled: from here on frames are drawn on demand.
        if (this.#positionsPending) {
          this.#positionsMoved();
        }
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
      this.#resize.observe(host, { box: 'device-pixel-content-box' });
    } catch {
      this.#resize.observe(host); // Safari: content box × devicePixelRatio instead
    }
    // A hidden tab reports no size until it is shown; start from the layout box meanwhile.
    const rect = host.getBoundingClientRect();
    this.#applySize(
      Math.round(rect.width * window.devicePixelRatio),
      Math.round(rect.height * window.devicePixelRatio),
      window.devicePixelRatio,
    );

    host.addEventListener('pointerdown', this.#onPointerDown);
    host.addEventListener('pointermove', this.#onPointerMove);
    host.addEventListener('pointerup', this.#onPointerUp);
    host.addEventListener('pointercancel', this.#onPointerUp);
    host.addEventListener('pointerleave', this.#onPointerLeave);
    host.addEventListener('dblclick', this.#onDoubleClick);
    host.addEventListener('wheel', this.#onWheel, { passive: false }); // else preventDefault is ignored
    host.style.cursor = 'grab';
  }

  setData(data: GraphData): void {
    const first = this.#model === null;
    this.#sim.setData(data);
    const nodes = this.#sim.nodes();
    this.#graphNodes = new Map(data.nodes.map((node) => [node.path, node]));
    this.#model = buildFieldModel(nodes, this.#sim.links(), data.clusters);
    this.#regions = new RegionLayer(this.#model, this.#palette);
    this.#regions.moved(this.#sim.positions());
    this.#maxRadius = nodes.reduce((largest, node) => Math.max(largest, node.r), 0);
    this.#states = new Uint8Array(nodes.length);
    this.#clusterMembers = null;
    // Indices from the old data set mean other notes now; the focus starts from nothing.
    this.#focus.reset();
    this.#layoutShown = false;
    this.#renderer.setData(this.#model.data);
    this.#renderer.setPositions(this.#sim.positions());
    if (this.#hovered !== -1) {
      this.#hovered = -1;
      this.#handlers.onHover(null); // the bubble under the pointer may be gone
    }
    this.#selected =
      this.#selectedPath === null ? -1 : (this.#model.indexOf.get(this.#selectedPath) ?? -1);
    this.#updateStates();
    this.#index = null;
    if (first) {
      this.#startGrowth();
    }
    this.#sim.reheat(first ? 1 : 0.3);
    this.#wake();
  }

  setSelected(path: string | null): void {
    if (path === this.#selectedPath) {
      return;
    }
    this.#selectedPath = path;
    this.#selected = path === null ? -1 : (this.#model?.indexOf.get(path) ?? -1);
    this.#updateStates();
    this.#wake();
  }

  /** Focuses a whole cluster, as hovering its row in the legend does; null lets go. */
  setClusterFocus(cluster: string | null): void {
    const model = this.#model;
    if (!model) {
      return;
    }
    const clusterIndex = cluster === null ? -1 : model.clusters.indexOf(cluster);
    if (clusterIndex === -1) {
      this.#clusterMembers = null;
    } else {
      const members = new Uint8Array(model.data.nodes.count);
      model.clusterOfNode.forEach((value, node) => {
        members[node] = value === clusterIndex ? 1 : 0;
      });
      this.#clusterMembers = members;
    }
    this.#focus.setCluster(this.#clusterMembers);
    this.#updateStates();
    this.#wake();
  }

  /** Flies the view to one cluster's notes. */
  flyToCluster(cluster: string): void {
    const model = this.#model;
    if (!model) {
      return;
    }
    const clusterIndex = model.clusters.indexOf(cluster);
    const nodes = this.#sim.nodes().filter((_, node) => model.clusterOfNode[node] === clusterIndex);
    if (nodes.length === 0) {
      return;
    }
    this.#viewHeldByReader = true;
    const target = fitTransform(nodes, this.#width, this.#height, {
      reserved: this.#reserved,
      maxScale: 3,
    });
    this.#camera.flyTo(target, this.#width, this.#height);
    this.#wake();
  }

  /** What the info bar shows of a note, by path; null for a note not in the field. */
  noteInfo(path: string): HoverInfo | null {
    const index = this.#model?.indexOf.get(path);
    return index === undefined ? null : this.#hoverInfo(index);
  }

  /** Screen areas the DOM covers (legend, zoom control): labels and the fitted view avoid them. */
  setReserved(rects: readonly Rect[]): void {
    this.#reserved = rects;
    this.#refit();
    this.#wake();
  }

  /** After a theme change: the tokens now resolve to different colours. */
  refreshPalette(): void {
    this.#palette = resolvePalette(this.#host);
    this.#ground = groundOf(this.#palette);
    this.#measure = createTextMeasure(this.#palette.fontSans);
    this.#sprites.clear();
    this.#wake();
  }

  zoomIn(): void {
    this.#zoomAtCentre(ZOOM_STEP);
  }

  zoomOut(): void {
    this.#zoomAtCentre(1 / ZOOM_STEP);
  }

  /** Back to the whole field, flown rather than jumped. */
  resetView(): void {
    this.#viewHeldByReader = false;
    this.#camera.flyTo(this.#fitTransform(), this.#width, this.#height);
    this.#wake();
  }

  /** The snapshot the exporters work from: same data, same view, same resolved colours. */
  scene(): ExportScene | null {
    const model = this.#model;
    if (!model) {
      return null;
    }
    const overlay = this.#overlayFrame ?? this.#composeOverlay();
    // Copies throughout: the camera, the label pass and the name pass reuse their objects, and
    // an export read after the next frame must still show this one.
    return {
      frame: {
        ...this.#frame,
        transform: { ...this.#camera.transform },
        moving: false,
        grow: 1,
        drawOn: 1,
      },
      data: model.data,
      positions: this.#sim.positions().slice(),
      states: this.#states.slice(),
      overlay: {
        ...overlay,
        labels: overlay.labels.map((label) => ({ ...label, box: { ...label.box } })),
        regions: overlay.regions.map((region) => ({ ...region })),
        selected: overlay.selected && { ...overlay.selected },
        hovered: overlay.hovered && { ...overlay.hovered },
      },
    };
  }

  /** Idempotent: React StrictMode mounts, unmounts and mounts again in development. */
  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#resize.disconnect();
    this.#motionQuery.removeEventListener('change', this.#applyReducedMotion);
    document.removeEventListener('visibilitychange', this.#onVisibility);
    if (this.#lostTimer !== null) {
      clearTimeout(this.#lostTimer);
    }
    this.#cancelDeselect();
    this.#loop.stop();
    this.#sim.destroy();
    this.#renderer.destroy();
    this.#sprites.clear();
    const host = this.#host;
    host.removeEventListener('pointerdown', this.#onPointerDown);
    host.removeEventListener('pointermove', this.#onPointerMove);
    host.removeEventListener('pointerup', this.#onPointerUp);
    host.removeEventListener('pointercancel', this.#onPointerUp);
    host.removeEventListener('pointerleave', this.#onPointerLeave);
    host.removeEventListener('dblclick', this.#onDoubleClick);
    host.removeEventListener('wheel', this.#onWheel);
    // A canvas keeps its backing store until it is collected; shrinking it returns the memory now.
    for (const canvas of [this.#field, this.#overlay]) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
  }

  /**
   * Asks for a frame, and puts the camera and the focus back into the loop: an animation leaves
   * the loop when it arrives, and the command that set it moving again comes before this call.
   * Adding one that is at rest costs a single advance that reports nothing to do.
   */
  #wake(): void {
    this.#loop.add(this.#camera);
    this.#loop.add(this.#focus);
    this.#loop.request();
  }

  // --- setup ---------------------------------------------------------------------------------

  #makeCanvas(className: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = className;
    canvas.setAttribute('aria-hidden', 'true');
    this.#host.append(canvas);
    return canvas;
  }

  #createRenderer(): FieldRenderer {
    if (readRendererChoice() === 'canvas2d') {
      return this.#createFlatRenderer();
    }
    const gl = createGlFieldRenderer(this.#field, {
      onLost: () => {
        if (this.#lostTimer !== null) {
          return; // the first loss's deadline stands
        }
        this.#lostTimer = setTimeout(() => {
          this.#lostTimer = null;
          this.#fallBack();
        }, CONTEXT_GRACE_MS);
      },
      onRestored: () => {
        if (this.#lostTimer !== null) {
          clearTimeout(this.#lostTimer);
          this.#lostTimer = null;
        }
        this.#wake();
      },
    });
    if (gl) {
      return gl;
    }
    // A failed shader or framebuffer leaves the canvas bound to the WebGL2 context it had
    // created, and a canvas never hands out a second kind: the fallback needs a fresh one.
    this.#replaceFieldCanvas();
    return this.#createFlatRenderer();
  }

  #createFlatRenderer(): FieldRenderer {
    const flat = createCanvas2dFieldRenderer(this.#field, {
      onRestored: () => {
        this.#wake();
      },
    });
    if (!flat) {
      throw new Error('The browser gave neither a WebGL2 nor a 2D canvas context');
    }
    return flat;
  }

  /**
   * A canvas holds one kind of context for life, so falling back from a lost WebGL context to
   * Canvas 2D means a fresh canvas in the old one's place.
   */
  #fallBack(): void {
    if (this.#destroyed || this.#renderer.kind === 'canvas2d' || !this.#renderer.lost) {
      return;
    }
    this.#renderer.destroy();
    this.#replaceFieldCanvas();
    const flat = createCanvas2dFieldRenderer(this.#field, {
      onRestored: () => {
        this.#wake();
      },
    });
    if (!flat) {
      return;
    }
    this.#renderer = flat;
    if (this.#model) {
      flat.setData(this.#model.data);
      flat.setPositions(this.#sim.positions());
      flat.setStates(this.#states);
    }
    this.#wake();
  }

  /** A fresh canvas in the field canvas's place, the same size. */
  #replaceFieldCanvas(): void {
    const replacement = document.createElement('canvas');
    replacement.className = this.#field.className;
    replacement.setAttribute('aria-hidden', 'true');
    replacement.width = this.#field.width;
    replacement.height = this.#field.height;
    this.#field.replaceWith(replacement);
    this.#field = replacement;
  }

  readonly #applyReducedMotion = (): void => {
    const reduced = this.#motionQuery.matches;
    this.#quietLayout = reduced;
    this.#loop.setReducedMotion(reduced);
    this.#camera.setReducedMotion(reduced);
  };

  readonly #onVisibility = (): void => {
    this.#loop.setPaused(document.visibilityState === 'hidden');
  };

  #startGrowth(): void {
    this.#grow = 0;
    this.#loop.add({
      advance: (dt: number) => {
        this.#grow = Math.min(1, this.#grow + dt / GROW_MS);
        return this.#grow < 1;
      },
      finish: () => {
        this.#grow = 1;
      },
    });
  }

  // --- layout and view -----------------------------------------------------------------------

  #positionsMoved(): void {
    this.#takePositions();
    this.#wake();
  }

  /** The layout's current positions into the renderer, the picking index and the names. */
  #takePositions(): void {
    this.#positionsPending = false;
    this.#index = null;
    const positions = this.#sim.positions();
    this.#renderer.setPositions(positions);
    this.#regions?.moved(positions);
    this.#refit();
  }

  /** Keeps the whole field in sight while it spreads out, until the reader takes the view. */
  #refit(): void {
    const fit = this.#fitTransform();
    this.#fitK = fit.k;
    if (!this.#viewHeldByReader && this.#gesture === null) {
      this.#camera.jumpTo(fit);
    }
  }

  #fitTransform(): ViewTransform {
    return fitTransform(this.#sim.nodes(), this.#width, this.#height, { reserved: this.#reserved });
  }

  #zoomAtCentre(factor: number): void {
    this.#viewHeldByReader = true;
    this.#camera.zoomBy(factor, this.#width / 2, this.#height / 2);
    this.#wake();
  }

  #onResize(entry: ResizeObserverEntry | undefined): void {
    if (!entry || this.#destroyed) {
      return;
    }
    // Typed as always present, but Safari leaves it out — hence the widened local.
    const boxes: readonly ResizeObserverSize[] | undefined = entry.devicePixelContentBoxSize;
    const box = boxes?.[0];
    // The ratio the device box was measured at, rather than window.devicePixelRatio: the two
    // disagree under an emulated scale factor, and drawing at the one while sizing by the other
    // doubles every word.
    const ratio =
      box && entry.contentRect.width > 0
        ? box.inlineSize / entry.contentRect.width
        : window.devicePixelRatio;
    this.#applySize(
      box ? box.inlineSize : Math.round(entry.contentRect.width * ratio),
      box ? box.blockSize : Math.round(entry.contentRect.height * ratio),
      ratio,
    );
  }

  #applySize(deviceWidth: number, deviceHeight: number, ratio: number): void {
    if (deviceWidth <= 0 || deviceHeight <= 0) {
      return; // hidden; keep the last size rather than a canvas of nothing
    }
    for (const canvas of [this.#field, this.#overlay]) {
      if (canvas.width !== deviceWidth) {
        canvas.width = deviceWidth;
      }
      if (canvas.height !== deviceHeight) {
        canvas.height = deviceHeight;
      }
    }
    const first = this.#width === 0;
    this.#width = deviceWidth / ratio;
    this.#height = deviceHeight / ratio;
    if (ratio !== this.#pixelRatio) {
      this.#pixelRatio = ratio;
      this.#sprites.clear(); // the glyphs were drawn for the old device pixels
    }
    if (first) {
      this.#camera.jumpTo({ k: 1, x: this.#width / 2, y: this.#height / 2 });
    }
    this.#refit();
    // Setting a canvas's size clears it; drawing now, before the browser paints, keeps the field
    // from showing black for a frame on every resize of the pane.
    this.#draw();
    this.#wake();
  }

  // --- focus ---------------------------------------------------------------------------------

  #updateStates(): void {
    const model = this.#model;
    if (!model) {
      return;
    }
    // From the animator, not from the pointer: it keeps the focus that is fading out until it
    // has faded, and a renderer sinks every bubble without the focus flag by focusAmount — raw
    // hover state would sink the whole field for the length of every fade-out.
    const focus = this.#focus;
    computeStates(
      model.data.nodes.count,
      model.adjacency,
      {
        hovered: focus.clusterFocus ? -1 : focus.focusIndex,
        selected: this.#selected,
        clusterMembers: focus.clusterMembers,
      },
      this.#states,
    );
    this.#focusVersion = focus.version;
    this.#renderer.setStates(this.#states);
  }

  #setHovered(index: number): void {
    if (index === this.#hovered) {
      return;
    }
    this.#hovered = index;
    this.#focus.setHover(index);
    this.#updateStates();
    this.#handlers.onHover(index === -1 ? null : this.#hoverInfo(index));
    this.#wake();
  }

  #hoverInfo(index: number): HoverInfo | null {
    const model = this.#model;
    const node = this.#sim.nodes()[index];
    if (!model || !node) {
      return null;
    }
    const graphNode = this.#graphNodes.get(node.id);
    return {
      path: node.id,
      name: node.label,
      folder: graphNode?.folder ?? '',
      cluster: node.cluster,
      slot: node.colorIndex,
      inDegree: graphNode?.inDegree ?? 0,
      outDegree: graphNode?.outDegree ?? 0,
      rank: model.rank[index] ?? 0,
      total: model.data.nodes.count,
    };
  }

  // --- drawing -------------------------------------------------------------------------------

  #draw(): void {
    if (this.#destroyed || this.#width <= 0 || this.#height <= 0 || this.#renderer.lost) {
      return;
    }
    if (this.#positionsPending) {
      this.#takePositions();
    }
    if (this.#focus.version !== this.#focusVersion) {
      this.#updateStates();
    }
    const frame = this.#frame;
    const transform = this.#camera.transform;
    const count = this.#model?.data.nodes.count ?? 0;
    frame.transform = transform;
    frame.width = this.#width;
    frame.height = this.#height;
    frame.pixelRatio = this.#pixelRatio;
    frame.palette = this.#palette;
    frame.ground = this.#ground;
    frame.focusAmount = this.#focus.focusAmount;
    frame.focusIndex = this.#focus.focusIndex;
    frame.clusterFocus = this.#focus.clusterFocus;
    frame.selectedIndex = this.#selected;
    frame.drawOn = this.#focus.drawOn;
    frame.grow = this.#grow;
    frame.symbolScale = symbolScale(transform.k, this.#fitK, count);
    frame.moving = this.#camera.isMoving || this.#gesture?.kind === 'pan';
    frame.edgeDensity = this.#edgeDensity(transform);
    // The territories are the overview's cue, like the names: a wash between dots reads as a
    // milieu, the same wash between bubbles filling the screen reads as a stain.
    frame.territory = 0.25 + 0.75 * (this.#regions?.visibility(transform, frame.symbolScale) ?? 0);
    this.#renderer.render(frame);

    drawOverlay(this.#overlayCtx, this.#composeOverlay(), this.#sprites);

    this.#reportZoom(transform);
  }

  #edgeDensity(transform: ViewTransform): number {
    const model = this.#model;
    if (!model) {
      return 1;
    }
    // The share of the notes on screen stands in for the share of the links on screen: counting
    // links would mean a pass over all of them for every frame of a zoom.
    const nodes = this.#sim.nodes();
    const [left, top] = toGraph(transform, 0, 0);
    const [right, bottom] = toGraph(transform, this.#width, this.#height);
    let visible = 0;
    for (const node of nodes) {
      const x = node.x ?? Number.NaN;
      const y = node.y ?? Number.NaN;
      if (x >= left && x <= right && y >= top && y <= bottom) {
        visible += 1;
      }
    }
    const share = nodes.length === 0 ? 0 : visible / nodes.length;
    return edgeDensity((model.data.edges.length / 2) * share, this.#width * this.#height);
  }

  #composeOverlay(): OverlayFrame {
    const transform = this.#camera.transform;
    const scale = symbolScale(transform.k, this.#fitK, this.#model?.data.nodes.count ?? 0);
    const regions = this.#regionNames(transform, scale);
    const names = this.#regions?.visibility(transform, scale) ?? 0;
    const selected = this.#ring(this.#selected, transform, scale, this.#selectedRing);
    const obstacles = this.#obstacles;
    obstacles.length = 0;
    for (const region of regions) {
      if (region.alpha <= 0) {
        continue;
      }
      const box = regionBox(region, this.#measure, this.#obstacleRect(obstacles.length));
      // A name set across the open note's ring would hide the one mark that says which it is.
      if (selected && overlapsRing(box, selected)) {
        (region as Mutable<RegionName>).alpha = 0;
        continue;
      }
      obstacles.push(box);
    }
    this.#labels = placeLabels(
      this.#labelCandidates(transform, scale, names),
      {
        width: this.#width,
        height: this.#height,
        reserved: this.#reserved,
        obstacles,
        measure: this.#measure,
      },
      this.#labels,
    );
    const frame: Mutable<OverlayFrame> = this.#overlayFrame ?? {
      width: 0,
      height: 0,
      pixelRatio: 1,
      palette: this.#palette,
      ground: this.#ground,
      labels: [],
      regions: [],
      selected: null,
      hovered: null,
    };
    frame.width = this.#width;
    frame.height = this.#height;
    frame.pixelRatio = this.#pixelRatio;
    frame.palette = this.#palette;
    frame.ground = this.#ground;
    frame.labels = this.#labels;
    frame.regions = regions;
    frame.selected = selected;
    frame.hovered = this.#ring(this.#hovered, transform, scale, this.#hoveredRing);
    this.#overlayFrame = frame;
    return frame;
  }

  /** The obstacle rectangle at a slot of the pool, made once and refilled every frame after. */
  #obstacleRect(slot: number): Mutable<Rect> {
    let rect = this.#obstaclePool[slot];
    if (!rect) {
      rect = { left: 0, top: 0, right: 0, bottom: 0 };
      this.#obstaclePool[slot] = rect;
    }
    return rect;
  }

  /**
   * The notes that may be labelled, most important first. A map names its regions at overview
   * and its towns once you are close, and so does the field: while the milieu names show
   * (`names` is how strongly they show at this zoom), a note is labelled only if it is one of the
   * few best-linked, part of the focus, or already a real bubble on screen; as the names fade
   * out, every note becomes a candidate and collision alone decides. The list and its entries
   * are the same objects every frame.
   */
  #labelCandidates(
    transform: ViewTransform,
    scale: number,
    names: number,
  ): readonly LabelCandidate[] {
    const list = this.#candidateList;
    list.length = 0;
    const model = this.#model;
    if (!model) {
      return list;
    }
    const pass = this.#pass;
    const focus = this.#focus.focusAmount;
    const count = model.data.nodes.count;
    pass.transform = transform;
    pass.scale = scale;
    pass.focus = focus;
    pass.minRadius = names * NAMED_LABEL_MIN_RADIUS_PX;
    // Names arrive with their bubbles rather than floating over dots while the field grows in.
    pass.grown = this.#grow >= 1 ? 1 : smoothstep(0.55, 1, this.#grow);
    // The focus of a note the pointer has just left fades out: its neighbours' names go with it.
    pass.fadingOut = this.#hovered === -1 && !this.#focus.clusterFocus && focus > 0;
    const limit = Math.min(
      count,
      Math.round(LABEL_CANDIDATES_AT_FIT * Math.max(1, transform.k / this.#fitK) ** 1.5),
    );
    if (this.#labelMark.length !== count) {
      this.#labelMark = new Uint8Array(count);
    }
    const mark = this.#labelMark;

    if (this.#hovered !== -1) {
      this.#pushCandidate(model, this.#hovered, true, false);
    }
    if (this.#selected !== -1 && this.#selected !== this.#hovered) {
      this.#pushCandidate(model, this.#selected, true, false);
    }
    // The focused note's neighbours come next, whatever their rank: they are what a hover is
    // for, and most of them would be far down the global order. Marked as they are taken, so
    // the global pass skips them in O(1) rather than searching the list.
    const focusIndex = this.#focus.clusterFocus ? -1 : this.#focus.focusIndex;
    const order = this.#focusOrder;
    order.length = 0;
    if (pass.fadingOut && focusIndex !== -1 && focusIndex !== this.#selected) {
      // The note just left keeps its own name while the rest of its focus fades.
      order.push(focusIndex);
      mark[focusIndex] = 1;
      this.#pushCandidate(model, focusIndex, false, true);
    }
    if (focus > 0 && focusIndex !== -1) {
      const { offsets, neighbours } = model.adjacency;
      const first = order.length;
      for (let at = offsets[focusIndex] ?? 0; at < (offsets[focusIndex + 1] ?? 0); at += 1) {
        const neighbour = neighbours[at] ?? -1;
        if (
          neighbour !== this.#hovered &&
          neighbour !== this.#selected &&
          neighbour >= 0 &&
          mark[neighbour] !== 1
        ) {
          mark[neighbour] = 1;
          order.push(neighbour);
        }
      }
      sortByRank(order, first, model.rank);
      for (let at = first; at < order.length; at += 1) {
        this.#pushCandidate(model, order[at] ?? -1, false, false);
      }
    }
    for (let position = 0; position < limit && list.length < MAX_LABEL_CANDIDATES; position += 1) {
      const index = model.labelOrder[position] ?? -1;
      if (index !== this.#hovered && index !== this.#selected && mark[index] !== 1) {
        this.#pushCandidate(model, index, false, false);
      }
    }
    for (const index of order) {
      mark[index] = 0;
    }
    return list;
  }

  /** One candidate into the list, if its bubble is on screen and its name is to show. */
  #pushCandidate(model: FieldModel, index: number, emphasised: boolean, steady: boolean): void {
    const node = this.#sim.nodes()[index];
    if (node?.x === undefined || node.y === undefined) {
      return;
    }
    const { transform, scale, focus, fadingOut, minRadius, grown } = this.#pass;
    const x = node.x * transform.k + transform.x;
    const y = node.y * transform.k + transform.y;
    const margin = 40;
    if (x < -margin || y < -margin || x > this.#width + margin || y > this.#height + margin) {
      return;
    }
    const count = model.data.nodes.count;
    const inFocus = ((this.#states[index] ?? 0) & NodeFlag.focus) !== 0;
    const r = node.r * transform.k * scale * this.#grow;
    const hub = (model.rank[index] ?? count) <= NAMED_LABEL_HUBS;
    if (!emphasised && !hub && !(inFocus && focus > 0) && r < minRadius) {
      return;
    }
    // Under a focus the labels outside it go entirely: a faint label is noise, not context.
    // While a note's focus fades out, its neighbours' names fade with it instead of holding on
    // until the last frame and then vanishing all at once.
    const focusAlpha =
      emphasised || steady || focus === 0 ? 1 : inFocus ? (fadingOut ? focus : 1) : 1 - focus;
    const alpha = focusAlpha * grown;
    if (alpha <= 0.02) {
      return;
    }
    const list = this.#candidateList;
    const candidate = this.#candidates[list.length] ?? ({} as Mutable<LabelCandidate>);
    this.#candidates[list.length] = candidate;
    candidate.index = index;
    candidate.text = node.label;
    candidate.x = x;
    candidate.y = y;
    candidate.r = r;
    // rank is 1-based (the info bar says "rank 1 of 41"), labelSizeOf counts from 0.
    candidate.size = labelSizeOf((model.rank[index] ?? count) - 1, count);
    candidate.emphasised = emphasised;
    candidate.selected = index === this.#selected;
    candidate.alpha = alpha;
    candidate.fill = this.#palette.clusters[node.colorIndex] ?? this.#palette.label;
    list.push(candidate);
  }

  #regionNames(transform: ViewTransform, scale: number): readonly RegionName[] {
    const regions = this.#regions;
    if (!regions) {
      return [];
    }
    return regions.names(
      this.#sim.positions(),
      transform,
      this.#width,
      this.#height,
      scale,
      // A hovered note hides the names by fading them with its focus; a legend focus keeps them.
      this.#focus.clusterFocus ? 1 : 1 - this.#focus.focusAmount,
      this.#palette,
      this.#measure,
    );
  }

  /** Where a note's bubble is on screen, written into `into`; null for none or an unplaced one. */
  #ring(
    index: number,
    transform: ViewTransform,
    scale: number,
    into: Mutable<RingMark>,
  ): RingMark | null {
    const node = index === -1 ? undefined : this.#sim.nodes()[index];
    if (node?.x === undefined || node.y === undefined) {
      return null;
    }
    into.x = node.x * transform.k + transform.x;
    into.y = node.y * transform.k + transform.y;
    into.r = node.r * transform.k * scale * this.#grow;
    return into;
  }

  #reportZoom(transform: ViewTransform): void {
    const percent = Math.round((transform.k / this.#fitK) * 100);
    if (percent !== this.#lastZoomPercent) {
      this.#lastZoomPercent = percent;
      this.#handlers.onZoom?.(percent);
    }
  }

  // --- pointer -------------------------------------------------------------------------------

  #pickAt(offsetX: number, offsetY: number): number {
    const nodes = this.#sim.nodes();
    this.#index ??= buildIndex(nodes);
    const scale =
      symbolScale(this.#camera.transform.k, this.#fitK, nodes.length) * Math.max(this.#grow, 0.01);
    const node = pick(
      this.#index,
      this.#camera.transform,
      offsetX,
      offsetY,
      this.#maxRadius,
      scale,
    );
    return node === null ? -1 : (this.#model?.indexOf.get(node.id) ?? -1);
  }

  #sample(x: number, y: number): void {
    const t = performance.now();
    this.#samples.push({ x, y, t });
    // Two samples are kept whatever their age: when frames come slowly, pointer events come as
    // slowly, and a window that held only the last one would lose every glide.
    while (this.#samples.length > 2 && t - (this.#samples[0]?.t ?? t) > VELOCITY_WINDOW_MS) {
      this.#samples.shift();
    }
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#gesture) {
      return;
    }
    this.#host.setPointerCapture(event.pointerId); // keep the gesture outside the canvas too
    this.#pointerId = event.pointerId;
    this.#downX = event.offsetX;
    this.#downY = event.offsetY;
    this.#cancelDeselect();
    this.#downStoppedGlide = this.#camera.isMoving;
    this.#camera.stop();
    const index = this.#pickAt(event.offsetX, event.offsetY);
    const node = index === -1 ? undefined : this.#sim.nodes()[index];
    if (node) {
      this.#viewHeldByReader = true;
      this.#gesture = { kind: 'drag', node, index };
      this.#sim.pin(node, node.x ?? 0, node.y ?? 0);
      this.#sim.hold();
    } else {
      this.#gesture = { kind: 'pan', lastX: event.offsetX, lastY: event.offsetY };
      this.#samples.length = 0;
      this.#sample(event.offsetX, event.offsetY);
      this.#host.style.cursor = 'grabbing';
    }
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (!gesture) {
      const index = this.#pickAt(event.offsetX, event.offsetY);
      this.#host.style.cursor = index === -1 ? 'grab' : 'pointer';
      this.#setHovered(index);
      return;
    }
    if (event.pointerId !== this.#pointerId) {
      return;
    }
    if (gesture.kind === 'drag') {
      const [gx, gy] = toGraph(this.#camera.transform, event.offsetX, event.offsetY);
      // The warm simulation ticks, and the tick handler draws.
      this.#sim.pin(gesture.node, gx, gy);
      return;
    }
    this.#viewHeldByReader = true;
    this.#camera.panBy(event.offsetX - gesture.lastX, event.offsetY - gesture.lastY);
    gesture.lastX = event.offsetX;
    gesture.lastY = event.offsetY;
    this.#sample(event.offsetX, event.offsetY);
    this.#wake();
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    const gesture = this.#gesture;
    if (!gesture || event.pointerId !== this.#pointerId) {
      return;
    }
    this.#gesture = null;
    this.#pointerId = null;
    this.#host.style.cursor = 'grab';
    const dx = event.offsetX - this.#downX;
    const dy = event.offsetY - this.#downY;
    const click = event.type === 'pointerup' && dx * dx + dy * dy <= CLICK_SLOP_PX * CLICK_SLOP_PX;
    if (gesture.kind === 'pan') {
      // Only a real single click lets go: not a tap that stopped a glide, and not the first
      // half of a double click, which zooms — the timer waits for the second half.
      if (click && this.#selected !== -1 && !this.#downStoppedGlide) {
        this.#deselectTimer = setTimeout(() => {
          this.#deselectTimer = null;
          this.#handlers.onDeselect?.();
        }, DOUBLE_CLICK_MS);
      }
      const first = this.#samples[0];
      const last = this.#samples[this.#samples.length - 1];
      const fresh = last !== undefined && performance.now() - last.t < RELEASE_STALE_MS;
      if (first && last && fresh && last.t > first.t && event.type === 'pointerup') {
        const dt = last.t - first.t;
        this.#camera.release((last.x - first.x) / dt, (last.y - first.y) / dt);
      }
      this.#wake();
      return;
    }
    this.#sim.unpin(gesture.node);
    this.#sim.release();
    if (click) {
      this.#handlers.onOpen(gesture.node.id);
    }
  };

  readonly #onPointerLeave = (): void => {
    if (!this.#gesture) {
      this.#setHovered(-1);
    }
  };

  #cancelDeselect(): void {
    if (this.#deselectTimer !== null) {
      clearTimeout(this.#deselectTimer);
      this.#deselectTimer = null;
    }
  }

  readonly #onDoubleClick = (event: MouseEvent): void => {
    this.#cancelDeselect();
    if (this.#pickAt(event.offsetX, event.offsetY) !== -1) {
      return; // a double click on a bubble is two clicks on a link, not a zoom
    }
    this.#viewHeldByReader = true;
    this.#camera.zoomBy(2, event.offsetX, event.offsetY);
    this.#wake();
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.#viewHeldByReader = true;
    // A trackpad pinch arrives as a stream of ctrlKey wheel events that is smooth already;
    // easing it again would make the field lag behind the fingers.
    this.#camera.zoomBy(2 ** wheelDelta(event), event.offsetX, event.offsetY, {
      immediate: event.ctrlKey,
    });
    this.#wake();
  };
}

/** Whether a box touches the square around the open note's ring and its reticle ticks. */
function overlapsRing(box: Rect, ring: RingMark): boolean {
  const reach = reticleStart(ring.r) + TICK_PX;
  return (
    box.left < ring.x + reach &&
    box.right > ring.x - reach &&
    box.top < ring.y + reach &&
    box.bottom > ring.y - reach
  );
}

/** Sorts order[from…] by rank, best first, in place: insertion sort, since a focus holds tens. */
function sortByRank(order: number[], from: number, rank: Uint32Array): void {
  for (let at = from + 1; at < order.length; at += 1) {
    const index = order[at] ?? 0;
    const value = rank[index] ?? 0;
    let to = at - 1;
    while (to >= from && (rank[order[to] ?? 0] ?? 0) > value) {
      order[to + 1] = order[to] ?? 0;
      to -= 1;
    }
    order[to + 1] = index;
  }
}
