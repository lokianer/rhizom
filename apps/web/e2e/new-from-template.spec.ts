import { expect, test, type Page } from '@playwright/test';

// A new note can start from one of the vault's templates. The example vault keeps two, and the
// NPC template writes a frontmatter block and a heading made from the new note's name.

function unique(name: string, retry: number): string {
  return retry === 0 ? name : `${name} ${String(retry)}`;
}

/**
 * The note the app just opened, read back through the API. Which folder the new note landed in
 * is the tree's business — the dialog offers the folder the reader was standing in — so the
 * path comes from where the app went rather than from a guess.
 */
async function openNote(page: Page): Promise<string> {
  const path = `${decodeURIComponent(new URL(page.url()).pathname.replace('/notes/', ''))}.md`;
  const res = await page.request.get(
    `/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`,
  );
  expect(res.ok(), `could not read ${path}`).toBeTruthy();
  return ((await res.json()) as { content: string }).content;
}

test('a new note can start from a template, with the placeholders filled in', async ({
  page,
}, info) => {
  const name = unique('Wandering tinker', info.retry);

  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('From a template', { exact: true }).selectOption({ label: 'NPC' });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  // The template's own text, with `{{title}}` standing for the name that was just typed.
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(name);
  await expect(editor).not.toContainText('{{title}}');

  const content = await openNote(page);
  expect(content).toContain('type: npc');
  expect(content).toContain(`# ${name}`);
});

test('without a template the new note is empty, as it always was', async ({ page }, info) => {
  const name = unique('Plain new note', info.retry);

  await page.goto('/');
  await expect(page.getByRole('tree')).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await expect(dialog.getByLabel('From a template', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.locator('.cm-content')).toBeVisible();
  expect((await openNote(page)).trim()).toBe('');
});
