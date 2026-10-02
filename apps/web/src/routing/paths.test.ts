import { afterEach, describe, expect, it } from 'vitest';

import { headingHref, noteHref, notePathFromLocation, notePathFromParam } from './paths.js';
import { setCurrentVault } from './vault.js';

describe('noteHref', () => {
  afterEach(() => {
    setCurrentVault('default');
  });

  it('builds the address inside the current vault', () => {
    setCurrentVault('dnd');
    expect(noteHref('Campaign/NPCs/Mira.md')).toBe('/v/dnd/notes/Campaign/NPCs/Mira');
  });

  it('drops the extension and encodes each segment on its own', () => {
    expect(noteHref('Campaign/NPCs/Mira.md')).toBe('/v/default/notes/Campaign/NPCs/Mira');
    expect(noteHref('Research/Über die Wurzeln.md')).toBe(
      '/v/default/notes/Research/%C3%9Cber%20die%20Wurzeln',
    );
    expect(noteHref("Campaign/NPCs/Mira's Ledger.md")).toBe(
      "/v/default/notes/Campaign/NPCs/Mira's%20Ledger",
    );
  });

  it('keeps the wiki mode apart', () => {
    expect(noteHref('Home.md', 'wiki')).toBe('/v/default/wiki/Home');
  });

  it('leaves a path without a Markdown extension alone', () => {
    expect(noteHref('Notes/v2.0 Notes.md')).toBe('/v/default/notes/Notes/v2.0%20Notes');
  });
});

describe('headingHref', () => {
  it('hangs the bare slug onto the note, the way a link to a heading is written', () => {
    expect(headingHref('Campaign/Places/Silverstadt.md', 'districts')).toBe(
      '/v/default/notes/Campaign/Places/Silverstadt#districts',
    );
    expect(headingHref('Research/Über die Wurzeln.md', 'über-die-wurzeln')).toBe(
      '/v/default/notes/Research/%C3%9Cber%20die%20Wurzeln#über-die-wurzeln',
    );
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

  it('reads it inside a vault too', () => {
    expect(notePathFromLocation('/v/dnd/wiki/Campaign/NPCs/Mira')).toBe('Campaign/NPCs/Mira.md');
    expect(notePathFromLocation('/v/dnd/graph')).toBeNull();
  });

  it('has no note anywhere else', () => {
    expect(notePathFromLocation('/')).toBeNull();
    expect(notePathFromLocation('/graph')).toBeNull();
    expect(notePathFromLocation('/notes/')).toBeNull();
  });
});
