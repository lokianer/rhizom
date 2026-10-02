import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  currentVault,
  lastVault,
  leavesVault,
  legacyUrl,
  pickVault,
  redirectTarget,
  setCurrentVault,
  stripVault,
  vaultHref,
} from './vault.js';

const vaults = [
  { id: 'dnd', name: 'dnd' },
  { id: 'thesis', name: 'Thesis' },
];

describe('vault routing', () => {
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
  });
  afterEach(() => {
    setCurrentVault('default');
    vi.unstubAllGlobals();
  });

  it('prefixes in-app paths with the current vault', () => {
    setCurrentVault('dnd');
    expect(currentVault()).toBe('dnd');
    expect(vaultHref('/notes/Mira')).toBe('/v/dnd/notes/Mira');
    expect(vaultHref('/')).toBe('/v/dnd');
    expect(vaultHref('/graph?note=a', 'thesis')).toBe('/v/thesis/graph?note=a');
  });

  it('strips the prefix again', () => {
    expect(stripVault('/v/dnd/notes/Mira')).toBe('/notes/Mira');
    expect(stripVault('/v/dnd')).toBe('/');
    expect(stripVault('/notes/Mira')).toBe('/notes/Mira');
  });

  it('remembers the last vault and picks it while it is registered', () => {
    setCurrentVault('thesis');
    expect(lastVault()).toBe('thesis');
    expect(pickVault(vaults, 'thesis')).toBe('thesis');
    expect(pickVault(vaults, 'gone')).toBe('dnd');
    expect(pickVault([], null)).toBe('default');
  });

  it('keeps the remembered vault when the list of vaults could not be read', () => {
    expect(pickVault([], 'thesis')).toBe('thesis');
    setCurrentVault('thesis');
    setCurrentVault('default', false);
    expect(currentVault()).toBe('default');
    expect(lastVault()).toBe('thesis');
  });

  it('knows when an address leads into another vault than the one the tab is in', () => {
    setCurrentVault('second');
    expect(leavesVault('default')).toBe(true);
    expect(leavesVault('second')).toBe(false);
  });

  it('keeps the query and the fragment of an old bookmark', () => {
    expect(redirectTarget(new URL('http://x/graph?note=a.md'), 'dnd')).toBe(
      '/v/dnd/graph?note=a.md',
    );
    expect(redirectTarget(new URL('http://x/notes/Mira#voice'), 'dnd')).toBe(
      '/v/dnd/notes/Mira#voice',
    );
    expect(redirectTarget(new URL('http://x/'), 'dnd')).toBe('/v/dnd');
  });

  it('takes the fragment from the address bar, which a loader request leaves out', () => {
    const url = legacyUrl('http://x/wiki/Home', { pathname: '/wiki/Home', hash: '#voice' });
    expect(redirectTarget(url, 'dnd')).toBe('/v/dnd/wiki/Home#voice');
    // A navigation inside the app: the address bar still shows the page it came from.
    expect(legacyUrl('http://x/graph', { pathname: '/wiki/Home', hash: '#voice' }).hash).toBe('');
  });
});
