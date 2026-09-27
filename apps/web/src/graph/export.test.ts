import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOWNLOAD_URL_LIFETIME_MS,
  downloadBlob,
  escapeXml,
  sceneToPng,
  sceneToSvg,
  type ExportScene,
} from './export.js';
import { edgeControl, quadraticPoint } from './geometry.js';
import {
  LABEL_HALO_PX,
  REGION_ALPHA,
  REGION_FONT_PX,
  REGION_HALO_STROKE_PX,
  REGION_TRACKING_PX,
} from './label-sprites.js';
import { LABEL_LINE_HEIGHT, PLATE_DOT_R, PLATE_PAD_X } from './labels.js';
import {
  EDGE_CLASS_WEIGHTS,
  FOCUS_SINK,
  HALO,
  LIT_EDGE,
  LIT_GLOW,
  litColor,
  QUIET_EDGE_SINK,
  SELECTED_EDGE,
} from './look.js';
import {
  HOVER_RING_PX,
  hoverRingRadius,
  regionInk,
  SELECTION_RING_PX,
  selectionRingRadius,
  TICK_GAP_PX,
  TICK_PX,
} from './overlay.js';
import { parseColor, type Palette, type Rgba } from './palette.js';
import {
  NodeFlag,
  type FieldData,
  type FieldFrame,
  type FieldRenderer,
  type OverlayFrame,
  type PlacedLabel,
  type RendererFactory,
} from './types.js';

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
  fontSans: `ui-sans-serif, "Segoe UI", system-ui`,
};

/** Three bubbles: 0 alone in slot 0, 1 and 2 in slot 1, which is large enough for land. */
const data: FieldData = {
  nodes: {
    count: 3,
    radius: Float32Array.of(10, 10, 10),
    slot: Uint8Array.of(0, 1, 1),
    degree: Float32Array.of(1, 2, 1),
    territory: Uint8Array.of(0, 1, 1),
  },
  edges: Uint32Array.of(0, 1, 1, 2),
};
const positions = Float32Array.of(0, 0, 40, 30, 80, 0);

function fieldFrame(overrides: Partial<FieldFrame> = {}): FieldFrame {
  return {
    transform: { k: 1, x: 0, y: 0 },
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
    edgeDensity: 1,
    territory: 0,
    ...overrides,
  };
}

function overlayFrame(overrides: Partial<OverlayFrame> = {}): OverlayFrame {
  return {
    width: 400,
    height: 300,
    pixelRatio: 1,
    palette,
    ground: 'humus',
    labels: [],
    regions: [],
    selected: null,
    hovered: null,
    ...overrides,
  };
}

function label(overrides: Partial<PlacedLabel> = {}): PlacedLabel {
  return {
    index: 1,
    lines: ['Beta'],
    x: 40,
    y: 50,
    fontPx: 13,
    bold: false,
    inside: false,
    plate: false,
    selected: false,
    fill: 'rgb(127, 157, 97)',
    alpha: 1,
    box: { left: 20, top: 42, right: 60, bottom: 58 },
    ...overrides,
  };
}

interface SceneParts {
  frame?: Partial<FieldFrame>;
  overlay?: Partial<OverlayFrame>;
  states?: Uint8Array;
  data?: FieldData;
  positions?: Float32Array;
}

function scene(parts: SceneParts = {}): ExportScene {
  return {
    frame: fieldFrame(parts.frame),
    data: parts.data ?? data,
    positions: parts.positions ?? positions,
    states: parts.states ?? new Uint8Array(3),
    overlay: overlayFrame(parts.overlay),
  };
}

const n = (value: number): string => String(Math.round(value * 100) / 100);
const f = (value: number): string => String(Math.round(value * 1000) / 1000);

/** A resolved colour as the SVG writes it: plain rgb, the alpha left to an opacity. */
function paintOf(color: string | Rgba): string {
  const rgba = typeof color === 'string' ? parseColor(color) : color;
  const [r, g, b] = rgba.map((channel) => Math.round(channel * 255));
  return `rgb(${String(r)},${String(g)},${String(b)})`;
}

/** The path data the shader's curve gives for link a–b, drawn from `from`. */
function curve(a: number, b: number, from = a): string {
  const ax = positions[a * 2] ?? 0;
  const ay = positions[a * 2 + 1] ?? 0;
  const bx = positions[b * 2] ?? 0;
  const by = positions[b * 2 + 1] ?? 0;
  const [cx, cy] = edgeControl(a, ax, ay, b, bx, by);
  return from === b
    ? `M${n(bx)} ${n(by)}Q${n(cx)} ${n(cy)} ${n(ax)} ${n(ay)}`
    : `M${n(ax)} ${n(ay)}Q${n(cx)} ${n(cy)} ${n(bx)} ${n(by)}`;
}

/** The markup inside the element that `marker` opens, up to its matching close. */
function inside(svg: string, marker: string): string {
  const start = svg.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  const tags = /<(\/?)g\b[^>]*?(\/?)>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(svg); match !== null; match = tags.exec(svg)) {
    if (match[2] === '/') {
      continue;
    }
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      return svg.slice(start + marker.length, match.index);
    }
  }
  return svg.slice(start + marker.length);
}

describe('sceneToSvg', () => {
  it('writes a standalone document at the size of the view', () => {
    const svg = sceneToSvg(scene());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg).toContain('width="400" height="300" viewBox="0 0 400 300"');
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('<rect width="100%" height="100%" fill="rgb(20,17,15)"/>');
  });

  it('carries resolved colours as plain rgb with an opacity, never a token or rgba', () => {
    const svg = sceneToSvg(scene({ frame: { selectedIndex: 0 } }));
    expect(svg).not.toContain('var(--rz');
    expect(svg).not.toContain('light-dark(');
    expect(svg).not.toContain('rgba(');
  });

  it('is deterministic', () => {
    const parts: SceneParts = { frame: { territory: 1, focusIndex: 1, focusAmount: 0.5 } };
    expect(sceneToSvg(scene(parts))).toBe(sceneToSvg(scene(parts)));
  });

  it('applies the view transform once, around the whole field', () => {
    const svg = sceneToSvg(scene({ frame: { transform: { k: 1.5, x: 20, y: -5 } } }));
    expect(svg).toContain('<g transform="translate(20,-5) scale(1.5)">');
    expect(svg.match(/transform=/g)).toHaveLength(1);
  });

  it('draws every quiet link as the curve the shader draws, in one path a pixel wide', () => {
    const svg = sceneToSvg(scene({ frame: { edgeDensity: 0.5 } }));
    expect(curve(0, 1)).toBe('M0 0Q17 19 40 30');
    expect(svg).toContain(
      `<path d="${curve(0, 1)}${curve(1, 2)}" fill="none" stroke="rgb(236,229,218)" ` +
        'stroke-opacity="0.16" stroke-width="1"/>',
    );
    const zoomed = sceneToSvg(scene({ frame: { transform: { k: 4, x: 0, y: 0 } } }));
    expect(zoomed).toContain('stroke-width="0.25"');
  });

  it('shades the bubbles with one radial gradient per palette slot and ground', () => {
    const humus = sceneToSvg(scene());
    expect(humus).toContain('<radialGradient id="rz-bubble-humus-0" ');
    expect(humus).toContain('<radialGradient id="rz-bubble-humus-1" ');
    expect(humus).toContain('<radialGradient id="rz-specular">');
    expect(humus).not.toContain('rz-bubble-kalk');
    expect(humus).not.toContain('rz-shadow');

    const kalk = sceneToSvg(
      scene({ frame: { ground: 'kalk', palette: { ...palette, bg: 'rgb(244, 241, 234)' } } }),
    );
    expect(kalk).toContain('<radialGradient id="rz-bubble-kalk-0" ');
    expect(kalk).toContain('<radialGradient id="rz-shadow">');
    expect(kalk).not.toContain('rz-specular');
  });

  it('groups the bubbles by slot, each body whole and its rim a ring of its own just inside it', () => {
    const svg = sceneToSvg(scene());
    const marker = '<g fill="url(#rz-bubble-humus-1)" stroke="rgb(';
    const slot1 = inside(svg, marker);
    // The group's stroke is the rim's, kept off the bodies by a width of 0.
    expect(svg).toMatch(
      /<g fill="url\(#rz-bubble-humus-1\)" stroke="rgb\(\d+,\d+,\d+\)" stroke-opacity="0\.32" stroke-width="0">/,
    );
    expect(slot1.match(/<circle /g)).toHaveLength(4);
    // Body, then its rim: the next bubble covers both where they overlap.
    expect(slot1).toContain(
      '<circle cx="40" cy="30" r="10"/><circle cx="40" cy="30" r="9.63" fill="none" stroke-width="0.75"/>',
    );
    expect(slot1).toContain(
      '<circle cx="80" cy="0" r="10"/><circle cx="80" cy="0" r="9.63" fill="none" stroke-width="0.75"/>',
    );
    expect(inside(svg, '<g fill="url(#rz-bubble-humus-0)"')).toContain('cx="0" cy="0"');
  });

  it('draws the bubbles at the symbol scale, and fades those below the least size', () => {
    const small = sceneToSvg(scene({ frame: { symbolScale: 0.5 } }));
    expect(small).toContain(
      '<circle cx="0" cy="0" r="5"/><circle cx="0" cy="0" r="4.63" fill="none" stroke-width="0.75"/>',
    );
    // 10 units at a zoom of 0.01 is a tenth of a pixel: drawn at the least size, faded.
    const far = sceneToSvg(scene({ frame: { transform: { k: 0.01, x: 200, y: 150 } } }));
    expect(far).toContain(`<circle cx="0" cy="0" r="80" opacity="${f((0.1 / 0.8) ** 2)}"/>`);
    const farther = sceneToSvg(scene({ frame: { transform: { k: 0.005, x: 200, y: 150 } } }));
    expect(farther).not.toContain('cx="0" cy="0"');
  });

  it('strokes long links fainter than short ones, a path per length class', () => {
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
    // A short link (20), an ordinary one (60) and a long one (300).
    const svg = sceneToSvg(
      scene({
        data: spread,
        positions: Float32Array.of(10, 10, 30, 10, 90, 10, 390, 10),
        states: new Uint8Array(4),
        frame: { edgeDensity: 0.5 },
      }),
    );
    const opacities = [
      ...svg.matchAll(
        /<path d="[^"]*" fill="none" stroke="rgb\(236,229,218\)" stroke-opacity="([\d.]+)"/g,
      ),
    ].map((match) => Number(match[1]));
    expect(opacities).toEqual(EDGE_CLASS_WEIGHTS.map((weight) => Number(f(0.32 * 0.5 * weight))));
  });

  it('sinks everything outside the focus under one opacity and lays the focus over it', () => {
    const states = Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 0, 0);
    const svg = sceneToSvg(scene({ states, frame: { focusIndex: 0, focusAmount: 1 } }));
    const remaining = String(Math.round((1 - FOCUS_SINK.humus) * 1000) / 1000);
    const marker = `<g opacity="${remaining}">`;
    const sunk = inside(svg, marker);
    expect(sunk).toContain('cx="40" cy="30"');
    expect(sunk).toContain('cx="80" cy="0"');
    expect(sunk).not.toContain('cx="0" cy="0"');
    const after = svg.slice(svg.indexOf(marker) + marker.length + sunk.length);
    expect(after).toContain('<g fill="url(#rz-bubble-humus-0)"');
    // The web sinks a step further than the bubbles.
    expect(svg).toContain(`stroke-opacity="${f(0.32 * (1 - QUIET_EDGE_SINK))}"`);
    // The hovered bubble's halo lies under it, reaching as far past the rim as on screen: its
    // gradient is clear over the 10 of its 26 units the bubble covers.
    expect(svg).toContain('<circle cx="0" cy="0" r="26" fill="url(#rz-halo-385)"/>');
    expect(svg).toContain('<radialGradient id="rz-halo-385">');
    expect(svg.indexOf('fill="url(#rz-halo-385)"')).toBeLessThan(
      svg.indexOf('<g fill="url(#rz-bubble-humus-0)"'),
    );
  });

  it("strokes the open note's own links in the accent colour", () => {
    const svg = sceneToSvg(scene({ frame: { selectedIndex: 0 } }));
    expect(svg).toContain(
      `<path d="${curve(0, 1)}" fill="none" stroke="rgb(221,184,95)" ` +
        `stroke-opacity="${String(SELECTED_EDGE.alpha.humus)}" ` +
        `stroke-width="${String(SELECTED_EDGE.px)}" stroke-linecap="round"/>`,
    );
    const kalk = sceneToSvg(scene({ frame: { selectedIndex: 0, ground: 'kalk' } }));
    expect(kalk).toContain(`stroke-opacity="${String(SELECTED_EDGE.alpha.kalk)}"`);
  });

  it('keeps the open note above the soil when the focus leaves it out, its links a little fainter', () => {
    const states = Uint8Array.of(NodeFlag.focus | NodeFlag.hovered, 0, NodeFlag.selected);
    const svg = sceneToSvg(
      scene({ states, frame: { focusIndex: 0, focusAmount: 1, drawOn: 1, selectedIndex: 2 } }),
    );
    const remaining = String(Math.round((1 - FOCUS_SINK.humus) * 1000) / 1000);
    const marker = `<g opacity="${remaining}">`;
    const sunk = inside(svg, marker);
    expect(sunk).toContain('cx="40" cy="30"');
    expect(sunk).not.toContain('cx="80" cy="0"');
    const after = svg.slice(svg.indexOf(marker) + marker.length + sunk.length);
    expect(after).toContain('<circle cx="80" cy="0" r="9.63"');
    // Its halo lies under it, with the hovered note's.
    expect(svg.match(/fill="url\(#rz-halo-\d+\)"/g)).toHaveLength(2);
    expect(svg).toContain(
      `<circle cx="80" cy="0" r="26" fill="url(#rz-halo-385)" opacity="${String(HALO.selected)}"/>`,
    );
    const alpha = Math.round(SELECTED_EDGE.alpha.humus * (1 - SELECTED_EDGE.sink) * 1000);
    expect(svg).toContain(
      `<path d="${curve(1, 2, 2)}" fill="none" stroke="rgb(221,184,95)" ` +
        `stroke-opacity="${String(alpha / 1000)}"`,
    );
  });

  it('lights every link inside a focused cluster, whole and without sparks', () => {
    const states = Uint8Array.of(0, NodeFlag.focus, NodeFlag.focus);
    const svg = sceneToSvg(
      scene({ states, frame: { clusterFocus: true, focusAmount: 1, drawOn: 1 } }),
    );
    expect(svg).toContain(
      `<path d="${curve(1, 2)}" fill="none" stroke="${paintOf(litColor(palette))}" ` +
        `stroke-opacity="0.75" stroke-width="${String(LIT_EDGE.px)}" stroke-linecap="round"/>`,
    );
    expect(svg).not.toContain('rz-spark');
    expect(svg).not.toContain('rz-halo'); // a focused cluster lights no halos
    expect(svg).not.toContain('rz-glow');
  });

  it('draws the lit links out from the hovered note as far as they have got, sparks at the tips', () => {
    const states = Uint8Array.of(NodeFlag.focus, NodeFlag.focus | NodeFlag.hovered, NodeFlag.focus);
    const svg = sceneToSvg(
      scene({ states, frame: { focusIndex: 1, focusAmount: 1, drawOn: 0.5 } }),
    );
    // Link 0–1 drawn from 1: the first half of the reversed curve.
    const [cx, cy] = edgeControl(0, 0, 0, 1, 40, 30);
    const [ex, ey] = quadraticPoint(40, 30, cx, cy, 0, 0, 0.5);
    const half = `M40 30Q${n(40 + (cx - 40) * 0.5)} ${n(30 + (cy - 30) * 0.5)} ${n(ex)} ${n(ey)}`;
    expect(svg).toContain(`<path d="${half}`);
    expect(svg).toContain(
      `stroke="rgb(243,223,176)" stroke-opacity="${String(LIT_GLOW.alpha)}" ` +
        `stroke-width="${String(LIT_GLOW.px)}"`,
    );
    expect(svg).toContain('<radialGradient id="rz-spark">');
    expect(inside(svg, '<g fill="url(#rz-spark)"').match(/<circle /g)).toHaveLength(2);
    // The neighbours light up only once their links have arrived.
    expect(svg).not.toContain('rz-glow');

    const arrived = sceneToSvg(
      scene({ states, frame: { focusIndex: 1, focusAmount: 1, drawOn: 1 } }),
    );
    expect(arrived).toContain(`<path d="M40 30Q${n(cx)} ${n(cy)} 0 0`);
    expect(arrived).not.toContain('rz-spark');
    // A glow round each neighbour, shorter than the hovered note's halo: 10 of 20 units.
    expect(arrived.match(/fill="url\(#rz-glow-500\)"/g)).toHaveLength(2);
  });

  it('washes territories over the notes of large clusters only, blurred', () => {
    const svg = sceneToSvg(scene({ frame: { territory: 1 } }));
    expect(svg).toContain('<filter id="rz-territory" ');
    expect(svg).toContain('<feGaussianBlur ');
    const land = inside(svg, '<g filter="url(#rz-territory)"');
    expect(land.match(/<circle /g)).toHaveLength(2);
    expect(land).not.toContain('cx="0" cy="0"');
    expect(svg).toContain('opacity="0.16" fill="rgb(201,162,75)"');
    expect(sceneToSvg(scene())).not.toContain('rz-territory');
  });

  it('leaves out what lies outside the view, but not a link that leaves it', () => {
    const wide: FieldData = {
      nodes: {
        count: 5,
        radius: Float32Array.of(10, 10, 10, 10, 10),
        slot: Uint8Array.of(0, 1, 1, 0, 0),
        degree: Float32Array.of(1, 2, 2, 2, 1),
        territory: Uint8Array.of(0, 0, 0, 0, 0),
      },
      edges: Uint32Array.of(0, 1, 1, 2, 2, 3, 3, 4),
    };
    const svg = sceneToSvg(
      scene({
        data: wide,
        positions: Float32Array.of(0, 0, 40, 30, 80, 0, 5000, 5000, 6000, 5000),
      }),
    );
    expect(svg).toContain(' 5000 5000"'); // the link from 2 runs off the screen
    expect(svg).not.toContain('cx="5000"');
    expect(svg).not.toContain('6000');
  });

  it('sets the milieu names as the overlay does: tracked capitals in their ink over a shore', () => {
    const svg = sceneToSvg(
      scene({
        overlay: {
          regions: [{ text: 'Lore & legends', x: 200, y: 100, alpha: 0.6, color: '#c9a24b' }],
        },
      }),
    );
    const ink = paintOf(regionInk('#c9a24b', palette.label));
    expect(svg).toContain(`font-size="${String(REGION_FONT_PX)}" font-weight="600"`);
    expect(svg).toContain(`letter-spacing="${n(REGION_TRACKING_PX)}"`);
    expect(svg).toContain('<filter id="rz-region-halo" ');
    // Tracking trails the last letter; half of it moves the name back onto its centre.
    const x = n(200 + REGION_TRACKING_PX / 2);
    // A little short of full strength, as on screen.
    const alpha = f(0.6 * REGION_ALPHA);
    expect(svg).toContain(
      `<g filter="url(#rz-region-halo)" fill="rgb(20,17,15)" stroke="rgb(20,17,15)" ` +
        `stroke-width="${String(REGION_HALO_STROKE_PX)}" stroke-linejoin="round">` +
        `<text x="${x}" y="100" opacity="${alpha}">LORE &amp; LEGENDS</text></g>`,
    );
    expect(svg).toContain(
      `<text x="${x}" y="100" fill="${ink}" opacity="${alpha}">LORE &amp; LEGENDS</text>`,
    );
  });

  it("draws the overlay's rings: hover, and the open note's with a gap and a reticle", () => {
    const svg = sceneToSvg(
      scene({ overlay: { hovered: { x: 40, y: 30, r: 10 }, selected: { x: 0, y: 0, r: 10 } } }),
    );
    expect(svg).toContain(
      `<circle cx="40" cy="30" r="${String(hoverRingRadius(10))}" fill="none" ` +
        `stroke="rgb(236,229,218)" stroke-opacity="0.75" stroke-width="${String(HOVER_RING_PX)}"/>`,
    );
    const ring = selectionRingRadius(10);
    expect(svg).toContain(
      `<circle cx="0" cy="0" r="${String(ring)}" fill="none" stroke="rgb(221,184,95)" ` +
        `stroke-width="${String(SELECTION_RING_PX)}"/>`,
    );
    const inner = ring + SELECTION_RING_PX / 2 + TICK_GAP_PX;
    const outer = String(inner + TICK_PX);
    const from = String(inner);
    expect(svg).toContain(
      `<path d="M${from} 0L${outer} 0M-${from} 0L-${outer} 0M0 ${from}L0 ${outer}M0 -${from}L0 -${outer}" `,
    );

    // The gap between the bubble and its ring is laid in ground, as the overlay does on screen.
    expect(svg).toContain(`<circle cx="0" cy="0" r="11.5" fill="none" stroke="rgb(20,17,15)"`);

    // Over the open note the selection ring says more than a hover ring would: the ground in the
    // gap and the ring, and no hover ring on top.
    const same = sceneToSvg(
      scene({ overlay: { hovered: { x: 0, y: 0, r: 10 }, selected: { x: 0, y: 0, r: 10 } } }),
    );
    expect(same.match(/<circle /g)).toHaveLength(
      (sceneToSvg(scene()).match(/<circle /g)?.length ?? 0) + 2,
    );
  });

  it('writes the labels as text with a halo, the plated ones on pills with a shadow', () => {
    const svg = sceneToSvg(
      scene({
        overlay: {
          labels: [
            label(),
            label({ index: 0, lines: ['Alpha'], plate: true, bold: true, x: 0, y: 20 }),
            label({ index: 2, lines: ['Big'], inside: true, x: 80, y: 0 }),
            label({ index: 2, lines: ['Two', 'lines'], y: 100, alpha: 0.5 }),
          ],
        },
      }),
    );
    expect(svg).toContain(
      '<text x="40" y="50" font-size="13" fill="rgb(232,225,214)" stroke="rgb(20,17,15)" ' +
        `stroke-width="${String(LABEL_HALO_PX)}" stroke-linejoin="round" paint-order="stroke">Beta</text>`,
    );
    expect(svg).toContain('<filter id="rz-plate" ');
    expect(svg).toContain('<feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="rgb(0,0,0)"');
    expect(svg).toContain(
      '<rect x="20" y="42" width="40" height="16" rx="8" fill="rgb(38,33,29)" ' +
        'fill-opacity="0.92" filter="url(#rz-plate)"/>',
    );
    expect(svg).toContain(
      '<rect x="20.5" y="42.5" width="39" height="15" rx="7.5" fill="none" ' +
        'stroke="rgb(236,229,218)" stroke-opacity="0.32" stroke-width="1"/>',
    );
    // The cluster dot, in from the plate's left end and level with the name.
    expect(svg).toContain(
      `<circle cx="${String(20 + PLATE_PAD_X + PLATE_DOT_R)}" cy="20" r="${String(PLATE_DOT_R)}" ` +
        'fill="rgb(127,157,97)"/>',
    );
    expect(svg).toContain('font-size="13" font-weight="600" fill="rgb(232,225,214)">Alpha</text>');
    expect(svg).toContain('fill="rgb(20,17,15)">Big</text>');
    const lineHeight = 13 * LABEL_LINE_HEIGHT;
    const top = n(100 - lineHeight / 2);
    expect(svg).toContain(
      `paint-order="stroke" opacity="0.5"><tspan x="40" y="${top}">Two</tspan>`,
    );
    expect(svg).toContain(`<tspan x="40" y="${n(100 + lineHeight / 2)}">lines</tspan>`);
    // Every plate first, then the names from the least important up.
    expect(svg.indexOf('<rect x="20" y="42"')).toBeLessThan(svg.indexOf('>Two</tspan>'));
    expect(svg.indexOf('lines</tspan>')).toBeLessThan(svg.indexOf('>Big</text>'));
    expect(svg.indexOf('>Alpha</text>')).toBeLessThan(svg.indexOf('>Beta</text>'));
  });

  it("borders the open note's plate in the accent", () => {
    const svg = sceneToSvg(
      scene({ overlay: { labels: [label({ plate: true, bold: true, selected: true })] } }),
    );
    expect(svg).toContain('fill="none" stroke="rgb(221,184,95)" stroke-width="1"/>');
  });

  it('escapes names and fonts, and drops what XML cannot carry', () => {
    const svg = sceneToSvg(
      scene({ overlay: { labels: [label({ lines: ['Beta & <Co>\u0007'] })] } }),
    );
    expect(svg).toContain('>Beta &amp; &lt;Co&gt;</text>');
    expect(svg).toContain('font-family="ui-sans-serif, &quot;Segoe UI&quot;, system-ui"');
    expect(escapeXml('a\u0000b\ud800c\td')).toBe('abc\td');
  });

  it('writes nothing but the ground for an empty scene', () => {
    const empty: FieldData = {
      nodes: {
        count: 0,
        radius: new Float32Array(0),
        slot: new Uint8Array(0),
        degree: new Float32Array(0),
        territory: new Uint8Array(0),
      },
      edges: new Uint32Array(0),
    };
    const svg = sceneToSvg(
      scene({ data: empty, positions: new Float32Array(0), states: new Uint8Array(0) }),
    );
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
        '<rect width="100%" height="100%" fill="rgb(20,17,15)"/></svg>',
    );
  });
});

/** A canvas as far as the PNG export touches it. */
class FakeCanvas {
  width = 300;
  height = 150;
  readonly drawn: unknown[] = [];
  /** The arguments of each drawImage after the source: where and how large. */
  readonly drawnAt: number[][] = [];
  readonly loseContext = vi.fn();
  blob: Blob | null = new Blob(['png'], { type: 'image/png' });
  /** The GPU's largest drawing buffer side: the browser clamps each axis to it on its own. */
  maxBuffer = Number.POSITIVE_INFINITY;

  getContext(kind: string): unknown {
    if (kind === '2d') {
      return {
        drawImage: (source: unknown, ...at: number[]) => {
          this.drawn.push(source);
          this.drawnAt.push(at);
        },
      };
    }
    if (kind === 'webgl2') {
      const width = (): number => Math.min(this.width, this.maxBuffer);
      const height = (): number => Math.min(this.height, this.maxBuffer);
      return {
        get drawingBufferWidth() {
          return width();
        },
        get drawingBufferHeight() {
          return height();
        },
        getExtension: (name: string) =>
          name === 'WEBGL_lose_context' ? { loseContext: this.loseContext } : null,
      };
    }
    return null;
  }

  toBlob(callback: (blob: Blob | null) => void): void {
    callback(this.blob);
  }
}

function fakeRenderer(kind: FieldRenderer['kind']) {
  const frames: FieldFrame[] = [];
  const renderer = {
    kind,
    lost: false,
    setData: vi.fn(),
    setPositions: vi.fn(),
    setStates: vi.fn(),
    render: (frame: FieldFrame) => {
      frames.push(frame);
    },
    destroy: vi.fn(),
  };
  return { renderer, frames };
}

function pngSetup(glWorks: boolean) {
  const canvases: FakeCanvas[] = [];
  const gl = fakeRenderer('webgl2');
  const flat = fakeRenderer('canvas2d');
  const glCanvases: unknown[] = [];
  const flatCanvases: unknown[] = [];
  const glFactory: RendererFactory = (canvas) => {
    glCanvases.push(canvas);
    return glWorks ? gl.renderer : null;
  };
  const flatFactory: RendererFactory = (canvas) => {
    flatCanvases.push(canvas);
    return flat.renderer;
  };
  const sprites = { cache: 'glyphs' };
  const overlay = vi.fn();
  const factories = {
    gl: glFactory,
    canvas2d: flatFactory,
    createCanvas: () => {
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    },
  };
  return { canvases, gl, flat, glCanvases, flatCanvases, sprites, overlay, factories };
}

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clicks a download link and lets the object URL go only once the download had time to start', () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', click: vi.fn() };
    const createObjectURL = vi.fn(() => 'blob:rhizom/1');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', { createElement: () => anchor });
    downloadBlob(new Blob(['<svg/>']), 'graph.svg');
    expect(anchor).toMatchObject({ href: 'blob:rhizom/1', download: 'graph.svg' });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOWNLOAD_URL_LIFETIME_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rhizom/1');
  });
});

describe('sceneToPng', () => {
  it('draws the WebGL field at the export scale, lays the words over it, and lets it go', async () => {
    const setup = pngSetup(true);
    const blob = await sceneToPng(scene(), setup.factories, {
      overlay: setup.overlay,
      sprites: setup.sprites,
    });
    expect(blob.type).toBe('image/png');
    const [field, output, words] = setup.canvases;
    expect(setup.glCanvases).toEqual([field]);
    expect(setup.flatCanvases).toHaveLength(0);

    const { renderer, frames } = setup.gl;
    expect(renderer.setData).toHaveBeenCalledWith(data);
    expect(renderer.setPositions).toHaveBeenCalledWith(positions);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ pixelRatio: 2, grow: 1, moving: false, width: 400 });

    expect(setup.overlay).toHaveBeenCalledOnce();
    const [, overlayFrame, sprites] = setup.overlay.mock.calls[0] as [
      unknown,
      OverlayFrame,
      unknown,
    ];
    expect(overlayFrame.pixelRatio).toBe(2);
    expect(sprites).toBe(setup.sprites);
    expect(output?.drawn).toEqual([field, words]);
    expect(output?.drawnAt[0]).toEqual([0, 0, 800, 600]);

    expect(renderer.destroy).toHaveBeenCalledOnce();
    expect(field?.loseContext).toHaveBeenCalledOnce();
    for (const canvas of setup.canvases) {
      expect([canvas.width, canvas.height]).toEqual([0, 0]); // handed back at once
    }
  });

  it('draws a field larger than the GPU can hold at a lower ratio, stretched evenly under the words', async () => {
    const setup = pngSetup(true);
    const factories = {
      ...setup.factories,
      createCanvas: () => {
        const canvas = new FakeCanvas();
        canvas.maxBuffer = 500;
        setup.canvases.push(canvas);
        return canvas as unknown as HTMLCanvasElement;
      },
    };
    const drawnInto: number[][] = [];
    setup.gl.renderer.render = (frame) => {
      const field = setup.canvases[0];
      drawnInto.push([field?.width ?? 0, field?.height ?? 0]);
      setup.gl.frames.push(frame);
    };
    await sceneToPng(scene(), factories, { overlay: setup.overlay, sprites: setup.sprites });

    // 800 × 600 asked for, 500 × 500 given: each axis clamped on its own. The canvas takes the
    // proportions of the view at the scale the tighter axis allows, so its buffer is its size.
    const fit = 500 / 800;
    expect(drawnInto).toEqual([[500, 375]]);
    expect(setup.gl.frames[0]?.pixelRatio).toBeCloseTo(2 * fit);
    const [field, output, words] = setup.canvases;
    expect(output?.drawn).toEqual([field, words]);
    expect(output?.drawnAt).toEqual([
      [0, 0, 800, 600],
      [0, 0],
    ]);
    // The words keep the full scale, and the stretched field lies under them where the screen has it.
    const [, overlayFrame] = setup.overlay.mock.calls[0] as [unknown, OverlayFrame, unknown];
    expect(overlayFrame.pixelRatio).toBe(2);
  });

  it('falls back to the 2D renderer on a fresh canvas when WebGL gives none', async () => {
    const setup = pngSetup(false);
    await sceneToPng(
      scene(),
      setup.factories,
      { overlay: setup.overlay, sprites: setup.sprites },
      3,
    );
    expect(setup.glCanvases).toHaveLength(1);
    expect(setup.flatCanvases).toHaveLength(1);
    expect(setup.flatCanvases[0]).not.toBe(setup.glCanvases[0]);
    expect(setup.flat.frames[0]?.pixelRatio).toBe(3);
    expect(setup.flat.renderer.destroy).toHaveBeenCalledOnce();
    expect(setup.canvases[1]?.loseContext).not.toHaveBeenCalled();
  });

  it('rejects when no renderer starts', async () => {
    const setup = pngSetup(false);
    const draw = { overlay: setup.overlay, sprites: setup.sprites };
    await expect(
      sceneToPng(scene(), { ...setup.factories, canvas2d: () => null }, draw),
    ).rejects.toThrow(/no canvas context/);
  });

  it('lets the renderer go when the browser makes no PNG', async () => {
    const setup = pngSetup(true);
    const draw = { overlay: setup.overlay, sprites: setup.sprites };
    const factories = {
      ...setup.factories,
      createCanvas: () => {
        const canvas = new FakeCanvas();
        canvas.blob = null;
        setup.canvases.push(canvas);
        return canvas as unknown as HTMLCanvasElement;
      },
    };
    await expect(sceneToPng(scene(), factories, draw)).rejects.toThrow(/no PNG/);
    expect(setup.gl.renderer.destroy).toHaveBeenCalledOnce();
  });
});
