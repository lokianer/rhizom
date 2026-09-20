import { expect, test } from '@playwright/test';

// Zen is the text and nothing else. The test is about what disappears, and about the way back.

test('zen mode hides everything but the note, and Escape brings it back', async ({ page }) => {
  await page.goto('/notes/Campaign/Places/Silverstadt');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('complementary', { name: /backlinks/i })).toBeVisible();

  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('zen');
  await page.keyboard.press('Enter');

  // Header, sidebar and both shelves are gone; the editor is still there and still the note.
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Files' })).toBeHidden();
  await expect(page.getByRole('complementary', { name: /backlinks/i })).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Silverstadt');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('complementary', { name: /backlinks/i })).toBeVisible();
});

test('zen is a mode for this visit, not a setting that outlives it', async ({ page }) => {
  await page.goto('/notes/Campaign/Places/Silverstadt');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('zen');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner')).toBeHidden();

  // Coming back to an application with no interface, and no memory of having asked for that,
  // is a bad morning.
  await page.reload();
  await expect(page.getByRole('banner')).toBeVisible();
});
