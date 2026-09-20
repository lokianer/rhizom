import { expect, test } from '@playwright/test';

// The example vault keeps a folder called Daily and says nothing else, so the note for today is
// `Daily/<YYYY-MM-DD>.md`. The date is the machine's, which is what the command uses too.
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The palette is opened on the window, so the app has to be mounted before the key counts. */
async function runCommand(page: import('@playwright/test').Page, typed: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill(typed);
  await page.keyboard.press('Enter');
}

test("the palette opens today's note, making it when it is not there yet", async ({ page }) => {
  const name = today();
  await runCommand(page, 'today');

  await expect(page).toHaveURL(new RegExp(`/notes/Daily/${name}$`));
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  // Asking again finds the note rather than making a second one, and the tree holds one row.
  await runCommand(page, 'today');
  await expect(page).toHaveURL(new RegExp(`/notes/Daily/${name}$`));

  await page.goto('/');
  await page.getByRole('treeitem', { name: 'Daily' }).click();
  await expect(page.getByRole('treeitem', { name, exact: true })).toHaveCount(1);
});
