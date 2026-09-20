import { expect, test, type Page } from '@playwright/test';

// A checkbox in the preview is a control; the same checkbox in the wiki is a picture of what the
// file says. Both are tested here, because the difference is the whole design.

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

const LINES = [
  '# Task toggle probe',
  '',
  '- [ ] print the map',
  '- [x] pack the dice',
  '- an ordinary item',
];

test('ticking a box beside the editor writes it into the note', async ({ page }) => {
  await writeNote(page, 'Task toggle probe.md', LINES);
  await page.goto('/notes/Task toggle probe');
  await expect(page.locator('.cm-content')).toBeVisible();

  // The preview is beside the editor; the boxes there are controls.
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.locator('.rz-note-preview');
  const first = preview.getByRole('checkbox').first();
  await expect(first).not.toBeChecked();
  await expect(first).toBeEnabled();

  const written = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/notes/') &&
      response.ok(),
    { timeout: 15_000 },
  );
  await first.click();
  await expect(page.locator('.cm-content')).toContainText('[x] print the map');
  await written;

  // The file, not just the screen.
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('[x] print the map');

  // And back again: a second click sets the other state rather than flipping something else.
  const cleared = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.ok(),
    { timeout: 15_000 },
  );
  await page.locator('.rz-note-preview').getByRole('checkbox').first().click();
  await cleared;
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('[ ] print the map');
});

test('the same box in the wiki is a picture, not a control', async ({ page }) => {
  await writeNote(page, 'Task toggle probe.md', LINES);
  await page.goto('/wiki/Task toggle probe');

  const boxes = page.getByRole('checkbox');
  await expect(boxes.first()).toBeDisabled();
  await expect(boxes.nth(1)).toBeChecked();
});
