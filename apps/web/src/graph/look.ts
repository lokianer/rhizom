// The look the Canvas 2D fallback and the SVG export share with the WebGL field: how the bubbles
// grow in, how far the rest of the field sinks under a focus, how wide and how bright the lit
// links burn, how far a halo reaches, how much fainter a long link is than a short one. Written
// down once here, and read by the WebGL renderer (gl/field-renderer.ts, and gl/shaders.ts, which
// interpolates them into its GLSL) as by the other two, so the three pictures cannot drift apart.
// One deliberate exception: the WebGL field sinks a covered bubble deeper (SOIL_SINK in
// gl/shaders.ts), because it also flattens the bubble's relief, which the other two cannot; at
// this module's depth a shaded bubble would read as a muddy disc rather than as soil. The bubble
// shading near the end is the fallback's and the export's: the shader works out its own relief.
// Last, the ink of a name inside a bubble, chosen against the faces all three renderers paint.
import { clamp01, smoothstep } from './motion.js';
import { luminance, parseColor, type Palette, type Rgba } from './palette.js';
import { NodeFlag, type FieldFrame, type Ground } from './types.js';

/** A colour stop of a radial gradient, offset 0 … 1 from the centre (or focal point) to the edge. */
export interface GradientStop {
  readonly offset: number;
  readonly color: Rgba;
}

const WHITE: Rgba = [1, 1, 1, 1];

export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha];
}

// --- the entry growth ----------------------------------------------------------------------

/**
 * Entry growth: a bubble waits for its share of the stagger (by its distance from the field's
 * centre), then opens in the rest of the time, overshooting a little as easeOutBack does.
 */
export const GROWTH = { stagger: 0.5, c1: 1.70158, c3: 2.70158 } as const;

/**
 * A bubble's size factor at entry progress `grow`, `distance` being its share of the reach. The
 * Canvas 2D fallback calls it per bubble; the shaders' growthOf is written from GROWTH to the same
 * formula, which gl/shaders.test.ts checks.
 */
export function growthAt(grow: number, distance: number): number {
  if (grow >= 1) {
    return 1;
  }
  const delay = GROWTH.stagger * clamp01(distance);
  const t = clamp01((grow - delay) / (1 - GROWTH.stagger));
  const u = t - 1;
  return 1 + GROWTH.c3 * u * u * u + GROWTH.c1 * u * u;
}

// --- focus ---------------------------------------------------------------------------------

/**
 * How far everything outside the focus sinks into the ground at full focus: the share of the
 * ground colour laid over it. 1 would erase it. Paper keeps a little more than soil.
 */
export const FOCUS_SINK: Readonly<Record<Ground, number>> = { humus: 0.8, kalk: 0.7 };

/**
 * How far the quiet links fade at full focus — a step further than the bubbles, so the web
 * stops competing with the lit links while the bubbles still say where the notes are.
 */
export const QUIET_EDGE_SINK = 0.85;

// --- the open note and the lit links -------------------------------------------------------

/**
 * The open note's own links, stroked in the accent colour under the bubbles: their width in CSS
 * px, their alpha on each ground, and the share of it they lose under a focus that leaves the
 * open note out — a little, never into the soil, so the open note stays traceable.
 */
export const SELECTED_EDGE = {
  px: 1.5,
  alpha: { humus: 0.7, kalk: 0.8 },
  sink: 0.4,
} as const;

export const LIT_EDGE = {
  /** CSS px of a lit link at full strength; a crowd thins it by √crowd, never below a device px. */
  px: 2,
  /** A lit link takes the alpha of the active edge colour, but never less than this. */
  minAlpha: 0.7,
  /** How far its colour moves from the active edge colour towards the glow: warm light, not white. */
  warmth: 0.35,
  /** However many links are lit, each keeps at least this share of its strength. */
  floor: 0.22,
  /** Up to this many lit links each burns at full strength (see litCrowd). */
  crowd: 60,
} as const;

/**
 * The wide, faint band of light under the lit links: its width in CSS px and its alpha. On soil
 * only — paper does not glow — and only while the links are few enough that a crowd has thinned
 * them to no less than `minCrowd`.
 */
export const LIT_GLOW = { px: 7, alpha: 0.16, minCrowd: 0.5 } as const;

/**
 * The spark at the tip of a link that is drawing itself out: its radius in CSS px, and the least
 * share of its strength a crowd of lit links leaves it.
 */
export const SPARK = { px: 7, floor: 0.3 } as const;

/**
 * 0 … 1: how far a set of lit links is thinned out. A note's few dozen links burn at full
 * strength; a focused cluster's thousand would be a white blot, so past LIT_EDGE.crowd the light
 * thins out with the square root of their number.
 */
export function litCrowd(links: number): number {
  return links > LIT_EDGE.crowd ? Math.sqrt(LIT_EDGE.crowd / links) : 1;
}

/** The stroke of a lit link: the active edge colour warmed by the glow, at LIT_EDGE's alpha. */
export function litColor(palette: Palette): Rgba {
  const active = parseColor(palette.edgeActive);
  const warm = mixRgba(active, parseColor(palette.glow), LIT_EDGE.warmth);
  return [warm[0], warm[1], warm[2], Math.max(active[3], LIT_EDGE.minAlpha)];
}

// --- halos ---------------------------------------------------------------------------------

/**
 * The light round the hovered and the open note. On soil it is light added to the ground,
 * `peak` strong at the rim and gone `px` CSS px past it whatever the size of the bubble; on paper,
 * where light reads as a smudge, it is a thin ink ring instead (KALK_RING). The open note's halo
 * burns at `selected`; the hovered note's grows to full strength with the focus.
 */
export const HALO = { px: 16, peak: { humus: 0.5, kalk: 0.45 }, selected: 0.7 } as const;

/** The softer, shorter light of a neighbour of the hovered note once its link has arrived. */
export const GLOW = { px: 10, peak: { humus: 0.3, kalk: 0.35 } } as const;

/** On paper a halo is a ring this many CSS px past the rim, fading over about `width` px. */
export const KALK_RING = { at: 3, width: 1.5 } as const;

/** Which of the two lights: the hovered or open note's halo, or a lit neighbour's glow. */
export type LightKind = 'halo' | 'glow';

/** CSS px past the rim that a light is drawn to: beyond it there is nothing to see. */
export function lightReach(ground: Ground, kind: LightKind): number {
  if (ground === 'kalk') {
    return KALK_RING.at + KALK_RING.width * 3;
  }
  return kind === 'halo' ? HALO.px : GLOW.px;
}

/** 0 … 1: a light's strength `outside` CSS px past the rim, at full strength of the light. */
export function lightAt(ground: Ground, kind: LightKind, outside: number): number {
  if (!(outside >= 0)) {
    return 0;
  }
  const peak = (kind === 'halo' ? HALO.peak : GLOW.peak)[ground];
  if (ground === 'kalk') {
    const at = (outside - KALK_RING.at) / KALK_RING.width;
    return peak * Math.exp(-at * at);
  }
  const reach = kind === 'halo' ? HALO.px : GLOW.px;
  return peak * Math.exp(-outside / (reach * 0.28)) * (1 - smoothstep(reach * 0.6, reach, outside));
}

/** A light's colour: the glow on soil; on paper the ink of the edges for a halo, the glow for a neighbour. */
export function lightColor(palette: Palette, ground: Ground, kind: LightKind): Rgba {
  return parseColor(ground === 'kalk' && kind === 'halo' ? palette.edge : palette.glow);
}

/** Where the samples of a light are taken, as shares of its reach. */
const LIGHT_SAMPLES = [0, 0.04, 0.09, 0.15, 0.22, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

/**
 * A light as a radial gradient over a circle of radius `radius + reach`, `rim` being the share of
 * that radius the bubble covers: clear under the bubble, then the light's own falloff out to the
 * edge. The colours are opaque at the light's strength as alpha.
 */
export function lightStops(
  palette: Palette,
  ground: Ground,
  kind: LightKind,
  rim: number,
): GradientStop[] {
  const color = lightColor(palette, ground, kind);
  const reach = lightReach(ground, kind);
  const start = Math.min(Math.max(rim, 0), 0.999);
  const stops: GradientStop[] = [];
  if (start > 0.001) {
    stops.push({ offset: 0, color: [color[0], color[1], color[2], 0] });
    stops.push({ offset: start - 0.001, color: [color[0], color[1], color[2], 0] });
  }
  for (const share of LIGHT_SAMPLES) {
    stops.push({
      offset: start + (1 - start) * share,
      color: [color[0], color[1], color[2], lightAt(ground, kind, reach * share)],
    });
  }
  return stops;
}

/**
 * The spark as a radial gradient over its radius: a hot core in a softer halo, the core running
 * towards white on soil where the light is added to the ground.
 */
export function sparkStops(palette: Palette, ground: Ground): GradientStop[] {
  const glow = parseColor(palette.glow);
  return [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1].map((d) => {
    const d2 = d * d;
    const core = Math.exp(-d2 * 18);
    const halo = Math.exp(-d2 * 5) * 0.5 * Math.max(1 - d2, 0);
    const color = ground === 'humus' ? mixRgba(glow, WHITE, core * 0.6) : glow;
    // The quad of the shader ends at the radius, and so does the spark.
    const alpha = d >= 1 ? 0 : Math.min(1, core + halo);
    return { offset: d, color: [color[0], color[1], color[2], alpha] };
  });
}

/** 0 … 1: how far a lit neighbour has lit up — it answers as its link arrives. */
export function arrival(drawOn: number): number {
  return smoothstep(0, 1, (drawOn - 0.7) / 0.3);
}

/**
 * 0 … 1: the strength of the sparks while the links draw out — faded in as they leave the
 * hovered note and out as they reach the neighbour, rather than switched on and off.
 */
export function sparkFade(drawOn: number): number {
  return smoothstep(0, 1, drawOn / 0.12) * (1 - smoothstep(0, 1, (drawOn - 0.86) / 0.14));
}

/**
 * Strength of a bubble's halo: the open note's at HALO.selected, the hovered note's growing to
 * full with the focus.
 */
export function haloStrength(flags: number, frame: FieldFrame): number {
  const hovered = (flags & NodeFlag.hovered) !== 0 ? clamp01(frame.focusAmount) : 0;
  const selected = (flags & NodeFlag.selected) !== 0 ? HALO.selected : 0;
  return hovered > selected ? hovered : selected;
}

/**
 * Strength of a bubble's glow: each neighbour of the hovered note once its link has arrived.
 * A focused cluster lights none — a whole legend row of glowing bubbles would be a bonfire, not
 * a focus — and the hovered and the open note have their halo instead.
 */
export function glowStrength(flags: number, index: number, frame: FieldFrame): number {
  if (
    (flags & NodeFlag.focus) === 0 ||
    (flags & (NodeFlag.hovered | NodeFlag.selected)) !== 0 ||
    frame.clusterFocus ||
    frame.focusIndex < 0 ||
    index === frame.focusIndex
  ) {
    return 0;
  }
  return arrival(frame.drawOn) * clamp01(frame.focusAmount);
}

// --- bubbles and links ---------------------------------------------------------------------

/**
 * Device px: a bubble is never drawn smaller than this; below it, its alpha shrinks with the
 * square of its size instead, so a note far out of view fades rather than standing as a dot.
 */
export const MIN_BUBBLE_PX = 0.8;

/** Below this share of its strength a bubble that fades for its size is left out altogether. */
export const MIN_BUBBLE_FADE = 0.01;

/** 0 … 1: how strongly a bubble of this on-screen radius is drawn (see MIN_BUBBLE_PX). */
export function bubbleFade(radiusPx: number): number {
  if (radiusPx >= MIN_BUBBLE_PX) {
    return 1;
  }
  const share = Math.max(radiusPx, 0) / MIN_BUBBLE_PX;
  return share * share;
}

/**
 * Quiet-link weight by length in graph units. The layout wants links of 36–80 units; links
 * pressed shorter carry the local structure and are strengthened by `shortWeight`, links
 * stretched far across the field are the fog of a large vault and fade to `longWeight`. Each
 * weight eases in between its two reference lengths.
 */
export const EDGE_LENGTH = {
  shortWeight: 1.6,
  shortFrom: 30,
  shortTo: 48,
  longWeight: 0.5,
  longFrom: 90,
  longTo: 180,
} as const;

/** The quiet-link weight of a link this long, as the edge shader computes it. */
export function edgeLengthWeight(length: number): number {
  const e = EDGE_LENGTH;
  const short = e.shortWeight + (1 - e.shortWeight) * smoothstep(e.shortFrom, e.shortTo, length);
  const long = 1 + (e.longWeight - 1) * smoothstep(e.longFrom, e.longTo, length);
  return short * long;
}

/**
 * The quiet links in three classes — short, ordinary, long — for the renderers that stroke a
 * path per class instead of a weight per link: each class carries the full weight of its end of
 * the scale, and a link joins the short or the long class once it is past the middle of that
 * weight's easing.
 */
export const EDGE_CLASS_WEIGHTS = [EDGE_LENGTH.shortWeight, 1, EDGE_LENGTH.longWeight] as const;
export const EDGE_CLASSES = EDGE_CLASS_WEIGHTS.length;
const SHORT_BELOW = (EDGE_LENGTH.shortFrom + EDGE_LENGTH.shortTo) / 2;
const LONG_ABOVE = (EDGE_LENGTH.longFrom + EDGE_LENGTH.longTo) / 2;

/** 0 for a short link, 1 for an ordinary one, 2 for a long one (lengths in graph units). */
export function edgeClass(length: number): 0 | 1 | 2 {
  return length < SHORT_BELOW ? 0 : length > LONG_ABOVE ? 2 : 1;
}

// --- bubble shading: the fallback and the export -------------------------------------------

/**
 * How a bubble of one palette slot is shaded, in units of its radius. The fallback's sprites and
 * the SVG export's gradients are both drawn from it, so the fallback and the file agree.
 */
export interface BubbleShading {
  /** Focal point of the body gradient relative to the centre: where the light sits. */
  readonly lightX: number;
  readonly lightY: number;
  readonly body: readonly GradientStop[];
  /** A thin line just inside the rim: bounce light on soil, pigment pooling on paper. */
  readonly rim: Rgba;
  /** Rim width as a fraction of the radius, never thinner than `rimMinPx` pixels. */
  readonly rimWidth: number;
  readonly rimMinPx: number;
  /** A soft highlight up left, centred at (x, y) with radius r; null on paper. */
  readonly specular: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly alpha: number;
  } | null;
  /** A contact shadow down right, fading out from `inner` to `outer`; null on soil. */
  readonly shadow: {
    readonly x: number;
    readonly y: number;
    readonly inner: number;
    readonly outer: number;
    readonly color: Rgba;
  } | null;
}

/** On-screen radii below which the rim and the specular are finer than a pixel and left out. */
export const RIM_MIN_RADIUS_PX = 2.5;
export const SPECULAR_MIN_RADIUS_PX = 4;

/**
 * The contact shadow of pigment on chalk paper: sepia, never grey. RGB, 0 … 1; the WebGL field
 * draws its shadow in the same colour (gl/shaders.ts).
 */
export const SEPIA: readonly [number, number, number] = [0.29, 0.22, 0.14];

/** The warm light inside a spore on soil. */
const SPORE_LIGHT: Rgba = [1, 0.957, 0.878, 1];
const BLACK: Rgba = [0, 0, 0, 1];

/**
 * Humus: a matte sphere lit from the upper left that seems to glow from within, with a thin rim
 * of bounce light and a specular of about a quarter strength. Kalk: pigment on paper — a flat
 * wash that pools darker at the rim, and a soft sepia contact shadow.
 */
export function bubbleShading(palette: Palette, ground: Ground, slot: number): BubbleShading {
  return shadingOf(palette, ground, parseColor(palette.clusters[slot] ?? palette.label));
}

/** Chalk paper under the pigment: the ground lightened, as the WebGL field's uPaper is too. */
function paperOf(palette: Palette): Rgba {
  return mixRgba(parseColor(palette.bg), WHITE, 0.55);
}

function shadingOf(palette: Palette, ground: Ground, fill: Rgba): BubbleShading {
  if (ground === 'humus') {
    const shade = mixRgba(parseColor(palette.bg), BLACK, 0.4);
    return {
      lightX: -0.26,
      lightY: -0.32,
      body: [
        { offset: 0, color: mixRgba(fill, SPORE_LIGHT, 0.55) },
        { offset: 0.3, color: mixRgba(fill, SPORE_LIGHT, 0.22) },
        { offset: 0.66, color: mixRgba(fill, SPORE_LIGHT, 0.03) },
        { offset: 0.9, color: mixRgba(fill, shade, 0.28) },
        { offset: 1, color: mixRgba(fill, shade, 0.48) },
      ],
      rim: withAlpha(mixRgba(fill, SPORE_LIGHT, 0.5), 0.32),
      rimWidth: 0.05,
      rimMinPx: 0.75,
      specular: { x: -0.36, y: -0.42, r: 0.34, alpha: 0.25 },
      shadow: null,
    };
  }
  const paper = paperOf(palette);
  const ink = parseColor(palette.label);
  return {
    lightX: -0.16,
    lightY: -0.2,
    body: [
      { offset: 0, color: mixRgba(fill, paper, 0.5) },
      { offset: 0.55, color: mixRgba(fill, paper, 0.32) },
      { offset: 0.84, color: mixRgba(fill, paper, 0.12) },
      { offset: 0.95, color: mixRgba(fill, ink, 0.12) },
      { offset: 1, color: mixRgba(fill, ink, 0.22) },
    ],
    rim: withAlpha(mixRgba(fill, ink, 0.6), 0.85),
    rimWidth: 0.04,
    rimMinPx: 0.7,
    specular: null,
    shadow: {
      x: 0.06,
      y: 0.12,
      inner: 0.6,
      outer: 1.2,
      color: [SEPIA[0], SEPIA[1], SEPIA[2], 0.22],
    },
  };
}

// --- the ink of a name inside a bubble -----------------------------------------------------

/**
 * What the WebGL field paints at a bubble's centre, where a name inside it sits: humusBody and
 * kalkBody (gl/shaders.ts) worked out at the centre. On soil the body is the token mixed this far
 * towards the glow, and the inner light adds this much glow on top; on paper the wash is the token
 * mixed this far towards the paper. A change to either shader body changes these with it.
 */
const GL_FACE = { soilMix: 0.156, soilGlow: 0.125, paperMix: 0.324 } as const;

/** The colour of a gradient of opaque stops at `offset`, as canvas and SVG interpolate it. */
function colourAt(stops: readonly GradientStop[], offset: number): Rgba {
  let previous = stops[0];
  for (const stop of stops) {
    if (stop.offset >= offset) {
      if (previous === undefined || stop.offset <= previous.offset) {
        return stop.color;
      }
      const t = (offset - previous.offset) / (stop.offset - previous.offset);
      return mixRgba(previous.color, stop.color, t);
    }
    previous = stop;
  }
  return previous?.color ?? BLACK;
}

/**
 * The colours a bubble of this fill shows at its centre: what the WebGL field paints there, and
 * what the fallback and the SVG export paint. Both are lighter than the token — lit from within on
 * soil, the paper showing through on chalk — and not by the same amount.
 */
export function bubbleFaces(palette: Palette, ground: Ground, fill: Rgba): readonly [Rgba, Rgba] {
  const shading = shadingOf(palette, ground, fill);
  // The body gradient runs from the light to the rim, so the centre lies this far along it; the
  // gradient's focal circle is small enough to leave out.
  const light = Math.hypot(shading.lightX, shading.lightY);
  const fallback = colourAt(shading.body, light / (1 + light));
  if (ground === 'kalk') {
    return [mixRgba(fill, paperOf(palette), GL_FACE.paperMix), fallback];
  }
  const glow = parseColor(palette.glow);
  const body = mixRgba(fill, glow, GL_FACE.soilMix);
  const lit = (channel: 0 | 1 | 2): number =>
    Math.min(1, body[channel] + glow[channel] * GL_FACE.soilGlow);
  return [[lit(0), lit(1), lit(2), 1], fallback];
}

/** WCAG contrast ratio of two relative luminances. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Remembered per fill for one palette and ground: parsing colours is too dear for every label of
 * every frame, and a palette has eight fills.
 */
const inkMemo: { palette: Palette | null; ground: Ground; byFill: Map<string, string> } = {
  palette: null,
  ground: 'humus',
  byFill: new Map(),
};

/**
 * The ink of a name set inside a bubble of this fill: palette.inkLight or palette.inkDark,
 * whichever contrasts more with the face the bubble shows. Not with its token: every renderer
 * paints the face lighter than that, and light ink that wins on the token can fall well below
 * 4.5:1 on the face. The same label goes over the WebGL field, the fallback and an export, so the
 * ink is judged on the worse of the two faces.
 */
export function insideInk(palette: Palette, ground: Ground, fill: string): string {
  if (inkMemo.palette !== palette || inkMemo.ground !== ground) {
    inkMemo.palette = palette;
    inkMemo.ground = ground;
    inkMemo.byFill.clear();
  }
  let ink = inkMemo.byFill.get(fill);
  if (ink === undefined) {
    const faces = bubbleFaces(palette, ground, parseColor(fill)).map(luminance);
    const worst = (color: string): number => {
      const own = luminance(parseColor(color));
      return Math.min(...faces.map((face) => contrastRatio(own, face)));
    };
    ink = worst(palette.inkLight) >= worst(palette.inkDark) ? palette.inkLight : palette.inkDark;
    if (inkMemo.byFill.size >= 64) {
      inkMemo.byFill.clear();
    }
    inkMemo.byFill.set(fill, ink);
  }
  return ink;
}
