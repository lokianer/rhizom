import { expect, test, type Page } from '@playwright/test';

// The suite shares one throwaway vault and runs one worker, so each test makes the notes it
// needs under names no other spec uses. A retry gets its own names: the vault is not reset
// between attempts, and a second attempt must not find the notes the first one left behind.
function unique(name: string, retry: number): string {
  return retry === 0 ? name : `${name} ${String(retry)}`;
}

/** Creates a note through the palette and lands on it. */
async function createNote(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('new note');
  await page.keyboard.press('Enter');
  // Exact: a tree row called "Rename me" is also labelled something containing "Name".
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

/** Types text into the open note and waits for the autosave to land. */
async function write(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
}

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Rename note' });
}

async function openRename(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Rename or move/ }).click();
  await expect(dialog(page)).toBeVisible();
}

test('renaming a note rewrites the links that point at it', async ({ page }, info) => {
  const note = unique('Rename me', info.retry);
  const linking = unique('Points at it', info.retry);
  const renamed = unique('Renamed', info.retry);

  await createNote(page, note);
  await createNote(page, linking);
  await write(page, `See [[${note}]] over there.`);

  await page.goto(`/notes/${encodeURIComponent(note)}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  await openRename(page);

  await page.getByLabel('New name').fill(renamed);
  // The preview is debounced; it names the one file it would rewrite.
  await expect(dialog(page)).toContainText(linking, { timeout: 10_000 });
  await expect(dialog(page)).toContainText('1 note is rewritten');

  await dialog(page).getByRole('button', { name: 'Rename', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/notes/${encodeURIComponent(renamed)}$`));
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

  await page.goto(`/notes/${encodeURIComponent(linking)}`);
  await expect(page.locator('.cm-content')).toContainText(`[[${renamed}]]`);
});

test('a name made of emoji survives the rename', async ({ page }, info) => {
  const note = unique('Seedling note', info.retry);
  const linking = unique('Links to the seedling', info.retry);
  const renamed = unique('Wurzeln 👨‍👩‍👧', info.retry);

  await createNote(page, note);
  await createNote(page, linking);
  await write(page, `Go to [[${note}]].`);

  await page.goto(`/notes/${encodeURIComponent(note)}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  await openRename(page);

  await page.getByLabel('New name').fill(renamed);
  await expect(dialog(page)).toContainText(linking, { timeout: 10_000 });
  await dialog(page).getByRole('button', { name: 'Rename', exact: true }).click();

  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();
  await page.goto(`/notes/${encodeURIComponent(linking)}`);
  await expect(page.locator('.cm-content')).toContainText(`[[${renamed}]]`);
});

test('a name the link syntax cannot hold is refused', async ({ page }, info) => {
  await createNote(page, unique('Refusable note', info.retry));
  await openRename(page);

  // `#` is a legal file name and an illegal link target: it starts a heading reference inside
  // `[[…]]`, so every link rewritten to this name would lead to a heading instead of a note.
  await page.getByLabel('New name').fill('Refusable #2');

  await expect(dialog(page)).toContainText('cannot be written as a link', { timeout: 10_000 });
  await expect(dialog(page).getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();

  // A character no file system takes is refused too, with the reason that fits it.
  await page.getByLabel('New name').fill('Refusable | note');
  await expect(dialog(page)).toContainText('does not write notes to that path', {
    timeout: 10_000,
  });
});
