// The templates the campaign module brings: one per kind of note a game master writes. They are
// offered while the module is on and the new note is made inside the campaign, after the vault's
// own templates; a template of the vault's with the same name replaces the built-in one. Nothing
// is written into the vault until a note is made from one, and then it is the user's note.
//
// They are written in the interface language because they become the user's own text. That makes
// them data, not interface strings: core carries no i18n library, so the two languages sit here
// side by side as tables.
import { inCampaign, type CampaignInfo, type CampaignType } from './campaign.js';

/** The prefix a built-in template's path carries in a template choice; no vault path starts so. */
export const BUILT_IN_TEMPLATE_PREFIX = 'rhizom:campaign/';

export type TemplateLanguage = 'en' | 'de';

export interface CampaignTemplate {
  id: CampaignType;
  /** The name the dialog offers it under, and the one a vault template overrides it by. */
  name: string;
  content: string;
}

const STATBLOCK = `\`\`\`statblock
name: "{{title}}"
size: Medium
type: humanoid
alignment: neutral
ac: 12
hp: 11
speed: 30 ft.
stats: [10, 10, 10, 10, 10, 10]
actions:
  - name: Club
    desc: "Melee Weapon Attack: +2 to hit, reach 5 ft., one target. Hit: 2 (1d4) bludgeoning damage."
\`\`\``;

const EN: readonly CampaignTemplate[] = [
  {
    id: 'npc',
    name: 'NPC',
    content: `---
type: npc
faction:
location:
created: "{{date}}"
---

# {{title}}

One line: who they are and where the party met them.

## Motivation

What they want, and what they would do to get it.

## Secrets

What the party does not know yet.

## Voice

How they talk: a phrase, a habit, a word they overuse.

## Stats

${STATBLOCK}
`,
  },
  {
    id: 'place',
    name: 'Place',
    content: `---
type: place
kind:
region:
created: "{{date}}"
---

# {{title}}

What the party sees, hears and smells on arrival.

## Who is here

## What is going on

## Hooks

- [ ]
`,
  },
  {
    id: 'faction',
    name: 'Faction',
    content: `---
type: faction
leader:
seat:
created: "{{date}}"
---

# {{title}}

What they are, in one sentence a player would say.

## Goals

## Resources

## Members

## What they think of the party
`,
  },
  {
    id: 'item',
    name: 'Item',
    content: `---
type: item
rarity:
held_by:
created: "{{date}}"
---

# {{title}}

What it looks like, and what it does.

## History

## Properties
`,
  },
  {
    id: 'quest',
    name: 'Quest',
    content: `---
type: quest
status: open
giver:
created: "{{date}}"
---

# {{title}}

What is at stake, in one line.

## Leads

- [ ]

## Rewards

## Resolution
`,
  },
  {
    id: 'session',
    name: 'Session log',
    content: `---
type: session
session:
date: "{{date}}"
---

# {{title}}

## Previously

## What happened

## Loot

| Item | Who has it |
| --- | --- |
| | |

## Threads left open

- [ ]
`,
  },
];

const DE: readonly CampaignTemplate[] = [
  {
    id: 'npc',
    name: 'NSC',
    content: `---
type: npc
faction:
location:
created: "{{date}}"
---

# {{title}}

Eine Zeile: wer das ist und wo die Gruppe ihn oder sie getroffen hat.

## Motivation

Was sie wollen, und was sie dafür tun würden.

## Geheimnisse

Was die Gruppe noch nicht weiß.

## Stimme

Wie sie sprechen: eine Wendung, eine Angewohnheit, ein Lieblingswort.

## Spielwerte

${STATBLOCK}
`,
  },
  {
    id: 'place',
    name: 'Ort',
    content: `---
type: place
kind:
region:
created: "{{date}}"
---

# {{title}}

Was die Gruppe bei der Ankunft sieht, hört und riecht.

## Wer hier ist

## Was hier los ist

## Aufhänger

- [ ]
`,
  },
  {
    id: 'faction',
    name: 'Fraktion',
    content: `---
type: faction
leader:
seat:
created: "{{date}}"
---

# {{title}}

Was sie sind, in einem Satz, wie ihn ein Spieler sagen würde.

## Ziele

## Mittel

## Mitglieder

## Was sie von der Gruppe halten
`,
  },
  {
    id: 'item',
    name: 'Gegenstand',
    content: `---
type: item
rarity:
held_by:
created: "{{date}}"
---

# {{title}}

Wie er aussieht, und was er tut.

## Geschichte

## Eigenschaften
`,
  },
  {
    id: 'quest',
    name: 'Quest',
    content: `---
type: quest
status: open
giver:
created: "{{date}}"
---

# {{title}}

Worum es geht, in einer Zeile.

## Spuren

- [ ]

## Belohnung

## Ausgang
`,
  },
  {
    id: 'session',
    name: 'Sitzungsprotokoll',
    content: `---
type: session
session:
date: "{{date}}"
---

# {{title}}

## Bisher

## Was passiert ist

## Beute

| Gegenstand | Wer ihn hat |
| --- | --- |
| | |

## Offene Fäden

- [ ]
`,
  },
];

export const CAMPAIGN_TEMPLATES: Readonly<Record<TemplateLanguage, readonly CampaignTemplate[]>> = {
  en: EN,
  de: DE,
};

/** The template language for an interface language: German for `de` and `de-*`, else English. */
function languageOf(language: string): TemplateLanguage {
  return language.toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
}

/**
 * The built-in templates the new-note dialog offers: none without a campaign or outside it, and
 * none that a vault template of the same name (case-insensitive) already stands for.
 */
export function campaignTemplateChoices(options: {
  campaign: CampaignInfo | null;
  /** The folder the new note is made in. */
  folder: string;
  /** The names the vault's own templates are offered under. */
  vaultTemplateNames: readonly string[];
  language: string;
}): { path: string; name: string }[] {
  const { campaign, folder } = options;
  if (campaign === null || !(campaign.folder === folder || inCampaign(campaign, `${folder}/`))) {
    return [];
  }
  const taken = new Set(options.vaultTemplateNames.map((name) => name.toLowerCase()));
  return (
    CAMPAIGN_TEMPLATES[languageOf(options.language)]
      // Matched against the name in every language, so a vault's `Templates/NPC.md` stands for the
      // NPC template whichever language the interface speaks today.
      .filter(
        (template) =>
          !Object.values(CAMPAIGN_TEMPLATES).some((templates) =>
            templates.some(
              (other) => other.id === template.id && taken.has(other.name.toLowerCase()),
            ),
          ),
      )
      .map((template) => ({
        path: `${BUILT_IN_TEMPLATE_PREFIX}${template.id}`,
        name: template.name,
      }))
  );
}

/** The text of a built-in template, by the path its choice carries; undefined for anything else. */
export function builtInTemplate(path: string, language: string): string | undefined {
  if (!path.startsWith(BUILT_IN_TEMPLATE_PREFIX)) {
    return undefined;
  }
  const id = path.slice(BUILT_IN_TEMPLATE_PREFIX.length);
  return CAMPAIGN_TEMPLATES[languageOf(language)].find((template) => template.id === id)?.content;
}
