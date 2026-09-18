// Design tokens turned into colour strings a canvas can actually use.
import { clusterColorIndex } from '@rhizom/core';

/** --rz-cluster-1 … --rz-cluster-8. */
export const CLUSTER_COUNT = 8;

const FALLBACK_FONT = 'system-ui, sans-serif';

export interface Palette {
  readonly bg: string;
  readonly edge: string;
  /** Edges touching the hovered or the open note. */
  readonly edgeActive: string;
  readonly label: string;
  readonly labelHalo: string;
  /** Ring around the open note. */
  readonly accent: string;
  /** Slot 0 … 7, in the order of --rz-cluster-1 … --rz-cluster-8. */
  readonly clusters: readonly string[];
  readonly fontSans: string;
}

/** Cluster key → palette slot, the same hash the legend and the server-side docs use. */
export function clusterSlot(cluster: string): number {
  return clusterColorIndex(cluster, CLUSTER_COUNT);
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
