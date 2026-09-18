import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { HealthResponse } from '@rhizom/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerAssetRoutes } from './routes/assets.js';
import { HttpError, registerErrorHandler } from './routes/errors.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerMaintenanceRoutes } from './routes/maintenance.js';
import { registerNoteRoutes } from './routes/notes.js';
import { HealthSchema } from './routes/schemas.js';
import { registerSearchRoutes } from './routes/search.js';
import { openVaultContext, type VaultContext } from './vault/context.js';

// package.json sits one level above both src/ (tsx, vitest) and dist/ (tsc output).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

/** The web app build, resolved relative to this file: the same depth from src/ and dist/. */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export interface BuildAppOptions {
  /** Forwarded to Fastify's `logger` option. Defaults to `false` (silent), which tests want. */
  logger?: FastifyServerOptions['logger'];
  /**
   * Absolute path of the built web app, served with a history-API fallback; `false` disables
   * static serving. Defaults to DEFAULT_WEB_DIST, which is only used if the directory exists.
   */
  webDist?: string | false;
  /** The vault to serve. Without it only the health route and the web app are available. */
  vault?: {
    dir: string;
    /** Folder for the index database, or ':memory:'. */
    dataDir: string;
    /** Watch the vault for external changes (default true). */
    watch?: boolean;
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<TypeBoxTypeProvider>();
  registerErrorHandler(app);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Rhizom API',
        description:
          'REST API of a Rhizom server. Note paths are vault paths: POSIX, relative to the vault root, with extension.',
        version: pkg.version,
      },
      tags: [
        { name: 'vault', description: 'The open vault' },
        { name: 'notes', description: 'Notes, links and backlinks' },
        { name: 'search', description: 'Full-text search and tags' },
        { name: 'graph', description: 'Graph data for the bubble field' },
        { name: 'assets', description: 'Files inside the vault' },
        { name: 'index', description: 'Index maintenance and live events' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/docs' });

  app.get(
    '/api/health',
    { schema: { tags: ['vault'], summary: 'Liveness check', response: { 200: HealthSchema } } },
    (): HealthResponse => ({ status: 'ok', version: pkg.version }),
  );
  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());

  let context: VaultContext | undefined;
  if (options.vault !== undefined) {
    context = await openVaultContext({
      dir: options.vault.dir,
      dataDir: options.vault.dataDir,
      watch: options.vault.watch ?? true,
      onLog: (message) => {
        app.log.info(message);
      },
      onWatchError: (error) => {
        app.log.warn(error, 'vault watcher error');
      },
    });
    app.addHook('onClose', async () => {
      await context?.close();
    });
  }
  const requireContext = (): VaultContext => {
    if (context === undefined) {
      throw new HttpError(503, 'No vault is configured (set RHIZOM_VAULT_DIR)');
    }
    return context;
  };

  registerNoteRoutes(app, requireContext);
  registerSearchRoutes(app, requireContext);
  registerGraphRoutes(app, requireContext);
  registerMaintenanceRoutes(app, requireContext);
  await registerAssetRoutes(app, requireContext, context?.vault.root);

  const webDist = options.webDist ?? DEFAULT_WEB_DIST;
  const webRoot = webDist !== false && existsSync(webDist) ? webDist : null;

  if (webRoot !== null) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      // Enumerate the build once at start-up; unknown URLs then reach the not-found handler.
      wildcard: false,
      // Vite's hashed files under assets/ never change; everything else must be revalidated.
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        reply.header(
          'cache-control',
          filePath.includes(`${sep}assets${sep}`) ? IMMUTABLE : REVALIDATE,
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    // The same path the router saw: no query, no fragment, no doubled slashes.
    const pathname = posix.normalize(request.url.split(/[?#]/, 1)[0] ?? '/');
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const isAsset = pathname.startsWith('/assets/');
    const isPage = (request.method === 'GET' || request.method === 'HEAD') && !isApi && !isAsset;

    if (webRoot !== null && isPage) {
      // Reply is a thenable: returning it lets Fastify wait for sendFile() to finish.
      return reply.sendFile('index.html');
    }

    return reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
    });
  });

  return app;
}
