import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultContext } from './context.js';
import { VaultPool } from './pool.js';
import type { RegisteredVault } from './registry.js';

const vaults: RegisteredVault[] = [
  { id: 'a', name: 'a', dir: '/a' },
  { id: 'b', name: 'b', dir: '/b' },
];
const IDLE = 1_000;

type FakeContext = VaultContext & { closed: boolean; close: () => Promise<void> };

function fakeContext(): FakeContext {
  const context = {
    closed: false,
    close: vi.fn(() => {
      context.closed = true;
      return Promise.resolve();
    }),
  };
  return context as unknown as FakeContext;
}

describe('VaultPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a vault on first use and shares one pending open', async () => {
    const open = vi.fn(() => Promise.resolve(fakeContext()));
    const pool = new VaultPool({ vaults, open, idleMs: IDLE });
    expect(pool.isOpen('a')).toBe(false);
    const [first, second] = await Promise.all([pool.get('a'), pool.get('a')]);
    expect(first).toBe(second);
    expect(open).toHaveBeenCalledTimes(1);
    expect(pool.isOpen('a')).toBe(true);
    expect(pool.isOpen('b')).toBe(false);
  });

  it('does not cache a failed open', async () => {
    const open = vi
      .fn<(vault: RegisteredVault) => Promise<VaultContext>>()
      .mockRejectedValueOnce(new Error('disk gone'))
      .mockResolvedValueOnce(fakeContext());
    const pool = new VaultPool({ vaults, open, idleMs: IDLE });
    await expect(pool.get('a')).rejects.toThrow('disk gone');
    await expect(pool.get('a')).resolves.toBeDefined();
  });

  it('closes a vault that nobody used for the idle time', async () => {
    const context = fakeContext();
    const pool = new VaultPool({ vaults, open: () => Promise.resolve(context), idleMs: IDLE });
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE - 10);
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE - 10);
    expect(context.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(context.closed).toBe(true);
    expect(pool.isOpen('a')).toBe(false);
  });

  it('keeps a held vault open and starts the idle time when the hold ends', async () => {
    const context = fakeContext();
    const pool = new VaultPool({ vaults, open: () => Promise.resolve(context), idleMs: IDLE });
    await pool.get('a');
    const release = pool.hold('a');
    await vi.advanceTimersByTimeAsync(IDLE * 5);
    expect(context.closed).toBe(false);
    release();
    release();
    await vi.advanceTimersByTimeAsync(IDLE + 10);
    expect(context.closed).toBe(true);
  });

  it('waits for a pending idle close before opening again', async () => {
    let finishClose: () => void = () => undefined;
    const first = fakeContext();
    first.close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = () => {
            first.closed = true;
            resolve();
          };
        }),
    );
    const second = fakeContext();
    const open = vi
      .fn<(vault: RegisteredVault) => Promise<VaultContext>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const pool = new VaultPool({ vaults, open, idleMs: IDLE });
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE + 10);
    const reopened = pool.get('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
    finishClose();
    expect(await reopened).toBe(second);
  });

  it('reports an idle close that fails and opens the vault again on the next request', async () => {
    const broken = fakeContext();
    broken.close = vi.fn(() => Promise.reject(new Error('watcher would not stop')));
    const next = fakeContext();
    const open = vi
      .fn<(vault: RegisteredVault) => Promise<VaultContext>>()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(next);
    const messages: string[] = [];
    const pool = new VaultPool({
      vaults,
      open,
      idleMs: IDLE,
      onLog: (message) => messages.push(message),
    });
    await pool.get('a');
    await vi.advanceTimersByTimeAsync(IDLE + 10);
    expect(messages.join('\n')).toContain('watcher would not stop');
    expect(await pool.get('a')).toBe(next);
  });

  it('closes everything on close and knows only registered ids', async () => {
    const a = fakeContext();
    const pool = new VaultPool({ vaults, open: () => Promise.resolve(a), idleMs: IDLE });
    await pool.get('a');
    await pool.close();
    expect(a.closed).toBe(true);
    expect(pool.has('a')).toBe(true);
    expect(pool.has('c')).toBe(false);
    await expect(pool.get('c')).rejects.toThrow('Unknown vault');
    expect(pool.list().map((vault) => vault.id)).toEqual(['a', 'b']);
  });
});
