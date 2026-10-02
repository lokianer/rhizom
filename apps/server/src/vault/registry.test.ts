import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkVaultDirs, parseVaultList, RegistryError, singleVault } from './registry.js';

const cwd = realpathSync.native(tmpdir());

describe('parseVaultList', () => {
  it('reads id=path pairs in order, trimming blanks and a trailing separator', () => {
    const vaults = parseVaultList(' dnd = campaigns/dnd ; thesis=notes/thesis;', cwd);
    expect(vaults).toEqual([
      { id: 'dnd', name: 'dnd', dir: join(cwd, 'campaigns', 'dnd') },
      { id: 'thesis', name: 'thesis', dir: join(cwd, 'notes', 'thesis') },
    ]);
  });

  it('splits on the first = only, so a Windows path survives', () => {
    const [vault] = parseVaultList('notes=D:\\Notes\\a=b', cwd);
    expect(vault?.id).toBe('notes');
    expect(vault?.dir.endsWith('a=b')).toBe(true);
  });

  it.each([
    ['dnd', 'not of the form id=path'],
    ['Dnd=x', 'not a valid vault id'],
    ['-x=x', 'not a valid vault id'],
    [`${'a'.repeat(33)}=x`, 'not a valid vault id'],
    ['dnd=', 'has no path'],
    ['dnd=a;dnd=b', 'named twice'],
    [' ; ', 'names no vault'],
  ])('rejects %j', (value, message) => {
    expect(() => parseVaultList(value, cwd)).toThrow(RegistryError);
    expect(() => parseVaultList(value, cwd)).toThrow(message);
  });
});

describe('singleVault', () => {
  it('names the one vault default and after its folder', () => {
    expect(singleVault(join(cwd, 'My Notes'))).toEqual({
      id: 'default',
      name: 'My Notes',
      dir: join(cwd, 'My Notes'),
    });
  });
});

describe('checkVaultDirs', () => {
  it('accepts directories and rejects missing paths and files', () => {
    const root = mkdtempSync(join(cwd, 'rhizom-registry-'));
    mkdirSync(join(root, 'a'));
    writeFileSync(join(root, 'file.md'), '');
    expect(() => {
      checkVaultDirs([{ id: 'a', name: 'a', dir: join(root, 'a') }]);
    }).not.toThrow();
    expect(() => {
      checkVaultDirs([{ id: 'b', name: 'b', dir: join(root, 'missing') }]);
    }).toThrow('Vault "b"');
    expect(() => {
      checkVaultDirs([{ id: 'c', name: 'c', dir: join(root, 'file.md') }]);
    }).toThrow('is not a directory');
  });
});
