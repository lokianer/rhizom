import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { switchVaultUi, useVaultUiStore, vaultUiKey } from './vault-ui.js';

describe('per-vault UI state', () => {
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps expanded folders apart per vault', async () => {
    await switchVaultUi('dnd');
    useVaultUiStore.getState().toggleFolder('Campaign');
    await switchVaultUi('thesis');
    expect(useVaultUiStore.getState().expandedFolders).toEqual([]);
    useVaultUiStore.getState().setGraphDepth(2);
    await switchVaultUi('dnd');
    expect(useVaultUiStore.getState().expandedFolders).toEqual(['Campaign']);
    expect(useVaultUiStore.getState().graphDepth).toBe(0);
    expect(stored.get(vaultUiKey('dnd'))).toContain('Campaign');
    expect(stored.get(vaultUiKey('thesis'))).toContain('"graphDepth":2');
  });
});
