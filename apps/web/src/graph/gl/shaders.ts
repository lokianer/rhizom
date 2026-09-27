// The GLSL of the bubble field, and the few numbers the shaders and the renderer must agree on.
// Every tunable that JavaScript also needs is written once and interpolated into the sources:
// the look the Canvas 2D fallback and the SVG export share (growth, halos, sinking, link weights,
// the sepia shadow) comes from look.ts, the GL-only numbers are written here. The two that must
// match modules outside the GL code as literals (the curve's bend and the node flags) are checked
// by the tests.
import { EDGE_BEND } from '../geometry.js';
import {
  EDGE_LENGTH,
  GLOW,
  GROWTH,
  HALO,
  KALK_RING,
  MIN_BUBBLE_FADE,
  MIN_BUBBLE_PX,
  QUIET_EDGE_SINK,
  SELECTED_EDGE,
  SEPIA,
} from '../look.js';
import { smoothstep } from '../motion.js';

// shaders.test.ts compares the shared weights with the ones the edge shader is built from.
export { EDGE_LENGTH, edgeLengthWeight } from '../look.js';

/** Texture width limit: WebGL2 guarantees 2048, and a row per 2,048 notes costs nothing. */
export const NODE_TEXTURE_MAX_WIDTH = 2048;

/**
 * Curve segments of a link at rest (see curveSegments): enough that a link `longShare` times the
 * typical length strays no more than its layer's `tolerance` CSS px from its true curve, within
 * min … max. While the camera moves a link is one straight segment.
 */
export const CURVE_SEGMENTS = {
  min: 8,
  max: 32,
  longShare: 3,
  tolerance: { lit: 0.3, quiet: 1.2 },
} as const;

/**
 * Texture units, fixed for the life of a context so no draw ever rebinds a texture. The splats
 * sum into two textures, the densities of palette slots 0–3 and of 4–7, one channel each. A
 * resolve turns them into a wash and the distances to each slot's shore (again 0–3 and 4–7),
 * once for the whole field and once for a focused cluster; the ground composites those.
 */
export const TEXTURE_UNITS = {
  uPositions: 0,
  uAttributes: 1,
  uStates: 2,
  uSplatLow: 3,
  uSplatHigh: 4,
  uWash: 5,
  uShoreLow: 6,
  uShoreHigh: 7,
  uFocusWash: 8,
  uFocusShoreLow: 9,
  uFocusShoreHigh: 10,
  uTooth: 11,
} as const;

/** Which bubbles a bubble draw covers: the soil-covered ones go down before the lit links. */
export const BubblePass = { all: 0, sunk: 1, raised: 2, emphasis: 3 } as const;

/** Which layer an edge draw paints. */
export const EdgeMode = { quiet: 0, selected: 1, lit: 2 } as const;

/** Draw-on of lit links: the shortest arrive at this share of the animation, the longest at 1. */
export const DRAW_ON = { earliest: 0.6, shortLength: 40, longLength: 400 } as const;

/**
 * Territory splats: a gaussian per bubble, its sigma growing with the bubble, summed per palette
 * slot. A milieu's wash eases in between the densities `washFrom` and `washTo` of its own notes,
 * and its shore runs where that density crosses `shore`.
 */
export const SPLAT = {
  radiusFactor: 1.1,
  base: 16,
  reach: 3,
  washFrom: 0.12,
  washTo: 1.1,
  shore: 0.3,
} as const;

/** Long side of the territory texture, in texels. */
export const TERRITORY_TEXELS = 256;

/**
 * A shore texture holds, per palette slot, the signed distance to that slot's shore in texels,
 * clamped to ± SHORE_RANGE / 2 and stored as distance / SHORE_RANGE + 0.5.
 */
export const SHORE_RANGE = 4;

/** A GLSL float literal: `1` would be an int there, and an int in a float expression won't compile. */
function glslFloat(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

/** Checked against geometry.ts EDGE_BEND by the tests: the shader and the SVG draw one curve. */
export const GLSL_EDGE_BEND = 'const float EDGE_BEND = 0.1;';

/** Checked against types.ts NodeFlag by the tests. */
export const GLSL_NODE_FLAGS = [
  'const uint FLAG_FOCUS = 1u;',
  'const uint FLAG_HOVERED = 2u;',
  'const uint FLAG_SELECTED = 4u;',
  'const uint FLAG_SELECTED_NEIGHBOUR = 8u;',
].join('\n');

const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

const NODES = `
${GLSL_NODE_FLAGS}
uniform highp sampler2D uPositions;
uniform highp sampler2D uAttributes;
uniform highp usampler2D uStates;
uniform int uTexWidth;

ivec2 texelOf(uint i) {
  int n = int(i);
  return ivec2(n % uTexWidth, n / uTexWidth);
}
vec2 nodePosition(uint i) { return texelFetch(uPositions, texelOf(i), 0).xy; }
// radius (graph units), palette slot, degree, territory flag
vec4 nodeAttributes(uint i) { return texelFetch(uAttributes, texelOf(i), 0); }
uint nodeState(uint i) { return texelFetch(uStates, texelOf(i), 0).r; }
`;

const SHAPES = `
const vec4 NOWHERE = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: the primitive vanishes
// Corner of a quad drawn as a four-vertex triangle strip, from -1 to 1 on both axes.
vec2 cornerOf(int vertex) { return vec2(float(vertex & 1), float(vertex >> 1)) * 2.0 - 1.0; }
`;

const VIEW = `
${SHAPES}
uniform vec3 uView; // graph units to device px: k * ratio, x * ratio, y * ratio
uniform vec2 uSize; // the drawing buffer, device px
vec2 toDevice(vec2 g) { return g * uView.x + uView.yz; }
vec4 toClip(vec2 d) { return vec4(d.x / uSize.x * 2.0 - 1.0, 1.0 - d.y / uSize.y * 2.0, 0.0, 1.0); }
`;

// The entry growth: look.ts growthAt, in GLSL.
const GROW = `
uniform float uGrow;
uniform vec3 uField; // centre of the field and its reach, graph units
float growthOf(vec2 p) {
  if (uGrow >= 1.0) return 1.0;
  float delay = ${glslFloat(GROWTH.stagger)} * clamp(length(p - uField.xy) / max(uField.z, 1.0), 0.0, 1.0);
  float t = clamp((uGrow - delay) / ${glslFloat(1 - GROWTH.stagger)}, 0.0, 1.0);
  float u = t - 1.0;
  return 1.0 + ${glslFloat(GROWTH.c3)} * u * u * u + ${glslFloat(GROWTH.c1)} * u * u;
}
`;

const DRAW = `
uniform float uDrawOn;
float arrivalOf(float len) {
  return mix(${glslFloat(DRAW_ON.earliest)}, 1.0, smoothstep(${glslFloat(DRAW_ON.shortLength)}, ${glslFloat(DRAW_ON.longLength)}, len));
}
float drawnOf(float len) { return clamp(uDrawOn / arrivalOf(len), 0.0, 1.0); }
`;

const CURVE = `
${GLSL_EDGE_BEND}
// geometry.ts edgeControl: the same side of the line from the lower index to the higher one.
vec2 edgeControl(uint a, vec2 pa, uint b, vec2 pb) {
  float flip = a > b ? -1.0 : 1.0;
  vec2 d = pb - pa;
  return (pa + pb) * 0.5 + vec2(-d.y, d.x) * (EDGE_BEND * flip);
}
uniform int uSegments;
vec2 curvePoint(vec2 a, vec2 c, vec2 b, float t) {
  if (uSegments == 1) return mix(a, b, t);
  float u = 1.0 - t;
  return u * u * a + 2.0 * u * t * c + t * t * b;
}
vec2 curveTangent(vec2 a, vec2 c, vec2 b, float t) {
  if (uSegments == 1) return b - a;
  return (1.0 - t) * (c - a) + t * (b - c);
}
uniform float uRadiusScale;
// The part of a link outside both bubbles as curve parameters, ending a pixel inside each rim.
// Arc length and t differ by a few per cent on a curve this gentle, which no one can see.
vec2 rimsOf(uint ia, float growA, uint ib, float growB, float lenDevice) {
  float scale = uView.x * uRadiusScale;
  float ra = nodeAttributes(ia).x * scale * max(growA, 0.0);
  float rb = nodeAttributes(ib).x * scale * max(growB, 0.0);
  float inv = 1.0 / max(lenDevice, 0.001);
  float from = clamp((ra - 1.0) * inv, 0.0, 0.5);
  return vec2(from, clamp(1.0 - (rb - 1.0) * inv, from, 1.0));
}
`;

const HASH = `
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

// Soil or paper at a point of the screen (CSS px): a fine grain of about a CSS pixel, and the
// coarser tooth the caller passes in (-0.5 … 0.5), both in screen space so the ground stays put
// while the field moves over it. The ground pass draws both; a sunk bubble takes on the fine
// grain as the ground closes over it.
const GRAIN = `
${HASH}
vec3 groundAt(vec3 bg, vec3 tint, bool paper, vec2 css, float coarse) {
  float fine = hash(floor(css)) - 0.5;
  return paper ? bg * (1.0 + fine * 0.022 + coarse * 0.02) : bg + tint * (fine * 0.018 + coarse * 0.014);
}
`;

/**
 * The tooth: value noise on a lattice TOOTH.cell CSS px wide, read from a texture of random
 * bytes, one lattice point per texel, repeating every TOOTH.texels cells — one bilinear lookup
 * where the same noise from hashes costs four of them and a smooth blend on every pixel.
 */
export const TOOTH = { texels: 256, cell: 1 / 0.18 } as const;

// --- ground and territories -----------------------------------------------------------------

/** One triangle over the whole target: (-1, -1), (3, -1), (-1, 3). */
export const SCREEN_VERTEX = `${HEADER}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const GROUND_FRAGMENT = `${HEADER}
uniform vec3 uView;
uniform vec2 uSize;
uniform float uPixelRatio;
uniform int uGround;
uniform vec3 uBg;
uniform vec3 uGrainTint;
uniform highp sampler2D uTooth; // random bytes, one per lattice point of the tooth, repeating
uniform highp sampler2D uWash;      // premultiplied: the milieus' tint times their wash, the wash
uniform highp sampler2D uShoreLow;  // encoded distance to the shore of slots 0–3, one per channel
uniform highp sampler2D uShoreHigh; // … and of slots 4–7
uniform highp sampler2D uFocusWash;
uniform highp sampler2D uFocusShoreLow;
uniform highp sampler2D uFocusShoreHigh;
uniform bool uHighSlots; // false: no territory uses slots 4–7, so their shores are not read
uniform vec4 uTerritoryBox;   // graph min x, min y, 1 / width, 1 / height
uniform vec2 uTerritoryScale; // share of the texture the field occupies
uniform float uTerritoryAlpha;
uniform float uTerritoryFocusMix;
uniform float uShoreScale; // encoded shore distance to the line's reach, 1.1 device px
uniform vec3 uCluster[8];
uniform vec3 uShoreInk;
out vec4 fragColor;
${GRAIN}
// Per slot: its shore line, a device pixel wide at any zoom, fading out linearly by 1.1 px from
// where its distance reaches zero.
vec4 linesOf(vec4 encoded) {
  return max(1.0 - abs(encoded - 0.5) * uShoreScale, 0.0);
}
// A resolved territory over the ground: the wash, then each milieu's own shore in its colour.
vec3 territoryOver(vec3 colour, highp sampler2D wash, highp sampler2D low, highp sampler2D high,
    vec2 uv) {
  vec4 w = texture(wash, uv);
  colour = colour * (1.0 - w.a * uTerritoryAlpha) + w.rgb * uTerritoryAlpha;
  vec4 lowLines = linesOf(texture(low, uv));
  vec4 highLines = vec4(0.0);
  if (uHighSlots) {
    highLines = linesOf(texture(high, uv));
  }
  vec4 m = max(lowLines, highLines);
  float line = max(max(m.x, m.y), max(m.z, m.w));
  if (line <= 0.0) {
    return colour;
  }
  vec3 tint = uCluster[0] * lowLines.x + uCluster[1] * lowLines.y + uCluster[2] * lowLines.z +
    uCluster[3] * lowLines.w + uCluster[4] * highLines.x + uCluster[5] * highLines.y +
    uCluster[6] * highLines.z + uCluster[7] * highLines.w;
  tint /= dot(lowLines + highLines, vec4(1.0));
  return mix(colour, mix(tint, uShoreInk, 0.35), line * uTerritoryAlpha * 0.9);
}
void main() {
  vec2 device = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec2 css = gl_FragCoord.xy / uPixelRatio;
  float tooth = texture(uTooth, css / ${glslFloat(TOOTH.cell * TOOTH.texels)}).r - 0.5;
  vec3 colour = groundAt(uBg, uGrainTint, uGround != 0, css, tooth);
  if (uTerritoryAlpha > 0.0) {
    vec2 g = (device - uView.yz) / uView.x;
    vec2 uv = clamp((g - uTerritoryBox.xy) * uTerritoryBox.zw, 0.0, 1.0) * uTerritoryScale;
    vec3 field = territoryOver(colour, uWash, uShoreLow, uShoreHigh, uv);
    if (uTerritoryFocusMix > 0.0) {
      vec3 focused = territoryOver(colour, uFocusWash, uFocusShoreLow, uFocusShoreHigh, uv);
      field = mix(field, focused, uTerritoryFocusMix);
    }
    colour = field;
  }
  // No dither of its own: the grain already moves every pixel by more than a step of the output.
  fragColor = vec4(colour, 1.0);
}
`;

export const SPLAT_VERTEX = `${HEADER}
${NODES}
${SHAPES}
layout(location = 0) in uint aNode;
uniform vec4 uBox; // graph min x, min y, 1 / width, 1 / height
uniform bool uFocusOnly;
out vec2 vLocal;
// 1 in the channel of the note's palette slot: slots 0–3 in low, 4–7 in high.
flat out vec4 vLow;
flat out vec4 vHigh;
void main() {
  vec4 attributes = nodeAttributes(aNode);
  vec2 p = nodePosition(aNode);
  bool skip = attributes.w < 0.5 || any(isnan(p)) ||
    (uFocusOnly && (nodeState(aNode) & FLAG_FOCUS) == 0u);
  if (skip) {
    gl_Position = NOWHERE;
    return;
  }
  float sigma = attributes.x * ${glslFloat(SPLAT.radiusFactor)} + ${glslFloat(SPLAT.base)};
  vec2 corner = cornerOf(gl_VertexID);
  vLocal = corner * ${glslFloat(SPLAT.reach)};
  ivec4 slot = ivec4(int(attributes.y) & 7);
  vLow = vec4(equal(slot, ivec4(0, 1, 2, 3)));
  vHigh = vec4(equal(slot, ivec4(4, 5, 6, 7)));
  vec2 uv = (p + vLocal * sigma - uBox.xy) * uBox.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Two colour attachments, summed by additive blending: a density per palette slot, so each
// milieu keeps a wash and a shore of its own where it meets another. Where no territory uses
// slots 4–7 the second attachment is switched off and its output goes nowhere.
export const SPLAT_FRAGMENT = `${HEADER}
in vec2 vLocal;
flat in vec4 vLow;
flat in vec4 vHigh;
uniform float uWeight;
layout(location = 0) out vec4 lowSlots;
layout(location = 1) out vec4 highSlots;
void main() {
  float w = exp(-0.5 * dot(vLocal, vLocal)) * uWeight;
  lowSlots = vLow * w;
  highSlots = vHigh * w;
}
`;

// Once per splat, texel by texel over the whole territory texture: each milieu's wash over the
// density of its own notes, where two overlap their colours mixed by strength and the stronger
// wash setting how much of it there is; and for each milieu the signed distance, in texels, to
// its own shore, where its density crosses the level. The ground then composites a few bytes a
// pixel instead of working through eight densities, and each milieu keeps a shore of its own.
export const RESOLVE_FRAGMENT = `${HEADER}
uniform highp sampler2D uSplatLow;
uniform highp sampler2D uSplatHigh;
uniform bool uHighSlots; // false: no territory uses slots 4–7, so that texture is not read
uniform float uGain;
uniform vec3 uCluster[8];
layout(location = 0) out vec4 washOut;
layout(location = 1) out vec4 shoreLowOut;
layout(location = 2) out vec4 shoreHighOut;
vec4 washOf(vec4 density) {
  return smoothstep(vec4(${glslFloat(SPLAT.washFrom)}), vec4(${glslFloat(SPLAT.washTo)}), density);
}
vec4 splatAt(highp sampler2D splats, ivec2 texel) {
  return texelFetch(splats, clamp(texel, ivec2(0), ivec2(${String(TERRITORY_TEXELS - 1)})), 0) * uGain;
}
// Per slot: how many texels from its shore, by the central difference of its density across the
// neighbouring texels — continuous from texel to texel, so the shore does not step where a 2 × 2
// block of derivatives would. Where a density is flat the distance is huge: no shore here.
vec4 shoreDistances(highp sampler2D splats, ivec2 texel, vec4 density) {
  vec4 dx = splatAt(splats, texel + ivec2(1, 0)) - splatAt(splats, texel - ivec2(1, 0));
  vec4 dy = splatAt(splats, texel + ivec2(0, 1)) - splatAt(splats, texel - ivec2(0, 1));
  vec4 slope = 0.5 * sqrt(dx * dx + dy * dy);
  return (density - ${glslFloat(SPLAT.shore)}) / max(slope, vec4(0.00001));
}
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 low = splatAt(uSplatLow, texel);
  vec4 lowDistance = shoreDistances(uSplatLow, texel, low);
  vec4 high = vec4(0.0);
  vec4 highDistance = vec4(-1.0e6);
  if (uHighSlots) {
    high = splatAt(uSplatHigh, texel);
    highDistance = shoreDistances(uSplatHigh, texel, high);
  }

  vec4 washLow = washOf(low);
  vec4 washHigh = washOf(high);
  vec4 m = max(washLow, washHigh);
  float wash = max(max(m.x, m.y), max(m.z, m.w));
  vec3 tint = uCluster[0] * washLow.x + uCluster[1] * washLow.y + uCluster[2] * washLow.z +
    uCluster[3] * washLow.w + uCluster[4] * washHigh.x + uCluster[5] * washHigh.y +
    uCluster[6] * washHigh.z + uCluster[7] * washHigh.w;
  tint /= max(dot(washLow + washHigh, vec4(1.0)), 0.0001);
  washOut = vec4(tint * wash, wash);

  shoreLowOut = clamp(lowDistance / ${glslFloat(SHORE_RANGE)} + 0.5, 0.0, 1.0);
  shoreHighOut = clamp(highDistance / ${glslFloat(SHORE_RANGE)} + 0.5, 0.0, 1.0);
}
`;

// --- edges ----------------------------------------------------------------------------------

// A stroke of width w covers a pixel whose centre lies d from its middle by w/2 + 0.5 - d. The
// quad stops 0.18 px short of where that reaches zero: under a fifth of a pixel's coverage at
// a quiet link's alpha is invisible, and a hairline quad a fifth narrower is a fifth fewer
// fragments on 17,000 links.
const EDGE_HALF_WIDTH = `
float halfWidthOf(float width, bool glow) { return width * 0.5 + (glow ? 0.5 : 0.32); }
`;

export const EDGE_VERTEX = `${HEADER}
${NODES}
${VIEW}
${GROW}
${DRAW}
${CURVE}
${EDGE_HALF_WIDTH}
layout(location = 0) in uvec2 aEdge; // the lit and the selected layers put the origin first
uniform int uMode;
uniform float uWidth; // device px
uniform bool uGlow;
uniform float uAlpha;
uniform float uFocusAmount;
uniform int uFocusIndex;
uniform bool uClusterFocus;
out float vAcross;
out float vAlpha;
void main() {
  uint ia = aEdge.x;
  uint ib = aEdge.y;
  vec2 ga = nodePosition(ia);
  vec2 gb = nodePosition(ib);
  vec2 a = toDevice(ga);
  vec2 b = toDevice(gb);
  float lenDevice = length(b - a);
  if (any(isnan(ga)) || any(isnan(gb)) || lenDevice < 0.5) {
    gl_Position = NOWHERE;
    return;
  }
  float growA = growthOf(ga);
  float growB = growthOf(gb);
  float alpha = uAlpha * smoothstep(0.0, 1.0, min(growA, growB));
  float lenGraph = length(gb - ga);
  // Without a focus nothing is lit, and a software rasteriser saves two fetches per vertex.
  bool lit = uFocusAmount > 0.0 && (int(ia) == uFocusIndex || int(ib) == uFocusIndex ||
    (uClusterFocus && (nodeState(ia) & nodeState(ib) & FLAG_FOCUS) != 0u));
  vec2 span = vec2(0.0, 1.0);
  if (uMode == ${String(EdgeMode.quiet)}) {
    float weight = mix(${glslFloat(EDGE_LENGTH.shortWeight)}, 1.0, smoothstep(${glslFloat(EDGE_LENGTH.shortFrom)}, ${glslFloat(EDGE_LENGTH.shortTo)}, lenGraph)) *
      mix(1.0, ${glslFloat(EDGE_LENGTH.longWeight)}, smoothstep(${glslFloat(EDGE_LENGTH.longFrom)}, ${glslFloat(EDGE_LENGTH.longTo)}, lenGraph));
    alpha *= weight * (lit ? 1.0 : 1.0 - ${glslFloat(QUIET_EDGE_SINK)} * uFocusAmount);
  } else {
    vec2 rims = rimsOf(ia, growA, ib, growB, lenDevice);
    if (uMode == ${String(EdgeMode.lit)}) {
      // From the origin's rim to the tip that travels out to the other rim. Not from its
      // centre: a small spore on soil is translucent, and a white line would show through it.
      span = vec2(rims.x, mix(rims.x, rims.y, drawnOf(lenGraph)));
      alpha *= uFocusAmount;
    } else {
      span = rims;
      alpha *= lit ? 1.0 : 1.0 - ${glslFloat(SELECTED_EDGE.sink)} * uFocusAmount;
    }
  }
  if (alpha < 0.002 || span.y <= span.x) {
    gl_Position = NOWHERE;
    return;
  }
  vec2 c = uSegments == 1 ? a : toDevice(edgeControl(ia, ga, ib, gb));
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float t = mix(span.x, span.y, float(gl_VertexID >> 1) / float(uSegments));
  vec2 tangent = curveTangent(a, c, b, t);
  vec2 normal = normalize(vec2(-tangent.y, tangent.x));
  vAcross = side * halfWidthOf(uWidth, uGlow);
  vAlpha = alpha;
  gl_Position = toClip(curvePoint(a, c, b, t) + normal * vAcross);
}
`;

export const EDGE_FRAGMENT = `${HEADER}
${EDGE_HALF_WIDTH}
in float vAcross;
in float vAlpha;
uniform vec3 uColor;
uniform float uWidth;
uniform bool uGlow; // a soft band of light, added rather than laid over
out vec4 fragColor;
void main() {
  float d = abs(vAcross);
  float cover = uGlow
    ? pow(max(1.0 - d / halfWidthOf(uWidth, true), 0.0), 2.0)
    : clamp(uWidth * 0.5 + 0.5 - d, 0.0, 1.0);
  float a = vAlpha * cover;
  fragColor = vec4(uColor * a, uGlow ? 0.0 : a);
}
`;

// --- the spark at the tip of a lit link -----------------------------------------------------

export const SPARK_VERTEX = `${HEADER}
${NODES}
${VIEW}
${GROW}
${DRAW}
${CURVE}
layout(location = 0) in uvec2 aEdge;
uniform float uFocusAmount;
uniform float uSparkRadius; // device px
uniform float uSparkAlpha;
out vec2 vLocal;
flat out float vFade;
void main() {
  uint ia = aEdge.x;
  uint ib = aEdge.y;
  vec2 ga = nodePosition(ia);
  vec2 gb = nodePosition(ib);
  vec2 a = toDevice(ga);
  vec2 b = toDevice(gb);
  float lenDevice = length(b - a);
  float growA = growthOf(ga);
  float growB = growthOf(gb);
  float drawn = drawnOf(length(gb - ga));
  float fade = smoothstep(0.0, 0.12, drawn) * (1.0 - smoothstep(0.86, 1.0, drawn)) * uFocusAmount * uSparkAlpha *
    smoothstep(0.0, 1.0, min(growA, growB));
  if (any(isnan(ga)) || any(isnan(gb)) || lenDevice < 0.5 || fade < 0.004) {
    gl_Position = NOWHERE;
    return;
  }
  vec2 rims = rimsOf(ia, growA, ib, growB, lenDevice);
  vec2 tip = curvePoint(a, toDevice(edgeControl(ia, ga, ib, gb)), b, mix(rims.x, rims.y, drawn));
  vec2 corner = cornerOf(gl_VertexID);
  vLocal = corner;
  vFade = fade;
  gl_Position = toClip(tip + corner * uSparkRadius);
}
`;

export const SPARK_FRAGMENT = `${HEADER}
in vec2 vLocal;
flat in float vFade;
uniform vec3 uColor;
uniform bool uAdditive;
out vec4 fragColor;
void main() {
  float d2 = dot(vLocal, vLocal);
  float core = exp(-d2 * 18.0);
  float halo = exp(-d2 * 5.0) * 0.5 * max(1.0 - d2, 0.0);
  float a = (core + halo) * vFade;
  vec3 colour = uAdditive ? mix(uColor, vec3(1.0), core * 0.6) : uColor;
  fragColor = vec4(colour * a, uAdditive ? 0.0 : a);
}
`;

// --- bubbles --------------------------------------------------------------------------------

/**
 * How far everything outside a focus sinks into the ground at full focus, on soil and on paper:
 * the share of the ground laid over it. Deeper than look.ts FOCUS_SINK (0.8 and 0.7), which the
 * Canvas 2D fallback and the SVG draw with: at that depth a covered sphere on soil still reads as
 * a dark disc of mud, and paper keeps too much pigment next to it.
 */
export const SOIL_SINK = { humus: 0.9, kalk: 0.8 } as const;

/**
 * How the soil closes over a sunk bubble, by the share of it that has sunk: its relief (light,
 * rim, specular) flattens out `relief` times faster than its colour, its dark contact ring goes
 * with the relief, and its rim keeps `edge` more of its colour than its face — a faint flat
 * imprint in the ground that still tells one bubble from the next, rather than a dim sphere.
 */
const SOIL = { relief: 2.2, edge: 0.1 } as const;

/**
 * Kalk: the pigment pools in a band inside the rim, a share of the radius on a small bubble but
 * never wider than this many CSS px, so a large one keeps one rim instead of a band inside it.
 */
const POOL_PX = 3;

export const BUBBLE_VERTEX = `${HEADER}
${NODES}
${VIEW}
${GROW}
${DRAW}
layout(location = 0) in uint aNode;
uniform int uPass;
uniform bool uShadow;
uniform float uFocusAmount;
uniform int uFocusIndex;
uniform bool uClusterFocus;
uniform float uRadiusScale;
uniform float uPixelRatio;
uniform float uSink;
uniform int uGround;
uniform vec3 uCluster[8];
out vec2 vLocal; // from the centre, in radii
flat out float vRadius; // device px
flat out float vReach; // how far beyond the rim anything is drawn, device px
flat out vec3 vColor;
flat out float vSink;
flat out float vRelief;
// What of a bubble's shape depends on its size alone, worked out once here rather than at every
// pixel. Soil: softness, rim width (radii), contact ring width (device px). Paper: the pooling
// band (radii), the ink line's width and centre (device px), and how far off register it sits.
flat out vec4 vShape;
flat out float vHalo;
flat out float vGlow;
flat out float vFade;
void main() {
  uint state = nodeState(aNode);
  bool emphasised = (state & (FLAG_HOVERED | FLAG_SELECTED)) != 0u;
  bool raised = (state & FLAG_FOCUS) != 0u;
  bool keep = uPass == ${String(BubblePass.emphasis)} || (!emphasised &&
    (uPass == ${String(BubblePass.all)} || (uPass == ${String(BubblePass.raised)}) == raised));
  vec2 g = nodePosition(aNode);
  if (!keep || any(isnan(g))) {
    gl_Position = NOWHERE;
    return;
  }
  vec4 attributes = nodeAttributes(aNode);
  float radius = attributes.x * uView.x * uRadiusScale * growthOf(g);
  float fade = 1.0;
  if (radius < ${glslFloat(MIN_BUBBLE_PX)}) {
    fade = max(radius, 0.0) / ${glslFloat(MIN_BUBBLE_PX)};
    fade *= fade;
    radius = ${glslFloat(MIN_BUBBLE_PX)};
  }
  if (fade < ${glslFloat(MIN_BUBBLE_FADE)}) {
    gl_Position = NOWHERE;
    return;
  }
  bool hovered = (state & FLAG_HOVERED) != 0u;
  bool selected = (state & FLAG_SELECTED) != 0u;
  float sink = 0.0;
  if (!raised && !selected) {
    // The open note's neighbours stay a little clearer, so its links still lead somewhere.
    sink = uFocusAmount * uSink * ((state & FLAG_SELECTED_NEIGHBOUR) != 0u ? 0.6 : 1.0);
  }
  float halo = max(hovered ? uFocusAmount : 0.0, selected ? ${glslFloat(HALO.selected)} : 0.0);
  float glow = 0.0;
  if (raised && !emphasised && !uClusterFocus && uFocusIndex >= 0) {
    // A neighbour lights up as its link arrives.
    float arrival = arrivalOf(length(g - nodePosition(uint(uFocusIndex))));
    glow = smoothstep(arrival - 0.15, arrival, uDrawOn) * uFocusAmount;
  }
  vec2 centre = toDevice(g);
  float pad;
  if (uShadow) {
    centre += vec2(0.4, 1.0) * max(0.5 * uPixelRatio, radius * 0.1);
    pad = radius * 0.25 + 1.5;
  } else {
    float reach = max(halo * ${glslFloat(HALO.px)}, glow * ${glslFloat(GLOW.px)}) * uPixelRatio;
    pad = 1.5 + max(reach, radius * 0.08 + uPixelRatio);
  }
  float extent = radius + pad;
  vec2 corner = cornerOf(gl_VertexID);
  vLocal = corner * (extent / radius);
  vRadius = radius;
  vReach = pad;
  vColor = uCluster[int(attributes.y) & 7];
  vSink = sink;
  // What is left of a sunk bubble's relief: it flattens before its colour is gone.
  vRelief = 1.0 - min(sink * ${glslFloat(SOIL.relief)}, 1.0);
  if (uGround == 0) {
    float soft = 1.0 - smoothstep(3.0, 10.0, radius / uPixelRatio);
    vShape = vec4(soft, max(1.1 * uPixelRatio / radius, 0.075),
      max(0.8 * uPixelRatio, radius * 0.06), 0.0);
  } else {
    // The pigment pools in a band never wider than POOL_PX; the ink line hugs the rim, and
    // neither its offset nor the pigment left outside it is ever more than a fraction of a CSS
    // pixel, or a large bubble would get a second rim.
    float lineWidth = max(0.75 * uPixelRatio, min(radius * 0.045, 2.2 * uPixelRatio));
    vShape = vec4(min(0.14, ${glslFloat(POOL_PX)} * uPixelRatio / radius), lineWidth,
      radius - min(0.015 * radius, 0.3 * uPixelRatio) - lineWidth * 0.5,
      min(1.0, 0.4 * uPixelRatio / (0.03 * radius)));
  }
  vHalo = halo;
  vGlow = glow;
  vFade = fade;
  gl_Position = toClip(centre + corner * extent);
}
`;

export const BUBBLE_FRAGMENT = `${HEADER}
in vec2 vLocal;
flat in float vRadius;
flat in float vReach;
flat in vec3 vColor;
flat in float vSink;
flat in float vRelief;
flat in vec4 vShape;
flat in float vHalo;
flat in float vGlow;
flat in float vFade;
uniform int uGround;
uniform bool uShadow;
uniform float uPixelRatio;
uniform vec3 uBg;
uniform vec3 uLight;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uHaloColor;
uniform vec3 uGlowColor;
out vec4 fragColor;
${GRAIN}
// Parameter of a two-circle radial gradient: 0 at the light point f, 1 on the unit circle.
float radialT(vec2 q, vec2 f) {
  vec2 w = q - f;
  float wf = dot(w, f);
  float k = 1.0 - dot(f, f);
  return (wf + sqrt(wf * wf + k * dot(w, w))) / k;
}
// A soft light beyond the rim, fading out by its reach (CSS px).
float haloAt(float outside, float reach) {
  return exp(-outside / (reach * 0.28)) * (1.0 - smoothstep(reach * 0.6, reach, outside));
}
vec3 humusBody(vec3 c, float d, float soft) {
  float t = radialT(vLocal, vec2(-0.24, -0.32));
  vec3 body = mix(mix(c, uLight, 0.28), c, smoothstep(0.0, 0.62, t));
  body = mix(body, mix(c, uBg, 0.42), smoothstep(0.6, 1.08, t) * (1.0 - 0.7 * soft));
  // The inner light: a broad glow just above the centre, as if the spore were lit from within.
  vec2 inner = vLocal - vec2(-0.05, -0.1);
  body += uLight * 0.13 * exp(-3.0 * dot(inner, inner));
  float spec = 1.0 - smoothstep(0.0, 0.36, length(vLocal - vec2(-0.36, -0.42)));
  body = mix(body, uLight, 0.2 * spec * spec);
  float rimWidth = vShape.y;
  float rim = smoothstep(1.0 - rimWidth * 2.2, 1.0 - rimWidth * 0.4, d) * (1.0 - soft);
  float bounce = 0.1 + 0.4 * smoothstep(-0.2, 0.9, vLocal.y);
  return mix(body, mix(c, uLight, 0.45), rim * bounce);
}
vec3 kalkBody(vec3 c) {
  // A flat wash, barely lighter where the brush started, the pigment pooling at the rim.
  float t = radialT(vLocal, vec2(-0.12, -0.16));
  vec3 body = mix(mix(c, uPaper, 0.34), mix(c, uPaper, 0.2), smoothstep(0.0, 0.8, t));
  body = mix(body, mix(c, uInk, 0.18), smoothstep(1.0 - vShape.x, 1.0, t));
  // The paper's tooth showing through the pigment, a CSS pixel fine.
  body *= 1.0 + (hash(floor(gl_FragCoord.xy / uPixelRatio) + 7.0) - 0.5) * 0.06;
  // The ink line, drawn a hair off register and hugging the rim.
  vec2 offset = vec2(0.03, -0.025) * vShape.w;
  float fromLine = abs(length(vLocal - offset) * vRadius - vShape.z);
  float line = 1.0 - smoothstep(vShape.y * 0.5 - 0.5, vShape.y * 0.5 + 0.5, fromLine);
  return mix(body, mix(c, uInk, 0.6), line * 0.85);
}
void main() {
  float d = length(vLocal);
  float relief = vRelief;
  if (uShadow) {
    // Kalk: a soft sepia contact shadow, drawn under every body of the pass.
    float a = 0.2 * (1.0 - smoothstep(0.5, 1.25, d)) * vFade * relief;
    fragColor = vec4(vec3(${SEPIA.map((channel) => glslFloat(channel)).join(', ')}) * a, a);
    return;
  }
  float px = (d - 1.0) * vRadius; // signed distance to the rim, device px
  if (px > vReach) {
    discard; // the quad's corners
  }
  bool humus = uGround == 0;
  float soft = humus ? vShape.x : 0.0;
  // Under the body: a dark contact ring on soil, an ink ring around an emphasised bubble on
  // paper. Light on soil is added, so its alpha stays zero.
  vec4 outer = vec4(0.0);
  if (px > -0.5) {
    float outside = max(px, 0.0) / uPixelRatio;
    if (humus) {
      float ringWidth = vShape.z;
      float ring = (1.0 - smoothstep(ringWidth * 0.4, ringWidth, px)) * 0.5 * (1.0 - soft) * relief;
      vec3 light = uHaloColor * (vHalo * ${glslFloat(HALO.peak.humus)} * haloAt(outside, ${glslFloat(HALO.px)})) +
        uGlowColor * (vGlow * ${glslFloat(GLOW.peak.humus)} * haloAt(outside, ${glslFloat(GLOW.px)}));
      outer = vec4(uBg * 0.3 * ring + light, ring);
    } else {
      float ringAt = (outside - ${glslFloat(KALK_RING.at)}) / ${glslFloat(KALK_RING.width)};
      float ring = exp(-ringAt * ringAt) * step(0.0, px);
      outer = vec4(uHaloColor, 1.0) * (vHalo * ${glslFloat(HALO.peak.kalk)} * ring) +
        vec4(uGlowColor, 1.0) * (vGlow * ${glslFloat(GLOW.peak.kalk)} * ring);
    }
  }
  vec4 disc = vec4(0.0);
  float cover = clamp(0.5 - px, 0.0, 1.0);
  if (cover > 0.0) {
    // The soil, or the paper, closing over a sunk bubble: its relief flattens into the plain
    // colour — once nothing of it is left, the shading is not worked out at all — and the
    // ground, grain and all, is drawn back over what is left, a little less over the rim, whose
    // faint line keeps each covered bubble perceptible among its neighbours. Two whole branches,
    // so the compiler keeps the soil off the path of every bubble that has not sunk.
    vec3 body;
    if (vSink > 0.0) {
      body = humus ? vColor : mix(vColor, uPaper, 0.27);
      if (relief > 0.0) {
        body = mix(body, humus ? humusBody(vColor, d, soft) : kalkBody(vColor), relief);
      }
      float edge = smoothstep(-1.6 * uPixelRatio, -0.3 * uPixelRatio, px);
      float covered = vSink * (1.0 - ${glslFloat(SOIL.edge)} * edge);
      body = mix(body, groundAt(uBg, uLight, !humus, gl_FragCoord.xy / uPixelRatio, 0.0), covered);
    } else {
      body = humus ? humusBody(vColor, d, soft) : kalkBody(vColor);
    }
    body += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    float alpha = cover * mix(1.0, 1.0 - 0.7 * smoothstep(0.35, 1.0, d), soft);
    disc = vec4(body * alpha, alpha);
  }
  fragColor = (disc + outer * (1.0 - disc.a)) * vFade;
}
`;

// --- what the renderer caches and binds -----------------------------------------------------

const NODE_UNIFORMS = ['uPositions', 'uAttributes', 'uStates', 'uTexWidth'] as const;
const VIEW_UNIFORMS = ['uView', 'uSize'] as const;
const GROW_UNIFORMS = ['uGrow', 'uField'] as const;
const CURVE_UNIFORMS = ['uSegments', 'uRadiusScale', 'uDrawOn'] as const;

export const GROUND_UNIFORMS = [
  'uView',
  'uSize',
  'uPixelRatio',
  'uGround',
  'uBg',
  'uGrainTint',
  'uTooth',
  'uWash',
  'uShoreLow',
  'uShoreHigh',
  'uFocusWash',
  'uFocusShoreLow',
  'uFocusShoreHigh',
  'uHighSlots',
  'uTerritoryBox',
  'uTerritoryScale',
  'uTerritoryAlpha',
  'uTerritoryFocusMix',
  'uShoreScale',
  'uCluster',
  'uShoreInk',
] as const;

export const RESOLVE_UNIFORMS = [
  'uSplatLow',
  'uSplatHigh',
  'uHighSlots',
  'uGain',
  'uCluster',
] as const;

export const SPLAT_UNIFORMS = [...NODE_UNIFORMS, 'uBox', 'uFocusOnly', 'uWeight'] as const;

export const EDGE_UNIFORMS = [
  ...NODE_UNIFORMS,
  ...VIEW_UNIFORMS,
  ...GROW_UNIFORMS,
  ...CURVE_UNIFORMS,
  'uMode',
  'uWidth',
  'uAlpha',
  'uFocusAmount',
  'uFocusIndex',
  'uClusterFocus',
  'uColor',
  'uGlow',
] as const;

export const SPARK_UNIFORMS = [
  ...NODE_UNIFORMS,
  ...VIEW_UNIFORMS,
  ...GROW_UNIFORMS,
  ...CURVE_UNIFORMS,
  'uFocusAmount',
  'uSparkRadius',
  'uSparkAlpha',
  'uColor',
  'uAdditive',
] as const;

export const BUBBLE_UNIFORMS = [
  ...NODE_UNIFORMS,
  ...VIEW_UNIFORMS,
  ...GROW_UNIFORMS,
  'uDrawOn',
  'uPass',
  'uShadow',
  'uFocusAmount',
  'uFocusIndex',
  'uClusterFocus',
  'uRadiusScale',
  'uPixelRatio',
  'uSink',
  'uCluster',
  'uGround',
  'uBg',
  'uLight',
  'uInk',
  'uPaper',
  'uHaloColor',
  'uGlowColor',
] as const;

// --- the same numbers for JavaScript --------------------------------------------------------

export interface TextureSize {
  readonly width: number;
  readonly height: number;
}

/** Node index i lives at texel (i % width, ⌊i / width⌋); never smaller than one texel. */
export function nodeTextureSize(count: number): TextureSize {
  const width = Math.min(NODE_TEXTURE_MAX_WIDTH, Math.max(1, count));
  return { width, height: Math.max(1, Math.ceil(count / width)) };
}

/** Vertices of one link's triangle strip: two per segment boundary. */
export function edgeVertexCount(segments: number): number {
  return 2 * (segments + 1);
}

/**
 * Curve segments of the links at rest, from the on-screen length scale: the zoom times the
 * typical link length, CSS px. A quadratic curve bent by EDGE_BEND of its length L strays at most
 * EDGE_BEND · L / (2n²) from its n-segment polygon, so n grows with the square root of the scale:
 * CURVE_SEGMENTS.min at a vault seen whole, rising to CURVE_SEGMENTS.max for links that cross the
 * screen. The lit and the open note's links, a few bright strokes, keep to the tight tolerance;
 * the quiet web, 17,000 faint hairlines whose vertices are most of a frame's work on a software
 * rasteriser, to the loose one.
 */
export function curveSegments(scale: number, layer: keyof typeof CURVE_SEGMENTS.tolerance): number {
  if (!(scale > 0)) {
    return CURVE_SEGMENTS.min;
  }
  const { longShare, tolerance } = CURVE_SEGMENTS;
  const n = Math.sqrt((EDGE_BEND * longShare * scale) / (2 * tolerance[layer]));
  return Math.min(CURVE_SEGMENTS.max, Math.max(CURVE_SEGMENTS.min, Math.round(n)));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The draw-on progress at which a lit link of this length (graph units) reaches its end. */
export function arrivalOf(length: number): number {
  return mix(DRAW_ON.earliest, 1, smoothstep(DRAW_ON.shortLength, DRAW_ON.longLength, length));
}

/**
 * The part of the territory texture a field of this aspect uses, long side TERRITORY_TEXELS.
 * Written into `out` because it runs on every layout tick, where nothing may be allocated.
 */
export function territoryViewport(
  width: number,
  height: number,
  out: { width: number; height: number },
): { width: number; height: number } {
  const full = TERRITORY_TEXELS;
  const minimum = full / 16;
  if (!(width > 0) || !(height > 0)) {
    out.width = full;
    out.height = full;
  } else if (width >= height) {
    out.width = full;
    out.height = Math.max(minimum, Math.round((full * height) / width));
  } else {
    out.width = Math.max(minimum, Math.round((full * width) / height));
    out.height = full;
  }
  return out;
}
