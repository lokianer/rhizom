import { expect, test, type Page } from '@playwright/test';

// The example vault's campaign note sits in Campaign/, so the module is on there and nowhere else.

function unique(name: string, retry: number): string {
  return retry === 0 ? name : `${name} ${String(retry)}`;
}

async function newNoteIn(page: Page, folder: string): Promise<void> {
  const row = page.getByRole('tree').getByRole('treeitem', { name: new RegExp(`^${folder}`) });
  await row.first().hover();
  await row.first().getByRole('button', { name: 'New note' }).click();
}

test('a stat block is drawn in the wiki, with the scores and their modifiers', async ({ page }) => {
  await page.goto("/v/default/wiki/Campaign/NPCs/Mira's%20Ledger");
  const block = page.locator('.rz-statblock').first();
  await expect(block).toBeVisible();
  await expect(block.locator('.rz-statblock-name')).toHaveText('Mira Voss');
  await expect(block).toContainText('Armor Class');
  await expect(block.getByRole('cell', { name: '18 (+4)' })).toBeVisible();
  await expect(block).toContainText('Call the Debt');
});

test('a prep note embeds the stat block of another note, and only the block', async ({ page }) => {
  await page.goto('/v/default/wiki/Campaign/Sessions/Session%2013%20%E2%80%93%20Ashes%20and%20Ink');
  const embed = page.locator('.rz-embed .rz-statblock');
  await expect(embed).toBeVisible();
  await expect(embed).toContainText('Mira Voss');
  await expect(page.locator('.rz-embed', { has: page.locator('.rz-statblock') })).not.toContainText(
    'Master Thief stat block',
  );
});

test('a new NPC inside the campaign can start from the built-in template', async ({
  page,
}, info) => {
  const name = unique('Harbour pilot', info.retry);
  await page.goto('/v/default');
  await expect(page.getByRole('tree')).toBeVisible();
  await newNoteIn(page, 'Campaign');

  const dialog = page.getByRole('dialog');
  const template = dialog.getByLabel('From a template', { exact: true });
  await expect(template.locator('option', { hasText: 'Faction (built in)' })).toHaveCount(1);
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await template.selectOption({ label: 'Faction (built in)' });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('type: faction');
  await expect(editor).toContainText(name);
});

test('outside the campaign there is no built-in template', async ({ page }) => {
  await page.goto('/v/default');
  await expect(page.getByRole('tree')).toBeVisible();
  // The palette makes the note at the vault root; the panel's button would use the focused folder.
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('New note');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  // The vault's own NPC template is offered, so the list is there and simply holds no built-in one.
  await expect(dialog.locator('option', { hasText: 'NPC' })).toHaveCount(1);
  await expect(dialog.locator('option', { hasText: '(built in)' })).toHaveCount(0);
});
