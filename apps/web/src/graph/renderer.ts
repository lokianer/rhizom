// The scene: what is on screen, how it is picked and how it is painted. The geometry here is
// pure so the SVG export and the unit tests can use it without a DOM.
import { quadtree, type Quadtree } from 'd3-quadtree';

import type { Palette } from './palette.js';
import type { SimLink, SimNode } from './simulation.js';

/** screen (CSS px) = graph · k + (x, y) — d3-zoom's convention, without the dependency. */
export interface ViewTransform {
  readonly k: number;
  readonly x: number;
  readonly y: number;
}

export const identity: ViewTransform = { k: 1, x: 0, y: 0 };

export function toGraph(t: ViewTransform, sx: number, sy: number): [number, number] {
  return [(sx - t.x) / t.k, (sy - t.y) / t.k];
}

/** Scales to k1 while the graph point under the screen point (px, py) stays put. */
export function zoomAround(t: ViewTransform, k1: number, px: number, py: number): ViewTransform {
  return { k: k1, x: px - (px - t.x) * (k1 / t.k), y: py - (py - t.y) * (k1 / t.k) };
}

/** Structural, so the tests can pass a plain object where the browser passes a WheelEvent. */
export interface WheelLike {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
}

/**
 * d3-zoom's wheelDelta, kept because it is tuned for every input device: pixels, lines, pages,
 * and the trackpad pinch that browsers report as a wheel event with ctrlKey set. Scale = 2^Δ.
 */
export function wheelDelta(event: WheelLike): number {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
  return -event.deltaY * unit * (event.ctrlKey ? 10 : 1);
}

export interface Scene {
  readonly nodes: readonly SimNode[];
  readonly links: readonly SimLink[];
  readonly transform: ViewTransform;
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** devicePixelRatio on screen, the export scale on a PNG canvas. */
  readonly pixelRatio: number;
  readonly palette: Palette;
  /** Note path of the bubble under the pointer. */
  readonly hovered: string | null;
  /** Note path of the open note. */
  readonly selected: string | null;
}

const TAU = Math.PI * 2;

/** Labels for every bubble from this zoom level upwards; below it only the emphasised ones. */
export const LABEL_MIN_ZOOM = 1.4;
/** CSS pixels — divided by k wherever the canvas draws in graph units. */
export const LABEL_FONT_PX = 13;
const LABEL_GAP_PX = 3;
export const LABEL_HALO_PX = 3;
export const EDGE_PX = 1;
export const EDGE_ACTIVE_PX = 1.6;
const HOVER_RING_PX = 1.6;
const SELECTED_RING_PX = 2.4;

export function isActiveEdge(scene: Scene, edge: SimLink): boolean {
  const { hovered, selected } = scene;
  return (
    (hovered !== null && (edge.source.id === hovered || edge.target.id === hovered)) ||
    (selected !== null && (edge.source.id === selected || edge.target.id === selected))
  );
}

export interface LabelPlacement {
  readonly text: string;
  /** Graph units; the text is centred on x and hangs below y. */
  readonly x: number;
  readonly y: number;
}

/**
 * Labels only where they help: the hovered and the open note always, everything else once the
 * view is zoomed in and only inside the viewport. Text is the most expensive thing on the canvas.
 */
export function sceneLabels(scene: Scene): LabelPlacement[] {
  const { k } = scene.transform;
  const showAll = k >= LABEL_MIN_ZOOM;
  const [left, top] = toGraph(scene.transform, 0, 0);
  const [right, bottom] = toGraph(scene.transform, scene.width, scene.height);
  const placements: LabelPlacement[] = [];
  for (const node of scene.nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (node.id !== scene.hovered && node.id !== scene.selected) {
      if (!showAll || x < left || x > right || y < top || y > bottom) {
        continue;
      }
    }
    placements.push({ text: node.label, x, y: y + node.r + LABEL_GAP_PX / k });
  }
  return placements;
}

export interface RingPlacement {
  readonly x: number;
  readonly y: number;
  /** Graph units, already outside the bubble. */
  readonly r: number;
  readonly color: string;
  readonly width: number;
}

/** The emphasis around the open note and the bubble under the pointer. */
export function sceneRings(scene: Scene): RingPlacement[] {
  const { k } = scene.transform;
  const rings: RingPlacement[] = [];
  for (const node of scene.nodes) {
    const selected = node.id === scene.selected;
    const hovered = node.id === scene.hovered;
    if (!selected && !hovered) {
      continue;
    }
    const width = (selected ? SELECTED_RING_PX : HOVER_RING_PX) / k;
    rings.push({
      x: node.x ?? 0,
      y: node.y ?? 0,
      r: node.r + width,
      color: selected ? scene.palette.accent : scene.palette.edgeActive,
      width,
    });
  }
  return rings;
}

/** One full frame — the live canvas and the export canvas draw through this same function. */
/**
 * The quiet part of the picture: every edge and every bubble, in graph coordinates. Panning
 * and zooming change only the canvas transform, so this is built once per layout change
 * rather than once per frame — at a few tens of thousands of edges that is the difference
 * between a smooth field and a stuttering one.
 */
export interface ScenePaths {
  edges: Path2D;
  /** One path per palette slot, so the fill style changes eight times at most. */
  nodes: (Path2D | null)[];
}

export function buildScenePaths(scene: Scene): ScenePaths {
  const edges = new Path2D();
  for (const edge of scene.links) {
    edges.moveTo(edge.source.x ?? 0, edge.source.y ?? 0);
    edges.lineTo(edge.target.x ?? 0, edge.target.y ?? 0);
  }

  const nodes: (Path2D | null)[] = scene.palette.clusters.map(() => null);
  for (const node of scene.nodes) {
    const slot = Math.min(Math.max(node.colorIndex, 0), nodes.length - 1);
    const path = nodes[slot] ?? new Path2D();
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    path.moveTo(nx + node.r, ny); // arc() starts at angle 0; without this the paths connect
    path.arc(nx, ny, node.r, 0, TAU);
    nodes[slot] = path;
  }

  return { edges, nodes };
}

/** Background, every edge and every bubble: the picture as long as nothing moves. */
export function drawStatic(ctx: CanvasRenderingContext2D, scene: Scene, cached?: ScenePaths): void {
  const { k, x, y } = scene.transform;
  const ratio = scene.pixelRatio;
  const palette = scene.palette;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = palette.bg; // the context has no alpha, so the background is ours to paint
  ctx.fillRect(0, 0, scene.width, scene.height);
  if (scene.width <= 0 || scene.height <= 0) {
    return;
  }
  // Graph units from here on; setting canvas.width resets the context, so this runs every frame.
  ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * x, ratio * y);

  const paths = cached ?? buildScenePaths(scene);
  ctx.lineWidth = EDGE_PX / k;
  ctx.strokeStyle = palette.edge;
  ctx.stroke(paths.edges);

  paths.nodes.forEach((path, slot) => {
    if (path === null) {
      return;
    }
    ctx.fillStyle = palette.clusters[slot] ?? palette.label;
    ctx.fill(path);
  });
}

/** What the pointer changes: the links of the emphasised bubble, its ring, and the labels. */
export function drawOverlay(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { k, x, y } = scene.transform;
  const ratio = scene.pixelRatio;
  const palette = scene.palette;
  if (scene.width <= 0 || scene.height <= 0) {
    return;
  }
  ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * x, ratio * y);

  if (scene.hovered !== null || scene.selected !== null) {
    ctx.lineWidth = EDGE_ACTIVE_PX / k;
    ctx.strokeStyle = palette.edgeActive;
    ctx.beginPath();
    for (const edge of scene.links) {
      if (!isActiveEdge(scene, edge)) {
        continue;
      }
      ctx.moveTo(edge.source.x ?? 0, edge.source.y ?? 0);
      ctx.lineTo(edge.target.x ?? 0, edge.target.y ?? 0);
    }
    ctx.stroke();
  }

  for (const ring of sceneRings(scene)) {
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r, 0, TAU);
    ctx.lineWidth = ring.width;
    ctx.strokeStyle = ring.color;
    ctx.stroke();
  }

  const labels = sceneLabels(scene);
  if (labels.length === 0) {
    return;
  }
  ctx.font = `${String(LABEL_FONT_PX / k)}px ${palette.fontSans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = LABEL_HALO_PX / k;
  ctx.strokeStyle = palette.labelHalo;
  ctx.fillStyle = palette.label;
  for (const label of labels) {
    ctx.strokeText(label.text, label.x, label.y); // halo first, glyphs on top
    ctx.fillText(label.text, label.x, label.y);
  }
}

/** The whole frame in one go, for the exports and for a canvas without a cached layer. */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, cached?: ScenePaths): void {
  drawStatic(ctx, scene, cached);
  drawOverlay(ctx, scene);
}

/** The view that shows every bubble, with a little air around the field. */
export function fitTransform(
  nodes: readonly SimNode[],
  width: number,
  height: number,
  options: { padding?: number; maxScale?: number; minScale?: number } = {},
): ViewTransform {
  const padding = options.padding ?? 48;
  const maxScale = options.maxScale ?? 1.5;
  const minScale = options.minScale ?? 0.1;
  const centre = { k: 1, x: width / 2, y: height / 2 };
  if (nodes.length === 0 || width <= 0 || height <= 0) {
    return centre;
  }

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const x = node.x;
    const y = node.y;
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue; // a node the layout has not placed yet
    }
    left = Math.min(left, x - node.r);
    right = Math.max(right, x + node.r);
    top = Math.min(top, y - node.r);
    bottom = Math.max(bottom, y + node.r);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return centre;
  }

  const fieldWidth = Math.max(right - left, 1);
  const fieldHeight = Math.max(bottom - top, 1);
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);
  // Never magnify a small vault beyond maxScale: three notes should not fill the screen.
  const k = Math.min(
    maxScale,
    Math.max(minScale, Math.min(usableWidth / fieldWidth, usableHeight / fieldHeight)),
  );
  return {
    k,
    x: width / 2 - ((left + right) / 2) * k,
    y: height / 2 - ((top + bottom) / 2) * k,
  };
}

export type NodeIndex = Quadtree<SimNode>;

/** Coordinates must not move while indexed, so this is rebuilt after the positions change. */
export function buildIndex(nodes: readonly SimNode[]): NodeIndex {
  return quadtree<SimNode>()
    .x((node) => node.x ?? 0)
    .y((node) => node.y ?? 0)
    .addAll([...nodes]);
}

/** Screen point (CSS px) → the bubble under it. find() is nearest-centre, so verify the circle. */
export function pick(
  index: NodeIndex,
  transform: ViewTransform,
  sx: number,
  sy: number,
  maxRadius: number,
  slopPx = 4,
): SimNode | null {
  const [gx, gy] = toGraph(transform, sx, sy);
  const slop = slopPx / transform.k;
  const nearest = index.find(gx, gy, maxRadius + slop);
  if (!nearest) {
    return null;
  }
  const dx = gx - (nearest.x ?? 0);
  const dy = gy - (nearest.y ?? 0);
  return dx * dx + dy * dy <= (nearest.r + slop) ** 2 ? nearest : null;
}

export interface FrameLoop {
  request: () => void;
  stop: () => void;
}

/** Coalesces any number of requests into one animation frame. */
export function createFrameLoop(draw: () => void): FrameLoop {
  let handle = 0;
  let pending = false;
  const frame = (): void => {
    pending = false;
    draw();
  };
  return {
    request: () => {
      if (pending) {
        return;
      }
      pending = true;
      handle = requestAnimationFrame(frame);
    },
    stop: () => {
      if (pending) {
        cancelAnimationFrame(handle);
      }
      pending = false;
    },
  };
}
