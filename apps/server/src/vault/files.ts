// File-system access to one vault. Notes are Markdown files; everything else outside dot
// folders is an asset. All paths crossing this boundary are vault paths (see @rhizom/core
// paths.ts) and are validated before they touch the disk.
import { createHash, randomBytes } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  ensureMarkdownExtension,
  isMarkdownFile,
  isSafeVaultPath,
  toVaultPath,
} from '@rhizom/core';

export type VaultErrorCode =
  'INVALID_ROOT' | 'UNSAFE_PATH' | 'NOT_A_NOTE' | 'NOT_FOUND' | 'EXISTS' | 'HASH_MISMATCH';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

export interface NoteFile {
  path: string;
  size: number;
  modifiedAt: Date;
}

export type LineEnding = '\n' | '\r\n';

export interface NoteContent extends NoteFile {
  /** Text with LF line endings and without a byte order mark. */
  content: string;
  /** SHA-1 of `content`, used for optimistic concurrency (`If-Match`). */
  hash: string;
  eol: LineEnding;
  bom: boolean;
}

export interface AssetFile {
  path: string;
  size: number;
  modifiedAt: Date;
}

export interface Vault {
  readonly root: string;
  /** Folder name of the vault. */
  readonly name: string;
  listNotes(): Promise<NoteFile[]>;
  listAssets(): Promise<AssetFile[]>;
  readNote(path: string): Promise<NoteContent>;
  /** Overwrites a note; with `expectedHash` the write is refused when the file changed. */
  writeNote(
    path: string,
    content: string,
    expectedHash?: string,
  ): Promise<{ path: string; hash: string; modifiedAt: Date }>;
  createNote(path: string, content?: string): Promise<{ path: string; hash: string }>;
  /** Moves a note into `.trash/`, keeping its folder structure. */
  deleteNote(path: string): Promise<{ trashedTo: string }>;
  /** Absolute path of an asset for serving; validates but does not check existence. */
  assetPath(path: string): string;
  /** Stores an uploaded file under `assets/` with a sanitised, unique name. */
  storeAsset(fileName: string, data: Buffer): Promise<{ path: string }>;
}

const TRASH_FOLDER = '.trash';
const ASSETS_FOLDER = 'assets';
const BOM = String.fromCharCode(0xfeff);
const FORBIDDEN_IN_NAME = /[<>:"|?*/\\]/g;

export function openVault(rootDir: string): Vault {
  const info = statSync(rootDir, { throwIfNoEntry: false });
  if (!info?.isDirectory()) {
    throw new VaultError(
      'INVALID_ROOT',
      `Vault folder does not exist or is not a directory: ${rootDir}`,
    );
  }
  // The real path: symlinks resolved and Windows 8.3 short names (RUNNER~1) expanded. Node's
  // fs.watch aborts the process with a libuv assertion when a watched path uses a short name.
  const root = realpathSync.native(rootDir);
  return {
    root,
    name: basename(root),
    listNotes: () => walk(root, root, '', isMarkdownFile),
    listAssets: () => walk(root, root, '', (path) => !isMarkdownFile(path)),
    readNote: (path) => readNote(root, path),
    writeNote: (path, content, expectedHash) => writeNote(root, path, content, expectedHash),
    createNote: (path, content = '') => createNote(root, path, content),
    deleteNote: (path) => deleteNote(root, path),
    assetPath: (path) => join(root, ...validateVaultPath(path).split('/')),
    storeAsset: (fileName, data) => storeAsset(root, fileName, data),
  };
}

async function walk(
  root: string,
  directory: string,
  prefix: string,
  include: (path: string) => boolean,
): Promise<NoteFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: NoteFile[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const vaultPath = toVaultPath(prefix === '' ? entry.name : `${prefix}/${entry.name}`);
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, absolute, vaultPath, include)));
    } else if (entry.isFile() && include(vaultPath)) {
      const info = await stat(absolute);
      files.push({ path: vaultPath, size: info.size, modifiedAt: info.mtime });
    }
  }
  return files;
}

function validateVaultPath(input: string): string {
  const path = toVaultPath(input);
  if (!isSafeVaultPath(path) || path.split('/').some((segment) => segment.startsWith('.'))) {
    throw new VaultError('UNSAFE_PATH', `Path is not allowed: ${input}`);
  }
  return path;
}

function validateNotePath(input: string): string {
  const path = validateVaultPath(input);
  if (!isMarkdownFile(path)) {
    throw new VaultError('NOT_A_NOTE', `Not a Markdown note: ${path}`);
  }
  return path;
}

function absoluteOf(root: string, path: string): string {
  return join(root, ...path.split('/'));
}

function hashOf(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

async function readNote(root: string, input: string): Promise<NoteContent> {
  const path = validateNotePath(input);
  const absolute = absoluteOf(root, path);
  const [buffer, info] = await Promise.all([readFile(absolute), stat(absolute)]).catch(
    (error: unknown) => {
      throw notFoundOr(error, path);
    },
  );
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = (bom ? buffer.subarray(3) : buffer).toString('utf8');
  const eol: LineEnding = text.includes('\r\n') ? '\r\n' : '\n';
  const content = text.replaceAll('\r\n', '\n');
  return {
    path,
    size: info.size,
    modifiedAt: info.mtime,
    content,
    hash: hashOf(content),
    eol,
    bom,
  };
}

async function writeNote(
  root: string,
  input: string,
  content: string,
  expectedHash: string | undefined,
): Promise<{ path: string; hash: string; modifiedAt: Date }> {
  const path = validateNotePath(input);
  let eol: LineEnding = '\n';
  let bom = false;
  const existing = await readNote(root, path).catch((error: unknown) => {
    if (error instanceof VaultError && error.code === 'NOT_FOUND' && expectedHash === undefined) {
      return undefined;
    }
    throw error;
  });
  if (existing) {
    if (expectedHash !== undefined && existing.hash !== expectedHash) {
      throw new VaultError('HASH_MISMATCH', `Note changed on disk since it was loaded: ${path}`);
    }
    eol = existing.eol;
    bom = existing.bom;
  }
  const absolute = absoluteOf(root, path);
  await atomicWrite(absolute, serialize(content, eol, bom));
  const info = await stat(absolute);
  return { path, hash: hashOf(content), modifiedAt: info.mtime };
}

async function createNote(
  root: string,
  input: string,
  content: string,
): Promise<{ path: string; hash: string }> {
  const path = validateNotePath(ensureMarkdownExtension(toVaultPath(input)));
  const absolute = absoluteOf(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  if ((await existingNameLike(dirname(absolute), basename(absolute))) !== undefined) {
    throw new VaultError('EXISTS', `Note already exists: ${path}`);
  }
  await atomicWrite(absolute, serialize(content, '\n', false));
  return { path, hash: hashOf(content) };
}

async function deleteNote(root: string, input: string): Promise<{ trashedTo: string }> {
  const path = validateNotePath(input);
  const absolute = absoluteOf(root, path);
  await stat(absolute).catch((error: unknown) => {
    throw notFoundOr(error, path);
  });
  const trashDirectory = join(root, TRASH_FOLDER, ...path.split('/').slice(0, -1));
  await mkdir(trashDirectory, { recursive: true });
  const target = await uniqueName(trashDirectory, basename(absolute));
  await rename(absolute, join(trashDirectory, target));
  const trashedTo = toVaultPath([TRASH_FOLDER, ...path.split('/').slice(0, -1), target].join('/'));
  return { trashedTo };
}

async function storeAsset(root: string, fileName: string, data: Buffer): Promise<{ path: string }> {
  const cleaned = basename(fileName.replaceAll('\\', '/'))
    .replace(FORBIDDEN_IN_NAME, '')
    .replace(/[\p{Cc}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const safeName = cleaned === '' || cleaned.startsWith('.') ? `file${cleaned}` : cleaned;
  const directory = join(root, ASSETS_FOLDER);
  await mkdir(directory, { recursive: true });
  const name = await uniqueName(directory, safeName);
  await atomicWrite(join(directory, name), data);
  return { path: toVaultPath(`${ASSETS_FOLDER}/${name}`) };
}

/** Finds an entry whose name matches case-insensitively (Linux is case-sensitive, the others are not). */
async function existingNameLike(directory: string, name: string): Promise<string | undefined> {
  const wanted = name.normalize('NFC').toLowerCase();
  const entries = await readdir(directory).catch(() => [] as string[]);
  return entries.find((entry) => entry.normalize('NFC').toLowerCase() === wanted);
}

/** `name`, or `name 1`, `name 2`, … until no entry with that name exists. */
async function uniqueName(directory: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (
    let counter = 1;
    (await existingNameLike(directory, candidate)) !== undefined;
    counter += 1
  ) {
    candidate = `${stem} ${String(counter)}${extension}`;
  }
  return candidate;
}

function serialize(content: string, eol: LineEnding, bom: boolean): string {
  const text = eol === '\n' ? content : content.replaceAll('\n', eol);
  return bom ? `${BOM}${text}` : text;
}

/**
 * Writes to a temporary file next to the target and renames it into place, so readers never see
 * a half-written note. Windows may briefly refuse the rename while a virus scanner or editor
 * holds the target; those errors are retried.
 */
async function atomicWrite(absolute: string, data: string | Buffer): Promise<void> {
  const temporary = join(
    dirname(absolute),
    `.${basename(absolute)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  await writeFile(temporary, data, { flag: 'wx', flush: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, absolute);
      return;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 5) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20 * (attempt + 1)));
        continue;
      }
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function notFoundOr(error: unknown, path: string): unknown {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return new VaultError('NOT_FOUND', `Note not found: ${path}`);
  }
  return error;
}
