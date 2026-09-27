import { describe, expect, it } from 'vitest';

import {
  EMPHASIS_CLEARANCE_PX,
  LABEL_BUDGET,
  LABEL_FONT_PX,
  LABEL_LINE_HEIGHT,
  PLATE_DOT_SPACE,
  PLATE_FONT_PX,
  PLATE_GAP_PX,
  PLATE_PAD_X,
  PLATE_PAD_Y,
  placeLabels,
  wrapLabel,
  type PlaceLabelsOptions,
} from './labels.js';
import { LabelSize, type LabelCandidate, type Rect } from './types.js';

/** Monospaced stand-in for the canvas: wide enough to matter, simple enough to reckon with. */
function measure(text: string, fontPx: number, bold: boolean): number {
  return text.length * fontPx * (bold ? 0.6 : 0.5);
}

function candidate(overrides: Partial<LabelCandidate> = {}): LabelCandidate {
  return {
    index: 0,
    text: 'Note',
    x: 400,
    y: 300,
    r: 6,
    size: LabelSize.small,
    emphasised: false,
    selected: false,
    alpha: 1,
    fill: 'rgb(127, 157, 97)',
    ...overrides,
  };
}

function options(overrides: Partial<PlaceLabelsOptions> = {}): PlaceLabelsOptions {
  return { width: 800, height: 600, reserved: [], obstacles: [], measure, ...overrides };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** A seeded generator, so the random fields are the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function field(count: number, width: number, height: number, seed = 7): LabelCandidate[] {
  const next = random(seed);
  const words = ['Moss', 'Rhizome', 'Spore', 'Hypha', 'Session notes', 'Archive', 'Über die'];
  return Array.from({ length: count }, (_, index) =>
    candidate({
      index,
      text: `${words[index % words.length] ?? 'Note'} ${String(index)}`,
      x: Math.round(next() * width),
      y: Math.round(next() * height),
      r: 2 + Math.round(next() * 26),
      size: index < 12 ? LabelSize.large : index < count / 6 ? LabelSize.medium : LabelSize.small,
    }),
  );
}

describe('placeLabels: an ordinary label', () => {
  it('sits below its bubble, three pixels clear of the rim', () => {
    const [label] = placeLabels([candidate()], options());
    const height = LABEL_FONT_PX[LabelSize.small] * LABEL_LINE_HEIGHT;
    expect(label?.x).toBe(400);
    expect(label?.y).toBeCloseTo(300 + 6 + 3 + height / 2);
    expect(label?.lines).toEqual(['Note']);
    expect(label?.inside).toBe(false);
    expect(label?.plate).toBe(false);
  });

  it('takes its font size from its rank, and only the large size is bold', () => {
    const labels = placeLabels(
      [
        candidate({ index: 0, x: 100, size: LabelSize.small }),
        candidate({ index: 1, x: 400, size: LabelSize.medium }),
        candidate({ index: 2, x: 700, size: LabelSize.large }),
      ],
      options(),
    );
    expect(labels.map((label) => [label.fontPx, label.bold])).toEqual([
      [13, false],
      [14, false],
      [16, true],
    ]);
  });

  it('is left out when its alpha is 0, and keeps its alpha otherwise', () => {
    const labels = placeLabels(
      [candidate({ index: 0, x: 200, alpha: 0 }), candidate({ index: 1, x: 600, alpha: 0.4 })],
      options(),
    );
    expect(labels.map((label) => [label.index, label.alpha])).toEqual([[1, 0.4]]);
  });

  it('is left out when it has no text or its bubble is off screen', () => {
    const labels = placeLabels(
      [
        candidate({ index: 0, text: '' }),
        candidate({ index: 1, x: -20 }),
        candidate({ index: 2, y: 700 }),
        candidate({ index: 3, x: Number.NaN }),
      ],
      options(),
    );
    expect(labels).toEqual([]);
  });

  it('places nothing into a viewport without area', () => {
    expect(placeLabels([candidate()], options({ width: 0 }))).toEqual([]);
  });

  it('tries below, above, right and left, in that order', () => {
    const block = (bottom: boolean, top: boolean, right: boolean): Rect[] => [
      ...(bottom ? [{ left: 0, top: 312, right: 800, bottom: 600 }] : []),
      ...(top ? [{ left: 0, top: 0, right: 800, bottom: 288 }] : []),
      ...(right ? [{ left: 410, top: 0, right: 800, bottom: 600 }] : []),
    ];
    const side = (reserved: Rect[]): string => {
      const [label] = placeLabels([candidate()], options({ reserved }));
      if (!label) {
        return 'none';
      }
      return label.y > 300 ? 'below' : label.y < 300 ? 'above' : label.x > 400 ? 'right' : 'left';
    };
    expect(side(block(false, false, false))).toBe('below');
    expect(side(block(true, false, false))).toBe('above');
    expect(side(block(true, true, false))).toBe('right');
    expect(side(block(true, true, true))).toBe('left');
  });

  it('never leaves the viewport', () => {
    // Below would cross the bottom edge, so the label goes above.
    const [label] = placeLabels([candidate({ y: 590 })], options());
    expect(label?.y).toBeLessThan(590);
    expect(label?.box.bottom).toBeLessThanOrEqual(600);
  });

  it('goes unlabelled when there is no room on any side', () => {
    const reserved = [{ left: 0, top: 0, right: 800, bottom: 600 }];
    expect(placeLabels([candidate()], options({ reserved }))).toEqual([]);
  });

  it('keeps clear of the region names', () => {
    const obstacles = [{ left: 350, top: 305, right: 450, bottom: 330 }];
    const [label] = placeLabels([candidate()], options({ obstacles }));
    expect(label?.y).toBeLessThan(300);
  });
});

describe('placeLabels: collisions', () => {
  it('never lets two labels overlap', () => {
    const labels = placeLabels(
      [
        candidate({ index: 0, text: 'Mycorrhizal networks', x: 400, y: 300 }),
        candidate({ index: 1, text: 'Mycorrhizal webs', x: 404, y: 300 }),
        candidate({ index: 2, text: 'Mycorrhizal threads', x: 396, y: 304 }),
      ],
      options(),
    );
    for (const a of labels) {
      for (const b of labels) {
        if (a !== b) {
          expect(overlaps(a.box, b.box)).toBe(false);
        }
      }
    }
    expect(labels[0]?.index).toBe(0); // the most important one has the first choice
  });

  it('keeps a less important label off a more important bubble', () => {
    // Below the small bubble lies the big one, so its name goes above instead.
    const labels = placeLabels(
      [
        candidate({ index: 0, text: 'A hub with a long name that wraps', x: 400, y: 200, r: 30 }),
        candidate({ index: 1, text: 'Leaf', x: 400, y: 158, r: 4 }),
      ],
      options(),
    );
    const leaf = labels.find((label) => label.index === 1);
    expect(leaf?.y).toBeLessThan(158);
  });

  it('keeps every box of a crowded field apart, on screen and off the reserved areas', () => {
    const reserved = [
      { left: 0, top: 0, right: 240, bottom: 300 },
      { left: 1860, top: 780, right: 1920, bottom: 937 },
    ];
    const labels = placeLabels(
      field(2000, 1920, 937),
      options({ width: 1920, height: 937, reserved }),
    );
    expect(labels.length).toBeGreaterThan(40);
    labels.forEach((a, i) => {
      expect(a.box.left).toBeGreaterThanOrEqual(0);
      expect(a.box.top).toBeGreaterThanOrEqual(0);
      expect(a.box.right).toBeLessThanOrEqual(1920);
      expect(a.box.bottom).toBeLessThanOrEqual(937);
      for (const rect of reserved) {
        expect(overlaps(a.box, rect)).toBe(false);
      }
      for (const b of labels.slice(i + 1)) {
        expect(overlaps(a.box, b.box)).toBe(false);
      }
    });
  });
});

describe('placeLabels: the budget', () => {
  const grid = Array.from({ length: 300 }, (_, index) =>
    candidate({ index, text: 'N', x: 20 + (index % 20) * 38, y: 20 + Math.floor(index / 20) * 38 }),
  );

  it(`stops at ${String(LABEL_BUDGET)} labels by default`, () => {
    const labels = placeLabels(grid, options());
    expect(labels).toHaveLength(LABEL_BUDGET);
    expect(labels.map((label) => label.index)).toEqual(
      Array.from({ length: LABEL_BUDGET }, (_, index) => index),
    );
  });

  it('stops at a budget of its own', () => {
    expect(placeLabels(grid, options({ budget: 5 }))).toHaveLength(5);
  });

  it('still names the emphasised notes on a budget of nothing', () => {
    const labels = placeLabels(
      [candidate({ index: 0 }), candidate({ index: 1, x: 100, emphasised: true })],
      options({ budget: 0 }),
    );
    expect(labels.map((label) => label.index)).toEqual([1]);
  });
});

describe('placeLabels: the emphasised notes', () => {
  const hovered = candidate({ index: 9, text: 'Home', emphasised: true, r: 10 });

  it('are bold, on a plate, below the bubble and clear of the selection ring', () => {
    const [label] = placeLabels([hovered], options());
    const plateHeight = PLATE_FONT_PX * LABEL_LINE_HEIGHT + PLATE_PAD_Y * 2;
    const plateWidth = measure('Home', PLATE_FONT_PX, true) + PLATE_PAD_X * 2 + PLATE_DOT_SPACE;
    expect(label).toMatchObject({ plate: true, bold: true, fontPx: PLATE_FONT_PX, inside: false });
    expect(label?.box.top).toBeCloseTo(300 + 10 + PLATE_GAP_PX);
    expect((label?.box.bottom ?? 0) - (label?.box.top ?? 0)).toBeCloseTo(plateHeight);
    expect((label?.box.right ?? 0) - (label?.box.left ?? 0)).toBeCloseTo(plateWidth);
  });

  it('centre the plate under the bubble and set the text after the cluster dot', () => {
    const [label] = placeLabels([hovered], options());
    const box = label?.box ?? { left: 0, top: 0, right: 0, bottom: 0 };
    expect((box.left + box.right) / 2).toBeCloseTo(400);
    expect(label?.x).toBeCloseTo(400 + PLATE_DOT_SPACE / 2);
    // The text keeps its padding on the right; the dot and its gap stand on the left.
    const text = measure('Home', PLATE_FONT_PX, true);
    expect(box.right - ((label?.x ?? 0) + text / 2)).toBeCloseTo(PLATE_PAD_X);
    expect((label?.x ?? 0) - text / 2 - box.left).toBeCloseTo(PLATE_PAD_X + PLATE_DOT_SPACE);
  });

  it('carry the cluster colour for the dot, and whether the note is the open one', () => {
    const open = { ...hovered, selected: true, fill: 'rgb(201, 162, 75)' };
    const other = candidate({ index: 3, x: 100, fill: 'rgb(1, 2, 3)' });
    const labels = placeLabels([open, other], options());
    expect(labels.map((label) => [label.index, label.selected, label.fill])).toEqual([
      [9, true, 'rgb(201, 162, 75)'],
      [3, false, 'rgb(1, 2, 3)'],
    ]);
    // A reused slot takes the new values rather than keeping the old ones.
    const again = placeLabels([{ ...open, selected: false }], options(), labels);
    expect(again[0]?.selected).toBe(false);
  });

  it('come first, whatever order they arrive in', () => {
    // Both want the spot below; the plate takes it, the neighbour's name moves above.
    const other = candidate({ index: 1, text: 'Other', x: 440, r: 10 });
    const labels = placeLabels([other, hovered], options());
    expect(labels[0]?.index).toBe(9);
    expect(labels[0]?.y).toBeGreaterThan(300); // below: the spot was theirs to take
    expect(labels[1]?.index).toBe(1);
    expect(labels[1]?.y).toBeLessThan(300);
  });

  it('go above when there is no room below', () => {
    const [label] = placeLabels([{ ...hovered, y: 580 }], options());
    expect(label?.y).toBeLessThan(580);
  });

  it('slide sideways rather than leave the screen', () => {
    const [label] = placeLabels([{ ...hovered, x: 3 }], options());
    expect(label?.box.left).toBeCloseTo(0);
  });

  it('are placed even where every spot is taken', () => {
    const reserved = [{ left: 0, top: 0, right: 800, bottom: 600 }];
    const [label] = placeLabels([hovered], options({ reserved }));
    expect(label?.index).toBe(9);
    expect(label?.y).toBeGreaterThan(300);
  });

  it('are forced above rather than under the legend when both spots are taken', () => {
    // Below lies under a DOM overlay, above under a region name: the plate goes where it is seen.
    const reserved = [{ left: 0, top: 305, right: 800, bottom: 600 }];
    const obstacles = [{ left: 0, top: 0, right: 800, bottom: 295 }];
    const [label] = placeLabels([hovered], options({ reserved, obstacles }));
    expect(label?.y).toBeLessThan(300);
  });

  it('keep the names of other notes off their ring and its reticle ticks', () => {
    // Just outside the bubble, below-right of it: below and above would cross the ticks.
    const leaf = candidate({ index: 2, text: 'Leaf', x: 425, y: 285, r: 3 });
    const labels = placeLabels([hovered, leaf], options());
    const label = labels.find((placedLabel) => placedLabel.index === 2);
    expect(label?.y).toBe(285);
    expect(label?.x).toBeGreaterThan(425);
    const box = label?.box;
    const nearestX = Math.max(box?.left ?? 0, Math.min(400, box?.right ?? 0));
    const nearestY = Math.max(box?.top ?? 0, Math.min(300, box?.bottom ?? 0));
    expect(Math.hypot(nearestX - 400, nearestY - 300)).toBeGreaterThanOrEqual(
      10 + EMPHASIS_CLEARANCE_PX,
    );
  });

  it('keep off each other: the second one moves above', () => {
    const labels = placeLabels(
      [hovered, candidate({ index: 4, text: 'Hub', emphasised: true, x: 404, y: 300, r: 10 })],
      options(),
    );
    const [first, second] = labels;
    expect(labels.map((label) => label.plate)).toEqual([true, true]);
    expect(first && second && overlaps(first.box, second.box)).toBe(false);
  });
});

describe('placeLabels: names inside their bubble', () => {
  const big = candidate({ text: 'NPC', r: 24, fill: '#3f6e5c' });

  it('go inside a bubble large enough, centred and bold', () => {
    const [label] = placeLabels([big], options());
    expect(label).toMatchObject({ inside: true, bold: true, x: 400, y: 300, plate: false });
  });

  it('carry the fill their ink is chosen for when they are drawn', () => {
    const [label] = placeLabels([big], options());
    expect(label?.fill).toBe('#3f6e5c');
  });

  it('go beside a bubble under 18 px', () => {
    const [label] = placeLabels([{ ...big, r: 17 }], options());
    expect(label?.inside).toBe(false);
  });

  it('go beside a bubble the name does not fit into', () => {
    const [label] = placeLabels([{ ...big, text: 'A much longer name' }], options());
    expect(label?.inside).toBe(false);
    expect(label?.y).toBeGreaterThan(300 + 24);
  });

  it('wrap inside a bubble tall enough for two lines', () => {
    const text = 'Mycorrhizal networks of the forest';
    const [label] = placeLabels([{ ...big, text, r: 150 }], options());
    expect(label?.inside).toBe(true);
    expect(label?.lines).toHaveLength(2);
  });
});

describe('placeLabels: long names', () => {
  it('wrap onto a second line, and the box grows with it', () => {
    const text = 'The Sunken Archive of Silverstadt';
    const [label] = placeLabels([candidate({ text })], options());
    expect(label?.lines).toEqual(['The Sunken Archive of', 'Silverstadt']);
    const height = (label?.box.bottom ?? 0) - (label?.box.top ?? 0);
    expect(height).toBeGreaterThan(2 * LABEL_FONT_PX[LabelSize.small] * LABEL_LINE_HEIGHT);
  });

  it('collapse white space in short names too, and leave out a name of nothing else', () => {
    const labels = placeLabels(
      [
        candidate({ index: 0, x: 200, text: ' Moss\tand  lichen ' }),
        candidate({ index: 1, x: 600, text: ' \t ' }),
        candidate({ index: 2, x: 400, y: 100, text: '  ', emphasised: true }),
      ],
      options(),
    );
    expect(labels.map((label) => [label.index, label.lines])).toEqual([[0, ['Moss and lichen']]]);
  });
});

describe('placeLabels: reuse', () => {
  it('refills the previous result rather than allocating a new one', () => {
    const candidates = field(300, 800, 600, 13);
    const fresh = placeLabels(candidates, options());
    const out = placeLabels(field(300, 800, 600, 17), options());
    const objects = out.slice();
    const again = placeLabels(candidates, options(), out);
    expect(again).toBe(out);
    expect(again).toEqual(fresh);
    // Every object the previous result had and this one still needs is the same object.
    const kept = Math.min(objects.length, again.length);
    expect(again.slice(0, kept).every((label, i) => label === objects[i])).toBe(true);
  });

  it('shortens the reused array when fewer labels fit', () => {
    const out = placeLabels(field(300, 800, 600, 13), options());
    expect(out.length).toBeGreaterThan(1);
    placeLabels([candidate()], options(), out);
    expect(out).toHaveLength(1);
    placeLabels([candidate()], options({ width: 0 }), out);
    expect(out).toHaveLength(0);
  });
});

describe('placeLabels: determinism', () => {
  it('gives the same labels for the same input', () => {
    const candidates = field(600, 1200, 800, 3);
    const first = placeLabels(candidates, options({ width: 1200, height: 800 }));
    const second = placeLabels(candidates, options({ width: 1200, height: 800 }));
    expect(second).toEqual(first);
  });

  it('gives the same labels, moved along, when the view is panned', () => {
    // A field well inside the screen, panned by whole pixels: nothing enters or leaves.
    const candidates = field(300, 500, 300, 11).map((c) => ({ ...c, x: c.x + 600, y: c.y + 300 }));
    const panned = candidates.map((c) => ({ ...c, x: c.x + 123, y: c.y - 77 }));
    const before = placeLabels(candidates, options({ width: 1920, height: 937 }));
    const after = placeLabels(panned, options({ width: 1920, height: 937 }));
    expect(after.map((label) => label.index)).toEqual(before.map((label) => label.index));
    expect(after.length).toBeGreaterThan(20);
    before.forEach((was, i) => {
      expect(after[i]?.lines).toEqual(was.lines);
      expect(after[i]?.inside).toBe(was.inside);
      expect(after[i]?.x).toBeCloseTo(was.x + 123, 6);
      expect(after[i]?.y).toBeCloseTo(was.y - 77, 6);
    });
  });
});

describe('placeLabels: speed', () => {
  it('places 2,000 candidates well within a frame', () => {
    const candidates = field(2000, 1920, 937, 5);
    const settings = options({ width: 1920, height: 937 });
    for (let i = 0; i < 5; i++) {
      placeLabels(candidates, settings); // warm up the JIT
    }
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      placeLabels(candidates, settings);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? Infinity;
    // A millisecond or less on a desktop; the margin is for a loaded CI runner.
    expect(median).toBeLessThan(8);
  });
});

describe('wrapLabel', () => {
  it('leaves a short name on one line', () => {
    expect(wrapLabel('Rhizomes')).toEqual(['Rhizomes']);
    expect(wrapLabel('Exactly twenty-two ch.')).toEqual(['Exactly twenty-two ch.']);
  });

  it('breaks at the last space that keeps the first line within the limit', () => {
    expect(wrapLabel('A fairly long note title that wraps')).toEqual([
      'A fairly long note',
      'title that wraps',
    ]);
  });

  it('breaks after a hyphen, a slash or an underscore', () => {
    expect(wrapLabel('the-quick-brown-fox-jumps-over')).toEqual([
      'the-quick-brown-fox-',
      'jumps-over',
    ]);
    expect(wrapLabel('projects/rhizom/graph_renderer')).toEqual([
      'projects/rhizom/graph_',
      'renderer',
    ]);
  });

  it('breaks straight through a word that offers no break', () => {
    const [first, second] = wrapLabel('Donaudampfschifffahrtsgesellschaftskapitän');
    expect(first).toBe('Donaudampfschifffahrts');
    expect(second).toBe('gesellschaftskapitän');
  });

  it('cuts a name longer than two lines short with an ellipsis', () => {
    const lines = wrapLabel(
      'Notes on the mycorrhizal networks under the old beech forest near the river',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Notes on the');
    expect(lines[1]?.endsWith('…')).toBe(true);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(22);
    }
  });

  it('never splits a surrogate pair', () => {
    const lines = wrapLabel(`${'x'.repeat(21)}🍄${'y'.repeat(30)}`);
    expect(lines[0]).toBe('x'.repeat(21));
    expect(lines[1]?.startsWith('🍄')).toBe(true);
  });

  it('collapses runs of white space', () => {
    expect(wrapLabel('  Moss   and\tlichen ')).toEqual(['Moss and lichen']);
  });

  it('honours a limit of its own', () => {
    expect(wrapLabel('Moss and lichen', 8)).toEqual(['Moss and', 'lichen']);
  });
});
