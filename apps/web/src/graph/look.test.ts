import { describe, expect, it } from 'vitest';

import {
  arrival,
  bubbleFaces,
  bubbleFade,
  bubbleShading,
  contrastRatio,
  EDGE_CLASS_WEIGHTS,
  EDGE_LENGTH,
  edgeClass,
  edgeLengthWeight,
  GLOW,
  glowStrength,
  growthAt,
  HALO,
  haloStrength,
  insideInk,
  KALK_RING,
  LIT_EDGE,
  lightAt,
  lightColor,
  lightReach,
  lightStops,
  litColor,
  litCrowd,
  MIN_BUBBLE_PX,
  SEPIA,
  sparkStops,
} from './look.js';
import { luminance, parseColor, type Palette } from './palette.js';
import { NodeFlag, type FieldFrame } from './types.js';

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

describe('growthAt', () => {
  it('starts every bubble at nothing and ends it at its size', () => {
    for (const distance of [0, 0.5, 1]) {
      expect(growthAt(0, distance)).toBeCloseTo(0);
      expect(growthAt(1, distance)).toBe(1);
    }
  });

  it('grows outwards from the centre', () => {
    expect(growthAt(0.3, 0)).toBeGreaterThan(growthAt(0.3, 0.5));
    expect(growthAt(0.3, 1)).toBeCloseTo(0);
  });

  it('springs a little past its size and settles', () => {
    let peak = 0;
    for (let grow = 0; grow <= 1; grow += 0.01) {
      peak = Math.max(peak, growthAt(grow, 0));
    }
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.15);
    expect(growthAt(0.999, 1)).toBeCloseTo(1, 2);
  });
});

describe('the quiet links by length', () => {
  it('strengthens pressed links and fades stretched ones, easing between the reference lengths', () => {
    const { shortFrom, shortTo, longFrom, longTo } = EDGE_LENGTH;
    expect(edgeLengthWeight(10)).toBeCloseTo(1.6);
    expect(edgeLengthWeight(shortFrom)).toBeCloseTo(1.6);
    expect(edgeLengthWeight((shortFrom + shortTo) / 2)).toBeCloseTo(1.3);
    expect(edgeLengthWeight(shortTo)).toBe(1);
    expect(edgeLengthWeight(64)).toBe(1);
    expect(edgeLengthWeight(longFrom)).toBe(1);
    expect(edgeLengthWeight((longFrom + longTo) / 2)).toBeCloseTo(0.75);
    expect(edgeLengthWeight(longTo)).toBeCloseTo(0.5);
    expect(edgeLengthWeight(500)).toBeCloseTo(0.5);
  });

  it('sorts a link into the short, the ordinary or the long class past the middle of each easing', () => {
    expect([10, 38.9, 39, 100, 135, 135.1, 900].map(edgeClass)).toEqual([0, 0, 1, 1, 1, 2, 2]);
    expect(EDGE_CLASS_WEIGHTS).toEqual([1.6, 1, 0.5]);
    // Each class carries the weight its links tend to.
    for (const length of [5, 60, 400]) {
      expect(EDGE_CLASS_WEIGHTS[edgeClass(length)]).toBeCloseTo(edgeLengthWeight(length));
    }
  });
});

describe('the lit links', () => {
  it('burn at full strength up to a crowd, then thin out with the square root', () => {
    expect(litCrowd(1)).toBe(1);
    expect(litCrowd(LIT_EDGE.crowd)).toBe(1);
    expect(litCrowd(LIT_EDGE.crowd * 4)).toBeCloseTo(0.5);
  });

  it('warm the active edge colour towards the glow, never fainter than their minimum', () => {
    const [r, g, b, a] = litColor(palette);
    const active = parseColor(palette.edgeActive);
    const glow = parseColor(palette.glow);
    expect(r).toBeCloseTo(active[0] + (glow[0] - active[0]) * LIT_EDGE.warmth);
    expect(b).toBeLessThan(active[2]); // the glow is warmer: less blue
    expect(g).toBeLessThan(active[1]);
    expect(a).toBe(0.75);
    expect(litColor({ ...palette, edgeActive: 'rgba(35, 32, 28, 0.6)' })[3]).toBe(
      LIT_EDGE.minAlpha,
    );
  });
});

describe('the halos', () => {
  it('reach a fixed distance past the rim on soil, whatever the bubble', () => {
    expect(lightReach('humus', 'halo')).toBe(HALO.px);
    expect(lightReach('humus', 'glow')).toBe(GLOW.px);
    expect(lightAt('humus', 'halo', 0)).toBeCloseTo(HALO.peak.humus);
    expect(lightAt('humus', 'glow', 0)).toBeCloseTo(GLOW.peak.humus);
    expect(lightAt('humus', 'halo', HALO.px)).toBe(0);
    expect(lightAt('humus', 'halo', -1)).toBe(0);
    // Falling off all the way out.
    const samples = [0, 2, 4, 8, 12].map((px) => lightAt('humus', 'halo', px));
    expect(samples.every((value, i) => i === 0 || value < (samples[i - 1] ?? 0))).toBe(true);
  });

  it('are an ink ring a little past the rim on paper', () => {
    expect(lightAt('kalk', 'halo', KALK_RING.at)).toBeCloseTo(HALO.peak.kalk);
    expect(lightAt('kalk', 'halo', 0)).toBeLessThan(0.1);
    expect(lightAt('kalk', 'halo', lightReach('kalk', 'halo'))).toBeLessThan(0.001);
    expect(lightColor(palette, 'kalk', 'halo')).toEqual(parseColor(palette.edge));
    expect(lightColor(palette, 'kalk', 'glow')).toEqual(parseColor(palette.glow));
    expect(lightColor(palette, 'humus', 'halo')).toEqual(parseColor(palette.glow));
  });

  it('lay the light out over the circle past the rim, clear under the bubble', () => {
    const stops = lightStops(palette, 'humus', 'halo', 0.4);
    const first = stops[0];
    const atRim = stops.find((stop) => stop.offset >= 0.4);
    expect(first).toMatchObject({ offset: 0 });
    expect(first?.color[3]).toBe(0);
    expect(atRim?.offset).toBeCloseTo(0.4);
    expect(atRim?.color[3]).toBeCloseTo(HALO.peak.humus);
    expect(stops.at(-1)).toMatchObject({ offset: 1 });
    expect(stops.at(-1)?.color[3]).toBe(0);
    const offsets = stops.map((stop) => stop.offset);
    expect(offsets).toEqual([...offsets].sort((p, q) => p - q));
  });
});

describe('the spark', () => {
  it('is a hot core in a soft halo, whiter at the heart on soil', () => {
    const humus = sparkStops(palette, 'humus');
    const kalk = sparkStops(palette, 'kalk');
    expect(humus[0]?.color[3]).toBe(1);
    expect(humus.at(-1)?.color[3]).toBe(0);
    expect(humus[0]?.color[2]).toBeGreaterThan(kalk[0]?.color[2] ?? 1);
    expect(humus.find((stop) => stop.offset === 0.5)?.color[3]).toBeLessThan(0.2);
  });
});

describe('bubbleFade', () => {
  it('fades a bubble below the smallest size instead of shrinking it', () => {
    expect(bubbleFade(MIN_BUBBLE_PX)).toBe(1);
    expect(bubbleFade(20)).toBe(1);
    expect(bubbleFade(MIN_BUBBLE_PX / 2)).toBeCloseTo(0.25);
    expect(bubbleFade(0)).toBe(0);
    expect(bubbleFade(-1)).toBe(0);
  });
});

describe('haloStrength and glowStrength', () => {
  const hovering = frame({ focusIndex: 0, focusAmount: 1, drawOn: 1 });

  it('lights the hovered and the open note with a halo', () => {
    expect(haloStrength(NodeFlag.hovered | NodeFlag.focus, hovering)).toBe(1);
    expect(haloStrength(NodeFlag.selected, frame())).toBe(HALO.selected);
    expect(haloStrength(NodeFlag.focus, hovering)).toBe(0);
  });

  it("grows the hovered note's halo with the focus, never below the open note's", () => {
    const fading = { ...hovering, focusAmount: 0.4 };
    expect(haloStrength(NodeFlag.hovered | NodeFlag.focus, fading)).toBeCloseTo(0.4);
    expect(haloStrength(NodeFlag.hovered | NodeFlag.focus, { ...hovering, focusAmount: 0 })).toBe(
      0,
    );
    const both = NodeFlag.hovered | NodeFlag.selected | NodeFlag.focus;
    expect(haloStrength(both, fading)).toBe(HALO.selected);
  });

  it('lights a neighbour with a glow only once its link has arrived', () => {
    expect(glowStrength(NodeFlag.focus, 1, { ...hovering, drawOn: 0.5 })).toBe(0);
    expect(glowStrength(NodeFlag.focus, 1, hovering)).toBe(1);
    expect(glowStrength(NodeFlag.focus, 1, { ...hovering, focusAmount: 0.5 })).toBeCloseTo(0.5);
    expect(arrival(0.85)).toBeGreaterThan(0);
    expect(arrival(0.85)).toBeLessThan(1);
    // The hovered and the open note have their halo instead.
    expect(glowStrength(NodeFlag.focus | NodeFlag.hovered, 0, hovering)).toBe(0);
    expect(glowStrength(NodeFlag.focus | NodeFlag.selected, 2, hovering)).toBe(0);
  });

  it('lights nothing for a focused cluster', () => {
    expect(glowStrength(NodeFlag.focus, 1, { ...hovering, clusterFocus: true })).toBe(0);
  });
});

describe('insideInk', () => {
  // The cluster tokens of tokens.css as the palette probe resolves them, on soil and on paper.
  const humus: Palette = {
    ...palette,
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
  };
  const kalk: Palette = {
    ...palette,
    bg: '#f4f1ea',
    glow: '#7d5d16',
    label: '#23201c',
    edge: 'rgba(35, 32, 28, 0.22)',
    clusters: [
      '#5c7a45',
      '#9a7420',
      '#9a4530',
      '#3f6e5c',
      '#b3762e',
      '#7a4f68',
      '#6f7f5a',
      '#6b4f38',
    ],
  };
  const grounds = [
    ['humus', humus],
    ['kalk', kalk],
  ] as const;

  it('reads at 4.5:1 or more on both faces of every slot, on soil and on paper', () => {
    for (const [ground, colours] of grounds) {
      for (const fill of colours.clusters) {
        const ink = luminance(parseColor(insideInk(colours, ground, fill)));
        for (const face of bubbleFaces(colours, ground, parseColor(fill))) {
          expect(
            contrastRatio(ink, luminance(face)),
            `${fill} on ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('judges the face the renderers paint, which is lighter than the token', () => {
    const rust = luminance(parseColor('#b5573b'));
    const light = luminance(parseColor(humus.inkLight));
    const dark = luminance(parseColor(humus.inkDark));
    // On the flat token light ink would win, by a hair.
    expect(contrastRatio(light, rust)).toBeGreaterThan(contrastRatio(dark, rust));
    for (const face of bubbleFaces(humus, 'humus', parseColor('#b5573b'))) {
      expect(luminance(face)).toBeGreaterThan(rust);
    }
    expect(insideInk(humus, 'humus', '#b5573b')).toBe(humus.inkDark);
  });

  it('takes the light ink on a dark bubble', () => {
    for (const [ground, colours] of grounds) {
      expect(insideInk(colours, ground, '#000000')).toBe(colours.inkLight);
    }
  });
});

describe('bubbleShading', () => {
  it('lights a spore from within on soil and washes pigment on paper', () => {
    const humus = bubbleShading(palette, 'humus', 0);
    const kalk = bubbleShading({ ...palette, bg: 'rgb(244, 241, 234)' }, 'kalk', 0);
    expect(humus.specular).not.toBeNull();
    expect(humus.shadow).toBeNull();
    expect(kalk.specular).toBeNull();
    expect(kalk.shadow?.color.slice(0, 3)).toEqual([...SEPIA]); // the WebGL field's shadow too
    for (const shading of [humus, kalk]) {
      const light = shading.body[0]?.color ?? [0, 0, 0, 1];
      const rim = shading.body.at(-1)?.color ?? [1, 1, 1, 1];
      expect(luminance(light)).toBeGreaterThan(luminance(rim)); // darker where it pools
    }
  });
});
