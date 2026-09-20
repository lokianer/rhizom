import { expect, test, type Page } from '@playwright/test';

// The suite shares one throwaway vault and runs one worker, so each test makes the note it
// needs. A retry gets its own name: the vault is not reset between attempts.
function unique(name: string, retry: number): string {
  return retry === 0 ? name : `${name} ${String(retry)}`;
}

/**
 * Opens the note, creating it if it is not there. Not "create it": the vault outlives a run,
 * so a second run of this file has to find what the first one left and carry on.
 */
async function openNote(page: Page, name: string): Promise<void> {
  await page.goto(`/notes/${encodeURIComponent(name)}`);
  const editor = page.locator('.cm-content');
  const create = page.getByRole('button', { name: `Create ${name}.md` });
  // The note is fetched before either can be on screen, so wait for whichever arrives; asking
  // `isVisible` straight away would find neither and quietly skip the creation.
  await expect(editor.or(create)).toBeVisible({ timeout: 15_000 });
  if (await create.isVisible()) {
    await create.click();
  }
  await expect(editor).toBeVisible();
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: /Frontmatter/ });
}

/** The form starts folded away, because the frontmatter is already in the note above it. */
async function openPanel(page: Page): Promise<void> {
  await panel(page).locator('summary').click();
}

/**
 * One field's input. Exact, because the row's remove button is labelled `Remove <key>` and a
 * substring match on the key would find both.
 */
function field(page: Page, key: string) {
  return panel(page).getByLabel(key, { exact: true });
}

/** Types the note's whole text and waits for the autosave to land. */
async function write(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
}

/** The note being written to disk. "Saved" on screen may still be the previous save's. */
function savedOnce(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/notes/') &&
      response.ok(),
    { timeout: 15_000 },
  );
}

test('the form shows the frontmatter and writes a change back into the note', async ({
  page,
}, info) => {
  await openNote(page, unique('Frontmatter probe', info.retry));
  await write(page, '---\nstatus: draft\n---\n\n# Probe\n\nA body the form must not touch.');

  await expect(panel(page)).toBeVisible();
  await openPanel(page);
  await expect(field(page, 'status')).toHaveValue('draft');

  const written = savedOnce(page);
  await field(page, 'status').fill('done');
  await field(page, 'status').blur();

  await expect(page.locator('.cm-content')).toContainText('status: done');
  await expect(page.locator('.cm-content')).toContainText('A body the form must not touch.');
  await written;

  // The file, not just the screen: reload and the change is still there.
  await page.reload();
  await openPanel(page);
  await expect(field(page, 'status')).toHaveValue('done');
});

test('a key can be added and removed', async ({ page }, info) => {
  await openNote(page, unique('Frontmatter adding', info.retry));
  await write(page, '---\nstatus: draft\n---\n\n# Adding');
  await openPanel(page);

  await panel(page).getByLabel('New key').fill('chapter');
  await panel(page).getByLabel('Kind').selectOption('number');
  await panel(page).getByRole('button', { name: 'Add', exact: true }).click();

  await expect(field(page, 'chapter')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('chapter: 0');

  await panel(page).getByRole('button', { name: 'Remove chapter' }).click();
  await expect(field(page, 'chapter')).toHaveCount(0);
  await expect(page.locator('.cm-content')).not.toContainText('chapter');
  // The key it did not touch is still there.
  await expect(field(page, 'status')).toHaveValue('draft');
});

test('a note without frontmatter says so, and gets a block when a key is added', async ({
  page,
}, info) => {
  await openNote(page, unique('Frontmatter bare', info.retry));
  await write(page, '# Bare\n\nNothing above this line.');

  await openPanel(page);
  await expect(panel(page)).toContainText('no frontmatter yet');

  await panel(page).getByLabel('New key').fill('status');
  await panel(page).getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.locator('.cm-content')).toContainText('status:');
  await expect(page.locator('.cm-content')).toContainText('Nothing above this line.');
});
