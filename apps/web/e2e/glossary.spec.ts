import { expect, test } from '@playwright/test';

test('the glossary lists what the vault defines and leads to the note', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Glossary' }).click();

  const glossary = page.getByRole('region', { name: 'Glossary' });
  await expect(glossary.getByRole('link', { name: 'Spring tide' })).toBeVisible();
  await expect(glossary.getByText('also spring tides')).toBeVisible();
  await expect(glossary.getByText(/The higher tide that follows/)).toBeVisible();

  await glossary.getByRole('link', { name: 'Spring tide' }).click();
  await expect(page).toHaveURL(/\/notes\/Glossary\/Spring%20tide/);
});

test('a defined term is marked where it is mentioned, and says what it means', async ({ page }) => {
  await page.goto('/wiki/Campaign/Places/Silverstadt');

  const term = page.locator('.rz-term').first();
  await expect(term).toBeVisible();
  await expect(term).toHaveAttribute('data-term', 'Glossary/Spring tide.md');
  await expect(term).toHaveAttribute('title', /The higher tide that follows/);
  await expect(term).toHaveText(/[Ss]pring tides?/);
});

test('the note that defines a term does not mark it in its own text', async ({ page }) => {
  await page.goto('/wiki/Glossary/Spring tide');
  await expect(page.getByText('Not named for the season.')).toBeVisible();
  await expect(page.locator('.rz-term')).toHaveCount(0);
});

test('hovering a term in the editor shows the definition', async ({ page }) => {
  // Written here rather than looked for in an existing note: CodeMirror only renders the lines
  // on screen, and the mentions in Silverstadt.md sit well below the fold.
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('The spring tides flood the cellars.');

  const marked = page.locator('.cm-rz-term').first();
  await expect(marked).toBeVisible();
  await expect(marked).toHaveAttribute('data-rz-term', 'Glossary/Spring tide.md');
  await expect(marked).toHaveText('spring tides');

  await marked.hover();
  const tooltip = page.locator('.cm-tooltip .cm-rz-term-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('The higher tide that follows');
});

test('a term inside a link or code is left alone in the editor', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('A `spring tide` and [[spring tides]] stay as they are.');

  await expect(page.locator('.cm-rz-term')).toHaveCount(0);
});
