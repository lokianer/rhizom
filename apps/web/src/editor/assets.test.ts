import { describe, expect, it } from 'vitest';

import { imageUrl, isImagePath } from './assets.js';

const NOTE = 'Campaign/NPCs/Mira.md';

describe('isImagePath', () => {
  it('knows the formats a browser can show', () => {
    expect(isImagePath('assets/map.PNG')).toBe(true);
    expect(isImagePath('assets/map.webp')).toBe(true);
    expect(isImagePath('Campaign/Mira.md')).toBe(false);
    expect(isImagePath('assets/handout.pdf')).toBe(false);
  });
});

describe('imageUrl', () => {
  it('serves vault paths through the asset route', () => {
    expect(imageUrl('assets/map.png', NOTE)).toBe('/api/assets/assets/map.png');
  });

  it('encodes each segment but keeps the separators', () => {
    expect(imageUrl('assets/a b/c&d.png', NOTE)).toBe('/api/assets/assets/a%20b/c%26d.png');
  });

  it('resolves explicitly relative paths against the note folder', () => {
    expect(imageUrl('./map.png', NOTE)).toBe('/api/assets/Campaign/NPCs/map.png');
    expect(imageUrl('../map.png', NOTE)).toBe('/api/assets/Campaign/map.png');
  });

  it('leaves external and site-absolute URLs alone', () => {
    expect(imageUrl('https://example.org/map.png', NOTE)).toBe('https://example.org/map.png');
    expect(imageUrl('data:image/png;base64,AAA', NOTE)).toBe('data:image/png;base64,AAA');
    expect(imageUrl('/static/map.png', NOTE)).toBe('/static/map.png');
  });
});
