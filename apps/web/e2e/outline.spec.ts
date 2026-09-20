import { expect, test, type Page } from '@playwright/test';

// Silverstadt is the example vault's deepest note: a title, sections, and four districts under
// one of them. Nothing here writes a note — the suite shares one vault that outlives a run,
// and both tests only read what the vault already says about itself.

function outline(page: Page) {
  return page.getByRole('list', { name: 'Outline' });
}

async function openOutlineTab(page: Page): Promise<void> {
  // The chosen tab is per visit, not remembered, so every test asks for it again.
  await page.getByRole('tab', { name: 'Outline' }).click();
}

test('the outline lists the open note and follows a heading into it', async ({ page }) => {
  await page.goto('/notes/Campaign/Places/Silverstadt');
  await expect(page.locator('.cm-content')).toBeVisible();
  await openOutlineTab(page);

  const rows = outline(page).getByRole('link');
  await expect(rows).toHaveText(
    [
      'Silverstadt',
      'Districts',
      'The Bellward',
      'Tidewater',
      'Lantern Quay',
      'The Undercroft',
      'Calendar',
      'History in three lines',
      'Rumours the party has heard',
    ],
    { timeout: 15_000 },
  );

  // The address of a heading is the note plus its slug — the same one a [[Note#Heading]] link
  // resolves to, so the outline and a link inside a note lead to the same place.
  const district = rows.filter({ hasText: 'Tidewater' });
  await expect(district).toHaveAttribute('href', '/notes/Campaign/Places/Silverstadt#tidewater');

  await district.click();
  await expect(page).toHaveURL('/notes/Campaign/Places/Silverstadt#tidewater');
  // The row stays marked: the address is what says where the reader asked to be.
  await expect(district).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('the outline says so when no note is open', async ({ page }) => {
  await page.goto('/');
  await openOutlineTab(page);

  await expect(page.getByText('No note is open.')).toBeVisible();
  await expect(outline(page)).toHaveCount(0);
});

test('a heading in the address scrolls the rendered note to it', async ({ page }) => {
  // The renderer puts the slug on the heading as an id; nothing read it until now, so the
  // address changed and the page stayed where it was.
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto('/wiki/Campaign/Places/Silverstadt');
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings.first()).toBeVisible();

  const last = headings.last();
  const slug = await last.getAttribute('id');
  expect(slug).toBeTruthy();
  // Far enough down a long note that it cannot already be on screen.
  await expect(last).not.toBeInViewport();

  await page.goto(`/wiki/Campaign/Places/Silverstadt#${encodeURIComponent(slug ?? '')}`);
  await expect(last).toBeInViewport();
});
