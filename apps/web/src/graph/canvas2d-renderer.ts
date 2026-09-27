// The bubble field on a plain 2D canvas: the renderer for browsers without WebGL2, and for a
// WebGL context that was lost and did not come back. It draws the WebGL renderer's picture in a
// cheaper form — a flat ground, straight quiet edges in a path per length class cached once the
// layout rests, bubbles and their light blitted from sprites painted once per colour and size —
// and it leaves the territories out: a wash over the density of the notes is a blur of the whole
// field, the very cost a machine without WebGL cannot pay on every layout change. The numbers of
// the look are shared with the WebGL field and the SVG export, the entry growth with the WebGL
// field, and the bubble shading with the SVG export (all in look.ts).
import {
  bubbleFade,
  bubbleShading,
  EDGE_CLASS_WEIGHTS,
  EDGE_CLASSES,
  edgeClass,
  FOCUS_SINK,
  glowStrength,
  growthAt,
  haloStrength,
  LIT_EDGE,
  LIT_GLOW,
  lightReach,
  lightStops,
  litColor,
  litCrowd,
  MIN_BUBBLE_FADE,
  MIN_BUBBLE_PX,
  QUIET_EDGE_SINK,
  RIM_MIN_RADIUS_PX,
  SELECTED_EDGE,
  SPARK,
  sparkFade,
  sparkStops,
  SPECULAR_MIN_RADIUS_PX,
  withAlpha,
  type BubbleShading,
  type GradientStop,
  type LightKind,
} from './look.js';
import { clamp01, smoothstep } from './motion.js';
import { parseColor, type Palette, type Rgba } from './palette.js';
import { buildIncidence, sizeOrder, type Incidence } from './topology.js';
import {
  NodeFlag,
  type FieldData,
  type FieldFrame,
  type FieldNodes,
  type FieldRenderer,
  type Ground,
  type RendererEvents,
  type RendererFactory,
} from './types.js';

const TAU = Math.PI * 2;
/** How long the positions must rest before the quiet edges are traced into cached paths. */
const PATHS_AFTER_REST_MS = 250;

function cssColor(color: Rgba): string {
  const channel = (value: number): string => String(Math.round(value * 255));
  return (
    `rgba(${channel(color[0])}, ${channel(color[1])}, ${channel(color[2])}, ` +
    `${String(Math.round(color[3] * 1000) / 1000)})`
  );
}

// --- sprite sizes --------------------------------------------------------------------------

/**
 * Below this device radius — most of a large vault at overview — a bubble is blitted unscaled at
 * whole pixels, the cheapest image draw a 2D canvas has, from sprites 5 % apart in size.
 */
export const SNAP_RADIUS_PX = 12;
const FINE_STEP = 1.05;
const LOG_FINE = Math.log(FINE_STEP);
const FINE_BUCKETS = Math.ceil(Math.log(SNAP_RADIUS_PX / MIN_BUBBLE_PX) / LOG_FINE) + 1;
/**
 * Above it sprites are √2 apart and only ever scaled down. The last is 12 · √2⁷ ≈ 136 px; larger
 * bubbles — a handful at deep zoom — are painted as vectors, since a sprite that size costs a
 * megabyte per colour.
 */
const COARSE_STEP = Math.SQRT2;
const LOG_COARSE = Math.log(COARSE_STEP);
const COARSE_BUCKETS = 8;
export const SPRITE_BUCKETS = FINE_BUCKETS + COARSE_BUCKETS;

/** The radius a sprite of this bucket is painted at, in device px. */
export function bucketRadius(bucket: number): number {
  return bucket < FINE_BUCKETS
    ? MIN_BUBBLE_PX * FINE_STEP ** bucket
    : SNAP_RADIUS_PX * COARSE_STEP ** (bucket - FINE_BUCKETS);
}

export const MAX_SPRITE_RADIUS = bucketRadius(SPRITE_BUCKETS - 1);

/**
 * The sprite for a bubble of this device radius: below the snap radius the nearest fine one,
 * above it the smallest coarse one at least as large as the bubble.
 */
export function spriteBucket(deviceRadius: number): number {
  if (!(deviceRadius > MIN_BUBBLE_PX)) {
    return 0;
  }
  if (deviceRadius < SNAP_RADIUS_PX) {
    const fine = Math.round(Math.log(deviceRadius / MIN_BUBBLE_PX) / LOG_FINE);
    return fine < FINE_BUCKETS ? fine : FINE_BUCKETS - 1;
  }
  // The epsilon keeps a radius that sits exactly on a bucket in that bucket, not the next.
  const coarse = Math.ceil(Math.log(deviceRadius / SNAP_RADIUS_PX) / LOG_COARSE - 1e-9);
  return FINE_BUCKETS + (coarse < COARSE_BUCKETS ? coarse : COARSE_BUCKETS - 1);
}

/** True for the sprites that are blitted unscaled. */
export function isSnapped(bucket: number): boolean {
  return bucket < FINE_BUCKETS;
}

// --- painting ------------------------------------------------------------------------------

type Context2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A small off-screen canvas a sprite is painted on. */
export interface SpriteSurface {
  readonly ctx: Context2d;
  /** The finished picture, as cheap a drawImage source as the browser offers. */
  readonly finish: () => CanvasImageSource;
}

export type CreateSurface = (width: number, height: number) => SpriteSurface | null;

interface Sprite {
  readonly source: CanvasImageSource;
  /** The radius, device px, the bubble or the light was painted at. */
  readonly radius: number;
  /** Half the side of the sprite, device px: the radius plus room for a shadow or a halo. */
  readonly half: number;
}

/** The gradients of one bubble in unit space, made by the context that fills with them. */
interface BubbleStyles {
  readonly body: CanvasGradient;
  readonly rim: string;
  readonly shadow: CanvasGradient | null;
  readonly specular: CanvasGradient | null;
}

function createBubbleStyles(ctx: Context2d, shading: BubbleShading): BubbleStyles {
  const body = ctx.createRadialGradient(shading.lightX, shading.lightY, 0.02, 0, 0, 1);
  for (const stop of shading.body) {
    body.addColorStop(stop.offset, cssColor(stop.color));
  }
  let shadow: CanvasGradient | null = null;
  if (shading.shadow !== null) {
    const { x, y, inner, outer, color } = shading.shadow;
    shadow = ctx.createRadialGradient(x, y, inner, x, y, outer);
    shadow.addColorStop(0, cssColor(color));
    shadow.addColorStop(1, cssColor(withAlpha(color, 0)));
  }
  let specular: CanvasGradient | null = null;
  if (shading.specular !== null) {
    const { x, y, r, alpha } = shading.specular;
    specular = ctx.createRadialGradient(x, y, 0, x, y, r);
    specular.addColorStop(0, cssColor([1, 1, 1, alpha]));
    specular.addColorStop(1, cssColor([1, 1, 1, 0]));
  }
  return { body, rim: cssColor(shading.rim), shadow, specular };
}

/**
 * Paints one bubble of radius 1 at the origin of the current transform, which the caller has
 * scaled to `deviceRadius` px. Only path and fill calls: no object is made here, so it can run
 * inside a frame for the few bubbles too large for a sprite.
 */
function paintBubble(
  ctx: Context2d,
  shading: BubbleShading,
  styles: BubbleStyles,
  deviceRadius: number,
): void {
  if (shading.shadow !== null && styles.shadow !== null) {
    ctx.beginPath();
    ctx.arc(shading.shadow.x, shading.shadow.y, shading.shadow.outer, 0, TAU);
    ctx.fillStyle = styles.shadow;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fillStyle = styles.body;
  ctx.fill();
  if (deviceRadius >= RIM_MIN_RADIUS_PX) {
    const width = Math.max(shading.rimMinPx / deviceRadius, shading.rimWidth);
    ctx.beginPath();
    ctx.arc(0, 0, 1 - width / 2, 0, TAU);
    ctx.lineWidth = width;
    ctx.strokeStyle = styles.rim;
    ctx.stroke();
  }
  if (
    shading.specular !== null &&
    styles.specular !== null &&
    deviceRadius >= SPECULAR_MIN_RADIUS_PX
  ) {
    ctx.beginPath();
    ctx.arc(shading.specular.x, shading.specular.y, shading.specular.r, 0, TAU);
    ctx.fillStyle = styles.specular;
    ctx.fill();
  }
}

/** Paints a round light of radius 1 filled with the stops, at the current transform. */
function paintLight(ctx: Context2d, stops: readonly GradientStop[]): void {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, cssColor(stop.color));
  }
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function createDefaultSurface(width: number, height: number): SpriteSurface | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // An ImageBitmap is a cheaper drawImage source than a canvas, which has to be snapshotted.
    return ctx === null ? null : { ctx, finish: () => canvas.transferToImageBitmap() };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx === null ? null : { ctx, finish: () => canvas };
}

function closeSource(source: CanvasImageSource): void {
  if ('close' in source && typeof source.close === 'function') {
    source.close(); // an ImageBitmap holds its pixels until closed or collected
  }
}

/** Radius, device px, the spark sprite is painted at; it is soft, so one size serves all. */
const SPARK_SPRITE_PX = 24;
/**
 * The light round a bubble is painted per whole device radius, since its reach past the rim is
 * the same for every bubble; past this radius — a bubble filling much of the screen — the
 * largest is scaled up.
 */
const LIGHT_MAX_RADIUS = 256;
/** A hub's neighbours come in a few dozen sizes; past this many light sprites they start over. */
const LIGHT_SPRITES_MAX = 256;
/** A link that is left out of the quiet web: a loop, an unknown note, a note not yet placed. */
const NO_CLASS = 255;

const PASS_ALL = 0;
const PASS_REST = 1;
const PASS_RAISED = 2;
/**
 * What stays above the soil under a focus: the focus itself, and the open note, which keeps its
 * place so it can still be traced while the pointer is elsewhere.
 */
const RAISED = NodeFlag.focus | NodeFlag.selected;

/** The web fades in with the entry growth rather than standing there before its bubbles. */
function webGrowth(grow: number): number {
  return grow >= 1 ? 1 : smoothstep(0, 1, (grow - 0.2) / 0.8);
}

export interface Canvas2dOptions {
  /** Paints the sprites off screen; the default is an OffscreenCanvas, else a detached canvas. */
  readonly createSurface?: CreateSurface | undefined;
  /** Collects the quiet edges; the default is `new Path2D()`. */
  readonly createPath?: (() => Path2D) | undefined;
}

/**
 * The fallback renderer with its canvas-making injected, so the tests can drive it in Node. Use
 * `createCanvas2dFieldRenderer` in the app.
 */
export function createCanvas2dRenderer(
  canvas: HTMLCanvasElement,
  events: RendererEvents = {},
  options: Canvas2dOptions = {},
): FieldRenderer | null {
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) {
    return null;
  }
  const ctx: CanvasRenderingContext2D = context;
  const createSurface = options.createSurface ?? createDefaultSurface;
  const createPath = options.createPath ?? ((): Path2D => new Path2D());

  let destroyed = false;
  let nodes: FieldNodes | null = null;
  let pairs: Uint32Array = new Uint32Array(0);
  let count = 0;
  let incidence: Incidence = { offsets: new Uint32Array(1), links: new Uint32Array(0) };
  let order: Uint32Array = new Uint32Array(0);
  let positions: Float32Array | null = null;
  let states: Uint8Array = new Uint8Array(0);

  /**
   * The length class of every link (look.ts edgeClass), or NO_CLASS for one that is not drawn,
   * worked out once per change of the positions: long links are fainter than short ones, and a
   * path per class strokes each class at its own alpha.
   */
  let edgeClasses = new Uint8Array(0);
  const classCounts = new Uint32Array(EDGE_CLASSES);
  /**
   * Every quiet edge of a class in graph units, traced once the positions rest, so a frame of
   * pan or zoom strokes each as it is. While the layout runs they are not built at all (see
   * drawQuietEdges).
   */
  const edgePaths: (Path2D | null)[] = new Array<Path2D | null>(EDGE_CLASSES).fill(null);
  /** The positions changed since the last frame that drew the edges. */
  let edgesMoved = true;
  /** The cached paths no longer match the positions. */
  let edgePathStale = true;
  /** When the positions last moved: the cached paths wait until they have rested a while. */
  let lastMove = Number.NEGATIVE_INFINITY;
  /** The classes no longer match the positions. */
  let classesStale = true;
  /** Centre and half-diagonal of the field, for the entry growth from the centre outwards. */
  let boundsDirty = true;
  let centreX = 0;
  let centreY = 0;
  let reach = 1;

  // The look: everything painted from the palette, dropped when the palette or ground changes.
  let lookPalette: Palette | null = null;
  let lookGround: Ground | null = null;
  let shadings: BubbleShading[] = [];
  /** Indexed slot · SPRITE_BUCKETS + bucket; null where a surface could not be made. */
  let sprites: (Sprite | null | undefined)[] = [];
  /** Unit-space gradients on the main context, for bubbles too large for a sprite. */
  let vectorStyles: (BubbleStyles | undefined)[] = [];
  /** The quiet edge colour of each length class, its weight folded into the alpha. */
  let edgeStrokes: string[] = [];
  /** The stroke of a lit link (look.ts litColor). */
  let litStroke = '';
  /** Halos and glows by kind and whole device radius (see lightKey), painted for `lightRatio`. */
  let lights = new Map<number, Sprite | null>();
  let lightRatio = 0;
  let spark: Sprite | null | undefined;

  // Where project() puts a bubble, device px: scratch space, so a frame allocates nothing.
  let atX = 0;
  let atY = 0;
  let atR = 0;
  /** 0 … 1: how strongly the bubble is drawn for its size (look.ts bubbleFade). */
  let atFade = 1;
  // Worked out once per frame rather than once per bubble: graph → device scale and offset,
  // and the canvas size, whose getters are DOM calls.
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let deviceWidth = 0;
  let deviceHeight = 0;

  function releaseLights(): void {
    for (const light of lights.values()) {
      if (light) {
        closeSource(light.source);
      }
    }
    lights = new Map();
  }

  function releaseLook(): void {
    for (const sprite of sprites) {
      if (sprite) {
        closeSource(sprite.source);
      }
    }
    releaseLights();
    if (spark) {
      closeSource(spark.source);
    }
    sprites = [];
    vectorStyles = [];
    spark = undefined;
    lookPalette = null;
    lookGround = null;
  }

  function resetLook(palette: Palette, ground: Ground): void {
    releaseLook();
    lookPalette = palette;
    lookGround = ground;
    const slots = Math.max(1, palette.clusters.length);
    shadings = Array.from({ length: slots }, (_, slot) => bubbleShading(palette, ground, slot));
    sprites = new Array<Sprite | null | undefined>(slots * SPRITE_BUCKETS);
    const edge = parseColor(palette.edge);
    edgeStrokes = EDGE_CLASS_WEIGHTS.map((weight) =>
      weight === 1 ? palette.edge : cssColor(withAlpha(edge, Math.min(1, edge[3] * weight))),
    );
    litStroke = cssColor(litColor(palette));
  }

  function paintSprite(slot: number, bucket: number, shading: BubbleShading): Sprite | null {
    const radius = bucketRadius(bucket);
    const extent =
      shading.shadow === null
        ? 1
        : shading.shadow.outer + Math.hypot(shading.shadow.x, shading.shadow.y);
    const half = Math.ceil(radius * extent + 2);
    const surface = createSurface(half * 2, half * 2);
    if (surface === null) {
      return null;
    }
    surface.ctx.setTransform(radius, 0, 0, radius, half, half);
    paintBubble(surface.ctx, shading, createBubbleStyles(surface.ctx, shading), radius);
    return { source: surface.finish(), radius, half };
  }

  function paintSparkSprite(stops: readonly GradientStop[]): Sprite | null {
    const radius = SPARK_SPRITE_PX;
    const surface = createSurface(radius * 2, radius * 2);
    if (surface === null) {
      return null;
    }
    surface.ctx.setTransform(radius, 0, 0, radius, radius, radius);
    paintLight(surface.ctx, stops);
    return { source: surface.finish(), radius, half: radius };
  }

  /**
   * The light of one kind round a bubble of this whole device radius: clear under the bubble,
   * then the light's own falloff out to its reach, which is the same for every bubble.
   */
  function paintLightSprite(kind: LightKind, radius: number, pixelRatio: number): Sprite | null {
    if (lookPalette === null || lookGround === null) {
      return null;
    }
    const outer = radius + lightReach(lookGround, kind) * pixelRatio;
    const half = Math.ceil(outer) + 1;
    const surface = createSurface(half * 2, half * 2);
    if (surface === null) {
      return null;
    }
    surface.ctx.setTransform(outer, 0, 0, outer, half, half);
    paintLight(surface.ctx, lightStops(lookPalette, lookGround, kind, radius / outer));
    return { source: surface.finish(), radius, half };
  }

  function lightSprite(kind: LightKind, pixelRatio: number): Sprite | null {
    if (pixelRatio !== lightRatio) {
      releaseLights();
      lightRatio = pixelRatio;
    }
    const radius = Math.min(LIGHT_MAX_RADIUS, Math.max(1, Math.round(atR)));
    const key = radius * 2 + (kind === 'glow' ? 1 : 0);
    let light = lights.get(key);
    if (light === undefined) {
      if (lights.size >= LIGHT_SPRITES_MAX) {
        releaseLights();
      }
      light = paintLightSprite(kind, radius, pixelRatio);
      lights.set(key, light);
    }
    return light;
  }

  function slotOf(index: number): number {
    const slot = nodes?.slot[index] ?? 0;
    return slot < shadings.length ? slot : shadings.length - 1;
  }

  /** Sorts every link into its length class for the current positions, O(links). */
  function classifyEdges(xy: Float32Array): void {
    classesStale = false;
    classCounts.fill(0);
    const links = pairs.length >> 1;
    if (edgeClasses.length < links) {
      edgeClasses = new Uint8Array(links);
    }
    for (let link = 0; link < links; link += 1) {
      const a = pairs[link * 2] ?? count;
      const b = pairs[link * 2 + 1] ?? count;
      let cls = NO_CLASS;
      if (a !== b && a < count && b < count) {
        const dx = (xy[b * 2] ?? Number.NaN) - (xy[a * 2] ?? Number.NaN);
        const dy = (xy[b * 2 + 1] ?? Number.NaN) - (xy[a * 2 + 1] ?? Number.NaN);
        const length = Math.sqrt(dx * dx + dy * dy);
        // A note the layout has not placed yet makes the length NaN.
        if (Number.isFinite(length)) {
          cls = edgeClass(length);
          classCounts[cls] = (classCounts[cls] ?? 0) + 1;
        }
      }
      edgeClasses[link] = cls;
    }
  }

  /** Adds every quiet edge of a class to a path, the context's own or a Path2D; returns how many. */
  function traceQuietEdges(path: CanvasPath, xy: Float32Array, cls: number): number {
    let drawn = 0;
    const links = pairs.length >> 1;
    for (let link = 0; link < links; link += 1) {
      if (edgeClasses[link] !== cls) {
        continue;
      }
      const a = pairs[link * 2] ?? 0;
      const b = pairs[link * 2 + 1] ?? 0;
      path.moveTo(xy[a * 2] ?? 0, xy[a * 2 + 1] ?? 0);
      path.lineTo(xy[b * 2] ?? 0, xy[b * 2 + 1] ?? 0);
      drawn += 1;
    }
    return drawn;
  }

  function measureBounds(xy: Float32Array): void {
    boundsDirty = false;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < count; index += 1) {
      const x = xy[index * 2] ?? Number.NaN;
      const y = xy[index * 2 + 1] ?? Number.NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      centreX = 0;
      centreY = 0;
      reach = 1;
      return;
    }
    centreX = (left + right) / 2;
    centreY = (top + bottom) / 2;
    reach = Math.max(1, Math.sqrt((right - left) ** 2 + (bottom - top) ** 2) / 2);
  }

  /** Puts node `index` on screen into atX, atY, atR, atFade; false when it is not drawn this frame. */
  function project(index: number, frame: FieldFrame, xy: Float32Array): boolean {
    const x = xy[index * 2] ?? Number.NaN;
    const y = xy[index * 2 + 1] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    let r = (nodes?.radius[index] ?? 0) * frame.symbolScale * scale;
    if (frame.grow < 1) {
      // The WebGL field's entry growth: staggered outwards from the centre, a little overshoot.
      const dx = x - centreX;
      const dy = y - centreY;
      r *= growthAt(frame.grow, Math.sqrt(dx * dx + dy * dy) / reach);
    }
    if (!(r > 0)) {
      return false;
    }
    atX = x * scale + offsetX;
    atY = y * scale + offsetY;
    // Below the smallest size a bubble fades rather than shrinks, as on the WebGL field.
    atFade = bubbleFade(r);
    atR = r < MIN_BUBBLE_PX ? MIN_BUBBLE_PX : r;
    return true;
  }

  function onScreen(extent: number): boolean {
    return (
      atX + extent >= 0 &&
      atX - extent <= deviceWidth &&
      atY + extent >= 0 &&
      atY - extent <= deviceHeight
    );
  }

  function drawBubble(slot: number): void {
    const shading = shadings[slot];
    if (shading === undefined) {
      return;
    }
    if (atR <= MAX_SPRITE_RADIUS) {
      const bucket = spriteBucket(atR);
      const at = slot * SPRITE_BUCKETS + bucket;
      let sprite = sprites[at];
      if (sprite === undefined) {
        sprite = paintSprite(slot, bucket, shading); // once per colour and size, then blitted
        sprites[at] = sprite;
      }
      if (sprite !== null && isSnapped(bucket)) {
        ctx.drawImage(sprite.source, Math.round(atX - sprite.half), Math.round(atY - sprite.half));
        return;
      }
      if (sprite !== null) {
        const half = sprite.half * (atR / sprite.radius);
        ctx.drawImage(sprite.source, atX - half, atY - half, half * 2, half * 2);
        return;
      }
    }
    let styles = vectorStyles[slot];
    if (styles === undefined) {
      styles = createBubbleStyles(ctx, shading);
      vectorStyles[slot] = styles;
    }
    ctx.setTransform(atR, 0, 0, atR, atX, atY);
    paintBubble(ctx, shading, styles, atR);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawPass(frame: FieldFrame, xy: Float32Array, pass: number): void {
    ctx.globalAlpha = 1;
    for (let at = 0; at < count; at += 1) {
      const index = order[at] ?? 0;
      if (pass !== PASS_ALL) {
        const raised = ((states[index] ?? 0) & RAISED) !== 0;
        if (raised !== (pass === PASS_RAISED)) {
          continue;
        }
      }
      if (!project(index, frame, xy) || atFade < MIN_BUBBLE_FADE || !onScreen(atR * 1.4)) {
        continue;
      }
      if (atFade < 1) {
        ctx.globalAlpha = atFade;
        drawBubble(slotOf(index));
        ctx.globalAlpha = 1;
      } else {
        drawBubble(slotOf(index));
      }
    }
  }

  /** One light round the bubble project() last placed, at `strength`. */
  function drawLight(kind: LightKind, strength: number, frame: FieldFrame): void {
    if (lookGround === null) {
      return;
    }
    const outer = atR + lightReach(lookGround, kind) * frame.pixelRatio;
    if (!onScreen(outer)) {
      return;
    }
    const light = lightSprite(kind, frame.pixelRatio);
    if (!light) {
      return;
    }
    // Scaled so its rim lands on the bubble's: it was painted for the nearest whole radius.
    const half = light.half * (atR / light.radius);
    ctx.globalAlpha = strength * atFade;
    ctx.drawImage(light.source, atX - half, atY - half, half * 2, half * 2);
  }

  /**
   * The halos and glows, under their bubbles. On soil they are light added to the ground, as
   * the WebGL field adds them; on paper they are ink laid over it.
   */
  function drawLights(frame: FieldFrame, xy: Float32Array, raisedOnly: boolean): void {
    let additive = false;
    for (let at = 0; at < count; at += 1) {
      const index = order[at] ?? 0;
      const flags = states[index] ?? 0;
      if (raisedOnly && (flags & RAISED) === 0) {
        continue;
      }
      const halo = haloStrength(flags, frame);
      const glow = glowStrength(flags, index, frame);
      if ((halo <= 0 && glow <= 0) || !project(index, frame, xy)) {
        continue;
      }
      if (!additive && frame.ground === 'humus') {
        additive = true;
        ctx.globalCompositeOperation = 'lighter';
      }
      if (halo > 0) {
        drawLight('halo', halo, frame);
      }
      if (glow > 0) {
        drawLight('glow', glow, frame);
      }
    }
    if (additive) {
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawQuietEdges(frame: FieldFrame, xy: Float32Array, sink: number): void {
    // Under a focus the ground laid over the field sinks these too; they are drawn a little
    // fainter first so that they end QUIET_EDGE_SINK down, a step below the bubbles.
    const amount = clamp01(frame.focusAmount);
    const sunk = sink > 0 ? clamp01((1 - QUIET_EDGE_SINK * amount) / (1 - sink)) : 1;
    const alpha = clamp01(frame.edgeDensity) * webGrowth(frame.grow) * sunk;
    if (alpha <= 0.002) {
      return;
    }
    if (classesStale) {
      classifyEdges(xy);
    }
    toGraphSpace();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1 / scale; // one device pixel: wider falls off a cliff in software
    // While the layout runs the positions move before most frames, and a frame without a tick in
    // between (the growth, a camera glide) does not mean they rest: the cached paths are built
    // only once nothing has moved for a while, or every such frame would build a set of Path2Ds
    // whose native memory the collector does not see piling up.
    const resting = performance.now() - lastMove >= PATHS_AFTER_REST_MS;
    if (edgesMoved || !resting) {
      // Traced into the context's own path, which is reused.
      edgesMoved = false;
      for (let cls = 0; cls < EDGE_CLASSES; cls += 1) {
        if ((classCounts[cls] ?? 0) === 0) {
          continue;
        }
        ctx.beginPath();
        traceQuietEdges(ctx, xy, cls);
        ctx.strokeStyle = edgeStrokes[cls] ?? frame.palette.edge;
        ctx.stroke();
      }
      return;
    }
    if (edgePathStale) {
      // The positions rest: traced once more, into the paths every frame of pan and zoom reuses.
      edgePathStale = false;
      for (let cls = 0; cls < EDGE_CLASSES; cls += 1) {
        let path: Path2D | null = null;
        if ((classCounts[cls] ?? 0) > 0) {
          path = createPath();
          traceQuietEdges(path, xy, cls);
        }
        edgePaths[cls] = path;
      }
    }
    for (let cls = 0; cls < EDGE_CLASSES; cls += 1) {
      const path = edgePaths[cls];
      if (path) {
        ctx.strokeStyle = edgeStrokes[cls] ?? frame.palette.edge;
        ctx.stroke(path);
      }
    }
  }

  /**
   * How far along the line from `node` to `other` the tip of a link drawing itself out has got:
   * it travels from the rim of the one to the rim of the other, so it neither hides under the
   * hovered bubble at first nor runs on under the neighbour's at the end.
   */
  function tipAt(
    node: number,
    other: number,
    dx: number,
    dy: number,
    drawOn: number,
    symbolScale: number,
  ): number {
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!(length > 0)) {
      return 0;
    }
    const from = Math.min(1, ((nodes?.radius[node] ?? 0) * symbolScale) / length);
    const to = Math.max(from, 1 - ((nodes?.radius[other] ?? 0) * symbolScale) / length);
    return from + (to - from) * clamp01(drawOn);
  }

  /**
   * Adds a node's links to the current path: whole when `drawOn` is 1, else each out to its tip
   * (tipAt). Returns how many it traced.
   */
  function traceLinks(node: number, xy: Float32Array, drawOn: number, symbolScale: number): number {
    const fx = xy[node * 2] ?? Number.NaN;
    const fy = xy[node * 2 + 1] ?? Number.NaN;
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) {
      return 0;
    }
    let traced = 0;
    const end = incidence.offsets[node + 1] ?? 0;
    for (let at = incidence.offsets[node] ?? 0; at < end; at += 1) {
      const link = incidence.links[at] ?? 0;
      const a = pairs[link * 2] ?? node;
      const other = a === node ? (pairs[link * 2 + 1] ?? node) : a;
      if (other === node) {
        continue;
      }
      const ox = xy[other * 2] ?? Number.NaN;
      const oy = xy[other * 2 + 1] ?? Number.NaN;
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
        continue;
      }
      const t = drawOn >= 1 ? 1 : tipAt(node, other, ox - fx, oy - fy, drawOn, symbolScale);
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + (ox - fx) * t, fy + (oy - fy) * t);
      traced += 1;
    }
    return traced;
  }

  /**
   * Adds every link between two members of the focused cluster to the current path. O(notes +
   * the members' links), and only in the frames of a legend row's focus.
   */
  function traceClusterLinks(xy: Float32Array): number {
    let traced = 0;
    for (let node = 0; node < count; node += 1) {
      if (((states[node] ?? 0) & NodeFlag.focus) === 0) {
        continue;
      }
      const nx = xy[node * 2] ?? Number.NaN;
      const ny = xy[node * 2 + 1] ?? Number.NaN;
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        continue;
      }
      const end = incidence.offsets[node + 1] ?? 0;
      for (let at = incidence.offsets[node] ?? 0; at < end; at += 1) {
        const link = incidence.links[at] ?? 0;
        // Each link once, from the end it was written from.
        if ((pairs[link * 2] ?? count) !== node) {
          continue;
        }
        const other = pairs[link * 2 + 1] ?? node;
        if (other === node || ((states[other] ?? 0) & NodeFlag.focus) === 0) {
          continue;
        }
        const ox = xy[other * 2] ?? Number.NaN;
        const oy = xy[other * 2 + 1] ?? Number.NaN;
        if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
          continue;
        }
        ctx.moveTo(nx, ny);
        ctx.lineTo(ox, oy);
        traced += 1;
      }
    }
    return traced;
  }

  /** Graph units from here on: paths built in them follow pan and zoom without a rebuild. */
  function toGraphSpace(): void {
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  }

  /** The open note's links in the accent colour, at `strength` of their full alpha. */
  function drawSelectedEdges(frame: FieldFrame, xy: Float32Array, strength: number): void {
    toGraphSpace();
    ctx.beginPath();
    traceLinks(frame.selectedIndex, xy, 1, frame.symbolScale);
    ctx.globalAlpha = SELECTED_EDGE.alpha[frame.ground] * strength * webGrowth(frame.grow);
    ctx.lineWidth = SELECTED_EDGE.px / frame.transform.k;
    ctx.strokeStyle = frame.palette.accent;
    ctx.stroke();
  }

  /** The hovered note's links as far as they have drawn out, or a focused cluster's links. */
  function drawLitEdges(frame: FieldFrame, xy: Float32Array): void {
    toGraphSpace();
    ctx.beginPath();
    const links = frame.clusterFocus
      ? traceClusterLinks(xy)
      : traceLinks(frame.focusIndex, xy, frame.drawOn, frame.symbolScale);
    if (links === 0) {
      return;
    }
    const amount = clamp01(frame.focusAmount);
    const crowd = litCrowd(links);
    const k = frame.transform.k;
    ctx.lineCap = 'round';
    if (frame.ground === 'humus' && crowd > LIT_GLOW.minCrowd) {
      ctx.globalAlpha = LIT_GLOW.alpha * crowd * amount;
      ctx.lineWidth = LIT_GLOW.px / k;
      ctx.strokeStyle = frame.palette.glow;
      ctx.stroke();
    }
    ctx.globalAlpha = amount * (crowd > LIT_EDGE.floor ? crowd : LIT_EDGE.floor);
    // Never thinner than the quiet web it lies on.
    ctx.lineWidth = Math.max(1 / scale, (LIT_EDGE.px * Math.sqrt(crowd)) / k);
    ctx.strokeStyle = litStroke;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function drawSparks(frame: FieldFrame, xy: Float32Array): void {
    const focus = frame.focusIndex;
    const degree = (incidence.offsets[focus + 1] ?? 0) - (incidence.offsets[focus] ?? 0);
    const crowd = litCrowd(degree);
    const strength =
      clamp01(frame.focusAmount) *
      sparkFade(clamp01(frame.drawOn)) *
      (crowd > SPARK.floor ? crowd : SPARK.floor);
    if (strength <= 0.004) {
      return;
    }
    if (spark === undefined && lookPalette !== null) {
      spark = paintSparkSprite(sparkStops(lookPalette, frame.ground));
    }
    const fx = xy[focus * 2] ?? Number.NaN;
    const fy = xy[focus * 2 + 1] ?? Number.NaN;
    if (!spark || !Number.isFinite(fx) || !Number.isFinite(fy)) {
      return;
    }
    const size = SPARK.px * frame.pixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = strength;
    // Light on soil, as the WebGL field adds it.
    const additive = frame.ground === 'humus';
    if (additive) {
      ctx.globalCompositeOperation = 'lighter';
    }
    const end = incidence.offsets[focus + 1] ?? 0;
    for (let at = incidence.offsets[focus] ?? 0; at < end; at += 1) {
      const link = incidence.links[at] ?? 0;
      const a = pairs[link * 2] ?? focus;
      const other = a === focus ? (pairs[link * 2 + 1] ?? focus) : a;
      const ox = xy[other * 2] ?? Number.NaN;
      const oy = xy[other * 2 + 1] ?? Number.NaN;
      if (other === focus || !Number.isFinite(ox) || !Number.isFinite(oy)) {
        continue;
      }
      const t = tipAt(focus, other, ox - fx, oy - fy, frame.drawOn, frame.symbolScale);
      atX = (fx + (ox - fx) * t) * scale + offsetX;
      atY = (fy + (oy - fy) * t) * scale + offsetY;
      if (onScreen(size)) {
        ctx.drawImage(spark.source, atX - size, atY - size, size * 2, size * 2);
      }
    }
    if (additive) {
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function render(frame: FieldFrame): void {
    if (destroyed) {
      return;
    }
    deviceWidth = canvas.width;
    deviceHeight = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = frame.palette.bg; // the context has no alpha: the ground is ours to paint
    ctx.fillRect(0, 0, deviceWidth, deviceHeight);
    const xy = positions;
    if (
      xy === null ||
      count === 0 ||
      deviceWidth === 0 ||
      deviceHeight === 0 ||
      !(frame.transform.k > 0) ||
      !(frame.pixelRatio > 0)
    ) {
      return;
    }
    scale = frame.transform.k * frame.pixelRatio;
    offsetX = frame.transform.x * frame.pixelRatio;
    offsetY = frame.transform.y * frame.pixelRatio;
    if (frame.palette !== lookPalette || frame.ground !== lookGround) {
      resetLook(frame.palette, frame.ground);
    }
    if (frame.grow < 1 && boundsDirty) {
      measureBounds(xy);
    }
    const amount = clamp01(frame.focusAmount);
    const sink = FOCUS_SINK[frame.ground] * amount;
    const selected = frame.selectedIndex >= 0 && frame.selectedIndex < count;

    // Links first and bubbles over them: bubbles are opaque and the links end underneath.
    drawQuietEdges(frame, xy, sink);
    if (!(sink > 0)) {
      if (selected) {
        drawSelectedEdges(frame, xy, 1);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawLights(frame, xy, false);
      drawPass(frame, xy, PASS_ALL);
      ctx.globalAlpha = 1;
      return;
    }

    // With a focus, the rest sinks into the soil: the ground itself is laid over it, evenly,
    // where fading each bubble would let overlapping ones stack up brighter than the rest.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawPass(frame, xy, PASS_REST);
    ctx.globalAlpha = sink;
    ctx.fillStyle = frame.palette.bg;
    ctx.fillRect(0, 0, deviceWidth, deviceHeight);
    if (selected) {
      // Above the soil like the open note itself, a little fainter when the focus leaves it out.
      const inFocus = ((states[frame.selectedIndex] ?? 0) & NodeFlag.focus) !== 0;
      drawSelectedEdges(frame, xy, inFocus ? 1 : 1 - SELECTED_EDGE.sink * amount);
    }
    const litNote =
      frame.focusIndex >= 0 && frame.focusIndex < count && !frame.clusterFocus && frame.drawOn > 0;
    if (litNote || frame.clusterFocus) {
      drawLitEdges(frame, xy);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawLights(frame, xy, true);
    drawPass(frame, xy, PASS_RAISED);
    if (litNote && frame.drawOn < 1) {
      drawSparks(frame, xy);
    }
    ctx.globalAlpha = 1;
  }

  /** The positions or the links changed: the classes and the paths are worked out afresh. */
  function moved(): void {
    edgePaths.fill(null); // let go at once: they will not be stroked again
    edgesMoved = true;
    lastMove = performance.now();
    edgePathStale = true;
    classesStale = true;
    boundsDirty = true;
  }

  // A 2D context can be lost too (a GPU reset under an accelerated canvas); the browser restores
  // it by itself, blank, so the sprites and gradients are painted afresh afterwards.
  const onContextLost = (): void => {
    events.onLost?.();
  };
  const onContextRestored = (): void => {
    releaseLook();
    events.onRestored?.();
  };
  canvas.addEventListener('contextlost', onContextLost);
  canvas.addEventListener('contextrestored', onContextRestored);

  return {
    kind: 'canvas2d',
    get lost(): boolean {
      return destroyed;
    },
    setData: (data: FieldData) => {
      nodes = data.nodes;
      pairs = data.edges;
      count = data.nodes.count;
      incidence = buildIncidence(count, pairs);
      order = sizeOrder(data.nodes);
      moved();
    },
    setPositions: (xy: Float32Array) => {
      positions = xy;
      // Worked on by the next frame, not by every tick of the layout.
      moved();
    },
    setStates: (next: Uint8Array) => {
      states = next;
    },
    render,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      canvas.removeEventListener('contextlost', onContextLost);
      canvas.removeEventListener('contextrestored', onContextRestored);
      releaseLook();
      edgePaths.fill(null);
      nodes = null;
      positions = null;
    },
  };
}

export const createCanvas2dFieldRenderer: RendererFactory = (canvas, events) =>
  createCanvas2dRenderer(canvas, events);
