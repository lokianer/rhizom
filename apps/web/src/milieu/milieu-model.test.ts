import type { AxesSettings, QueryRow } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import type { IndexRevisions } from '../app/outlet.js';
import {
  awaitEcho,
  chosenField,
  fieldNotes,
  fieldPoint,
  fieldXy,
  forgetEcho,
  gridFractions,
  indexedPosition,
  milieuFields,
  positionChanges,
  watchedEvents,
  writtenPosition,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GRID_DIVISIONS,
  NO_ECHOES,
  PLOT,
} from './milieu-model.js';

const AXES: AxesSettings = {
  x: { key: 'outlook', from: 'tradition', to: 'change' },
  y: { key: 'standing', from: 'gutter', to: 'council' },
};

function row(path: string, fields: Record<string, string> = {}, extra: Partial<QueryRow> = {}) {
  return {
    path,
    title: path.replace(/\.md$/, ''),
    folder: 'Campaign/NPCs',
    tags: [],
    modifiedAt: '2026-09-20T10:00:00.000Z',
    size: 100,
    fields,
    ...extra,
  } satisfies QueryRow;
}

function revisions(notes: Record<string, number> = {}, events = 0, rebuilds = 0): IndexRevisions {
  return { notes, events, rebuilds };
}

describe('the geometry of a field', () => {
  it('puts the low end of each axis at the bottom left', () => {
    const corner = fieldXy({ x: 0, y: 0 });
    expect(corner).toEqual({ x: PLOT.x, y: PLOT.y + PLOT.height });
  });

  it('puts the high end of each axis at the top right, the way the chart is printed', () => {
    expect(fieldXy({ x: 1, y: 1 })).toEqual({ x: PLOT.x + PLOT.width, y: PLOT.y });
  });

  it('leaves room around the rectangle for the words of the two axes', () => {
    expect(PLOT.x).toBeGreaterThan(0);
    expect(PLOT.x + PLOT.width).toBeLessThan(FIELD_WIDTH);
    expect(PLOT.y + PLOT.height).toBeLessThan(FIELD_HEIGHT);
  });

  it('reads a point back as the fraction it was drawn from', () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.25, y: 0.8 },
    ]) {
      const { x, y } = fieldXy(point);
      expect(fieldPoint(x, y).x).toBeCloseTo(point.x);
      expect(fieldPoint(x, y).y).toBeCloseTo(point.y);
    }
  });

  it('clamps a drag that left the rectangle to its edge', () => {
    expect(fieldPoint(PLOT.x - 400, PLOT.y - 400)).toEqual({ x: 0, y: 1 });
    expect(fieldPoint(PLOT.x + PLOT.width + 400, PLOT.y + PLOT.height + 400)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('gives the grid both edges and the cuts between them', () => {
    expect(gridFractions()).toHaveLength(GRID_DIVISIONS + 1);
    expect(gridFractions()[0]).toBe(0);
    expect(gridFractions().at(-1)).toBe(1);
  });
});

describe('fieldNotes', () => {
  it('draws a note that gives both values and trays one that does not', () => {
    const { placed, unplaced } = fieldNotes(
      [
        row('a.md', { outlook: '20', standing: '80' }),
        row('b.md', { outlook: '40' }),
        row('c.md', {}),
      ],
      AXES,
      'folder',
    );

    expect(placed.map((note) => note.path)).toEqual(['a.md']);
    expect(placed[0]?.point).toEqual({ x: 0.2, y: 0.8 });
    expect(unplaced.map((note) => [note.path, note.missing])).toEqual([
      ['b.md', 'y'],
      ['c.md', 'both'],
    ]);
  });

  it('reads a value the index rendered as text, and trays one that is not a number', () => {
    const { placed, unplaced } = fieldNotes(
      [
        row('a.md', { outlook: ' 50 ', standing: '50' }),
        row('b.md', { outlook: 'soon', standing: '50' }),
      ],
      AXES,
      'folder',
    );
    expect(placed[0]?.point).toEqual({ x: 0.5, y: 0.5 });
    expect(unplaced[0]?.missing).toBe('x');
  });

  it('colours a note the way the bubble field would, and by tag when asked', () => {
    const notes = [row('a.md', { outlook: '10', standing: '10' }, { tags: ['npc/ally'] })];
    const byFolder = fieldNotes(notes, AXES, 'folder').placed[0]?.slot;
    const byTag = fieldNotes(notes, AXES, 'tag').placed[0]?.slot;
    for (const slot of [byFolder, byTag]) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(8);
    }
    // The two notes of one folder share a colour; the key that decides is a different one per mode.
    const sibling = fieldNotes(
      [row('b.md', { outlook: '10', standing: '10' }, { tags: ['npc/rival'] })],
      AXES,
      'folder',
    ).placed[0]?.slot;
    expect(sibling).toBe(byFolder);
  });

  it('shows a dragged note where it was let go, not where the index still says', () => {
    const dragged = { wrote: { x: 61.8, y: 40 }, before: { x: 20, y: 80 } };
    const rows = [row('a.md', { outlook: '20', standing: '80' })];
    const { placed } = fieldNotes(rows, AXES, 'folder', { 'a.md': dragged });
    expect(placed[0]?.point.x).toBeCloseTo(0.618);
    expect(placed[0]?.point.y).toBeCloseTo(0.4);
  });

  it('gives way once the index says what was written, without the bubble moving', () => {
    const dragged = { wrote: { x: 61.8, y: 40 }, before: { x: 20, y: 80 } };
    const rows = [row('a.md', { outlook: '61.8', standing: '40' })];
    const { placed } = fieldNotes(rows, AXES, 'folder', { 'a.md': dragged });
    expect(placed[0]?.point.x).toBeCloseTo(0.618);
    expect(placed[0]?.point.y).toBeCloseTo(0.4);
  });

  it('gives way to a position changed somewhere else', () => {
    const dragged = { wrote: { x: 61.8, y: 40 }, before: { x: 20, y: 80 } };
    const rows = [row('a.md', { outlook: '10', standing: '10' })];
    const { placed } = fieldNotes(rows, AXES, 'folder', { 'a.md': dragged });
    expect(placed[0]?.point).toEqual({ x: 0.1, y: 0.1 });
  });

  it('holds a note dragged out of the tray while the index still says nothing', () => {
    const dragged = { wrote: { x: 30, y: 30 }, before: { x: null, y: null } };
    const { placed, unplaced } = fieldNotes([row('a.md', {})], AXES, 'folder', { 'a.md': dragged });
    expect(unplaced).toHaveLength(0);
    expect(placed[0]?.point).toEqual({ x: 0.3, y: 0.3 });
  });
});

describe('indexedPosition', () => {
  it('reads what the index says for the two keys, as numbers', () => {
    expect(indexedPosition(row('a.md', { outlook: '20', standing: '80' }), AXES)).toEqual({
      x: 20,
      y: 80,
    });
  });

  it('says nothing where the note says nothing, or says something that is not a number', () => {
    expect(indexedPosition(row('a.md', { outlook: 'soon' }), AXES)).toEqual({ x: null, y: null });
    expect(indexedPosition(undefined, AXES)).toEqual({ x: null, y: null });
  });
});

describe('positionChanges', () => {
  it('names the keys the axes named, with the numbers a file will hold', () => {
    expect(positionChanges(AXES, { x: 0.618381, y: 0.4 })).toEqual({ outlook: 61.8, standing: 40 });
  });

  it('writes nothing for a point that is not a pair of numbers', () => {
    expect(positionChanges(AXES, { x: Number.NaN, y: 0.4 })).toBeNull();
  });

  it('reads its own changes back, beside what the index was saying at the time', () => {
    const changes = positionChanges(AXES, { x: 0.25, y: 0.75 });
    expect(changes).not.toBeNull();
    expect(writtenPosition(AXES, changes ?? {}, { x: 20, y: 80 })).toEqual({
      wrote: { x: 25, y: 75 },
      before: { x: 20, y: 80 },
    });
  });
});

describe('the echo of our own writing', () => {
  it('ignores the one report a write causes and nothing else', () => {
    const before = revisions({ 'a.md': 2 }, 7);
    const ledger = awaitEcho(NO_ECHOES, 'a.md', before);
    expect(watchedEvents(ledger, before)).toBe(7);

    // The watcher reports the note we just wrote: nothing to react to.
    const echo = revisions({ 'a.md': 3 }, 8);
    expect(watchedEvents(ledger, echo)).toBe(7);

    // Somebody else changes a different note: that one counts.
    const elsewhere = revisions({ 'a.md': 3, 'b.md': 1 }, 9);
    expect(watchedEvents(ledger, elsewhere)).toBe(8);
  });

  it('counts a rebuild, which says nothing about any one note', () => {
    const ledger = awaitEcho(NO_ECHOES, 'a.md', revisions({}, 0));
    expect(watchedEvents(ledger, revisions({}, 1, 1))).toBe(1);
  });

  it('goes on accounting for a report once it has arrived, so the count never falls back', () => {
    const ledger = awaitEcho(NO_ECHOES, 'a.md', revisions({ 'a.md': 1 }, 4));
    const counts = [
      watchedEvents(ledger, revisions({ 'a.md': 1 }, 4)),
      watchedEvents(ledger, revisions({ 'a.md': 2 }, 5)),
      watchedEvents(ledger, revisions({ 'a.md': 2, 'b.md': 1 }, 6)),
      watchedEvents(ledger, revisions({ 'a.md': 5, 'b.md': 1 }, 9)),
    ];
    expect(counts).toEqual([4, 4, 5, 8]);
  });

  it('waits for two reports when a note was written twice', () => {
    const start = revisions({ 'a.md': 0 }, 0);
    const ledger = awaitEcho(awaitEcho(NO_ECHOES, 'a.md', start), 'a.md', start);

    const first = revisions({ 'a.md': 1 }, 1);
    expect(watchedEvents(ledger, first)).toBe(0);
    const second = revisions({ 'a.md': 2 }, 2);
    expect(watchedEvents(ledger, second)).toBe(0);
    const third = revisions({ 'a.md': 3 }, 3);
    expect(watchedEvents(ledger, third)).toBe(1);
  });

  it('forgets a write that was refused, so the next real report is not eaten', () => {
    const start = revisions({ 'a.md': 0 }, 0);
    const ledger = forgetEcho(awaitEcho(NO_ECHOES, 'a.md', start), 'a.md');
    expect(ledger).toHaveLength(0);
    expect(watchedEvents(ledger, revisions({ 'a.md': 1 }, 1))).toBe(1);
  });

  it('forgets nothing when there is nothing owed for that note', () => {
    expect(forgetEcho(NO_ECHOES, 'a.md')).toBe(NO_ECHOES);
  });
});

describe('the notes that declare a field', () => {
  it('names a field by its title, and by its path when it has none', () => {
    const answer = {
      rows: [
        row('Campaign/Milieu.md', {}, { title: 'The people of Silverstadt' }),
        row('b.md', {}, { title: '' }),
      ],
      total: 2,
      view: 'list' as const,
      columns: [],
      problems: [],
    };
    expect(milieuFields(answer)).toEqual([
      { path: 'Campaign/Milieu.md', title: 'The people of Silverstadt' },
      { path: 'b.md', title: 'b.md' },
    ]);
    expect(milieuFields(null)).toEqual([]);
  });

  it('draws the remembered field while the vault still lists it', () => {
    const fields = [
      { path: 'a.md', title: 'A' },
      { path: 'b.md', title: 'B' },
    ];
    expect(chosenField(fields, 'b.md')?.path).toBe('b.md');
  });

  it('falls back to the first rather than stranding somebody in a field they deleted', () => {
    const fields = [{ path: 'a.md', title: 'A' }];
    expect(chosenField(fields, 'gone.md')?.path).toBe('a.md');
    expect(chosenField(fields, null)?.path).toBe('a.md');
    expect(chosenField([], 'a.md')).toBeNull();
  });
});
