// The milieu names of one data set: which clusters are named, where each name is anchored as
// the layout moves, and the names for a frame. The arithmetic lives in regions.ts; this keeps the
// per-data-set and per-tick results so a frame only projects them, and allocates nothing.
import type { FieldModel } from './field-model.js';
import { regionBox } from './overlay.js';
import type { Palette } from './palette.js';
import {
  medianOf,
  regionAlpha,
  regionAnchors,
  regionLabels,
  regionNames,
  type RegionLabel,
  type RegionNamesInput,
} from './regions.js';
import type { MeasureText, Mutable, RegionName } from './types.js';
import { identity, type ViewTransform } from './view.js';

export class RegionLayer {
  readonly #labels: readonly RegionLabel[];
  /** 1 for each cluster that carries a name: the only ones worth an anchor. */
  readonly #eligible: Uint8Array;
  readonly #clusterOfNode: Uint16Array;
  /** Median bubble radius in graph units: how big "a bubble" is when deciding to fade names. */
  readonly #medianRadius: number;
  #anchors: Int32Array = new Int32Array(0);
  #names: RegionName[] = [];
  /** Half widths of the names' boxes by region, for the overlap test; measured once per font. */
  readonly #halfWidths: Float32Array;
  #halfHeight = 0;
  #measuredWith: MeasureText | null = null;
  readonly #input: Mutable<RegionNamesInput>;

  constructor(model: FieldModel, palette: Palette) {
    this.#labels = regionLabels(model.clusters, model.clusterSizes, model.clusterSlots);
    this.#eligible = new Uint8Array(model.clusters.length);
    for (const label of this.#labels) {
      this.#eligible[label.cluster] = 1;
    }
    this.#clusterOfNode = model.clusterOfNode;
    this.#medianRadius = medianOf(model.data.nodes.radius);
    this.#halfWidths = new Float32Array(this.#labels.length);
    this.#input = {
      regions: this.#labels,
      anchors: this.#anchors,
      positions: new Float32Array(0),
      transform: identity,
      width: 0,
      height: 0,
      alpha: 0,
      hovered: -1,
      palette,
      halfWidths: this.#halfWidths,
      halfHeight: 0,
    };
  }

  /** After the positions changed: each name moves to the bubble nearest its cluster's median. */
  moved(positions: Float32Array): void {
    if (this.#labels.length === 0) {
      return;
    }
    this.#anchors = regionAnchors(positions, this.#clusterOfNode, this.#eligible, this.#anchors);
  }

  /**
   * How strongly the names show at this zoom, 0 … 1, whatever else fades them for the moment
   * (a hovered note): the label density follows the zoom, not the pointer.
   */
  visibility(transform: ViewTransform, symbolScale: number): number {
    return this.#labels.length === 0
      ? 0
      : regionAlpha(this.#medianRadius * transform.k * symbolScale);
  }

  /**
   * The names for one frame. `fade` multiplies their strength: the controller passes what is left
   * of the view after a hover focus, so the names ease out and back with the focus instead of
   * blinking. Where two names would overlap, the larger milieu keeps its name.
   */
  names(
    positions: Float32Array,
    transform: ViewTransform,
    width: number,
    height: number,
    symbolScale: number,
    fade: number,
    palette: Palette,
    measure: MeasureText,
  ): readonly RegionName[] {
    if (this.#labels.length === 0) {
      return this.#names;
    }
    if (this.#measuredWith !== measure) {
      this.#measure(measure);
    }
    const input = this.#input;
    input.anchors = this.#anchors;
    input.positions = positions;
    input.transform = transform;
    input.width = width;
    input.height = height;
    input.alpha = this.visibility(transform, symbolScale) * fade;
    input.palette = palette;
    input.halfHeight = this.#halfHeight;
    this.#names = regionNames(input, this.#names);
    return this.#names;
  }

  #measure(measure: MeasureText): void {
    this.#halfHeight = 0;
    this.#labels.forEach((label, index) => {
      const box = regionBox({ text: label.text, x: 0, y: 0, alpha: 1, color: '' }, measure);
      this.#halfWidths[index] = box.right;
      this.#halfHeight = Math.max(this.#halfHeight, box.bottom);
    });
    this.#measuredWith = measure;
  }
}
