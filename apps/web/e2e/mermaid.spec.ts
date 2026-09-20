import { expect, test, type Page } from '@playwright/test';

// The suite shares one vault and is not given a fresh copy between attempts, so each note is
// written through the API rather than typed: a fence typed into the editor comes back out with
// the brackets the editor closed for you.
//
// Neither note is named after the library, on purpose: the second test watches every request the
// page makes, and a note called "Mermaid probe" would put the word into its own URL.
async function writeNote(page: Page, path: string, lines: string[]): Promise<void> {
  const content = `${lines.join('\n')}\n`;
  const created = await page.request.post('/api/notes', { data: { path, content } });
  if (created.ok()) {
    return;
  }
  const url = `/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
  const saved = await page.request.put(url, { data: { content } });
  expect(saved.ok(), `could not write ${path}`).toBeTruthy();
}

/**
 * A request for the library rather than for the app's own source. In a development server the
 * modules are served one file per source file, so `/src/app/mermaid.ts` — the small eager half —
 * is fetched for every note and says nothing about whether the library came with it.
 */
function forTheLibrary(url: string): boolean {
  return /mermaid/i.test(url) && !url.includes('/src/');
}

test('a vault without diagrams never downloads the library', async ({ page }) => {
  await writeNote(page, 'Plain probe.md', [
    '# Plain probe',
    '',
    'A note with a code block in it, and no diagram anywhere.',
    '',
    '```js',
    'const graph = "TD";',
    '```',
  ]);

  const asked: string[] = [];
  page.on('request', (request) => asked.push(request.url()));

  await page.goto('/wiki/Plain probe');
  await expect(page.locator('.rz-prose')).toContainText('no diagram anywhere');
  await expect(page.locator('code')).toContainText('const graph');

  expect(asked.filter(forTheLibrary)).toEqual([]);
});

test('a diagram is drawn, and a broken one keeps its source and says why', async ({ page }) => {
  await writeNote(page, 'Diagram probe.md', [
    '# Diagram probe',
    '',
    '```mermaid',
    'graph TD',
    '  Harbour --> Market',
    '  Market --> Keep',
    '```',
    '',
    'And one that is still being written:',
    '',
    '```mermaid',
    'graph TD',
    '  Harbour -->',
    '```',
  ]);

  await page.goto('/wiki/Diagram probe');

  const diagrams = page.locator('.rz-mermaid');
  await expect(diagrams).toHaveCount(2);

  // Drawn: an SVG with the note's own words in it.
  const drawn = diagrams.first();
  await expect(drawn.locator('svg')).toBeVisible();
  await expect(drawn.locator('svg')).toContainText('Harbour');
  await expect(drawn.locator('svg')).toContainText('Keep');
  // The source is kept — it is what a theme change redraws from — but out of the way.
  await expect(drawn.locator('pre')).toBeHidden();
  await expect(drawn.locator('.rz-mermaid-failure')).toHaveCount(0);

  // Not drawn: the source stays on screen, with one line under it saying what was wrong.
  const broken = diagrams.nth(1);
  await expect(broken.locator('.rz-mermaid-failure')).toContainText('Not a diagram yet');
  await expect(broken.locator('pre')).toBeVisible();
  await expect(broken.locator('pre')).toContainText('Harbour -->');
  await expect(broken.locator('svg')).toHaveCount(0);
});
