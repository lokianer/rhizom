import { expect, test, type Page } from '@playwright/test';

// Renaming a tag from the sidebar: the preview says what it would do, the write does it, and the
// chips come back under the new name.
//
// The suite shares one throwaway vault and runs one worker, so each test makes its own notes and
// its own tag. A retry gets its own names: the vault is not reset between attempts.
function unique(name: string, retry: number): string {
  return retry === 0 ? name : `${name}${String(retry)}`;
}

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

test('renaming a tag rewrites the prose and the frontmatter', async ({ page }, info) => {
  const tag = unique('e2etag', info.retry);
  const renamed = `${tag}x`;
  const inProse = unique('Tag prose', info.retry);
  const inFrontmatter = unique('Tag frontmatter', info.retry);

  await writeNote(page, `${inProse}.md`, [`# ${inProse}`, '', `Written in the text: #${tag}`]);
  await writeNote(page, `${inFrontmatter}.md`, [
    '---',
    `tags: [${tag}/deep]`,
    '---',
    '',
    `# ${inFrontmatter}`,
  ]);

  await page.goto('/');
  await page.getByRole('tab', { name: 'Tags' }).click();
  const chip = page.getByRole('button', { name: `Filter the graph by ${tag}`, exact: true });
  await expect(chip).toBeVisible();

  await page.getByRole('button', { name: `Rename the tag ${tag}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename tag' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('New name', { exact: true }).fill(renamed);

  // Both notes, and both places: the line in the prose and the key in the frontmatter.
  await expect(dialog.getByText('2 notes are rewritten')).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText('in the frontmatter')).toBeVisible();

  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  await expect(
    page.getByRole('button', { name: `Filter the graph by ${renamed}`, exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(chip).toBeHidden();

  const prose = await page.request.get(`/api/notes/${encodeURIComponent(`${inProse}.md`)}`);
  expect(((await prose.json()) as { content: string }).content).toContain(`#${renamed}`);
  const front = await page.request.get(`/api/notes/${encodeURIComponent(`${inFrontmatter}.md`)}`);
  expect(((await front.json()) as { content: string }).content).toContain(`${renamed}/deep`);
});
