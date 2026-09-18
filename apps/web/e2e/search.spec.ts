import { expect, test } from '@playwright/test';

test('the search panel finds notes and opens a hit', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('lantern');

  const results = page.getByRole('list', { name: 'Search' });
  await expect(results.getByRole('link').first()).toBeVisible({ timeout: 10_000 });
  await expect(results.locator('mark').first()).toBeVisible();

  await results.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/notes\//);
});

test('the command palette jumps to a note', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();

  await page.keyboard.press('Control+p');

  const palette = page.getByRole('combobox', { name: 'Command palette' });
  await expect(palette).toBeFocused();
  await palette.fill('lantern bridge');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/notes\/Campaign\/Places\/Lantern%20Bridge$/);
});

test('tags filter the graph', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'Tags' }).click();
  const tag = page.getByRole('button', { name: /campaign/ }).first();
  await tag.click();
  await expect(tag).toHaveAttribute('aria-pressed', 'true');
});
