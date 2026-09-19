import { expect, test } from '@playwright/test';

test('a note opens from the file tree and shows its backlinks', async ({ page }) => {
  await page.goto('/');

  const tree = page.getByRole('tree');
  await expect(tree).toBeVisible();
  await tree.getByRole('treeitem', { name: 'Home' }).click();

  await expect(page).toHaveURL(/\/notes\/Home$/);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Silverstadt');

  await expect(page.getByRole('complementary', { name: /backlinks/i })).toBeVisible();
});

test('a wikilink opens the note it points to', async ({ page }) => {
  await page.goto('/notes/Home');
  await expect(page.locator('.cm-content')).toContainText('Silverstadt');

  await page.locator('.cm-wikilink', { hasText: 'Silverstadt' }).first().click();

  await expect(page).toHaveURL(/\/notes\/Campaign\/Places\/Silverstadt$/);
  await expect(page.getByRole('heading', { name: 'Silverstadt' })).toBeVisible();
});

test('typing a note saves it and the text survives a reload', async ({ page }) => {
  const marker = 'A line the end-to-end test wrote.';
  await page.goto('/notes/Daily/Scratch');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.type(marker);

  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator('.cm-content')).toContainText(marker);
});

test('a note can be moved to the trash', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();

  await page.keyboard.press('Control+p');
  const palette = page.getByRole('combobox', { name: 'Command palette' });
  await palette.fill('new note');
  await page.keyboard.press('Enter');

  await page.getByLabel('Name').fill('Doomed note');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/notes\/Doomed%20note$/);

  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('tree').getByRole('treeitem', { name: 'Doomed note' })).toHaveCount(
    0,
  );
});

test('typing two brackets suggests notes and writes the link', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Walk to [[Lantern');

  const suggestions = page.locator('.cm-tooltip-autocomplete');
  await expect(suggestions).toBeVisible();
  await expect(suggestions).toContainText('Lantern Bridge');
  await expect(suggestions.locator('[aria-selected="true"]')).toHaveCount(1);
  // CodeMirror ignores the completion keys for a moment after the list changes, so that a
  // keystroke already on its way cannot accept an option the reader has not seen.
  await page.waitForTimeout(200);

  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toContainText('[[Campaign/Places/Lantern Bridge]]');
});

test('the editor keeps its height when the window is too short for the shelves below it', async ({
  page,
}) => {
  // Backlinks and unlinked mentions both cap themselves against the viewport, and a note with
  // plenty of each fills both. They may take the room; they may not take all of it.
  await page.setViewportSize({ width: 420, height: 560 });
  await page.goto('/notes/Campaign/NPCs/Corvin Marsh');
  await expect(page.locator('.cm-content')).toBeVisible();

  const editor = await page.locator('.cm-editor').boundingBox();
  expect(editor?.height ?? 0).toBeGreaterThan(120);
});
