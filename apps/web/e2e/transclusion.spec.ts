import { expect, test } from '@playwright/test';

test('a note embed shows the note itself, in the wiki and beside the editor', async ({ page }) => {
  await page.goto('/wiki/Campaign/Campaign');

  const embed = page.locator('.rz-embed');
  await expect(embed).toHaveAttribute('data-state', 'ready');
  await expect(embed).toHaveAttribute('data-path', 'Templates/NPC.md');
  // The body of Templates/NPC, not a link to it.
  await expect(
    embed.getByText('One line: who they are and where the party met them.'),
  ).toBeVisible();
  await expect(embed.getByRole('heading', { name: 'What they want' })).toBeVisible();

  // The same note in the editor's preview pane renders the same way.
  await page.goto('/notes/Campaign/Campaign');
  await expect(page.locator('.cm-content')).toBeVisible();
  const preview = page.getByRole('region', { name: 'Read-only view' });
  if ((await page.locator('.rz-note-preview').count()) === 0) {
    await page.getByRole('button', { name: 'Preview' }).click();
  }
  await expect(preview.locator('.rz-embed')).toHaveAttribute('data-state', 'ready');
  await expect(
    preview.locator('.rz-embed').getByText('One line: who they are and where the party met them.'),
  ).toBeVisible();
});

test('an embed with a heading shows only that section', async ({ page }) => {
  await page.goto('/wiki/Campaign/Sessions/Session 13 – Ashes and Ink');

  const embed = page.locator('.rz-embed');
  await expect(embed).toHaveAttribute('data-state', 'ready');
  await expect(embed.getByRole('heading', { name: 'Loot' })).toBeVisible();
  await expect(embed.getByText('Brass astrolabe, Archive stamp')).toBeVisible();
  // "Ending" is the section after Loot in Session 12; only Loot was asked for.
  await expect(embed.getByRole('heading', { name: 'Ending' })).toHaveCount(0);
});

test('an embed of a note that is not there says so instead of showing nothing', async ({
  page,
}) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  if ((await page.locator('.rz-note-preview').count()) === 0) {
    await page.getByRole('button', { name: 'Preview' }).click();
  }

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('![[No Such Note At All]]');

  const preview = page.getByRole('region', { name: 'Read-only view' });
  await expect(preview.locator('.rz-embed')).toHaveAttribute('data-state', 'missing');
  await expect(preview.getByText('No Such Note At All is not in this vault')).toBeVisible();
});
