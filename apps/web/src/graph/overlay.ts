// The words over the field, on a transparent 2D canvas stacked above the WebGL one: the milieu
// names, the hover and selection rings, the label plates and the labels themselves. The names and
// the labels come out of the sprite cache, so no glyph is rasterised here, frame after frame.
import {
  REGION_ALPHA,
  REGION_FONT_PX,
  REGION_HALO_BLUR_PX,
  REGION_HALO_STROKE_PX,
  regionCaps,
  regionInkWidth,
  type LabelSprites,
  type RegionSpriteKey,
  type SpriteKey,
} from './label-sprites.js';
import { LABEL_LINE_HEIGHT, PLATE_DOT_R, PLATE_PAD_X, PLATE_PAD_Y } from './labels.js';
import { insideInk } from './look.js';
import { parseColor } from './palette.js';
import type {
  Ground,
  MeasureText,
  Mutable,
  OverlayFrame,
  PlacedLabel,
  Rect,
  RegionName,
  RingMark,
} from './types.js';

/**
 * How far a milieu name's colour moves from the cluster colour towards the label colour: well
 * over, so the name reads on soil and on paper alike and still carries its milieu's tint.
 */
export const REGION_TINT = 0.62;
/**
 * Room round a milieu name's ink that labels keep clear of. At its ends, the whole reach of its
 * halo and a little air: a note's name set beside it on the same line would otherwise read on
 * into it ("Amber Signal 136 IDEAS"). Above and below, the dense part of the halo.
 */
export const REGION_ROOM_X_PX = REGION_HALO_BLUR_PX + REGION_HALO_STROKE_PX / 2 + 3;
const REGION_ROOM_Y_PX = 5;
// The ring geometry is exported so the SVG export draws the very same marks.
/** From the rim to the inner edge of the hover ring, and the ring's stroke. */
const HOVER_RING_GAP_PX = 1.5;
export const HOVER_RING_PX = 1.5;
/** From the rim to the inner edge of the selection ring, and the ring's stroke. */
export const SELECTION_RING_GAP_PX = 3;
export const SELECTION_RING_PX = 2;
/** From the rim to the outer edge of the selection ring; the plates keep beyond it. */
export const SELECTION_RING_REACH_PX = SELECTION_RING_GAP_PX + SELECTION_RING_PX;
/** The reticle: four short ticks, this far outside the selection ring and this long. */
export const TICK_GAP_PX = 2;
export const TICK_PX = 5;
/** A plate lifts off the field by a soft shadow: deep on soil, a faint warm one on paper. */
export const PLATE_SHADOW: Readonly<Record<Ground, string>> = {
  humus: 'rgba(0, 0, 0, 0.45)',
  kalk: 'rgba(60, 44, 28, 0.2)',
};
/** The plate shadow's blur and drop, CSS px (a canvas blur; a Gaussian of half of it in SVG). */
export const PLATE_SHADOW_BLUR_PX = 10;
export const PLATE_SHADOW_Y_PX = 2;
/** The border of a plate, CSS px: the edge colour, or the accent on the open note's plate. */
export const PLATE_BORDER_PX = 1;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const TAU = Math.PI * 2;

/**
 * Draws one frame of the overlay. Clears the canvas, then paints the milieu names, the rings, the
 * plates and the label sprites, in that order — each layer above the one before. Allocates nothing
 * once the sprites and the milieu colours of a palette are made.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: OverlayFrame,
  sprites: LabelSprites,
): void {
  const ratio = frame.pixelRatio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, frame.width, frame.height);
  if (!(frame.width > 0 && frame.height > 0)) {
    return;
  }
  sprites.beginFrame();
  drawRegions(ctx, frame, sprites);
  drawRings(ctx, frame);
  drawPlates(ctx, frame);
  drawSprites(ctx, frame, sprites);
  ctx.globalAlpha = 1;
}

/**
 * The space a milieu name's ink takes on screen, and the room round it, for placeLabels'
 * obstacles and for telling overlapping names apart: the same capitals, font and tracking its
 * sprite is set in.
 */
export function regionBox(
  region: RegionName,
  measure: MeasureText,
  out: Mutable<Rect> = { left: 0, top: 0, right: 0, bottom: 0 },
): Rect {
  const caps = regionCaps(region.text, false);
  const halfWidth =
    regionInkWidth(caps, measure(caps, REGION_FONT_PX, true)) / 2 + REGION_ROOM_X_PX;
  const halfHeight = (REGION_FONT_PX * LABEL_LINE_HEIGHT) / 2 + REGION_ROOM_Y_PX;
  out.left = region.x - halfWidth;
  out.top = region.y - halfHeight;
  out.right = region.x + halfWidth;
  out.bottom = region.y + halfHeight;
  return out;
}

// --- milieu names ------------------------------------------------------------------------------

/** Refilled for every name: a sprite lookup builds no key object. */
const regionKey: Mutable<RegionSpriteKey> = {
  text: '',
  color: '',
  halo: '',
  pixelRatio: 1,
  font: '',
};

function drawRegions(
  ctx: CanvasRenderingContext2D,
  frame: OverlayFrame,
  sprites: LabelSprites,
): void {
  const { regions, palette, pixelRatio: ratio } = frame;
  if (regions.length === 0) {
    return;
  }
  // Each name is a sprite, halo and all, blitted 1:1 on whole device pixels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  regionKey.halo = palette.labelHalo;
  regionKey.pixelRatio = ratio;
  regionKey.font = palette.fontSans;
  for (const region of regions) {
    if (!(region.alpha > 0) || region.text === '') {
      continue;
    }
    regionKey.text = region.text;
    regionKey.color = regionInk(region.color, palette.label);
    const sprite = sprites.region(regionKey);
    ctx.globalAlpha = Math.min(1, region.alpha) * REGION_ALPHA;
    ctx.drawImage(
      sprite.image,
      Math.round((region.x + sprite.offsetX) * ratio),
      Math.round((region.y + sprite.offsetY) * ratio),
    );
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

let inkLabel: string | null = null;
const inkMemo = new Map<string, string>();
const INK_MEMO_MAX = 256;

/**
 * The colour a milieu name is set in: its cluster colour moved well towards the label colour,
 * tinted like its territory but legible over it. Remembered per colour, so a frame builds no
 * string.
 */
export function regionInk(color: string, label: string): string {
  if (label !== inkLabel) {
    inkLabel = label;
    inkMemo.clear();
  }
  let ink = inkMemo.get(color);
  if (ink === undefined) {
    const [r0, g0, b0] = parseColor(color);
    const [r1, g1, b1] = parseColor(label);
    const mix = (from: number, to: number): string =>
      String(Math.round((from + (to - from) * REGION_TINT) * 255));
    ink = `rgb(${mix(r0, r1)}, ${mix(g0, g1)}, ${mix(b0, b1)})`;
    if (inkMemo.size >= INK_MEMO_MAX) {
      inkMemo.clear();
    }
    inkMemo.set(color, ink);
  }
  return ink;
}

// --- rings -------------------------------------------------------------------------------------

/** The centre line of the hover ring round a bubble of on-screen radius r. */
export function hoverRingRadius(r: number): number {
  return r + HOVER_RING_GAP_PX + HOVER_RING_PX / 2;
}

/** The centre line of the selection ring; its ticks start TICK_GAP_PX past the stroke's edge. */
export function selectionRingRadius(r: number): number {
  return r + SELECTION_RING_GAP_PX + SELECTION_RING_PX / 2;
}

/** From the centre to where each reticle tick starts: a gap past the selection ring's stroke. */
export function reticleStart(r: number): number {
  return selectionRingRadius(r) + SELECTION_RING_PX / 2 + TICK_GAP_PX;
}

function sameMark(a: RingMark, b: RingMark): boolean {
  return a.x === b.x && a.y === b.y && a.r === b.r;
}

/** Over the open note the selection ring says more than the hover ring would: it alone is drawn. */
export function showsHoverRing(hovered: RingMark | null, selected: RingMark | null): boolean {
  return hovered !== null && !(selected !== null && sameMark(hovered, selected));
}

function drawRings(ctx: CanvasRenderingContext2D, frame: OverlayFrame): void {
  const { hovered, selected, palette } = frame;
  ctx.globalAlpha = 1;
  if (hovered !== null && showsHoverRing(hovered, selected)) {
    ctx.lineWidth = HOVER_RING_PX;
    ctx.strokeStyle = palette.edgeActive;
    ctx.beginPath();
    ctx.arc(hovered.x, hovered.y, hoverRingRadius(hovered.r), 0, TAU);
    ctx.stroke();
  }
  if (selected === null) {
    return;
  }
  const { x, y } = selected;
  // The gap between the bubble and its ring is ground: the open note's links end at the rim, and
  // without this their last pixels show as stubs between the two, which makes the ring look torn.
  ctx.lineWidth = SELECTION_RING_GAP_PX;
  ctx.strokeStyle = palette.bg;
  ctx.beginPath();
  ctx.arc(x, y, selected.r + SELECTION_RING_GAP_PX / 2, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = SELECTION_RING_PX;
  ctx.strokeStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(x, y, selectionRingRadius(selected.r), 0, TAU);
  ctx.stroke();
  // Four ticks, like a reticle: the open note reads as locked on.
  const inner = reticleStart(selected.r);
  const outer = inner + TICK_PX;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + inner, y);
  ctx.lineTo(x + outer, y);
  ctx.moveTo(x - inner, y);
  ctx.lineTo(x - outer, y);
  ctx.moveTo(x, y + inner);
  ctx.lineTo(x, y + outer);
  ctx.moveTo(x, y - inner);
  ctx.lineTo(x, y - outer);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// --- labels ------------------------------------------------------------------------------------

/** A pill for one line; for two, the same rounded ends on a taller plate rather than a lozenge. */
export function plateRadius(label: PlacedLabel, width: number, height: number): number {
  const oneLine = label.fontPx * LABEL_LINE_HEIGHT + PLATE_PAD_Y * 2;
  return Math.max(0, Math.min(oneLine / 2, width / 2, height / 2));
}

/** The centre of a plate's cluster dot: PLATE_PAD_X in from the plate's left end… */
export function plateDotX(label: PlacedLabel): number {
  return label.box.left + PLATE_PAD_X + PLATE_DOT_R;
}

/** …and level with the first line of the name. */
export function plateDotY(label: PlacedLabel): number {
  return label.y - ((label.lines.length - 1) * label.fontPx * LABEL_LINE_HEIGHT) / 2;
}

function drawPlates(ctx: CanvasRenderingContext2D, frame: OverlayFrame): void {
  const { labels, palette, pixelRatio: ratio } = frame;
  for (const label of labels) {
    if (!label.plate || !(label.alpha > 0)) {
      continue;
    }
    // Whole device pixels, so the one-pixel border is crisp.
    const left = Math.round(label.box.left * ratio) / ratio;
    const top = Math.round(label.box.top * ratio) / ratio;
    const right = Math.round(label.box.right * ratio) / ratio;
    const bottom = Math.round(label.box.bottom * ratio) / ratio;
    const radius = plateRadius(label, right - left, bottom - top);
    ctx.globalAlpha = Math.min(1, label.alpha);
    ctx.shadowColor = PLATE_SHADOW[frame.ground];
    ctx.shadowBlur = PLATE_SHADOW_BLUR_PX * ratio;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = PLATE_SHADOW_Y_PX * ratio;
    ctx.fillStyle = palette.plate;
    tracePlate(ctx, left, top, right, bottom, radius);
    ctx.fill();
    ctx.shadowColor = TRANSPARENT;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const inset = PLATE_BORDER_PX / 2;
    ctx.lineWidth = PLATE_BORDER_PX;
    // The open note's plate carries the accent of its ring.
    ctx.strokeStyle = label.selected ? palette.accent : palette.edge;
    tracePlate(ctx, left + inset, top + inset, right - inset, bottom - inset, radius - inset);
    ctx.stroke();
    // The dot in the cluster colour: which milieu the note belongs to, at a glance.
    ctx.fillStyle = label.fill;
    ctx.beginPath();
    ctx.arc(plateDotX(label), plateDotY(label), PLATE_DOT_R, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tracePlate(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number,
): void {
  const quarter = Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.arc(right - radius, top + radius, radius, -quarter, 0);
  ctx.lineTo(right, bottom - radius);
  ctx.arc(right - radius, bottom - radius, radius, 0, quarter);
  ctx.lineTo(left + radius, bottom);
  ctx.arc(left + radius, bottom - radius, radius, quarter, Math.PI);
  ctx.lineTo(left, top + radius);
  ctx.arc(left + radius, top + radius, radius, Math.PI, Math.PI + quarter);
  ctx.closePath();
}

/** Refilled for every label: a sprite lookup builds no key object. */
const spriteKey: Mutable<SpriteKey> = {
  lines: [],
  fontPx: 0,
  bold: false,
  color: '',
  halo: null,
  pixelRatio: 1,
  font: '',
};

function drawSprites(
  ctx: CanvasRenderingContext2D,
  frame: OverlayFrame,
  sprites: LabelSprites,
): void {
  const { labels, palette, ground, pixelRatio: ratio } = frame;
  if (labels.length === 0) {
    return;
  }
  // Blitted 1:1 on whole device pixels: a sprite drawn between pixels would be resampled, blurred.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  spriteKey.pixelRatio = ratio;
  spriteKey.font = palette.fontSans;
  // The least important first, so where an emphasised plate was forced over a name it ends on top.
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    if (label === undefined || !(label.alpha > 0)) {
      continue;
    }
    spriteKey.lines = label.lines;
    spriteKey.fontPx = label.fontPx;
    spriteKey.bold = label.bold;
    spriteKey.color = label.inside ? insideInk(palette, ground, label.fill) : palette.label;
    // Inside a bubble the glyphs sit on a flat fill, on a plate on the plate: no halo in either.
    spriteKey.halo = label.inside || label.plate ? null : palette.labelHalo;
    const sprite = sprites.get(spriteKey);
    ctx.globalAlpha = Math.min(1, label.alpha);
    ctx.drawImage(
      sprite.image,
      Math.round((label.x + sprite.offsetX) * ratio),
      Math.round((label.y + sprite.offsetY) * ratio),
    );
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
