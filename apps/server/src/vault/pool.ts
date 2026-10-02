// The open vaults. A vault is opened when it is first asked for and closed again when nothing
// has touched it for a while, so ten registered vaults are not ten open databases and ten file
// watchers. Whatever changed on disk while one was closed is picked up by the incremental sync
// that every open runs: the files are the truth.
import type { VaultContext } from './context.js';
import type { RegisteredVault } from './registry.js';

export const DEFAULT_IDLE_MS = 10 * 60_000;

export interface VaultPoolOptions {
  vaults: readonly RegisteredVault[];
  open: (vault: RegisteredVault) => Promise<VaultContext>;
  idleMs?: number;
  onLog?: (message: string) => void;
}

interface Entry {
  readonly vault: RegisteredVault;
  context: VaultContext | undefined;
  opening: Promise<VaultContext> | undefined;
  closing: Promise<void> | undefined;
  holds: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class VaultPool {
  readonly #entries = new Map<string, Entry>();
  readonly #open: (vault: RegisteredVault) => Promise<VaultContext>;
  readonly #idleMs: number;
  readonly #onLog: ((message: string) => void) | undefined;
  #closed = false;

  constructor(options: VaultPoolOptions) {
    for (const vault of options.vaults) {
      this.#entries.set(vault.id, {
        vault,
        context: undefined,
        opening: undefined,
        closing: undefined,
        holds: 0,
        timer: undefined,
      });
    }
    this.#open = options.open;
    this.#idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.#onLog = options.onLog;
  }

  list(): readonly RegisteredVault[] {
    return [...this.#entries.values()].map((entry) => entry.vault);
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  isOpen(id: string): boolean {
    return this.#entries.get(id)?.context !== undefined;
  }

  /** The vault's context, opened on first use. Every call counts as use. */
  async get(id: string): Promise<VaultContext> {
    const entry = this.#entry(id);
    this.#touch(entry);
    if (entry.closing !== undefined) {
      await entry.closing;
    }
    if (entry.context !== undefined) {
      return entry.context;
    }
    entry.opening ??= this.#open(entry.vault).then(
      (context) => {
        entry.context = context;
        entry.opening = undefined;
        this.#touch(entry);
        return context;
      },
      (error: unknown) => {
        entry.opening = undefined;
        throw error;
      },
    );
    return entry.opening;
  }

  /** Keeps the vault open until the returned function is called (an event stream). */
  hold(id: string): () => void {
    const entry = this.#entry(id);
    entry.holds += 1;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      entry.holds -= 1;
      this.#touch(entry);
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all(
      [...this.#entries.values()].map(async (entry) => {
        clearTimeout(entry.timer);
        entry.timer = undefined;
        await entry.closing;
        const context = entry.context ?? (await entry.opening?.catch(() => undefined));
        entry.context = undefined;
        await context?.close();
      }),
    );
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      throw new Error(`Unknown vault "${id}"`);
    }
    return entry;
  }

  #touch(entry: Entry): void {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    if (entry.holds > 0 || this.#closed) {
      return;
    }
    entry.timer = setTimeout(() => {
      this.#closeIdle(entry);
    }, this.#idleMs);
    entry.timer.unref();
  }

  #closeIdle(entry: Entry): void {
    entry.timer = undefined;
    const context = entry.context;
    // Still opening, or held by a stream: the open's own touch, or the release, re-arms it.
    if (context === undefined || entry.holds > 0) {
      return;
    }
    entry.context = undefined;
    // Nobody awaits this unless a request arrives, so a failure is reported here rather than left
    // to become an unhandled rejection, which would end the process.
    entry.closing = context
      .close()
      .then(
        () => {
          this.#onLog?.(`Closed vault "${entry.vault.id}" after it was idle`);
        },
        (error: unknown) => {
          this.#onLog?.(
            `Closing vault "${entry.vault.id}" after it was idle failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      )
      .finally(() => {
        entry.closing = undefined;
      });
  }
}
