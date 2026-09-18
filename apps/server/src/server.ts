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
});

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
