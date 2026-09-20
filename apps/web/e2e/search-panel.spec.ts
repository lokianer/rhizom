import { expect, test, type Page } from '@playwright/test';

// Ctrl+F in the editor. The keys were bound from the start; the panel they belong to was not
// there, so they answered by doing nothing.

async function writeNote(page: Page, path: string, lines: string[]): Promise<void> {
  const content = `${lines.join('\n')}\n`;
  const created = await page.request.post('/api/notes', { data: { path, content } });
  if (created.ok()) {
    return;
  }
  const url = `/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
  const saved = await page.request.put(url, { data: { content } });
  expect(saved.ok(), `could not write ${path}`).toBeTruthy();
}

test('the editor finds and replaces', async ({ page }) => {
  await writeNote(page, 'Search panel probe.md', [
    '# Search panel probe',
    '',
    'The tide is out. The tide comes back.',
  ]);
  await page.goto('/notes/Search panel probe');
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.press('ControlOrMeta+f');
  const panel = page.locator('.cm-search');
  await expect(panel).toBeVisible();

  await panel.getByPlaceholder('Find').fill('tide');
  await panel.getByPlaceholder('Replace').fill('water');
  await panel.getByRole('button', { name: 'replace all' }).click();

  await expect(editor).toContainText('The water is out. The water comes back.');
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });

  // Escape closes it and leaves the editor where it was.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
