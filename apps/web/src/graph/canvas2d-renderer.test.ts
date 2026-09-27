import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bucketRadius,
  createCanvas2dRenderer,
  isSnapped,
  MAX_SPRITE_RADIUS,
  SNAP_RADIUS_PX,
  SPRITE_BUCKETS,
  spriteBucket,
  type SpriteSurface,
} from './canvas2d-renderer.js';
import {
  EDGE_CLASS_WEIGHTS,
  FOCUS_SINK,
  growthAt,
  HALO,
  LIT_EDGE,
  LIT_GLOW,
  lightReach,
  litColor,
  litCrowd,
  MIN_BUBBLE_PX,
  QUIET_EDGE_SINK,
  SELECTED_EDGE,
  SPARK,
  sparkFade,
} from './look.js';
import { parseColor, type Palette } from './palette.js';
import { NodeFlag, type FieldData, type FieldFrame } from './types.js';

/** Longer than the renderer waits for the positions to rest before it caches the quiet edges. */
const REST_MS = 300;

afterEach(() => {
  vi.useRealTimers();
});

const palette: Palette = {
  bg: 'rgb(20, 17, 15)',
  edge: 'rgba(236, 229, 218, 0.32)',
  edgeActive: 'rgba(236, 229, 218, 0.75)',
  label: 'rgb(232, 225, 214)',
  labelHalo: 'rgb(20, 17, 15)',
  accent: 'rgb(221, 184, 95)',
  plate: 'rgba(38, 33, 29, 0.92)',
  glow: 'rgb(243, 223, 176)',
  inkLight: 'rgb(251, 249, 244)',
  inkDark: 'rgb(20, 17, 15)',
  clusters: ['rgb(127, 157, 97)', 'rgb(201, 162, 75)'],
  fontSans: 'ui-sans-serif, system-ui',
};

interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
  readonly alpha: number;
  readonly stroke: unknown;
  readonly lineWidth: number;
  readonly composite: string;
}

/** Records what the renderer asks of a 2D context, with the state each call ran under. */
class FakeContext {
  readonly calls: Call[] = [];
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineCap = 'butt';

  #record(name: string, args: readonly unknown[]): void {
    this.calls.push({
      name,
      args,
      alpha: this.globalAlpha,
      stroke: this.strokeStyle,
      lineWidth: this.lineWidth,
      composite: this.globalCompositeOperation,
    });
  }

  setTransform(...args: number[]): void {
    this.#record('setTransform', args);
  }
  fillRect(...args: number[]): void {
    this.#record('fillRect', [...args, this.fillStyle]);
  }
  beginPath(): void {
    this.#record('beginPath', []);
  }
  moveTo(x: number, y: number): void {
    this.#record('moveTo', [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.#record('lineTo', [x, y]);
  }
  arc(...args: number[]): void {
    this.#record('arc', args);
  }
  fill(): void {
    this.#record('fill', []);
  }
  stroke(path?: unknown): void {
    this.#record('stroke', path === undefined ? [] : [path]);
  }
  drawImage(...args: unknown[]): void {
    this.#record('drawImage', args);
  }
  createRadialGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }

  named(name: string): Call[] {
    return this.calls.filter((call) => call.name === name);
  }

  clear(): void {
    this.calls.length = 0;
  }
}

class FakePath {
  moves = 0;
  moveTo(): void {
    this.moves += 1;
  }
  lineTo(): void {
    // the fake only counts links, by their moveTo
  }
}

interface Surface {
  readonly width: number;
  readonly source: { readonly close: ReturnType<typeof vi.fn> };
  /** The transforms the sprite was painted under. */
  readonly ctx: FakeContext;
}

function setup(ctx: FakeContext | null = new FakeContext()) {
  const listeners = new Map<string, () => void>();
  const canvas = {
    width: 400,
    height: 300,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  };
  const surfaces: Surface[] = [];
  const paths: FakePath[] = [];
  const onLost = vi.fn();
  const onRestored = vi.fn();
  const renderer = createCanvas2dRenderer(
    canvas as unknown as HTMLCanvasElement,
    { onLost, onRestored },
    {
      createSurface: (width): SpriteSurface => {
        const source = { close: vi.fn() };
        const surfaceCtx = new FakeContext();
        surfaces.push({ width, source, ctx: surfaceCtx });
        return {
          ctx: surfaceCtx as unknown as CanvasRenderingContext2D,
          finish: () => source as unknown as CanvasImageSource,
        };
      },
      createPath: () => {
        const path = new FakePath();
        paths.push(path);
        return path as unknown as Path2D;
      },
    },
  );
  return { renderer, canvas, ctx, listeners, surfaces, paths, onLost, onRestored };
}

/** A hub (0) linked to three notes, and one link between two of them. */
const data: FieldData = {
  nodes: {
    count: 4,
    radius: Float32Array.of(10, 5, 5, 5),
    slot: Uint8Array.of(0, 1, 1, 0),
    degree: Float32Array.of(3, 2, 2, 1),
    territory: Uint8Array.of(0, 0, 0, 0),
  },
  edges: Uint32Array.of(0, 1, 0, 2, 0, 3, 1, 2),
};
const positions = Float32Array.of(0, 0, 40, 0, 0, 40, -40, 0);

function frame(overrides: Partial<FieldFrame> = {}): FieldFrame {
  return {
    transform: { k: 1, x: 200, y: 150 },
    width: 400,
    height: 300,
    pixelRatio: 1,
    palette,
    ground: 'humus',
    focusAmount: 0,
    focusIndex: -1,
    clusterFocus: false,
    selectedIndex: -1,
    drawOn: 0,
    grow: 1,
    symbolScale: 1,
    moving: false,
    edgeDensity: 0.8,
    territory: 0,
    ...overrides,
  };
}

function loaded(ctx = new FakeContext(), nodes: FieldData = data, xy: Float32Array = positions) {
  const made = setup(ctx);
  const renderer = made.renderer;
  if (renderer === null) {
    throw new Error('no renderer');
  }
  renderer.setData(nodes);
  renderer.setPositions(xy);
  renderer.setStates(new Uint8Array(nodes.nodes.count));
  return { ...made, renderer, ctx };
}

/** The path commands issued since the last beginPath before the call at `end`. */
function pathBefore(ctx: FakeContext, end: number): Call[] {
  const calls = ctx.calls.slice(0, end);
  const start = calls.map((call) => call.name).lastIndexOf('beginPath');
  return calls.slice(start + 1);
}

function strokeIndex(ctx: FakeContext, style: string): number {
  return ctx.calls.findIndex((call) => call.name === 'stroke' && call.stroke === style);
}

/** A colour as the renderer writes it into a style: rgba with the alpha to three places. */
function css(color: readonly number[]): string {
  const [r = 0, g = 0, b = 0, a = 1] = color;
  const channel = (value: number): string => String(Math.round(value * 255));
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${String(Math.round(a * 1000) / 1000)})`;
}

/** The stroke of a lit link. */
const lit = css(litColor(palette));

/** The light sprites a frame drew: every scaled blit that is not a spark. */
function lightBlits(ctx: FakeContext, spark?: unknown): Call[] {
  return ctx.calls.filter(
    (call) => call.name === 'drawImage' && call.args.length === 5 && call.args[0] !== spark,
  );
}

/** Where the ground is laid over what sinks: the second fill of the frame, after the ground. */
function coverIndex(ctx: FakeContext): number {
  const fills = ctx.calls.flatMap((call, at) => (call.name === 'fillRect' ? [at] : []));
  return fills[1] ?? -1;
}

describe('spriteBucket', () => {
  it('snaps a small bubble to a sprite within 2.5 % of its size, blitted unscaled', () => {
    for (let radius = 0.8; radius < SNAP_RADIUS_PX; radius += 0.13) {
      const bucket = spriteBucket(radius);
      expect(isSnapped(bucket)).toBe(true);
      expect(Math.abs(bucketRadius(bucket) / radius - 1)).toBeLessThanOrEqual(0.025 + 1e-9);
    }
  });

  it('scales a larger bubble down from a sprite at most √2 larger, never up', () => {
    for (let radius = SNAP_RADIUS_PX; radius <= MAX_SPRITE_RADIUS; radius += 0.37) {
      const bucket = spriteBucket(radius);
      expect(isSnapped(bucket)).toBe(false);
      expect(bucketRadius(bucket)).toBeGreaterThanOrEqual(radius - 1e-9);
      expect(bucketRadius(bucket) / radius).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
    }
  });

  it('keeps a radius that sits exactly on a bucket in that bucket', () => {
    expect(spriteBucket(bucketRadius(SPRITE_BUCKETS - 3))).toBe(SPRITE_BUCKETS - 3);
  });

  it('puts tiny and unset radii in the first bucket and huge ones in the last', () => {
    expect(spriteBucket(0.3)).toBe(0);
    expect(spriteBucket(Number.NaN)).toBe(0);
    expect(spriteBucket(-4)).toBe(0);
    expect(spriteBucket(MAX_SPRITE_RADIUS * 3)).toBe(SPRITE_BUCKETS - 1);
  });
});

describe('createCanvas2dRenderer', () => {
  it('returns null where the canvas gives no 2D context', () => {
    expect(setup(null).renderer).toBeNull();
  });

  it('paints the ground, then every quiet edge in one stroke one device pixel wide', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { renderer, ctx, paths } = loaded();
    renderer.render(frame({ pixelRatio: 2 }));
    expect(renderer.kind).toBe('canvas2d');
    expect(ctx.calls[0]?.name).toBe('setTransform');
    expect(ctx.named('fillRect')[0]?.args).toEqual([0, 0, 400, 300, palette.bg]);
    const at = strokeIndex(ctx, palette.edge);
    const quiet = ctx.calls[at];
    expect(quiet?.lineWidth).toBe(0.5);
    expect(quiet?.alpha).toBeCloseTo(0.8);
    expect(pathBefore(ctx, at).filter((call) => call.name === 'moveTo')).toHaveLength(4);
    expect(ctx.named('stroke').filter((call) => call.stroke === palette.edge)).toHaveLength(1);

    ctx.clear();
    vi.advanceTimersByTime(REST_MS);
    renderer.render(frame({ pixelRatio: 2 }));
    const cached = ctx.named('stroke').filter((call) => call.stroke === palette.edge);
    expect(cached).toHaveLength(1);
    expect(cached[0]?.args[0]).toBe(paths[0]);
    expect(cached[0]?.lineWidth).toBe(0.5);
    expect(paths[0]?.moves).toBe(4);
  });

  it('traces the quiet edges straight into the context while the positions move, and caches them once they rest', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { renderer, ctx, paths } = loaded();
    // A running layout moves the positions before every frame: no Path2D is made for any of them.
    for (let tick = 0; tick < 3; tick += 1) {
      renderer.setPositions(positions);
      renderer.setPositions(positions);
      renderer.render(frame());
    }
    expect(paths).toHaveLength(0);
    // A frame with no tick before it is not rest yet: the growth or a glide draws between ticks.
    renderer.render(frame());
    expect(paths).toHaveLength(0);

    // At rest the edges are traced once more, into a path the frames of pan and zoom reuse.
    vi.advanceTimersByTime(REST_MS);
    renderer.render(frame());
    renderer.render(frame({ transform: { k: 1.5, x: 180, y: 140 } }));
    ctx.clear();
    renderer.render(frame({ transform: { k: 2, x: 160, y: 130 } }));
    expect(paths).toHaveLength(1);
    expect(ctx.named('moveTo')).toHaveLength(0);
    expect(ctx.named('stroke').filter((call) => call.args[0] === paths[0])).toHaveLength(1);

    renderer.setPositions(positions);
    renderer.render(frame());
    expect(paths).toHaveLength(1);
    vi.advanceTimersByTime(REST_MS);
    renderer.render(frame());
    expect(paths).toHaveLength(2);
  });

  it('fades the web in with the entry growth', () => {
    const { renderer, ctx } = loaded();
    renderer.render(frame({ grow: 0.1 }));
    expect(strokeIndex(ctx, palette.edge)).toBe(-1);
    ctx.clear();
    renderer.render(frame({ grow: 0.6 }));
    const alpha = ctx.calls[strokeIndex(ctx, palette.edge)]?.alpha ?? 0;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.8);
  });

  it('draws nothing but the ground on a canvas of no size', () => {
    const made = setup();
    const renderer = made.renderer;
    if (renderer === null) {
      throw new Error('no renderer');
    }
    made.canvas.width = 0;
    renderer.setData(data);
    renderer.setPositions(positions);
    renderer.render(frame());
    expect(made.surfaces).toHaveLength(0);
    expect(made.ctx?.calls.map((call) => call.name)).toEqual(['setTransform', 'fillRect']);
  });

  it('leaves out a note the layout has not placed yet, and every link to it', () => {
    const { renderer, ctx } = loaded();
    const unplaced = Float32Array.of(0, 0, Number.NaN, Number.NaN, 0, 40, -40, 0);
    renderer.setPositions(unplaced);
    renderer.setStates(Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, NodeFlag.focus, 1, 1));
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 0.5 }));
    const quiet = pathBefore(ctx, strokeIndex(ctx, palette.edge));
    expect(quiet.filter((call) => call.name === 'moveTo')).toHaveLength(2);
    const litPath = pathBefore(ctx, strokeIndex(ctx, lit));
    expect(litPath.filter((call) => call.name === 'lineTo')).toHaveLength(2);
    const bubbles = ctx.named('drawImage').filter((call) => call.args.length === 3);
    expect(bubbles).toHaveLength(3);
    expect(ctx.calls.every((call) => call.args.every((arg) => !Number.isNaN(arg)))).toBe(true);
  });

  it('paints each sprite once per colour and size and blits it, hubs last', () => {
    const { renderer, ctx, surfaces } = loaded();
    const zoomed = frame({ transform: { k: 2, x: 200, y: 150.3 } });
    renderer.render(zoomed);
    // The hub of slot 0, the small note of slot 0, the small notes of slot 1.
    expect(surfaces).toHaveLength(3);
    const blits = ctx.named('drawImage');
    expect(blits).toHaveLength(4);
    // The small ones (10 px) unscaled at whole pixels, the hub (20 px) scaled to its size.
    for (const blit of blits.slice(0, 3)) {
      expect(blit.args).toHaveLength(3);
      expect(blit.args.slice(1).every(Number.isInteger)).toBe(true);
    }
    const [, x, y, width, height] = blits.at(-1)?.args as number[];
    expect((x ?? 0) + (width ?? 0) / 2).toBeCloseTo(200);
    expect((y ?? 0) + (height ?? 0) / 2).toBeCloseTo(150.3);

    ctx.clear();
    renderer.render(zoomed);
    expect(surfaces).toHaveLength(3);
    expect(ctx.named('drawImage')).toHaveLength(4);
  });

  it('leaves out bubbles that are off screen', () => {
    const { renderer, ctx } = loaded();
    renderer.render(frame({ transform: { k: 1, x: 2000, y: 150 } }));
    expect(ctx.named('drawImage')).toHaveLength(0);
  });

  it('draws the lit links out from the hovered note, as many as its own links', () => {
    const { renderer, ctx } = loaded();
    renderer.setStates(Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 1, 1, 1));
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 0.5 }));
    const litPath = pathBefore(ctx, strokeIndex(ctx, lit));
    // Each tip travels from the hub's rim (10 of the 40 units) to the neighbour's (35): half
    // way is 22.5.
    const ends = litPath.filter((call) => call.name === 'lineTo').map((call) => call.args);
    expect(ends).toEqual([
      [22.5, 0],
      [0, 22.5],
      [-22.5, 0],
    ]);
    // The active edge colour warmed by the glow, as on the WebGL field.
    expect(lit).not.toBe(palette.edgeActive);
    expect(ctx.calls[strokeIndex(ctx, lit)]?.lineWidth).toBe(LIT_EDGE.px);
    // On soil a wide faint light lies under them first.
    const glow = ctx.calls[strokeIndex(ctx, palette.glow)];
    expect(glow?.lineWidth).toBe(LIT_GLOW.px);
    expect(glow?.alpha).toBeCloseTo(LIT_GLOW.alpha);

    ctx.clear();
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 1 }));
    const whole = pathBefore(ctx, strokeIndex(ctx, lit));
    expect(whole.filter((call) => call.name === 'lineTo').map((call) => call.args)).toEqual([
      [40, 0],
      [0, 40],
      [-40, 0],
    ]);
  });

  it('lights the links inside a focused cluster, whole, with no sparks and no halos', () => {
    const { renderer, ctx, surfaces } = loaded();
    renderer.setStates(Uint8Array.of(0, NodeFlag.focus, NodeFlag.focus, 0));
    renderer.render(frame({ clusterFocus: true, focusAmount: 1, drawOn: 1 }));
    const at = strokeIndex(ctx, lit);
    expect(at).toBeGreaterThan(coverIndex(ctx));
    // The one link inside the cluster, 1–2; the hub's links to them stay in the soil.
    const litPath = pathBefore(ctx, at).filter(
      (call) => call.name === 'moveTo' || call.name === 'lineTo',
    );
    expect(litPath.map((call) => call.args)).toEqual([
      [40, 0],
      [0, 40],
    ]);
    // Only the three bubble sprites were painted: no light, no spark.
    expect(surfaces).toHaveLength(3);
    expect(lightBlits(ctx)).toHaveLength(0);
  });

  it('thins the light out over a crowded cluster', () => {
    expect(litCrowd(1)).toBe(1);
    expect(litCrowd(60)).toBe(1);
    expect(litCrowd(240)).toBeCloseTo(0.5);

    // A ring of 1,000 notes linked all round: 1,000 lit links, thinned to about a quarter.
    const ring = 1000;
    const edges = new Uint32Array(ring * 2);
    const xy = new Float32Array(ring * 2);
    for (let node = 0; node < ring; node += 1) {
      edges[node * 2] = node;
      edges[node * 2 + 1] = (node + 1) % ring;
      xy[node * 2] = Math.cos((node / ring) * Math.PI * 2) * 100;
      xy[node * 2 + 1] = Math.sin((node / ring) * Math.PI * 2) * 100;
    }
    const crowded: FieldData = {
      nodes: {
        count: ring,
        radius: new Float32Array(ring).fill(2),
        slot: new Uint8Array(ring),
        degree: new Float32Array(ring).fill(2),
        territory: new Uint8Array(ring),
      },
      edges,
    };
    const { renderer, ctx } = loaded(new FakeContext(), crowded, xy);
    renderer.setStates(new Uint8Array(ring).fill(NodeFlag.focus));
    renderer.render(frame({ clusterFocus: true, focusAmount: 1, drawOn: 1 }));
    expect(strokeIndex(ctx, palette.glow)).toBe(-1);
    const core = ctx.calls[strokeIndex(ctx, lit)];
    expect(core?.alpha).toBeCloseTo(litCrowd(ring));
    expect(core?.lineWidth).toBe(1); // no thinner than the quiet web
  });

  it('lays no light under the lit links on paper', () => {
    const { renderer, ctx } = loaded();
    renderer.setStates(Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 1, 1, 1));
    renderer.render(frame({ ground: 'kalk', focusIndex: 0, focusAmount: 1, drawOn: 1 }));
    expect(strokeIndex(ctx, palette.glow)).toBe(-1);
    expect(strokeIndex(ctx, lit)).toBeGreaterThan(-1);
  });

  it('puts a spark at each tip while the links draw out, and none once they arrived', () => {
    const { renderer, ctx, surfaces } = loaded();
    const states = Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 1, 1, 1);
    renderer.setStates(states);
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 0.5 }));
    const spark = surfaces.find((surface) => surface.width === 48)?.source;
    const sparks = ctx.named('drawImage').filter((call) => call.args[0] === spark);
    expect(sparks).toHaveLength(3);
    // Centred on the tips of the lit links, the first at (22.5, 0) of the graph.
    const size = SPARK.px;
    expect(sparks[0]?.args.slice(1)).toEqual([222.5 - size, 150 - size, size * 2, size * 2]);
    expect(sparks.every((call) => call.alpha === 1)).toBe(true);
    // Light added to the soil, as the WebGL field adds it.
    expect(sparks.every((call) => call.composite === 'lighter')).toBe(true);
    expect(ctx.globalCompositeOperation).toBe('source-over');

    // Faded out as they reach the neighbours.
    ctx.clear();
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 0.95 }));
    const late = ctx.named('drawImage').filter((call) => call.args[0] === spark);
    expect(late[0]?.alpha).toBeCloseTo(sparkFade(0.95));
    expect(sparkFade(0.95)).toBeLessThan(0.5);

    ctx.clear();
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 1 }));
    expect(ctx.named('drawImage').filter((call) => call.args[0] === spark)).toHaveLength(0);
  });

  it('sinks everything outside the focus under the ground and draws the focus over it', () => {
    const { renderer, ctx, surfaces } = loaded();
    renderer.setStates(Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, NodeFlag.focus, 0, 0));
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 1 }));
    const cover = coverIndex(ctx);
    expect(ctx.calls[cover]?.args).toEqual([0, 0, 400, 300, palette.bg]);
    expect(ctx.calls[cover]?.alpha).toBe(FOCUS_SINK.humus);

    // The two notes outside the focus go under the cover, the focus over it, all at full
    // strength: the cover sinks them evenly, overlaps included.
    const bubbles = ctx.calls
      .map((call, at) => ({ call, at }))
      .filter(({ call }) => call.name === 'drawImage' && call.args.length === 3);
    expect(bubbles.map(({ at }) => at < cover)).toEqual([true, true, false, false]);
    expect(bubbles.every(({ call }) => call.alpha === 1)).toBe(true);
    expect(strokeIndex(ctx, lit)).toBeGreaterThan(cover);
    // The neighbour's glow, then the hovered hub's halo, both added to the soil over the cover.
    const lights = lightBlits(ctx);
    expect(lights.map((call) => call.alpha)).toEqual([1, 1]);
    expect(lights.every((call) => call.composite === 'lighter')).toBe(true);
    expect(surfaces).toHaveLength(3 + 2);
  });

  it('keeps the open note above the soil under a focus, its links a little fainter unless it is in it', () => {
    const hovering = frame({ focusIndex: 0, focusAmount: 1, drawOn: 1, selectedIndex: 3 });
    const outside = loaded();
    outside.renderer.setStates(
      Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 0, 0, NodeFlag.selected),
    );
    outside.renderer.render(hovering);
    const cover = coverIndex(outside.ctx);
    const accent = strokeIndex(outside.ctx, palette.accent);
    expect(accent).toBeGreaterThan(cover);
    expect(outside.ctx.calls[accent]?.alpha).toBeCloseTo(
      SELECTED_EDGE.alpha.humus * (1 - SELECTED_EDGE.sink),
    );
    // The open note (at −40, 0: a 5 px bubble blitted from a 16 px sprite at 152, 142) is drawn
    // over the cover, with its halo; the two notes outside the focus under it.
    const blits = outside.ctx.calls
      .map((call, at) => ({ call, at }))
      .filter(({ call }) => call.name === 'drawImage' && call.args.length === 3);
    const open = blits.find(({ call }) => call.args[1] === 152 && call.args[2] === 142);
    expect(open?.at).toBeGreaterThan(cover);
    expect(blits.filter(({ at }) => at < cover)).toHaveLength(2);
    expect(lightBlits(outside.ctx).map((call) => call.alpha)).toEqual([HALO.selected, 1]);

    const inside = loaded();
    inside.renderer.setStates(
      Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 0, 0, NodeFlag.selected | NodeFlag.focus),
    );
    inside.renderer.render(hovering);
    const full = strokeIndex(inside.ctx, palette.accent);
    expect(full).toBeGreaterThan(coverIndex(inside.ctx));
    expect(inside.ctx.calls[full]?.alpha).toBe(SELECTED_EDGE.alpha.humus);
  });

  it("strokes the open note's own links in the accent colour", () => {
    const { renderer, ctx } = loaded();
    renderer.setStates(Uint8Array.of(0, NodeFlag.selected, 0, 0));
    renderer.render(frame({ selectedIndex: 1, transform: { k: 2, x: 200, y: 150 } }));
    const at = strokeIndex(ctx, palette.accent);
    expect(pathBefore(ctx, at).filter((call) => call.name === 'lineTo')).toHaveLength(2);
    expect(ctx.calls[at]?.lineWidth).toBe(SELECTED_EDGE.px / 2);
    expect(ctx.calls[at]?.alpha).toBe(SELECTED_EDGE.alpha.humus);

    ctx.clear();
    renderer.render(frame({ selectedIndex: 1, ground: 'kalk' }));
    expect(ctx.calls[strokeIndex(ctx, palette.accent)]?.alpha).toBe(SELECTED_EDGE.alpha.kalk);
  });

  it('strokes short, ordinary and long links apart, the long ones fainter', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    // A short link (20), an ordinary one (60) and a long one (300).
    const spread: FieldData = {
      nodes: {
        count: 4,
        radius: Float32Array.of(3, 3, 3, 3),
        slot: Uint8Array.of(0, 0, 0, 0),
        degree: Float32Array.of(1, 2, 2, 1),
        territory: Uint8Array.of(0, 0, 0, 0),
      },
      edges: Uint32Array.of(0, 1, 1, 2, 2, 3),
    };
    const xy = Float32Array.of(-150, 0, -130, 0, -70, 0, 230, 0);
    const { renderer, ctx, paths } = loaded(new FakeContext(), spread, xy);
    renderer.render(frame({ transform: { k: 0.5, x: 200, y: 150 } }));
    const edge = parseColor(palette.edge);
    const styles = EDGE_CLASS_WEIGHTS.map((weight) =>
      weight === 1 ? palette.edge : css([edge[0], edge[1], edge[2], edge[3] * weight]),
    );
    const strokes = ctx.named('stroke');
    expect(strokes.map((call) => call.stroke)).toEqual(styles);
    // One link in each, at the density's alpha; the weight lies in the colour.
    for (const [at, call] of strokes.entries()) {
      expect(
        pathBefore(ctx, ctx.calls.indexOf(call)).filter((c) => c.name === 'moveTo'),
      ).toHaveLength(1);
      expect(call.alpha).toBeCloseTo(0.8);
      expect(call.stroke).toBe(styles[at]);
    }
    expect(parseColor(styles[2] ?? '')[3]).toBeLessThan(parseColor(styles[0] ?? '')[3]);

    // At rest a path per class, stroked as it is on every frame of pan and zoom.
    vi.advanceTimersByTime(REST_MS);
    renderer.render(frame({ transform: { k: 0.5, x: 200, y: 150 } }));
    ctx.clear();
    renderer.render(frame({ transform: { k: 0.6, x: 200, y: 150 } }));
    expect(paths).toHaveLength(3);
    expect(ctx.named('stroke').map((call) => call.args[0])).toEqual(paths);
    expect(ctx.named('moveTo')).toHaveLength(0);
  });

  it('sinks the quiet web a step further than the bubbles under a focus', () => {
    const { renderer, ctx } = loaded();
    renderer.setStates(Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 1, 1, 1));
    renderer.render(frame({ focusIndex: 0, focusAmount: 1, drawOn: 1 }));
    const quiet = ctx.calls[strokeIndex(ctx, palette.edge)];
    const cover = FOCUS_SINK.humus;
    // Drawn under the cover of the ground: what is left of it is 1 − QUIET_EDGE_SINK.
    expect((quiet?.alpha ?? 0) * (1 - cover)).toBeCloseTo(0.8 * (1 - QUIET_EDGE_SINK));
  });

  it('fades a bubble smaller than the least size rather than shrinking it further', () => {
    const { renderer, ctx } = loaded();
    // The hub (10 units) at 0.06 is 0.6 px, the others 0.3 px.
    renderer.render(frame({ transform: { k: 0.06, x: 200, y: 150 } }));
    const blits = ctx.named('drawImage');
    expect(blits.map((call) => call.alpha)).toEqual(
      [
        (0.3 / MIN_BUBBLE_PX) ** 2,
        (0.3 / MIN_BUBBLE_PX) ** 2,
        (0.3 / MIN_BUBBLE_PX) ** 2,
        (0.6 / MIN_BUBBLE_PX) ** 2,
      ].map((alpha) => expect.closeTo(alpha, 5) as unknown as number),
    );
    expect(ctx.globalAlpha).toBe(1);
  });

  it('reaches as far past the rim for every bubble, painted per whole radius', () => {
    const { renderer, ctx, surfaces } = loaded();
    // The open hub at 1.26 of its size: a 12.6 px bubble at a pixel ratio of 2 is 25.2 device px.
    renderer.setStates(Uint8Array.of(NodeFlag.selected, 0, 0, 0));
    renderer.render(
      frame({ selectedIndex: 0, pixelRatio: 2, transform: { k: 1.26, x: 100, y: 75 } }),
    );
    const [halo] = lightBlits(ctx);
    const reach = lightReach('humus', 'halo') * 2;
    const painted = surfaces.find((surface) => surface.source === halo?.args[0]);
    // Painted for a radius of 25 with the reach past it, the gradient over both.
    const transform = painted?.ctx.named('setTransform')[0]?.args;
    expect(transform?.[0]).toBe(25 + reach);
    // Drawn so that its rim lands on the bubble's: the half side scaled by 25.2 / 25.
    const [, x, , size] = halo?.args as number[];
    expect((x ?? 0) + (size ?? 0) / 2).toBeCloseTo(200);
    expect(size).toBeCloseTo((painted?.width ?? 0) * (25.2 / 25));
    expect(halo?.alpha).toBe(HALO.selected);

    // On paper the halo is an ink ring laid over the field, not light added to it.
    ctx.clear();
    renderer.render(frame({ selectedIndex: 0, ground: 'kalk' }));
    expect(lightBlits(ctx).every((call) => call.composite === 'source-over')).toBe(true);
  });

  it('grows the field in from nothing', () => {
    const { renderer, ctx } = loaded();
    renderer.render(frame({ grow: 0 }));
    expect(ctx.named('drawImage')).toHaveLength(0);
    renderer.render(frame({ grow: 1 }));
    expect(ctx.named('drawImage')).toHaveLength(4);
  });

  it('grows each bubble as the WebGL field does, by its distance from the centre', () => {
    const { renderer, ctx } = loaded();
    // At k = 20 the hub is a vector of radius 200 device px, painted at its own size. The field
    // spans −40 … 40 by 0 … 40: its centre is (0, 20), its reach half the diagonal.
    renderer.render(frame({ grow: 0.6, transform: { k: 20, x: 200, y: 150 } }));
    // Graph space is set up at the same offset, at a scale of 20: the hub's is ten times that.
    const hub = ctx
      .named('setTransform')
      .find((call) => call.args[4] === 200 && call.args[5] === 150 && Number(call.args[0]) > 100);
    const distance = 20 / (Math.hypot(80, 40) / 2);
    expect(hub?.args[0]).toBeCloseTo(200 * growthAt(0.6, distance), 6);
    expect(growthAt(0.6, distance)).toBeGreaterThan(1); // the overshoot is under way
  });

  it('paints a bubble too large for a sprite as a vector at its own size', () => {
    const { renderer, ctx } = loaded();
    renderer.render(frame({ transform: { k: 20, x: 200, y: 150 } }));
    expect(ctx.named('setTransform').map((call) => call.args)).toContainEqual([
      200, 0, 0, 200, 200, 150,
    ]);
    expect(ctx.named('arc').length).toBeGreaterThan(0);
  });

  it('paints the look afresh when the palette changes, closing the old sprites', () => {
    const { renderer, surfaces } = loaded();
    renderer.render(frame());
    const before = surfaces.slice();
    renderer.render(frame({ palette: { ...palette } }));
    expect(surfaces.length).toBe(before.length * 2);
    for (const surface of before) {
      expect(surface.source.close).toHaveBeenCalledOnce();
    }
  });

  it('passes a lost context on and lets go of everything on destroy', () => {
    const { renderer, ctx, listeners, onLost, onRestored, surfaces } = loaded();
    renderer.render(frame());
    listeners.get('contextlost')?.();
    listeners.get('contextrestored')?.();
    expect(onLost).toHaveBeenCalledOnce();
    expect(onRestored).toHaveBeenCalledOnce();

    renderer.destroy();
    expect(renderer.lost).toBe(true);
    expect(listeners.size).toBe(0);
    expect(surfaces.every((surface) => surface.source.close.mock.calls.length === 1)).toBe(true);
    ctx.clear();
    renderer.render(frame());
    expect(ctx.calls).toHaveLength(0);
  });
});
