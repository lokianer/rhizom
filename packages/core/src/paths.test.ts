import { describe, expect, it } from 'vitest';

import {
  ensureMarkdownExtension,
  folderOf,
  isSafeVaultPath,
  noteNameOf,
  toVaultPath,
} from './paths.js';

describe('toVaultPath', () => {
  it('turns backslashes into slashes', () => {
    expect(toVaultPath('Campaign\\NPCs\\Mira.md')).toBe('Campaign/NPCs/Mira.md');
  });

  it('collapses repeated slashes and strips a leading ./ or /', () => {
    expect(toVaultPath('./Campaign//NPCs/Mira.md')).toBe('Campaign/NPCs/Mira.md');
    expect(toVaultPath('/Campaign/NPCs/Mira.md')).toBe('Campaign/NPCs/Mira.md');
  });

  it('removes . segments and trims whitespace', () => {
    expect(toVaultPath(' Campaign/./NPCs/Mira.md ')).toBe('Campaign/NPCs/Mira.md');
  });

  it('normalises unicode to NFC so macOS and Linux file names compare equal', () => {
    const decomposed = 'U\u0308ber die Wurzeln.md';
    expect(toVaultPath(decomposed)).toBe('Über die Wurzeln.md');
  });

  it('keeps .. segments so the safety check can reject them', () => {
    expect(toVaultPath('../secret.md')).toBe('../secret.md');
  });
});

describe('isSafeVaultPath', () => {
  it.each([
    'Home.md',
    'Campaign/NPCs/Mira.md',
    'Research/Über die Wurzeln.md',
    "Campaign/NPCs/Mira's Ledger.md",
    'Research/v2.0 Notes.md',
    'assets/tavern.png',
  ])('accepts %s', (path) => {
    expect(isSafeVaultPath(path)).toBe(true);
  });

  it.each([
    '',
    '../secret.md',
    'Campaign/../../secret.md',
    'C:/Users/x/secret.md',
    'C:\\secret.md',
    '/etc/passwd',
    'Campaign//Mira.md',
    'Campaign/ /Mira.md',
    'nul.md',
    'Campaign/CON',
    'com1.txt',
    'trailing./note.md',
    'trailing /note.md',
    'bad\u0000name.md',
    'bad\nname.md',
    'question?.md',
    'pipe|name.md',
  ])('rejects %j', (path) => {
    expect(isSafeVaultPath(path)).toBe(false);
  });
});

describe('ensureMarkdownExtension', () => {
  it('appends .md when there is no Markdown extension', () => {
    expect(ensureMarkdownExtension('Silverstadt')).toBe('Silverstadt.md');
    expect(ensureMarkdownExtension('Research/v2.0 Notes')).toBe('Research/v2.0 Notes.md');
  });

  it('keeps existing Markdown extensions, whatever their case', () => {
    expect(ensureMarkdownExtension('Silverstadt.md')).toBe('Silverstadt.md');
    expect(ensureMarkdownExtension('Silverstadt.MD')).toBe('Silverstadt.MD');
    expect(ensureMarkdownExtension('Silverstadt.markdown')).toBe('Silverstadt.markdown');
  });
});

describe('noteNameOf and folderOf', () => {
  it('splits a vault path into folder and note name without extension', () => {
    expect(noteNameOf('Campaign/NPCs/Mira.md')).toBe('Mira');
    expect(folderOf('Campaign/NPCs/Mira.md')).toBe('Campaign/NPCs');
  });

  it('uses an empty folder for root notes and keeps dots inside names', () => {
    expect(noteNameOf('Home.md')).toBe('Home');
    expect(folderOf('Home.md')).toBe('');
    expect(noteNameOf('Research/v2.0 Notes.md')).toBe('v2.0 Notes');
  });

  it('leaves names without a Markdown extension untouched', () => {
    expect(noteNameOf('assets/tavern.png')).toBe('tavern.png');
  });
});
