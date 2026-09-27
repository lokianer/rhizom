import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_EVENT_LISTENERS, openVaultContext, type VaultContext } from './context.js';

let root: string;
let context: VaultContext;

beforeEach(async () => {
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-context-'));
  writeFileSync(join(root, 'Home.md'), '# Home\n');
  context = await openVaultContext({ dir: root, dataDir: ':memory:', watch: false });
});

afterEach(async () => {
  await context.close();
  rmSync(root, { recursive: true, force: true });
});

describe('index events', () => {
  it('take a listener per open tab without calling eleven tabs a leak', async () => {
    const warnings: Error[] = [];
    const onWarning = (warning: Error): void => {
      warnings.push(warning);
    };
    process.on('warning', onWarning);
    const listeners = Array.from({ length: 25 }, () => () => undefined);
    try {
      for (const listener of listeners) {
        context.events.on('index', listener);
      }
      // Node reports the warning on a later tick.
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings.filter((warning) => warning.name === 'MaxListenersExceededWarning')).toEqual(
        [],
      );
      expect(context.events.getMaxListeners()).toBe(MAX_EVENT_LISTENERS);
    } finally {
      process.off('warning', onWarning);
      for (const listener of listeners) {
        context.events.off('index', listener);
      }
    }
  });
});
