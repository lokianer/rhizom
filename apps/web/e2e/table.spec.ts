import { expect, test } from '@playwright/test';

// The example vault: Mira's note holds a GM block, Aldric's a block revealed in session 12, and
// "A Debt to Mira" is linked from Mira's note but from no session note, so the party has not met it.

const MIRA = "/v/default/table/notes/Campaign/NPCs/Mira's%20Ledger";
const ALDRIC = '/v/default/table/notes/Campaign/NPCs/Aldric%20Thane';

test('the GM lens shows a GM block, marked as one', async ({ page }) => {
  await page.goto("/v/default/wiki/Campaign/NPCs/Mira's%20Ledger");
  const block = page.locator('.rz-callout-gm');
  await expect(block).toBeVisible();
  await expect(block).toContainText('forged the Archive');
});

test('the player view hides the GM block and writes an unmet note as plain text', async ({
  page,
}) => {
  await page.goto(`${MIRA}?session=13`);
  const note = page.locator('.rz-table-note');
  await expect(note).toContainText('Speaks quietly');
  await expect(note).not.toContainText('forged the Archive');
  await expect(note).toContainText('A Debt to Mira');
  await expect(note.getByRole('link', { name: 'A Debt to Mira' })).toHaveCount(0);
  await expect(page.getByRole('note')).toContainText('not a lock');
});

test('the slider shows a revealed block from its session on', async ({ page }) => {
  await page.goto(`${ALDRIC}?session=11`);
  const note = page.locator('.rz-table-note');
  await expect(note).toContainText('Order, in the literal sense');
  await expect(note).not.toContainText('owes Mira forty gold');

  await page.getByRole('slider', { name: 'Session' }).fill('12');
  await expect(page).toHaveURL(/session=12/);
  await expect(note).toContainText('owes Mira forty gold');
});

test('the list holds only what the party has met, and the GM lens links to it', async ({
  page,
}) => {
  await page.goto('/v/default');
  await page.getByRole('link', { name: 'Player view' }).click();
  await expect(page).toHaveURL(/\/v\/default\/table/);
  const list = page.locator('.rz-table-side');
  await expect(list.getByRole('link', { name: "Mira's Ledger" })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Elder Wren' })).toHaveCount(0);
  await expect(list.getByRole('link', { name: 'Rhizomes' })).toHaveCount(0);
});

test('the player view asks for nothing but its own routes', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) {
      asked.push(path);
    }
  });
  await page.goto(`${MIRA}?session=13`);
  await expect(page.locator('.rz-table-note')).toContainText('Speaks quietly');
  const outside = asked.filter(
    (path) => !path.startsWith('/api/v/default/table/') && path !== '/api/vaults',
  );
  expect(outside).toEqual([]);
});
