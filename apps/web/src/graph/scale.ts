// How the field generalises with the zoom, the way a map does: symbols shrink when a large vault
// is seen whole, the web thins out where it would turn to felt, and labels come in three sizes by
// importance. Pure functions of numbers the controller already has.
import { smoothstep } from './motion.js';
import { LabelSize } from './types.js';

/** From this many notes on, a vault seen whole draws its bubbles smaller. */
export const SYMBOL_SCALE_FROM = 300;
/** The bubbles' share of their true size at the fitted zoom. */
export const SYMBOL_SCALE_MIN = 0.6;
/** At this multiple of the fitted zoom the bubbles are back at their true size. */
const SYMBOL_SCALE_SPAN = 3;

/**
 * Multiplier on every bubble radius. Below 300 notes it is always 1. Above, it is 0.6 at the
 * fitted zoom and below, and grows back to 1 at three times the fitted zoom — smoothly, and in log
 * scale, because zooming is multiplicative: each wheel notch should change the symbols by as much
 * as the last one did.
 */
export function symbolScale(k: number, fitK: number, count: number): number {
  if (count < SYMBOL_SCALE_FROM || !(fitK > 0) || !(k > 0)) {
    return 1;
  }
  const t = Math.log(k / fitK) / Math.log(SYMBOL_SCALE_SPAN);
  return SYMBOL_SCALE_MIN + (1 - SYMBOL_SCALE_MIN) * smoothstep(0, 1, t);
}

/**
 * Edges per 100 × 100 CSS px up to which the web keeps its full strength. A small vault, and a
 * large one zoomed in far enough to follow single threads, sit below it.
 */
const EDGE_DENSITY_FULL = 7;
/** The web never fades below this share of its colour: a thread must stay visible as a thread. */
const EDGE_DENSITY_FLOOR = 0.2;

/**
 * The quiet edges' alpha factor from how many of them are on screen and how much screen there
 * is (CSS px²). Where n translucent hairlines of alpha a cross a pixel it is covered about n·a.
 * Keeping n·a constant (a ∝ 1/n) would hold the grey level of every view equal, but a single
 * thread would vanish as the vault grows; leaving a constant turns a dense view into felt. The
 * inverse square root sits between the two: a denser view still reads as denser — which is
 * information — but only by the square root. On a 1920 × 937 screen, 17,000 links seen whole
 * (about 94 per 100 px square) draw at a little over a quarter of their strength, 2,500 links at
 * about 0.7, and anything under seven per square at full strength.
 */
export function edgeDensity(visibleEdgeCount: number, viewportAreaPx: number): number {
  if (!(viewportAreaPx > 0) || !(visibleEdgeCount > 0)) {
    return 1;
  }
  const perSquare = (visibleEdgeCount * 10_000) / viewportAreaPx;
  return Math.min(1, Math.max(EDGE_DENSITY_FLOOR, Math.sqrt(EDGE_DENSITY_FULL / perSquare)));
}

/** Share of the notes, the best-linked first, that get the large label. */
const LARGE_SHARE = 0.03;
/** Share after those that gets the medium one. */
const MEDIUM_SHARE = 0.15;
/** A small vault still has a few notes that stand out. */
const LARGE_AT_LEAST = 3;

/**
 * The label size of the note at `rank` (0 is the best-linked) among `count`: the top 3 % large —
 * at least the top three — the next 15 % medium, the rest small.
 */
export function labelSizeOf(rank: number, count: number): LabelSize {
  if (!(rank >= 0) || rank >= count) {
    return LabelSize.small;
  }
  const large = Math.max(LARGE_AT_LEAST, Math.ceil(LARGE_SHARE * count));
  if (rank < large) {
    return LabelSize.large;
  }
  return rank < large + Math.ceil(MEDIUM_SHARE * count) ? LabelSize.medium : LabelSize.small;
}
