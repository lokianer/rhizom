import { expect, test } from '@playwright/test';

test('the shell renders with the open vault', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/rhizom/i);
  await expect(page.getByRole('link', { name: 'vault', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('switching the language to German translates the shell', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');

  await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
  await expect(page.getByRole('tab', { name: 'Dateien' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
});

test('the theme can be switched to Kalk and is remembered', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('combobox', { name: 'Theme' }).selectOption('kalk');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'kalk');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'kalk');

  await page.getByRole('combobox', { name: 'Theme' }).selectOption('humus');
});
