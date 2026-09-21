import { describe, expect, it } from 'vitest';

import { isMarkdownFile, MARKDOWN_EXTENSIONS } from './markdown.js';

describe('MARKDOWN_EXTENSIONS', () => {
  it('lists the extensions Obsidian treats as notes', () => {
    expect(MARKDOWN_EXTENSIONS).toEqual(['.md', '.markdown']);
  });
});

describe('isMarkdownFile', () => {
  it.each([
    'note.md',
    'Note.MD',
    'note.markdown',
    'a.b.md',
    'folder/note.md',
    'folder\\note.md',
    'D:\\vault\\daily\\2026-09-18.md',
    '/home/user/vault/note.md',
  ])('accepts %s', (filePath) => {
    expect(isMarkdownFile(filePath)).toBe(true);
  });

  it.each([
    'note.mdx',
    'note.txt',
    'note',
    'md',
    '.md',
    'folder/.md',
    'note.md/',
    'folder.md/note.txt',
    'note.md.bak',
    '',
  ])('rejects %s', (filePath) => {
    expect(isMarkdownFile(filePath)).toBe(false);
  });
});
