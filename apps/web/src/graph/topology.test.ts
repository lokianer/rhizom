import { describe, expect, it } from 'vitest';

import { buildIncidence, sizeOrder, type Incidence } from './topology.js';

function linksOf(incidence: Incidence, node: number): number[] {
  return Array.from(incidence.links.subarray(incidence.offsets[node], incidence.offsets[node + 1]));
}

describe('buildIncidence', () => {
  it('groups the links by node, a self-link once, links to unknown notes not at all', () => {
    const incidence = buildIncidence(4, Uint32Array.of(0, 1, 0, 2, 1, 2, 3, 3, 0, 9));
    expect(linksOf(incidence, 0)).toEqual([0, 1]);
    expect(linksOf(incidence, 1)).toEqual([0, 2]);
    expect(linksOf(incidence, 2)).toEqual([1, 2]);
    expect(linksOf(incidence, 3)).toEqual([3]);
    expect(incidence.links.length).toBe(7);
  });

  it('is empty for no notes', () => {
    const incidence = buildIncidence(0, new Uint32Array(0));
    expect([...incidence.offsets]).toEqual([0]);
    expect(incidence.links).toHaveLength(0);
  });
});

describe('sizeOrder', () => {
  it('orders the bubbles from the smallest up, equal ones by index', () => {
    const nodes = { count: 4, radius: Float32Array.of(10, 5, 5, 5) };
    expect(Array.from(sizeOrder(nodes))).toEqual([1, 2, 3, 0]);
  });
});
