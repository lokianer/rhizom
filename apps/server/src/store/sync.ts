// Keeps the index in step with the vault: a full sync compares file sizes and modification
// times with what the index remembers and re-parses only what changed; indexPaths handles the
// batches the file watcher reports. Both yield to the event loop between chunks so an open
// server keeps answering requests during a rebuild.
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

import { noteNameOf, parseNote } from '@rhizom/core';

import { VaultError, type Vault } from '../vault/files.js';
import type { VaultIndex } from './vault-index.js';

export interface SyncOptions {
  /** Notes parsed between two yields to the event loop. */
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

export async function syncVault(
  vault: Vault,
  index: VaultIndex,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const chunkSize = options.chunkSize ?? 200;
  const files = await vault.listNotes();
  const states = index.fileStates();

  const pending: { path: string; isNew: boolean }[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const file of files) {
    seen.add(file.path);
    const state = states.get(file.path);
    if (state?.size === file.size && state.modifiedAt.getTime() === file.modifiedAt.getTime()) {
      unchanged += 1;
      continue;
    }
    pending.push({ path: file.path, isNew: state === undefined });
  }
  const removed = [...states.keys()].filter((path) => !seen.has(path));

  let added = 0;
  let updated = 0;
  for (let offset = 0; offset < pending.length; offset += chunkSize) {
    const chunk = pending.slice(offset, offset + chunkSize);
    for (const item of chunk) {
      if (await indexOne(vault, index, item.path)) {
        if (item.isNew) {
          added += 1;
        } else {
          updated += 1;
        }
      }
    }
    options.onProgress?.(Math.min(offset + chunkSize, pending.length), pending.length);
    await yieldToEventLoop();
  }
  for (const path of removed) {
    index.removeNote(path);
  }
  index.setMeta('indexedAt', new Date().toISOString());
  return { added, updated, removed: removed.length, unchanged };
}

/**
 * Indexes the given vault paths (as reported by the watcher): notes that exist are re-parsed,
 * notes that are gone are removed, anything that is not a note is ignored.
 */
export async function indexPaths(
  vault: Vault,
  index: VaultIndex,
  paths: readonly string[],
): Promise<{ indexed: string[]; removed: string[]; unchanged: string[] }> {
  const indexed: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const path of paths) {
    try {
      // Watchers over-report on some platforms: a note whose content hash the index already
      // has is left alone, so nothing downstream is told about a change that did not happen.
      if (await indexNote(vault, index, path, { skipUnchanged: true })) {
        indexed.push(path);
      } else {
        unchanged.push(path);
      }
    } catch (error) {
      if (error instanceof VaultError && error.code === 'NOT_FOUND') {
        index.removeNote(path);
        removed.push(path);
      } else if (!(error instanceof VaultError)) {
        throw error;
      }
    }
  }
  return { indexed, removed, unchanged };
}

async function indexOne(vault: Vault, index: VaultIndex, path: string): Promise<boolean> {
  try {
    await indexNote(vault, index, path);
    return true;
  } catch (error) {
    if (error instanceof VaultError) {
      return false;
    }
    throw error;
  }
}

/** Reads, parses and stores one note; returns false when it was skipped as unchanged. */
async function indexNote(
  vault: Vault,
  index: VaultIndex,
  path: string,
  options: { skipUnchanged?: boolean } = {},
): Promise<boolean> {
  const note = await vault.readNote(path);
  if (options.skipUnchanged === true && index.getNote(note.path)?.hash === note.hash) {
    return false;
  }
  index.upsertNote({
    path: note.path,
    size: note.size,
    modifiedAt: note.modifiedAt,
    hash: note.hash,
    content: note.content,
    parsed: parseNote(note.content, { fallbackTitle: noteNameOf(note.path) }),
  });
  return true;
}
