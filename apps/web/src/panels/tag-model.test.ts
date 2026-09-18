import { describe, expect, it } from 'vitest';

import { groupTags, tagChipLabel } from './tag-model.js';

describe('groupTags', () => {
  it('groups nested tags under their first segment', () => {
    const groups = groupTags([
      { tag: 'npc/ally', count: 2 },
      { tag: 'campaign/silverstadt', count: 7 },
      { tag: 'campaign', count: 4 },
      { tag: 'campaign/silverstadt/npcs', count: 3 },
    ]);

    expect(groups.map((group) => group.name)).toStrictEqual(['campaign', 'npc']);
    expect(groups[0]?.tags.map((tag) => tag.tag)).toStrictEqual([
      'campaign',
      'campaign/silverstadt',
      'campaign/silverstadt/npcs',
    ]);
    expect(groups[0]?.total).toBe(14);
    expect(groups[0]?.flat).toBe(false);
  });

  it('marks a group that is only its own tag as flat', () => {
    const groups = groupTags([{ tag: 'idea', count: 1 }]);

    expect(groups[0]).toMatchObject({ name: 'idea', total: 1, flat: true });
  });

  it('does not treat a one-entry nested group as flat', () => {
    const groups = groupTags([{ tag: 'research/pkm', count: 5 }]);

    expect(groups[0]?.flat).toBe(false);
  });

  it('returns nothing for an empty vault', () => {
    expect(groupTags([])).toStrictEqual([]);
  });
});

describe('tagChipLabel', () => {
  it('drops the prefix of the group the chip sits in', () => {
    expect(tagChipLabel('campaign/silverstadt/npcs', 'campaign')).toBe('silverstadt/npcs');
    expect(tagChipLabel('campaign', 'campaign')).toBe('campaign');
    expect(tagChipLabel('campaigns/other', 'campaign')).toBe('campaigns/other');
  });
});
