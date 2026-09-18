import { expect, test } from '@playwright/test';

test('the app shell renders', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/rhizom/i);
  await expect(page.getByRole('heading', { level: 1, name: 'Rhizom' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('switching the language to German translates the shell', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');

  await expect(page.getByText('Vernetztes Wissen aus reinem Markdown.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
});
