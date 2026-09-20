import { expect, test } from '@playwright/test';

/** Empties the scratch note and waits for the save, so the next spec finds it as it was. */
async function clearScratch(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
}

/**
 * Selects the last `count` characters of the line, one keystroke at a time — which modifier walks
 * by words is a matter of the operating system, and a spec should not have to know.
 */
async function selectBack(page: import('@playwright/test').Page, count: number): Promise<void> {
  for (let step = 0; step < count; step += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
}

test('the emphasis keys mark the selection and take it back off', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('a bold word');
  await selectBack(page, 'word'.length);

  await page.keyboard.press('ControlOrMeta+b');
  await expect(editor).toContainText('a bold **word**');

  // The word is still selected, so the same key takes the markers off again.
  await page.keyboard.press('ControlOrMeta+b');
  await expect(editor).toContainText('a bold word');
  await expect(editor).not.toContainText('**');

  // And italic is the same gesture, one letter along.
  await page.keyboard.press('ControlOrMeta+i');
  await expect(editor).toContainText('a bold *word*');

  await clearScratch(page);
});

test('the link key wraps the selection and leaves the cursor at the address', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('see the docs');
  await selectBack(page, 'docs'.length);

  await page.keyboard.press('ControlOrMeta+k');
  // Nothing was pasted and nothing was asked of the clipboard: the address is typed where the
  // cursor already stands.
  await page.keyboard.type('https://rhizom.example');
  await expect(editor).toContainText('see the [docs](https://rhizom.example)');

  await clearScratch(page);
});

test('the palette opens a note at random, never the one already open', async ({ page }) => {
  await page.goto('/notes/Home');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.keyboard.press('Control+p');
  const palette = page.getByRole('combobox', { name: 'Command palette' });
  await palette.fill('random');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/notes\/.+/);
  await expect(page).not.toHaveURL(/\/notes\/Home$/);
});

test('the palette duplicates the open note beside it', async ({ page }) => {
  await page.goto('/notes/Home');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.keyboard.press('Control+p');
  const palette = page.getByRole('combobox', { name: 'Command palette' });
  await palette.fill('duplicate');
  await page.keyboard.press('Enter');

  // The next free name in the folder the note is in, opened on arrival, holding the same words.
  await expect(page).toHaveURL(/\/notes\/Home%20copy$/);
  await expect(page.locator('.cm-content')).toContainText('Silverstadt');
  // The original is untouched, copy or no copy. Asked of the note rather than of the file tree:
  // the tree shows a note's title, and a copy of `Home.md` opens with the same `# Home`, so two
  // rows legitimately read the same there.
  const original = await page.request.get('/api/notes/Home.md');
  expect(original.ok()).toBeTruthy();
  expect(((await original.json()) as { content: string }).content).toContain('Silverstadt');

  // Leave the vault as the next spec expects to find it.
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page).toHaveURL(/\/$/);
});
