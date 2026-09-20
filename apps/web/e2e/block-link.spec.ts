import { expect, test, type Page } from '@playwright/test';

// "Copy a link to this block": the id is written into the file, the link lands on the clipboard,
// and the blocks that cannot carry an id say so instead of doing nothing.

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

const PATH = 'Block link probe.md';
const LINES = [
  '# Block link probe',
  '',
  'The ledger was open on the desk.',
  '',
  '- print the map',
  '- pack the dice',
  '',
  '```js',
  'const answer = 42;',
  '```',
];

/** The line of the editor holding this text; clicking one puts the cursor in that block. */
function line(page: Page, text: string) {
  return page.locator('.cm-line', { hasText: text });
}

/**
 * What the clipboard holds. The specs are type-checked as Node, which knows nothing of a
 * browser's clipboard, so the one method this needs is described here rather than the whole DOM
 * being pulled into the project for it.
 */
function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (
      navigator as unknown as { clipboard: { readText: () => Promise<string> } }
    ).clipboard.readText(),
  );
}

test('the key gives the block an id and puts the link on the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await writeNote(page, PATH, LINES);
  await page.goto('/notes/Block link probe');

  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await line(page, 'The ledger was open').click();
  await page.keyboard.press('ControlOrMeta+Shift+X');

  // The id says what the block says, so the file stays readable without Rhizom.
  await expect(editor).toContainText('The ledger was open on the desk. ^the-ledger-was-open');
  const link = '[[Block link probe#^the-ledger-was-open]]';
  await expect(page.getByText(`Copied ${link}`)).toBeVisible();
  expect(await clipboardText(page)).toBe(link);

  // And it is one step of the undo history, not four.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toContainText('The ledger was open on the desk.');
  await expect(editor).not.toContainText('^the-ledger-was-open');

  // The id reaches the file, where a link from another note will look for it.
  await page.keyboard.press('ControlOrMeta+Shift+X');
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
  const saved = await page.request.get(`/api/notes/${encodeURIComponent(PATH)}`);
  expect(((await saved.json()) as { content: string }).content).toContain(
    'The ledger was open on the desk. ^the-ledger-was-open',
  );
});

test('a second press on the same block copies the same link and writes nothing', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await writeNote(page, PATH, [
    ...LINES.slice(0, 4),
    '- print the map ^print-the-map',
    ...LINES.slice(5),
  ]);
  await page.goto('/notes/Block link probe');
  await expect(page.locator('.cm-content')).toBeVisible();

  await line(page, 'print the map').click();
  await page.keyboard.press('ControlOrMeta+Shift+X');

  const link = '[[Block link probe#^print-the-map]]';
  await expect(page.getByText(`Copied ${link}`)).toBeVisible();
  expect(await clipboardText(page)).toBe(link);
  // The address was already there and something may already point at it, so it is reused.
  await expect(page.locator('.cm-content')).not.toContainText('^print-the-map ^');
});

test('a heading and a code fence say why they cannot carry an id', async ({ page }) => {
  await writeNote(page, PATH, LINES);
  await page.goto('/notes/Block link probe');
  await expect(page.locator('.cm-content')).toBeVisible();

  await line(page, 'Block link probe').first().click();
  await page.keyboard.press('ControlOrMeta+Shift+X');
  await expect(page.getByText('A heading is pointed at by its text')).toBeVisible();

  await line(page, 'const answer = 42;').click();
  await page.keyboard.press('ControlOrMeta+Shift+X');
  await expect(page.getByText('would be part of the code')).toBeVisible();

  // Neither of them wrote anything.
  await expect(page.locator('.cm-content')).not.toContainText('^');
});

test('the palette runs the same command on the block the cursor is in', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await writeNote(page, PATH, LINES);
  await page.goto('/notes/Block link probe');
  await expect(page.locator('.cm-content')).toBeVisible();

  await line(page, 'pack the dice').click();
  await page.keyboard.press('Control+p');
  const palette = page.getByRole('combobox', { name: 'Command palette' });
  // The only command with "block" in its name, and commands are listed above notes.
  await palette.fill('block');
  await page.keyboard.press('Enter');

  await expect(page.locator('.cm-content')).toContainText('- pack the dice ^pack-the-dice');
  expect(await clipboardText(page)).toBe('[[Block link probe#^pack-the-dice]]');
});
