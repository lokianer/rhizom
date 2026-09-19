import { describe, expect, it } from 'vitest';

import { NOTE_TYPES, noteTypeOf } from './frontmatter.js';

describe('noteTypeOf', () => {
  it('reads every reserved value', () => {
    for (const type of NOTE_TYPES) {
      expect(noteTypeOf({ type })).toBe(type);
    }
  });

  it('ignores case and surrounding space', () => {
    expect(noteTypeOf({ type: '  Definition ' })).toBe('definition');
    expect(noteTypeOf({ type: 'QUERY' })).toBe('query');
  });

  it('is undefined for a value the vault uses for itself', () => {
    expect(noteTypeOf({ type: 'article' })).toBeUndefined();
    expect(noteTypeOf({ type: 'npc' })).toBeUndefined();
  });

  it('is undefined when the key is missing or not a string', () => {
    expect(noteTypeOf({})).toBeUndefined();
    expect(noteTypeOf({ type: 42 })).toBeUndefined();
    expect(noteTypeOf({ type: ['definition'] })).toBeUndefined();
    expect(noteTypeOf({ type: null })).toBeUndefined();
    expect(noteTypeOf({ type: '' })).toBeUndefined();
  });
});
