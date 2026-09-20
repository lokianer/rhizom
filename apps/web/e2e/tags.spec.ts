import { expect, test } from '@playwright/test';

// The example vault writes its tags as a hierarchy: `campaign/silverstadt/npcs`, `npc/ally`,
// `npc/rival` and so on. The panel should show those as levels, and a level should ask for
// everything below it.

test('the tag panel nests a hierarchy and every level can be pressed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Tags' }).click();

  const tags = page.getByRole('list', { name: /tags/i });
  // `npc` is a level nobody wrote on its own — every note says `npc/ally` or `npc/rival` — and
  // it is there all the same, because it is how you ask for both at once.
  const npc = tags.getByRole('button', { name: 'Filter the graph by npc', exact: true });
  await expect(npc).toBeVisible();
  await expect(
    tags.getByRole('button', { name: 'Filter the graph by npc/ally', exact: true }),
  ).toBeVisible();

  await npc.click();
  await expect(npc).toHaveAttribute('aria-pressed', 'true');
  // A level is its own filter; pressing the parent does not press the children.
  await expect(
    tags.getByRole('button', { name: 'Filter the graph by npc/ally', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('asking for a parent tag finds the notes that only wrote a child', async ({ page }) => {
  await page.goto('/graph');
  await expect(page.locator('canvas')).toBeVisible();

  await page.getByRole('tab', { name: 'Tags' }).click();
  const tags = page.getByRole('list', { name: /tags/i });
  await tags.getByRole('button', { name: 'Filter the graph by npc', exact: true }).click();

  // The graph says how many notes are left; a parent that matched nothing would leave none.
  await expect(page.getByText(/\b[1-9]\d* notes?\b/)).toBeVisible();
});
