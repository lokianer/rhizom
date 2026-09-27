// The contracts between the parts of the bubble field: what the controller hands the renderers,
// the overlay and the exporters. Kept in one place so each part can be built and tested on its
// own, and so a second renderer (the Canvas 2D fallback) cannot quietly drift from the first.
import type { Palette } from './palette.js';
import type { ViewTransform } from './view.js';

/** A contract type with its fields writable: for the objects a module refills in place. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** An axis-aligned rectangle in CSS pixels. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Per-node flags, one byte each, as the renderers receive them. */
export const NodeFlag = {
  /** Part of the current focus: the hovered note and its neighbours, or a focused cluster. */
  focus: 1,
  hovered: 2,
  selected: 4,
  /** A neighbour of the open note. */
  selectedNeighbour: 8,
} as const;

/** What the renderers need of the notes that does not change while the layout moves. */
export interface FieldNodes {
  readonly count: number;
  /** Bubble radius in graph units. */
  readonly radius: Float32Array;
  /** Palette slot 0 … 7. */
  readonly slot: Uint8Array;
  readonly degree: Float32Array;
  /** 1 where the note's cluster is large enough to have a territory, else 0. */
  readonly territory: Uint8Array;
}

/** One data set: the notes and their links as flat index pairs [s0, t0, s1, t1, …]. */
export interface FieldData {
  readonly nodes: FieldNodes;
  readonly edges: Uint32Array;
}

/** Which of the two grounds the palette resolves to: dark soil or chalk paper. */
export type Ground = 'humus' | 'kalk';

/** Everything that decides one frame of the field, in the order the controller works it out. */
export interface FieldFrame {
  readonly transform: ViewTransform;
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** devicePixelRatio on screen, the export scale on a PNG canvas. */
  readonly pixelRatio: number;
  readonly palette: Palette;
  readonly ground: Ground;
  /**
   * 0 … 1: how far everything outside the focus has sunk into the ground (animated). A renderer
   * sinks every bubble without NodeFlag.focus by this much, so the focus flags and focusIndex
   * must stay in place until it is back at 0: cleared early, they would sink the whole field for
   * the fade-out.
   */
  readonly focusAmount: number;
  /** Index of the hovered note whose links are lit, or -1. */
  readonly focusIndex: number;
  /** True while a cluster (a legend row) is the focus rather than one note. */
  readonly clusterFocus: boolean;
  /** Index of the open note, or -1. */
  readonly selectedIndex: number;
  /** 0 … 1: how far the lit links have drawn themselves out from the focus. */
  readonly drawOn: number;
  /** 0 … 1: the entry growth; 1 is every bubble at full size. */
  readonly grow: number;
  /** Multiplier on every radius: the cartographic symbol scale of a large vault at overview. */
  readonly symbolScale: number;
  /** True while the camera moves: renderers may draw cheaper (straight edges). */
  readonly moving: boolean;
  /** 0 … 1: quiet-edge alpha factor from the density of what is on screen. */
  readonly edgeDensity: number;
  /** 0 … 1: strength of the territory wash (0 switches the pass off). */
  readonly territory: number;
}

/** A renderer of the field below the words: ground, territories, edges, bubbles. */
export interface FieldRenderer {
  readonly kind: 'webgl2' | 'canvas2d';
  /** True once the renderer cannot draw any more (a context lost for good). */
  readonly lost: boolean;
  setData: (data: FieldData) => void;
  /** Positions by node index, [x0, y0, x1, y1, …] in graph units. Kept by reference until the next call. */
  setPositions: (xy: Float32Array) => void;
  /**
   * NodeFlag bits by node index, uploaded when this is called: changing the array afterwards is
   * not enough. The focus flags stay until focusAmount is back at 0 (see FieldFrame).
   */
  setStates: (states: Uint8Array) => void;
  /** Draws into the canvas the renderer was created on; the caller has sized it already. */
  render: (frame: FieldFrame) => void;
  destroy: () => void;
}

export interface RendererEvents {
  /** The context was lost; the controller stops drawing until onRestored or falls back. */
  onLost?: () => void;
  onRestored?: () => void;
}

/** Creates a renderer on a canvas, or returns null where that kind of context is unavailable. */
export type RendererFactory = (
  canvas: HTMLCanvasElement,
  events?: RendererEvents,
) => FieldRenderer | null;

// --- the words -----------------------------------------------------------------------------

/** Three sizes of note label, chosen by how well linked the note is. */
export const LabelSize = { small: 0, medium: 1, large: 2 } as const;
export type LabelSize = (typeof LabelSize)[keyof typeof LabelSize];

/** A note that may be labelled, already in screen space (CSS px), most important first. */
export interface LabelCandidate {
  readonly index: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** On-screen bubble radius. */
  readonly r: number;
  readonly size: LabelSize;
  /** Hovered or open: always placed, on a plate, before anything else. */
  readonly emphasised: boolean;
  /** The open note: its plate carries the accent. */
  readonly selected: boolean;
  /** 0 … 1: dimmed labels (outside a focus) are drawn fainter; 0 means leave it out. */
  readonly alpha: number;
  /** Cluster colour of the bubble: the dot on a plate, the ink of a name inside it. */
  readonly fill: string;
}

export interface PlacedLabel {
  readonly index: number;
  readonly lines: readonly string[];
  /** Centre of the text block, CSS px. */
  readonly x: number;
  readonly y: number;
  readonly fontPx: number;
  readonly bold: boolean;
  /** Drawn inside its bubble rather than beside it. */
  readonly inside: boolean;
  /** On a pill plate: the hovered and the open note. */
  readonly plate: boolean;
  /** The open note's plate, drawn with the accent border. */
  readonly selected: boolean;
  /**
   * Cluster colour of the bubble: the dot on a plate, and what the ink of a name inside the
   * bubble is chosen for when it is drawn (look.ts, insideInk).
   */
  readonly fill: string;
  readonly alpha: number;
  /** The space the label occupies, plate included. */
  readonly box: Rect;
}

/** A cluster's name set into the field at overview. */
export interface RegionName {
  readonly text: string;
  /** Centre, CSS px. */
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly color: string;
}

export interface RingMark {
  /** Centre, CSS px. */
  readonly x: number;
  readonly y: number;
  /** Bubble radius on screen; the ring sits outside it. */
  readonly r: number;
}

/** Everything the 2D overlay draws in one frame. */
export interface OverlayFrame {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly palette: Palette;
  readonly ground: Ground;
  readonly labels: readonly PlacedLabel[];
  readonly regions: readonly RegionName[];
  readonly selected: RingMark | null;
  readonly hovered: RingMark | null;
}

/** Measures a single line of label text in CSS px at a size and weight. */
export type MeasureText = (text: string, fontPx: number, bold: boolean) => number;
