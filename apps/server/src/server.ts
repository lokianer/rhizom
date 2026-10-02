import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';
import {
  checkVaultDirs,
  parseVaultList,
  RegistryError,
  singleVault,
  type RegisteredVault,
} from './vault/registry.js';

/** Reads an environment variable; blank values count as unset. */
function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? fallback : value;
}

const nodeEnv = env('NODE_ENV', '');
const isProduction = nodeEnv === 'production';
const rawPort = env('PORT', '3737');
const host = env('HOST', 'localhost');
const level = env('LOG_LEVEL', nodeEnv === 'development' ? 'debug' : 'info');

if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  console.error(`Invalid PORT: "${rawPort}"`);
  process.exit(1);
}
const port = Number(rawPort);

// The vaults: RHIZOM_VAULTS (id=path;…), or RHIZOM_VAULT_DIR for one, or the repository's
// example vault while developing.
const exampleVault = fileURLToPath(new URL('../../../examples/vault', import.meta.url));
const vaultList = env('RHIZOM_VAULTS', '');
const configuredVault = env('RHIZOM_VAULT_DIR', '');
let vaults: RegisteredVault[] = [];
let vaultNote = '';
try {
  if (vaultList !== '' && configuredVault !== '') {
    throw new RegistryError('Set RHIZOM_VAULTS or RHIZOM_VAULT_DIR, not both');
  }
  if (vaultList !== '') {
    vaults = parseVaultList(vaultList, process.cwd());
  } else if (configuredVault !== '') {
    vaults = [singleVault(resolve(configuredVault))];
  } else if (!isProduction && existsSync(exampleVault)) {
    vaults = [singleVault(exampleVault)];
    vaultNote = 'No vault is configured; using the example vault from the repository';
  }
  checkVaultDirs(vaults);
} catch (error) {
  if (error instanceof RegistryError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
const dataDir = resolve(env('RHIZOM_DATA_DIR', 'data'));
// Where the templates and the daily notes are, when the vault itself does not say — see
// vault/templates.ts.
const templateDir = env('RHIZOM_TEMPLATE_DIR', '');
const dailyDir = env('RHIZOM_DAILY_DIR', '');

// Pretty logs only where a person reads them: outside production, on a terminal, and only when
// the development-only pino-pretty transport is actually installed.
const prettyLogs = !isProduction && process.stdout.isTTY === true && canResolve('pino-pretty');

const app = await buildApp({
  logger: prettyLogs
    ? {
        level,
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level },
  ...(vaults.length === 0
    ? {}
    : {
        vaults: {
          list: vaults,
          dataDir,
          ...(templateDir === '' ? {} : { templateDir }),
          ...(dailyDir === '' ? {} : { dailyDir }),
        },
      }),
});

if (vaultNote !== '') {
  app.log.warn(vaultNote);
}
if (vaults.length === 0) {
  app.log.warn('No vault configured: set RHIZOM_VAULTS or RHIZOM_VAULT_DIR');
} else {
  for (const vault of vaults) {
    app.log.info(`Vault "${vault.id}": ${vault.dir} (index in ${join(dataDir, vault.id)})`);
  }
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      // A second signal means "now": do not wait for in-flight requests any longer.
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => {
      app.log.warn('shutdown timed out, exiting');
      process.exit(1);
    }, 10_000).unref();
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error(error);
        process.exit(1);
      },
    );
  });
}

function canResolve(specifier: string): boolean {
  try {
    import.meta.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}
