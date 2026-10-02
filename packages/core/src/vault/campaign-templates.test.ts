import { describe, expect, it } from 'vitest';

import { CAMPAIGN_TYPES } from './campaign.js';
import {
  BUILT_IN_TEMPLATE_PREFIX,
  builtInTemplate,
  CAMPAIGN_TEMPLATES,
  campaignTemplateChoices,
} from './campaign-templates.js';
import { parseNote } from '../syntax/parse.js';
import { parseStatblock } from '../render/statblock.js';
import { expandTemplate } from '../syntax/template.js';

const campaign = { path: 'Campaign/Campaign.md', folder: 'Campaign', system: null };

describe('the built-in campaign templates', () => {
  it('has one per module type in both languages, each setting its type', () => {
    for (const language of ['en', 'de'] as const) {
      const templates = CAMPAIGN_TEMPLATES[language];
      expect(templates.map((template) => template.id)).toEqual([...CAMPAIGN_TYPES]);
      for (const template of templates) {
        const parsed = parseNote(template.content, { fallbackTitle: template.name });
        expect(parsed.frontmatter.type).toBe(template.id);
        expect(template.content).toContain('{{title}}');
      }
    }
  });

  it('gives the NPC a stat block skeleton that reads any title a note can have', () => {
    for (const language of ['en', 'de'] as const) {
      const npc = CAMPAIGN_TEMPLATES[language].find((template) => template.id === 'npc');
      for (const title of ['Bandit #3', '[Draft] Joe', "'Old' Tom", '@Raven', 'Null', 'True']) {
        const text = expandTemplate(npc?.content ?? '', {
          title,
          path: `Campaign/${title}.md`,
          now: new Date(2026, 9, 3),
          dateFormat: 'YYYY-MM-DD',
          timeFormat: 'HH:mm',
          locale: language,
        }).text;
        const fence = /```statblock\n([\s\S]*?)\n```/.exec(text)?.[1] ?? '';
        const block = parseStatblock(fence);
        expect('problem' in block ? block.message : block.name).toBe(title);
      }
      // Under a heading that is not called "statblock", so `#statblock` embeds the block alone.
      const headings = parseNote(npc?.content ?? '', { fallbackTitle: 'NPC' }).headings;
      expect(headings.map((heading) => heading.text.toLowerCase())).not.toContain('statblock');
    }
  });

  it('lets a vault template stand in for a built-in one in either language', () => {
    const de = campaignTemplateChoices({
      campaign,
      folder: 'Campaign',
      vaultTemplateNames: ['NPC'],
      language: 'de',
    });
    expect(de.map((choice) => choice.name)).not.toContain('NSC');
  });

  it('is offered inside the campaign only, after the vault’s own, and gives way to one of the same name', () => {
    const inside = campaignTemplateChoices({
      campaign,
      folder: 'Campaign/NPCs',
      vaultTemplateNames: ['npc', 'Session log'],
      language: 'en',
    });
    expect(inside.map((choice) => choice.name)).toEqual(['Place', 'Faction', 'Item', 'Quest']);
    expect(inside[0]?.path).toBe(`${BUILT_IN_TEMPLATE_PREFIX}place`);
    expect(
      campaignTemplateChoices({ campaign, folder: '', vaultTemplateNames: [], language: 'en' }),
    ).toEqual([]);
    expect(
      campaignTemplateChoices({
        campaign: null,
        folder: 'Campaign',
        vaultTemplateNames: [],
        language: 'en',
      }),
    ).toEqual([]);
  });

  it('speaks German when the interface does, and English for any other language', () => {
    const de = campaignTemplateChoices({
      campaign,
      folder: 'Campaign',
      vaultTemplateNames: [],
      language: 'de-DE',
    });
    expect(de.map((choice) => choice.name)).toContain('Fraktion');
    const fr = campaignTemplateChoices({
      campaign,
      folder: 'Campaign',
      vaultTemplateNames: [],
      language: 'fr',
    });
    expect(fr.map((choice) => choice.name)).toContain('Faction');
  });

  it('hands out the text of a built-in template by its path, and nothing for any other path', () => {
    expect(builtInTemplate(`${BUILT_IN_TEMPLATE_PREFIX}quest`, 'en')).toContain('type: quest');
    expect(builtInTemplate('Templates/NPC.md', 'en')).toBeUndefined();
    expect(builtInTemplate(`${BUILT_IN_TEMPLATE_PREFIX}dragon`, 'en')).toBeUndefined();
  });
});
