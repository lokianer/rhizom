import { describe, expect, it } from 'vitest';

import {
  fallbackLanguage,
  isSupportedLanguage,
  resolveLanguage,
  supportedLanguages,
} from './detect.js';

describe('supportedLanguages', () => {
  it('starts with English as the default and lists German second', () => {
    expect(supportedLanguages).toEqual(['en', 'de']);
    expect(fallbackLanguage).toBe('en');
  });
});

describe('isSupportedLanguage', () => {
  it('accepts exactly the supported codes', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(true);
  });

  it('rejects region tags, other languages and non-strings', () => {
    expect(isSupportedLanguage('de-DE')).toBe(false);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(isSupportedLanguage(42)).toBe(false);
  });
});

describe('resolveLanguage', () => {
  it('prefers a stored choice over the browser preference', () => {
    expect(resolveLanguage('de', ['en-US', 'en'])).toBe('de');
    expect(resolveLanguage('en', ['de-DE', 'de'])).toBe('en');
  });

  it('ignores a stored value that is not a supported language', () => {
    expect(resolveLanguage('fr', ['de'])).toBe('de');
    expect(resolveLanguage('', ['de'])).toBe('de');
    expect(resolveLanguage(null, ['de'])).toBe('de');
    expect(resolveLanguage(undefined, ['de'])).toBe('de');
  });

  it('matches browser preferences by their language part, in order', () => {
    expect(resolveLanguage(null, ['de-AT', 'en'])).toBe('de');
    expect(resolveLanguage(null, ['fr-CH', 'de-CH', 'en'])).toBe('de');
    expect(resolveLanguage(null, ['fr', 'en-GB'])).toBe('en');
  });

  it('is case-insensitive for browser preferences', () => {
    expect(resolveLanguage(null, ['DE-de'])).toBe('de');
  });

  it('falls back to English when nothing matches', () => {
    expect(resolveLanguage(null, ['fr', 'es'])).toBe('en');
    expect(resolveLanguage(null, [])).toBe('en');
  });
});
