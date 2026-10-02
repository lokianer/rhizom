// The words a rendered note is drawn with. Core carries no language, so every place that renders a
// note hands it these: the GM lens's preview and the player view say the same thing in the same
// way. Memoised on the translation function, so a page renders again when the language changes and
// not otherwise.
import {
  CALLOUT_KINDS,
  type CalloutLabels,
  type EmbedLabels,
  type StatblockLabels,
} from '@rhizom/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** The stat-block keys the interface has words for; see `statblock.fields` in the locales. */
const STATBLOCK_FIELDS = [
  'ac',
  'hp',
  'speed',
  'saves',
  'skillsaves',
  'damage_vulnerabilities',
  'damage_resistances',
  'damage_immunities',
  'condition_immunities',
  'senses',
  'languages',
  'cr',
  'traits',
  'actions',
  'bonus_actions',
  'reactions',
  'legendary_actions',
] as const;

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export interface RenderLabels {
  labels: EmbedLabels;
  calloutLabels: CalloutLabels;
  statblockLabels: StatblockLabels;
}

export function useRenderLabels(): RenderLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      labels: {
        loading: (target) => t('embed.loading', { target }),
        missing: (target) => t('embed.missing', { target }),
        noSection: (target, heading) => t('embed.noSection', { target, heading }),
        circular: (target) => t('embed.circular', { target }),
        tooDeep: (target) => t('embed.tooDeep', { target }),
        tooMany: (target) => t('embed.tooMany', { target }),
      },
      // One word per kind of callout. The full record is what the type asks for, so a kind added
      // to the renderer cannot ship without a word for it.
      calloutLabels: Object.fromEntries(
        CALLOUT_KINDS.map((kind) => [kind, t(`callout.${kind}`)]),
      ) as CalloutLabels,
      // The keys are the ones the Fantasy Statblocks layout names; a key outside this list is
      // shown as it was written.
      statblockLabels: {
        fields: Object.fromEntries(
          STATBLOCK_FIELDS.map((key) => [key, t(`statblock.fields.${key}`)]),
        ),
        abilities: ABILITIES.map((key) => t(`statblock.abilities.${key}`)),
        problem: (message) => t('statblock.problem', { message }),
      },
    }),
    [t],
  );
}
