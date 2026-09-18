import { expect, test } from '@playwright/test';

test('the preview sits next to the editor and follows what is typed', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.rz-note-preview')).toBeVisible();

  const preview = page.getByRole('region', { name: 'Read-only view' });
  await page.locator('.cm-content').click();
  // Replace whatever an earlier test left in this note, so the typed line starts a heading.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('## A heading from the split view');

  await expect(
    preview.getByRole('heading', { name: 'A heading from the split view' }),
  ).toBeVisible();

  // The choice is remembered, like the theme and the sidebar.
  await page.reload();
  await expect(page.locator('.rz-note-preview')).toBeVisible();

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.rz-note-preview')).toHaveCount(0);
});
