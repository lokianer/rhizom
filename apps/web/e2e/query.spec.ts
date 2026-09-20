import { expect, test, type Page } from '@playwright/test';

// The suite shares one vault and is not given a fresh copy between attempts, so each note is
// written through the API rather than through the interface: created on the first run, rewritten
// on a retry, and the same text either way.
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

test('a query block answers with the notes it asked for, in the wiki', async ({ page }) => {
  await writeNote(page, 'Query list probe.md', [
    '# Query list probe',
    '',
    '```rhizom-query',
    'from: Campaign/NPCs',
    'sort: title',
    '```',
  ]);

  await page.goto('/wiki/Query list probe');

  const block = page.locator('.rz-query');
  await expect(block).toHaveAttribute('data-state', 'ready');
  // The notes of that folder, as links that behave like every other note link.
  await expect(block.getByRole('link', { name: 'Sable' })).toBeVisible();
  await expect(block.getByRole('link', { name: 'Elder Wren' })).toBeVisible();

  await block.getByRole('link', { name: 'Sable' }).click();
  await expect(page).toHaveURL(/\/wiki\/Campaign\/NPCs\/Sable$/);
});

test('a query table shows the columns it named, beside the editor', async ({ page }) => {
  await writeNote(page, 'Query table probe.md', [
    '# Query table probe',
    '',
    '```rhizom-query',
    'from: Campaign/NPCs',
    'as: table',
    'columns: [title, faction]',
    'sort: title',
    '```',
  ]);

  await page.goto('/notes/Query table probe');
  await expect(page.locator('.cm-content')).toBeVisible();
  if ((await page.locator('.rz-note-preview').count()) === 0) {
    await page.getByRole('button', { name: 'Preview' }).click();
  }

  const preview = page.getByRole('region', { name: 'Read-only view' });
  await expect(preview.locator('.rz-query')).toHaveAttribute('data-state', 'ready');
  // A built-in column gets the word the interface has for it; a frontmatter key stays as written.
  await expect(preview.getByRole('columnheader', { name: 'Title' })).toBeVisible();
  await expect(preview.getByRole('columnheader', { name: 'faction' })).toBeVisible();
  await expect(preview.getByRole('cell', { name: 'Order of the Lantern' })).toBeVisible();
});

test('a query block that says something unreadable still answers, and names the line', async ({
  page,
}) => {
  await writeNote(page, 'Query problem probe.md', [
    '# Query problem probe',
    '',
    '```rhizom-query',
    'from: Campaign/NPCs',
    'nonsense: 3',
    '```',
  ]);

  await page.goto('/wiki/Query problem probe');

  const block = page.locator('.rz-query');
  await expect(block).toHaveAttribute('data-state', 'ready');
  // The rest of the block was read, so the notes are there …
  await expect(block.getByRole('link', { name: 'Sable' })).toBeVisible();
  // … and the line that was not read is named underneath.
  await expect(block.locator('.rz-query-problems li')).toContainText('Line 2:');
  await expect(block.locator('.rz-query-problems li')).toContainText('nonsense');
});
