import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VaultInfo } from '@rhizom/core';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

function vaultWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'rhizom-campaign-'));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

async function infoOf(files: Record<string, string>): Promise<VaultInfo> {
  const root = vaultWith(files);
  const app = await buildApp({
    webDist: false,
    vault: { dir: root, dataDir: ':memory:', watch: false },
  });
  try {
    return (await app.inject('/api/v/default/vault')).json<VaultInfo>();
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the campaign in the vault info', () => {
  it('names the campaign note, its folder and its system', async () => {
    const info = await infoOf({
      'Home.md': '# Home\n',
      'Campaign/Campaign.md': '---\ntype: campaign\nsystem: D&D 5e\n---\n# Silverstadt\n',
      'Campaign/NPCs/Mira.md': '---\ntype: npc\n---\n# Mira\n',
    });
    expect(info.campaign).toEqual({
      path: 'Campaign/Campaign.md',
      folder: 'Campaign',
      system: 'D&D 5e',
    });
  });

  it('is null in a vault without one', async () => {
    expect((await infoOf({ 'Home.md': '# Home\n' })).campaign).toBeNull();
  });
});
