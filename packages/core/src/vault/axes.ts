// Milieu axes: a field with two freely named directions, and the notes that stand in it — the
// picture the Sinus-Milieu studies print, drawn from a vault.
//
// A field is declared by a note, the way a saved search is: `type: axes` in the frontmatter and
// six flat keys naming the two axes. Flat on purpose. The reserved vocabulary of this project is
// small and flat for the reasons at the head of frontmatter.ts, a nested `axes:` mapping would be
// invisible to Dataview and tedious to type by hand, and the frontmatter form shows a nested
// mapping read-only — a field somebody cannot edit in the form is a field they cannot edit.
//
// A placed note says where it stands in its own frontmatter, as a number from 0 to 100 under the
// key the field named. That is the whole of the storage: no sidecar file, no position table in the
// index, nothing that goes stale when a note is renamed or a field is thrown away. Somebody
// reading `openness: 70` in a plain editor can see what it says and change it.
//
// Everything here is arithmetic on values that have already been read. Which notes a field shows
// is the query block's business, and where the field sits on a screen is the caller's: a point
// comes back as two fractions, because core has no pixels and no opinion about which way up a
// browser draws its y.

/** The six flat frontmatter keys a field is declared with, in the order a form would show them. */
export const AXES_KEYS: readonly string[] = ['xKey', 'xFrom', 'xTo', 'yKey', 'yFrom', 'yTo'];

/** The value at the `from` end of an axis. */
export const AXIS_MIN = 0;

/** The value at the `to` end. Nothing in a vault is rewritten to fit between the two; see below. */
export const AXIS_MAX = 100;

/**
 * How many decimals a dragged value is written with. One. A field is a thousand-odd pixels wide,
 * so a tenth of a unit is about a pixel — finer than anybody can aim a mouse, and coarse enough
 * that the file stays a file a person reads: a whole number would visibly move a note somebody
 * placed by hand, and the raw fraction would write `61.83819999999999` into their note.
 */
const AXIS_DECIMALS = 1;

/** One axis of a field. */
export interface Axis {
  /** The frontmatter key a placed note writes its value in, spelled as the field's note spelled it. */
  key: string;
  /**
   * The word at the `AXIS_MIN` end, empty when the note named none. Empty rather than absent
   * because an unnamed end is drawn as an end without a word, and an optional property would put
   * a `?? ''` in front of every label for a case that changes nothing.
   */
  from: string;
  /** The word at the `AXIS_MAX` end, empty when the note named none. */
  to: string;
}

/** The two axes a field is spanned by. */
export interface AxesSettings {
  /** `from` is the left end, `to` the right. */
  x: Axis;
  /** `from` is the bottom, `to` the top — the way the milieu chart is printed. */
  y: Axis;
}

/** A point in the field, as fractions of it. The caller owns the geometry and does the pixels. */
export interface AxesPoint {
  /** 0 at `x.from`, 1 at `x.to`. */
  x: number;
  /** 0 at `y.from`, which is the bottom; a renderer whose y grows downwards draws `1 - y`. */
  y: number;
}

/** Which of the two values a note does not give the field. */
export type AxesMissing = 'none' | 'x' | 'y' | 'both';

/** Where a note stands — and, when it stands nowhere, which half of the answer is missing. */
export interface AxesPlacement {
  /** The point, or null when the note is not placed. */
  point: AxesPoint | null;
  /** `none` exactly when there is a point. */
  missing: AxesMissing;
}

/**
 * The field a note declares, or null when it declares none that can be drawn.
 *
 * Usable means both axes name a key. One axis is a line, and it is the second key that turns a
 * list of notes into a picture; a note with one key has begun a field rather than declared one.
 * The end words are not required — an axis with no words is still an axis, and somebody who has
 * named their keys before they have found their words should see their field meanwhile.
 *
 * The two keys have to differ, because one value in a note cannot be both of its coordinates.
 * They are compared as written: YAML mappings are case-sensitive, so `Openness` and `openness`
 * really are two keys, and folding them together would refuse a field that works.
 *
 * `type: axes` is not read here. Whether a note is a field is the caller's question — it has
 * `noteTypeOf` for that, and asks it when it decides what to draw a note as — and asking it a
 * second time would mean a note whose `type` line was edited away silently losing its axes too.
 */
export function readAxes(frontmatter: Record<string, unknown>): AxesSettings | null {
  // The six keys are matched in the spelling this project writes them in. Accepting `xkey` and
  // `XKey` as well would give every key several spellings, and then a form that writes one of
  // them back has no way of knowing which one the note is using.
  const xKey = text(frontmatter.xKey);
  const yKey = text(frontmatter.yKey);
  if (xKey === '' || yKey === '' || xKey === yKey) {
    return null;
  }
  return {
    x: { key: xKey, from: text(frontmatter.xFrom), to: text(frontmatter.xTo) },
    y: { key: yKey, from: text(frontmatter.yFrom), to: text(frontmatter.yTo) },
  };
}

/**
 * Where a note stands in a field, and what is missing when it stands nowhere.
 *
 * A note needs both values. With one of them it is half-placed, which is no place at all, and the
 * caller keeps it in the tray — but a tray that can say which of the two is still open is worth
 * more to a reader than one that says three notes have no position.
 *
 * A value that is not a number counts as missing. `openness: soon` places a note nowhere, and
 * whether that word is a mistake or a note of somebody's own is not a question arithmetic can
 * answer; either way the note waits in the tray, and the file keeps the word.
 */
export function placementOf(
  frontmatter: Record<string, unknown>,
  axes: AxesSettings,
): AxesPlacement {
  const x = fractionOf(frontmatter[axes.x.key]);
  const y = fractionOf(frontmatter[axes.y.key]);
  if (x === null && y === null) {
    return { point: null, missing: 'both' };
  }
  if (x === null) {
    return { point: null, missing: 'x' };
  }
  if (y === null) {
    return { point: null, missing: 'y' };
  }
  return { point: { x, y }, missing: 'none' };
}

/** The point a note sits at, or null when it is not placed; `placementOf` says which value is why. */
export function placeNote(
  frontmatter: Record<string, unknown>,
  axes: AxesSettings,
): AxesPoint | null {
  return placementOf(frontmatter, axes).point;
}

/**
 * The number to write into a note's frontmatter for a fraction of the field: the inverse of
 * `placeNote`, for a note somebody has just dragged. Null when the fraction is not a finite
 * number — a caller dividing by the width of a field that is not on screen yet gets one of those,
 * and the honest answer is to write nothing and leave the note the value it had.
 *
 * A fraction outside the field is clamped, because this end writes. A drag that left the field
 * ended at its edge, and 103 in a file would be a number nobody aimed at.
 */
export function axisValueOf(fraction: number): number | null {
  if (!Number.isFinite(fraction)) {
    return null;
  }
  const value = AXIS_MIN + clamp(fraction) * (AXIS_MAX - AXIS_MIN);
  const step = 10 ** AXIS_DECIMALS;
  return Math.round(value * step) / step;
}

/**
 * A scalar as the words it was written with, trimmed, or empty when it is not one.
 *
 * A number or a boolean counts as its spelling. YAML's types are an accident of how a line was
 * typed — `yFrom: 2026` is a number and `xKey: "40"` is text, though both say exactly what they
 * mean — and a vault of daily notes has frontmatter keys that read as dates.
 *
 * Nothing else is done to the words. `Tradition`, `Neugier` and an emoji are what somebody typed;
 * a case fold or a Unicode normalisation would hand back a label they never wrote, and nothing
 * here counts characters, which no measure of a string in JavaScript does anyway. The trim is all
 * that is left: YAML has already dropped the space around anything unquoted, and a key is matched
 * against another note's key, which went through the same parser.
 */
function text(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/**
 * The fraction of the field a written value stands for, or null when it is not a position.
 *
 * A number outside the scale is clamped for drawing and for nothing else: the file keeps what it
 * says. Somebody who rescaled their axes from 0–100 to 0–10, or typed 150 by hand, has said where
 * a note goes as plainly as they could, and answering by rewriting their note is the one thing
 * rule 2 forbids. It sits at the edge until they say otherwise.
 */
function fractionOf(value: unknown): number | null {
  const written = numberOf(value);
  if (written === null) {
    return null;
  }
  return clamp((written - AXIS_MIN) / (AXIS_MAX - AXIS_MIN));
}

/**
 * The number a value holds, whether or not YAML gave it back as text. `openness: "40"` is a
 * number somebody quoted, or one a form wrote back as a string, or what a reader with a different
 * schema made of an unquoted one; reading it costs nothing, and refusing it would park a note in
 * the tray for a reason invisible in the file.
 *
 * A boolean is not a number here. `true` counts as one in C and in nothing a vault is written in.
 * Neither are infinities: 150 is a position on a scale somebody rescaled, `.inf` is not a
 * position at all.
 */
function numberOf(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // `Number('')` is 0, which is why the blank is ruled out first: an empty key is a key waiting
    // to be filled in, not a note pinned to the left edge of the field.
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Into the field, for drawing. */
function clamp(fraction: number): number {
  return Math.min(Math.max(fraction, 0), 1);
}
