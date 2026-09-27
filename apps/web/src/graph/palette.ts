// Design tokens turned into colour strings a canvas can actually use, and into the numbers a
// shader wants.
import { clusterColorIndex, CLUSTER_COUNT } from '@rhizom/core';

import type { Ground } from './types.js';

const FALLBACK_FONT = 'system-ui, sans-serif';

export interface Palette {
  readonly bg: string;
  readonly edge: string;
  /** Edges touching the hovered or the open note. */
  readonly edgeActive: string;
  readonly label: string;
  readonly labelHalo: string;
  /** Ring around the open note, and the open note's own links. */
  readonly accent: string;
  /** The pill behind the hovered and the open note's label. */
  readonly plate: string;
  /** Light of a lit link: its tip, and the halo of an emphasised bubble. */
  readonly glow: string;
  /** Ink of a label set inside a bubble, whichever contrasts more with its face (look.ts). */
  readonly inkLight: string;
  readonly inkDark: string;
  /** Slot 0 … 7, in the order of --rz-cluster-1 … --rz-cluster-8. */
  readonly clusters: readonly string[];
  readonly fontSans: string;
}

/**
 * Cluster key → its preferred palette slot, a hash of the key. The bubble field starts from it
 * (clusterSlots) and moves a colliding cluster on; the milieu field colours by the hash alone, on
 * purpose (see DECISIONS.md, the WebGL2 entry).
 */
export function clusterSlot(cluster: string): number {
  return clusterColorIndex(cluster, CLUSTER_COUNT);
}

/**
 * Palette slots for the clusters of one graph, distinct as far as the eight colours go. Hashing
 * alone gives two of five folders the same colour more often than not, and with a legend and a
 * territory per cluster that stops telling them apart. So each cluster starts from its hash slot
 * and, when a cluster earlier by name already holds it, takes the next free one; a folder keeps
 * its colour from view to view unless another one collides with it. Past eight clusters the rest
 * share, from their hash slot.
 */
export function clusterSlots(clusters: Iterable<string>): Map<string, number> {
  const slots = new Map<string, number>();
  const taken = new Array<boolean>(CLUSTER_COUNT).fill(false);
  for (const cluster of [...new Set(clusters)].sort()) {
    const preferred = clusterSlot(cluster);
    let slot = preferred;
    if (slots.size < CLUSTER_COUNT) {
      while (taken[slot] === true) {
        slot = (slot + 1) % CLUSTER_COUNT;
      }
      taken[slot] = true;
    }
    slots.set(cluster, slot);
  }
  return slots;
}

/**
 * Resolves the graph tokens to `rgb(…)` strings.
 *
 * `getComputedStyle(root).getPropertyValue('--rz-cluster-1')` is not usable here: the computed
 * value of a custom property is the specified value with `var()` substituted and nothing else,
 * so it stays the literal `light-dark(#5c7a45, #7f9d61)` — which canvas silently ignores, leaving
 * the bubbles black. Assigning the token to a real `color` on a probe inside the themed subtree
 * makes the browser evaluate `light-dark()` against the inherited `color-scheme` and serialise
 * the result as `rgb(r, g, b)`, which canvas, SVG and PNG all understand.
 */
export function resolvePalette(host: HTMLElement = document.body): Palette {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  host.append(probe);
  const colour = (token: string): string => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  try {
    // The token is written over several lines; canvas and SVG want one.
    const font = getComputedStyle(host)
      .getPropertyValue('--rz-font-sans')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      bg: colour('--rz-graph-bg'),
      edge: colour('--rz-graph-edge'),
      edgeActive: colour('--rz-graph-edge-active'),
      label: colour('--rz-graph-label'),
      labelHalo: colour('--rz-graph-label-halo'),
      accent: colour('--rz-accent-strong'),
      plate: colour('--rz-graph-plate'),
      glow: colour('--rz-graph-glow'),
      inkLight: colour('--rz-graph-ink-light'),
      inkDark: colour('--rz-graph-ink-dark'),
      clusters: Array.from({ length: CLUSTER_COUNT }, (_, slot) =>
        colour(`--rz-cluster-${String(slot + 1)}`),
      ),
      fontSans: font === '' ? FALLBACK_FONT : font,
    };
  } finally {
    probe.remove();
  }
}

/** Calls back whenever the resolved colours could have changed: theme attribute or OS preference. */
export function watchPalette(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

/** Red, green, blue and alpha, each 0 … 1 — what a shader uniform takes. */
export type Rgba = readonly [number, number, number, number];

const OPAQUE_BLACK: Rgba = [0, 0, 0, 1];

/**
 * Reads the colours the palette probe produces — `rgb(r, g, b)`, `rgba(r, g, b, a)`, the
 * space-separated `rgb(r g b / a)` — and `#rgb` / `#rrggbb`, which the tests write. Anything else
 * reads as opaque black rather than throwing: a colour the browser serialised in some future
 * syntax should cost a wrong tint, not the whole field.
 */
export function parseColor(value: string): Rgba {
  const text = value.trim().toLowerCase();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const full =
      hex.length === 3
        ? [...hex].map((digit) => digit + digit).join('')
        : hex.length === 6
          ? hex
          : null;
    if (full === null || !/^[0-9a-f]{6}$/.test(full)) {
      return OPAQUE_BLACK;
    }
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
      1,
    ];
  }
  const match = /^rgba?\(([^)]*)\)$/.exec(text);
  if (!match) {
    return OPAQUE_BLACK;
  }
  const parts = (match[1] ?? '')
    .split(/[\s,/]+/)
    .filter((part) => part !== '')
    .map((part) => (part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part)));
  const [r, g, b, a = 1] = parts;
  if (r === undefined || g === undefined || b === undefined || parts.some(Number.isNaN)) {
    return OPAQUE_BLACK;
  }
  return [r / 255, g / 255, b / 255, Math.min(1, Math.max(0, a))];
}

/** Relative luminance (WCAG) of an sRGB colour. */
export function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Dark ground or light: the renderers shade a bubble differently on soil than on paper. */
export function groundOf(palette: Palette): Ground {
  return luminance(parseColor(palette.bg)) < 0.2 ? 'humus' : 'kalk';
}
