import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Palette } from '../palette.js';
import { NodeFlag, type FieldData, type FieldFrame } from '../types.js';
import { derive, HIGH_SLOT, LENGTH_SAMPLES, typicalLinkLength } from './derive.js';
import { createGlFieldRenderer } from './field-renderer.js';

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
  clusters: [
    '#7f9d61',
    '#c9a24b',
    '#b5573b',
    '#5f8f7c',
    '#d8a15a',
    '#9c6b8a',
    '#a3b28c',
    '#8c6a4f',
  ],
  fontSans: 'ui-sans-serif, system-ui',
};

function fieldData(
  radius: readonly number[],
  edges: readonly number[],
  slots: readonly number[] = radius.map(() => 0),
  territory: readonly number[] = radius.map(() => 1),
): FieldData {
  return {
    nodes: {
      count: radius.length,
      radius: Float32Array.from(radius),
      slot: Uint8Array.from(slots),
      degree: new Float32Array(radius.length),
      territory: Uint8Array.from(territory),
    },
    edges: Uint32Array.from(edges),
  };
}

function frame(overrides: Partial<FieldFrame> = {}): FieldFrame {
  return {
    transform: { k: 1, x: 0, y: 0 },
    width: 800,
    height: 600,
    pixelRatio: 1,
    palette,
    ground: 'humus',
    focusAmount: 0,
    focusIndex: -1,
    clusterFocus: false,
    selectedIndex: -1,
    drawOn: 1,
    grow: 1,
    symbolScale: 1,
    moving: false,
    edgeDensity: 1,
    territory: 1,
    ...overrides,
  };
}

describe('derive', () => {
  it('keeps only pairs with both ends in range and two different ends', () => {
    // A loop, an end out of range and a trailing half pair are dropped.
    const derived = derive(fieldData([4, 4, 4], [0, 1, 1, 1, 2, 9, 1, 2, 0]));
    expect([...derived.edges]).toEqual([0, 1, 1, 2]);
    expect(derived.scratch.length).toBeGreaterThanOrEqual(derived.edges.length);
  });

  it('lists the links of every note, so a hover gathers them in O(degree)', () => {
    const derived = derive(fieldData([4, 4, 4, 4], [0, 1, 1, 2, 3, 1]));
    const linksOf = (node: number): number[] => {
      const from = derived.incidentStart[node] ?? 0;
      const to = derived.incidentStart[node + 1] ?? 0;
      return [...derived.incident.subarray(from, to)].sort();
    };
    expect([...derived.incidentStart]).toEqual([0, 1, 4, 5, 6]);
    expect(linksOf(0)).toEqual([0]);
    expect(linksOf(1)).toEqual([0, 1, 2]);
    expect(linksOf(2)).toEqual([1]);
    expect(linksOf(3)).toEqual([2]);
  });

  it('draws the bubbles smallest first, ties in index order, so hubs stay on top', () => {
    expect([...derive(fieldData([5, 2, 5, 1], [])).order]).toEqual([3, 1, 0, 2]);
  });

  it('lays out radius, slot, degree and territory per texel', () => {
    const derived = derive(fieldData([3, 7], [0, 1], [2, 13], [0, 1]));
    expect([...derived.attributes]).toEqual([3, 2, 0, 0, 7, 5, 0, 1]);
    expect(derived.maxRadius).toBe(7);
    expect(derived.anyTerritory).toBe(true);
  });

  it('asks for the second territory texture only when a territory note uses its slots', () => {
    const high = HIGH_SLOT + 1;
    expect(derive(fieldData([4, 4], [], [0, 3])).highSlots).toBe(false);
    expect(derive(fieldData([4, 4], [], [0, high], [1, 0])).highSlots).toBe(false);
    expect(derive(fieldData([4, 4], [], [0, high], [1, 1])).highSlots).toBe(true);
  });

  it('gives an empty vault complete, one-texel textures', () => {
    const derived = derive(fieldData([], []));
    expect(derived.size).toEqual({ width: 1, height: 1 });
    expect(derived.attributes).toHaveLength(4);
    expect(derived.order).toHaveLength(0);
    expect([...derived.incidentStart]).toEqual([0]);
    expect(derived.anyTerritory).toBe(false);
  });
});

describe('typicalLinkLength', () => {
  it('is the mean length, leaving out links with an end the layout has not placed', () => {
    const xy = Float32Array.from([0, 0, 30, 40, 0, 10, Number.NaN, Number.NaN]);
    expect(typicalLinkLength(Uint32Array.from([0, 1, 0, 2, 0, 3]), xy)).toBeCloseTo(30);
  });

  it('measures at most LENGTH_SAMPLES links, spread over the whole list', () => {
    const links = LENGTH_SAMPLES * 4;
    const xy = new Float32Array((links + 1) * 2);
    const edges = new Uint32Array(links * 2);
    for (let i = 0; i < links; i += 1) {
      xy[(i + 1) * 2] = i % 4 === 0 ? 10 : 1000; // only every fourth link is sampled
      edges[i * 2] = 0;
      edges[i * 2 + 1] = i + 1;
    }
    expect(typicalLinkLength(edges, xy)).toBeCloseTo(10);
  });

  it('is 0 without a measurable link', () => {
    expect(typicalLinkLength(new Uint32Array(0), new Float32Array(0))).toBe(0);
  });
});

// --- the renderer against a recording WebGL2 context ---------------------------------------

interface GlCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

type GlObjectKind = 'shader' | 'program' | 'texture' | 'framebuffer' | 'buffer' | 'vertexArray';

interface GlObject {
  readonly kind: GlObjectKind;
  readonly id: number;
}

interface FakeOptions {
  /** The n-th shader compile (0-based) fails. */
  readonly failShader?: number;
  /** Framebuffers check out incomplete. */
  readonly incomplete?: boolean;
  /** The context arrives already lost. */
  readonly lost?: boolean;
  /** What the debug extension names as the renderer, as Chrome does behind "WebKit WebGL". */
  readonly renderer?: string;
}

/** The debug extension's renderer constant, as the platform defines it. */
const UNMASKED_RENDERER_WEBGL = 0x9246;

/**
 * Records every call the renderer makes, hands out objects and remembers which were deleted.
 * Constants are stable numbers of their own, so comparisons and unit arithmetic still work.
 */
class FakeGl {
  readonly calls: GlCall[] = [];
  readonly created: GlObject[] = [];
  readonly deleted = new Set<GlObject>();
  readonly loseContext = vi.fn();
  readonly context: WebGL2RenderingContext;
  readonly #constants = new Map<string, number>();
  #shaders = 0;

  constructor(options: FakeOptions = {}) {
    const create = (kind: GlObjectKind) => (): GlObject => {
      const made = { kind, id: this.created.length + 1 };
      this.created.push(made);
      return made;
    };
    const remove = (object: unknown): void => {
      this.deleted.add(object as GlObject);
    };
    const methods: Readonly<Record<string, (...args: readonly unknown[]) => unknown>> = {
      createShader: create('shader'),
      createProgram: create('program'),
      createTexture: create('texture'),
      createFramebuffer: create('framebuffer'),
      createBuffer: create('buffer'),
      createVertexArray: create('vertexArray'),
      deleteShader: remove,
      deleteProgram: remove,
      deleteTexture: remove,
      deleteFramebuffer: remove,
      deleteBuffer: remove,
      deleteVertexArray: remove,
      getShaderParameter: () => {
        const compiled = this.#shaders !== options.failShader;
        this.#shaders += 1;
        return compiled;
      },
      getShaderInfoLog: () => 'the fake says no',
      getProgramParameter: () => true,
      getProgramInfoLog: () => '',
      getUniformLocation: (_program, name) => ({ name }),
      checkFramebufferStatus: () =>
        options.incomplete === true ? 0 : this.constant('FRAMEBUFFER_COMPLETE'),
      getExtension: (name) =>
        name === 'WEBGL_lose_context'
          ? { loseContext: this.loseContext }
          : name === 'WEBGL_debug_renderer_info'
            ? { UNMASKED_RENDERER_WEBGL }
            : {},
      getParameter: (name) =>
        name === this.constant('RENDERER')
          ? 'WebKit WebGL'
          : name === UNMASKED_RENDERER_WEBGL
            ? (options.renderer ?? 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0)')
            : undefined,
      isContextLost: () => options.lost === true,
    };
    const size: Readonly<Record<string, number>> = {
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
    };
    this.context = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (typeof property !== 'string') {
            return undefined;
          }
          const known = size[property];
          if (known !== undefined) {
            return known;
          }
          if (/^[A-Z][A-Z0-9_]*$/.test(property)) {
            return this.constant(property);
          }
          return (...args: readonly unknown[]): unknown => {
            this.calls.push({ name: property, args });
            return methods[property]?.(...args);
          };
        },
      },
    ) as WebGL2RenderingContext;
  }

  constant(name: string): number {
    let value = this.#constants.get(name);
    if (value === undefined) {
      value = 0x1000 + this.#constants.size;
      this.#constants.set(name, value);
    }
    return value;
  }

  named(name: string): GlCall[] {
    return this.calls.filter((call) => call.name === name);
  }

  /** Created objects of these kinds that were never deleted. */
  kept(...kinds: GlObjectKind[]): GlObject[] {
    return this.created.filter((made) => kinds.includes(made.kind) && !this.deleted.has(made));
  }
}

function fakeCanvas(gl: WebGL2RenderingContext | null): {
  canvas: HTMLCanvasElement;
  listeners: Map<string, (event: Event) => void>;
} {
  const listeners = new Map<string, (event: Event) => void>();
  const canvas = {
    width: 800,
    height: 600,
    getContext: (kind: string): WebGL2RenderingContext | null => (kind === 'webgl2' ? gl : null),
    addEventListener: (type: string, listener: (event: Event) => void): void => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string): void => {
      listeners.delete(type);
    },
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, listeners };
}

const EVERY_KIND: GlObjectKind[] = ['program', 'texture', 'framebuffer', 'buffer', 'vertexArray'];

describe('createGlFieldRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is null without a WebGL2 context, or with one that arrives lost', () => {
    expect(createGlFieldRenderer(fakeCanvas(null).canvas)).toBeNull();
    const lost = new FakeGl({ lost: true });
    expect(createGlFieldRenderer(fakeCanvas(lost.context).canvas)).toBeNull();
  });

  it('releases what it built when a shader fails, and hands the context back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gl = new FakeGl({ failShader: 5 }); // the third program's fragment stage
    expect(createGlFieldRenderer(fakeCanvas(gl.context).canvas)).toBeNull();
    // The driver's log is the only trace of why the field fell back.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[1])).toContain('the fake says no');
    // Two programs were linked; the third never got past its stages.
    expect(gl.created.filter((made) => made.kind === 'program')).toHaveLength(2);
    expect(gl.created.filter((made) => made.kind === 'shader')).toHaveLength(6);
    expect(gl.kept(...EVERY_KIND, 'shader')).toEqual([]);
    expect(gl.loseContext).toHaveBeenCalledOnce();
  });

  it('releases what it built when no colour buffer can hold the territories', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gl = new FakeGl({ incomplete: true });
    expect(createGlFieldRenderer(fakeCanvas(gl.context).canvas)).toBeNull();
    // Every program and the node textures were made before the framebuffers failed.
    expect(gl.created.filter((made) => made.kind === 'program').length).toBeGreaterThan(0);
    expect(gl.created.filter((made) => made.kind === 'texture').length).toBeGreaterThan(3);
    expect(gl.kept(...EVERY_KIND, 'shader')).toEqual([]);
    expect(gl.loseContext).toHaveBeenCalledOnce();
  });

  it('uploads nothing and draws only the ground for an empty vault', () => {
    const gl = new FakeGl();
    const renderer = createGlFieldRenderer(fakeCanvas(gl.context).canvas);
    expect(renderer).not.toBeNull();
    renderer?.setData(fieldData([], []));
    renderer?.setPositions(new Float32Array(0));
    renderer?.setStates(new Uint8Array(0));
    gl.calls.length = 0;
    renderer?.render(frame());
    expect(gl.named('bufferSubData')).toEqual([]);
    expect(gl.named('texSubImage2D')).toEqual([]);
    expect(gl.named('drawArraysInstanced')).toEqual([]);
    expect(gl.named('drawArrays')).toHaveLength(1);
  });

  it('never uploads an empty link layer: a note without links lights nothing', () => {
    const gl = new FakeGl();
    const renderer = createGlFieldRenderer(fakeCanvas(gl.context).canvas);
    renderer?.setData(fieldData([4, 4, 4], [0, 1]));
    renderer?.setPositions(Float32Array.from([0, 0, 50, 0, 25, 40]));
    renderer?.setStates(Uint8Array.from([0, 0, NodeFlag.focus | NodeFlag.hovered]));
    gl.calls.length = 0;
    renderer?.render(frame({ focusAmount: 1, focusIndex: 2 }));
    // A zero length would read as "to the end" and copy every pair; the one upload is the
    // hovered bubble drawn on top.
    const uploads = gl.named('bufferSubData');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.args[4]).toBe(1);
  });

  it('uploads the states when setStates is called, not when the frame is drawn', () => {
    const gl = new FakeGl();
    const renderer = createGlFieldRenderer(fakeCanvas(gl.context).canvas);
    renderer?.setData(fieldData([4, 4, 4], [0, 1, 1, 2]));
    renderer?.setPositions(Float32Array.from([0, 0, 50, 0, 25, 40]));
    const statesUpload = (call: GlCall): boolean =>
      call.name === 'texSubImage2D' && call.args[6] === gl.constant('RED_INTEGER');
    gl.calls.length = 0;
    const flags = Uint8Array.from([NodeFlag.focus, NodeFlag.focus | NodeFlag.hovered, 0]);
    renderer?.setStates(flags);
    expect(gl.calls.filter(statesUpload)).toHaveLength(1);
    gl.calls.length = 0;
    flags[2] = NodeFlag.selected; // too late: the renderer took the states when they were set
    renderer?.render(frame({ focusAmount: 1, focusIndex: 1 }));
    expect(gl.calls.filter(statesUpload)).toEqual([]);
  });

  it('draws the lit links in more segments than the quiet web when zoomed in', () => {
    const gl = new FakeGl();
    const renderer = createGlFieldRenderer(fakeCanvas(gl.context).canvas);
    renderer?.setData(fieldData([4, 4, 4], [0, 1, 1, 2]));
    renderer?.setPositions(Float32Array.from([0, 0, 200, 0, 100, 150]));
    renderer?.setStates(Uint8Array.from([NodeFlag.focus, NodeFlag.focus | NodeFlag.hovered, 0]));
    const strips = (): number[] =>
      gl.named('drawArraysInstanced').map((call) => Number(call.args[2]));
    gl.calls.length = 0;
    renderer?.render(frame({ transform: { k: 8, x: 0, y: 0 }, focusAmount: 1, focusIndex: 1 }));
    const [quiet, ...rest] = strips().filter((count) => count > 4);
    expect(quiet).toBeDefined();
    expect(Math.max(...rest)).toBeGreaterThan(quiet ?? 0);
    gl.calls.length = 0;
    renderer?.render(frame({ transform: { k: 8, x: 0, y: 0 }, moving: true }));
    // While the camera moves every link is one straight segment: four vertices.
    expect(Math.max(...strips())).toBe(4);
  });

  it('keeps the shore line inside its encoded range however far the view zooms out', () => {
    const gl = new FakeGl();
    const renderer = createGlFieldRenderer(fakeCanvas(gl.context).canvas);
    renderer?.setData(fieldData([4, 4, 4], [0, 1, 1, 2]));
    renderer?.setPositions(Float32Array.from([0, 0, 200, 0, 100, 150]));
    const shoreScale = (k: number): number => {
      gl.calls.length = 0;
      renderer?.render(frame({ transform: { k, x: 0, y: 0 } }));
      const call = gl
        .named('uniform1f')
        .find((made) => (made.args[0] as { name?: string } | null)?.name === 'uShoreScale');
      return Number(call?.args[1]);
    };
    // At 2 the line would reach the ends of the encoded range, where every texel far from a
    // shore and all the ground beyond the field read: the whole screen would be shore.
    expect(shoreScale(0.05)).toBeGreaterThan(2);
    expect(shoreScale(8)).toBeGreaterThan(shoreScale(1));
  });

  it('releases everything and hands the context back on destroy, once', () => {
    const gl = new FakeGl();
    const { canvas, listeners } = fakeCanvas(gl.context);
    const renderer = createGlFieldRenderer(canvas);
    renderer?.setData(fieldData([4, 4], [0, 1]));
    renderer?.setPositions(Float32Array.from([0, 0, 50, 0]));
    renderer?.render(frame());
    expect(listeners.size).toBe(2);
    renderer?.destroy();
    expect(gl.kept(...EVERY_KIND)).toEqual([]);
    expect(gl.loseContext).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    gl.calls.length = 0;
    renderer?.destroy();
    renderer?.render(frame());
    expect(gl.calls).toEqual([]);
    expect(gl.loseContext).toHaveBeenCalledOnce();
  });

  it('stops on a lost context and rebuilds everything on its restore', () => {
    const gl = new FakeGl();
    const { canvas, listeners } = fakeCanvas(gl.context);
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const renderer = createGlFieldRenderer(canvas, { onLost, onRestored });
    renderer?.setData(fieldData([4, 4], [0, 1]));
    renderer?.setPositions(Float32Array.from([0, 0, 50, 0]));
    const preventDefault = vi.fn();
    listeners.get('webglcontextlost')?.({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalled(); // or the browser would not restore it
    expect(renderer?.lost).toBe(true);
    expect(onLost).toHaveBeenCalledOnce();
    gl.calls.length = 0;
    renderer?.render(frame());
    expect(gl.calls).toEqual([]);
    const before = gl.created.length;
    listeners.get('webglcontextrestored')?.({} as Event);
    expect(renderer?.lost).toBe(false);
    expect(onRestored).toHaveBeenCalledOnce();
    expect(gl.created.length).toBeGreaterThan(before);
    // The kept data went straight back up: the edge pairs and the positions.
    expect(gl.named('bufferData').length).toBeGreaterThan(0);
    expect(gl.named('texSubImage2D').length).toBeGreaterThan(0);
  });

  it('stays lost and leaves nothing behind when the rebuild after a restore fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Six programs of two stages each build first; the restore's second program then fails.
    const gl = new FakeGl({ failShader: 12 + 3 });
    const { canvas, listeners } = fakeCanvas(gl.context);
    const onRestored = vi.fn();
    const renderer = createGlFieldRenderer(canvas, { onRestored });
    renderer?.setData(fieldData([4, 4], [0, 1]));
    renderer?.setPositions(Float32Array.from([0, 0, 50, 0]));
    listeners.get('webglcontextlost')?.({ preventDefault: vi.fn() } as unknown as Event);
    const before = gl.created.length;
    listeners.get('webglcontextrestored')?.({} as Event);
    // The context is alive again, so what the failed build made must be deleted in it.
    const rebuilt = gl.created.slice(before);
    expect(rebuilt.length).toBeGreaterThan(0);
    expect(rebuilt.filter((made) => !gl.deleted.has(made))).toEqual([]);
    expect(renderer?.lost).toBe(true);
    expect(onRestored).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    gl.calls.length = 0;
    renderer?.render(frame());
    expect(gl.calls).toEqual([]);
  });

  it('leaves a software WebGL2 to Canvas 2D, unless local storage asks for WebGL2', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const swiftShader =
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
    const software = new FakeGl({ renderer: swiftShader });
    expect(createGlFieldRenderer(fakeCanvas(software.context).canvas)).toBeNull();
    expect(software.loseContext).toHaveBeenCalledOnce();
    expect(software.created).toEqual([]);
    expect(info).toHaveBeenCalledOnce();

    const llvmpipe = new FakeGl({ renderer: 'llvmpipe (LLVM 17.0.6, 256 bits)' });
    expect(createGlFieldRenderer(fakeCanvas(llvmpipe.context).canvas)).toBeNull();

    vi.stubGlobal('window', { localStorage: { getItem: () => 'webgl2' } });
    const asked = new FakeGl({ renderer: swiftShader });
    expect(createGlFieldRenderer(fakeCanvas(asked.context).canvas)?.kind).toBe('webgl2');
  });

  it('keeps WebGL2 on WARP, which outruns the Canvas field there', () => {
    const warp = new FakeGl({
      renderer: 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)',
    });
    expect(createGlFieldRenderer(fakeCanvas(warp.context).canvas)?.kind).toBe('webgl2');
  });
});
