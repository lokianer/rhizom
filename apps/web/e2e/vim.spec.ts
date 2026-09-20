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
  await expect(editor.or(create)).toBeVisible({ timeout: 15_000 });
  if (await create.isVisible()) {
    await create.click();
  }
  await expect(editor).toBeVisible();
}

/** The palette is opened on the window, so the app has to be mounted before the key counts. */
async function runCommand(page: Page, typed: string): Promise<void> {
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill(typed);
  await page.keyboard.press('Enter');
}

/** Replaces whatever an earlier run left in the note. Ordinary typing, with the mode off. */
async function write(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

/** Vim's own mode line, under the editor: `--NORMAL--`, `--INSERT--`, and nothing when off. */
function modeLine(page: Page) {
  return page.locator('.cm-vim-panel');
}

test('Vim mode makes the keys commands, and says which mode it is in', async ({ page }, info) => {
  await openNote(page, unique('Vim probe', info.retry));
  await write(page, 'first line\nsecond line');
  await expect(modeLine(page)).toHaveCount(0);

  await runCommand(page, 'vim');
  await expect(modeLine(page)).toHaveText(/NORMAL/);

  // `dd` on the first line: two letters nobody typed, one line gone.
  await page.locator('.cm-line').first().click();
  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await expect(page.locator('.cm-content')).not.toContainText('first line');
  await expect(page.locator('.cm-line').first()).toHaveText('second line');

  // `i` is a mode and not a letter: what follows is typed, and Escape ends it.
  await page.keyboard.press('i');
  await expect(modeLine(page)).toHaveText(/INSERT/);
  await page.keyboard.type('a ');
  await page.keyboard.press('Escape');
  await expect(modeLine(page)).toHaveText(/NORMAL/);
  await expect(page.locator('.cm-line').first()).toHaveText('a second line');

  // How a person types is a preference, not a mood: it is still on when they come back.
  await page.reload();
  await expect(modeLine(page)).toHaveText(/NORMAL/, { timeout: 15_000 });
});

test('in zen mode Escape leaves insert mode, not the room', async ({ page }, info) => {
  await openNote(page, unique('Vim in zen', info.retry));
  await write(page, 'a line');

  await runCommand(page, 'vim');
  await expect(modeLine(page)).toHaveText(/NORMAL/);
  await runCommand(page, 'zen');
  await expect(page.getByRole('banner')).toBeHidden();

  await page.locator('.cm-content').click();
  await page.keyboard.press('i');
  await expect(modeLine(page)).toHaveText(/INSERT/);
  await page.keyboard.press('Escape');
  await expect(modeLine(page)).toHaveText(/NORMAL/);
  await expect(page.getByRole('banner')).toBeHidden();

  // Pressed anywhere but in the editor, Escape still means out — zen is not a trap.
  await page.locator('.rz-note-header h2').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner')).toBeVisible();
});

test('with the mode off the same keys are letters, and switching it off gives them back', async ({
  page,
}, info) => {
  await openNote(page, unique('Vim off probe', info.retry));
  await expect(modeLine(page)).toHaveCount(0);

  // Nobody asked for Vim: `d`, `d` and `i` are three characters of a note.
  await write(page, 'ddi');
  await expect(page.locator('.cm-line').first()).toHaveText('ddi');

  await runCommand(page, 'vim');
  await expect(modeLine(page)).toHaveText(/NORMAL/);
  await runCommand(page, 'vim');
  await expect(modeLine(page)).toHaveCount(0);

  // The document and the cursor came through both switches, and the keys are letters again.
  await expect(page.locator('.cm-line').first()).toHaveText('ddi');
  await write(page, 'dd again');
  await expect(page.locator('.cm-line').first()).toHaveText('dd again');
});
