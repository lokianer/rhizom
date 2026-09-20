import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openVault, VaultError, type Vault } from './files.js';

const BOM = String.fromCharCode(0xfeff);

let root: string;
let vault: Vault;

function write(relative: string, content: string | Buffer): void {
  const absolute = join(root, ...relative.split('/'));
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

beforeEach(() => {
  // The real path: on macOS tmpdir() is /var/... , a symlink to /private/var/... , and
  // openVault resolves it, so the fixture has to compare against the resolved form.
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-vault-'));
  write('Home.md', '# Home\n\nWelcome.\n');
  write('Campaign/NPCs/Mira.md', '---\ntype: npc\n---\n# Mira\n');
  write('Campaign/notes.txt', 'not a note');
  write('assets/tavern.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write('.obsidian/app.json', '{}');
  write('.trash/Old.md', '# Old');
  write('.git/HEAD', 'ref: refs/heads/main');
  write('Research/Über die Wurzeln.md', '# Über\n');
  vault = openVault(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('openVault', () => {
  it('exposes the folder name and root', () => {
    expect(vault.root).toBe(root);
    expect(vault.name).toBe(
      root.slice(root.lastIndexOf(process.platform === 'win32' ? '\\' : '/') + 1),
    );
  });

  it('rejects a root that does not exist', () => {
    expect(() => openVault(join(root, 'missing'))).toThrow(VaultError);
  });
});

describe('listNotes', () => {
  it('lists Markdown files recursively with vault paths, size and modification time', async () => {
    const notes = await vault.listNotes();
    expect(notes.map((n) => n.path).sort()).toEqual([
      'Campaign/NPCs/Mira.md',
      'Home.md',
      'Research/Über die Wurzeln.md',
    ]);
    const home = notes.find((n) => n.path === 'Home.md');
    expect(home?.size).toBe(17);
    expect(home?.modifiedAt).toBeInstanceOf(Date);
  });

  it('ignores dot folders, the trash and non-Markdown files', async () => {
    const paths = (await vault.listNotes()).map((n) => n.path);
    expect(paths.some((p) => p.startsWith('.'))).toBe(false);
    expect(paths).not.toContain('Campaign/notes.txt');
  });
});

describe('readNote', () => {
  it('returns the content with LF line endings, a stable hash and file metadata', async () => {
    const note = await vault.readNote('Home.md');
    expect(note.content).toBe('# Home\n\nWelcome.\n');
    expect(note.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(note.size).toBe(17);
    expect(note.eol).toBe('\n');
    expect(note.bom).toBe(false);
    expect((await vault.readNote('Home.md')).hash).toBe(note.hash);
  });

  it('normalises CRLF to LF but remembers the original line ending and BOM', async () => {
    write('Windows.md', BOM + '# Title\r\n\r\nLine\r\n');
    const note = await vault.readNote('Windows.md');
    expect(note.content).toBe('# Title\n\nLine\n');
    expect(note.eol).toBe('\r\n');
    expect(note.bom).toBe(true);
  });

  it('reads a note saved as UTF-16, which a Windows editor still writes', async () => {
    // Read as UTF-8 this is a row of NUL bytes and mojibake — and saving it afterwards used to
    // write that back, which is the one thing a tool that promises not to touch your files must
    // never do.
    write('Utf16.md', Buffer.from(`${BOM}# Über die Wurzeln\n\nSchön.\n`, 'utf16le'));
    const note = await vault.readNote('Utf16.md');
    expect(note.content).toBe('# Über die Wurzeln\n\nSchön.\n');
    expect(note.encoding).toBe('utf16le');
  });

  it('reads the other byte order too', async () => {
    write('Utf16be.md', Buffer.from(`${BOM}# Über\n`, 'utf16le').swap16());
    const note = await vault.readNote('Utf16be.md');
    expect(note.content).toBe('# Über\n');
    expect(note.encoding).toBe('utf16be');
  });

  it('accepts backslashes and different unicode normalisation in the path', async () => {
    const note = await vault.readNote('Research\\Über die Wurzeln.md');
    expect(note.path).toBe('Research/Über die Wurzeln.md');
  });

  it('fails with NOT_FOUND for a missing note and UNSAFE_PATH for traversal', async () => {
    await expect(vault.readNote('Nope.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(vault.readNote('../outside.md')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(vault.readNote('.obsidian/app.json')).rejects.toMatchObject({
      code: 'UNSAFE_PATH',
    });
    await expect(vault.readNote('Campaign/notes.txt')).rejects.toMatchObject({
      code: 'NOT_A_NOTE',
    });
  });
});

describe('writeNote', () => {
  it('writes the content and returns the new hash', async () => {
    const before = await vault.readNote('Home.md');
    const result = await vault.writeNote('Home.md', '# Home\n\nChanged.\n', before.hash);
    expect(result.hash).not.toBe(before.hash);
    expect(readFileSync(join(root, 'Home.md'), 'utf8')).toBe('# Home\n\nChanged.\n');
  });

  it('restores the original line ending and BOM', async () => {
    write('Windows.md', BOM + '# Title\r\nLine\r\n');
    const before = await vault.readNote('Windows.md');
    await vault.writeNote('Windows.md', '# Title\nNew line\n', before.hash);
    expect(readFileSync(join(root, 'Windows.md'), 'utf8')).toBe(BOM + '# Title\r\nNew line\r\n');
  });

  it('refuses to overwrite a note that changed since it was read', async () => {
    const before = await vault.readNote('Home.md');
    write('Home.md', '# Home\n\nEdited outside.\n');
    await expect(
      vault.writeNote('Home.md', '# Home\n\nMine.\n', before.hash),
    ).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    });
    expect(readFileSync(join(root, 'Home.md'), 'utf8')).toBe('# Home\n\nEdited outside.\n');
  });

  it('writes without a hash check when no expected hash is given', async () => {
    await vault.writeNote('Home.md', 'free\n');
    expect(readFileSync(join(root, 'Home.md'), 'utf8')).toBe('free\n');
  });

  it('leaves no temporary files behind', async () => {
    const before = await vault.readNote('Home.md');
    await vault.writeNote('Home.md', 'x\n', before.hash);
    const leftovers = (await vault.listAssets()).filter((a) => a.path.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('writeNote and encodings', () => {
  it('saves a UTF-16 note as UTF-8, text and all', async () => {
    // Every vault ends up in one encoding, and the text survives the move whole: umlauts, an
    // emoji made of two code units, and a family made of several joined together.
    const text = '# Über die Wurzeln\n\nSchön 🌱 und 👨‍👩‍👧 dazu.\n';
    for (const encoding of ['utf16le', 'utf16be'] as const) {
      const path = `${encoding}.md`;
      const little = Buffer.from(`${BOM}${text}`, 'utf16le');
      write(path, encoding === 'utf16le' ? little : Buffer.from(little).swap16());

      expect((await vault.readNote(path)).encoding).toBe(encoding);
      await vault.writeNote(path, text);

      const bytes = readFileSync(join(root, path));
      expect(bytes.toString('utf8')).toBe(text);
      expect(bytes[0]).not.toBe(0xff);
      expect(bytes[0]).not.toBe(0xfe);

      const after = await vault.readNote(path);
      expect(after.content).toBe(text);
      expect(after.encoding).toBe('utf8');
    }
  });

  it('carries umlauts and emoji through a plain save unchanged', async () => {
    const text = '# Äpfel 🍎\n\nZwei Zeichen, vier Bytes: 𝄞 und 🇩🇪.\n';
    write('Emoji.md', text);
    await vault.writeNote('Emoji.md', `${text}Noch eins: 🙂\n`);
    const after = await vault.readNote('Emoji.md');
    expect(after.content).toBe(`${text}Noch eins: 🙂\n`);
    expect([...after.content].length).toBeLessThan(after.content.length + 1);
  });

  it('writes a UTF-8 note as UTF-8, byte order mark and all', async () => {
    write('Marked.md', `${BOM}# Title\n`);
    await vault.writeNote('Marked.md', '# Title\n\nMore.\n');
    const bytes = readFileSync(join(root, 'Marked.md'));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect((await vault.readNote('Marked.md')).encoding).toBe('utf8');
  });
});

describe('createNote', () => {
  it('creates a note and its folders', async () => {
    const created = await vault.createNote(
      'Campaign/Quests/The Ashen Codex.md',
      '# The Ashen Codex\n',
    );
    expect(created.path).toBe('Campaign/Quests/The Ashen Codex.md');
    expect(existsSync(join(root, 'Campaign', 'Quests', 'The Ashen Codex.md'))).toBe(true);
  });

  it('adds the Markdown extension when it is missing and defaults to an empty body', async () => {
    const created = await vault.createNote('Ideas');
    expect(created.path).toBe('Ideas.md');
    expect(readFileSync(join(root, 'Ideas.md'), 'utf8')).toBe('');
  });

  it('refuses to overwrite an existing note, also when the case differs', async () => {
    await expect(vault.createNote('Home.md')).rejects.toMatchObject({ code: 'EXISTS' });
    await expect(vault.createNote('home.md')).rejects.toMatchObject({ code: 'EXISTS' });
  });
});

describe('moveNote', () => {
  it('moves a note and creates the target folder on the way', async () => {
    const before = await vault.readNote('Home.md');
    const result = await vault.moveNote('Home.md', 'Archive/2026/Home.md');
    expect(result).toEqual({ from: 'Home.md', to: 'Archive/2026/Home.md', hash: before.hash });
    expect(readFileSync(join(root, 'Archive', '2026', 'Home.md'), 'utf8')).toBe(
      '# Home\n\nWelcome.\n',
    );
  });

  it('leaves nothing behind at the old path and lists the new one', async () => {
    await vault.moveNote('Campaign/NPCs/Mira.md', 'People/Mira.md');
    expect(existsSync(join(root, 'Campaign', 'NPCs', 'Mira.md'))).toBe(false);
    const paths = (await vault.listNotes()).map((n) => n.path);
    expect(paths).toContain('People/Mira.md');
    expect(paths).not.toContain('Campaign/NPCs/Mira.md');
  });

  it('normalises both paths in the result', async () => {
    const result = await vault.moveNote('Campaign\\NPCs\\Mira.md', 'Campaign\\Mira.md');
    expect(result.from).toBe('Campaign/NPCs/Mira.md');
    expect(result.to).toBe('Campaign/Mira.md');
  });

  it('appends the Markdown extension when the target has none', async () => {
    const result = await vault.moveNote('Home.md', 'Campaign/Home');
    expect(result.to).toBe('Campaign/Home.md');
    expect(existsSync(join(root, 'Campaign', 'Home.md'))).toBe(true);
  });

  it('refuses a target that is taken and leaves both notes where they are', async () => {
    await expect(vault.moveNote('Campaign/NPCs/Mira.md', 'Home.md')).rejects.toMatchObject({
      code: 'EXISTS',
    });
    expect(readFileSync(join(root, 'Campaign', 'NPCs', 'Mira.md'), 'utf8')).toContain('# Mira');
    expect(readFileSync(join(root, 'Home.md'), 'utf8')).toBe('# Home\n\nWelcome.\n');
  });

  it('refuses a target taken by a note whose name only differs in case', async () => {
    await expect(vault.moveNote('Campaign/NPCs/Mira.md', 'home.md')).rejects.toMatchObject({
      code: 'EXISTS',
    });
    expect(existsSync(join(root, 'Campaign', 'NPCs', 'Mira.md'))).toBe(true);
  });

  it('refuses a move when the note changed since it was read', async () => {
    const before = await vault.readNote('Home.md');
    write('Home.md', '# Home\n\nEdited outside.\n');
    await expect(vault.moveNote('Home.md', 'Moved.md', before.hash)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    });
    expect(existsSync(join(root, 'Moved.md'))).toBe(false);
    expect(existsSync(join(root, 'Home.md'))).toBe(true);
  });

  it('fails with NOT_FOUND when the source is not there', async () => {
    await expect(vault.moveNote('Nope.md', 'Elsewhere.md')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses the trash and traversal on either side', async () => {
    const pairs = [
      ['.trash/Old.md', 'Restored.md'],
      ['Home.md', '.trash/Home.md'],
      ['../outside.md', 'Inside.md'],
      ['Home.md', '../outside.md'],
    ] as const;
    for (const [from, to] of pairs) {
      await expect(vault.moveNote(from, to)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    }
    expect(existsSync(join(root, 'Home.md'))).toBe(true);
  });

  it('moves the bytes, so a UTF-16 note arrives as the file it was', async () => {
    // Routing a move through a read and a write would silently convert the note; moving is not
    // editing, and a note nobody touched must come out of it byte for byte.
    const bytes = Buffer.from(`${BOM}# Über die Wurzeln\n\nSchön 🌱.\n`, 'utf16le');
    write('Utf16.md', bytes);
    await vault.moveNote('Utf16.md', 'Research/Utf16.md');
    expect(readFileSync(join(root, 'Research', 'Utf16.md'))).toEqual(bytes);
    expect((await vault.readNote('Research/Utf16.md')).encoding).toBe('utf16le');
  });

  it('renames a note when only the capitalisation changes', async () => {
    // The one case that behaves differently on each runner: Linux has two names here, Windows
    // and macOS have one. Both ways the vault has to end up spelling the note the new way.
    write('archive.md', '# Archive\n');
    const result = await vault.moveNote('archive.md', 'Archive.md');
    expect(result.to).toBe('Archive.md');

    const paths = (await vault.listNotes()).map((n) => n.path);
    expect(paths).toContain('Archive.md');
    expect(paths.filter((p) => p.toLowerCase() === 'archive.md')).toHaveLength(1);
    expect(paths.some((p) => p.includes('.rename-'))).toBe(false);
    expect((await vault.readNote('Archive.md')).content).toBe('# Archive\n');
  });
});

describe('deleteNote', () => {
  it('moves the note into .trash keeping its folder structure', async () => {
    await vault.deleteNote('Campaign/NPCs/Mira.md');
    expect(existsSync(join(root, 'Campaign', 'NPCs', 'Mira.md'))).toBe(false);
    expect(readFileSync(join(root, '.trash', 'Campaign', 'NPCs', 'Mira.md'), 'utf8')).toContain(
      '# Mira',
    );
  });

  it('does not overwrite an earlier trashed note with the same path', async () => {
    await vault.deleteNote('Home.md');
    await vault.createNote('Home.md', 'second\n');
    await vault.deleteNote('Home.md');
    expect(readFileSync(join(root, '.trash', 'Home.md'), 'utf8')).toBe('# Home\n\nWelcome.\n');
    expect(existsSync(join(root, '.trash', 'Home 1.md'))).toBe(true);
  });

  it('fails with NOT_FOUND for a missing note', async () => {
    await expect(vault.deleteNote('Nope.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('assets', () => {
  it('lists non-Markdown files outside dot folders', async () => {
    const assets = await vault.listAssets();
    expect(assets.map((a) => a.path).sort()).toEqual(['Campaign/notes.txt', 'assets/tavern.png']);
  });

  it('resolves a safe asset path to an absolute file path and refuses unsafe ones', () => {
    expect(vault.assetPath('assets/tavern.png')).toBe(join(root, 'assets', 'tavern.png'));
    expect(() => vault.assetPath('../secret.png')).toThrow(VaultError);
    expect(() => vault.assetPath('.obsidian/app.json')).toThrow(VaultError);
  });

  it('stores an uploaded file under assets/ with a unique, safe name', async () => {
    const first = await vault.storeAsset('tavern.png', Buffer.from('new'));
    expect(first.path).toBe('assets/tavern 1.png');
    const second = await vault.storeAsset('../evil name?.png', Buffer.from('x'));
    expect(second.path).toBe('assets/evil name.png');
    expect(existsSync(join(root, 'assets', 'evil name.png'))).toBe(true);
  });
});
