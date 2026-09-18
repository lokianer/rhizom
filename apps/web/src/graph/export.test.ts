import { describe, expect, it } from 'vitest';

import { sceneToSvg } from './export.js';
import type { Palette } from './palette.js';
import { identity, type Scene } from './renderer.js';
import type { SimLink, SimNode } from './simulation.js';

const palette: Palette = {
  bg: 'rgb(20, 17, 15)',
  edge: 'rgba(236, 229, 218, 0.32)',
  edgeActive: 'rgba(236, 229, 218, 0.75)',
  label: 'rgb(232, 225, 214)',
  labelHalo: 'rgb(20, 17, 15)',
  accent: 'rgb(221, 184, 95)',
  clusters: ['rgb(127, 157, 97)', 'rgb(201, 162, 75)'],
  fontSans: 'ui-sans-serif, system-ui',
};

function node(id: string, label: string, x: number, y: number, colorIndex: number): SimNode {
  return { id, label, cluster: 'notes', degree: 1, r: 10, colorIndex, x, y };
}

const first = node('a.md', 'Alpha', 0, 0, 0);
const second = node('b.md', 'Beta & <Co>', 40, 30, 1);
const third = node('c.md', 'Gamma', 80, 0, 1);
const links: SimLink[] = [
  { source: first, target: second, count: 1 },
  { source: second, target: third, count: 2 },
];

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return {
    nodes: [first, second, third],
    links,
    transform: identity,
    width: 400,
    height: 300,
    pixelRatio: 1,
    palette,
    hovered: null,
    selected: null,
    ...overrides,
  };
}

describe('sceneToSvg', () => {
  it('writes a standalone document at the on-screen size', () => {
    const svg = sceneToSvg(makeScene());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg).toContain('width="400" height="300" viewBox="0 0 400 300"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('paints the background and carries the resolved colours, never a token name', () => {
    const svg = sceneToSvg(makeScene());
    expect(svg).toContain(`<rect width="100%" height="100%" fill="${palette.bg}"/>`);
    expect(svg).not.toContain('var(--rz');
    expect(svg).not.toContain('light-dark(');
  });

  it('applies the view transform once, around the whole scene', () => {
    const svg = sceneToSvg(makeScene({ transform: { k: 1.5, x: 20, y: -5 } }));
    expect(svg).toContain('<g transform="translate(20,-5) scale(1.5)">');
  });

  it('draws every quiet edge in a single path', () => {
    const svg = sceneToSvg(makeScene());
    expect(svg).toContain(`<path d="M0 0L40 30M40 30L80 0" fill="none" stroke="${palette.edge}"`);
  });

  it('groups the bubbles by palette slot', () => {
    const svg = sceneToSvg(makeScene());
    expect(svg).toContain(
      `<g fill="${palette.clusters[0] ?? ''}"><circle cx="0" cy="0" r="10"/></g>`,
    );
    expect(svg).toContain(
      `<g fill="${palette.clusters[1] ?? ''}"><circle cx="40" cy="30" r="10"/>` +
        `<circle cx="80" cy="0" r="10"/></g>`,
    );
  });

  it('lifts the edges of the open note out of the quiet path and rings it', () => {
    const svg = sceneToSvg(makeScene({ selected: 'a.md' }));
    expect(svg).toContain(`<path d="M0 0L40 30" fill="none" stroke="${palette.edgeActive}"`);
    expect(svg).toContain(`<path d="M40 30L80 0" fill="none" stroke="${palette.edge}"`);
    expect(svg).toContain(`stroke="${palette.accent}"`);
  });

  it('labels the emphasised notes and escapes their names', () => {
    const svg = sceneToSvg(makeScene({ hovered: 'b.md' }));
    expect(svg).toContain('>Beta &amp; &lt;Co&gt;</text>');
    expect(svg).not.toContain('>Alpha</text>');
    expect(svg).toContain('paint-order: stroke fill');
  });

  it('labels every visible note once the view is zoomed in', () => {
    const svg = sceneToSvg(makeScene({ transform: { k: 2, x: 0, y: 0 } }));
    expect(svg).toContain('>Alpha</text>');
    expect(svg).toContain('>Gamma</text>');
  });
});
