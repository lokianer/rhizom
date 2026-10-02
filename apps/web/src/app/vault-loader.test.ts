import { afterEach, describe, expect, it } from 'vitest';

import { setCurrentVault } from '../routing/vault.js';
import { isPlayerView, revalidateVault } from './vault-loader.js';

describe('the vault route', () => {
  afterEach(() => {
    setCurrentVault('default');
  });

  it('tells the player view apart, so it never loads the GM note list', () => {
    expect(isPlayerView('/v/default/table')).toBe(true);
    expect(isPlayerView('/v/default/table/notes/Campaign/Mira')).toBe(true);
    expect(isPlayerView('/v/default/notes/table')).toBe(false);
    expect(isPlayerView('/v/default/tables')).toBe(false);
  });

  it('runs its loader again when a navigation leads out of the vault the tab is in', () => {
    // A switch to `second` that was interrupted before it committed: the page still shows
    // `default`, but the tab already speaks to `second`.
    setCurrentVault('second');
    expect(
      revalidateVault({ nextParams: { vault: 'default' }, defaultShouldRevalidate: false }),
    ).toBe(true);
    expect(
      revalidateVault({ nextParams: { vault: 'second' }, defaultShouldRevalidate: false }),
    ).toBe(false);
    expect(
      revalidateVault({ nextParams: { vault: 'second' }, defaultShouldRevalidate: true }),
    ).toBe(true);
  });
});
