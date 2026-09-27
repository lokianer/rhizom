// The field in WebGL2: ground and territories, the quiet web, the open note's links, the lit
// links, the bubbles and the sparks. The notes live in textures, so a layout tick uploads one
// small position texture and touches no edge; a frame sets uniforms and draws, allocating
// nothing. Everything needed to rebuild after a lost context is kept on this side.
import { LIT_EDGE, LIT_GLOW, SELECTED_EDGE, SPARK, litColor, litCrowd } from '../look.js';
import { smoothstep } from '../motion.js';
import { parseColor, type Palette, type Rgba } from '../palette.js';
import { readRendererChoice } from '../renderer-choice.js';
import { NodeFlag, type FieldFrame, type FieldRenderer, type RendererFactory } from '../types.js';
import {
  createGlContext,
  enableHalfFloatTarget,
  isSoftwareRenderer,
  releaseContext,
  watchContext,
} from './context.js';
import { derive, typicalLinkLength, type Derived } from './derive.js';
import { createProgram, type GlProgram } from './program.js';
import {
  BUBBLE_FRAGMENT,
  BUBBLE_UNIFORMS,
  BUBBLE_VERTEX,
  BubblePass,
  EDGE_FRAGMENT,
  EDGE_UNIFORMS,
  EDGE_VERTEX,
  EdgeMode,
  GROUND_FRAGMENT,
  GROUND_UNIFORMS,
  RESOLVE_FRAGMENT,
  RESOLVE_UNIFORMS,
  SCREEN_VERTEX,
  SHORE_RANGE,
  SOIL_SINK,
  SPARK_FRAGMENT,
  SPARK_UNIFORMS,
  SPARK_VERTEX,
  SPLAT,
  SPLAT_FRAGMENT,
  SPLAT_UNIFORMS,
  SPLAT_VERTEX,
  TERRITORY_TEXELS,
  TEXTURE_UNITS,
  TOOTH,
  curveSegments,
  edgeVertexCount,
  territoryViewport,
} from './shaders.js';

type GroundUniform = (typeof GROUND_UNIFORMS)[number];
type ResolveUniform = (typeof RESOLVE_UNIFORMS)[number];
type SplatUniform = (typeof SPLAT_UNIFORMS)[number];
type EdgeUniform = (typeof EDGE_UNIFORMS)[number];
type SparkUniform = (typeof SPARK_UNIFORMS)[number];
type BubbleUniform = (typeof BUBBLE_UNIFORMS)[number];

/** Where a byte target has to hold the sums, each splat weighs this much and the sum is scaled back. */
const BYTE_SPLAT_WEIGHT = 0.1;
/** A shore line fades out this many device px from its middle. */
const SHORE_LINE_PX = 1.1;
/**
 * The least shore scale, so a shore line never reaches the ends of the encoded range: every texel
 * SHORE_RANGE / 2 or more from a shore reads as one of them, and so does all the ground outside
 * the field. Zoomed out until a texel covers less than half a device px, a line 1.1 px wide would
 * reach them and draw the whole ground as shore; the line gets thinner instead.
 */
const MIN_SHORE_SCALE = 2.5;

/**
 * One framebuffer drawing into several textures at once: the splats' densities of slots 0–3
 * and 4–7, or a resolved territory's wash and the shores of slots 0–3 and 4–7.
 */
interface Target {
  readonly framebuffer: WebGLFramebuffer;
}

/** Every object one build created: what a failed build and a destroy hand back, and no more. */
interface Owned {
  readonly programs: WebGLProgram[];
  readonly textures: WebGLTexture[];
  readonly framebuffers: WebGLFramebuffer[];
  readonly buffers: WebGLBuffer[];
  readonly vaos: WebGLVertexArrayObject[];
}

interface Gpu {
  readonly owned: Owned;
  readonly ground: GlProgram<GroundUniform>;
  readonly splat: GlProgram<SplatUniform>;
  readonly resolve: GlProgram<ResolveUniform>;
  readonly edge: GlProgram<EdgeUniform>;
  readonly spark: GlProgram<SparkUniform>;
  readonly bubble: GlProgram<BubbleUniform>;
  readonly positions: WebGLTexture;
  readonly attributes: WebGLTexture;
  readonly states: WebGLTexture;
  /** Where the splats are summed, then resolved into one of the two territories. */
  readonly splats: Target;
  readonly territory: Target;
  readonly territoryFocus: Target;
  readonly halfFloat: boolean;
  /** The splat pass's draw buffers: both slot textures, or only the low one. */
  readonly drawBoth: readonly GLenum[];
  readonly drawLow: readonly GLenum[];
  readonly edges: WebGLBuffer;
  readonly selected: WebGLBuffer;
  readonly lit: WebGLBuffer;
  readonly order: WebGLBuffer;
  readonly emphasis: WebGLBuffer;
  readonly edgesVao: WebGLVertexArrayObject;
  readonly selectedVao: WebGLVertexArrayObject;
  readonly litVao: WebGLVertexArrayObject;
  readonly orderVao: WebGLVertexArrayObject;
  readonly emphasisVao: WebGLVertexArrayObject;
  readonly emptyVao: WebGLVertexArrayObject;
}

/** The palette as the shaders take it, parsed once per theme rather than once per frame. */
interface Colours {
  readonly bg: Float32Array;
  readonly edge: Float32Array;
  readonly accent: Float32Array;
  readonly glow: Float32Array;
  readonly label: Float32Array;
  readonly paper: Float32Array;
  /** The lit link's stroke: the active edge colour warmed by the glow. */
  readonly litCore: Float32Array;
  readonly clusters: Float32Array;
  edgeAlpha: number;
  litAlpha: number;
}

function createColours(): Colours {
  return {
    bg: new Float32Array(3),
    edge: new Float32Array(3),
    accent: new Float32Array(3),
    glow: new Float32Array(3),
    label: new Float32Array(3),
    paper: new Float32Array(3),
    litCore: new Float32Array(3),
    clusters: new Float32Array(24),
    edgeAlpha: 0,
    litAlpha: 0,
  };
}

function writeRgb(target: Float32Array, colour: Rgba, offset = 0): void {
  target[offset] = colour[0];
  target[offset + 1] = colour[1];
  target[offset + 2] = colour[2];
}

function mixRgb(target: Float32Array, a: Rgba, b: Rgba, t: number): void {
  target[0] = a[0] + (b[0] - a[0]) * t;
  target[1] = a[1] + (b[1] - a[1]) * t;
  target[2] = a[2] + (b[2] - a[2]) * t;
}

function applyPalette(colours: Colours, palette: Palette): void {
  const bg = parseColor(palette.bg);
  const edge = parseColor(palette.edge);
  const lit = litColor(palette);
  writeRgb(colours.bg, bg);
  writeRgb(colours.edge, edge);
  writeRgb(colours.accent, parseColor(palette.accent));
  writeRgb(colours.glow, parseColor(palette.glow));
  writeRgb(colours.label, parseColor(palette.label));
  mixRgb(colours.paper, bg, [1, 1, 1, 1], 0.55);
  writeRgb(colours.litCore, lit);
  for (let slot = 0; slot < 8; slot += 1) {
    const cluster = palette.clusters[slot] ?? palette.label;
    writeRgb(colours.clusters, parseColor(cluster), slot * 3);
  }
  colours.edgeAlpha = edge[3];
  colours.litAlpha = lit[3];
}

function createOwned(): Owned {
  return { programs: [], textures: [], framebuffers: [], buffers: [], vaos: [] };
}

function releaseOwned(gl: WebGL2RenderingContext, owned: Owned): void {
  for (const program of owned.programs) {
    gl.deleteProgram(program);
  }
  for (const framebuffer of owned.framebuffers) {
    gl.deleteFramebuffer(framebuffer);
  }
  for (const texture of owned.textures) {
    gl.deleteTexture(texture);
  }
  for (const buffer of owned.buffers) {
    gl.deleteBuffer(buffer);
  }
  for (const vao of owned.vaos) {
    gl.deleteVertexArray(vao);
  }
}

function dataTexture(
  gl: WebGL2RenderingContext,
  owned: Owned,
  unit: number,
  internalFormat: GLenum,
  format: GLenum,
  type: GLenum,
): WebGLTexture {
  const texture = gl.createTexture();
  owned.textures.push(texture);
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // texelFetch ignores filtering, but the default mipmapped minification would leave the
  // texture incomplete and every fetch reading zero.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 1, 1, 0, format, type, null);
  return texture;
}

function territoryTexture(
  gl: WebGL2RenderingContext,
  unit: number,
  halfFloat: boolean,
): WebGLTexture {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const size = TERRITORY_TEXELS;
  if (halfFloat) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  return texture;
}

/**
 * A target drawing into the textures on these units at once, one colour attachment each, or null
 * where that colour buffer cannot be drawn to. The textures stay bound to their units for the
 * life of the context.
 */
function territoryTarget(
  gl: WebGL2RenderingContext,
  owned: Owned,
  units: readonly number[],
  halfFloat: boolean,
): Target | null {
  const textures = units.map((unit) => territoryTexture(gl, unit, halfFloat));
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  textures.forEach((texture, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
  });
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    for (const texture of textures) {
      gl.deleteTexture(texture);
    }
    return null;
  }
  owned.textures.push(...textures);
  owned.framebuffers.push(framebuffer);
  return { framebuffer };
}

/**
 * The paper's and the soil's tooth: random bytes, one per lattice point, filtered and repeating.
 * The same bytes on every build (xorshift from a fixed seed), so a restored context grows the
 * same ground.
 */
function toothTexture(gl: WebGL2RenderingContext, owned: Owned): WebGLTexture {
  const size = TOOTH.texels;
  const bytes = new Uint8Array(size * size);
  let seed = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i += 1) {
    seed = (seed ^ (seed << 13)) >>> 0;
    seed = (seed ^ (seed >>> 17)) >>> 0;
    seed = (seed ^ (seed << 5)) >>> 0;
    bytes[i] = seed >>> 24;
  }
  const texture = gl.createTexture();
  owned.textures.push(texture);
  gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNITS.uTooth);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
  return texture;
}

/** A vertex array whose only attribute is one uint or uvec2 per instance, at location 0. */
function instanceVao(
  gl: WebGL2RenderingContext,
  owned: Owned,
  buffer: WebGLBuffer,
  components: 1 | 2,
): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  owned.vaos.push(vao);
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, components, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return vao;
}

function bindSamplers(gl: WebGL2RenderingContext, program: GlProgram<string>): void {
  gl.useProgram(program.program);
  const uniforms: Readonly<Record<string, WebGLUniformLocation | null | undefined>> =
    program.uniforms;
  for (const [name, unit] of Object.entries(TEXTURE_UNITS)) {
    const location = uniforms[name];
    if (location !== undefined && location !== null) {
      gl.uniform1i(location, unit);
    }
  }
}

/**
 * Every program, texture, target and buffer of the field. Throws where a shader does not build
 * or no colour buffer can hold the territories, having deleted whatever it made up to there: a
 * failed rebuild after a restored context must not leave half a field behind in a live context.
 */
function buildGpu(gl: WebGL2RenderingContext): Gpu {
  const owned = createOwned();
  try {
    return assembleGpu(gl, owned);
  } catch (error) {
    releaseOwned(gl, owned);
    throw error;
  }
}

function assembleGpu(gl: WebGL2RenderingContext, owned: Owned): Gpu {
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // one-byte states in rows of any width
  const program = <U extends string>(
    vertex: string,
    fragment: string,
    uniforms: readonly U[],
  ): GlProgram<U> => {
    const built = createProgram(gl, vertex, fragment, uniforms);
    owned.programs.push(built.program);
    bindSamplers(gl, built);
    return built;
  };
  const ground = program(SCREEN_VERTEX, GROUND_FRAGMENT, GROUND_UNIFORMS);
  const splat = program(SPLAT_VERTEX, SPLAT_FRAGMENT, SPLAT_UNIFORMS);
  const resolve = program(SCREEN_VERTEX, RESOLVE_FRAGMENT, RESOLVE_UNIFORMS);
  const edge = program(EDGE_VERTEX, EDGE_FRAGMENT, EDGE_UNIFORMS);
  const spark = program(SPARK_VERTEX, SPARK_FRAGMENT, SPARK_UNIFORMS);
  const bubble = program(BUBBLE_VERTEX, BUBBLE_FRAGMENT, BUBBLE_UNIFORMS);

  const units = TEXTURE_UNITS;
  const positions = dataTexture(gl, owned, units.uPositions, gl.RG32F, gl.RG, gl.FLOAT);
  const attributes = dataTexture(gl, owned, units.uAttributes, gl.RGBA32F, gl.RGBA, gl.FLOAT);
  const states = dataTexture(gl, owned, units.uStates, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE);

  toothTexture(gl, owned);

  let halfFloat = enableHalfFloatTarget(gl);
  const splatUnits = [units.uSplatLow, units.uSplatHigh];
  let splats = territoryTarget(gl, owned, splatUnits, halfFloat);
  if (splats === null && halfFloat) {
    halfFloat = false;
    splats = territoryTarget(gl, owned, splatUnits, false);
  }
  // What the resolve writes lies in 0 … 1, and bytes are what a software rasteriser filters
  // fastest: the ground reads these on every pixel of every frame.
  const territory = territoryTarget(
    gl,
    owned,
    [units.uWash, units.uShoreLow, units.uShoreHigh],
    false,
  );
  const territoryFocus = territoryTarget(
    gl,
    owned,
    [units.uFocusWash, units.uFocusShoreLow, units.uFocusShoreHigh],
    false,
  );
  if (splats === null || territory === null || territoryFocus === null) {
    throw new Error('No colour buffer for the territories');
  }

  const buffer = (): WebGLBuffer => {
    const created = gl.createBuffer();
    owned.buffers.push(created);
    return created;
  };
  const edges = buffer();
  const selected = buffer();
  const lit = buffer();
  const order = buffer();
  const emphasis = buffer();
  const emptyVao = gl.createVertexArray();
  owned.vaos.push(emptyVao);
  return {
    owned,
    ground,
    splat,
    resolve,
    edge,
    spark,
    bubble,
    positions,
    attributes,
    states,
    splats,
    territory,
    territoryFocus,
    halfFloat,
    drawBoth: [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1],
    drawLow: [gl.COLOR_ATTACHMENT0, gl.NONE],
    edges,
    selected,
    lit,
    order,
    emphasis,
    edgesVao: instanceVao(gl, owned, edges, 2),
    selectedVao: instanceVao(gl, owned, selected, 2),
    litVao: instanceVao(gl, owned, lit, 2),
    orderVao: instanceVao(gl, owned, order, 1),
    emphasisVao: instanceVao(gl, owned, emphasis, 1),
    emptyVao,
  };
}

/**
 * Uploads the first `count` entries of a per-node array into a texture laid out in rows of
 * `width`: whole rows in one call, the last partial row in a second, both straight from the
 * caller's array through srcOffset, so nothing is copied or allocated.
 */
function uploadRows(
  gl: WebGL2RenderingContext,
  width: number,
  count: number,
  components: number,
  format: GLenum,
  type: GLenum,
  source: Float32Array | Uint8Array,
): void {
  const rows = Math.floor(count / width);
  if (rows > 0) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, rows, format, type, source, 0);
  }
  const rest = count - rows * width;
  if (rest > 0) {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      rows,
      rest,
      1,
      format,
      type,
      source,
      rows * width * components,
    );
  }
}

/**
 * The WebGL2 field renderer; null where WebGL2 or one of its shaders is unavailable, and where it
 * would draw in software, unless `rhizom.renderer` in local storage asks for it anyway.
 */
export const createGlFieldRenderer: RendererFactory = (canvas, events) => {
  const context = createGlContext(canvas);
  if (context === null) {
    return null;
  }
  // Re-bound so the hoisted functions below see it as non-null.
  const gl: WebGL2RenderingContext = context;
  if (isSoftwareRenderer(gl) && readRendererChoice() !== 'webgl2') {
    console.info('Rhizom: WebGL2 runs in software here; the field is drawn with Canvas 2D.');
    releaseContext(gl);
    return null;
  }
  let gpu: Gpu | null;
  try {
    gpu = buildGpu(gl);
  } catch (error) {
    // The driver's compile or link log, the only trace of why the field fell back.
    console.warn('Rhizom: the WebGL2 field could not be built; drawing with Canvas 2D.', error);
    releaseContext(gl);
    return null;
  }

  let lost = false;
  let destroyed = false;
  let derived: Derived | null = null;
  let positions: Float32Array | null = null;
  let states: Uint8Array | null = null;

  const colours = createColours();
  let palette: Palette | null = null;

  // The field's extent, scanned from every position array: the entry wave starts at its
  // centre, and the territory texture covers its box.
  const field = { minX: 0, minY: 0, maxX: 0, maxY: 0, placed: false };
  const territoryBox = { x: 0, y: 0, width: 1, height: 1 };
  const viewport = { width: TERRITORY_TEXELS, height: TERRITORY_TEXELS };
  // The mean link length in graph units: times the zoom, the length scale the curves are cut by.
  let linkLength = 0;

  // From the last states: the bubbles drawn last and on top, the open one under the hovered.
  const emphasised = new Uint32Array(2);
  let emphasisCount = 0;
  let statesVersion = 0;
  let dataVersion = 0;

  let territoryDirty = true;
  let territoryFocusDirty = true;
  let emphasisDirty = true;
  // What the lit and the selected layers were last built for; -2 is "never".
  const litKey = { focus: -2, cluster: false, states: -1, data: -1 };
  const selectedKey = { index: -2, data: -1 };
  let litCount = 0;
  let selectedCount = 0;

  function scanPositions(xy: Float32Array, count: number): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const n = Math.min(count, xy.length >> 1);
    for (let i = 0; i < n; i += 1) {
      const x = xy[i * 2] ?? Number.NaN;
      const y = xy[i * 2 + 1] ?? Number.NaN;
      if (Number.isNaN(x) || Number.isNaN(y)) {
        continue; // a note the layout has not placed yet
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    field.placed = minX <= maxX;
    if (!field.placed) {
      return;
    }
    linkLength = derived === null ? 0 : typicalLinkLength(derived.edges, xy);
    field.minX = minX;
    field.minY = minY;
    field.maxX = maxX;
    field.maxY = maxY;
    const reach = SPLAT.reach * ((derived?.maxRadius ?? 0) * SPLAT.radiusFactor + SPLAT.base);
    territoryBox.x = minX - reach;
    territoryBox.y = minY - reach;
    territoryBox.width = maxX - minX + reach * 2;
    territoryBox.height = maxY - minY + reach * 2;
    territoryViewport(territoryBox.width, territoryBox.height, viewport);
  }

  function scanStates(flags: Uint8Array, count: number): void {
    let hovered = -1;
    let selected = -1;
    const n = Math.min(count, flags.length);
    for (let i = 0; i < n; i += 1) {
      const state = flags[i] ?? 0;
      if (hovered < 0 && (state & NodeFlag.hovered) !== 0) {
        hovered = i;
      }
      if (selected < 0 && (state & NodeFlag.selected) !== 0) {
        selected = i;
      }
    }
    emphasisCount = 0;
    if (selected >= 0 && selected !== hovered) {
      emphasised[emphasisCount] = selected;
      emphasisCount += 1;
    }
    if (hovered >= 0) {
      emphasised[emphasisCount] = hovered;
      emphasisCount += 1;
    }
    emphasisDirty = true;
  }

  function uploadPositions(g: Gpu, d: Derived, xy: Float32Array): void {
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNITS.uPositions);
    gl.bindTexture(gl.TEXTURE_2D, g.positions);
    uploadRows(gl, d.size.width, Math.min(d.count, xy.length >> 1), 2, gl.RG, gl.FLOAT, xy);
  }

  function uploadStates(g: Gpu, d: Derived, flags: Uint8Array): void {
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNITS.uStates);
    gl.bindTexture(gl.TEXTURE_2D, g.states);
    const n = Math.min(d.count, flags.length);
    uploadRows(gl, d.size.width, n, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, flags);
  }

  /** Every per-data resource, from what is kept here: after setData and after a restore. */
  function uploadData(g: Gpu, d: Derived): void {
    const { width, height } = d.size;
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNITS.uAttributes);
    gl.bindTexture(gl.TEXTURE_2D, g.attributes);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, d.attributes);
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNITS.uPositions);
    gl.bindTexture(gl.TEXTURE_2D, g.positions);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, width, height, 0, gl.RG, gl.FLOAT, null);
    gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNITS.uStates);
    gl.bindTexture(gl.TEXTURE_2D, g.states);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8UI,
      width,
      height,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      null,
    );
    if (positions !== null) {
      uploadPositions(g, d, positions);
    }
    if (states !== null) {
      uploadStates(g, d, states);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, g.edges);
    gl.bufferData(gl.ARRAY_BUFFER, d.edges, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.selected);
    gl.bufferData(gl.ARRAY_BUFFER, d.scratch.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.lit);
    gl.bufferData(gl.ARRAY_BUFFER, d.scratch.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.order);
    gl.bufferData(gl.ARRAY_BUFFER, d.order, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.emphasis);
    gl.bufferData(gl.ARRAY_BUFFER, emphasised.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    territoryDirty = true;
    territoryFocusDirty = true;
    emphasisDirty = true;
    dataVersion += 1;
  }

  /** Writes the links of one note into the scratch, the note first; returns the entries written. */
  function linksOf(d: Derived, node: number): number {
    if (node < 0 || node >= d.count) {
      return 0;
    }
    const pairs = d.edges;
    const out = d.scratch;
    const end = d.incidentStart[node + 1] ?? 0;
    let n = 0;
    for (let at = d.incidentStart[node] ?? end; at < end; at += 1) {
      const link = d.incident[at] ?? 0;
      const a = pairs[link * 2] ?? 0;
      out[n] = node;
      out[n + 1] = a === node ? (pairs[link * 2 + 1] ?? 0) : a;
      n += 2;
    }
    return n;
  }

  /** Every link with both ends in the focus, in link direction, and the focused note's own. */
  function clusterLinks(d: Derived, focus: number, flags: Uint8Array): number {
    const pairs = d.edges;
    const out = d.scratch;
    let n = 0;
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const a = pairs[i] ?? 0;
      const b = pairs[i + 1] ?? 0;
      if (a === focus || b === focus) {
        out[n] = a === focus ? a : b;
        out[n + 1] = a === focus ? b : a;
        n += 2;
      } else if (((flags[a] ?? 0) & (flags[b] ?? 0) & NodeFlag.focus) !== 0) {
        out[n] = a;
        out[n + 1] = b;
        n += 2;
      }
    }
    return n;
  }

  /**
   * Uploads the first `n` entries of the scratch. Never with n = 0: bufferSubData reads a zero
   * length as "to the end of the array", which would copy every pair for nothing.
   */
  function uploadLinks(buffer: WebGLBuffer, d: Derived, n: number): void {
    if (n === 0) {
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.scratch, 0, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /**
   * The links of one note, origin first, or those inside a focused cluster. Rebuilt when the
   * focus changes, not per frame: O(degree) for a note, O(links) for a cluster.
   */
  function rebuildLit(g: Gpu, d: Derived, focus: number, cluster: boolean): void {
    const n = cluster && states !== null ? clusterLinks(d, focus, states) : linksOf(d, focus);
    uploadLinks(g.lit, d, n);
    litCount = n >> 1;
  }

  function rebuildSelected(g: Gpu, d: Derived, selected: number): void {
    const n = linksOf(d, selected);
    uploadLinks(g.selected, d, n);
    selectedCount = n >> 1;
  }

  /**
   * Splats the territory notes, or only the focused ones, into the slot densities and resolves
   * them into the target's wash and shore. Runs when the positions, the focus or the palette
   * change, never for a frame of its own.
   */
  function renderTerritory(g: Gpu, d: Derived, target: Target, focusOnly: boolean): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.splats.framebuffer);
    // Without a territory in slots 4–7 their texture is never read, so it is not drawn either.
    gl.drawBuffers(d.highSlots ? g.drawBoth : g.drawLow);
    gl.viewport(0, 0, TERRITORY_TEXELS, TERRITORY_TEXELS);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, viewport.width, viewport.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const u = g.splat.uniforms;
    gl.useProgram(g.splat.program);
    gl.uniform1i(u.uTexWidth, d.size.width);
    gl.uniform4f(
      u.uBox,
      territoryBox.x,
      territoryBox.y,
      1 / territoryBox.width,
      1 / territoryBox.height,
    );
    gl.uniform1i(u.uFocusOnly, focusOnly ? 1 : 0);
    gl.uniform1f(u.uWeight, g.halfFloat ? 1 : BYTE_SPLAT_WEIGHT);
    gl.bindVertexArray(g.orderVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.count);

    // Every texel, the unused ones too: the ground's bilinear lookups at the edge of the field
    // must find nothing there rather than a larger field's old territory.
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, TERRITORY_TEXELS, TERRITORY_TEXELS);
    const r = g.resolve.uniforms;
    gl.useProgram(g.resolve.program);
    gl.uniform1i(r.uHighSlots, d.highSlots ? 1 : 0);
    gl.uniform1f(r.uGain, g.halfFloat ? 1 : 1 / BYTE_SPLAT_WEIGHT);
    gl.uniform3fv(r.uCluster, colours.clusters);
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function render(frame: FieldFrame): void {
    const g = gpu;
    if (lost || destroyed || g === null) {
      return;
    }
    // Drawn at the size of the drawing buffer, which the browser may make smaller than the
    // canvas asks for; the canvas stretches it back. One ratio covers a buffer shrunk evenly. Past
    // the GPU's limits the browser clamps each axis on its own, which no single ratio can undo,
    // so the PNG export sizes its canvas to what the buffer can hold (export.ts, fitDrawingBuffer).
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    if (canvas.width === 0 || canvas.height === 0 || width === 0 || height === 0) {
      return;
    }
    if (frame.palette !== palette) {
      palette = frame.palette;
      applyPalette(colours, palette);
      territoryDirty = true; // the resolved territories hold the palette's colours
      territoryFocusDirty = true;
    }
    const d = derived;
    const kalk = frame.ground === 'kalk';
    const ratio = frame.pixelRatio * (width / canvas.width);
    const viewK = frame.transform.k * ratio;
    const viewX = frame.transform.x * ratio;
    const viewY = frame.transform.y * ratio;
    const focus = frame.focusAmount > 0.001 ? Math.min(frame.focusAmount, 1) : 0;
    const drawing = d !== null && d.count > 0 && positions !== null && field.placed;
    // An index from before the last setData would fetch outside the node textures.
    const focusIndex = d !== null && frame.focusIndex < d.count ? frame.focusIndex : -1;
    const selectedIndex = d !== null && frame.selectedIndex < d.count ? frame.selectedIndex : -1;
    const centreX = (field.minX + field.maxX) / 2;
    const centreY = (field.minY + field.maxY) / 2;
    const reach = Math.max(1, Math.hypot(field.maxX - field.minX, field.maxY - field.minY) / 2);

    // Off-screen work first, so the default framebuffer is bound once for the whole frame.
    const territoryOn = drawing && d.anyTerritory && frame.territory > 0;
    if (territoryOn && territoryDirty) {
      renderTerritory(g, d, g.territory, false);
      territoryDirty = false;
    }
    const focusMix = territoryOn && frame.clusterFocus ? focus : 0;
    if (territoryOn && focusMix > 0 && territoryFocusDirty) {
      renderTerritory(g, d, g.territoryFocus, true);
      territoryFocusDirty = false;
    }
    if (drawing) {
      const clusterStates = frame.clusterFocus ? statesVersion : -1;
      if (
        litKey.focus !== focusIndex ||
        litKey.cluster !== frame.clusterFocus ||
        litKey.states !== clusterStates ||
        litKey.data !== dataVersion
      ) {
        rebuildLit(g, d, focusIndex, frame.clusterFocus);
        litKey.focus = focusIndex;
        litKey.cluster = frame.clusterFocus;
        litKey.states = clusterStates;
        litKey.data = dataVersion;
      }
      if (selectedKey.index !== selectedIndex || selectedKey.data !== dataVersion) {
        rebuildSelected(g, d, selectedIndex);
        selectedKey.index = selectedIndex;
        selectedKey.data = dataVersion;
      }
      if (emphasisDirty) {
        if (emphasisCount > 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, g.emphasis);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, emphasised, 0, emphasisCount);
          gl.bindBuffer(gl.ARRAY_BUFFER, null);
        }
        emphasisDirty = false;
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);

    // Ground and territories: every pixel, opaque, so no clear and no blending.
    gl.disable(gl.BLEND);
    const gu = g.ground.uniforms;
    gl.useProgram(g.ground.program);
    gl.uniform3f(gu.uView, viewK, viewX, viewY);
    gl.uniform2f(gu.uSize, width, height);
    gl.uniform1f(gu.uPixelRatio, ratio);
    gl.uniform1i(gu.uGround, kalk ? 1 : 0);
    gl.uniform3fv(gu.uBg, colours.bg);
    gl.uniform3fv(gu.uGrainTint, colours.glow);
    const washAlpha = territoryOn
      ? frame.territory *
        (kalk ? 0.13 : 0.15) *
        smoothstep(0.4, 1, frame.grow) *
        (frame.clusterFocus ? 1 : 1 - 0.6 * focus)
      : 0;
    gl.uniform1f(gu.uTerritoryAlpha, washAlpha);
    gl.uniform1f(gu.uTerritoryFocusMix, focusMix);
    // The encoded shore distance in device px (a texel's size on screen times the range it is
    // encoded over), per the 1.1 px a shore line fades out over.
    const texel = Math.sqrt(
      (territoryBox.width / viewport.width) * (territoryBox.height / viewport.height),
    );
    const shoreScale = (SHORE_RANGE * texel * viewK) / SHORE_LINE_PX;
    gl.uniform1f(gu.uShoreScale, Math.max(shoreScale, MIN_SHORE_SCALE));
    gl.uniform1i(gu.uHighSlots, d?.highSlots === true ? 1 : 0);
    gl.uniform3fv(gu.uCluster, colours.clusters);
    gl.uniform3fv(gu.uShoreInk, colours.label);
    gl.uniform4f(
      gu.uTerritoryBox,
      territoryBox.x,
      territoryBox.y,
      1 / territoryBox.width,
      1 / territoryBox.height,
    );
    gl.uniform2f(
      gu.uTerritoryScale,
      viewport.width / TERRITORY_TEXELS,
      viewport.height / TERRITORY_TEXELS,
    );
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!drawing) {
      gl.bindVertexArray(null);
      return;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // every shader writes premultiplied colour

    const scale = frame.transform.k * linkLength;
    const quietSegments = frame.moving ? 1 : curveSegments(scale, 'quiet');
    const litSegments = frame.moving ? 1 : curveSegments(scale, 'lit');
    const litVertices = edgeVertexCount(litSegments);
    const edgeCount = d.edges.length >> 1;

    // Edges: the frame's uniforms once, then only what differs between the layers.
    const eu = g.edge.uniforms;
    gl.useProgram(g.edge.program);
    gl.uniform3f(eu.uView, viewK, viewX, viewY);
    gl.uniform2f(eu.uSize, width, height);
    gl.uniform1i(eu.uTexWidth, d.size.width);
    gl.uniform1f(eu.uGrow, frame.grow);
    gl.uniform3f(eu.uField, centreX, centreY, reach);
    gl.uniform1f(eu.uRadiusScale, frame.symbolScale);
    gl.uniform1f(eu.uDrawOn, frame.drawOn);
    gl.uniform1f(eu.uFocusAmount, focus);
    gl.uniform1i(eu.uFocusIndex, focusIndex);
    gl.uniform1i(eu.uClusterFocus, frame.clusterFocus ? 1 : 0);
    if (edgeCount > 0) {
      gl.uniform1i(eu.uMode, EdgeMode.quiet);
      gl.uniform1i(eu.uSegments, quietSegments);
      gl.uniform1f(eu.uWidth, 1); // one device pixel, whatever the ratio
      gl.uniform1f(eu.uAlpha, colours.edgeAlpha * frame.edgeDensity);
      gl.uniform3fv(eu.uColor, colours.edge);
      gl.uniform1i(eu.uGlow, 0);
      gl.bindVertexArray(g.edgesVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, edgeVertexCount(quietSegments), edgeCount);
    }

    // Bubbles need the frame's uniforms before the first of their passes.
    const bu = g.bubble.uniforms;
    gl.useProgram(g.bubble.program);
    gl.uniform3f(bu.uView, viewK, viewX, viewY);
    gl.uniform2f(bu.uSize, width, height);
    gl.uniform1i(bu.uTexWidth, d.size.width);
    gl.uniform1f(bu.uGrow, frame.grow);
    gl.uniform3f(bu.uField, centreX, centreY, reach);
    gl.uniform1f(bu.uDrawOn, frame.drawOn);
    gl.uniform1f(bu.uFocusAmount, focus);
    gl.uniform1i(bu.uFocusIndex, focusIndex);
    gl.uniform1i(bu.uClusterFocus, frame.clusterFocus ? 1 : 0);
    gl.uniform1f(bu.uRadiusScale, frame.symbolScale);
    gl.uniform1f(bu.uPixelRatio, ratio);
    gl.uniform1f(bu.uSink, SOIL_SINK[frame.ground]);
    gl.uniform1i(bu.uGround, kalk ? 1 : 0);
    gl.uniform3fv(bu.uCluster, colours.clusters);
    gl.uniform3fv(bu.uBg, colours.bg);
    gl.uniform3fv(bu.uLight, colours.glow);
    gl.uniform3fv(bu.uInk, colours.edge);
    gl.uniform3fv(bu.uPaper, colours.paper);
    gl.uniform3fv(bu.uHaloColor, kalk ? colours.edge : colours.glow);
    gl.uniform3fv(bu.uGlowColor, colours.glow);

    if (focus > 0) {
      // What the soil covers goes down first, so the lit links run over it.
      drawBubbles(g, BubblePass.sunk, g.orderVao, d.count, kalk);
    }

    const lit = focus > 0 && litCount > 0;
    // A hub's forty links may burn bright; a focused cluster's thousand would be a white
    // blot, so the light thins out with the square root of how many links carry it.
    const crowd = lit ? litCrowd(litCount) : 1;
    if (selectedCount > 0 || lit) {
      gl.useProgram(g.edge.program);
      gl.uniform1i(eu.uSegments, litSegments);
      if (selectedCount > 0) {
        gl.uniform1i(eu.uMode, EdgeMode.selected);
        gl.uniform1f(eu.uWidth, SELECTED_EDGE.px * ratio);
        gl.uniform1f(eu.uAlpha, SELECTED_EDGE.alpha[frame.ground]);
        gl.uniform3fv(eu.uColor, colours.accent);
        gl.uniform1i(eu.uGlow, 0);
        gl.bindVertexArray(g.selectedVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, litVertices, selectedCount);
      }
      if (lit) {
        gl.uniform1i(eu.uMode, EdgeMode.lit);
        gl.bindVertexArray(g.litVao);
        if (!kalk && crowd > LIT_GLOW.minCrowd) {
          // A faint band of light under the stroke; paper does not glow.
          gl.uniform1f(eu.uWidth, LIT_GLOW.px * ratio);
          gl.uniform1f(eu.uAlpha, LIT_GLOW.alpha * crowd);
          gl.uniform3fv(eu.uColor, colours.glow);
          gl.uniform1i(eu.uGlow, 1);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, litVertices, litCount);
        }
        gl.uniform1f(eu.uWidth, Math.max(1, LIT_EDGE.px * ratio * Math.sqrt(crowd)));
        gl.uniform1f(eu.uAlpha, colours.litAlpha * Math.max(crowd, LIT_EDGE.floor));
        gl.uniform3fv(eu.uColor, colours.litCore);
        gl.uniform1i(eu.uGlow, 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, litVertices, litCount);
      }
    }

    gl.useProgram(g.bubble.program);
    drawBubbles(g, focus > 0 ? BubblePass.raised : BubblePass.all, g.orderVao, d.count, kalk);
    if (emphasisCount > 0) {
      drawBubbles(g, BubblePass.emphasis, g.emphasisVao, emphasisCount, kalk);
    }

    if (lit && frame.drawOn < 1) {
      const su = g.spark.uniforms;
      gl.useProgram(g.spark.program);
      gl.uniform3f(su.uView, viewK, viewX, viewY);
      gl.uniform2f(su.uSize, width, height);
      gl.uniform1i(su.uTexWidth, d.size.width);
      gl.uniform1f(su.uGrow, frame.grow);
      gl.uniform3f(su.uField, centreX, centreY, reach);
      gl.uniform1i(su.uSegments, litSegments);
      gl.uniform1f(su.uRadiusScale, frame.symbolScale);
      gl.uniform1f(su.uDrawOn, frame.drawOn);
      gl.uniform1f(su.uFocusAmount, focus);
      gl.uniform1f(su.uSparkRadius, SPARK.px * ratio);
      gl.uniform1f(su.uSparkAlpha, Math.max(crowd, SPARK.floor));
      gl.uniform3fv(su.uColor, colours.glow);
      gl.uniform1i(su.uAdditive, kalk ? 0 : 1);
      gl.bindVertexArray(g.litVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, litCount);
    }
    gl.bindVertexArray(null);
  }

  /** One pass of bubbles; on paper each pass lays its contact shadows first. */
  function drawBubbles(
    g: Gpu,
    pass: number,
    vao: WebGLVertexArrayObject,
    count: number,
    kalk: boolean,
  ): void {
    const bu = g.bubble.uniforms;
    gl.uniform1i(bu.uPass, pass);
    gl.bindVertexArray(vao);
    if (kalk) {
      gl.uniform1i(bu.uShadow, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    }
    gl.uniform1i(bu.uShadow, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  const detach = watchContext(canvas, {
    lost: () => {
      lost = true;
      gpu = null; // every object died with the context
      events?.onLost?.();
    },
    restored: () => {
      if (destroyed) {
        return;
      }
      try {
        const g = buildGpu(gl);
        gpu = g;
        palette = null;
        litKey.focus = -2;
        selectedKey.index = -2;
        if (derived !== null) {
          uploadData(g, derived);
        }
        lost = false;
        events?.onRestored?.();
      } catch (error) {
        console.warn('Rhizom: the WebGL2 field could not be rebuilt after a lost context.', error);
        gpu = null; // stays lost: the controller falls back
      }
    },
  });

  const renderer: FieldRenderer = {
    kind: 'webgl2',
    get lost() {
      return lost;
    },
    setData: (data) => {
      const next = derive(data);
      derived = next;
      if (positions !== null) {
        scanPositions(positions, next.count);
      }
      if (states !== null) {
        scanStates(states, next.count);
      }
      if (gpu !== null) {
        uploadData(gpu, next);
      }
    },
    setPositions: (xy) => {
      positions = xy;
      if (derived === null) {
        return;
      }
      scanPositions(xy, derived.count);
      territoryDirty = true;
      territoryFocusDirty = true;
      if (gpu !== null) {
        uploadPositions(gpu, derived, xy);
      }
    },
    setStates: (flags) => {
      states = flags;
      statesVersion += 1;
      territoryFocusDirty = true;
      if (derived === null) {
        return;
      }
      scanStates(flags, derived.count);
      if (gpu !== null) {
        uploadStates(gpu, derived, flags);
      }
    },
    render,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      detach(); // the loss that follows is ours, not news for the controller
      if (gpu !== null && !gl.isContextLost()) {
        releaseOwned(gl, gpu.owned);
      }
      gpu = null;
      derived = null;
      positions = null;
      states = null;
      releaseContext(gl);
    },
  };
  return renderer;
};
