import { describe, expect, it } from 'vitest';

import {
  buildAdjacency,
  computeStates,
  DRAW_ON_MS,
  FOCUS_IN_MS,
  FOCUS_OUT_MS,
  FocusAnimator,
  type Adjacency,
} from './focus.js';
import { NodeFlag } from './types.js';

function neighboursOf(adjacency: Adjacency, node: number): number[] {
  const start = adjacency.offsets[node] ?? 0;
  const end = adjacency.offsets[node + 1] ?? 0;
  return [...adjacency.neighbours.subarray(start, end)].sort((a, b) => a - b);
}

describe('buildAdjacency', () => {
  // 0 — 1 — 2, 1 — 3, and 4 on its own.
  const adjacency = buildAdjacency(5, Uint32Array.from([0, 1, 1, 2, 3, 1]));

  it('lists every neighbour, in both directions', () => {
    expect(neighboursOf(adjacency, 0)).toEqual([1]);
    expect(neighboursOf(adjacency, 1)).toEqual([0, 2, 3]);
    expect(neighboursOf(adjacency, 2)).toEqual([1]);
    expect(neighboursOf(adjacency, 3)).toEqual([1]);
  });

  it('gives a node without links an empty row', () => {
    expect(neighboursOf(adjacency, 4)).toEqual([]);
    expect(adjacency.offsets).toHaveLength(6);
    expect(adjacency.offsets[5]).toBe(adjacency.neighbours.length);
  });

  it('skips pairs that point outside the nodes, self-links and a dangling half pair', () => {
    const odd = buildAdjacency(3, Uint32Array.from([0, 1, 0, 7, 9, 2, 2, 2, 1]));
    expect(neighboursOf(odd, 0)).toEqual([1]);
    expect(neighboursOf(odd, 1)).toEqual([0]);
    expect(neighboursOf(odd, 2)).toEqual([]);
    expect(odd.neighbours).toHaveLength(2);
  });

  it('copes with no nodes and no links', () => {
    const empty = buildAdjacency(0, new Uint32Array(0));
    expect(empty.count).toBe(0);
    expect([...empty.offsets]).toEqual([0]);
    expect(empty.neighbours).toHaveLength(0);
  });

  it('lists a link written both ways twice, which the flags do not mind', () => {
    const both = buildAdjacency(2, Uint32Array.from([0, 1, 1, 0]));
    expect(neighboursOf(both, 0)).toEqual([1, 1]);
  });
});

describe('computeStates', () => {
  // A star around 0 (1, 2, 3), a tail 3 — 4, and 5 on its own.
  const adjacency = buildAdjacency(6, Uint32Array.from([0, 1, 0, 2, 0, 3, 3, 4]));
  const none = { hovered: -1, selected: -1, clusterMembers: null };

  it('flags nothing without a focus', () => {
    expect([...computeStates(6, adjacency, none)]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('focuses the hovered note and its neighbours', () => {
    const states = computeStates(6, adjacency, { ...none, hovered: 3 });
    expect(states[3]).toBe(NodeFlag.focus | NodeFlag.hovered);
    expect(states[0]).toBe(NodeFlag.focus);
    expect(states[4]).toBe(NodeFlag.focus);
    expect(states[1]).toBe(0);
    expect(states[5]).toBe(0);
  });

  it('flags the open note and its neighbours whatever the focus', () => {
    const states = computeStates(6, adjacency, { ...none, hovered: 4, selected: 0 });
    expect(states[0]).toBe(NodeFlag.selected);
    expect(states[1]).toBe(NodeFlag.selectedNeighbour);
    expect(states[3]).toBe(NodeFlag.selectedNeighbour | NodeFlag.focus);
    expect(states[4]).toBe(NodeFlag.focus | NodeFlag.hovered);
  });

  it('focuses the members of a cluster when no note is hovered', () => {
    const members = Uint8Array.from([0, 1, 0, 0, 1, 1]);
    const states = computeStates(6, adjacency, { ...none, clusterMembers: members });
    expect([...states]).toEqual([0, 1, 0, 0, 1, 1].map((m) => m * NodeFlag.focus));
  });

  it('lets a hovered note win over a focused cluster', () => {
    const members = Uint8Array.from([0, 0, 0, 0, 0, 1]);
    const states = computeStates(6, adjacency, { ...none, hovered: 1, clusterMembers: members });
    expect(states[5]).toBe(0);
    expect(states[1]).toBe(NodeFlag.focus | NodeFlag.hovered);
  });

  it('reads a membership array shorter than the nodes as the rest being outside', () => {
    const states = computeStates(6, adjacency, { ...none, clusterMembers: Uint8Array.from([1]) });
    expect([...states]).toEqual([NodeFlag.focus, 0, 0, 0, 0, 0]);
  });

  it('writes into the buffer it is given, clearing what was there', () => {
    const out = new Uint8Array(6);
    const first = computeStates(6, adjacency, { ...none, hovered: 0 }, out);
    expect(first).toBe(out);
    const second = computeStates(6, adjacency, { ...none, selected: 5 }, out);
    expect(second).toBe(out);
    expect([...out]).toEqual([0, 0, 0, 0, 0, NodeFlag.selected]);
  });

  it('allocates a fresh buffer when the one given has the wrong length', () => {
    const out = new Uint8Array(3);
    const states = computeStates(6, adjacency, none, out);
    expect(states).not.toBe(out);
    expect(states).toHaveLength(6);
  });

  it('ignores indices that are not nodes', () => {
    for (const index of [-1, 6, 99, 1.5, Number.NaN]) {
      const states = computeStates(6, adjacency, {
        hovered: index,
        selected: index,
        clusterMembers: null,
      });
      expect([...states]).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });
});

/** Advances until the animator rests, returning the milliseconds that took. */
function runOut(animator: FocusAnimator, frameMs = 1): number {
  let elapsed = 0;
  while (animator.advance(frameMs)) {
    elapsed += frameMs;
    if (elapsed > 5000) {
      throw new Error('the focus never came to rest');
    }
  }
  return elapsed + frameMs;
}

describe('FocusAnimator', () => {
  it('starts with no focus', () => {
    const focus = new FocusAnimator();
    expect(focus.focusAmount).toBe(0);
    expect(focus.drawOn).toBe(0);
    expect(focus.focusIndex).toBe(-1);
    expect(focus.clusterFocus).toBe(false);
    expect(focus.clusterMembers).toBeNull();
    expect(focus.advance(16)).toBe(false);
  });

  it('focuses a hovered note at once and fades the field into it', () => {
    const focus = new FocusAnimator();
    expect(focus.setHover(4)).toBe(true);
    expect(focus.focusIndex).toBe(4);
    expect(focus.focusAmount).toBe(0);
    focus.advance(FOCUS_IN_MS / 2);
    expect(focus.focusAmount).toBeGreaterThan(0.5); // eased out: most of the way by half time
    expect(focus.focusAmount).toBeLessThan(1);
    focus.advance(FOCUS_IN_MS / 2);
    expect(focus.focusAmount).toBe(1);
  });

  it('draws the links on over their own, longer time', () => {
    const focus = new FocusAnimator();
    focus.setHover(2);
    focus.advance(FOCUS_IN_MS);
    expect(focus.drawOn).toBeGreaterThan(0);
    expect(focus.drawOn).toBeLessThan(1);
    expect(runOut(focus)).toBe(DRAW_ON_MS - FOCUS_IN_MS);
    expect(focus.drawOn).toBe(1);
  });

  it('reports no change for the note it already has', () => {
    const focus = new FocusAnimator();
    focus.setHover(2);
    expect(focus.setHover(2)).toBe(false);
    expect(focus.setHover(-7)).toBe(true);
    expect(focus.setHover(-1)).toBe(false);
  });

  it('draws the links on afresh when the pointer moves to another note', () => {
    const focus = new FocusAnimator();
    focus.setHover(2);
    runOut(focus);
    focus.setHover(5);
    expect(focus.focusIndex).toBe(5);
    expect(focus.drawOn).toBe(0);
    expect(focus.focusAmount).toBe(1);
    focus.advance(DRAW_ON_MS);
    expect(focus.drawOn).toBe(1);
  });

  it('keeps the note while the focus fades out, then lets it go', () => {
    const focus = new FocusAnimator();
    focus.setHover(3);
    runOut(focus);
    focus.setHover(-1);
    focus.advance(FOCUS_OUT_MS / 2);
    expect(focus.focusIndex).toBe(3); // its lit links fade rather than vanish
    expect(focus.drawOn).toBe(1);
    expect(focus.focusAmount).toBeGreaterThan(0);
    expect(focus.focusAmount).toBeLessThan(0.5);
    expect(focus.advance(FOCUS_OUT_MS / 2)).toBe(false);
    expect(focus.focusAmount).toBe(0);
    expect(focus.focusIndex).toBe(-1);
    expect(focus.drawOn).toBe(0);
  });

  it('asks for no frame after the one in which a short hover has faded out', () => {
    const focus = new FocusAnimator();
    focus.setHover(3);
    focus.advance(40); // the links are still drawing on when the pointer leaves
    focus.setHover(-1);
    const outMs = FOCUS_OUT_MS * focus.focusAmount;
    let frames = 1;
    while (focus.advance(16)) {
      frames += 1;
    }
    expect(frames).toBe(Math.ceil(outMs / 16));
    expect(focus.drawOn).toBe(0);
    expect(focus.focusIndex).toBe(-1);
  });

  it('fades back in without drawing again when the same note returns mid-fade', () => {
    const focus = new FocusAnimator();
    focus.setHover(3);
    runOut(focus);
    focus.setHover(-1);
    focus.advance(FOCUS_OUT_MS / 3);
    const sunk = focus.focusAmount;
    focus.setHover(3);
    expect(focus.drawOn).toBe(1);
    expect(focus.focusAmount).toBe(sunk);
    // A partial way back takes its share of the full time.
    expect(runOut(focus)).toBeLessThan(FOCUS_IN_MS);
    expect(focus.focusAmount).toBe(1);
  });

  it('turns a hover that is gone before any frame into no focus at all', () => {
    const focus = new FocusAnimator();
    focus.setHover(1);
    focus.setHover(-1);
    expect(focus.focusIndex).toBe(-1);
    expect(focus.focusAmount).toBe(0);
    expect(focus.advance(16)).toBe(false);
  });

  it('counts a version up exactly when the focused set changes', () => {
    const focus = new FocusAnimator();
    const v0 = focus.version;
    focus.setHover(1);
    expect(focus.version).toBe(v0 + 1);
    runOut(focus);
    expect(focus.version).toBe(v0 + 1); // a fade alone changes no flags
    focus.setHover(2);
    expect(focus.version).toBe(v0 + 2);
    focus.setHover(-1);
    expect(focus.version).toBe(v0 + 2); // still focused while it fades
    runOut(focus);
    expect(focus.version).toBe(v0 + 3);
  });

  describe('clusters', () => {
    const members = Uint8Array.from([1, 0, 1]);

    it('focuses a cluster as a whole, with nothing to draw on', () => {
      const focus = new FocusAnimator();
      expect(focus.setCluster(members)).toBe(true);
      expect(focus.setCluster(members)).toBe(false);
      expect(focus.clusterFocus).toBe(true);
      expect(focus.clusterMembers).toBe(members);
      expect(focus.focusIndex).toBe(-1);
      expect(focus.drawOn).toBe(1);
      expect(runOut(focus)).toBe(FOCUS_IN_MS);
      expect(focus.focusAmount).toBe(1);
    });

    it('lets a hovered note win and returns to the cluster when it goes', () => {
      const focus = new FocusAnimator();
      focus.setCluster(members);
      runOut(focus);
      focus.setHover(1);
      expect(focus.clusterFocus).toBe(false);
      expect(focus.focusIndex).toBe(1);
      expect(focus.drawOn).toBe(0);
      focus.setHover(-1);
      expect(focus.clusterFocus).toBe(true);
      expect(focus.focusIndex).toBe(-1);
      expect(focus.focusAmount).toBe(1);
    });

    it('keeps the members while the cluster fades out', () => {
      const focus = new FocusAnimator();
      focus.setCluster(members);
      runOut(focus);
      focus.setCluster(null);
      focus.advance(FOCUS_OUT_MS / 2);
      expect(focus.clusterMembers).toBe(members);
      runOut(focus);
      expect(focus.clusterMembers).toBeNull();
      expect(focus.clusterFocus).toBe(false);
    });

    it('switches from one cluster to another without fading out between', () => {
      const focus = new FocusAnimator();
      const other = Uint8Array.from([0, 1, 0]);
      focus.setCluster(members);
      runOut(focus);
      focus.setCluster(other);
      expect(focus.clusterMembers).toBe(other);
      expect(focus.focusAmount).toBe(1);
    });
  });

  it('finishes at once', () => {
    const focus = new FocusAnimator();
    focus.setHover(6);
    focus.finish();
    expect(focus.focusAmount).toBe(1);
    expect(focus.drawOn).toBe(1);
    focus.setHover(-1);
    focus.finish();
    expect(focus.focusAmount).toBe(0);
    expect(focus.focusIndex).toBe(-1);
  });

  it('forgets everything on reset', () => {
    const focus = new FocusAnimator();
    focus.setHover(6);
    focus.setCluster(Uint8Array.from([1]));
    focus.advance(50);
    const version = focus.version;
    focus.reset();
    expect(focus.focusAmount).toBe(0);
    expect(focus.drawOn).toBe(0);
    expect(focus.focusIndex).toBe(-1);
    expect(focus.clusterMembers).toBeNull();
    expect(focus.version).toBe(version + 1);
    expect(focus.advance(16)).toBe(false);
    // The same note hovered again after new data is a new focus.
    expect(focus.setHover(6)).toBe(true);
  });
});
