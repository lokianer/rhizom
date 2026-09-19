// Everything the API needs for one vault: the files, the derived index, the sync between them,
// the file watcher and an event bus that tells connected clients what changed.
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { IndexEvent } from '@rhizom/core';

import { indexPaths, syncVault, type SyncResult } from '../store/sync.js';
import { VaultIndex } from '../store/vault-index.js';
import { openVault, type Vault } from './files.js';
import { readTemplateSettings, type TemplateSettings } from './templates.js';
import { watchVault, type VaultWatcher } from './watcher.js';

export interface VaultContextOptions {
  /** Absolute path of the vault folder. */
  dir: string;
  /** Folder for the index database, or ':memory:' for tests. */
  dataDir: string;
  /** Watch the folder for external changes (default true). */
  watch?: boolean;
  /** Template folder, where the operator would rather say than let the vault decide. */
  templateDir?: string;
  onWatchError?: (error: unknown) => void;
  onLog?: (message: string) => void;
}

export interface VaultContext {
  readonly vault: Vault;
  readonly index: VaultIndex;
  readonly events: EventEmitter<{ index: [IndexEvent] }>;
  /** Re-parses the given notes (after a write through the API or a watcher batch). */
  indexPaths(paths: readonly string[]): Promise<void>;
  /** Full incremental sync of the whole vault. */
  rebuild(): Promise<SyncResult>;
  /**
   * Where this vault keeps its templates, read afresh: the folder can appear, and Obsidian can
   * be told about it, while Rhizom is running.
   */
  templates(): TemplateSettings;
  close(): Promise<void>;
}

export async function openVaultContext(options: VaultContextOptions): Promise<VaultContext> {
  const vault = openVault(options.dir);
  let indexFile = ':memory:';
  if (options.dataDir !== ':memory:') {
    mkdirSync(options.dataDir, { recursive: true });
    indexFile = join(options.dataDir, 'index.sqlite');
  }
  const index = VaultIndex.open(indexFile);
  const events = new EventEmitter<{ index: [IndexEvent] }>();

  const context: VaultContext = {
    vault,
    index,
    events,
    async indexPaths(paths) {
      const result = await indexPaths(vault, index, paths);
      if (result.indexed.length > 0) {
        events.emit('index', { type: 'indexed', paths: result.indexed });
      }
      if (result.removed.length > 0) {
        events.emit('index', { type: 'removed', paths: result.removed });
      }
    },
    templates() {
      return readTemplateSettings(vault.root, options.templateDir);
    },
    async rebuild() {
      const result = await syncVault(vault, index);
      events.emit('index', { type: 'rebuilt', noteCount: index.stats().noteCount });
      return result;
    },
    async close() {
      await watcher?.close();
      index.close();
    },
  };

  const initial = await syncVault(vault, index);
  options.onLog?.(
    `Indexed ${vault.name}: ${String(initial.added)} added, ${String(initial.updated)} updated, ${String(initial.removed)} removed, ${String(initial.unchanged)} unchanged`,
  );

  let watcher: VaultWatcher | undefined;
  if (options.watch !== false) {
    watcher = watchVault(
      vault.root,
      (changes) => {
        void context.indexPaths([...changes.changed, ...changes.removed]);
      },
      options.onWatchError === undefined ? {} : { onError: options.onWatchError },
    );
    await watcher.ready;
  }

  return context;
}
