import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, type NoteSummary } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { templateNotes } from './template-model.js';

function note(path: string, title: string, folder: string): NoteSummary {
  return {
    path,
    name: title,
    title,
    folder,
    tags: [],
    aliases: [],
    modifiedAt: '2026-01-01T00:00:00.000Z',
    size: 0,
    linkCount: 0,
    backlinkCount: 0,
  };
}

const notes: readonly NoteSummary[] = [
  note('Campaign/NPCs/Mira.md', 'Mira', 'Campaign/NPCs'),
  // What an Obsidian vault's templates look like: the heading is the placeholder itself.
  note('Templates/NPC.md', 'NPC', 'Templates'),
  note('Templates/Campaign/Session.md', 'Session', 'Templates/Campaign'),
  // People name their notes what they like.
  note('Templates/Übung.md', 'Übung', 'Templates'),
  note('Templates/🌱 Seedling.md', 'Seedling', 'Templates'),
];

const settings = {
  folder: 'Templates',
  dateFormat: DEFAULT_DATE_FORMAT,
  timeFormat: DEFAULT_TIME_FORMAT,
};

describe('templateNotes', () => {
  it('takes the notes in the template folder, including the ones below it', () => {
    expect(templateNotes(notes, settings).map((found) => found.path)).toEqual([
      'Templates/NPC.md',
      'Templates/Campaign/Session.md',
      'Templates/Übung.md',
      'Templates/🌱 Seedling.md',
    ]);
  });

  it('takes none when the vault has no template folder', () => {
    expect(templateNotes(notes, { ...settings, folder: null })).toEqual([]);
  });
});
