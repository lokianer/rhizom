import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from './app.js';

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

// The vault: RHIZOM_VAULT_DIR, or the repository's example vault while developing.
const exampleVault = fileURLToPath(new URL('../../../examples/vault', import.meta.url));
const configuredVault = env('RHIZOM_VAULT_DIR', '');
let vaultDir = configuredVault === '' ? '' : resolve(configuredVault);
let vaultNote = '';
if (vaultDir === '' && !isProduction && existsSync(exampleVault)) {
  vaultDir = exampleVault;
  vaultNote = 'RHIZOM_VAULT_DIR is not set; using the example vault from the repository';
}
const dataDir = resolve(env('RHIZOM_DATA_DIR', 'data'));

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
  ...(vaultDir === '' ? {} : { vault: { dir: vaultDir, dataDir } }),
});

if (vaultNote !== '') {
  app.log.warn(vaultNote);
}
if (vaultDir === '') {
  app.log.warn('No vault configured: set RHIZOM_VAULT_DIR to the folder with your notes');
} else {
  app.log.info(`Vault: ${vaultDir} (index in ${dataDir})`);
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
