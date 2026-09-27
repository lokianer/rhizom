import { describe, expect, it } from 'vitest';

import {
  LABEL_HALO_PX,
  LabelSprites,
  REGION_FONT_PX,
  createTextMeasure,
  labelFont,
  type SpriteContext,
  type SpriteKey,
} from './label-sprites.js';
import { LABEL_LINE_HEIGHT } from './labels.js';

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

/** Records every call; measures text at half an em per character, from the px in the font. */
class FakeContext implements SpriteContext {
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  lineJoin: CanvasLineJoin = 'miter';
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  readonly calls: Call[] = [];

  setTransform(...args: [number, number, number, number, number, number]): void {
    this.calls.push({ op: 'setTransform', args });
  }

  measureText(text: string): { readonly width: number } {
    this.calls.push({ op: 'measureText', args: [text, this.font] });
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.5 };
  }

  strokeText(text: string, x: number, y: number): void {
    this.calls.push({ op: 'strokeText', args: [text, x, y, this.strokeStyle, this.lineWidth] });
  }

  fillText(text: string, x: number, y: number): void {
    this.calls.push({ op: 'fillText', args: [text, x, y, this.fillStyle, this.font] });
  }
}

class FakeCanvas {
  readonly context = new FakeContext();
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(contextId: '2d'): SpriteContext | null {
    return contextId === '2d' ? this.context : null;
  }
}

function factory(): { canvases: FakeCanvas[]; create: (w: number, h: number) => OffscreenCanvas } {
  const canvases: FakeCanvas[] = [];
  return {
    canvases,
    // The cache only ever calls getContext and sets the size, which the fake does too.
    create: (width, height) => {
      const canvas = new FakeCanvas(width, height);
      canvases.push(canvas);
      return canvas as unknown as OffscreenCanvas;
    },
  };
}

function key(overrides: Partial<SpriteKey> = {}): SpriteKey {
  return {
    lines: ['Rhizomes'],
    fontPx: 13,
    bold: false,
    color: 'rgb(232, 225, 214)',
    halo: 'rgb(20, 17, 15)',
    pixelRatio: 1,
    font: 'ui-sans-serif, system-ui',
    ...overrides,
  };
}

/** The canvases labels were drawn into, leaving out the 1×1 one used for measuring. */
function spriteCanvases(canvases: readonly FakeCanvas[]): FakeCanvas[] {
  return canvases.filter((canvas) => canvas.context.calls.some((call) => call.op === 'fillText'));
}

function ops(canvas: FakeCanvas | undefined, op: string): Call[] {
  return canvas?.context.calls.filter((call) => call.op === op) ?? [];
}

describe('labelFont', () => {
  it('writes the canvas font, semibold for bold', () => {
    expect(labelFont(13, false, 'ui-sans-serif')).toBe('13px ui-sans-serif');
    expect(labelFont(16, true, 'ui-sans-serif')).toBe('600 16px ui-sans-serif');
  });
});

describe('LabelSprites', () => {
  it('draws a label once and hands the same sprite back after that', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const first = sprites.get(key());
    sprites.beginFrame();
    const second = sprites.get(key());
    expect(second).toBe(first);
    expect(spriteCanvases(canvases)).toHaveLength(1);
    expect(sprites.stats).toMatchObject({ entries: 1, created: 1, hits: 1 });
  });

  it('draws at device resolution and reports its size in CSS pixels, centred', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const sprite = sprites.get(key({ pixelRatio: 2 }));
    const [canvas] = spriteCanvases(canvases);
    // 8 characters at 6.5 px, three pixels of room either side; one line of 13 × 1.25.
    expect(canvas?.width).toBe(Math.ceil((8 * 6.5 + 6) * 2));
    expect(canvas?.height).toBe(Math.ceil((13 * LABEL_LINE_HEIGHT + 6) * 2));
    expect(sprite.width).toBe((canvas?.width ?? 0) / 2);
    expect(sprite.height).toBe((canvas?.height ?? 0) / 2);
    expect(sprite.offsetX).toBe(-sprite.width / 2);
    expect(sprite.offsetY).toBe(-sprite.height / 2);
    expect(ops(canvas, 'setTransform')[0]?.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('strokes the halo once, under the glyphs, in the font it measured with', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    sprites.get(key({ bold: true, fontPx: 16 }));
    sprites.beginFrame();
    sprites.get(key({ bold: true, fontPx: 16 }));
    const [canvas] = spriteCanvases(canvases);
    const calls = canvas?.context.calls.map((call) => call.op) ?? [];
    expect(calls.filter((op) => op === 'strokeText')).toHaveLength(1);
    expect(calls.indexOf('strokeText')).toBeLessThan(calls.indexOf('fillText'));
    expect(ops(canvas, 'strokeText')[0]?.args.slice(3)).toEqual(['rgb(20, 17, 15)', LABEL_HALO_PX]);
    expect(ops(canvas, 'fillText')[0]?.args.slice(3)).toEqual([
      'rgb(232, 225, 214)',
      '600 16px ui-sans-serif, system-ui',
    ]);
  });

  it('strokes no halo when the key has none', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    sprites.get(key({ halo: null, color: '#fbf9f4' }));
    const [canvas] = spriteCanvases(canvases);
    expect(ops(canvas, 'strokeText')).toHaveLength(0);
    expect(ops(canvas, 'fillText')[0]?.args[3]).toBe('#fbf9f4');
  });

  it('sets two lines one above the other, around the centre', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const sprite = sprites.get(key({ lines: ['The Sunken Archive of', 'Silverstadt'] }));
    const [canvas] = spriteCanvases(canvases);
    const fills = ops(canvas, 'fillText');
    expect(fills.map((call) => call.args[0])).toEqual(['The Sunken Archive of', 'Silverstadt']);
    const [y0, y1] = fills.map((call) => Number(call.args[2]));
    expect((y1 ?? 0) - (y0 ?? 0)).toBeCloseTo(13 * LABEL_LINE_HEIGHT);
    expect(((y0 ?? 0) + (y1 ?? 0)) / 2).toBeCloseTo(sprite.height / 2);
    expect(fills.every((call) => call.args[1] === sprite.width / 2)).toBe(true);
  });

  it('keeps apart what looks different', () => {
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const base = sprites.get(key());
    const variants = [
      key({ lines: ['Rhizome'] }),
      key({ lines: ['Rhizomes', 'again'] }),
      key({ fontPx: 14 }),
      key({ bold: true }),
      key({ color: '#fbf9f4' }),
      key({ halo: null }),
      key({ pixelRatio: 2 }),
      key({ font: 'serif' }),
    ];
    const seen = new Set([base]);
    for (const variant of variants) {
      seen.add(sprites.get(variant));
    }
    expect(seen.size).toBe(variants.length + 1);
    expect(sprites.get(key())).toBe(base);
  });

  it('keeps no reference to the key, so the caller may reuse one', () => {
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const reused = { ...key(), lines: ['Moss'] as readonly string[] };
    const moss = sprites.get(reused);
    reused.lines = ['Lichen'];
    const lichen = sprites.get(reused);
    reused.lines = ['Moss'];
    expect(sprites.get(reused)).toBe(moss);
    expect(lichen).not.toBe(moss);
  });

  it('evicts the least recently used sprites once the canvases hold too many bytes', () => {
    const { create } = factory();
    // Each 'Note n' sprite is 45 × 23 device pixels: 4,140 bytes. Room for three.
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 13_000 });
    const note = (n: number): SpriteKey => key({ lines: [`Note ${String(n)}`] });
    const first = sprites.get(note(1));
    sprites.beginFrame();
    sprites.get(note(2));
    sprites.beginFrame();
    sprites.get(note(3));
    sprites.beginFrame();
    sprites.get(note(1)); // used again: now the most recent
    sprites.beginFrame();
    sprites.beginFrame();
    sprites.get(note(4));
    expect(sprites.stats).toMatchObject({ entries: 3, evicted: 1 });
    expect(sprites.stats.bytes).toBeLessThanOrEqual(13_000);
    expect(sprites.get(note(1))).toBe(first); // still there: note 2 went instead
    expect(sprites.stats.created).toBe(4);
    sprites.get(note(2));
    expect(sprites.stats.created).toBe(5);
  });

  it('gives an evicted canvas its pixels back at once', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 5_000 });
    sprites.get(key({ lines: ['Note 1'] }));
    sprites.beginFrame();
    sprites.beginFrame();
    sprites.get(key({ lines: ['Note 2'] }));
    const [evicted] = spriteCanvases(canvases);
    expect(evicted?.width).toBe(0);
    expect(evicted?.height).toBe(0);
  });

  it('never evicts what this frame or the last one drew', () => {
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 5_000 });
    sprites.beginFrame();
    for (let n = 0; n < 3; n++) {
      sprites.get(key({ lines: [`Note ${String(n)}`] }));
    }
    sprites.beginFrame();
    sprites.get(key({ lines: ['Note 3'] }));
    // Four sprites, over the budget but within four times it: all of them stay.
    expect(sprites.stats).toMatchObject({ entries: 4, evicted: 0 });
  });

  it('evicts even those past four times the budget', () => {
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 5_000 });
    for (let n = 0; n < 8; n++) {
      sprites.get(key({ lines: [`Note ${String(n)}`] }));
    }
    expect(sprites.stats.bytes).toBeLessThanOrEqual(20_000);
    expect(sprites.stats.evicted).toBeGreaterThan(0);
  });

  // Labels of one look that share a first line hang in a chain off that line. Each of these
  // two-line sprites is 32 × 39 device pixels, 4,992 bytes: two fit a budget of 11,000.
  const chained = (second: string): SpriteKey => key({ lines: ['Note', second] });

  it('unlinks an evicted label from the end and from the middle of its chain', () => {
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 11_000 });
    sprites.get(chained('one'));
    sprites.beginFrame();
    const two = sprites.get(chained('two'));
    sprites.beginFrame();
    // The chain is six → two → one; one is the least recently drawn, at the end of it.
    const six = sprites.get(chained('six'));
    expect(sprites.stats).toMatchObject({ entries: 2, evicted: 1, created: 3 });
    expect(sprites.get(chained('two'))).toBe(two);
    expect(sprites.get(chained('six'))).toBe(six);
    expect(sprites.stats.created).toBe(3);

    // one again, at the head: one → six → two. Then six goes, from the middle of the chain,
    // and two has to stay reachable behind it.
    const one = sprites.get(chained('one'));
    sprites.beginFrame();
    sprites.get(chained('one'));
    sprites.get(chained('two'));
    sprites.beginFrame();
    const ten = sprites.get(chained('ten'));
    expect(sprites.stats).toMatchObject({ entries: 3, evicted: 2, created: 5 });
    expect(sprites.get(chained('two'))).toBe(two);
    expect(sprites.get(chained('one'))).toBe(one);
    expect(sprites.get(chained('ten'))).toBe(ten);
    expect(sprites.stats.created).toBe(5);
    expect(sprites.get(chained('six'))).not.toBe(six);
    expect(sprites.stats.created).toBe(6);
  });

  it('hands the chain on when the label at its head is evicted', () => {
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 11_000 });
    const one = sprites.get(chained('one'));
    sprites.beginFrame();
    const two = sprites.get(chained('two')); // the head now: two → one
    sprites.beginFrame();
    sprites.get(chained('one')); // drawn again, so two is the least recently drawn
    sprites.beginFrame();
    sprites.beginFrame();
    sprites.get(key({ lines: ['Moss'] }));
    expect(sprites.stats).toMatchObject({ entries: 2, evicted: 1, created: 3 });
    expect(sprites.get(chained('one'))).toBe(one);
    expect(sprites.stats.created).toBe(3);
    expect(sprites.get(chained('two'))).not.toBe(two);
    expect(sprites.stats.created).toBe(4);
  });

  // The emptied bucket itself cannot be seen from outside; what can go wrong when it is dropped —
  // the swap with the last bucket losing that bucket — shows as a miss for the other looks.
  it('still finds the labels of the other looks once one look has lost its last label', () => {
    const { canvases, create } = factory();
    // The same first line in three looks, three buckets: 'Moss' in two colours at 13 px (2,944
    // bytes each) and at 16 px (3,952 bytes). Two of them fit the budget, not all three.
    const sprites = new LabelSprites({ createCanvas: create, maxBytes: 7_000 });
    const pale = key({ lines: ['Moss'], color: '#d8d0c0' });
    const dark = key({ lines: ['Moss'], color: '#40382c' });
    const large = key({ lines: ['Moss'], fontPx: 16 });
    const first = sprites.get(pale);
    sprites.beginFrame();
    sprites.beginFrame();
    const second = sprites.get(dark);
    const third = sprites.get(large);
    // The pale look's only label went, two frames old, and its bucket with it: the last bucket
    // took the emptied one's place.
    expect(sprites.stats).toMatchObject({ entries: 2, evicted: 1, created: 3 });
    expect(spriteCanvases(canvases)[0]?.width).toBe(0);
    expect(sprites.get(dark)).toBe(second);
    expect(sprites.get(large)).toBe(third);
    expect(sprites.stats.created).toBe(3);
    // The pale look comes back as a look of its own, drawn afresh.
    expect(sprites.get(pale)).not.toBe(first);
    expect(sprites.stats.created).toBe(4);
    expect(sprites.get(dark)).toBe(second);
    expect(sprites.get(large)).toBe(third);
  });

  it('grows its budget with the pixel ratio, so a dense frame at 2 does not thrash', () => {
    // Three views of 220 labels each, visited in turn as a zoom goes back and forth: at a pixel
    // ratio of 2 each view's sprites hold some 9.7 MB, more than the budget at a ratio of 1.
    const views = [0, 1, 2].map((view) =>
      Array.from({ length: 220 }, (_, n) =>
        key({ lines: [`View ${String(view)} note ${String(n)}`.padEnd(18, '.')], pixelRatio: 2 }),
      ),
    );
    const { create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    for (let round = 0; round < 3; round++) {
      for (const view of views) {
        sprites.beginFrame();
        for (const label of view) {
          sprites.get(label);
        }
      }
    }
    expect(sprites.stats.bytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(sprites.stats).toMatchObject({ created: 660, evicted: 0 });

    // The budget follows the largest ratio since the last clear: at 1 the same bytes are too many.
    const flat = new LabelSprites({ createCanvas: factory().create, maxBytes: 100_000 });
    const wide = (n: number, pixelRatio: number): SpriteKey =>
      key({ lines: [`Note ${String(n)}`.padEnd(18, '.')], pixelRatio });
    for (let n = 0; n < 6; n++) {
      flat.beginFrame();
      flat.beginFrame();
      flat.get(wide(n, 2));
    }
    expect(flat.stats.evicted).toBe(0);
    flat.clear();
    for (let n = 0; n < 12; n++) {
      flat.beginFrame();
      flat.beginFrame();
      flat.get(wide(n, 1));
    }
    expect(flat.stats.evicted).toBeGreaterThan(0);
  });

  it('keeps the milieu names apart from the labels, one sprite per look', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const name = {
      text: 'Research',
      color: 'rgb(220, 200, 150)',
      halo: 'rgb(20, 17, 15)',
      pixelRatio: 2,
      font: 'ui-sans-serif',
    };
    const first = sprites.region(name);
    expect(sprites.region({ ...name })).toBe(first);
    expect(sprites.region({ ...name, color: 'rgb(1, 2, 3)' })).not.toBe(first);
    expect(sprites.region({ ...name, pixelRatio: 1 })).not.toBe(first);
    expect(sprites.stats).toMatchObject({ regions: 3, entries: 0, bytes: 0, created: 0 });
    // Wide enough for the capitals, their tracking and the halo either side.
    expect(first.width).toBeGreaterThan('RESEARCH'.length * REGION_FONT_PX * 0.5);
    expect(first.offsetX).toBe(-first.width / 2);
    const fills = spriteCanvases(canvases)[0]?.context.calls.filter(
      (call) => call.op === 'fillText',
    );
    expect(fills?.map((call) => call.args[4])).toEqual([
      `600 ${String(REGION_FONT_PX)}px ui-sans-serif`,
      `600 ${String(REGION_FONT_PX)}px ui-sans-serif`,
    ]);
  });

  it('keeps no more than a few dozen milieu names, letting the least recently drawn go', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const name = (n: number) => ({
      text: `Milieu ${String(n)}`,
      color: '#ccc',
      halo: '#111',
      pixelRatio: 1,
      font: 'serif',
    });
    const kept = sprites.region(name(0));
    for (let n = 1; n < 40; n++) {
      sprites.beginFrame();
      sprites.region(name(n));
      sprites.region(name(0)); // drawn every frame: never the one to go
    }
    expect(sprites.stats.regions).toBe(32);
    expect(sprites.region(name(0))).toBe(kept);
    const released = spriteCanvases(canvases).filter((canvas) => canvas.width === 0);
    expect(released).toHaveLength(40 - 32);
  });

  it('drops everything on clear and draws afresh afterwards', () => {
    const { canvases, create } = factory();
    const sprites = new LabelSprites({ createCanvas: create });
    const before = sprites.get(key());
    sprites.clear();
    expect(sprites.stats).toMatchObject({ entries: 0, bytes: 0 });
    expect(spriteCanvases(canvases)[0]?.width).toBe(0);
    const after = sprites.get(key());
    expect(after).not.toBe(before);
    expect(sprites.stats.entries).toBe(1);
  });

  it('draws nothing but still answers where the browser gives no context', () => {
    let made = 0;
    const sprites = new LabelSprites({
      createCanvas: (width, height) => {
        made += 1;
        return { width, height, getContext: () => null } as unknown as OffscreenCanvas;
      },
    });
    const sprite = sprites.get(key());
    expect(sprite.width).toBeGreaterThan(0);
    expect(sprites.get(key())).toBe(sprite);
    // One canvas to measure with, asked once, and one per sprite.
    sprites.get(key({ lines: ['Moss'] }));
    sprites.get(key({ lines: ['Lichen'] }));
    expect(made).toBe(1 + 3);
  });
});

describe('createTextMeasure', () => {
  it('measures in the font of the sprites and remembers every width', () => {
    const { canvases, create } = factory();
    const measure = createTextMeasure('ui-sans-serif', create);
    expect(measure('Moss', 16, true)).toBe(4 * 16 * 0.5);
    expect(measure('Moss', 16, true)).toBe(32);
    expect(measure('Moss', 13, false)).toBe(26);
    const calls = ops(canvases[0], 'measureText');
    expect(calls.map((call) => call.args[1])).toEqual([
      '600 16px ui-sans-serif',
      '13px ui-sans-serif',
    ]);
  });

  it('keeps the widths of a half-pixel size apart from those of the next weight', () => {
    const { create } = factory();
    const measure = createTextMeasure('ui-sans-serif', create);
    // 13.5 px regular and 13 px semibold once shared a memo key.
    expect(measure('Moss', 13.5, false)).toBe(27);
    expect(measure('Moss', 13, true)).toBe(26);
  });

  it('estimates where there is no context to measure with', () => {
    const measure = createTextMeasure(
      'ui-sans-serif',
      () => ({ width: 1, height: 1, getContext: () => null }) as unknown as OffscreenCanvas,
    );
    expect(measure('Moss', 10, false)).toBeCloseTo(4 * 10 * 0.55);
  });
});
