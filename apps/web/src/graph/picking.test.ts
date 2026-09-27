import { describe, expect, it } from 'vitest';

import { buildIndex, pick } from './picking.js';
import type { SimNode } from './simulation.js';
import { identity, type ViewTransform } from './view.js';

function node(id: string, x: number | undefined, y: number | undefined, r = 8): SimNode {
  return { id, label: id, cluster: 'notes', degree: 1, r, colorIndex: 0, x, y };
}

describe('pick', () => {
  const nodes = [node('a.md', 0, 0), node('b.md', 50, 0)];
  const index = buildIndex(nodes);

  it('finds the bubble under the pointer', () => {
    expect(pick(index, identity, 3, 3, 8)?.id).toBe('a.md');
    expect(pick(index, identity, 50, 0, 8)?.id).toBe('b.md');
  });

  it('returns nothing for a point outside every bubble', () => {
    expect(pick(index, identity, 25, 0, 8)).toBeNull();
  });

  it('works through the view transform', () => {
    const transform: ViewTransform = { k: 2, x: 100, y: 100 };
    expect(pick(index, transform, 200, 100, 8)?.id).toBe('b.md');
  });

  it('picks a bubble drawn smaller at its drawn size', () => {
    // 10 units from the centre: inside the full radius of 8 plus the slop, outside half of it.
    expect(pick(index, identity, 10, 0, 8, 1)?.id).toBe('a.md');
    expect(pick(index, identity, 10, 0, 8, 0.5)).toBeNull();
  });

  it('leaves out a node the layout has not placed yet', () => {
    const partial = buildIndex([
      node('placed.md', 0, 0),
      node('unplaced.md', undefined, undefined),
    ]);
    expect(partial.size()).toBe(1);
  });
});
