import { describe, expect, it } from 'vitest';

import { buildFieldModel } from './field-model.js';
import type { SimLink, SimNode } from './simulation.js';

function node(id: string, cluster: string, degree: number, r = 5): SimNode {
  return { id, label: id.replace('.md', ''), cluster, degree, r, colorIndex: 2, x: 0, y: 0 };
}

const a = node('a.md', 'Research', 3, 7);
const b = node('b.md', 'Research', 1);
const c = node('c.md', 'Campaign', 2);
const d = node('d.md', 'Loose', 0);
const links: SimLink[] = [
  { source: a, target: b, count: 1 },
  { source: a, target: c, count: 2 },
];

describe('buildFieldModel', () => {
  const model = buildFieldModel([a, b, c, d], links, ['Campaign', 'Research']);

  it('turns the links into index pairs in node order', () => {
    expect([...model.data.edges]).toEqual([0, 1, 0, 2]);
  });

  it('keeps radius, slot and degree by node index', () => {
    expect([...model.data.nodes.radius]).toEqual([7, 5, 5, 5]);
    expect([...model.data.nodes.slot]).toEqual([2, 2, 2, 2]);
    expect([...model.data.nodes.degree]).toEqual([3, 1, 2, 0]);
    expect(model.data.nodes.count).toBe(4);
  });

  it('indexes the clusters the response listed and appends one it did not', () => {
    expect(model.clusters).toEqual(['Campaign', 'Research', 'Loose']);
    expect([...model.clusterOfNode]).toEqual([1, 1, 0, 2]);
    expect([...model.clusterSizes]).toEqual([1, 2, 1]);
  });

  it('orders labels by degree, then by name, and ranks from 1', () => {
    expect([...model.labelOrder]).toEqual([0, 2, 1, 3]);
    expect([...model.rank]).toEqual([1, 3, 2, 4]);
  });

  it('finds a node by path and builds the adjacency of the pairs', () => {
    expect(model.indexOf.get('c.md')).toBe(2);
    expect(model.adjacency.count).toBe(4);
  });

  it('leaves out a link whose endpoint is not in the node set', () => {
    const stranger = node('x.md', 'Research', 1);
    const partial = buildFieldModel([a, b], [{ source: a, target: stranger, count: 1 }], []);
    expect(partial.data.edges.length).toBe(0);
  });

  it('copes with an empty field', () => {
    const empty = buildFieldModel([], [], []);
    expect(empty.data.nodes.count).toBe(0);
    expect(empty.labelOrder.length).toBe(0);
  });
});
