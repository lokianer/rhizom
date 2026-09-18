import { describe, expect, it } from 'vitest';

import { noteHref, notePathFromLocation, notePathFromParam } from './paths.js';

describe('noteHref', () => {
  it('drops the extension and encodes each segment on its own', () => {
    expect(noteHref('Campaign/NPCs/Mira.md')).toBe('/notes/Campaign/NPCs/Mira');
    expect(noteHref('Research/Über die Wurzeln.md')).toBe(
      '/notes/Research/%C3%9Cber%20die%20Wurzeln',
    );
    expect(noteHref("Campaign/NPCs/Mira's Ledger.md")).toBe("/notes/Campaign/NPCs/Mira's%20Ledger");
  });

  it('keeps the wiki mode apart', () => {
    expect(noteHref('Home.md', 'wiki')).toBe('/wiki/Home');
  });

  it('leaves a path without a Markdown extension alone', () => {
    expect(noteHref('Notes/v2.0 Notes.md')).toBe('/notes/Notes/v2.0%20Notes');
  });
});

describe('notePathFromParam', () => {
  it('adds the extension the URL leaves out', () => {
    expect(notePathFromParam('Campaign/NPCs/Mira')).toBe('Campaign/NPCs/Mira.md');
    expect(notePathFromParam('Campaign/NPCs/Mira.md')).toBe('Campaign/NPCs/Mira.md');
  });

  it('has no note for an empty parameter', () => {
    expect(notePathFromParam(undefined)).toBeNull();
    expect(notePathFromParam('')).toBeNull();
  });
});

describe('notePathFromLocation', () => {
  it('reads the note out of a note or wiki URL', () => {
    expect(notePathFromLocation('/notes/Campaign/NPCs/Mira')).toBe('Campaign/NPCs/Mira.md');
    expect(notePathFromLocation('/wiki/Research/%C3%9Cber%20die%20Wurzeln')).toBe(
      'Research/Über die Wurzeln.md',
    );
  });

  it('has no note anywhere else', () => {
    expect(notePathFromLocation('/')).toBeNull();
    expect(notePathFromLocation('/graph')).toBeNull();
    expect(notePathFromLocation('/notes/')).toBeNull();
  });
});
