// Who is in focus and how far the focus has come: the neighbourhood of the hovered note or the
// members of a legend row, as the per-node flags the renderers read, and the fade that sinks the
// rest of the field into the ground. Pure, and allocation-free per call once the buffers exist.
import { easeOutCubic, Tween, type Animation } from './motion.js';
import { NodeFlag } from './types.js';

/**
 * Undirected neighbours in compressed sparse rows: node i's neighbours are
 * neighbours[offsets[i] … offsets[i + 1]).
 */
export interface Adjacency {
  readonly count: number;
  /** count + 1 entries. */
  readonly offsets: Uint32Array;
  readonly neighbours: Uint32Array;
}

/**
 * Builds the neighbour lists from flat index pairs. Degrees are counted from the pairs
 * themselves, never taken from the data, so the rows always fit what is written into them. Pairs
 * with an end outside 0 … count − 1 and self-links are skipped; a link written both ways lists
 * the neighbour twice, which costs the flags nothing.
 */
export function buildAdjacency(count: number, edges: Uint32Array): Adjacency {
  const size = Math.max(0, Math.floor(count));
  const offsets = new Uint32Array(size + 1);
  const pairs = edges.length - (edges.length % 2);
  for (let index = 0; index < pairs; index += 2) {
    const source = edges[index] ?? size;
    const target = edges[index + 1] ?? size;
    if (source >= size || target >= size || source === target) {
      continue;
    }
    offsets[source + 1] = (offsets[source + 1] ?? 0) + 1;
    offsets[target + 1] = (offsets[target + 1] ?? 0) + 1;
  }
  for (let node = 0; node < size; node += 1) {
    offsets[node + 1] = (offsets[node + 1] ?? 0) + (offsets[node] ?? 0);
  }

  const neighbours = new Uint32Array(offsets[size] ?? 0);
  const cursor = offsets.slice(0, size);
  for (let index = 0; index < pairs; index += 2) {
    const source = edges[index] ?? size;
    const target = edges[index + 1] ?? size;
    if (source >= size || target >= size || source === target) {
      continue;
    }
    const s = cursor[source] ?? 0;
    const t = cursor[target] ?? 0;
    neighbours[s] = target;
    neighbours[t] = source;
    cursor[source] = s + 1;
    cursor[target] = t + 1;
  }
  return { count: size, offsets, neighbours };
}

export interface FocusInput {
  /** Index of the note whose neighbourhood is the focus, or -1. */
  readonly hovered: number;
  /** Index of the open note, or -1. */
  readonly selected: number;
  /** 1 for each member of a focused cluster; used only while no note is hovered. */
  readonly clusterMembers: Uint8Array | null;
}

/**
 * The NodeFlag bits of every node: the hovered note and its neighbours, or else the members of a
 * focused cluster, carry `focus`; the open note and its neighbours carry theirs whatever the
 * focus. Writes into `out` when it has exactly `count` entries, so a caller that keeps one buffer
 * allocates nothing per call.
 */
export function computeStates(
  count: number,
  adjacency: Adjacency,
  input: FocusInput,
  out?: Uint8Array,
): Uint8Array {
  const states = out?.length === count ? out : new Uint8Array(count);
  states.fill(0);
  const { hovered, selected, clusterMembers } = input;
  const nodes = Math.min(count, adjacency.count);

  if (isNode(hovered, nodes)) {
    states[hovered] = NodeFlag.focus | NodeFlag.hovered;
    markNeighbours(states, adjacency, hovered, NodeFlag.focus);
  } else if (clusterMembers !== null) {
    const end = Math.min(count, clusterMembers.length);
    for (let index = 0; index < end; index += 1) {
      if (clusterMembers[index] !== 0) {
        states[index] = NodeFlag.focus;
      }
    }
  }

  if (isNode(selected, nodes)) {
    states[selected] = (states[selected] ?? 0) | NodeFlag.selected;
    markNeighbours(states, adjacency, selected, NodeFlag.selectedNeighbour);
  }
  return states;
}

function isNode(index: number, count: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < count;
}

function markNeighbours(
  states: Uint8Array,
  adjacency: Adjacency,
  node: number,
  flag: number,
): void {
  const end = adjacency.offsets[node + 1] ?? 0;
  for (let at = adjacency.offsets[node] ?? end; at < end; at += 1) {
    const neighbour = adjacency.neighbours[at] ?? states.length;
    if (neighbour < states.length) {
      states[neighbour] = (states[neighbour] ?? 0) | flag;
    }
  }
}

/** A full fade into focus; a partial one takes its share. */
export const FOCUS_IN_MS = 220;
/** Out is a little quicker than in: letting go should never feel sticky. */
export const FOCUS_OUT_MS = 180;
/** How long the lit links take to draw themselves out from the focused note. */
export const DRAW_ON_MS = 350;

/**
 * Eases the focus in and out. `focusAmount` is how far the rest of the field has sunk into the
 * ground; `drawOn` is how far the focused note's links have drawn themselves out, and starts
 * again whenever the focused note changes. While the focus fades out, `focusIndex` and
 * `clusterMembers` keep what was focused, so lit links fade instead of vanishing; once the fade
 * has finished they clear. A hovered note wins over a focused cluster.
 */
export class FocusAnimator implements Animation {
  readonly #amount = new Tween(0, easeOutCubic);
  readonly #drawOn = new Tween(0, easeOutCubic);
  #hover = -1;
  #cluster: Uint8Array | null = null;
  #focusIndex = -1;
  #focusCluster: Uint8Array | null = null;
  #version = 0;

  /** 0 … 1: how far everything outside the focus has sunk into the ground. */
  get focusAmount(): number {
    return this.#amount.value;
  }

  /** 0 … 1, eased: how far the lit links have drawn themselves out. */
  get drawOn(): number {
    return this.#drawOn.value;
  }

  /** The note whose links are lit: the hovered one, or the one fading out; -1 for none. */
  get focusIndex(): number {
    return this.#focusIndex;
  }

  /** True while a cluster is the focus, fading out included. */
  get clusterFocus(): boolean {
    return this.#focusCluster !== null;
  }

  /** The focused cluster's membership, kept while it fades out; what computeStates wants. */
  get clusterMembers(): Uint8Array | null {
    return this.#focusCluster;
  }

  /**
   * Goes up whenever `focusIndex` or `clusterMembers` change, so the caller recomputes the node
   * flags exactly when the focused set changed and not on every frame of a fade.
   */
  get version(): number {
    return this.#version;
  }

  /** The note under the pointer, or -1. Returns whether that changed anything. */
  setHover(index: number): boolean {
    const next = Number.isInteger(index) && index >= 0 ? index : -1;
    if (next === this.#hover) {
      return false;
    }
    this.#hover = next;
    this.#retarget();
    return true;
  }

  /** The members of the legend row under the pointer, or null. Compared by identity. */
  setCluster(members: Uint8Array | null): boolean {
    if (members === this.#cluster) {
      return false;
    }
    this.#cluster = members;
    this.#retarget();
    return true;
  }

  /** Forgets every focus at once: after new data, whose indices name other notes. */
  reset(): void {
    this.#hover = -1;
    this.#cluster = null;
    this.#amount.set(0);
    this.#drawOn.set(0);
    this.#clearFocus();
  }

  advance(dtMs: number): boolean {
    this.#amount.advance(dtMs);
    this.#drawOn.advance(dtMs);
    this.#settle();
    // Asked after settling: a fade-out that arrives cuts a draw-on still under way short, and
    // that frame needs no successor.
    return this.#amount.moving || this.#drawOn.moving;
  }

  finish(): void {
    this.#amount.finish();
    this.#drawOn.finish();
    this.#settle();
  }

  #retarget(): void {
    const amount = this.#amount;
    if (this.#hover >= 0) {
      if (this.#hover !== this.#focusIndex || this.#focusCluster !== null) {
        this.#focusIndex = this.#hover;
        this.#focusCluster = null;
        this.#version += 1;
        this.#drawOn.set(0);
        this.#drawOn.to(1, DRAW_ON_MS);
      }
      amount.to(1, FOCUS_IN_MS * (1 - amount.value));
      return;
    }
    if (this.#cluster !== null) {
      if (this.#cluster !== this.#focusCluster || this.#focusIndex >= 0) {
        this.#focusIndex = -1;
        this.#focusCluster = this.#cluster;
        this.#version += 1;
        // A cluster has no single source to draw links out from: what it lights shows whole.
        this.#drawOn.set(1);
      }
      amount.to(1, FOCUS_IN_MS * (1 - amount.value));
      return;
    }
    amount.to(0, FOCUS_OUT_MS * amount.value);
    this.#settle();
  }

  /** Once the fade-out has arrived, what was focused is let go. */
  #settle(): void {
    if (this.#amount.value === 0 && this.#amount.target === 0) {
      this.#drawOn.set(0);
      this.#clearFocus();
    }
  }

  #clearFocus(): void {
    if (this.#focusIndex >= 0 || this.#focusCluster !== null) {
      this.#focusIndex = -1;
      this.#focusCluster = null;
      this.#version += 1;
    }
  }
}
