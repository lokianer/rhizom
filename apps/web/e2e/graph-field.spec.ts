import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Page } from '@playwright/test';

// The bubble field: a WebGL2 canvas (or its Canvas 2D fallback) for the bubbles, a 2D canvas
// above it for the words, DOM panels over both — the legend and the zoom control — and the info
// bar under the field that names the note under the pointer. Everything here runs against the
// example vault as the API reports it, so a spec that adds or removes notes before this one
// cannot shift the numbers the legend is checked against.
//
// The field animates: the layout spreads out, the camera glides, the bubbles grow in. Nothing
// below waits a fixed time for that; it polls for the state it needs, and "the view has come to
// rest" is read from the view itself — two exports in a row that are byte for byte the same,
// or a zoom percentage that has stopped changing.
//
// No test reaches into the controller. The ones that need a bubble on screen find it the way a
// reader would: the settled export says where the largest bubble lies, and one pointer move there
// has to bring up the pointer cursor, which the field offers over a bubble and nowhere else.
// Should that miss, the pointer searches outwards from the middle of the field.

/** The open note of the info bar tests. */
const NOTE = 'Campaign/Places/Silverstadt.md';
const NOTE_NAME = 'Silverstadt';
const INFO_HINT = 'Point at a note to see how it is linked.';

/**
 * How long the field may take to be ready. The page fetches the graph, the layout worker starts
 * and the first frames draw — on a cold CI runner that is more than Playwright's five seconds.
 */
const FIELD_READY = { timeout: 15_000 };
/**
 * How long the view may take to come to rest: the layout's settling plus a camera flight. A CI
 * runner without a GPU settles the example vault several times slower than a desk machine does.
 */
const AT_REST_MS = 40_000;
/**
 * How much of the middle of the field has to be more than ground for the bubbles to count as
 * drawn. Grown in, the example vault covers about a fifth of it with either renderer (0.21 with
 * WebGL2 and with Canvas 2D, measured 2026-09-27); a quarter of that leaves room for another
 * machine's layout and still fails a field that has drawn only a small part of itself. The polls
 * wait out the grow-in, whose first frames paint far less.
 */
const PAINTED_SHARE = 0.05;

// Most tests wait for the view to come to rest, some of them more than once; Playwright's thirty
// seconds are less than one slow wait.
test.describe.configure({ timeout: 90_000 });

type ClusterBy = 'folder' | 'tag';

interface Point {
  x: number;
  y: number;
}

interface GraphNodeBody {
  path: string;
  name: string;
  folder: string;
  cluster: string;
  degree: number;
  inDegree: number;
  outDegree: number;
}

// An uncaught exception anywhere on the page fails the test it happened in, whatever the test
// was looking at: a renderer that throws on a later frame would otherwise go unnoticed.
let pageErrors: string[] = [];

test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
});

test.afterEach(() => {
  expect(pageErrors, 'uncaught errors on the page').toEqual([]);
});

function field(page: Page) {
  return page.getByRole('img', { name: 'Graph of the vault' });
}

function legendOf(page: Page, clusterBy: ClusterBy) {
  return page
    .locator('.rz-graph-view')
    .getByRole('region', { name: clusterBy === 'tag' ? 'Tags' : 'Folders', exact: true });
}

/** The bar under the field that names the note under the pointer, else the open note. */
function infoBar(page: Page) {
  return page.locator('.rz-graph-view .rz-graph-info');
}

function zoomControl(page: Page) {
  return page.getByRole('group', { name: 'Zoom', exact: true });
}

async function zoomPercent(page: Page): Promise<number> {
  const text = await zoomControl(page).locator('output').textContent();
  // Digits only: a readout far zoomed in groups its thousands ("1,200%").
  const digits = (text ?? '').replaceAll(/\D/g, '');
  const percent = digits === '' ? Number.NaN : Number(digits);
  expect(
    Number.isFinite(percent),
    `the zoom control shows a percentage, not "${String(text)}"`,
  ).toBe(true);
  return percent;
}

/** The zoom percentage once it has stopped changing: the camera has arrived and the layout rests. */
async function settledZoomPercent(page: Page): Promise<number> {
  let last = Number.NaN;
  let unchangedSince = 0;
  await expect
    .poll(
      async () => {
        const now = await zoomPercent(page);
        if (now !== last) {
          last = now;
          unchangedSince = Date.now();
          return false;
        }
        return Date.now() - unchangedSince >= 500;
      },
      { timeout: AT_REST_MS, intervals: [100], message: 'the zoom comes to rest' },
    )
    .toBe(true);
  return last;
}

async function openField(page: Page, url = '/graph'): Promise<void> {
  await page.goto(url);
  await expect(field(page)).toBeVisible(FIELD_READY);
  await expect(legendOf(page, 'folder')).toBeVisible(FIELD_READY);
}

/** The vault's notes per cluster, as the server forms them. */
async function graphOf(page: Page, clusterBy: ClusterBy): Promise<GraphNodeBody[]> {
  const response = await page.request.get(`/api/graph?clusterBy=${clusterBy}`);
  expect(response.ok(), 'the graph API answers').toBeTruthy();
  const body = (await response.json()) as { nodes: GraphNodeBody[] };
  return body.nodes;
}

function countByCluster(nodes: readonly GraphNodeBody[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.cluster, (counts.get(node.cluster) ?? 0) + 1);
  }
  return counts;
}

function clusterName(key: string, clusterBy: ClusterBy): string {
  if (key !== '') {
    return key;
  }
  return clusterBy === 'tag' ? 'Untagged' : 'Vault root';
}

/** The legend has one row per cluster the server reports, each with that cluster's count. */
async function expectLegendToMatchVault(page: Page, clusterBy: ClusterBy): Promise<void> {
  const nodes = await graphOf(page, clusterBy);
  const counts = countByCluster(nodes);
  expect(counts.size, 'the example vault has clusters to show').toBeGreaterThan(1);

  const legend = legendOf(page, clusterBy);
  await expect(legend).toBeVisible(FIELD_READY);
  await expect(legend.getByRole('button', { expanded: true })).toContainText(
    `${String(nodes.length)} notes`,
  );
  await expect(legend.getByRole('listitem')).toHaveCount(counts.size);
  for (const [key, count] of counts) {
    const name = clusterName(key, clusterBy);
    // A row is named by what it shows, its name and count; what a click does is its description.
    const row = legend.getByRole('button', { name: `${name} ${String(count)}`, exact: true });
    await expect(row, `the legend has a row for ${name}`).toBeVisible();
    await expect(row).toHaveAccessibleDescription(
      clusterBy === 'tag' ? 'Show the tag in the field' : 'Show the folder in the field',
    );
    await expect(row.locator('.rz-graph-legend-name')).toHaveText(name);
    await expect(row.locator('.rz-graph-legend-count')).toHaveText(String(count));
  }
}

/**
 * Clicks an export button and hands back the file. With `keepPointer` the click is dispatched to
 * the button rather than made with the mouse, so the pointer stays where it is — over a legend
 * row, or holding a bubble — and what it does there is in the export.
 */
async function download(page: Page, button: string, keepPointer = false): Promise<Download> {
  const target = page.getByRole('button', { name: button, exact: true });
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    keepPointer ? target.dispatchEvent('click') : target.click(),
  ]);
  return file;
}

async function exportSvg(page: Page, keepPointer = false): Promise<string> {
  const file = await download(page, 'Export as SVG', keepPointer);
  expect(file.suggestedFilename()).toMatch(/\.svg$/);
  return readFile(await file.path(), 'utf8');
}

/**
 * The view as SVG once it has come to rest. The exporter is deterministic, so two exports in a
 * row that are the same mean nothing moved in between: the layout has settled and the camera and
 * the entry animation have finished.
 */
async function settledSvg(page: Page, keepPointer = false): Promise<string> {
  let previous: string | null = null;
  let latest = '';
  await expect
    .poll(
      async () => {
        latest = await exportSvg(page, keepPointer);
        const same = latest === previous;
        previous = latest;
        return same;
      },
      { timeout: AT_REST_MS, intervals: [250], message: 'the field comes to rest' },
    )
    .toBe(true);
  return latest;
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * The words of every `<text>` in an SVG; a label wrapped into lines is joined back up. The
 * character data between the tags is collected rather than the tags deleted, so no pattern has to
 * be trusted to remove every one of them.
 */
function textsOf(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => {
    const pieces = (match[1] ?? '')
      .split(/<[^>]*>/)
      .map((piece) => piece.trim())
      .filter((piece) => piece !== '');
    return unescapeXml(pieces.join(' '));
  });
}

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/** The view transform of the field in an exported SVG: from graph units to the field's CSS px. */
function viewOf(svg: string): ViewTransform {
  const match = /<g transform="translate\(([^,)]+),([^,)]+)\) scale\(([^)]+)\)">/.exec(svg);
  expect(match, 'the SVG has the field in a view transform').not.toBeNull();
  return { x: Number(match?.[1]), y: Number(match?.[2]), k: Number(match?.[3]) };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Bubble extends Point {
  /** CSS px on screen. */
  r: number;
}

/**
 * The bubbles of an exported SVG where the screen shows them: the bodies in the groups filled with
 * a bubble gradient — not their rims, shadows or light — through the view transform, from the
 * field's corner. The SVG is the size of the field, so its px are the screen's.
 */
function bubblesOnScreen(svg: string, box: Box): Bubble[] {
  const view = viewOf(svg);
  const bubbles: Bubble[] = [];
  for (const group of svg.matchAll(/<g fill="url\(#rz-bubble-[^"]*\)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const circles = (group[1] ?? '').matchAll(
      /<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"([^>]*)\/>/g,
    );
    for (const circle of circles) {
      if ((circle[4] ?? '').includes('fill="none"')) {
        continue; // a rim, drawn as a ring over its body
      }
      bubbles.push({
        x: box.x + view.x + view.k * Number(circle[1]),
        y: box.y + view.y + view.k * Number(circle[2]),
        r: view.k * Number(circle[3]),
      });
    }
  }
  return bubbles;
}

async function fieldBox(page: Page): Promise<Box> {
  const box = await field(page).boundingBox();
  expect(box, 'the field has a box on screen').not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The panels over the field: a point under one of them is not a point on the field. */
async function panelBoxes(page: Page): Promise<(Box | null)[]> {
  return [await legendOf(page, 'folder').boundingBox(), await zoomControl(page).boundingBox()];
}

function inside(box: Box | null, x: number, y: number, margin = 6): boolean {
  return (
    box !== null &&
    x >= box.x - margin &&
    x <= box.x + box.width + margin &&
    y >= box.y - margin &&
    y <= box.y + box.height + margin
  );
}

/** Whether a point lies on the field, clear of its edges and of the panels over it. */
function onField(box: Box, panels: readonly (Box | null)[], x: number, y: number): boolean {
  return (
    x >= box.x + 2 &&
    y >= box.y + 2 &&
    x <= box.x + box.width - 2 &&
    y <= box.y + box.height - 2 &&
    !panels.some((panel) => inside(panel, x, y))
  );
}

/**
 * The field's cursor once the pointer is at a point: a hand over empty ground, a pointer over a
 * bubble. The field sets it in the same pointer event that picks the bubble, so it needs no wait.
 */
async function cursorAt(page: Page, point: Point): Promise<string> {
  await page.mouse.move(point.x, point.y);
  return field(page).evaluate((host: { style: { cursor: string } }) => host.style.cursor);
}

/** How far apart the points of the search for a bubble lie; smaller than any bubble at fit. */
const SWEEP_STEP_PX = 10;
/** The search for a bubble gives up after this many pointer moves. */
const MAX_PROBES = 400;

/**
 * A point over some bubble. With the settled export at hand, first the middle of the largest
 * bubble in it, confirmed with one pointer move; else — or if that misses — outwards from the
 * middle of the field on a square spiral, clear of the panels, until the field shows a pointer.
 */
async function findBubble(page: Page, svg?: string): Promise<Point> {
  const box = await fieldBox(page);
  const panels = await panelBoxes(page);
  if (svg !== undefined) {
    const largest = bubblesOnScreen(svg, box)
      .filter((bubble) => onField(box, panels, bubble.x, bubble.y))
      .sort((a, b) => b.r - a.r)[0];
    if (largest !== undefined && (await cursorAt(page, largest)) === 'pointer') {
      test.info().annotations.push({ type: 'bubble-found', description: 'from the export' });
      return { x: largest.x, y: largest.y };
    }
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rings = Math.ceil(Math.max(box.width, box.height) / 2 / SWEEP_STEP_PX);
  let probes = 0;
  for (let ring = 0; ring <= rings; ring += 1) {
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) {
          continue; // only the outline of this ring; the inside was searched already
        }
        const point = { x: cx + i * SWEEP_STEP_PX, y: cy + j * SWEEP_STEP_PX };
        if (!onField(box, panels, point.x, point.y)) {
          continue;
        }
        if (probes >= MAX_PROBES) {
          throw new Error(`no bubble under the pointer in ${String(MAX_PROBES)} probes`);
        }
        probes += 1;
        if ((await cursorAt(page, point)) === 'pointer') {
          test.info().annotations.push({
            type: 'bubble-found',
            description: `by search, ${String(probes)} probes`,
          });
          return point;
        }
      }
    }
  }
  throw new Error('no bubble anywhere under the pointer');
}

/**
 * A point on empty ground near the top right corner, which the fitted view keeps clear: the field
 * keeps its hand cursor there, where over a bubble it would offer a pointer.
 */
async function findGround(page: Page): Promise<Point> {
  const box = await fieldBox(page);
  const panels = await panelBoxes(page);
  for (let step = 0; step < 20; step += 1) {
    const point = { x: box.x + box.width - 24 - step * 12, y: box.y + 24 + step * 6 };
    if (onField(box, panels, point.x, point.y) && (await cursorAt(page, point)) === 'grab') {
      return point;
    }
  }
  throw new Error('no empty ground near the top right corner of the field');
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The browser APIs the in-page decoding of a picture uses. The specs are type-checked as Node,
 * which knows nothing of them, so they are described here rather than the whole DOM being
 * pulled into the project.
 */
interface PictureApi {
  createImageBitmap: (blob: Blob) => Promise<{ width: number; height: number }>;
  OffscreenCanvas: new (
    width: number,
    height: number,
  ) => {
    getContext: (kind: '2d') => {
      drawImage: (image: unknown, x: number, y: number) => void;
      getImageData: (
        x: number,
        y: number,
        width: number,
        height: number,
      ) => { data: Uint8ClampedArray };
    } | null;
  };
}

/** The part of WebGL the renderer checks touch, described for the same reason. */
interface GlProbe {
  readonly RENDERER: number;
  isContextLost: () => boolean;
  getParameter: (name: number) => unknown;
  getExtension: (name: string) => unknown;
}

interface LoseContext {
  loseContext: () => void;
}

interface DebugRendererInfo {
  readonly UNMASKED_RENDERER_WEBGL: number;
}

interface ProbeCanvas {
  getContext: (kind: string) => unknown;
}

interface PixelStats {
  /** Share of pixels that differ clearly from the most common colour (the ground). */
  painted: number;
  width: number;
  height: number;
}

/**
 * How much of a picture is more than its ground: the share of pixels far from the most common
 * colour. The ground has a faint grain, which stays well inside the distance; bubbles and links
 * do not. Decoded in the page, so the suite needs no image library.
 */
async function pixelStatsOfPng(page: Page, png: Buffer): Promise<PixelStats> {
  return page.evaluate(async (base64) => {
    const browser = globalThis as unknown as PictureApi;
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await browser.createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ctx = new browser.OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (!ctx) {
      throw new Error('no 2D context to decode the picture with');
    }
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const channel = (i: number): number => data[i] ?? 0;
    const histogram = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const bin = ((channel(i) >> 4) << 8) | ((channel(i + 1) >> 4) << 4) | (channel(i + 2) >> 4);
      histogram.set(bin, (histogram.get(bin) ?? 0) + 1);
    }
    let mode = 0;
    let most = -1;
    for (const [bin, count] of histogram) {
      if (count > most) {
        most = count;
        mode = bin;
      }
    }
    const ground = [(mode >> 8) & 15, (mode >> 4) & 15, mode & 15].map((bin) => bin * 16 + 8);
    const far = (i: number, c: number): boolean => Math.abs(channel(i + c) - (ground[c] ?? 0)) > 48;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (far(i, 0) || far(i, 1) || far(i, 2)) {
        painted += 1;
      }
    }
    return { painted: painted / (data.length / 4), width: bitmap.width, height: bitmap.height };
  }, png.toString('base64'));
}

/**
 * The bubble layer alone, as the screen shows it: the words' canvas is hidden for the shot and
 * the shot is clipped to the middle of the field, clear of the legend and the zoom control.
 */
async function fieldPixels(page: Page): Promise<PixelStats> {
  const { x, y, width, height } = await fieldBox(page);
  const overlay = page.locator('.rz-graph-overlay');
  await overlay.evaluate((canvas: { style: { visibility: string } }) => {
    canvas.style.visibility = 'hidden';
  });
  try {
    const shot = await page.screenshot({
      clip: { x: x + width * 0.25, y: y + height * 0.15, width: width * 0.5, height: height * 0.7 },
    });
    return await pixelStatsOfPng(page, shot);
  } finally {
    await overlay.evaluate((canvas: { style: { visibility: string } }) => {
      canvas.style.visibility = '';
    });
  }
}

type RendererKind = 'webgl2' | 'canvas2d';

/** Which renderer the field got. A canvas hands back the context it already has; any other kind gives null. */
async function rendererOf(page: Page): Promise<RendererKind> {
  return page
    .locator('.rz-graph-field')
    .evaluate((canvas: ProbeCanvas): RendererKind =>
      canvas.getContext('webgl2') !== null ? 'webgl2' : 'canvas2d',
    );
}

/** Which renderer the field got, for the report: CI runners without a GPU may lack WebGL2. */
async function annotateRenderer(page: Page): Promise<RendererKind> {
  const kind = await rendererOf(page);
  test.info().annotations.push({ type: 'renderer', description: kind });
  return kind;
}

interface WebGl2Offer {
  /** Whether a fresh canvas gets a WebGL2 context at all. */
  offered: boolean;
  /** The renderer's name, as far as the browser tells it. */
  renderer: string;
  /** Whether that renderer draws on the CPU, where the field prefers Canvas 2D. */
  software: boolean;
}

/**
 * The WebGL2 this browser gives a fresh canvas, told apart the way the field tells it before it
 * chooses: by the renderer's name, which Chrome gives only through the debug extension. The probe
 * hands its context back at once, since a page keeps only a handful alive.
 */
async function webgl2Offer(page: Page): Promise<WebGl2Offer> {
  return page.evaluate(() => {
    const { document } = globalThis as unknown as {
      document: { createElement: (tag: 'canvas') => ProbeCanvas };
    };
    const gl = document.createElement('canvas').getContext('webgl2') as GlProbe | null;
    if (gl === null) {
      return { offered: false, renderer: '', software: false };
    }
    let name = gl.getParameter(gl.RENDERER);
    if (typeof name !== 'string' || name === 'WebKit WebGL') {
      const info = gl.getExtension('WEBGL_debug_renderer_info') as DebugRendererInfo | null;
      name = info === null ? name : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    }
    (gl.getExtension('WEBGL_lose_context') as LoseContext | null)?.loseContext();
    const renderer = typeof name === 'string' ? name : '';
    return {
      offered: true,
      renderer,
      software: /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer),
    };
  });
}

/**
 * Asks the field for one renderer, the way a reader whose machine the automatic choice gets wrong
 * can: `rhizom.renderer` in local storage, set before the app reads it.
 */
async function chooseRenderer(page: Page, kind: RendererKind): Promise<void> {
  await page.addInitScript((choice) => {
    const { localStorage } = globalThis as unknown as {
      localStorage: { setItem: (key: string, value: string) => void };
    };
    localStorage.setItem('rhizom.renderer', choice);
  }, kind);
}

/** The state of the field's canvas: a live or a lost WebGL2 context, or a Canvas 2D one. */
async function fieldCanvasState(page: Page): Promise<'webgl2' | 'lost' | 'canvas2d' | 'none'> {
  return page.locator('.rz-graph-field').evaluate((canvas: ProbeCanvas) => {
    const gl = canvas.getContext('webgl2') as GlProbe | null;
    if (gl !== null) {
      return gl.isContextLost() ? 'lost' : 'webgl2';
    }
    return canvas.getContext('2d') === null ? 'none' : 'canvas2d';
  });
}

test('the field draws the vault, and its legend counts the folders and then the tags', async ({
  page,
}) => {
  await openField(page);
  await annotateRenderer(page);

  // Not just an element with a name: the bubbles and links are on screen.
  let painted = 0;
  await expect
    .poll(async () => {
      painted = (await fieldPixels(page)).painted;
      return painted;
    }, FIELD_READY)
    .toBeGreaterThan(PAINTED_SHARE);
  test.info().annotations.push({ type: 'field-painted', description: painted.toFixed(4) });

  await expectLegendToMatchVault(page, 'folder');

  await page.getByLabel('Colour by').selectOption('tag');
  await expect(legendOf(page, 'folder')).toHaveCount(0);
  await expectLegendToMatchVault(page, 'tag');
});

test('the field draws with WebGL2 where a GPU offers it, and with Canvas 2D where not', async ({
  page,
}) => {
  await openField(page);
  const offer = await webgl2Offer(page);
  test.info().annotations.push({
    type: 'webgl2-offered',
    description: offer.offered ? offer.renderer : 'none',
  });
  // WebGL2 drawn in software is slower than Canvas 2D, so the field leaves it alone.
  expect(await annotateRenderer(page)).toBe(
    offer.offered && !offer.software ? 'webgl2' : 'canvas2d',
  );
});

test('the field draws with any WebGL2 the browser offers once it is asked to', async ({ page }) => {
  await chooseRenderer(page, 'webgl2');
  await openField(page);
  const offer = await webgl2Offer(page);
  expect(await annotateRenderer(page)).toBe(offer.offered ? 'webgl2' : 'canvas2d');
  await expect
    .poll(async () => (await fieldPixels(page)).painted, FIELD_READY)
    .toBeGreaterThan(PAINTED_SHARE);
});

test('a legend row lifts its cluster on hover and flies the view to it on click', async ({
  page,
}) => {
  await openField(page);
  const zoom = zoomControl(page).locator('output');
  await expect(zoom).toHaveText('100%');
  const resting = await settledSvg(page);

  // The second largest cluster: a part of the field, so fitting it is a different view.
  const legend = legendOf(page, 'folder');
  const row = legend.getByRole('listitem').nth(1).getByRole('button');
  await row.hover();
  // Exported with the pointer still on the row: the cluster is lifted and the rest sunk.
  const lifted = await settledSvg(page, true);
  expect(lifted, 'the hovered cluster changes the picture').not.toBe(resting);
  // Hovering only lights the cluster up: the view stays where it is, no single note is named,
  // the field is still there.
  expect(viewOf(lifted)).toEqual(viewOf(resting));
  await expect(field(page)).toBeVisible();
  await expect(infoBar(page)).toContainText(INFO_HINT);
  await expect(zoom).toHaveText('100%');

  // Once the pointer leaves the legend, the field is as it was.
  await page.mouse.move(0, 0);
  expect(await settledSvg(page), 'the field lets the cluster down again').toBe(resting);

  await row.click();
  await expect.poll(() => zoomPercent(page), { timeout: AT_REST_MS }).not.toBe(100);
  expect(await settledZoomPercent(page)).not.toBe(100);
});

test('the zoom control zooms in, out and back to the whole field', async ({ page }) => {
  await openField(page);
  const zoom = zoomControl(page);
  await expect(zoom.locator('output')).toHaveText('100%');

  await zoom.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoomedIn = await settledZoomPercent(page);
  expect(zoomedIn).toBeGreaterThan(100);

  await zoom.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const zoomedOut = await settledZoomPercent(page);
  expect(zoomedOut).toBeLessThan(zoomedIn);

  // Once more, so the fit below has somewhere to return from on either side of the fitted view.
  await zoom.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const furtherOut = await settledZoomPercent(page);
  expect(furtherOut).toBeLessThan(zoomedOut);
  expect(furtherOut).toBeLessThan(100);

  await zoom.getByRole('button', { name: 'Show the whole field', exact: true }).click();
  const fitted = await settledZoomPercent(page);
  expect(fitted).toBeGreaterThanOrEqual(98);
  expect(fitted).toBeLessThanOrEqual(102);
});

test('pointing at a bubble names its note in the info bar, and clicking it opens the note', async ({
  page,
}) => {
  await openField(page);
  const nodes = await graphOf(page, 'folder');
  const info = infoBar(page);
  await expect(info).toContainText(INFO_HINT);

  // Only a field at rest keeps a bubble where the pointer found it.
  const bubble = await findBubble(page, await settledSvg(page));

  const name = info.locator('.rz-graph-info-name');
  await expect(name).not.toBeEmpty();
  await expect(info).not.toContainText(INFO_HINT);
  await expect(info).toContainText('Backlinks');
  const shown = (await name.textContent()) ?? '';
  const folderText = (await info.locator('.rz-graph-info-folder').textContent()) ?? '';
  const folder = folderText === 'Vault root' ? '' : folderText;
  const note = nodes.find((node) => node.name === shown && node.folder === folder);
  expect(note, `"${shown}" in "${folderText}" is a note of the vault`).toBeDefined();

  // Leaving the field lets the note go again.
  await page.mouse.move(0, 0);
  await expect(info).toContainText(INFO_HINT);

  await page.mouse.click(bubble.x, bubble.y);
  const href = `/notes/${(note?.path ?? '').replace(/\.md$/, '').split('/').map(encodeURIComponent).join('/')}`;
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}$`));
});

test('the info bar names the open note and its links while the pointer is elsewhere', async ({
  page,
}) => {
  await openField(page, `/graph?note=${encodeURIComponent(NOTE)}`);
  const nodes = await graphOf(page, 'folder');
  const note = nodes.find((node) => node.path === NOTE);
  expect(note, `${NOTE} is a note of the vault`).toBeDefined();
  const { degree, inDegree, outDegree } = note ?? { degree: 0, inDegree: 0, outDegree: 0 };

  const info = infoBar(page);
  await expect(info.locator('.rz-graph-info-name')).toHaveText(NOTE_NAME);
  await expect(info.locator('.rz-graph-info-folder')).toHaveText('Campaign/Places');
  const figure = (term: string) =>
    info
      .locator('.rz-graph-info-figures > div')
      .filter({ has: page.locator('dt', { hasText: term }) })
      .locator('dd');
  await expect(figure('Backlinks')).toHaveText(String(inDegree));
  await expect(figure('Outgoing')).toHaveText(String(outDegree));

  // The rank counts the whole vault, best linked first; notes as well linked as this one may
  // stand either side of it.
  const rank = figure('Rank');
  await expect(rank.locator('.rz-graph-info-of')).toHaveText(`of ${String(nodes.length)}`);
  const place = Number.parseInt((await rank.textContent()) ?? '', 10);
  const better = nodes.filter((node) => node.degree > degree).length;
  const level = nodes.filter((node) => node.degree === degree).length;
  expect(place).toBeGreaterThanOrEqual(better + 1);
  expect(place).toBeLessThanOrEqual(better + level);
});

test('a click on empty ground lets go of the open note', async ({ page }) => {
  await openField(page, `/graph?note=${encodeURIComponent(NOTE)}`);
  const info = infoBar(page);
  await expect(info.locator('.rz-graph-info-name')).toHaveText(NOTE_NAME);

  // A field still spreading out could slide a bubble under the spot between search and click.
  await settledSvg(page);
  const spot = await findGround(page);
  expect(await cursorAt(page, spot), 'still empty ground right before the click').toBe('grab');
  await page.mouse.click(spot.x, spot.y);

  await expect(page).not.toHaveURL(/[?&]note=/);
  expect(new URL(page.url()).pathname, 'the page stays on the graph').toBe('/graph');
  await expect(info).toHaveText(INFO_HINT);
});

test('a pan on empty ground moves the view and keeps the open note', async ({ page }) => {
  await openField(page, `/graph?note=${encodeURIComponent(NOTE)}`);
  const info = infoBar(page);
  await expect(info.locator('.rz-graph-info-name')).toHaveText(NOTE_NAME);
  const before = viewOf(await settledSvg(page));

  const spot = await findGround(page);
  await page.mouse.down();
  await page.mouse.move(spot.x - 60, spot.y, { steps: 6 });
  await page.mouse.up();

  // At rest again, which is well past the moment a click would have let go of the note.
  const after = viewOf(await settledSvg(page));
  expect(after.k, 'a pan does not zoom').toBe(before.k);
  expect(after.x, 'the view moved with the pointer').toBeLessThan(before.x - 50);
  const url = new URL(page.url());
  expect(url.pathname).toBe('/graph');
  expect(url.searchParams.get('note'), 'the note is still open').toBe(NOTE);
  await expect(info.locator('.rz-graph-info-name')).toHaveText(NOTE_NAME);
});

test('dragging a bubble moves it and does not open its note', async ({ page }) => {
  await openField(page);
  const svg = await settledSvg(page);
  const bubble = await findBubble(page, svg);
  const box = await fieldBox(page);
  const panels = await panelBoxes(page);

  // Somewhere 60 px away on the field where no bubble lies yet, so the one found there while
  // the pointer holds it can only be the dragged one.
  const resting = bubblesOnScreen(svg, box);
  const target = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((step) => ({
      x: bubble.x + 60 * Math.cos((step * Math.PI) / 4),
      y: bubble.y + 60 * Math.sin((step * Math.PI) / 4),
    }))
    .find(
      (point) =>
        onField(box, panels, point.x, point.y) &&
        resting.every((other) => Math.hypot(other.x - point.x, other.y - point.y) > 12),
    );
  expect(target, 'open ground 60 px from the bubble').toBeDefined();
  const drop = target ?? bubble;

  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  let held = '';
  await expect
    .poll(
      async () => {
        held = await exportSvg(page, true);
        return bubblesOnScreen(held, box).some(
          (bubbleHeld) => Math.hypot(bubbleHeld.x - drop.x, bubbleHeld.y - drop.y) <= 3,
        );
      },
      { timeout: AT_REST_MS, message: 'the dragged bubble follows the pointer' },
    )
    .toBe(true);
  // A pan that started on the bubble would carry it to the pointer just the same; a drag moves
  // the bubble and leaves the view where it was.
  expect(viewOf(held), 'a drag does not move the view').toEqual(viewOf(svg));
  await page.mouse.up();

  const after = await settledSvg(page);
  expect(new URL(page.url()).pathname, 'a drag opens no note').toBe('/graph');
  expect(viewOf(after), 'the view stays where it was after the drag').toEqual(viewOf(svg));
});

test('the view exports as an SVG with the note names and as a PNG', async ({ page }) => {
  await openField(page);
  const names = new Set((await graphOf(page, 'folder')).map((node) => node.name));

  const svg = await settledSvg(page);
  expect(svg).toContain('<svg');
  const labelled = textsOf(svg).filter((text) => names.has(text));
  expect(labelled.length, 'the SVG names notes in <text>').toBeGreaterThan(0);

  const png = await download(page, 'Export as PNG');
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  const bytes = await readFile(await png.path());
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const box = await fieldBox(page);
  const stats = await pixelStatsOfPng(page, bytes);
  // Twice the on-screen size, and a picture of the field rather than an empty ground.
  expect(Math.abs(stats.width - box.width * 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(stats.height - box.height * 2)).toBeLessThanOrEqual(2);
  expect(stats.painted).toBeGreaterThan(0.005);
});

test('a lost WebGL context gives way to a field that paints and zooms again', async ({ page }) => {
  // Asked for, so that a runner whose WebGL2 is drawn in software has a context to lose too.
  await chooseRenderer(page, 'webgl2');
  await openField(page);
  test.skip(!(await webgl2Offer(page)).offered, 'the browser offers no WebGL2 context to lose');
  expect(await rendererOf(page)).toBe('webgl2');
  await expect
    .poll(async () => (await fieldPixels(page)).painted, FIELD_READY)
    .toBeGreaterThan(PAINTED_SHARE);

  const lost = await page.locator('.rz-graph-field').evaluate((canvas: ProbeCanvas) => {
    const gl = canvas.getContext('webgl2') as GlProbe | null;
    const lose = gl?.getExtension('WEBGL_lose_context') as LoseContext | null | undefined;
    lose?.loseContext();
    return lose !== undefined && lose !== null;
  });
  expect(lost, 'the context could be lost on purpose').toBe(true);
  expect(await fieldCanvasState(page)).toBe('lost');

  // The field waits a moment for the context to come back, then draws with Canvas 2D instead;
  // either way the canvas in the field's place paints again.
  await expect
    .poll(() => fieldCanvasState(page), {
      timeout: AT_REST_MS,
      message: 'the field has a live context again',
    })
    .not.toBe('lost');
  test.info().annotations.push({ type: 'after-loss', description: await fieldCanvasState(page) });
  await expect
    .poll(async () => (await fieldPixels(page)).painted, { timeout: AT_REST_MS })
    .toBeGreaterThan(PAINTED_SHARE);

  const zoom = zoomControl(page);
  const start = await settledZoomPercent(page);
  await zoom.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await settledZoomPercent(page)).toBeGreaterThan(start);
});

test.describe('without WebGL2', () => {
  test.beforeEach(async ({ page }) => {
    // A browser that has no WebGL2 to give: every canvas answers null to it, as it would on a
    // machine whose GPU is blocklisted.
    await page.addInitScript(() => {
      type GetContext = (this: unknown, kind: string, ...rest: unknown[]) => unknown;
      const canvas = (
        globalThis as unknown as { HTMLCanvasElement: { prototype: { getContext: GetContext } } }
      ).HTMLCanvasElement.prototype;
      const original = canvas.getContext;
      canvas.getContext = function (this: unknown, kind: string, ...rest: unknown[]): unknown {
        return kind === 'webgl2' ? null : original.call(this, kind, ...rest);
      };
    });
  });

  test('the field falls back to Canvas 2D, and the legend and exports still work', async ({
    page,
  }) => {
    await openField(page);

    // The field's canvas holds a 2D context — a canvas hands back the kind it already has — and
    // the bubbles are drawn into it, not only the words above it.
    await expect
      .poll(async () => {
        const url = await page
          .locator('.rz-graph-field')
          .evaluate((canvas: { getContext: (kind: string) => unknown; toDataURL: () => string }) =>
            canvas.getContext('2d') === null ? null : canvas.toDataURL(),
          );
        if (url === null) {
          return -1;
        }
        const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        return (await pixelStatsOfPng(page, png)).painted;
      }, FIELD_READY)
      .toBeGreaterThan(0.005);

    await expectLegendToMatchVault(page, 'folder');
    const row = legendOf(page, 'folder').getByRole('listitem').nth(1).getByRole('button');
    await row.hover();
    await row.click();
    await expect.poll(() => zoomPercent(page), { timeout: AT_REST_MS }).not.toBe(100);

    const png = await download(page, 'Export as PNG');
    const bytes = await readFile(await png.path());
    expect((await pixelStatsOfPng(page, bytes)).painted).toBeGreaterThan(0.005);
  });
});
