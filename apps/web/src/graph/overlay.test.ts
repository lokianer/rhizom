import { describe, expect, it } from 'vitest';

import {
  LabelSprites,
  REGION_ALPHA,
  REGION_FONT_PX,
  REGION_HALO_BLUR_PX,
  REGION_TRACKING_PX,
  type SpriteContext,
} from './label-sprites.js';
import { EMPHASIS_CLEARANCE_PX, PLATE_DOT_R, PLATE_GAP_PX, PLATE_PAD_X } from './labels.js';
import {
  HOVER_RING_PX,
  PLATE_BORDER_PX,
  REGION_ROOM_X_PX,
  REGION_TINT,
  SELECTION_RING_PX,
  SELECTION_RING_REACH_PX,
  TICK_GAP_PX,
  TICK_PX,
  drawOverlay,
  hoverRingRadius,
  plateDotX,
  plateDotY,
  regionBox,
  regionInk,
  reticleStart,
  selectionRingRadius,
} from './overlay.js';
import type { Palette } from './palette.js';
import type { OverlayFrame, PlacedLabel, RegionName } from './types.js';

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
  readonly op: string;
  readonly args: readonly unknown[];
  /** The context state when the call was made. */
  readonly state: Readonly<Record<string, unknown>>;
}

/** A 2D context that records every method call and every property set, with the state at that moment. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    font: '10px sans-serif',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  const ctx = new Proxy(state, {
    get: (target, property) => {
      if (typeof property !== 'string' || property in target) {
        return typeof property === 'string' ? target[property] : undefined;
      }
      return (...args: unknown[]) => {
        calls.push({ op: property, args, state: { ...target } });
      };
    },
    set: (target, property, value: unknown) => {
      if (typeof property === 'string') {
        target[property] = value;
        calls.push({ op: `set ${property}`, args: [value], state: { ...target } });
      }
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** A text call on a sprite canvas, with the state it ran under. */
interface TextCall {
  readonly op: 'fillText' | 'strokeText';
  readonly text: string;
  readonly x: number;
  readonly fillStyle: unknown;
  readonly font: string;
  readonly textAlign: string;
  readonly letterSpacing: string | undefined;
  readonly shadowBlur: number | undefined;
  readonly shadowOffsetX: number | undefined;
}

interface FakeSpriteCanvas {
  width: number;
  height: number;
  readonly strokes: string[];
  readonly texts: TextCall[];
  getContext: (contextId: '2d') => SpriteContext;
}

/**
 * Sprite canvases that record their text calls. Without `letterSpacing` they stand for a browser
 * whose canvas has no tracking.
 */
function spriteFactory(letterSpacing = true): {
  made: FakeSpriteCanvas[];
  create: (width: number, height: number) => OffscreenCanvas;
} {
  const made: FakeSpriteCanvas[] = [];
  return {
    made,
    create: (width, height) => {
      const strokes: string[] = [];
      const texts: TextCall[] = [];
      const record = (op: TextCall['op'], text: string, x: number): void => {
        texts.push({
          op,
          text,
          x,
          fillStyle: context.fillStyle,
          font: context.font,
          textAlign: context.textAlign,
          letterSpacing: context.letterSpacing,
          shadowBlur: context.shadowBlur,
          shadowOffsetX: context.shadowOffsetX,
        });
      };
      const context: SpriteContext = {
        font: '',
        textAlign: 'start',
        textBaseline: 'alphabetic',
        lineJoin: 'miter',
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
        setTransform: () => undefined,
        measureText: (text) => ({ width: text.length * 7 }),
        strokeText: (text, x) => {
          strokes.push(text);
          record('strokeText', text, x);
        },
        fillText: (text, x) => {
          record('fillText', text, x);
        },
      };
      if (letterSpacing) {
        context.letterSpacing = '0px';
      }
      const canvas: FakeSpriteCanvas = {
        width,
        height,
        strokes,
        texts,
        getContext: () => context,
      };
      made.push(canvas);
      return canvas as unknown as OffscreenCanvas;
    },
  };
}

function placed(overrides: Partial<PlacedLabel> = {}): PlacedLabel {
  return {
    index: 0,
    lines: ['Rhizomes'],
    x: 200,
    y: 150,
    fontPx: 13,
    bold: false,
    inside: false,
    plate: false,
    selected: false,
    fill: 'rgb(127, 157, 97)',
    alpha: 1,
    box: { left: 170, top: 140, right: 230, bottom: 160 },
    ...overrides,
  };
}

const plateLabel = placed({
  index: 1,
  lines: ['Home'],
  x: 300,
  y: 250,
  fontPx: 16,
  bold: true,
  plate: true,
  fill: 'rgb(201, 162, 75)',
  box: { left: 275, top: 237, right: 325, bottom: 263 },
});
const insideLabel = placed({ index: 2, lines: ['NPC'], x: 500, y: 100, inside: true, bold: true });
const region: RegionName = {
  text: 'Research',
  x: 400,
  y: 300,
  alpha: 0.8,
  color: 'rgb(201, 162, 75)',
};

function frame(overrides: Partial<OverlayFrame> = {}): OverlayFrame {
  return {
    width: 800,
    height: 600,
    pixelRatio: 2,
    palette,
    ground: 'humus',
    labels: [placed(), plateLabel, insideLabel],
    regions: [region],
    selected: { x: 300, y: 220, r: 10 },
    hovered: { x: 200, y: 130, r: 8 },
    ...overrides,
  };
}

function draw(overrides: Partial<OverlayFrame> = {}, letterSpacing = true) {
  const { ctx, calls } = recorder();
  const { made, create } = spriteFactory(letterSpacing);
  const sprites = new LabelSprites({ createCanvas: create });
  drawOverlay(ctx, frame(overrides), sprites);
  return { ctx, calls, made, sprites };
}

/** The sprite canvases a milieu name was drawn into: those that set it in capitals. */
function regionCanvases(made: readonly FakeSpriteCanvas[]): FakeSpriteCanvas[] {
  return made.filter((canvas) =>
    canvas.texts.some((text) => text.text.replaceAll(' ', '') === 'RESEARCH'),
  );
}

function indexOf(calls: readonly Call[], test: (call: Call) => boolean): number {
  return calls.findIndex(test);
}

describe('drawOverlay', () => {
  it('clears the transparent canvas first, in CSS pixels', () => {
    const { calls } = draw();
    const methods = calls.filter((call) => !call.op.startsWith('set '));
    expect(methods[0]).toMatchObject({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
    expect(methods[1]).toMatchObject({ op: 'clearRect', args: [0, 0, 800, 600] });
  });

  it('paints the region names, then the rings, then the plates, then the sprites', () => {
    const { calls, made } = draw();
    const [name] = regionCanvases(made);
    const regionBlit = indexOf(calls, (call) => call.op === 'drawImage' && call.args[0] === name);
    const firstRing = indexOf(calls, (call) => call.op === 'arc');
    const lastRing = indexOf(
      calls,
      (call) => call.op === 'stroke' && call.state.lineCap === 'round',
    );
    const firstPlate = indexOf(calls, (call) => call.op === 'fill');
    const firstLabel = indexOf(calls, (call) => call.op === 'drawImage' && call.args[0] !== name);
    expect(regionBlit).toBeGreaterThan(-1);
    expect(regionBlit).toBeLessThan(firstRing);
    expect(lastRing).toBeLessThan(firstPlate);
    expect(firstPlate).toBeLessThan(firstLabel);
  });

  it('never sets text on the overlay itself, and draws each name and label only once in all', () => {
    const { ctx, calls, made, sprites } = draw();
    expect(calls.some((call) => call.op === 'strokeText' || call.op === 'fillText')).toBe(false);
    // The ordinary label strokes its halo, the milieu name its soft one; the plate and the name
    // inside a bubble have none.
    expect(made.flatMap((canvas) => canvas.strokes)).toEqual(['RESEARCH', 'Rhizomes']);
    const created = made.length;
    drawOverlay(ctx, frame(), sprites);
    drawOverlay(ctx, frame(), sprites);
    expect(made).toHaveLength(created);
    expect(calls.some((call) => call.op === 'strokeText' || call.op === 'fillText')).toBe(false);
    expect(sprites.stats).toMatchObject({ created: 3, regions: 1 });
  });

  it('blits every sprite at the alpha of its label, on whole device pixels', () => {
    const faint = placed({ index: 3, lines: ['Faint'], x: 100.3, y: 50.7, alpha: 0.35 });
    const { calls, made } = draw({ labels: [faint], regions: [] });
    const blit = calls.find((call) => call.op === 'drawImage');
    expect(blit?.state.globalAlpha).toBe(0.35);
    expect(blit?.args[0]).toBe(made.at(-1));
    const [, x, y] = blit?.args ?? [];
    expect(Number.isInteger(x)).toBe(true);
    expect(Number.isInteger(y)).toBe(true);
    // Drawn 1:1 in device pixels, and the transform put back afterwards.
    const reset = calls.filter((call) => call.op === 'setTransform').map((call) => call.args);
    expect(reset).toContainEqual([1, 0, 0, 1, 0, 0]);
    expect(reset.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('leaves out a label with no alpha, and ends at full alpha', () => {
    const { calls, sprites } = draw({ labels: [placed({ alpha: 0 })], regions: [] });
    expect(calls.some((call) => call.op === 'drawImage')).toBe(false);
    expect(sprites.stats.created).toBe(0);
    expect(calls.at(-1)?.state.globalAlpha).toBe(1);
  });

  it('inks a name inside a bubble in the palette ink and a plate label without a halo', () => {
    const { calls, made } = draw({ labels: [insideLabel, plateLabel], regions: [] });
    expect(calls.filter((call) => call.op === 'drawImage')).toHaveLength(2);
    expect(made.flatMap((canvas) => canvas.strokes)).toEqual([]);
  });

  it('inks a name inside a bubble for the face the bubble shows, not for its token', () => {
    // Rust on soil: light ink wins against the token, but every renderer paints the face much
    // lighter than that, and there dark ink reads.
    const rust = placed({ ...insideLabel, fill: 'rgb(181, 87, 59)' });
    const { made } = draw({ labels: [rust], regions: [] });
    const name = made.flatMap((canvas) => canvas.texts).find((call) => call.text === 'NPC');
    expect(name?.fillStyle).toBe(palette.inkDark);
  });

  it('puts each plate under its label, filled, bordered and rounded', () => {
    const { calls } = draw({ labels: [plateLabel], regions: [], hovered: null, selected: null });
    const fill = calls.find((call) => call.op === 'fill');
    expect(fill?.state.fillStyle).toBe(palette.plate);
    expect(fill?.state.shadowBlur).toBeGreaterThan(0);
    const border = calls.find((call) => call.op === 'stroke');
    expect(border?.state.lineWidth).toBe(PLATE_BORDER_PX);
    expect(border?.state.strokeStyle).toBe(palette.edge);
    expect(border?.state.shadowBlur).toBe(0);
    // Round ends: four quarter arcs of half the plate's height.
    const arcs = calls.filter((call) => call.op === 'arc').slice(0, 4);
    expect(arcs.map((call) => call.args[2])).toEqual([13, 13, 13, 13]);
  });

  it('dots the plate in the cluster colour, before the name and level with its first line', () => {
    const twoLines = placed({
      ...plateLabel,
      lines: ['The Sunken Archive of', 'Silverstadt'],
      box: { left: 200, top: 225, right: 400, bottom: 275 },
    });
    const { calls } = draw({ labels: [twoLines], regions: [], hovered: null, selected: null });
    const fills = calls.filter((call) => call.op === 'fill');
    expect(fills).toHaveLength(2);
    expect(fills[1]?.state.fillStyle).toBe(plateLabel.fill);
    expect(fills[1]?.state.shadowBlur).toBe(0);
    const dot = calls.filter((call) => call.op === 'arc').at(-1);
    const lineHeight = 16 * 1.25;
    expect(dot?.args.slice(0, 3)).toEqual([
      200 + PLATE_PAD_X + PLATE_DOT_R,
      250 - lineHeight / 2,
      4,
    ]);
    expect(plateDotX(twoLines)).toBe(200 + PLATE_PAD_X + PLATE_DOT_R);
    expect(plateDotY(plateLabel)).toBe(250);
  });

  it("borders the open note's plate in the accent", () => {
    const open = placed({ ...plateLabel, selected: true });
    const { calls } = draw({ labels: [open], regions: [], hovered: null, selected: null });
    const border = calls.find((call) => call.op === 'stroke');
    expect(border?.state.strokeStyle).toBe(palette.accent);
  });

  it('draws no plate for a label that has none', () => {
    const { calls } = draw({ labels: [placed()], regions: [], hovered: null, selected: null });
    expect(calls.some((call) => call.op === 'fill')).toBe(false);
  });

  it('rings the hovered note thinly and the open one in the accent, with four ticks', () => {
    const { calls } = draw({ labels: [], regions: [] });
    const strokes = calls.filter((call) => call.op === 'stroke');
    expect(strokes[0]?.state).toMatchObject({
      strokeStyle: palette.edgeActive,
      lineWidth: HOVER_RING_PX,
    });
    // The gap between the open note and its ring is laid in ground first, then the ring.
    expect(strokes[1]?.state).toMatchObject({ strokeStyle: palette.bg });
    expect(strokes[2]?.state).toMatchObject({
      strokeStyle: palette.accent,
      lineWidth: SELECTION_RING_PX,
    });
    expect(strokes[3]?.state).toMatchObject({ strokeStyle: palette.accent, lineCap: 'round' });
    const arcs = calls.filter((call) => call.op === 'arc');
    expect(arcs[0]?.args.slice(0, 3)).toEqual([200, 130, hoverRingRadius(8)]);
    expect(arcs[2]?.args.slice(0, 3)).toEqual([300, 220, selectionRingRadius(10)]);
    // The right-hand tick starts a gap outside the ring's stroke and runs TICK_PX outwards.
    const tick = selectionRingRadius(10) + SELECTION_RING_PX / 2 + TICK_GAP_PX;
    expect(reticleStart(10)).toBe(tick);
    const moves = calls.filter((call) => call.op === 'moveTo');
    expect(moves).toHaveLength(4);
    expect(moves[0]?.args).toEqual([300 + tick, 220]);
    expect(calls.find((call) => call.op === 'lineTo')?.args).toEqual([300 + tick + TICK_PX, 220]);
    expect(calls.at(-1)?.state.lineCap).toBe('butt');
  });

  it('sets the rings a little outside the rim', () => {
    expect(hoverRingRadius(8) - HOVER_RING_PX / 2).toBeGreaterThan(8);
    expect(selectionRingRadius(10) - SELECTION_RING_PX / 2).toBeGreaterThanOrEqual(10 + 3);
    expect(selectionRingRadius(10) + SELECTION_RING_PX / 2).toBe(10 + SELECTION_RING_REACH_PX);
  });

  it('draws only the selection ring when the open note is the one under the pointer', () => {
    const ring = { x: 300, y: 220, r: 10 };
    const { calls } = draw({ labels: [], regions: [], hovered: ring, selected: ring });
    // The ground in the gap and the ring itself: no hover ring on top of them.
    const arcs = calls.filter((call) => call.op === 'arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[1]?.args.slice(0, 3)).toEqual([300, 220, selectionRingRadius(10)]);
  });

  it('keeps the plates clear of the selection ring', () => {
    expect(SELECTION_RING_REACH_PX).toBeLessThan(PLATE_GAP_PX);
  });

  it('hides the reticle tick on the plate side under the plate, round cap and all', () => {
    // The tick starts a gap outside the ring's stroke; its round cap reaches half a stroke back.
    const tickStart = reticleStart(0) - SELECTION_RING_PX / 2;
    expect(PLATE_GAP_PX).toBeLessThanOrEqual(tickStart);
  });

  it('keeps the other labels clear of the whole reticle', () => {
    const tickEnd = reticleStart(0) + TICK_PX + SELECTION_RING_PX / 2;
    expect(EMPHASIS_CLEARANCE_PX).toBeGreaterThanOrEqual(tickEnd);
  });

  it('sets a region name once into a sprite: tracked semibold capitals over a soft halo', () => {
    const { made } = draw({ labels: [], hovered: null, selected: null });
    const [canvas] = regionCanvases(made);
    const [haloStroke, haloFill, ink] = canvas?.texts ?? [];
    expect(canvas?.texts).toHaveLength(3);
    for (const text of [haloStroke, haloFill, ink]) {
      expect(text?.text).toBe('RESEARCH');
      expect(text?.font).toBe(`600 ${String(REGION_FONT_PX)}px ${palette.fontSans}`);
      expect(text?.letterSpacing).toBe(`${String(REGION_TRACKING_PX)}px`);
    }
    // The halo: the capitals set off the sprite, only their blurred shadow landing on it.
    expect(haloFill).toMatchObject({ op: 'fillText', fillStyle: palette.labelHalo });
    expect(haloFill?.shadowBlur).toBe(REGION_HALO_BLUR_PX * 2);
    expect(haloFill?.x).toBeLessThan(0);
    expect((haloFill?.x ?? 0) + (haloFill?.shadowOffsetX ?? 0) / 2).toBe(ink?.x);
    // The ink, sharp, on top.
    expect(ink).toMatchObject({ op: 'fillText', shadowBlur: 0, textAlign: 'left' });
    expect(ink?.fillStyle).toBe(regionInk(region.color, palette.label));
  });

  it('blits a region name at its alpha, a little short of full, centred on its anchor', () => {
    const { calls, made } = draw({ labels: [], hovered: null, selected: null });
    const [canvas] = regionCanvases(made);
    const blit = calls.find((call) => call.op === 'drawImage');
    expect(blit?.args[0]).toBe(canvas);
    expect(blit?.state.globalAlpha).toBeCloseTo(0.8 * REGION_ALPHA);
    const [, x, y] = blit?.args as number[];
    // The sprite is centred on the ink, whole device pixels at a ratio of 2.
    expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    expect(Math.abs((x ?? 0) + (canvas?.width ?? 0) / 2 - 800)).toBeLessThanOrEqual(1);
    expect(Math.abs((y ?? 0) + (canvas?.height ?? 0) / 2 - 600)).toBeLessThanOrEqual(1);
  });

  it('keeps a region sprite across frames and draws a new one for a new pixel ratio', () => {
    const { ctx, made, sprites } = draw({ labels: [], hovered: null, selected: null });
    drawOverlay(ctx, frame({ labels: [], hovered: null, selected: null }), sprites);
    expect(regionCanvases(made)).toHaveLength(1);
    drawOverlay(ctx, frame({ labels: [], pixelRatio: 1 }), sprites);
    expect(regionCanvases(made)).toHaveLength(2);
    sprites.clear();
    expect(sprites.stats.regions).toBe(0);
    expect(regionCanvases(made).every((canvas) => canvas.width === 0)).toBe(true);
  });

  it('tints a region name from its cluster colour well towards the label colour', () => {
    const ink = regionInk(region.color, palette.label);
    const channels = /rgb\((\d+), (\d+), (\d+)\)/.exec(ink);
    const [r, g, b] = (channels ?? []).slice(1).map(Number);
    // Past the middle between ochre (201, 162, 75) and the label colour (232, 225, 214).
    expect(r).toBeGreaterThan((201 + 232) / 2);
    expect(r).toBeLessThan(232);
    expect(g).toBeGreaterThan((162 + 225) / 2);
    expect(b).toBeGreaterThan((75 + 214) / 2);
    expect(b).toBeLessThan(214);
  });

  it('spaces the letters out itself where the canvas has no tracking', () => {
    const { made } = draw({ labels: [], hovered: null, selected: null }, false);
    const ink = regionCanvases(made)[0]?.texts.at(-1);
    expect(ink?.text).toBe('R E S E A R C H');
    expect(ink?.textAlign).toBe('center');
    expect(ink?.letterSpacing).toBeUndefined();
  });

  it('leaves out a region name with no alpha', () => {
    const { calls, made } = draw({ labels: [], regions: [{ ...region, alpha: 0 }] });
    expect(calls.some((call) => call.op === 'drawImage')).toBe(false);
    expect(regionCanvases(made)).toHaveLength(0);
  });

  it('sets nothing smaller than 13 px and nothing in italic', () => {
    const { made } = draw();
    const fonts = made.flatMap((canvas) => canvas.texts.map((text) => text.font));
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      expect(Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1])).toBeGreaterThanOrEqual(13);
      expect(font).not.toContain('italic');
    }
  });

  it('only clears an empty frame', () => {
    const { calls } = draw({ width: 0 });
    expect(calls.filter((call) => !call.op.startsWith('set ')).map((call) => call.op)).toEqual([
      'setTransform',
      'clearRect',
    ]);
  });
});

describe('regionBox', () => {
  const measure = (text: string, fontPx: number, bold: boolean): number =>
    text.length * fontPx * (bold ? 0.6 : 0.5);

  it('covers the tracked capitals and the room of their halo, centred on the name', () => {
    const box = regionBox(region, measure);
    // Eight capitals, tracked seven times: the tracking after the last letter is no ink.
    const ink = 'RESEARCH'.length * REGION_FONT_PX * 0.6 + 7 * REGION_TRACKING_PX;
    expect(box.right - box.left).toBeCloseTo(ink + 2 * REGION_ROOM_X_PX);
    expect(box.bottom - box.top).toBeGreaterThan(REGION_FONT_PX);
    expect(box.bottom - box.top).toBeLessThan(REGION_FONT_PX * 2);
    expect((box.left + box.right) / 2).toBeCloseTo(400);
    expect((box.top + box.bottom) / 2).toBeCloseTo(300);
  });

  it('keeps a label beside a name clear of the whole halo, so the two do not read as one line', () => {
    // A label's own box ends two pixels past its ink; together that is well over a word space.
    expect(REGION_ROOM_X_PX).toBeGreaterThan(REGION_HALO_BLUR_PX);
    expect(REGION_ROOM_X_PX + 2).toBeGreaterThanOrEqual(REGION_FONT_PX * 0.75);
  });

  it('counts a letter outside the basic plane once', () => {
    const plain = regionBox({ ...region, text: 'ab' }, () => 20);
    const astral = regionBox({ ...region, text: 'a\u{1d4b7}' }, () => 20);
    expect(astral.right - astral.left).toBeCloseTo(plain.right - plain.left);
  });
});

describe('regionInk', () => {
  it('moves the cluster colour well over towards the label colour', () => {
    const grey = String(Math.round(REGION_TINT * 255));
    expect(regionInk('#000000', '#ffffff')).toBe(`rgb(${grey}, ${grey}, ${grey})`);
    expect(regionInk('rgb(201, 162, 75)', 'rgb(201, 162, 75)')).toBe('rgb(201, 162, 75)');
  });

  it('follows a change of the label colour', () => {
    const grey = String(Math.round(REGION_TINT * 255));
    expect(regionInk('#000000', '#ffffff')).toBe(`rgb(${grey}, ${grey}, ${grey})`);
    expect(regionInk('#000000', '#000000')).toBe('rgb(0, 0, 0)');
  });
});
