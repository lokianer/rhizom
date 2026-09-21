import { expect, test, type Page } from '@playwright/test';

// The milieu field, against the field the example vault brings: `Campaign/Milieus of
// Silverstadt.md` declares `type: axes` with the keys `outlook` and `standing`, and its query
// block finds the six people in `Campaign/NPCs`. Four of them give both values, Brannoc Ironweld
// gives only an outlook and Elder Wren gives neither, so the rectangle and the tray both have
// something to show without this spec writing a single note to set them up.
//
// The drag is driven with the mouse, which is what the bubbles listen for. The tray uses the
// browser's own drag-and-drop instead, and that is not driven here: what it writes is the same
// call the bubble drag makes, and a test of it would be a test of Playwright's synthesis of an
// HTML drag rather than of this feature.

const FIELD = 'Campaign/Milieus of Silverstadt.md';
const SABLE = 'Campaign/NPCs/Sable.md';

/** Sable and Aldric Thane as the example vault places them, which is what the field draws. */
const SABLE_AT = { outlook: 85, standing: 12 };
const ALDRIC_AT = { outlook: 15, standing: 78 };

/** Where a drop is aimed. Well inside the rectangle, and nowhere near where either note starts. */
const DROP_AT = { outlook: 30, standing: 60 };

/**
 * How far the written value may sit from the value aimed at. The field is a thousand units wide
 * across some seven hundred pixels, so a pointer the browser rounds to a whole pixel is worth
 * rather more than a unit; three of them is a comfortable ceiling and still a tenth of the
 * distance the note travels.
 */
const TOLERANCE = 3;

/**
 * How long the field may take to be ready. Choosing the layout sends the app off to fetch the
 * axes note and the query behind it, and both the select that names the field and the first
 * bubble wait on that one answer — so they are given the same allowance. Playwright's default
 * of five seconds is for a page that has already loaded, and a cold CI runner is not that.
 */
const FIELD_READY = { timeout: 15_000 };

interface Point {
  x: number;
  y: number;
}

function bubble(page: Page, title: string) {
  return page.getByRole('button', { name: title, exact: true }).locator('circle');
}

async function centreOf(page: Page, title: string): Promise<Point> {
  const box = await bubble(page, title).boundingBox();
  expect(box, `${title} is on the field`).not.toBeNull();
  const { x, y, width, height } = box ?? { x: 0, y: 0, width: 0, height: 0 };
  return { x: x + width / 2, y: y + height / 2 };
}

async function openMilieu(page: Page): Promise<void> {
  await page.goto('/graph');
  await page.getByLabel('Layout').selectOption('milieu');
  await expect(page.getByLabel('Field')).toHaveValue(FIELD, FIELD_READY);
  await expect(bubble(page, 'Aldric Thane')).toBeVisible(FIELD_READY);
}

/**
 * Where a pair of axis values lands on screen, worked out from two notes whose values the vault
 * already states. Two points fix the straight line each axis draws, so this asks the field where
 * it put those two and reads everything else off them — no geometry of the drawing is repeated
 * here, and a change to its margins cannot quietly make this spec aim at the wrong place.
 */
async function screenPosition(
  page: Page,
  at: { outlook: number; standing: number },
): Promise<Point> {
  const aldric = await centreOf(page, 'Aldric Thane');
  const sable = await centreOf(page, 'Sable');
  const perOutlook = (sable.x - aldric.x) / (SABLE_AT.outlook - ALDRIC_AT.outlook);
  const perStanding = (sable.y - aldric.y) / (SABLE_AT.standing - ALDRIC_AT.standing);
  return {
    x: aldric.x + (at.outlook - ALDRIC_AT.outlook) * perOutlook,
    y: aldric.y + (at.standing - ALDRIC_AT.standing) * perStanding,
  };
}

async function frontmatterOf(page: Page, path: string): Promise<Record<string, unknown>> {
  const url = `/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
  const response = await page.request.get(url);
  expect(response.ok(), `could not read ${path}`).toBeTruthy();
  const doc = (await response.json()) as { frontmatter: Record<string, unknown> };
  return doc.frontmatter;
}

test('the field draws the notes that give both values, and trays the ones that do not', async ({
  page,
}) => {
  await openMilieu(page);

  for (const title of ['Aldric Thane', 'Corvin Marsh', "Mira's Ledger", 'Sable']) {
    await expect(bubble(page, title)).toBeVisible();
  }

  // The two that stand nowhere are in the tray, each saying which value it still owes.
  const tray = page.getByRole('complementary', { name: 'Notes without a position' });
  await expect(tray.getByRole('link', { name: /Elder Wren/ })).toBeVisible();
  await expect(tray.getByRole('link', { name: /Elder Wren/ })).toContainText('no outlook');
  await expect(tray.getByRole('link', { name: /Elder Wren/ })).toContainText('no standing');
  // Brannoc has an outlook and no standing, so only the one he owes is named.
  const brannoc = tray.getByRole('link', { name: /Brannoc Ironweld/ });
  await expect(brannoc).toContainText('no standing');
  await expect(brannoc).not.toContainText('no outlook');

  // A note on the field is still a note: clicking it opens it.
  await bubble(page, 'Aldric Thane').click();
  await expect(page).toHaveURL(/\/notes\/Campaign\/NPCs\/Aldric%20Thane$/);
});

test('dragging a bubble writes its position into the note', async ({ page }) => {
  await openMilieu(page);

  const from = await centreOf(page, 'Sable');
  const to = await screenPosition(page, DROP_AT);

  const written = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/notes/') &&
      response.ok(),
    { timeout: 15_000 },
  );

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several steps, so the gesture reads as a drag rather than as a click on the note.
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await written;

  const frontmatter = await frontmatterOf(page, SABLE);
  expect(Number(frontmatter.outlook)).toBeGreaterThan(DROP_AT.outlook - TOLERANCE);
  expect(Number(frontmatter.outlook)).toBeLessThan(DROP_AT.outlook + TOLERANCE);
  expect(Number(frontmatter.standing)).toBeGreaterThan(DROP_AT.standing - TOLERANCE);
  expect(Number(frontmatter.standing)).toBeLessThan(DROP_AT.standing + TOLERANCE);
  // Everything else the note said is still there.
  expect(frontmatter.type).toBe('npc');
  expect(frontmatter.faction).toBe('The Gutter Court');

  // The write makes the watcher report this note as changed. The field has to ignore that report,
  // or the bubble would be pulled back through the index and land where it already is. There is
  // nothing to wait for when the expected outcome is that nothing happens, so this waits out the
  // watcher and then looks.
  await page.waitForTimeout(1500);
  const settled = await centreOf(page, 'Sable');
  expect(Math.abs(settled.x - to.x)).toBeLessThan(4);
  expect(Math.abs(settled.y - to.y)).toBeLessThan(4);

  // Put the vault back, so a retry and the specs after this one see the note the manifest
  // describes. Through the API, because the suite shares one vault for the whole run.
  const url = `/api/notes/${SABLE.split('/').map(encodeURIComponent).join('/')}`;
  const doc = (await (await page.request.get(url)).json()) as { content: string };
  const restored = doc.content
    .replace(/^outlook: .*$/m, `outlook: ${String(SABLE_AT.outlook)}`)
    .replace(/^standing: .*$/m, `standing: ${String(SABLE_AT.standing)}`);
  expect((await page.request.put(url, { data: { content: restored } })).ok()).toBeTruthy();
});
