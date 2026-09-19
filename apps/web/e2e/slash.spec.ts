import { expect, test } from '@playwright/test';

const suggestions = (page: import('@playwright/test').Page) =>
  page.locator('.cm-tooltip-autocomplete');

/** Empties the scratch note and waits for the save, so the next spec finds it as it was. */
async function clearScratch(page: import('@playwright/test').Page): Promise<void> {
  // An open completion tooltip covers the editor, and a click on what is underneath it waits
  // for the cover to go away. Escape closes it and does nothing when none is open.
  await page.keyboard.press('Escape');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
}

test('a slash writes the date the vault writes it', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Today: /date');

  await expect(suggestions(page)).toBeVisible();
  // CodeMirror ignores the completion keys for a moment after the list changes, so that a
  // keystroke already on its way cannot accept an option the reader has not seen.
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');

  // The example vault's .obsidian/templates.json asks for YYYY-MM-DD.
  await expect(page.locator('.cm-content')).toContainText(/Today: \d{4}-\d{2}-\d{2}/);
  await clearScratch(page);
});

test("a slash inserts a vault's own template, filled in", async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('/npc');

  // Templates/NPC.md begins with `# {{title}}`, so the index knows it by that; the menu names
  // it by its file.
  await expect(suggestions(page)).toContainText('NPC');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('One line: who they are');
  // {{title}} became this note's name and {{date}} became today; nothing was left unfilled.
  // The `#` of the heading is not in the text: the live preview hides it off the cursor line.
  await expect(editor).toContainText('Scratch');
  await expect(editor).not.toContainText('{{');
  await clearScratch(page);
});

test('a slash stays out of the way inside a wikilink', async ({ page }) => {
  await page.goto('/notes/Daily/Scratch');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('[[Campaign/');

  // The note list belongs to a path, not the slash menu: a folder is what follows a slash here.
  await expect(suggestions(page)).toContainText('Campaign');
  await expect(suggestions(page)).not.toContainText('Table');
  await clearScratch(page);
});
