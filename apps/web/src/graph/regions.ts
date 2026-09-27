// The milieu layer's arithmetic: which clusters are large enough for a territory and a name, where
// each name sits, and how strongly it shows at the current zoom. Pure — the renderers and the
// overlay take the results; the controller decides how often to ask.
import { truncate } from './labels.js';
import type { Palette } from './palette.js';
import type { Mutable, RegionName } from './types.js';
import type { ViewTransform } from './view.js';

/** Cluster id per node, 0 … clusters − 1. */
export type ClusterIds = ArrayLike<number>;

/** Share of the vault a cluster needs before it becomes a milieu: 3 % reads as a place. */
const MILIEU_SHARE = 0.03;

/**
 * The smallest cluster that gets a territory: three notes at least — one or two notes are a
 * point, not a place — and 3 % of the vault, so a large vault is not a patchwork of tiny washes.
 */
export function territoryMin(count: number): number {
  return Math.max(3, Math.ceil(MILIEU_SHARE * count));
}

/** The smallest cluster whose name is set into the field. A name needs a little more room. */
export function nameMin(count: number): number {
  return Math.max(5, Math.ceil(MILIEU_SHARE * count));
}

/** 1 for every node whose cluster is large enough to have a territory: FieldNodes.territory. */
export function territoryFlags(
  clusterOfNode: ClusterIds,
  clusterSizes: ArrayLike<number>,
): Uint8Array {
  const count = clusterOfNode.length;
  const min = territoryMin(count);
  const flags = new Uint8Array(count);
  for (let node = 0; node < count; node += 1) {
    const size = clusterSizes[clusterOfNode[node] ?? -1] ?? 0;
    flags[node] = size >= min ? 1 : 0;
  }
  return flags;
}

/** 1 for every cluster large enough to be named, by cluster id. */
export function nameFlags(clusterSizes: ArrayLike<number>): Uint8Array {
  const sizes = Array.from(clusterSizes);
  const min = nameMin(sizes.reduce((count, size) => count + size, 0));
  return Uint8Array.from(sizes, (size) => (size >= min ? 1 : 0));
}

/**
 * The longest cluster name set into the field. A tag is somebody else's text: a name of a few
 * thousand characters would make a glyph sprite of tens of megabytes, or one past the largest
 * canvas the browser allows, and would not be read at any zoom anyway.
 */
export const REGION_NAME_CHARS = 40;

/** A cluster whose name is set into the field. */
export interface RegionLabel {
  /** Cluster id: the index into the anchors. */
  readonly cluster: number;
  readonly text: string;
  /** Palette slot of the cluster's colour. */
  readonly slot: number;
}

/**
 * The clusters that get a name, most notes first — the order the overlay places them in, so when
 * two names collide the larger milieu keeps its name. A cluster without a text (the vault root,
 * untagged notes) gets none: there is no place called "nothing".
 */
export function regionLabels(
  texts: readonly string[],
  clusterSizes: ArrayLike<number>,
  slots: ArrayLike<number>,
): RegionLabel[] {
  const named = nameFlags(clusterSizes);
  const labels: RegionLabel[] = [];
  for (let cluster = 0; cluster < named.length; cluster += 1) {
    const text = texts[cluster] ?? '';
    if (named[cluster] === 1 && text !== '') {
      const shown = text.length > REGION_NAME_CHARS ? truncate(text, REGION_NAME_CHARS) : text;
      labels.push({ cluster, text: shown, slot: slots[cluster] ?? 0 });
    }
  }
  return labels.sort(
    (a, b) =>
      (clusterSizes[b.cluster] ?? 0) - (clusterSizes[a.cluster] ?? 0) || a.cluster - b.cluster,
  );
}

/** Scratch space for the coordinates of one cluster, grown as needed and never shrunk. */
let scratchX = new Float64Array(0);
let scratchY = new Float64Array(0);

/**
 * Where each eligible cluster's name sits: the member bubble nearest the cluster's median
 * position, by node index, or -1 for a cluster that is not eligible or has no placed member. The
 * median rather than the mean, and a member rather than the point itself, so the name sits on the
 * cluster even when it is ring-shaped or split, never in the hole in its middle. An index rather
 * than a point, so the name follows the live layout between two calls.
 *
 * Writes into `out` when it has one entry per cluster. Allocates nothing per call once the scratch
 * space has grown, so it can run on every layout tick; it scans the nodes once per eligible
 * cluster, and at 3 % of the vault per named cluster there are never more than about thirty.
 */
export function regionAnchors(
  positions: Float32Array,
  clusterOfNode: ClusterIds,
  eligible: ArrayLike<number>,
  out?: Int32Array,
): Int32Array {
  const clusters = eligible.length;
  const anchors = out?.length === clusters ? out : new Int32Array(clusters);
  anchors.fill(-1);
  const count = Math.min(clusterOfNode.length, positions.length >> 1);
  if (scratchX.length < count) {
    scratchX = new Float64Array(count);
    scratchY = new Float64Array(count);
  }

  for (let cluster = 0; cluster < clusters; cluster += 1) {
    if ((eligible[cluster] ?? 0) === 0) {
      continue;
    }
    let members = 0;
    for (let node = 0; node < count; node += 1) {
      if (clusterOfNode[node] !== cluster) {
        continue;
      }
      const x = positions[node * 2] ?? Number.NaN;
      const y = positions[node * 2 + 1] ?? Number.NaN;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        scratchX[members] = x;
        scratchY[members] = y;
        members += 1;
      }
    }
    if (members === 0) {
      continue; // no member placed yet
    }
    const middle = members >> 1;
    const mx = selectKth(scratchX, members, middle);
    const my = selectKth(scratchY, members, middle);

    let best = -1;
    let bestDistance = Infinity;
    for (let node = 0; node < count; node += 1) {
      if (clusterOfNode[node] !== cluster) {
        continue;
      }
      const dx = (positions[node * 2] ?? Number.NaN) - mx;
      const dy = (positions[node * 2 + 1] ?? Number.NaN) - my;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    anchors[cluster] = best;
  }
  return anchors;
}

/**
 * The k-th smallest of values[0 … length) by quickselect (Hoare's partition), reordering that
 * range in place. Linear on average, and no copy — sorting would need one.
 */
export function selectKth(values: Float64Array, length: number, k: number): number {
  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1] ?? 0;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((values[i] ?? 0) < pivot) {
        i += 1;
      }
      while ((values[j] ?? 0) > pivot) {
        j -= 1;
      }
      if (i <= j) {
        const swap = values[i] ?? 0;
        values[i] = values[j] ?? 0;
        values[j] = swap;
        i += 1;
        j -= 1;
      }
    }
    if (k <= j) {
      hi = j;
    } else if (k >= i) {
      lo = i;
    } else {
      break; // k sits between the two halves, among values equal to the pivot
    }
  }
  return values[k] ?? Number.NaN;
}

/** The median of some values, e.g. the bubble radii once per data set; NaN for none. */
export function medianOf(values: ArrayLike<number>): number {
  const copy = Float64Array.from(values);
  return copy.length === 0 ? Number.NaN : selectKth(copy, copy.length, copy.length >> 1);
}

/**
 * How strongly the milieu names show, from the median bubble radius on screen (CSS px): fully
 * while bubbles are dots, fading out between 8.5 and 12.5 px as they grow into bubbles whose own
 * names take over — the semantic zoom of a map, where region names give way to towns.
 */
export function regionAlpha(medianScreenRadiusPx: number): number {
  if (Number.isNaN(medianScreenRadiusPx)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (12.5 - medianScreenRadiusPx) / 4));
}

export interface RegionNamesInput {
  /** From regionLabels: the named clusters, most notes first. */
  readonly regions: readonly RegionLabel[];
  /** From regionAnchors: node index per cluster id, or -1. */
  readonly anchors: Int32Array;
  /** Graph units, [x0, y0, x1, y1, …]. */
  readonly positions: Float32Array;
  readonly transform: ViewTransform;
  /** CSS px: an anchor outside the screen hides its name. */
  readonly width: number;
  readonly height: number;
  /** From regionAlpha. */
  readonly alpha: number;
  /** Index of the hovered note, or -1: a hovered note hides every name. */
  readonly hovered: number;
  readonly palette: Palette;
  /**
   * Half the width of each name's box as the overlay sets it (overlay.ts regionBox), CSS px, by
   * index into `regions`: measured once per data set and palette. Given, a name that would overlap
   * the name of a larger milieu is hidden; left out, every name shows and may overlap.
   */
  readonly halfWidths?: ArrayLike<number>;
  /** Half the height of a name's box, CSS px; needed with `halfWidths`. */
  readonly halfHeight?: number;
}

/**
 * The names for the overlay, in CSS px: one entry per region, in the order of `regions`, always —
 * so an entry that should not show (hovered note, anchor off screen or unplaced, names faded out,
 * or covered by a larger milieu's name) is there with alpha 0 and the overlay skips it. Keeping the
 * length stable is what lets the same objects be reused: pass the previous result as `out` and
 * nothing is allocated. The colour is the cluster's own; the overlay lightens or darkens it for the
 * ground.
 */
export function regionNames(input: RegionNamesInput, out: RegionName[] = []): RegionName[] {
  const { regions, anchors, positions, transform, width, height, palette, halfWidths } = input;
  const halfHeight = input.halfHeight ?? 0;
  const visible = input.hovered < 0 ? Math.min(1, Math.max(0, input.alpha)) : 0;
  const names = out as Mutable<RegionName>[];
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (region === undefined) {
      continue;
    }
    const name = names[index] ?? { text: '', x: 0, y: 0, alpha: 0, color: '' };
    names[index] = name;
    name.text = region.text;
    name.color = palette.clusters[region.slot] ?? palette.label;
    const anchor = anchors[region.cluster] ?? -1;
    const gx = anchor >= 0 ? (positions[anchor * 2] ?? Number.NaN) : Number.NaN;
    const gy = anchor >= 0 ? (positions[anchor * 2 + 1] ?? Number.NaN) : Number.NaN;
    const x = gx * transform.k + transform.x;
    const y = gy * transform.k + transform.y;
    const onScreen = x >= 0 && x <= width && y >= 0 && y <= height; // false for NaN too
    name.x = onScreen ? x : 0;
    name.y = onScreen ? y : 0;
    name.alpha = onScreen ? visible : 0;
    if (
      name.alpha > 0 &&
      halfWidths !== undefined &&
      covered(names, index, halfWidths, halfHeight)
    ) {
      name.alpha = 0;
    }
  }
  names.length = regions.length;
  return names;
}

/**
 * Whether the name at `index` would overlap a name before it that shows. The regions come most
 * notes first, so a clash costs the smaller milieu its name; a name hidden here blocks nothing.
 * Quadratic, but over a few dozen names at most.
 */
function covered(
  names: readonly RegionName[],
  index: number,
  halfWidths: ArrayLike<number>,
  halfHeight: number,
): boolean {
  const name = names[index];
  if (name === undefined) {
    return false;
  }
  const halfWidth = halfWidths[index] ?? 0;
  for (let before = 0; before < index; before += 1) {
    const other = names[before];
    if (
      other !== undefined &&
      other.alpha > 0 &&
      Math.abs(other.x - name.x) < halfWidth + (halfWidths[before] ?? 0) &&
      Math.abs(other.y - name.y) < 2 * halfHeight
    ) {
      return true;
    }
  }
  return false;
}
