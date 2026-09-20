import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isInFolder } from '@rhizom/core';

import { readDailySettings, readTemplateSettings } from './templates.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rhizom-templates-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function obsidian(settings: string, file = 'templates.json'): void {
  mkdirSync(join(root, '.obsidian'), { recursive: true });
  writeFileSync(join(root, '.obsidian', file), settings, 'utf8');
}

describe('readTemplateSettings', () => {
  it('says a vault has no templates when nothing points at any', () => {
    expect(readTemplateSettings(root)).toEqual({
      folder: null,
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
    });
  });

  it("reads Obsidian's own setting, formats and all", () => {
    obsidian('{"folder":"Meta/Vorlagen","dateFormat":"DD.MM.YYYY","timeFormat":"HH:mm:ss"}');
    expect(readTemplateSettings(root)).toEqual({
      folder: 'Meta/Vorlagen',
      dateFormat: 'DD.MM.YYYY',
      timeFormat: 'HH:mm:ss',
    });
  });

  it('falls back to a folder called Templates, in the case the vault spells it', () => {
    mkdirSync(join(root, 'templates'));
    expect(readTemplateSettings(root).folder).toBe('templates');
  });

  it('prefers what the operator configured over both', () => {
    mkdirSync(join(root, 'Templates'));
    obsidian('{"folder":"Meta/Vorlagen"}');
    expect(readTemplateSettings(root, 'Boilerplate').folder).toBe('Boilerplate');
  });

  it('refuses a setting that points outside the vault', () => {
    // A folder somewhere else on the disk is not this vault's template folder.
    for (const configured of ['C:/Windows', 'c:templates', '../../secrets', '..']) {
      expect(readTemplateSettings(root, configured).folder).toBeNull();
    }
  });

  it('drops the dot segments a shell would write', () => {
    expect(readTemplateSettings(root, './Templates').folder).toBe('Templates');
    expect(readTemplateSettings(root, 'Meta/./Vorlagen/').folder).toBe('Meta/Vorlagen');
    expect(readTemplateSettings(root, '  Templates  ').folder).toBe('Templates');
  });

  it('normalises the accents, so a folder matches however it was typed', () => {
    const decomposed = 'Übung'.normalize('NFD');
    expect(readTemplateSettings(root, decomposed).folder).toBe('Übung'.normalize('NFC'));
  });

  it('takes a setting as a vault path, whichever slashes it was written with', () => {
    expect(readTemplateSettings(root, '\\Meta\\Vorlagen\\').folder).toBe('Meta/Vorlagen');
    expect(readTemplateSettings(root, '/Templates/').folder).toBe('Templates');
  });

  it('keeps the formats when the setting names no folder', () => {
    obsidian('{"folder":"","dateFormat":"YYYY/MM/DD"}');
    expect(readTemplateSettings(root)).toEqual({
      folder: null,
      dateFormat: 'YYYY/MM/DD',
      timeFormat: 'HH:mm',
    });
  });

  it('treats an unreadable or nonsensical settings file as nothing said', () => {
    obsidian('{ this is not json');
    expect(readTemplateSettings(root).folder).toBeNull();
    obsidian('"a string"');
    expect(readTemplateSettings(root).dateFormat).toBe('YYYY-MM-DD');
    obsidian('{"folder":42,"dateFormat":null}');
    expect(readTemplateSettings(root)).toEqual({
      folder: null,
      dateFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
    });
  });

  it('says nothing about a vault folder that is not there', () => {
    expect(readTemplateSettings(join(root, 'gone')).folder).toBeNull();
  });
});

describe('isInFolder', () => {
  it('counts a note in the folder and in a folder below it', () => {
    expect(isInFolder('Templates/NPC.md', 'Templates')).toBe(true);
    expect(isInFolder('Templates/Campaign/NPC.md', 'Templates')).toBe(true);
    expect(isInFolder('templates/NPC.md', 'Templates')).toBe(true);
  });

  it('counts nothing else', () => {
    expect(isInFolder('Home.md', 'Templates')).toBe(false);
    expect(isInFolder('Templates.md', 'Templates')).toBe(false);
    expect(isInFolder('Campaign/Templates.md', 'Templates')).toBe(false);
    expect(isInFolder('Templates/NPC.md', null)).toBe(false);
  });
});

describe('readDailySettings', () => {
  const daily = (file: string) => obsidian(file, 'daily-notes.json');

  it('says a vault keeps no daily notes when nothing points at any', () => {
    expect(readDailySettings(root)).toEqual({ folder: null, format: 'YYYY-MM-DD', template: null });
  });

  it("reads Obsidian's own setting", () => {
    daily('{"folder":"Journal","format":"YYYY/MM/DD dddd","template":"Templates/Tag"}');
    expect(readDailySettings(root)).toEqual({
      folder: 'Journal',
      format: 'YYYY/MM/DD dddd',
      // The template is a note, so it is reported with the extension a note has.
      template: 'Templates/Tag.md',
    });
  });

  it('keeps the extension a template already carries', () => {
    daily('{"template":"Templates/Tag.md"}');
    expect(readDailySettings(root).template).toBe('Templates/Tag.md');
  });

  it('falls back to a folder called Daily, in whatever case the vault spells it', () => {
    mkdirSync(join(root, 'DAILY'));
    expect(readDailySettings(root).folder).toBe('DAILY');
  });

  it('lets the operator say, over anything the vault says', () => {
    daily('{"folder":"Journal"}');
    mkdirSync(join(root, 'Daily'));
    expect(readDailySettings(root, 'Notes/Tage').folder).toBe('Notes/Tage');
  });

  it('refuses a setting that names something outside the vault', () => {
    daily('{"folder":"../elsewhere","template":"C:/Windows/notes"}');
    expect(readDailySettings(root)).toEqual({ folder: null, format: 'YYYY-MM-DD', template: null });
  });

  it('treats a settings file that is not JSON as a vault that has not said', () => {
    daily('not json at all');
    expect(readDailySettings(root)).toEqual({ folder: null, format: 'YYYY-MM-DD', template: null });
  });
});
