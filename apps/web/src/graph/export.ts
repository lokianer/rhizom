// Exporting the view. The SVG is written from the geometry the renderers draw — the same curve
// for a link, the same shading for a bubble, the same look numbers (look.ts) and the overlay's own
// word geometry — and the PNG is the renderer itself, drawn once into a canvas at twice the size
// with the words on top at the same scale.
import { edgeControl, quadraticPoint } from './geometry.js';
import {
  LABEL_BOLD_WEIGHT,
  LABEL_HALO_PX,
  REGION_ALPHA,
  REGION_FONT_PX,
  REGION_HALO_BLUR_PX,
  REGION_HALO_STROKE_PX,
  REGION_TRACKING_PX,
} from './label-sprites.js';
import { LABEL_LINE_HEIGHT, PLATE_DOT_R } from './labels.js';
import {
  bubbleFade,
  bubbleShading,
  EDGE_CLASS_WEIGHTS,
  EDGE_CLASSES,
  edgeClass,
  FOCUS_SINK,
  glowStrength,
  haloStrength,
  insideInk,
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
  type BubbleShading,
  type GradientStop,
  type LightKind,
} from './look.js';
import { clamp01 } from './motion.js';
// The words are set by the overlay's own geometry, so the file sets them where the screen does;
// the overlay itself and the label sprites come in through sceneToPng's parameters.
import {
  HOVER_RING_PX,
  hoverRingRadius,
  PLATE_BORDER_PX,
  PLATE_SHADOW,
  PLATE_SHADOW_BLUR_PX,
  PLATE_SHADOW_Y_PX,
  plateDotX,
  plateDotY,
  plateRadius,
  regionInk,
  reticleStart,
  SELECTION_RING_GAP_PX,
  SELECTION_RING_PX,
  selectionRingRadius,
  showsHoverRing,
  TICK_PX,
} from './overlay.js';
import { parseColor, type Palette, type Rgba } from './palette.js';
import { sizeOrder } from './topology.js';
import {
  NodeFlag,
  type FieldData,
  type FieldFrame,
  type FieldNodes,
  type FieldRenderer,
  type Ground,
  type OverlayFrame,
  type PlacedLabel,
  type RegionName,
  type RendererFactory,
} from './types.js';

/**
 * One view, as the exporters take it: the frame and the data the field renderer was given, and
 * the overlay's frame for the words — the labels and plates come from `overlay.labels`, the
 * milieu names from `overlay.regions`, the rings from `overlay.selected` and `overlay.hovered`.
 */
export interface ExportScene {
  readonly frame: FieldFrame;
  readonly data: FieldData;
  readonly positions: Float32Array;
  readonly states: Uint8Array;
  readonly overlay: OverlayFrame;
}

// --- the SVG -------------------------------------------------------------------------------

/** Graph units: how far a territory spreads past its bubble, and how softly it fades. */
const TERRITORY_PAD = 28;
const TERRITORY_BLUR = 18;
const TERRITORY_ALPHA = { humus: 0.16, kalk: 0.2 } as const;

/** Coordinates: a hundredth of a pixel is below anything a renderer shows. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Opacities, offsets and stroke widths in graph units, which shrink as the zoom grows. */
function fine(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function rgb(color: Rgba): string {
  const channel = (value: number): string => String(Math.round(value * 255));
  return `rgb(${channel(color[0])},${channel(color[1])},${channel(color[2])})`;
}

/**
 * ` fill="rgb(…)" fill-opacity="…"` from a resolved colour: plain `rgb()` with a separate
 * opacity, because not every SVG reader takes `rgba()` in an attribute.
 */
function paint(attribute: 'fill' | 'stroke', color: string | Rgba, alpha = 1): string {
  const rgba = typeof color === 'string' ? parseColor(color) : color;
  const total = rgba[3] * alpha;
  return (
    ` ${attribute}="${rgb(rgba)}"` +
    (total < 0.9995 ? ` ${attribute}-opacity="${fine(Math.max(0, total))}"` : '')
  );
}

/**
 * Escapes text for an XML attribute or element, and drops what XML 1.0 cannot carry at all —
 * control characters and lone surrogates, which a note title can contain and which would make
 * the whole file unreadable.
 */
export function escapeXml(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      continue;
    }
    out +=
      char === '&'
        ? '&amp;'
        : char === '<'
          ? '&lt;'
          : char === '>'
            ? '&gt;'
            : char === '"'
              ? '&quot;'
              : char;
  }
  return out;
}

function stops(list: readonly GradientStop[]): string {
  return list
    .map(
      (stop) =>
        `<stop offset="${fine(stop.offset)}" stop-color="${rgb(stop.color)}"` +
        (stop.color[3] < 0.9995 ? ` stop-opacity="${fine(stop.color[3])}"` : '') +
        '/>',
    )
    .join('');
}

/** The visible part of the graph plane, graph units. */
interface View {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What every part of the field needs while it is written. */
interface FieldContext {
  readonly frame: FieldFrame;
  readonly nodes: FieldNodes;
  readonly pairs: Uint32Array;
  readonly xy: Float32Array;
  readonly states: Uint8Array;
  readonly count: number;
  readonly view: View;
  /** 0 … 1: how far everything outside the focus has sunk into the ground. */
  readonly sink: number;
  readonly defs: string[];
  readonly defined: Set<string>;
  readonly shadings: Map<number, BubbleShading>;
}

function define(c: FieldContext, id: string, markup: () => string): string {
  if (!c.defined.has(id)) {
    c.defined.add(id);
    c.defs.push(markup());
  }
  return `url(#${id})`;
}

function xOf(c: FieldContext, index: number): number {
  return c.xy[index * 2] ?? Number.NaN;
}

function yOf(c: FieldContext, index: number): number {
  return c.xy[index * 2 + 1] ?? Number.NaN;
}

function flagsOf(c: FieldContext, index: number): number {
  return c.states[index] ?? 0;
}

function slotOf(c: FieldContext, index: number): number {
  const slot = c.nodes.slot[index] ?? 0;
  const slots = Math.max(1, c.frame.palette.clusters.length);
  return slot < slots ? slot : slots - 1;
}

function shadingOf(c: FieldContext, slot: number): BubbleShading {
  let shading = c.shadings.get(slot);
  if (shading === undefined) {
    shading = bubbleShading(c.frame.palette, c.frame.ground, slot);
    c.shadings.set(slot, shading);
  }
  return shading;
}

/** Bubble radius in graph units, as the renderers draw it: symbol scale, never below MIN_BUBBLE_PX. */
function radiusOf(c: FieldContext, index: number): number {
  const k = c.frame.transform.k;
  return Math.max((c.nodes.radius[index] ?? 0) * c.frame.symbolScale, MIN_BUBBLE_PX / k);
}

/** 0 … 1: how strongly a bubble is drawn for its size — below MIN_BUBBLE_PX it fades. */
function fadeOf(c: FieldContext, index: number): number {
  return bubbleFade((c.nodes.radius[index] ?? 0) * c.frame.symbolScale * c.frame.transform.k);
}

function circleVisible(view: View, x: number, y: number, r: number): boolean {
  return x + r >= view.left && x - r <= view.right && y + r >= view.top && y - r <= view.bottom;
}

function circle(x: number, y: number, r: number, extra = ''): string {
  return `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}"${extra}/>`;
}

function opacity(alpha: number): string {
  return alpha < 0.9995 ? ` opacity="${fine(Math.max(0, alpha))}"` : '';
}

/** A link as a quadratic curve, oriented to start at `from`. */
interface Curve {
  readonly x0: number;
  readonly y0: number;
  readonly cx: number;
  readonly cy: number;
  readonly x1: number;
  readonly y1: number;
}

/** The curve of link a–b as the shader draws it, or null when it cannot be seen in the view. */
function linkCurve(c: FieldContext, a: number, b: number, from: number): Curve | null {
  if (a === b || a >= c.count || b >= c.count) {
    return null;
  }
  const ax = xOf(c, a);
  const ay = yOf(c, a);
  const bx = xOf(c, b);
  const by = yOf(c, b);
  if (!Number.isFinite(ax + ay + bx + by)) {
    return null;
  }
  const [cx, cy] = edgeControl(a, ax, ay, b, bx, by);
  // The curve lies inside the triangle of its end and control points; off screen, so is it.
  const { view } = c;
  if (
    Math.max(ax, cx, bx) < view.left ||
    Math.min(ax, cx, bx) > view.right ||
    Math.max(ay, cy, by) < view.top ||
    Math.min(ay, cy, by) > view.bottom
  ) {
    return null;
  }
  return from === b
    ? { x0: bx, y0: by, cx, cy, x1: ax, y1: ay }
    : { x0: ax, y0: ay, cx, cy, x1: bx, y1: by };
}

/** Path data for the first `t` of a curve: by de Casteljau, itself a quadratic curve. */
function curvePath(curve: Curve, t: number): string {
  const { x0, y0, cx, cy, x1, y1 } = curve;
  if (t >= 1) {
    return `M${num(x0)} ${num(y0)}Q${num(cx)} ${num(cy)} ${num(x1)} ${num(y1)}`;
  }
  const [ex, ey] = quadraticPoint(x0, y0, cx, cy, x1, y1, t);
  return (
    `M${num(x0)} ${num(y0)}` +
    `Q${num(x0 + (cx - x0) * t)} ${num(y0 + (cy - y0) * t)} ${num(ex)} ${num(ey)}`
  );
}

/** Calls back with the other end of every link of `node`, self-links left out. */
function forEachLink(c: FieldContext, node: number, visit: (a: number, b: number) => void): void {
  for (let at = 0; at + 1 < c.pairs.length; at += 2) {
    const a = c.pairs[at] ?? c.count;
    const b = c.pairs[at + 1] ?? c.count;
    if ((a === node || b === node) && a !== b) {
      visit(a, b);
    }
  }
}

/**
 * The milieu layer: per cluster a group of wide circles over its notes, blurred together into
 * one soft wash. Only the notes of clusters large enough for a territory take part.
 */
function svgTerritories(c: FieldContext): string {
  const strength = clamp01(c.frame.territory);
  if (strength <= 0) {
    return '';
  }
  const bySlot = new Map<number, string>();
  const focusedSlots = new Set<number>();
  for (let index = 0; index < c.count; index += 1) {
    if ((c.nodes.territory[index] ?? 0) === 0) {
      continue;
    }
    const x = xOf(c, index);
    const y = yOf(c, index);
    if (!Number.isFinite(x + y)) {
      continue;
    }
    const slot = slotOf(c, index);
    if (c.frame.clusterFocus && (flagsOf(c, index) & NodeFlag.focus) !== 0) {
      focusedSlots.add(slot);
    }
    const r = radiusOf(c, index) + TERRITORY_PAD;
    if (circleVisible(c.view, x, y, r + TERRITORY_BLUR * 3)) {
      bySlot.set(slot, (bySlot.get(slot) ?? '') + circle(x, y, r));
    }
  }
  if (bySlot.size === 0) {
    return '';
  }
  const filter = define(
    c,
    'rz-territory',
    () =>
      '<filter id="rz-territory" x="-50%" y="-50%" width="200%" height="200%">' +
      `<feGaussianBlur stdDeviation="${num(TERRITORY_BLUR)}"/></filter>`,
  );
  const alpha = TERRITORY_ALPHA[c.frame.ground] * strength;
  return [...bySlot.keys()]
    .sort((p, q) => p - q)
    .map((slot) => {
      // A focused cluster keeps its land; everything else sinks with the rest of the field.
      const sunk = focusedSlots.has(slot) ? 1 : 1 - c.sink;
      const color = c.frame.palette.clusters[slot] ?? c.frame.palette.label;
      return (
        `<g filter="${filter}" opacity="${fine(alpha * sunk)}"${paint('fill', color)}>` +
        `${bySlot.get(slot) ?? ''}</g>`
      );
    })
    .join('');
}

/**
 * The web in the ground's edge colour, one CSS pixel wide: a path per length class, the class
 * weight folded into its opacity, so long links are fainter than short ones as on screen.
 */
function svgQuietEdges(c: FieldContext): string {
  const amount = clamp01(c.frame.focusAmount);
  const alpha = clamp01(c.frame.edgeDensity) * (1 - QUIET_EDGE_SINK * amount);
  if (alpha <= 0.002) {
    return '';
  }
  const paths = new Array<string>(EDGE_CLASSES).fill('');
  for (let at = 0; at + 1 < c.pairs.length; at += 2) {
    const a = c.pairs[at] ?? c.count;
    const curve = linkCurve(c, a, c.pairs[at + 1] ?? c.count, a);
    if (curve !== null) {
      const cls = edgeClass(Math.hypot(curve.x1 - curve.x0, curve.y1 - curve.y0));
      paths[cls] += curvePath(curve, 1);
    }
  }
  const width = fine(1 / c.frame.transform.k);
  return paths
    .map((d, cls) =>
      d === ''
        ? ''
        : `<path d="${d}" fill="none"` +
          `${paint('stroke', c.frame.palette.edge, alpha * (EDGE_CLASS_WEIGHTS[cls] ?? 1))} ` +
          `stroke-width="${width}"/>`,
    )
    .join('');
}

/** The open note's own links in the accent colour, so it stays traceable. */
function svgSelectedEdges(c: FieldContext): string {
  const selected = c.frame.selectedIndex;
  if (selected < 0 || selected >= c.count) {
    return '';
  }
  let d = '';
  forEachLink(c, selected, (a, b) => {
    const curve = linkCurve(c, a, b, selected);
    if (curve !== null) {
      d += curvePath(curve, 1);
    }
  });
  if (d === '') {
    return '';
  }
  // A focus that leaves the open note out fades its links a little, as the renderers do — not
  // into the soil, so the open note stays traceable.
  const inFocus = (flagsOf(c, selected) & NodeFlag.focus) !== 0;
  const amount = clamp01(c.frame.focusAmount);
  const alpha =
    SELECTED_EDGE.alpha[c.frame.ground] * (inFocus ? 1 : 1 - SELECTED_EDGE.sink * amount);
  return (
    `<path d="${d}" fill="none"${paint('stroke', c.frame.palette.accent, alpha)} ` +
    `stroke-width="${fine(SELECTED_EDGE.px / c.frame.transform.k)}" stroke-linecap="round"/>`
  );
}

interface LitEdges {
  readonly under: string;
  /** The sparks at the tips of links still drawing themselves out, drawn over the bubbles. */
  readonly sparks: string;
}

/**
 * The hovered note's links, drawn out from it as far as they have got, or every link inside a
 * focused cluster — thinned out as the renderers thin them when there are many (litCrowd).
 */
function svgLitEdges(c: FieldContext): LitEdges {
  const { frame } = c;
  const focus = frame.focusIndex;
  const cluster = frame.clusterFocus;
  if (
    !(frame.focusAmount > 0) ||
    (!cluster && (focus < 0 || focus >= c.count || !(frame.drawOn > 0)))
  ) {
    return { under: '', sparks: '' };
  }
  const t = cluster ? 1 : clamp01(frame.drawOn);
  const amount = clamp01(frame.focusAmount);
  const k = frame.transform.k;
  let d = '';
  let tips = '';
  let links = 0;
  const light = (a: number, b: number): void => {
    if (!Number.isFinite(xOf(c, a) + yOf(c, a) + xOf(c, b) + yOf(c, b))) {
      return;
    }
    links += 1; // counted whether or not it is in view, so the file thins as the screen does
    const curve = linkCurve(c, a, b, cluster ? a : focus);
    if (curve === null) {
      return;
    }
    d += curvePath(curve, t);
    if (t < 1) {
      const [x, y] = quadraticPoint(curve.x0, curve.y0, curve.cx, curve.cy, curve.x1, curve.y1, t);
      tips += circle(x, y, SPARK.px / k);
    }
  };
  if (cluster) {
    for (let at = 0; at + 1 < c.pairs.length; at += 2) {
      const a = c.pairs[at] ?? c.count;
      const b = c.pairs[at + 1] ?? c.count;
      const inside = (flagsOf(c, a) & flagsOf(c, b) & NodeFlag.focus) !== 0;
      if (a !== b && a < c.count && b < c.count && inside) {
        light(a, b);
      }
    }
  } else {
    forEachLink(c, focus, light);
  }
  if (d === '') {
    return { under: '', sparks: '' };
  }
  const crowd = litCrowd(links);
  let under = '';
  if (frame.ground === 'humus' && crowd > LIT_GLOW.minCrowd) {
    under +=
      `<path d="${d}" fill="none"${paint('stroke', frame.palette.glow, LIT_GLOW.alpha * crowd * amount)} ` +
      `stroke-width="${fine(LIT_GLOW.px / k)}" stroke-linecap="round"/>`;
  }
  const strength = amount * Math.max(crowd, LIT_EDGE.floor);
  const width = Math.max(1, LIT_EDGE.px * Math.sqrt(crowd)) / k;
  under +=
    `<path d="${d}" fill="none"${paint('stroke', litColor(frame.palette), strength)} ` +
    `stroke-width="${fine(width)}" stroke-linecap="round"/>`;
  let sparks = '';
  const sparkStrength = amount * sparkFade(t) * Math.max(crowd, SPARK.floor);
  if (tips !== '' && sparkStrength > 0.004) {
    const fill = define(
      c,
      'rz-spark',
      () =>
        `<radialGradient id="rz-spark">${stops(sparkStops(frame.palette, frame.ground))}</radialGradient>`,
    );
    sparks = `<g fill="${fill}"${opacity(sparkStrength)}>${tips}</g>`;
  }
  return { under, sparks };
}

/**
 * The light round a bubble: a circle out to its reach past the rim, filled with the light's
 * falloff. The reach is the same for every bubble, so the gradient depends on how much of the
 * circle the bubble covers, and bubbles that cover the same share share one.
 */
function svgLight(c: FieldContext, kind: LightKind, index: number, strength: number): string {
  const { palette, ground, transform } = c.frame;
  const r = radiusOf(c, index);
  const outer = r + lightReach(ground, kind) / transform.k;
  const rim = Math.round((r / outer) * 1000);
  const id = `rz-${kind}-${String(rim)}`;
  const fill = define(
    c,
    id,
    () =>
      `<radialGradient id="${id}">${stops(lightStops(palette, ground, kind, rim / 1000))}</radialGradient>`,
  );
  return circle(xOf(c, index), yOf(c, index), outer, ` fill="${fill}"${opacity(strength)}`);
}

/** The halos of the hovered and the open note, and the glows of the lit neighbours. */
function svgLights(c: FieldContext, members: readonly number[]): string {
  let out = '';
  for (const index of members) {
    const flags = flagsOf(c, index);
    const halo = haloStrength(flags, c.frame);
    const glow = glowStrength(flags, index, c.frame);
    if (halo <= 0 && glow <= 0) {
      continue;
    }
    const fade = fadeOf(c, index);
    if (halo > 0) {
      out += svgLight(c, 'halo', index, halo * fade);
    }
    if (glow > 0) {
      out += svgLight(c, 'glow', index, glow * fade);
    }
  }
  return out;
}

/**
 * One layer of bubbles, grouped by palette slot so each group names its gradient once: the
 * contact shadows under them on paper, each body with its rim as a ring of its own just inside
 * the edge, the speculars on soil.
 */
function svgBubblePass(c: FieldContext, members: readonly number[], alpha: number): string {
  if (members.length === 0) {
    return '';
  }
  const k = c.frame.transform.k;
  let shadows = '';
  let speculars = '';
  const bodies = new Map<number, string>();
  let shadowOf: BubbleShading['shadow'] = null;
  let specularOf: BubbleShading['specular'] = null;
  for (const index of members) {
    const fade = fadeOf(c, index);
    if (fade < MIN_BUBBLE_FADE) {
      continue; // as on screen: a bubble this far below a pixel is not drawn
    }
    const slot = slotOf(c, index);
    const shading = shadingOf(c, slot);
    const x = xOf(c, index);
    const y = yOf(c, index);
    const r = radiusOf(c, index);
    const screenR = r * k;
    const faded = opacity(fade);
    if (shading.shadow !== null) {
      shadowOf = shading.shadow;
      shadows += circle(
        x + shading.shadow.x * r,
        y + shading.shadow.y * r,
        shading.shadow.outer * r,
        faded,
      );
    }
    // The body fills the whole disc; the rim is a ring of its own over it, so no part of the
    // rim's stroke lies over the ground as a see-through band.
    let body = circle(x, y, r, faded);
    if (screenR >= RIM_MIN_RADIUS_PX) {
      const width = Math.max(shading.rimMinPx / k, shading.rimWidth * r);
      body += circle(x, y, r - width / 2, ` fill="none" stroke-width="${fine(width)}"`);
    }
    bodies.set(slot, (bodies.get(slot) ?? '') + body);
    if (shading.specular !== null && screenR >= SPECULAR_MIN_RADIUS_PX) {
      specularOf = shading.specular;
      speculars += circle(
        x + shading.specular.x * r,
        y + shading.specular.y * r,
        shading.specular.r * r,
      );
    }
  }

  let out = '';
  if (shadowOf !== null) {
    const { inner, outer, color } = shadowOf;
    const fill = define(
      c,
      'rz-shadow',
      () =>
        `<radialGradient id="rz-shadow">` +
        stops([
          { offset: inner / outer, color },
          { offset: 1, color: [color[0], color[1], color[2], 0] },
        ]) +
        '</radialGradient>',
    );
    out += `<g fill="${fill}">${shadows}</g>`;
  }
  for (const slot of [...bodies.keys()].sort((p, q) => p - q)) {
    const shading = shadingOf(c, slot);
    const id = `rz-bubble-${c.frame.ground}-${String(slot)}`;
    const fill = define(
      c,
      id,
      () =>
        `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" ` +
        `fx="${fine(0.5 + shading.lightX / 2)}" fy="${fine(0.5 + shading.lightY / 2)}" fr="0.01">` +
        `${stops(shading.body)}</radialGradient>`,
    );
    // The group's stroke is the rim's; its width of 0 keeps it off the bodies.
    out +=
      `<g fill="${fill}"${paint('stroke', shading.rim)} stroke-width="0">` +
      `${bodies.get(slot) ?? ''}</g>`;
  }
  if (specularOf !== null) {
    const { alpha: shine } = specularOf;
    const fill = define(
      c,
      'rz-specular',
      () =>
        `<radialGradient id="rz-specular">` +
        stops([
          { offset: 0, color: [1, 1, 1, shine] },
          { offset: 1, color: [1, 1, 1, 0] },
        ]) +
        '</radialGradient>',
    );
    out += `<g fill="${fill}">${speculars}</g>`;
  }
  return alpha < 0.9995 ? `<g opacity="${fine(alpha)}">${out}</g>` : out;
}

/** How far past its radius a bubble can show something: its light, at the most. */
function extentOf(c: FieldContext, index: number): number {
  return radiusOf(c, index) + lightReach(c.frame.ground, 'halo') / c.frame.transform.k;
}

/**
 * The bubbles, smallest first so the hubs lie on top. With a focus, everything outside it is
 * one faint layer — sunk into the ground — and the focus lies over it at full strength, and so
 * does the open note, which stays traceable wherever the focus is.
 */
function svgBubbles(c: FieldContext): string {
  const visible: number[] = [];
  for (const index of sizeOrder(c.nodes)) {
    if (index >= c.count) {
      continue;
    }
    const x = xOf(c, index);
    const y = yOf(c, index);
    if (Number.isFinite(x + y) && circleVisible(c.view, x, y, extentOf(c, index))) {
      visible.push(index);
    }
  }
  if (c.sink <= 0) {
    return svgLights(c, visible) + svgBubblePass(c, visible, 1);
  }
  const raised = (index: number): boolean =>
    (flagsOf(c, index) & (NodeFlag.focus | NodeFlag.selected)) !== 0;
  const above = visible.filter(raised);
  return (
    svgBubblePass(
      c,
      visible.filter((index) => !raised(index)),
      1 - c.sink,
    ) +
    svgLights(c, above) +
    svgBubblePass(c, above, 1)
  );
}

/** The field below the words, inside one view transform; empty when there is nothing to draw. */
function svgField(scene: ExportScene, defs: string[]): string {
  const { frame, data } = scene;
  const { k, x, y } = frame.transform;
  const count = Math.min(data.nodes.count, scene.positions.length >> 1);
  if (count === 0 || !(k > 0) || !(frame.width > 0) || !(frame.height > 0)) {
    return '';
  }
  const c: FieldContext = {
    frame,
    nodes: data.nodes,
    pairs: data.edges,
    xy: scene.positions,
    states: scene.states,
    count,
    view: {
      left: -x / k,
      top: -y / k,
      right: (frame.width - x) / k,
      bottom: (frame.height - y) / k,
    },
    sink: FOCUS_SINK[frame.ground] * clamp01(frame.focusAmount),
    defs,
    defined: new Set(),
    shadings: new Map(),
  };
  const lit = svgLitEdges(c);
  const layers =
    svgTerritories(c) +
    svgQuietEdges(c) +
    svgSelectedEdges(c) +
    lit.under +
    svgBubbles(c) +
    lit.sparks;
  if (layers === '') {
    return '';
  }
  // The scale keeps six decimals: rounded to two, a wide field would drift from its labels.
  const scale = String(Math.round(k * 1e6) / 1e6);
  return `<g transform="translate(${num(x)},${num(y)}) scale(${scale})">${layers}</g>`;
}

/**
 * The milieu names as the overlay sets them: semibold letter-spaced capitals in their cluster's
 * ink, over a blurred copy of themselves, thickened, in the ground colour — a soft shore of soil
 * rather than an outline — the whole name a little short of full strength.
 */
function svgRegions(overlay: OverlayFrame, defs: string[]): string {
  const { palette } = overlay;
  const shown = overlay.regions.filter((region) => region.alpha > 0 && region.text !== '');
  if (shown.length === 0) {
    return '';
  }
  // Tracking trails the last letter too; half of it moves the name back onto its centre.
  const text = (region: RegionName, fill: string): string =>
    `<text x="${num(region.x + REGION_TRACKING_PX / 2)}" y="${num(region.y)}"${fill}` +
    `${opacity(Math.min(1, region.alpha) * REGION_ALPHA)}>` +
    `${escapeXml(region.text.toUpperCase())}</text>`;
  defs.push(
    '<filter id="rz-region-halo" x="-20%" y="-60%" width="140%" height="220%">' +
      `<feGaussianBlur stdDeviation="${num(REGION_HALO_BLUR_PX / 2)}"/></filter>`,
  );
  const shores = shown.map((region) => text(region, '')).join('');
  const names = shown
    .map((region) => text(region, paint('fill', regionInk(region.color, palette.label))))
    .join('');
  return (
    `<g font-family="${escapeXml(palette.fontSans)}" font-size="${String(REGION_FONT_PX)}" ` +
    `font-weight="${String(LABEL_BOLD_WEIGHT)}" letter-spacing="${num(REGION_TRACKING_PX)}" ` +
    'text-anchor="middle" dominant-baseline="central">' +
    `<g filter="url(#rz-region-halo)"${paint('fill', palette.labelHalo)}` +
    `${paint('stroke', palette.labelHalo)} stroke-width="${num(REGION_HALO_STROKE_PX)}" ` +
    `stroke-linejoin="round">${shores}</g>${names}</g>`
  );
}

/**
 * The overlay's rings: the hover ring (left out over the open note, where the selection ring says
 * more), and the open note's ring with a gap to its bubble and four reticle ticks.
 */
function svgRings(overlay: OverlayFrame): string {
  const { hovered, selected, palette } = overlay;
  let out = '';
  if (hovered !== null && showsHoverRing(hovered, selected)) {
    out += circle(
      hovered.x,
      hovered.y,
      hoverRingRadius(hovered.r),
      ` fill="none"${paint('stroke', palette.edgeActive)} stroke-width="${String(HOVER_RING_PX)}"`,
    );
  }
  if (selected !== null) {
    const { x, y } = selected;
    const inner = reticleStart(selected.r);
    const outer = inner + TICK_PX;
    const stroke = `${paint('stroke', palette.accent)} stroke-width="${String(SELECTION_RING_PX)}"`;
    const ticks =
      `M${num(x + inner)} ${num(y)}L${num(x + outer)} ${num(y)}` +
      `M${num(x - inner)} ${num(y)}L${num(x - outer)} ${num(y)}` +
      `M${num(x)} ${num(y + inner)}L${num(x)} ${num(y + outer)}` +
      `M${num(x)} ${num(y - inner)}L${num(x)} ${num(y - outer)}`;
    // Ground in the gap between the bubble and its ring, as on screen: the open note's links end
    // at the rim, and without it their last pixels read as a torn ring.
    out += circle(
      x,
      y,
      selected.r + SELECTION_RING_GAP_PX / 2,
      ` fill="none"${paint('stroke', palette.bg)} stroke-width="${String(SELECTION_RING_GAP_PX)}"`,
    );
    out +=
      circle(x, y, selectionRingRadius(selected.r), ` fill="none"${stroke}`) +
      `<path d="${ticks}" fill="none"${stroke} stroke-linecap="round"/>`;
  }
  return out;
}

/**
 * The overlay's pill: rounded ends for one line, and the same ends on a taller plate for two; its
 * border in the edge colour, or the accent on the open note's plate; the cluster dot before the
 * name.
 */
function svgPlate(label: PlacedLabel, palette: Palette, filter: string): string {
  const { left, top, right, bottom } = label.box;
  const width = right - left;
  const height = bottom - top;
  const radius = plateRadius(label, width, height);
  const inset = PLATE_BORDER_PX / 2;
  return (
    `<g${opacity(label.alpha)}>` +
    `<rect x="${num(left)}" y="${num(top)}" width="${num(width)}" height="${num(height)}" ` +
    `rx="${num(radius)}"${paint('fill', palette.plate)} filter="${filter}"/>` +
    `<rect x="${num(left + inset)}" y="${num(top + inset)}" width="${num(width - inset * 2)}" ` +
    `height="${num(height - inset * 2)}" rx="${num(Math.max(0, radius - inset))}" fill="none"` +
    `${paint('stroke', label.selected ? palette.accent : palette.edge)} ` +
    `stroke-width="${String(PLATE_BORDER_PX)}"/>` +
    circle(plateDotX(label), plateDotY(label), PLATE_DOT_R, paint('fill', label.fill)) +
    '</g>'
  );
}

function svgLabel(label: PlacedLabel, palette: Palette, ground: Ground): string {
  const ink = label.inside ? insideInk(palette, ground, label.fill) : palette.label;
  // Inside a bubble or on a plate the glyphs need no halo; elsewhere paint-order lays it under
  // them, the look of a label sprite drawn with its halo.
  const halo =
    label.inside || label.plate
      ? ''
      : `${paint('stroke', palette.labelHalo)} stroke-width="${String(LABEL_HALO_PX)}" ` +
        'stroke-linejoin="round" paint-order="stroke"';
  const lineHeight = label.fontPx * LABEL_LINE_HEIGHT;
  const top = label.y - ((label.lines.length - 1) * lineHeight) / 2;
  const body =
    label.lines.length === 1
      ? escapeXml(label.lines[0] ?? '')
      : label.lines
          .map(
            (line, n) =>
              `<tspan x="${num(label.x)}" y="${num(top + n * lineHeight)}">${escapeXml(line)}</tspan>`,
          )
          .join('');
  return (
    `<text x="${num(label.x)}" y="${num(top)}" font-size="${num(label.fontPx)}"` +
    `${label.bold ? ` font-weight="${String(LABEL_BOLD_WEIGHT)}"` : ''}` +
    `${paint('fill', ink)}${halo}${opacity(label.alpha)}>${body}</text>`
  );
}

/**
 * The labels in the overlay's order: every plate first, then the names from the least important
 * up, so a plate forced over a name ends on top of it.
 */
function svgLabels(overlay: OverlayFrame, defs: string[]): string {
  const { palette } = overlay;
  const drawn = overlay.labels.filter((label) => label.alpha > 0 && label.lines.length > 0);
  if (drawn.length === 0) {
    return '';
  }
  const plated = drawn.filter((label) => label.plate);
  let plates = '';
  if (plated.length > 0) {
    const shadow = parseColor(PLATE_SHADOW[overlay.ground]);
    defs.push(
      '<filter id="rz-plate" x="-30%" y="-60%" width="160%" height="240%">' +
        `<feDropShadow dx="0" dy="${String(PLATE_SHADOW_Y_PX)}" ` +
        `stdDeviation="${num(PLATE_SHADOW_BLUR_PX / 2)}" flood-color="${rgb(shadow)}" ` +
        `flood-opacity="${fine(shadow[3])}"/></filter>`,
    );
    plates = plated.map((label) => svgPlate(label, palette, 'url(#rz-plate)')).join('');
  }
  const names = drawn
    .slice()
    .reverse()
    .map((label) => svgLabel(label, palette, overlay.ground))
    .join('');
  return (
    `<g font-family="${escapeXml(palette.fontSans)}" text-anchor="middle" ` +
    `dominant-baseline="central">${plates}${names}</g>`
  );
}

/**
 * The view as a standalone SVG document at the frame's size: the ground, the territories, the
 * links as the same quadratic curves the shader draws, the bubbles as radial gradients per
 * palette slot, the milieu names, the rings and the labels as text. An export is a still, so the
 * bubbles are fully grown and the links curved whatever the entry animation or the camera was
 * doing. Pure and deterministic — no DOM, the same scene gives the same bytes.
 */
export function sceneToSvg(scene: ExportScene): string {
  const { frame, overlay } = scene;
  const width = num(frame.width);
  const height = num(frame.height);
  const defs: string[] = [];
  // The overlay's order: the milieu names, the rings, the plates, the labels.
  const body =
    svgField(scene, defs) +
    svgRegions(overlay, defs) +
    svgRings(overlay) +
    svgLabels(overlay, defs);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    (defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '') +
    `<rect width="100%" height="100%"${paint('fill', frame.palette.bg)}/>` +
    body +
    '</svg>'
  );
}

// --- the PNG -------------------------------------------------------------------------------

/**
 * How much larger than the screen an exported PNG is drawn. Two, because the export is made to
 * be looked at away from the app — printed, or put in a document — and a field of labelled
 * bubbles at screen resolution is a field of unreadable labels.
 */
export const PNG_SCALE = 2;

export interface PngFactories {
  /** The WebGL renderer, tried first. */
  readonly gl?: RendererFactory | undefined;
  /** The fallback where WebGL gives no context. */
  readonly canvas2d: RendererFactory;
  /** Makes the temporary canvases; defaults to `document.createElement('canvas')`. */
  readonly createCanvas?: (() => HTMLCanvasElement) | undefined;
}

export interface PngWords<Sprites> {
  /** Draws the words over the field — the very function that draws them on screen. */
  readonly overlay: (ctx: CanvasRenderingContext2D, frame: OverlayFrame, sprites: Sprites) => void;
  /** The label glyph cache the overlay draws from. */
  readonly sprites: Sprites;
}

function sized(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Hands the pixels of a temporary canvas back at once rather than whenever it is collected. */
function shrink(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function release(renderer: FieldRenderer, canvas: HTMLCanvasElement): void {
  renderer.destroy();
  if (renderer.kind === 'webgl2') {
    // A context outlives its canvas until the collector finds it, and browsers keep only a few
    // alive (Chrome sixteen) before they drop the oldest — which could be the live field's.
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  shrink(canvas);
}

interface ExportRenderer {
  readonly renderer: FieldRenderer;
  readonly canvas: HTMLCanvasElement;
}

/**
 * The WebGL renderer where it starts, else the 2D one — on a fresh canvas, because a canvas
 * that once handed out a WebGL context never hands out a 2D one.
 */
function createExportRenderer(
  factories: PngFactories,
  make: () => HTMLCanvasElement,
  width: number,
  height: number,
): ExportRenderer | null {
  if (factories.gl !== undefined) {
    const canvas = sized(make(), width, height);
    const renderer = factories.gl(canvas);
    if (renderer !== null) {
      return { renderer, canvas };
    }
    shrink(canvas);
  }
  const canvas = sized(make(), width, height);
  const renderer = factories.canvas2d(canvas);
  if (renderer !== null) {
    return { renderer, canvas };
  }
  shrink(canvas);
  return null;
}

/**
 * Shrinks the field's canvas, where the WebGL context would draw it smaller, until it draws it
 * whole, and says by how much: 1 where nothing changed. Past the GPU's limits the browser makes the
 * drawing buffer smaller than the canvas and clamps each axis on its own, so a wide export would
 * come out squashed and off its words — a stretch no single pixel ratio can undo. A canvas of the
 * buffer's proportions gets a buffer of its own size; the field is drawn into it at the reduced
 * ratio and stretched back evenly over the words, which stay at the full scale.
 */
function fitDrawingBuffer(made: ExportRenderer, width: number, height: number): number {
  if (made.renderer.kind !== 'webgl2') {
    return 1;
  }
  const gl = made.canvas.getContext('webgl2');
  if (gl === null) {
    return 1;
  }
  const fit = Math.min(1, gl.drawingBufferWidth / width, gl.drawingBufferHeight / height);
  if (fit < 1) {
    sized(made.canvas, Math.max(1, Math.floor(width * fit)), Math.max(1, Math.floor(height * fit)));
  }
  return fit;
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('The browser produced no PNG'));
      }
    }, 'image/png');
  });
}

/**
 * The view as a PNG at `scale`× the on-screen size: the field renderer drawn once into a canvas
 * of that size (or as near as the GPU can draw it, see fitDrawingBuffer), copied into a 2D canvas,
 * the words drawn over it at the same scale. The temporary renderer is destroyed as soon as its
 * picture is copied.
 */
export async function sceneToPng<Sprites>(
  scene: ExportScene,
  factories: PngFactories,
  draw: PngWords<Sprites>,
  scale: number = PNG_SCALE,
): Promise<Blob> {
  const make =
    factories.createCanvas ?? ((): HTMLCanvasElement => document.createElement('canvas'));
  const width = Math.max(1, Math.round(scene.frame.width * scale));
  const height = Math.max(1, Math.round(scene.frame.height * scale));
  const made = createExportRenderer(factories, make, width, height);
  if (made === null) {
    throw new Error('The browser gave no canvas context to draw the field with');
  }
  const { renderer, canvas: fieldCanvas } = made;
  let live = true;
  const releaseField = (): void => {
    if (live) {
      live = false;
      release(renderer, fieldCanvas);
    }
  };

  const output = sized(make(), width, height);
  const words = sized(make(), width, height);
  try {
    const ctx = output.getContext('2d', { alpha: false });
    if (ctx === null) {
      throw new Error('The browser gave no 2D canvas context');
    }
    const fit = fitDrawingBuffer(made, width, height);
    renderer.setData(scene.data);
    renderer.setPositions(scene.positions);
    renderer.setStates(scene.states);
    // A still: fully grown, and curved links, whatever the entry or the camera was doing.
    renderer.render({ ...scene.frame, pixelRatio: scale * fit, grow: 1, moving: false });
    // Copied in the same task as the draw, while the WebGL drawing buffer still holds it.
    ctx.drawImage(fieldCanvas, 0, 0, width, height);
    releaseField();

    // The overlay is written for a transparent layer of its own and may clear it first, so it
    // gets one here too, and that layer is laid over the field.
    const wordsCtx = words.getContext('2d');
    if (wordsCtx !== null) {
      draw.overlay(wordsCtx, { ...scene.overlay, pixelRatio: scale }, draw.sprites);
      ctx.drawImage(words, 0, 0);
    }
    return await toPng(output);
  } finally {
    releaseField();
    shrink(words);
    shrink(output);
  }
}

/**
 * How long the object URL of a download is kept. Revoked at once, a browser that starts the
 * download a moment after the click — Firefox, and Safari with a large file — finds nothing
 * behind it; a blob of an export is small enough to keep for this long.
 */
export const DOWNLOAD_URL_LIFETIME_MS = 30_000;

/** Hands a blob to the browser's downloader; the caller picks the file name. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, DOWNLOAD_URL_LIFETIME_MS);
}
