// Where the names go. Placement is greedy, most important first, in screen space, and checks
// every box against a uniform grid, so a few hundred candidates per frame cost a fraction of a
// millisecond. It is pure: the output depends on the arguments alone, so the same zoom gives the
// same labels however far the view is panned, apart from what enters or leaves the screen.
import {
  LabelSize,
  type LabelCandidate,
  type MeasureText,
  type Mutable,
  type PlacedLabel,
  type Rect,
} from './types.js';

/** Font size in CSS px by LabelSize: small, medium, large. Nothing on the canvas is smaller. */
export const LABEL_FONT_PX = [13, 14, 16] as const;
/** The hovered and the open note: the largest size, bold, on a plate. */
export const PLATE_FONT_PX = 16;
/** Line height as a multiple of the font size; the sprites and the plates are laid out with it. */
export const LABEL_LINE_HEIGHT = 1.25;
/** A name longer than this wraps onto a second line, and is cut short after two. */
export const LABEL_WRAP_CHARS = 22;
/** At most this many labels in one placement. */
export const LABEL_BUDGET = 220;
/** Room between the text of a plate and its edge. */
export const PLATE_PAD_X = 6;
export const PLATE_PAD_Y = 3;
/**
 * A plate names its note's cluster too: a dot of this radius in the cluster colour, PLATE_PAD_X
 * in from the plate's left end and this far before the text.
 */
export const PLATE_DOT_R = 4;
export const PLATE_DOT_GAP_PX = 6;
/** What the dot adds to the width of a plate. */
export const PLATE_DOT_SPACE = PLATE_DOT_R * 2 + PLATE_DOT_GAP_PX;
/**
 * From the rim to a plate: a pixel clear of the selection ring the overlay draws round the open
 * note, and early enough that the reticle tick on the plate's side, round cap and all, goes under
 * the plate rather than poking out of its edge.
 */
export const PLATE_GAP_PX = 6;
/**
 * Past the rim of an emphasised bubble the other labels keep off: the selection ring and the round
 * ends of its reticle ticks reach this far, and a name set over a tick cuts the open note's mark.
 */
export const EMPHASIS_CLEARANCE_PX = 13;
/** From the rim to an ordinary label. */
const LABEL_GAP_PX = 3;
/** Kept free round an ordinary label: its halo, and a little air before the next one. */
const LABEL_ROOM_PX = 2;
/** A name goes inside its bubble from this on-screen radius, if it fits within these radii. */
const INSIDE_MIN_R = 18;
const INSIDE_MAX_WIDTH = 1.7;
const INSIDE_MAX_HEIGHT = 1.2;

export interface PlaceLabelsOptions {
  /** The viewport, CSS px: no label leaves it. */
  readonly width: number;
  readonly height: number;
  /** Screen areas under the DOM overlays (the legend, the zoom control): no label goes there. */
  readonly reserved: readonly Rect[];
  /** The region names already set into the field. */
  readonly obstacles: readonly Rect[];
  readonly measure: MeasureText;
  /** At most this many labels; the default is LABEL_BUDGET. */
  readonly budget?: number | undefined;
}

/**
 * Places the labels, most important first. The emphasised candidates (the hovered and the open
 * note) are always placed, bold and on a plate, below their bubble or else above it. Every other
 * candidate is left out when its alpha is 0; it goes inside its bubble when the bubble is large
 * enough to hold it, else below, above, right or left of it — the first of these that stays on
 * screen and hits no reserved area, no region name, no label placed before it, no bubble more
 * important than its own and no ring round an emphasised one. A candidate with no room anywhere
 * goes unlabelled, and placement stops at the budget.
 *
 * Pass the previous result as `out` and its array and objects are refilled, so a placement per
 * frame allocates nothing once it has grown; nothing may hold on to a result handed back as `out`.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  options: PlaceLabelsOptions,
  out: PlacedLabel[] = [],
): PlacedLabel[] {
  const { width, height, measure, reserved } = options;
  const budget = options.budget ?? LABEL_BUDGET;
  const placed = out;
  let count = 0;
  if (!(width > 0 && height > 0)) {
    placed.length = 0;
    return placed;
  }
  grid.reset(width, height);
  for (const rect of reserved) {
    grid.addRect(rect.left, rect.top, rect.right, rect.bottom);
  }
  for (const rect of options.obstacles) {
    grid.addRect(rect.left, rect.top, rect.right, rect.bottom);
  }

  // The controller hands the emphasised ones over first; a pass of their own makes sure of it.
  for (const candidate of candidates) {
    if (!candidate.emphasised || !onScreen(candidate, width, height)) {
      continue;
    }
    const lines = linesOf(candidate.text);
    if (lines[0] === '') {
      continue;
    }
    const label = placeEmphasised(
      candidate,
      placed[count],
      lines,
      width,
      height,
      reserved,
      measure,
    );
    placed[count] = label;
    count += 1;
    grid.addRect(label.box.left, label.box.top, label.box.right, label.box.bottom);
    grid.addCircle(candidate.x, candidate.y, candidate.r);
  }
  // Only once every plate is placed, so that the two plates do not push each other off the field;
  // the rings are drawn whether the note has a name or not.
  for (const candidate of candidates) {
    if (candidate.emphasised && onScreen(candidate, width, height)) {
      grid.addCircle(candidate.x, candidate.y, candidate.r + EMPHASIS_CLEARANCE_PX);
    }
  }

  for (const candidate of candidates) {
    if (count >= budget) {
      break;
    }
    if (candidate.emphasised || !(candidate.alpha > 0) || !onScreen(candidate, width, height)) {
      continue;
    }
    const lines = linesOf(candidate.text);
    if (lines[0] === '') {
      continue;
    }
    const slot = placed[count];
    const label =
      placeInside(candidate, slot, lines, width, height, measure) ??
      placeBeside(candidate, slot, lines, width, height, measure);
    if (label !== null) {
      placed[count] = label;
      count += 1;
      grid.addRect(label.box.left, label.box.top, label.box.right, label.box.bottom);
    }
    // Its bubble now keeps the labels of every less important note off it.
    grid.addCircle(candidate.x, candidate.y, candidate.r);
  }
  placed.length = count;
  return placed;
}

function placeEmphasised(
  candidate: LabelCandidate,
  slot: PlacedLabel | undefined,
  lines: readonly string[],
  width: number,
  height: number,
  reserved: readonly Rect[],
  measure: MeasureText,
): PlacedLabel {
  const fontPx = PLATE_FONT_PX;
  const halfWidth = (blockWidth(lines, fontPx, true, measure) + PLATE_DOT_SPACE) / 2 + PLATE_PAD_X;
  const halfHeight = (lines.length * fontPx * LABEL_LINE_HEIGHT) / 2 + PLATE_PAD_Y;
  // The plate is centred under its bubble, the text beside the dot; slid sideways rather than
  // cut off where the bubble sits near the edge of the screen.
  const x = clampCentre(candidate.x, halfWidth, width);
  const below = candidate.y + candidate.r + PLATE_GAP_PX + halfHeight;
  const above = candidate.y - candidate.r - PLATE_GAP_PX - halfHeight;
  const belowFits = fits(x, below, halfWidth, halfHeight, width, height);
  const aboveFits = fits(x, above, halfWidth, halfHeight, width, height);
  let y: number;
  if (
    belowFits &&
    !grid.hits(x - halfWidth, below - halfHeight, x + halfWidth, below + halfHeight)
  ) {
    y = below;
  } else if (
    aboveFits &&
    !grid.hits(x - halfWidth, above - halfHeight, x + halfWidth, above + halfHeight)
  ) {
    y = above;
  } else if (belowFits || aboveFits) {
    // Forced over whatever is there; but a plate under the legend would not be seen at all, so
    // where only the spot above is clear of the DOM overlays, it goes there.
    const belowSeen =
      belowFits &&
      !coversAny(reserved, x - halfWidth, below - halfHeight, x + halfWidth, below + halfHeight);
    const aboveSeen =
      aboveFits &&
      !coversAny(reserved, x - halfWidth, above - halfHeight, x + halfWidth, above + halfHeight);
    y = !belowFits || (aboveSeen && !belowSeen) ? above : below;
  } else {
    // A bubble larger than the screen: the plate goes over it, but it goes on screen.
    y = clampCentre(below, halfHeight, height);
  }
  return makeLabel(
    slot,
    candidate,
    'plate',
    lines,
    x + PLATE_DOT_SPACE / 2,
    y,
    fontPx,
    true,
    halfWidth,
    halfHeight,
    x,
  );
}

function coversAny(
  rects: readonly Rect[],
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  for (const rect of rects) {
    if (left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top) {
      return true;
    }
  }
  return false;
}

function placeInside(
  candidate: LabelCandidate,
  slot: PlacedLabel | undefined,
  lines: readonly string[],
  width: number,
  height: number,
  measure: MeasureText,
): PlacedLabel | null {
  if (candidate.r < INSIDE_MIN_R) {
    return null;
  }
  const fontPx = LABEL_FONT_PX[candidate.size];
  const textHeight = lines.length * fontPx * LABEL_LINE_HEIGHT;
  if (textHeight > candidate.r * INSIDE_MAX_HEIGHT) {
    return null;
  }
  // A step heavier than beside a bubble: the glyphs sit on colour, not on the ground.
  const textWidth = blockWidth(lines, fontPx, true, measure);
  if (textWidth > candidate.r * INSIDE_MAX_WIDTH) {
    return null;
  }
  const halfWidth = textWidth / 2 + LABEL_ROOM_PX;
  const halfHeight = textHeight / 2 + LABEL_ROOM_PX;
  const { x, y } = candidate;
  if (
    !fits(x, y, halfWidth, halfHeight, width, height) ||
    grid.hits(x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight)
  ) {
    return null;
  }
  return makeLabel(slot, candidate, 'inside', lines, x, y, fontPx, true, halfWidth, halfHeight);
}

function placeBeside(
  candidate: LabelCandidate,
  slot: PlacedLabel | undefined,
  lines: readonly string[],
  width: number,
  height: number,
  measure: MeasureText,
): PlacedLabel | null {
  const fontPx = LABEL_FONT_PX[candidate.size];
  const bold = candidate.size === LabelSize.large;
  const textWidth = blockWidth(lines, fontPx, bold, measure);
  const textHeight = lines.length * fontPx * LABEL_LINE_HEIGHT;
  const halfWidth = textWidth / 2 + LABEL_ROOM_PX;
  const halfHeight = textHeight / 2 + LABEL_ROOM_PX;
  const reach = candidate.r + LABEL_GAP_PX;
  // Below, above, right, left: under a bubble is where a reader looks for its name first.
  for (let side = 0; side < 4; side++) {
    const x =
      side === 2
        ? candidate.x + reach + textWidth / 2
        : side === 3
          ? candidate.x - reach - textWidth / 2
          : candidate.x;
    const y =
      side === 0
        ? candidate.y + reach + textHeight / 2
        : side === 1
          ? candidate.y - reach - textHeight / 2
          : candidate.y;
    if (
      fits(x, y, halfWidth, halfHeight, width, height) &&
      !grid.hits(x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight)
    ) {
      return makeLabel(slot, candidate, 'beside', lines, x, y, fontPx, bold, halfWidth, halfHeight);
    }
  }
  return null;
}

/** Where a label sits: on a plate beside its bubble, inside it, or plainly beside it. */
type LabelKind = 'plate' | 'inside' | 'beside';

/**
 * Fills the slot of a previous placement where there is one, else a label of its own. The box
 * is centred on the text unless `boxX` says otherwise: a plate's box also holds the dot.
 */
function makeLabel(
  slot: PlacedLabel | undefined,
  candidate: LabelCandidate,
  kind: LabelKind,
  lines: readonly string[],
  x: number,
  y: number,
  fontPx: number,
  bold: boolean,
  halfWidth: number,
  halfHeight: number,
  boxX: number = x,
): PlacedLabel {
  const label: Mutable<PlacedLabel> = slot ?? {
    index: 0,
    lines,
    x: 0,
    y: 0,
    fontPx: 0,
    bold: false,
    inside: false,
    plate: false,
    selected: false,
    fill: '',
    alpha: 0,
    box: { left: 0, top: 0, right: 0, bottom: 0 },
  };
  label.index = candidate.index;
  label.lines = lines;
  label.x = x;
  label.y = y;
  label.fontPx = fontPx;
  label.bold = bold;
  label.inside = kind === 'inside';
  label.plate = kind === 'plate';
  label.selected = candidate.selected;
  label.fill = candidate.fill;
  label.alpha = candidate.alpha;
  const box: Mutable<Rect> = label.box;
  box.left = boxX - halfWidth;
  box.top = y - halfHeight;
  box.right = boxX + halfWidth;
  box.bottom = y + halfHeight;
  return label;
}

/** Some of the bubble is on screen: a name next to a bubble nobody can see names nothing. */
function onScreen(candidate: LabelCandidate, width: number, height: number): boolean {
  const { x, y, r } = candidate;
  return x + r >= 0 && x - r <= width && y + r >= 0 && y - r <= height;
}

function fits(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  width: number,
  height: number,
): boolean {
  return (
    x - halfWidth >= 0 && x + halfWidth <= width && y - halfHeight >= 0 && y + halfHeight <= height
  );
}

/** Keeps a box of the given half extent inside [0, extent], centring it where it cannot fit. */
function clampCentre(value: number, half: number, extent: number): number {
  return half * 2 >= extent ? extent / 2 : Math.min(Math.max(value, half), extent - half);
}

function blockWidth(
  lines: readonly string[],
  fontPx: number,
  bold: boolean,
  measure: MeasureText,
): number {
  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, measure(line, fontPx, bold));
  }
  return widest;
}

// --- wrapping ----------------------------------------------------------------------------------

/**
 * A name as it is set: one line, or two past LABEL_WRAP_CHARS characters, its white space
 * collapsed whatever its length (a name of nothing but white space comes out as ''). Remembered
 * per text, so a placement per frame neither wraps nor allocates the same lines again, and the
 * sprite cache sees the same array each time. The arrays are frozen because every placement
 * shares them.
 */
const linesMemo = new Map<string, readonly string[]>();
const LINES_MEMO_MAX = 8192;

function linesOf(text: string): readonly string[] {
  let lines = linesMemo.get(text);
  if (lines === undefined) {
    lines = Object.freeze(wrapLabel(text));
    if (linesMemo.size >= LINES_MEMO_MAX) {
      linesMemo.clear();
    }
    linesMemo.set(text, lines);
  }
  return lines;
}

/** A name may break after a hyphen, full stop, slash or underscore: file names are notes too. */
function breaksAfter(code: number): boolean {
  return code === 0x2d || code === 0x2e || code === 0x2f || code === 0x5f;
}

/** Never between the two halves of a surrogate pair, which would leave a broken glyph. */
function safeCut(text: string, at: number): number {
  const code = text.charCodeAt(at - 1);
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at;
}

/**
 * Sets a name on one line, or on two when it is longer than maxChars: the break goes after the
 * last space, hyphen, full stop, slash or underscore that keeps the first line within maxChars,
 * and straight through a word that offers none (German compounds do not). A second line that is
 * still too long is cut at a word where it can be and ends in '…'.
 */
export function wrapLabel(text: string, maxChars: number = LABEL_WRAP_CHARS): string[] {
  const max = Math.max(4, Math.floor(maxChars));
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) {
    return [clean];
  }
  const cut = breakIndex(clean, max);
  const first = clean.slice(0, cut).trimEnd();
  const rest = clean.slice(cut).trimStart();
  return [first, rest.length <= max ? rest : truncate(rest, max)];
}

function breakIndex(text: string, max: number): number {
  // A first line of a word or two is worse than a break through a word: stop searching early.
  const shortest = Math.ceil(max * 0.4);
  for (let at = max; at >= shortest; at--) {
    if (text.charCodeAt(at) === 0x20 || breaksAfter(text.charCodeAt(at - 1))) {
      return at;
    }
  }
  return safeCut(text, max);
}

/** The text cut to `max` characters, at a space where one is near, with an ellipsis. */
export function truncate(text: string, max: number): string {
  const room = max - 1; // the ellipsis takes the last place
  let cut = safeCut(text, room);
  for (let at = room; at >= Math.ceil(room * 0.6); at--) {
    if (text.charCodeAt(at) === 0x20) {
      cut = at;
      break;
    }
  }
  return `${text.slice(0, cut).replace(/[\s\-._/,;:]+$/, '')}…`;
}

// --- the collision grid ------------------------------------------------------------------------

/**
 * Small enough that a cell of a crowded overview holds only a few shapes, large enough that a
 * label spans only a few cells; measured against 48 and 64 on 2,000 candidates.
 */
const CELL_PX = 32;

/**
 * Rectangles and circles bucketed into square screen cells, so a box is tested only against what
 * lies in the cells it touches. Kept between placements and reset for each, which keeps a
 * placement per frame from allocating its grid again; the output does not depend on it.
 */
class CollisionGrid {
  #width = 0;
  #height = 0;
  #cols = 0;
  #rows = 0;
  /** First link of each cell, or -1. */
  #head = new Int32Array(0);
  /** Bounds of each shape: left, top, right, bottom; a circle is the square round it. */
  #bounds = new Float64Array(4 * 256);
  #round = new Uint8Array(256);
  #count = 0;
  /** Links from cells to shapes: a shape spanning several cells has a link in each. */
  #linkShape = new Int32Array(1024);
  #linkNext = new Int32Array(1024);
  #links = 0;

  reset(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#cols = Math.max(1, Math.ceil(width / CELL_PX));
    this.#rows = Math.max(1, Math.ceil(height / CELL_PX));
    const cells = this.#cols * this.#rows;
    if (this.#head.length < cells) {
      this.#head = new Int32Array(cells);
    }
    this.#head.fill(-1, 0, cells);
    this.#count = 0;
    this.#links = 0;
  }

  addRect(left: number, top: number, right: number, bottom: number): void {
    this.#add(left, top, right, bottom, 0);
  }

  addCircle(x: number, y: number, r: number): void {
    this.#add(x - r, y - r, x + r, y + r, 1);
  }

  /** Whether the rectangle overlaps anything added since the last reset. */
  hits(left: number, top: number, right: number, bottom: number): boolean {
    // Locals rather than fields in the innermost loop, which runs a few hundred thousand times
    // a second while the view zooms.
    const head = this.#head;
    const bounds = this.#bounds;
    const round = this.#round;
    const linkShape = this.#linkShape;
    const linkNext = this.#linkNext;
    const cols = this.#cols;
    const c0 = this.#col(left);
    const c1 = this.#col(right);
    const r1 = this.#row(bottom);
    for (let row = this.#row(top); row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let link = head[row * cols + col] ?? -1; link !== -1; link = linkNext[link] ?? -1) {
          const shape = linkShape[link] ?? 0;
          const l = bounds[shape * 4] ?? 0;
          const t = bounds[shape * 4 + 1] ?? 0;
          const r = bounds[shape * 4 + 2] ?? 0;
          const b = bounds[shape * 4 + 3] ?? 0;
          if (left >= r || right <= l || top >= b || bottom <= t) {
            continue; // most shapes in a cell are nowhere near the box
          }
          if (round[shape] === 0) {
            return true;
          }
          // The point of the rectangle nearest the centre lies inside the circle.
          const x = (l + r) / 2;
          const y = (t + b) / 2;
          const radius = (r - l) / 2;
          const dx = Math.max(left - x, 0, x - right);
          const dy = Math.max(top - y, 0, y - bottom);
          if (dx * dx + dy * dy < radius * radius) {
            return true;
          }
        }
      }
    }
    return false;
  }

  #add(left: number, top: number, right: number, bottom: number, round: number): void {
    // Off screen, or not a number: nothing on screen can hit it.
    if (!(right >= 0 && bottom >= 0 && left <= this.#width && top <= this.#height)) {
      return;
    }
    const shape = this.#count;
    if (shape >= this.#round.length) {
      this.#growShapes();
    }
    this.#count += 1;
    this.#bounds[shape * 4] = left;
    this.#bounds[shape * 4 + 1] = top;
    this.#bounds[shape * 4 + 2] = right;
    this.#bounds[shape * 4 + 3] = bottom;
    this.#round[shape] = round;
    const c0 = this.#col(left);
    const c1 = this.#col(right);
    const r1 = this.#row(bottom);
    for (let row = this.#row(top); row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.#links >= this.#linkShape.length) {
          this.#growLinks();
        }
        const cell = row * this.#cols + col;
        const link = this.#links;
        this.#links += 1;
        this.#linkShape[link] = shape;
        this.#linkNext[link] = this.#head[cell] ?? -1;
        this.#head[cell] = link;
      }
    }
  }

  #col(x: number): number {
    return Math.min(this.#cols - 1, Math.max(0, Math.floor(x / CELL_PX)));
  }

  #row(y: number): number {
    return Math.min(this.#rows - 1, Math.max(0, Math.floor(y / CELL_PX)));
  }

  #growShapes(): void {
    const size = this.#round.length * 2;
    const bounds = new Float64Array(size * 4);
    bounds.set(this.#bounds);
    this.#bounds = bounds;
    const round = new Uint8Array(size);
    round.set(this.#round);
    this.#round = round;
  }

  #growLinks(): void {
    const size = this.#linkShape.length * 2;
    const linkShape = new Int32Array(size);
    linkShape.set(this.#linkShape);
    this.#linkShape = linkShape;
    const linkNext = new Int32Array(size);
    linkNext.set(this.#linkNext);
    this.#linkNext = linkNext;
  }
}

const grid = new CollisionGrid();
