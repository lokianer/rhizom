// The vaults this server may open, as the operator registered them. Only these can be opened:
// a browser that may name any path is a browser that may read any folder on the machine.
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export const VAULT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const DEFAULT_VAULT_ID = 'default';

export interface RegisteredVault {
  readonly id: string;
  /** Folder name, shown in the switcher. */
  readonly name: string;
  /** Absolute path of the vault folder. */
  readonly dir: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** Parses `RHIZOM_VAULTS`: `id=path` pairs separated by `;`, paths resolved against `cwd`. */
export function parseVaultList(value: string, cwd: string): RegisteredVault[] {
  const vaults: RegisteredVault[] = [];
  for (const raw of value.split(';')) {
    const entry = raw.trim();
    if (entry === '') {
      continue;
    }
    const separator = entry.indexOf('=');
    if (separator === -1) {
      throw new RegistryError(`RHIZOM_VAULTS: "${entry}" is not of the form id=path`);
    }
    const id = entry.slice(0, separator).trim();
    const path = entry.slice(separator + 1).trim();
    if (!VAULT_ID_PATTERN.test(id)) {
      throw new RegistryError(
        `RHIZOM_VAULTS: "${id}" is not a valid vault id (lower-case letters, digits and dashes, at most 32, not starting with a dash)`,
      );
    }
    if (path === '') {
      throw new RegistryError(`RHIZOM_VAULTS: vault "${id}" has no path`);
    }
    if (vaults.some((vault) => vault.id === id)) {
      throw new RegistryError(`RHIZOM_VAULTS: vault "${id}" is named twice`);
    }
    const dir = resolve(cwd, path);
    vaults.push({ id, name: basename(dir), dir });
  }
  if (vaults.length === 0) {
    throw new RegistryError('RHIZOM_VAULTS is set but names no vault');
  }
  return vaults;
}

/** The one vault of a `RHIZOM_VAULT_DIR` setup. */
export function singleVault(dir: string): RegisteredVault {
  return { id: DEFAULT_VAULT_ID, name: basename(dir), dir };
}

/** Fails start-up on a vault folder that is missing or not a folder. */
export function checkVaultDirs(vaults: readonly RegisteredVault[]): void {
  for (const vault of vaults) {
    let isDirectory = false;
    try {
      isDirectory = statSync(vault.dir).isDirectory();
    } catch {
      // Missing or unreadable: reported below in one message.
    }
    if (!isDirectory) {
      throw new RegistryError(`Vault "${vault.id}": ${vault.dir} is not a directory`);
    }
  }
}
