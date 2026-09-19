import { expect, test } from '@playwright/test';

const panelOf = (page: import('@playwright/test').Page) =>
  page.getByRole('complementary', { name: 'Unlinked mentions' });

test('a name in prose is offered; the same name in frontmatter is not', async ({ page }) => {
  // Corvin Marsh answers to "Marsh", which the campaign notes use in running text all the time.
  await page.goto('/notes/Campaign/NPCs/Corvin Marsh');
  const panel = panelOf(page);

  await expect(panel.getByRole('link', { name: 'Recover the Tidewater Charts' })).toBeVisible();
  await expect(panel.getByText('Deliver the charts to Marsh')).toBeVisible();
  // Each box says which note its line is in: the heading above it is out of earshot for anyone
  // stepping from box to box.
  await expect(
    panel.getByRole('checkbox', { name: /In Recover the Tidewater Charts: / }).first(),
  ).toBeChecked();
  // That same note carries `giver: Corvin Marsh` in its frontmatter, which is metadata rather
  // than a mention and must never be offered for rewriting.
  await expect(panel.getByText('giver:')).toHaveCount(0);
});

test('a note nothing names in prose says so', async ({ page }) => {
  await page.goto('/notes/Research/Sinus-Milieus');
  await expect(
    panelOf(page).getByText('No note names this one without linking to it.'),
  ).toBeVisible();
});

test('writing a name into a note makes it a mention, and one click links it', async ({ page }) => {
  // Daily/Scratch is the note this suite treats as scratch space; nothing else asserts it.
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('The Sinus-Milieus study shapes the field.');
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });

  await page.goto('/notes/Research/Sinus-Milieus');
  const panel = panelOf(page);
  await expect(panel.getByRole('link', { name: 'Scratch' })).toBeVisible();
  await expect(panel.getByText('The Sinus-Milieus study shapes the field.')).toBeVisible();

  await panel.getByRole('button', { name: 'Link in 1 note' }).click();
  await expect(panel.getByText('1 mention linked.')).toBeVisible();
  // It is a link now, so it is no longer an unlinked mention.
  await expect(panel.getByText('No note names this one without linking to it.')).toBeVisible();

  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toContainText('[[Sinus-Milieus]]');
});
