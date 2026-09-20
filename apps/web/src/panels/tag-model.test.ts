import type { TagCount } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { buildTagTree, isUnderTag, matchesTags, type TagNode } from './tag-model.js';

const counted = (...entries: [string, number][]): TagCount[] =>
  entries.map(([tag, count]) => ({ tag, count }));

/** The tree as `name(count/total)` lines, indented — the shape is what these tests are about. */
function shape(nodes: readonly TagNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.name}(${String(node.count)}/${String(node.total)})`,
    ...shape(node.children, depth + 1),
  ]);
}

describe('buildTagTree', () => {
  it('nests every level and sorts each of them by name', () => {
    expect(
      shape(
        buildTagTree(
          counted(
            ['campaign/silverstadt/npcs', 3],
            ['campaign/places', 2],
            ['campaign', 1],
            ['research', 4],
          ),
        ),
      ),
    ).toEqual([
      'campaign(1/6)',
      '  places(2/2)',
      '  silverstadt(0/3)',
      '    npcs(3/3)',
      'research(4/4)',
    ]);
  });

  it('fills in a level nobody wrote, because that level is how you ask for both at once', () => {
    // No note carries `npc` on its own, but `npc` is still the way to ask for allies and rivals
    // together.
    expect(shape(buildTagTree(counted(['npc/ally', 2], ['npc/rival', 1])))).toEqual([
      'npc(0/3)',
      '  ally(2/2)',
      '  rival(1/1)',
    ]);
  });

  it('counts a note under every level it wrote', () => {
    // A note tagged both `campaign` and `campaign/npcs` is counted twice under `campaign`, which
    // is what "how much is written about this" means.
    const [campaign] = buildTagTree(counted(['campaign', 1], ['campaign/npcs', 1]));
    expect(campaign?.count).toBe(1);
    expect(campaign?.total).toBe(2);
  });

  it('has nothing to show for a vault with no tags', () => {
    expect(buildTagTree([])).toEqual([]);
  });

  it('is not confused by a tag written with an empty segment', () => {
    expect(shape(buildTagTree(counted(['a//b', 1])))).toEqual(['a(0/1)', '  b(1/1)']);
    expect(buildTagTree(counted(['/', 1]))).toEqual([]);
  });

  it('keeps a tag written in another script, and one made of emoji', () => {
    // The collator puts a symbol before a letter, which is its business; what matters here is
    // that both survive the split and the nesting intact.
    expect(shape(buildTagTree(counted(['forschung/wurzeln', 1], ['🌱/keimling', 2])))).toEqual([
      '🌱(0/2)',
      '  keimling(2/2)',
      'forschung(0/1)',
      '  wurzeln(1/1)',
    ]);
  });
});

describe('isUnderTag', () => {
  it('holds for the tag itself and for everything below it', () => {
    expect(isUnderTag('campaign', 'campaign')).toBe(true);
    expect(isUnderTag('campaign/npcs', 'campaign')).toBe(true);
    expect(isUnderTag('campaign/silverstadt/npcs', 'campaign')).toBe(true);
  });

  it('does not hold for a tag that merely begins with the same letters', () => {
    expect(isUnderTag('campaigning', 'campaign')).toBe(false);
    expect(isUnderTag('campaign', 'campaign/npcs')).toBe(false);
  });
});

describe('matchesTags', () => {
  it('finds a note that only ever wrote a tag further down', () => {
    expect(matchesTags(['campaign/silverstadt/npcs'], ['campaign'])).toBe(true);
    expect(matchesTags(['research'], ['campaign'])).toBe(false);
  });

  it('is any of the tags asked for, not all of them', () => {
    expect(matchesTags(['research'], ['campaign', 'research'])).toBe(true);
  });

  it('asks nothing of a note when nothing was asked', () => {
    expect(matchesTags(['research'], [])).toBe(false);
  });
});
