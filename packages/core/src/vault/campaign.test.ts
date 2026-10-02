import { describe, expect, it } from 'vitest';

import { campaignTypeOf, findCampaign, inCampaign } from './campaign.js';

const note = (path: string, frontmatter: Record<string, unknown>) => ({ path, frontmatter });

describe('findCampaign', () => {
  it('finds the campaign note and its folder and system', () => {
    const found = findCampaign([
      note('Home.md', {}),
      note('Campaign/Campaign.md', { type: ' Campaign ', system: 'D&D 5e (2014 rules)' }),
    ]);
    expect(found).toEqual({
      campaign: { path: 'Campaign/Campaign.md', folder: 'Campaign', system: 'D&D 5e (2014 rules)' },
      ignored: [],
    });
  });

  it('scopes the whole vault from the root and has no system when none is written', () => {
    expect(findCampaign([note('World.md', { type: 'campaign', system: 5 })]).campaign).toEqual({
      path: 'World.md',
      folder: '',
      system: null,
    });
  });

  it('takes the smallest path of several and reports the rest', () => {
    const found = findCampaign([
      note('B/Campaign.md', { type: 'campaign' }),
      note('A/Campaign.md', { type: 'campaign' }),
    ]);
    expect(found.campaign?.path).toBe('A/Campaign.md');
    expect(found.ignored).toEqual(['B/Campaign.md']);
  });

  it('has no campaign without a campaign note', () => {
    expect(findCampaign([note('Home.md', { type: 'npc' })])).toEqual({
      campaign: null,
      ignored: [],
    });
  });
});

describe('the campaign scope', () => {
  const campaign = { path: 'Campaign/Campaign.md', folder: 'Campaign', system: null };

  it('holds its folder and everything below, and nothing beside it', () => {
    expect(inCampaign(campaign, 'Campaign/NPCs/Mira.md')).toBe(true);
    expect(inCampaign(campaign, 'Campaign/Campaign.md')).toBe(true);
    expect(inCampaign(campaign, 'Campaigner/Notes.md')).toBe(false);
    expect(inCampaign(campaign, 'Home.md')).toBe(false);
    expect(inCampaign(null, 'Campaign/NPCs/Mira.md')).toBe(false);
    expect(inCampaign({ ...campaign, folder: '' }, 'Anywhere/At/All.md')).toBe(true);
  });

  it('gives the module types meaning only inside it', () => {
    expect(campaignTypeOf({ type: 'NPC' }, 'Campaign/NPCs/Mira.md', campaign)).toBe('npc');
    expect(campaignTypeOf({ type: 'npc' }, 'Templates/NPC.md', campaign)).toBeUndefined();
    expect(campaignTypeOf({ type: 'definition' }, 'Campaign/X.md', campaign)).toBeUndefined();
    expect(campaignTypeOf({ type: 'npc' }, 'Campaign/X.md', null)).toBeUndefined();
  });
});
