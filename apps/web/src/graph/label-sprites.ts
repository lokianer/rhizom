// Label glyphs, drawn once. Text is the dearest thing a canvas draws — measured, some 560
// strokeText calls per frame tripled the frame — so each label is rendered a single time, halo and
// all, into a small canvas of its own at device resolution, and every frame after that is one
// drawImage. The milieu names are drawn the same way, soft halo included, so no frame blurs text.
// The cache is bounded by the bytes its canvases hold.
import { LABEL_LINE_HEIGHT } from './labels.js';
import type { MeasureText } from './types.js';

/** CSS px: the stroke in the ground colour round an ordinary label, so it reads over the web. */
export const LABEL_HALO_PX = 3;
/** The weight of a bold label: semibold, in the canvas and in the SVG alike. */
export const LABEL_BOLD_WEIGHT = 600;
/** Room round the text inside a sprite, for the halo and the anti-aliasing. */
const SPRITE_PAD_PX = 3;
/**
 * The budget for the label canvases at a pixel ratio of 1. It grows with the square of the
 * largest ratio drawn for, so a dense frame at a pixel ratio of 2 — its sprites four times the
 * bytes — keeps as many labels as the same frame at 1 does.
 */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/**
 * The sprites of the last two frames are kept even past the budget: evicting what the frame is
 * about to draw would only draw it again, every frame. Past this multiple of it they go anyway.
 */
const HARD_LIMIT = 4;
/**
 * Whatever the pixel ratio, the glyph canvases never hold more than this. The budget grows with the
 * square of the ratio, which on a DPR-3 phone would otherwise allow hundreds of megabytes.
 */
const ABSOLUTE_LIMIT = 64 * 1024 * 1024;
/** An estimate of an average glyph's advance, where a canvas cannot measure. */
const GUESS_EM = 0.55;
const MEASURE_MEMO_MAX = 8192;

// --- the milieu names ----------------------------------------------------------------------

/** Milieu names: semibold capitals, letter-spaced, larger than any note label. */
export const REGION_FONT_PX = 17;
/** Tracking of a milieu name, CSS px after every letter: a fifth of an em. */
export const REGION_TRACKING_PX = REGION_FONT_PX * 0.2;
/**
 * The soft halo in the ground colour under a milieu name, which keeps it legible over the web
 * without an outline: the capitals thickened by a stroke this wide, then blurred this far (a
 * canvas shadow blur, CSS px; a Gaussian of half of it in the SVG).
 */
export const REGION_HALO_STROKE_PX = 4;
export const REGION_HALO_BLUR_PX = 7;
/** A milieu name at full strength is drawn at this alpha: present, not shouting. */
export const REGION_ALPHA = 0.92;
/** Room round a milieu name inside its sprite: the reach of its halo. */
const REGION_PAD_PX = REGION_HALO_BLUR_PX + REGION_HALO_STROKE_PX / 2 + 2;
/** A handful of names per data set and theme; past this many the least recently drawn goes. */
const REGION_SPRITES_MAX = 32;
/** Stands in for tracking where the context has no letterSpacing: a thin space between letters. */
const THIN_SPACE = '\u2009';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const capsMemo = new Map<string, string>();
const spacedMemo = new Map<string, string>();
const CAPS_MEMO_MAX = 256;

/**
 * A milieu name as it is set: in capitals, spaced out with thin spaces where asked (for a
 * context without tracking). Remembered, so a frame builds no strings.
 */
export function regionCaps(text: string, spaced: boolean): string {
  const memo = spaced ? spacedMemo : capsMemo;
  let caps = memo.get(text);
  if (caps === undefined) {
    const upper = text.toUpperCase();
    caps = spaced ? Array.from(upper).join(THIN_SPACE) : upper;
    if (memo.size >= CAPS_MEMO_MAX) {
      memo.clear();
    }
    memo.set(text, caps);
  }
  return caps;
}

/** The width of a milieu name's ink, CSS px: its capitals and the tracking between them. */
export function regionInkWidth(caps: string, capsWidth: number): number {
  // Tracking follows every letter but the last; a letter is a code point, so the second half of
  // a surrogate pair does not count.
  let letters = 0;
  for (let at = 0; at < caps.length; at += 1) {
    const code = caps.charCodeAt(at);
    if (code < 0xdc00 || code > 0xdfff) {
      letters += 1;
    }
  }
  return capsWidth + REGION_TRACKING_PX * Math.max(0, letters - 1);
}

/** What a label is drawn into: an OffscreenCanvas where there is one, else a canvas element. */
export type SpriteImage = HTMLCanvasElement | OffscreenCanvas;
export type CreateCanvas = (width: number, height: number) => SpriteImage;

/** The part of a 2D context a sprite is drawn with, shared by both kinds of canvas. */
export interface SpriteContext {
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineJoin: CanvasLineJoin;
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  /** The milieu names' halo is a shadow, drawn once into their sprite. */
  shadowBlur?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Missing where the browser's canvas has no tracking; the names are spaced out by hand there. */
  letterSpacing?: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  measureText(text: string): { readonly width: number };
  strokeText(text: string, x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
}

/** Both kinds of canvas, seen through the one call a sprite needs of them. */
interface SpriteSurface {
  width: number;
  height: number;
  getContext(contextId: '2d'): SpriteContext | null;
}

/** Everything that decides how a label looks; each distinct combination is one sprite. */
export interface SpriteKey {
  readonly lines: readonly string[];
  /** CSS px. */
  readonly fontPx: number;
  readonly bold: boolean;
  /** Fill of the glyphs. */
  readonly color: string;
  /** Colour of the halo stroked round the glyphs, or null: inside a bubble, or on a plate. */
  readonly halo: string | null;
  readonly pixelRatio: number;
  /** The font family list, palette.fontSans. */
  readonly font: string;
}

/** Everything that decides how a milieu name looks; each distinct combination is one sprite. */
export interface RegionSpriteKey {
  /** The name as the data has it; it is set in capitals. */
  readonly text: string;
  /** Ink of the capitals, from regionInk. */
  readonly color: string;
  /** The ground colour its soft halo is drawn in. */
  readonly halo: string;
  readonly pixelRatio: number;
  /** The font family list, palette.fontSans. */
  readonly font: string;
}

export interface LabelSprite {
  readonly image: SpriteImage;
  /** CSS px: the canvas size divided by the pixel ratio it was drawn for. */
  readonly width: number;
  readonly height: number;
  /** From the centre of the text block to the top left corner of the sprite, CSS px. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface SpriteStats {
  readonly entries: number;
  readonly bytes: number;
  /** Milieu-name sprites, kept apart from the labels' budget. */
  readonly regions: number;
  /** Sprites drawn since the cache was made; every miss draws one. */
  readonly created: number;
  readonly hits: number;
  readonly evicted: number;
}

export interface LabelSpritesOptions {
  /** The tests hand in a fake; the browser gets an OffscreenCanvas or a canvas element. */
  readonly createCanvas?: CreateCanvas | undefined;
  /**
   * Budget for the canvases' pixels, at four bytes a pixel, at a pixel ratio of 1; it grows with
   * the square of the largest ratio drawn for since the last clear.
   */
  readonly maxBytes?: number | undefined;
}

/** The canvas font of a label. Measuring and drawing have to agree on it; bold is semibold. */
export function labelFont(fontPx: number, bold: boolean, family: string): string {
  return `${bold ? `${String(LABEL_BOLD_WEIGHT)} ` : ''}${String(fontPx)}px ${family}`;
}

function defaultCreateCanvas(width: number, height: number): SpriteImage {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: SpriteImage): SpriteContext | null {
  const surface: SpriteSurface = canvas;
  return surface.getContext('2d');
}

/**
 * A MeasureText in the font the sprites are drawn in, remembering every width. The memo is keyed
 * by weight and size first, so a lookup builds no string: placement measures on every frame.
 */
export function createTextMeasure(
  family: string,
  createCanvas: CreateCanvas = defaultCreateCanvas,
): MeasureText {
  const ctx = contextOf(createCanvas(1, 1));
  const regular = new Map<number, Map<string, number>>();
  const semibold = new Map<number, Map<string, number>>();
  return (text, fontPx, bold) => {
    const bySize = bold ? semibold : regular;
    let known = bySize.get(fontPx);
    if (known === undefined) {
      known = new Map();
      bySize.set(fontPx, known);
    }
    let width = known.get(text);
    if (width === undefined) {
      if (ctx) {
        ctx.font = labelFont(fontPx, bold, family);
        width = ctx.measureText(text).width;
      } else {
        width = text.length * fontPx * GUESS_EM;
      }
      if (known.size >= MEASURE_MEMO_MAX) {
        known.clear();
      }
      known.set(text, width);
    }
    return width;
  };
}

/** The sprites of one look: everything in the key but the text. */
interface Bucket {
  readonly fontPx: number;
  readonly bold: boolean;
  readonly color: string;
  readonly halo: string | null;
  readonly pixelRatio: number;
  readonly font: string;
  /** By first line; labels sharing it are chained through Entry.sibling. */
  readonly byFirstLine: Map<string, Entry>;
}

interface RegionEntry {
  readonly text: string;
  readonly color: string;
  readonly halo: string;
  readonly pixelRatio: number;
  readonly font: string;
  readonly sprite: LabelSprite;
  /** The frame that last drew it. */
  frame: number;
}

interface Entry {
  readonly bucket: Bucket;
  readonly lines: readonly string[];
  readonly sprite: LabelSprite;
  readonly bytes: number;
  /** The frame that last drew it. */
  frame: number;
  sibling: Entry | null;
  newer: Entry | null;
  older: Entry | null;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * The glyph cache. `get` returns the sprite for a key, drawing it on the first request; a hit
 * allocates nothing, so the overlay can ask for every label on every frame. Least recently used
 * sprites are evicted once the canvases hold more than the budget (maxBytes, grown with the
 * pixel ratio), except those the current or the previous frame drew (see HARD_LIMIT). `region`
 * does the same for the milieu names, in a small cache of their own.
 */
export class LabelSprites {
  readonly #createCanvas: CreateCanvas;
  readonly #maxBytes: number;
  #buckets: Bucket[] = [];
  #regions: RegionEntry[] = [];
  /** The largest pixel ratio drawn for since the last clear; the budget grows with its square. */
  #ratio = 1;
  #newest: Entry | null = null;
  #oldest: Entry | null = null;
  #entries = 0;
  #bytes = 0;
  #frame = 0;
  #created = 0;
  #hits = 0;
  #evicted = 0;
  /** Made on the first miss; null where the browser gave no context. */
  #measure: SpriteContext | null | undefined = undefined;

  constructor(options: LabelSpritesOptions = {}) {
    this.#createCanvas = options.createCanvas ?? defaultCreateCanvas;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  /** Starts a frame: what it and the frame before draw is kept. drawOverlay calls this. */
  beginFrame(): void {
    this.#frame += 1;
  }

  /** The sprite for the key. The key object itself is not kept, so a caller may reuse it. */
  get(key: SpriteKey): LabelSprite {
    if (key.pixelRatio > this.#ratio) {
      this.#ratio = key.pixelRatio;
    }
    const bucket = this.#bucket(key);
    const first = key.lines[0] ?? '';
    let entry = bucket.byFirstLine.get(first);
    while (entry !== undefined && !sameLines(entry.lines, key.lines)) {
      entry = entry.sibling ?? undefined;
    }
    if (entry !== undefined) {
      this.#hits += 1;
      entry.frame = this.#frame;
      this.#unlink(entry);
      this.#pushNewest(entry);
      return entry.sprite;
    }

    const created = this.#draw(bucket, key);
    created.sibling = bucket.byFirstLine.get(first) ?? null;
    bucket.byFirstLine.set(first, created);
    this.#pushNewest(created);
    this.#entries += 1;
    this.#bytes += created.bytes;
    this.#created += 1;
    this.#evict();
    return created.sprite;
  }

  /**
   * The sprite of a milieu name: its capitals, tracked, over a soft halo in the ground colour,
   * drawn on the first request and blitted after that. A hit allocates nothing; the key object
   * is not kept.
   */
  region(key: RegionSpriteKey): LabelSprite {
    let oldest: RegionEntry | null = null;
    for (const entry of this.#regions) {
      if (
        entry.text === key.text &&
        entry.color === key.color &&
        entry.halo === key.halo &&
        entry.pixelRatio === key.pixelRatio &&
        entry.font === key.font
      ) {
        entry.frame = this.#frame;
        return entry.sprite;
      }
      if (oldest === null || entry.frame < oldest.frame) {
        oldest = entry;
      }
    }
    if (oldest !== null && this.#regions.length >= REGION_SPRITES_MAX) {
      releaseImage(oldest.sprite.image);
      this.#regions.splice(this.#regions.indexOf(oldest), 1);
    }
    const sprite = this.#drawRegion(key);
    this.#regions.push({
      text: key.text,
      color: key.color,
      halo: key.halo,
      pixelRatio: key.pixelRatio,
      font: key.font,
      sprite,
      frame: this.#frame,
    });
    return sprite;
  }

  /** Drops every sprite: the palette, the font or the pixel ratio changed. */
  clear(): void {
    for (let entry = this.#newest; entry !== null; entry = entry.older) {
      release(entry);
    }
    for (const entry of this.#regions) {
      releaseImage(entry.sprite.image);
    }
    this.#buckets = [];
    this.#regions = [];
    this.#ratio = 1;
    this.#newest = null;
    this.#oldest = null;
    this.#entries = 0;
    this.#bytes = 0;
  }

  get stats(): SpriteStats {
    return {
      entries: this.#entries,
      bytes: this.#bytes,
      regions: this.#regions.length,
      created: this.#created,
      hits: this.#hits,
      evicted: this.#evicted,
    };
  }

  #bucket(key: SpriteKey): Bucket {
    // A handful of looks per frame (three sizes, two weights, three inks), so a scan is enough.
    for (const bucket of this.#buckets) {
      if (
        bucket.fontPx === key.fontPx &&
        bucket.bold === key.bold &&
        bucket.color === key.color &&
        bucket.halo === key.halo &&
        bucket.pixelRatio === key.pixelRatio &&
        bucket.font === key.font
      ) {
        return bucket;
      }
    }
    const bucket: Bucket = {
      fontPx: key.fontPx,
      bold: key.bold,
      color: key.color,
      halo: key.halo,
      pixelRatio: key.pixelRatio,
      font: key.font,
      byFirstLine: new Map(),
    };
    this.#buckets.push(bucket);
    return bucket;
  }

  #draw(bucket: Bucket, key: SpriteKey): Entry {
    const ratio = key.pixelRatio > 0 ? key.pixelRatio : 1;
    const lines = [...key.lines];
    const font = labelFont(key.fontPx, key.bold, key.font);
    const lineHeight = key.fontPx * LABEL_LINE_HEIGHT;

    const measure = this.#measureContext();
    let textWidth = 0;
    if (measure) {
      measure.font = font;
    }
    for (const line of lines) {
      const width = measure ? measure.measureText(line).width : line.length * key.fontPx * GUESS_EM;
      textWidth = Math.max(textWidth, width);
    }

    const deviceWidth = Math.max(1, Math.ceil((textWidth + SPRITE_PAD_PX * 2) * ratio));
    const deviceHeight = Math.max(
      1,
      Math.ceil((lines.length * lineHeight + SPRITE_PAD_PX * 2) * ratio),
    );
    const canvas = this.#createCanvas(deviceWidth, deviceHeight);
    const width = deviceWidth / ratio;
    const height = deviceHeight / ratio;
    const ctx = contextOf(canvas);
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const x = width / 2;
      const top = (height - lines.length * lineHeight) / 2;
      if (key.halo !== null) {
        // The one strokeText a label ever costs: here, once, and never per frame.
        ctx.lineJoin = 'round';
        ctx.lineWidth = LABEL_HALO_PX;
        ctx.strokeStyle = key.halo;
        lines.forEach((line, row) => {
          ctx.strokeText(line, x, top + lineHeight * (row + 0.5));
        });
      }
      ctx.fillStyle = key.color;
      lines.forEach((line, row) => {
        ctx.fillText(line, x, top + lineHeight * (row + 0.5));
      });
    }
    return {
      bucket,
      lines,
      sprite: { image: canvas, width, height, offsetX: -width / 2, offsetY: -height / 2 },
      bytes: deviceWidth * deviceHeight * 4,
      frame: this.#frame,
      sibling: null,
      newer: null,
      older: null,
    };
  }

  /** The context text is measured with, made on the first miss; null where there is none. */
  #measureContext(): SpriteContext | null {
    // Asked once: `??=` would ask again on every miss where the answer was null.
    if (this.#measure === undefined) {
      this.#measure = contextOf(this.#createCanvas(1, 1));
    }
    return this.#measure;
  }

  #drawRegion(key: RegionSpriteKey): LabelSprite {
    const ratio = key.pixelRatio > 0 ? key.pixelRatio : 1;
    const font = labelFont(REGION_FONT_PX, true, key.font);
    const caps = regionCaps(key.text, false);
    const measure = this.#measureContext();
    if (measure) {
      measure.font = font;
    }
    const capsWidth = measure
      ? measure.measureText(caps).width
      : caps.length * REGION_FONT_PX * GUESS_EM;
    const inkWidth = regionInkWidth(caps, capsWidth);
    const deviceWidth = Math.max(1, Math.ceil((inkWidth + REGION_PAD_PX * 2) * ratio));
    const deviceHeight = Math.max(
      1,
      Math.ceil((REGION_FONT_PX * LABEL_LINE_HEIGHT + REGION_PAD_PX * 2) * ratio),
    );
    const canvas = this.#createCanvas(deviceWidth, deviceHeight);
    const width = deviceWidth / ratio;
    const height = deviceHeight / ratio;
    const ctx = contextOf(canvas);
    if (ctx) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.font = font;
      ctx.textBaseline = 'middle';
      // With tracking the run starts at the left of the ink and ends a tracking past its right,
      // so it is set from the left; spaced out by hand it is centred like any text.
      const tracking = 'letterSpacing' in ctx;
      const text = tracking ? caps : regionCaps(key.text, true);
      if (tracking) {
        ctx.letterSpacing = `${String(REGION_TRACKING_PX)}px`;
      }
      ctx.textAlign = tracking ? 'left' : 'center';
      const x = tracking ? REGION_PAD_PX : width / 2;
      const y = height / 2;
      // The halo is the shadow of the capitals set far to the left, off the sprite: only the soft
      // shadow lands on it, never a hard outline. Shadow offsets ignore the transform.
      const away = width + REGION_PAD_PX * 4;
      ctx.lineJoin = 'round';
      ctx.lineWidth = REGION_HALO_STROKE_PX;
      ctx.strokeStyle = key.halo;
      ctx.fillStyle = key.halo;
      ctx.shadowColor = key.halo;
      ctx.shadowBlur = REGION_HALO_BLUR_PX * ratio;
      ctx.shadowOffsetX = away * ratio;
      ctx.shadowOffsetY = 0;
      ctx.strokeText(text, x - away, y);
      ctx.fillText(text, x - away, y);
      ctx.shadowBlur = 0;
      ctx.shadowColor = TRANSPARENT;
      ctx.shadowOffsetX = 0;
      ctx.fillStyle = key.color;
      ctx.fillText(text, x, y);
    }
    return { image: canvas, width, height, offsetX: -width / 2, offsetY: -height / 2 };
  }

  #evict(): void {
    const ratio = Math.max(1, this.#ratio);
    const budget = this.#maxBytes * ratio * ratio;
    const hardLimit = Math.min(budget * HARD_LIMIT, ABSOLUTE_LIMIT);
    while (this.#bytes > budget) {
      const oldest = this.#oldest;
      // The sprite just drawn is always the newest, and it is about to be drawn: never it.
      if (oldest === null || oldest === this.#newest) {
        return;
      }
      if (oldest.frame >= this.#frame - 1 && this.#bytes <= hardLimit) {
        return; // everything left was drawn by this frame or the last
      }
      this.#remove(oldest);
      this.#evicted += 1;
    }
  }

  #remove(entry: Entry): void {
    this.#unlink(entry);
    const { bucket } = entry;
    const first = entry.lines[0] ?? '';
    const head = bucket.byFirstLine.get(first);
    if (head === entry) {
      if (entry.sibling === null) {
        bucket.byFirstLine.delete(first);
      } else {
        bucket.byFirstLine.set(first, entry.sibling);
      }
    } else {
      for (let previous = head; previous !== undefined; previous = previous.sibling ?? undefined) {
        if (previous.sibling === entry) {
          previous.sibling = entry.sibling;
          break;
        }
      }
    }
    if (bucket.byFirstLine.size === 0) {
      // Swapped with the last bucket and popped: the order of the buckets means nothing.
      const buckets = this.#buckets;
      const index = buckets.indexOf(bucket);
      if (index >= 0) {
        const last = buckets.pop();
        if (last !== undefined && index < buckets.length) {
          buckets[index] = last;
        }
      }
    }
    release(entry);
    this.#entries -= 1;
    this.#bytes -= entry.bytes;
  }

  #pushNewest(entry: Entry): void {
    entry.newer = null;
    entry.older = this.#newest;
    if (this.#newest !== null) {
      this.#newest.newer = entry;
    }
    this.#newest = entry;
    this.#oldest ??= entry;
  }

  #unlink(entry: Entry): void {
    if (entry.newer !== null) {
      entry.newer.older = entry.older;
    } else if (this.#newest === entry) {
      this.#newest = entry.older;
    }
    if (entry.older !== null) {
      entry.older.newer = entry.newer;
    } else if (this.#oldest === entry) {
      this.#oldest = entry.newer;
    }
    entry.newer = null;
    entry.older = null;
  }
}

/** Gives the pixels back at once instead of whenever the canvas is collected. */
function release(entry: Entry): void {
  releaseImage(entry.sprite.image);
}

function releaseImage(image: SpriteImage): void {
  image.width = 0;
  image.height = 0;
}
