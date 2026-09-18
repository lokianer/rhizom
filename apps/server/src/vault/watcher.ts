// Watches a vault folder for changes made outside Rhizom (editors, git, sync clients) and
// reports them in debounced batches of vault paths, so a git checkout touching hundreds of files
// becomes one re-index pass instead of hundreds. Batches can over-report: macOS FSEvents names
// unchanged neighbours of a deleted or renamed file as changed, so consumers compare the file
// with what they already know before doing any work.
import { isAbsolute, relative } from 'node:path';

import { isMarkdownFile, toVaultPath } from '@rhizom/core';
import chokidar from 'chokidar';

export interface VaultChanges {
  /** Notes that were added or modified. */
  changed: string[];
  /** Notes that were deleted or moved away. */
  removed: string[];
}

export interface WatchOptions {
  /** Quiet time after the last event before a batch is reported. */
  debounceMs?: number;
  /** How long a file's size must stay stable before its write counts as finished. */
  writeSettleMs?: number;
  /** Upper bound between the first event of a batch and its report, for long bursts. */
  maxWaitMs?: number;
  onError?: (error: unknown) => void;
}

export interface VaultWatcher {
  /** Resolves once the initial scan is complete and changes are being reported. */
  ready: Promise<void>;
  close(): Promise<void>;
}

export function watchVault(
  root: string,
  onChanges: (changes: VaultChanges) => void,
  options: WatchOptions = {},
): VaultWatcher {
  const debounceMs = options.debounceMs ?? 300;
  const writeSettleMs = options.writeSettleMs ?? 200;
  const maxWaitMs = options.maxWaitMs ?? 1_500;

  const changed = new Set<string>();
  const removed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let batchStartedAt: number | undefined;

  const toPath = (reported: string): string =>
    toVaultPath(isAbsolute(reported) ? relative(root, reported) : reported);

  const isHidden = (path: string): boolean =>
    path.split('/').some((segment) => segment.startsWith('.'));

  const flush = (): void => {
    timer = undefined;
    batchStartedAt = undefined;
    if (changed.size === 0 && removed.size === 0) {
      return;
    }
    const batch: VaultChanges = { changed: [...changed].sort(), removed: [...removed].sort() };
    changed.clear();
    removed.clear();
    onChanges(batch);
  };

  const schedule = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    const now = Date.now();
    batchStartedAt ??= now;
    const remaining = Math.max(0, Math.min(debounceMs, batchStartedAt + maxWaitMs - now));
    timer = setTimeout(flush, remaining);
  };

  const record = (reported: string, kind: 'changed' | 'removed'): void => {
    const path = toPath(reported);
    if (isHidden(path) || !isMarkdownFile(path)) {
      return;
    }
    if (kind === 'changed') {
      removed.delete(path);
      changed.add(path);
    } else {
      changed.delete(path);
      removed.add(path);
    }
    schedule();
  };

  const watcher = chokidar.watch(root, {
    cwd: root,
    ignoreInitial: true,
    persistent: true,
    ignored: (reported, stats) => {
      const path = toPath(reported);
      if (path === '') {
        return false;
      }
      if (isHidden(path)) {
        return true;
      }
      return stats?.isFile() === true && !isMarkdownFile(path);
    },
    awaitWriteFinish: {
      stabilityThreshold: writeSettleMs,
      pollInterval: Math.min(writeSettleMs, 100),
    },
    atomic: true,
  });

  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => {
      resolve();
    });
  });

  watcher
    .on('add', (path) => {
      record(path, 'changed');
    })
    .on('change', (path) => {
      record(path, 'changed');
    })
    .on('unlink', (path) => {
      record(path, 'removed');
    })
    .on('error', (error) => {
      options.onError?.(error);
    });

  return {
    ready,
    close: async () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await watcher.close();
    },
  };
}
