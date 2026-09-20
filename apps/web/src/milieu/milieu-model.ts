// The milieu field without the DOM: which notes stand where, how the field is laid out, and what
// a drag has to write.
//
// Kept apart from the component for the reason written down in panels/mention-model.ts — the web
// unit tests run without a DOM, so anything worth asserting has to be a plain function. What is
// left in the component is the drawing, the pointer and the fetching.
//
// The arithmetic of a position belongs to @rhizom/core (`readAxes`, `placementOf`, `axisValueOf`);
// this module only turns fractions into the coordinates of one particular rectangle, and answers
// the two questions core cannot: which note a query answer is about, and which index event was
// caused by our own writing.
import {
  axisValueOf,
  clusterColorIndex,
  CLUSTER_COUNT,
  placementOf,
  type AxesMissing,
  type AxesPoint,
  type AxesSettings,
  type QueryResult,
  type QueryRow,
} from '@rhizom/core';

import type { IndexRevisions } from '../app/outlet.js';
import type { ClusterBy } from '../store/ui.js';

/** The question that finds the fields themselves, the way the sidebar finds the saved searches. */
export const AXES_NOTES_QUERY = 'type: axes\nsort: title\nlimit: 500';

/**
 * The drawing is laid out in its own coordinates and scaled to whatever room it gets, so the
 * geometry is arithmetic on constants rather than on a measured element: the same numbers on
 * screen and in the exported file, and nothing here needs a browser to be tested.
 */
export const FIELD_WIDTH = 1000;
export const FIELD_HEIGHT = 700;

/** The rectangle the notes stand in. The margins around it hold the words of the two axes. */
export const PLOT = { x: 148, y: 56, width: 796, height: 548 } as const;

/** How many parts the grid cuts each axis into. Four: the quarters a reader can actually see. */
export const GRID_DIVISIONS = 4;

/** Radius of a bubble, and the gap between it and its title, in field coordinates. */
export const BUBBLE_RADIUS = 9;
export const LABEL_GAP = 15;

/** How far a pointer must travel before it counts as a drag rather than a click on the note. */
export const DRAG_THRESHOLD = 4;

/** One note a field lists, with the colour the bubble graph would give it. */
export interface FieldNote {
  path: string;
  title: string;
  /** Palette slot, from the same hash the bubble field colours its clusters by. */
  slot: number;
}

/** A note the field can draw. */
export interface PlacedNote extends FieldNote {
  point: AxesPoint;
}

/** A note that waits in the tray, and which of its two values is why. */
export interface UnplacedNote extends FieldNote {
  missing: AxesMissing;
}

/** What a field shows: the rectangle and the tray beside it. */
export interface FieldNotes {
  placed: PlacedNote[];
  unplaced: UnplacedNote[];
}

/** A pair of values as the index holds them: a number, or nothing where the note says nothing. */
export interface IndexedPosition {
  x: number | null;
  y: number | null;
}

/**
 * What a drag wrote, and what the index was saying when it did.
 *
 * Both halves in the units the file holds, not as fractions: we wrote `61.8`, the row comes back
 * saying `61.8`, and the two are equal without anybody having to pick an epsilon for a rounding
 * that happened on the way through a division by 100.
 *
 * `before` is what makes this safe to keep. The written pair stands in for what the index says
 * only while the index still says what it said at the time — so it survives the round trip, gives
 * way the moment the file agrees, and gives way just as readily to somebody who moved that note
 * in another window. Without it the bubble would be pinned to the last place this browser dropped
 * it, and a position changed anywhere else would be invisible in the only view that shows it.
 */
export interface WrittenPosition {
  wrote: { x: number; y: number };
  before: IndexedPosition;
}

/** Optimistic positions, by vault path: what a drag put on screen before the index agreed. */
export type WrittenPositions = Readonly<Record<string, WrittenPosition>>;

/** Where a fraction of the field sits in the drawing's own coordinates. */
export function fieldXy(point: AxesPoint): { x: number; y: number } {
  return {
    x: PLOT.x + point.x * PLOT.width,
    // A field's y grows upwards, the way the milieu chart is printed; a drawing's grows down.
    y: PLOT.y + (1 - point.y) * PLOT.height,
  };
}

/**
 * The fraction of the field a point in the drawing stands for: the inverse of `fieldXy`, for a
 * bubble somebody has just let go of. Clamped, so a drag that left the rectangle ends at its edge
 * rather than writing a number nobody aimed at.
 */
export function fieldPoint(x: number, y: number): AxesPoint {
  return {
    x: clamp((x - PLOT.x) / PLOT.width),
    y: clamp(1 - (y - PLOT.y) / PLOT.height),
  };
}

/** The fractions the grid draws a line at, both edges included. */
export function gridFractions(): number[] {
  return Array.from({ length: GRID_DIVISIONS + 1 }, (_, step) => step / GRID_DIVISIONS);
}

/**
 * The notes of a field, split into the ones it can draw and the ones it cannot.
 *
 * The values come from the query answer rather than from a second round of note fetches: the
 * block already listed the notes, and asking `/api/query` for the two keys as `fields` brings
 * their positions along in the same response. They arrive as text, which `placementOf` reads.
 *
 * `written` wins over what the answer says, for as long as it stands: a drag has already put the
 * bubble where the pointer left it, and an answer computed before that write would otherwise
 * pull it back for as long as the round trip takes. What makes it stand is in `WrittenPosition`.
 */
export function fieldNotes(
  rows: readonly QueryRow[],
  axes: AxesSettings,
  clusterBy: ClusterBy,
  written: WrittenPositions = {},
): FieldNotes {
  const placed: PlacedNote[] = [];
  const unplaced: UnplacedNote[] = [];
  for (const row of rows) {
    const note = { path: row.path, title: row.title, slot: slotOf(row, clusterBy) };
    const placement = placementOf(valuesOf(row, axes, written[row.path]), axes);
    if (placement.point === null) {
      unplaced.push({ ...note, missing: placement.missing });
    } else {
      placed.push({ ...note, point: placement.point });
    }
  }
  return { placed, unplaced };
}

/** The pair a row carries for a field's two keys, as numbers — what a drag has to remember. */
export function indexedPosition(row: QueryRow | undefined, axes: AxesSettings): IndexedPosition {
  return {
    x: numberOf(row?.fields[axes.x.key]),
    y: numberOf(row?.fields[axes.y.key]),
  };
}

/**
 * The frontmatter changes that put a note at a point, or null when the point cannot be written —
 * a caller dividing by the width of a field that is not on screen yet gets one of those, and the
 * honest answer is to write nothing and leave the note the values it had.
 */
export function positionChanges(
  axes: AxesSettings,
  point: AxesPoint,
): Record<string, number> | null {
  const x = axisValueOf(point.x);
  const y = axisValueOf(point.y);
  if (x === null || y === null) {
    return null;
  }
  return { [axes.x.key]: x, [axes.y.key]: y };
}

/** What `positionChanges` wrote, kept beside the pair the index was showing at the time. */
export function writtenPosition(
  axes: AxesSettings,
  changes: Readonly<Record<string, number>>,
  before: IndexedPosition,
): WrittenPosition {
  return { wrote: { x: changes[axes.x.key] ?? 0, y: changes[axes.y.key] ?? 0 }, before };
}

// --- the echo ------------------------------------------------------------------------------
//
// Dragging a bubble is the one gesture in Rhizom that changes a file by itself, and the watcher
// reports that change back like any other. Without this the field would re-ask the index for
// every note it draws each time somebody moved one, and the bubble would flicker on the way to
// the place it is already standing in.
//
// So each write is remembered as one report owed, and the view reacts to everything the index
// says except what it owes. A count per note rather than a flag, because `useIndexEvents` counts
// too and two writes to one note are two reports.
//
// A report that has come in is left on the ledger rather than struck off it. It goes on standing
// for the one event it accounted for, which is what keeps the watched count from going backwards
// when it is struck off — and it means the ledger is read, never rewritten, so nothing here needs
// an effect to keep it in step with the index. It grows by one entry per drag, and a session with
// enough drags to notice that is not a session anybody has had.

/** One report of our own the view means to ignore. */
interface AwaitedEcho {
  path: string;
  /** What the index had said about that note when the write went out. */
  seen: number;
}

/** Every write this view has made, in the order it made them. */
export type EchoLedger = readonly AwaitedEcho[];

export const NO_ECHOES: EchoLedger = [];

/**
 * Remembers that a write is going out, so the report it causes can be ignored.
 *
 * Called before the write rather than after it: the server may well have re-indexed the note and
 * streamed the event before the response to the write comes back, and a ledger that started
 * counting afterwards would swallow somebody else's next change instead of ours.
 */
export function awaitEcho(ledger: EchoLedger, path: string, revisions: IndexRevisions): EchoLedger {
  // A second write to the same note waits for a second report, not for the one the first is
  // already waiting for.
  const queued = ledger.filter((echo) => echo.path === path && !hasArrived(echo, revisions)).length;
  return [...ledger, { path, seen: (revisions.notes[path] ?? 0) + queued }];
}

/** Forgets a write that never happened — a refused save reports nothing, so nothing is owed. */
export function forgetEcho(ledger: EchoLedger, path: string): EchoLedger {
  const last = ledger.findLastIndex((echo) => echo.path === path);
  return last === -1 ? ledger : ledger.toSpliced(last, 1);
}

/**
 * How many index events the field should react to: all of them, minus the ones its own writing
 * caused.
 */
export function watchedEvents(ledger: EchoLedger, revisions: IndexRevisions): number {
  return revisions.events - ledger.filter((echo) => hasArrived(echo, revisions)).length;
}

function hasArrived(echo: AwaitedEcho, revisions: IndexRevisions): boolean {
  return (revisions.notes[echo.path] ?? 0) > echo.seen;
}

// --- the notes that declare a field --------------------------------------------------------

/** A `type: axes` note, as the control that lists them shows it. */
export interface MilieuField {
  path: string;
  title: string;
}

/**
 * The fields a `type: axes` answer describes. An answer that failed is no fields at all: the page
 * around the control says why more loudly than an entry in a list could.
 */
export function milieuFields(answer: QueryResult | null): MilieuField[] {
  return (answer?.rows ?? []).map((row) => ({
    path: row.path,
    title: row.title === '' ? row.path : row.title,
  }));
}

/**
 * The field to draw: the one that was remembered, while the vault still lists it, and otherwise
 * the first one there is. A note somebody has deleted is a note nobody can choose their way out
 * of, so being remembered is never enough on its own.
 */
export function chosenField(
  fields: readonly MilieuField[],
  remembered: string | null,
): MilieuField | null {
  return fields.find((field) => field.path === remembered) ?? fields[0] ?? null;
}

function slotOf(row: QueryRow, clusterBy: ClusterBy): number {
  return clusterColorIndex(clusterOf(row, clusterBy), CLUSTER_COUNT);
}

/** The cluster key the server would give this note: the top folder, or its first tag. */
function clusterOf(row: QueryRow, clusterBy: ClusterBy): string {
  if (clusterBy === 'tag') {
    return row.tags[0] ?? '';
  }
  const slash = row.folder.indexOf('/');
  return slash === -1 ? row.folder : row.folder.slice(0, slash);
}

/** The two values of one note, as a frontmatter record `placementOf` can read. */
function valuesOf(
  row: QueryRow,
  axes: AxesSettings,
  written: WrittenPosition | undefined,
): Record<string, unknown> {
  if (written !== undefined && stillSays(row, axes, written.before)) {
    return { [axes.x.key]: written.wrote.x, [axes.y.key]: written.wrote.y };
  }
  return { [axes.x.key]: row.fields[axes.x.key], [axes.y.key]: row.fields[axes.y.key] };
}

/** Whether the index is still saying what it said when a drag wrote over it. */
function stillSays(row: QueryRow, axes: AxesSettings, before: IndexedPosition): boolean {
  const now = indexedPosition(row, axes);
  return now.x === before.x && now.y === before.y;
}

/** A column as the number it holds, or null when it holds none — the same reading core does. */
function numberOf(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
}
