import type { DailySettings } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { dailyNotePath } from './daily.js';

const settings = (overrides: Partial<DailySettings> = {}): DailySettings => ({
  folder: 'Daily',
  format: 'YYYY-MM-DD',
  template: null,
  ...overrides,
});

// A fixed day, so the test says the same thing in every time zone it is run in.
const sunday = new Date(2026, 8, 20, 9, 30);

describe('dailyNotePath', () => {
  it('puts the day, named the way the vault names it, in the folder the vault keeps them in', () => {
    expect(dailyNotePath(settings(), sunday, 'en')).toBe('Daily/2026-09-20.md');
    expect(dailyNotePath(settings({ folder: 'Journal/Tage' }), sunday, 'en')).toBe(
      'Journal/Tage/2026-09-20.md',
    );
  });

  it('lets a format make folders, which is what a vault written that way expects', () => {
    expect(dailyNotePath(settings({ format: 'YYYY/MM/DD' }), sunday, 'en')).toBe(
      'Daily/2026/09/20.md',
    );
  });

  it('names the day in the language the app is read in', () => {
    expect(dailyNotePath(settings({ format: 'dddd, D. MMMM YYYY' }), sunday, 'de')).toBe(
      'Daily/Sonntag, 20. September 2026.md',
    );
    expect(dailyNotePath(settings({ format: 'dddd' }), sunday, 'en')).toBe('Daily/Sunday.md');
  });

  it('keeps an extension the format already wrote', () => {
    expect(dailyNotePath(settings({ format: '[note-]YYYY[.md]' }), sunday, 'en')).toBe(
      'Daily/note-2026.md',
    );
  });

  it('has no answer for a vault that keeps no daily notes', () => {
    expect(dailyNotePath(settings({ folder: null }), sunday, 'en')).toBeNull();
    // A format that spells out to nothing names no note either.
    expect(dailyNotePath(settings({ format: '' }), sunday, 'en')).toBeNull();
  });
});
