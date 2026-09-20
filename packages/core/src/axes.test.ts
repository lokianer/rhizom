import { describe, expect, it } from 'vitest';

import {
  axisValueOf,
  AXES_KEYS,
  AXIS_MAX,
  AXIS_MIN,
  placeNote,
  placementOf,
  readAxes,
  type AxesSettings,
} from './axes.js';

/** A plain field, the one most of the tests below place notes in. */
const FIELD: AxesSettings = {
  x: { key: 'openness', from: 'Tradition', to: 'Neugier' },
  y: { key: 'reach', from: 'Local', to: 'Global' },
};

function field(frontmatter: Record<string, unknown>): AxesSettings | null {
  return readAxes({ type: 'axes', ...frontmatter });
}

describe('readAxes', () => {
  it('reads the six flat keys a note declares a field with', () => {
    expect(
      field({
        xKey: 'openness',
        xFrom: 'Tradition',
        xTo: 'Neugier',
        yKey: 'reach',
        yFrom: 'Local',
        yTo: 'Global',
      }),
    ).toEqual(FIELD);
  });

  it('lists the keys it reads, so a form can offer them', () => {
    expect(AXES_KEYS).toEqual(['xKey', 'xFrom', 'xTo', 'yKey', 'yFrom', 'yTo']);
  });

  it('takes an axis with no words at its ends', () => {
    // A note whose keys are named before its words are found still has a field to look at.
    expect(field({ xKey: 'openness', yKey: 'reach' })).toEqual({
      x: { key: 'openness', from: '', to: '' },
      y: { key: 'reach', from: '', to: '' },
    });
  });

  it('refuses a note that names only one axis', () => {
    // One axis is a line. The second key is what turns a list of notes into a picture.
    expect(field({ xKey: 'openness', xFrom: 'Tradition' })).toBeNull();
    expect(field({ yKey: 'reach' })).toBeNull();
  });

  it('refuses a note with `type: axes` and nothing else', () => {
    expect(field({})).toBeNull();
    expect(readAxes({})).toBeNull();
  });

  it('refuses a key that says nothing', () => {
    expect(field({ xKey: '   ', yKey: 'reach' })).toBeNull();
    expect(field({ xKey: 'openness', yKey: null })).toBeNull();
    expect(field({ xKey: ['openness'], yKey: 'reach' })).toBeNull();
  });

  it('refuses one key used for both coordinates', () => {
    // A note has one `openness:` line, and it cannot be both of that note's coordinates.
    expect(field({ xKey: 'openness', yKey: 'openness' })).toBeNull();
    expect(field({ xKey: ' openness ', yKey: 'openness' })).toBeNull();
  });

  it('keeps two keys that differ only in case', () => {
    // YAML mappings are case-sensitive, so these really are two keys in a placed note.
    const axes = field({ xKey: 'Openness', yKey: 'openness' });
    expect(axes?.x.key).toBe('Openness');
    expect(axes?.y.key).toBe('openness');
  });

  it('does not look at `type` itself', () => {
    // Whether a note is a field is the caller's question; a note that lost its `type` line
    // should not silently lose its axes as well.
    expect(readAxes({ xKey: 'openness', yKey: 'reach' })?.x.key).toBe('openness');
    expect(readAxes({ type: 'definition', xKey: 'openness', yKey: 'reach' })).not.toBeNull();
  });

  it('reads what YAML made a number or a boolean as the words it was written with', () => {
    const axes = field({ xKey: 'openness', xFrom: 2026, xTo: true, yKey: 'reach' });
    expect(axes?.x.from).toBe('2026');
    expect(axes?.x.to).toBe('true');
  });

  it('wants the six keys in the spelling this project writes them in', () => {
    // Several spellings of one key would leave a form with no way of knowing which one a note
    // is using when it writes one back.
    expect(field({ xkey: 'openness', ykey: 'reach' })).toBeNull();
    expect(field({ XKey: 'openness', YKey: 'reach' })).toBeNull();
  });

  it('hands back non-ASCII keys and end words exactly as they were typed', () => {
    const emoji = '🌱';
    const family = '👩‍👩‍👧';
    const axes = field({
      xKey: 'Öffnung',
      xFrom: 'Tradition',
      xTo: 'Neugier',
      yKey: 'reichweite',
      yFrom: emoji,
      yTo: family,
    });
    expect(axes?.x.key).toBe('Öffnung');
    expect(axes?.x.to).toBe('Neugier');
    expect(axes?.y.from).toBe(emoji);
    // Eleven UTF-16 units, three people, one word: nothing here may count or cut characters.
    expect(axes?.y.to).toBe(family);
  });
});

describe('placeNote', () => {
  it('turns the two values into fractions of the field', () => {
    expect(placeNote({ openness: 40, reach: 70 }, FIELD)).toEqual({ x: 0.4, y: 0.7 });
  });

  it('puts the ends of the scale at the ends of the field', () => {
    expect(placeNote({ openness: AXIS_MIN, reach: AXIS_MAX }, FIELD)).toEqual({ x: 0, y: 1 });
    expect(placeNote({ openness: AXIS_MAX, reach: AXIS_MIN }, FIELD)).toEqual({ x: 1, y: 0 });
  });

  it('measures y from `yFrom`, which is the bottom', () => {
    const low = placeNote({ openness: 50, reach: 10 }, FIELD);
    const high = placeNote({ openness: 50, reach: 90 }, FIELD);
    expect(low?.y).toBeLessThan(high?.y ?? 0);
    expect(low?.y).toBeCloseTo(0.1, 10);
  });

  it('takes a value YAML gave back as a string', () => {
    // A quoted number, or one a form wrote back as text, is still where the note says it is.
    expect(placeNote({ openness: '40', reach: ' 70 ' }, FIELD)).toEqual({ x: 0.4, y: 0.7 });
  });

  it('does not read a value that is not a number', () => {
    expect(placeNote({ openness: 'soon', reach: 70 }, FIELD)).toBeNull();
    expect(placeNote({ openness: true, reach: 70 }, FIELD)).toBeNull();
    expect(placeNote({ openness: '', reach: 70 }, FIELD)).toBeNull();
    expect(placeNote({ openness: [40], reach: 70 }, FIELD)).toBeNull();
    expect(placeNote({ openness: Number.POSITIVE_INFINITY, reach: 70 }, FIELD)).toBeNull();
    expect(placeNote({ openness: Number.NaN, reach: 70 }, FIELD)).toBeNull();
  });

  it('clamps a value outside the scale for drawing, and rewrites nothing', () => {
    // Somebody rescaled their axis, or typed 150 by hand. The note sits at the edge; the file
    // keeps every character of what it says.
    const frontmatter: Record<string, unknown> = { openness: 150, reach: -20 };
    expect(placeNote(frontmatter, FIELD)).toEqual({ x: 1, y: 0 });
    expect(frontmatter).toEqual({ openness: 150, reach: -20 });
  });

  it('reads the keys the field named, not the words at its ends', () => {
    const axes: AxesSettings = {
      x: { key: 'Öffnung', from: 'Tradition', to: 'Neugier' },
      y: { key: 'reichweite', from: '', to: '' },
    };
    expect(placeNote({ Öffnung: 25, reichweite: 75 }, axes)).toEqual({ x: 0.25, y: 0.75 });
    // The end words are labels, never keys: a note does not write `Tradition: 25`.
    expect(placeNote({ Tradition: 25, Neugier: 75 }, axes)).toBeNull();
  });
});

describe('placementOf', () => {
  it('says which of the two values a note does not give', () => {
    expect(placementOf({ openness: 40, reach: 70 }, FIELD).missing).toBe('none');
    expect(placementOf({ reach: 70 }, FIELD).missing).toBe('x');
    expect(placementOf({ openness: 40 }, FIELD).missing).toBe('y');
    expect(placementOf({}, FIELD).missing).toBe('both');
  });

  it('counts a value it cannot read as one that is not there', () => {
    // Whether `soon` is a typo or a word of the vault's own is not a question arithmetic can
    // answer; either way the note waits in the tray and keeps its word.
    expect(placementOf({ openness: 'soon', reach: 'later' }, FIELD).missing).toBe('both');
    expect(placementOf({ openness: 'soon', reach: 70 }, FIELD).missing).toBe('x');
  });

  it('carries no point unless nothing is missing', () => {
    expect(placementOf({ reach: 70 }, FIELD).point).toBeNull();
    expect(placementOf({ openness: 40, reach: 70 }, FIELD).point).toEqual({ x: 0.4, y: 0.7 });
  });
});

describe('axisValueOf', () => {
  it('writes the number a fraction of the field stands for', () => {
    expect(axisValueOf(0)).toBe(AXIS_MIN);
    expect(axisValueOf(1)).toBe(AXIS_MAX);
    expect(axisValueOf(0.5)).toBe(50);
  });

  it('writes a number a person can read', () => {
    // The whole point of the rounding: a dragged note must not leave 61.83819999999999 behind
    // in a file somebody opens and edits by hand.
    expect(axisValueOf(0.6183819999999999)).toBe(61.8);
    expect(String(axisValueOf(0.6183819999999999))).toBe('61.8');
    expect(String(axisValueOf(0.07))).toBe('7');
  });

  it('keeps a tenth of a unit, which is about a pixel on a real field', () => {
    expect(axisValueOf(0.1234)).toBe(12.3);
    expect(axisValueOf(0.1235)).toBe(12.4);
  });

  it('clamps a drag that ended outside the field', () => {
    // This end writes, so it does settle on a number: 103 in a file is one nobody aimed at.
    expect(axisValueOf(1.4)).toBe(AXIS_MAX);
    expect(axisValueOf(-2)).toBe(AXIS_MIN);
  });

  it('writes nothing for a fraction that is not a number', () => {
    // A caller dividing by the width of a field that is not on screen yet gets one of these.
    expect(axisValueOf(Number.NaN)).toBeNull();
    expect(axisValueOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(axisValueOf(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('round-trips through a note: drag, write, read back', () => {
    // The rounding is a tenth of a unit, so a fraction comes back within half of a thousandth.
    for (const fraction of [0, 0.001, 0.25, 0.3333, 0.6184, 0.999, 1]) {
      const written = axisValueOf(fraction);
      expect(written).not.toBeNull();
      const point = placeNote({ openness: written, reach: written }, FIELD);
      expect(point).not.toBeNull();
      expect(Math.abs((point?.x ?? 0) - fraction)).toBeLessThanOrEqual(0.0005);
      expect(point?.y).toBe(point?.x);
    }
  });

  it('round-trips a value the file holds as a string just as well', () => {
    const written = axisValueOf(0.42);
    expect(placeNote({ openness: String(written), reach: written }, FIELD)?.x).toBeCloseTo(
      0.42,
      10,
    );
  });
});
