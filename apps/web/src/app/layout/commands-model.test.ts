import type { NoteSummary } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { copyPath, randomNotePath } from './commands-model.js';

function note(path: string): NoteSummary {
  return {
    path,
    name: path,
    title: path,
    folder: '',
    tags: [],
    aliases: [],
    modifiedAt: '2026-01-01T00:00:00.000Z',
    size: 0,
    linkCount: 0,
    backlinkCount: 0,
  };
}

const notes = ['One.md', 'Two.md', 'Three.md'].map(note);

describe('randomNotePath', () => {
  it('takes the note the number points at', () => {
    expect(randomNotePath(notes, null, () => 0)).toBe('One.md');
    expect(randomNotePath(notes, null, () => 0.5)).toBe('Two.md');
    // A stand-in that hands back 1 would point past the end; the last note is as far as it goes.
    expect(randomNotePath(notes, null, () => 1)).toBe('Three.md');
  });

  it('never hands back the note that is already open', () => {
    // Every draw, whichever number comes up: the open note is not in the pool at all.
    for (const draw of [0, 0.34, 0.5, 0.99]) {
      expect(randomNotePath(notes, 'One.md', () => draw)).not.toBe('One.md');
    }
  });

  it('gives the one note a vault of one note has, open or not', () => {
    expect(randomNotePath([note('Only.md')], 'Only.md', () => 0)).toBe('Only.md');
  });

  it('has nothing to give in an empty vault', () => {
    expect(randomNotePath([], null, () => 0)).toBeNull();
  });
});

describe('copyPath', () => {
  it('names the first copy after the note, beside it', () => {
    expect(copyPath('Campaign/NPCs/Mira.md', new Set())).toBe('Campaign/NPCs/Mira copy.md');
    expect(copyPath('Home.md', new Set())).toBe('Home copy.md');
  });

  it('counts on while the names are taken', () => {
    const taken = new Set(['Home.md', 'Home copy.md', 'Home copy 2.md']);
    expect(copyPath('Home.md', taken)).toBe('Home copy 3.md');
  });

  it('counts on from a note that is already a copy rather than stacking the word', () => {
    const taken = new Set(['Home.md', 'Home copy.md']);
    expect(copyPath('Home copy.md', taken)).toBe('Home copy 2.md');
    expect(copyPath('Home copy 2.md', new Set(['Home copy 2.md']))).toBe('Home copy.md');
  });

  it('keeps a name in any script whole', () => {
    expect(copyPath('Templates/Übung.md', new Set())).toBe('Templates/Übung copy.md');
    expect(copyPath('Templates/🌱 Seedling.md', new Set())).toBe('Templates/🌱 Seedling copy.md');
  });
});
