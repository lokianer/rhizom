import { expect, test, type Page } from '@playwright/test';

// The suite shares one vault and is not given a fresh copy between attempts, so each note is
// written through the API rather than typed: the editor closes a bracket as you type it, and
// `[!note]` would arrive as `[!note]]`.
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

test('a callout is drawn as one, and a folded one opens', async ({ page }) => {
  await writeNote(page, 'Callout probe.md', [
    '# Callout probe',
    '',
    '> [!warning] The causeway floods',
    '> Twice a day, and the charts are wrong about when.',
    '',
    '> [!note]',
    '> A callout with no title of its own.',
    '',
    '> [!question]- What the tide does at the new moon',
    '> Nobody has written it down.',
    '',
    '> An ordinary quote, which is not a callout.',
  ]);

  await page.goto('/wiki/Callout probe');

  const warning = page.locator('.rz-callout-warning');
  await expect(warning).toContainText('The causeway floods');
  await expect(warning).toContainText('the charts are wrong');

  // Without a title of its own, a callout is named by its kind, in the language of the app.
  await expect(page.locator('.rz-callout-note')).toContainText('Note');

  // Folded: the body is there but not shown until the summary is clicked.
  const folded = page.locator('details.rz-callout-question');
  await expect(folded).not.toHaveAttribute('open', '');
  await expect(folded.getByText('Nobody has written it down.')).toBeHidden();
  await folded.locator('summary').click();
  await expect(folded.getByText('Nobody has written it down.')).toBeVisible();

  // A blockquote that names no kind stays a blockquote.
  await expect(page.locator('blockquote')).toContainText('An ordinary quote');
  await expect(page.locator('blockquote.rz-callout')).toHaveCount(0);
});

test('a task list is drawn with boxes, ticked where the note ticked them', async ({ page }) => {
  await writeNote(page, 'Task probe.md', [
    '# Task probe',
    '',
    '- [ ] print the map',
    '- [x] pack the dice',
    '- an ordinary item',
  ]);

  await page.goto('/wiki/Task probe');

  const tasks = page.locator('.rz-tasks');
  await expect(tasks.locator('.rz-task')).toHaveCount(2);
  await expect(tasks.getByRole('checkbox').first()).not.toBeChecked();
  await expect(tasks.getByRole('checkbox').nth(1)).toBeChecked();
  // Disabled until ticking one writes the file, which is a later slice.
  await expect(tasks.getByRole('checkbox').first()).toBeDisabled();
  await expect(tasks.locator('.rz-task-done')).toContainText('pack the dice');
  await expect(tasks).toContainText('an ordinary item');
});
