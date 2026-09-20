import { expect, test, type Page } from '@playwright/test';

// The example vault brings its own saved search: `Research/Open questions.md` declares
// `type: query`, so the sidebar has to offer it as a folder. Nothing here writes a note — the
// suite shares one vault that outlives a run, and this test only reads what the vault already
// says about itself.

function smartFolders(page: Page) {
  return page.getByRole('region', { name: 'Smart folders' });
}

test('a saved search stands in the sidebar as a folder and opens the notes it finds', async ({
  page,
}) => {
  await page.goto('/');

  const folder = smartFolders(page).getByRole('button', { name: 'Open questions' });
  await expect(folder).toBeVisible({ timeout: 15_000 });
  // Closed, and therefore not yet asked about: no number until somebody wants one.
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await expect(folder).not.toContainText('notes');

  await folder.click();
  await expect(folder).toHaveAttribute('aria-expanded', 'true');

  // The note's first block asks for everything in Research, five at a time, most recently
  // changed first — so five notes of that folder, and the rest named underneath.
  const notes = smartFolders(page).getByRole('list', { name: 'Open questions' }).getByRole('link');
  await expect(notes).toHaveCount(5, { timeout: 15_000 });
  await expect(folder).toContainText('5 notes');

  const href = await notes.first().getAttribute('href');
  expect(href).toMatch(/^\/notes\/Research\//);

  await notes.first().click();
  await expect(page).toHaveURL(href ?? '');
  await expect(page.locator('.cm-content')).toBeVisible();
});
