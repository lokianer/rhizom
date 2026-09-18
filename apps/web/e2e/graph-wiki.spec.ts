import { expect, test } from '@playwright/test';

test('the graph draws the vault and can be narrowed to one note', async ({ page }) => {
  await page.goto('/graph');

  await expect(page.getByRole('img', { name: /graph/i })).toBeVisible();
  await expect(page.locator('.rz-graph-controls')).toContainText(/\d+ notes · \d+ links/);

  await page.goto('/notes/Campaign/Places/Silverstadt');
  await page.getByRole('link', { name: 'Graph' }).click();

  await expect(page).toHaveURL(/\/graph\?note=/);
  await page.getByLabel('Depth').selectOption('1');
  await expect(page.getByRole('img', { name: /graph/i })).toBeVisible();
});

test('wiki mode renders a note read-only and follows its links', async ({ page }) => {
  await page.goto('/wiki/Home');

  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0);

  await article.getByRole('link', { name: 'Silverstadt' }).first().click();
  await expect(page).toHaveURL(/\/wiki\/Campaign\/Places\/Silverstadt$/);

  await page.getByRole('link', { name: 'Edit this note' }).click();
  await expect(page).toHaveURL(/\/notes\/Campaign\/Places\/Silverstadt$/);
});

test('an embedded image is shown, not a broken link', async ({ page }) => {
  await page.goto('/wiki/Campaign/Places/Lantern%20Bridge');

  const image = page.getByRole('article').locator('img').first();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', '/api/assets/assets/tavern.png');
  // A broken image has no intrinsic width, however visible its alt text is.
  await expect
    .poll(async () => image.evaluate((element: { naturalWidth: number }) => element.naturalWidth))
    .toBeGreaterThan(0);
});

test('an unknown page falls back to the app', async ({ page }) => {
  const response = await page.goto('/notes/Does/Not/Exist');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: /Create/ })).toBeVisible();
});
