import { expect, test } from '@playwright/test';

// The e2e server registers two vaults: `default`, a copy of the example vault, and `second`, a
// two-note vault written by serve.mjs.

test('an old bookmark lands on the note in the default vault', async ({ page }) => {
  await page.goto('/notes/Home');
  await expect(page).toHaveURL(/\/v\/default\/notes\/Home$/);
  await expect(page.getByRole('tree').getByRole('treeitem', { name: 'Home' })).toBeVisible();
});

test('an old graph address keeps its query', async ({ page }) => {
  await page.goto('/graph?note=Home.md');
  await expect(page).toHaveURL(/\/v\/default\/graph\?note=Home\.md$/);
});

test('the switcher moves between vaults and the tree follows', async ({ page }) => {
  await page.goto('/v/default');
  const switcher = page.getByRole('combobox', { name: 'Vault' });
  await expect(switcher).toHaveValue('default');
  await switcher.selectOption('second');
  await expect(page).toHaveURL(/\/v\/second$/);
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('treeitem', { name: 'Thesis' })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'Home' })).toHaveCount(0);
});

test('the palette offers the other vault', async ({ page }) => {
  await page.goto('/v/second');
  await expect(page.getByRole('tree')).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Command palette' }).fill('Switch to vault');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/v\/default$/);
});

test('two tabs hold two vaults at once', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto('/v/default/wiki/Home');
  await second.goto('/v/second/wiki/Thesis');
  await expect(second.getByText('Chapter one links')).toBeVisible();
  await first.reload();
  await expect(first).toHaveURL(/\/v\/default\/wiki\/Home$/);
  await expect(first.getByRole('tree').getByRole('treeitem', { name: 'Thesis' })).toHaveCount(0);
});

test('a link inside the second vault stays in it', async ({ page }) => {
  await page.goto('/v/second/wiki/Thesis');
  await page.getByRole('link', { name: 'Method' }).click();
  await expect(page).toHaveURL(/\/v\/second\/wiki\/Method$/);
});

test('an unknown vault says so and offers the real ones', async ({ page }) => {
  await page.goto('/v/nowhere');
  await expect(page.getByRole('heading', { name: 'This vault does not exist' })).toBeVisible();
  await page.getByRole('link', { name: 'second' }).click();
  await expect(page).toHaveURL(/\/v\/second$/);
});
