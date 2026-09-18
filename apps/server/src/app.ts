import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '@rhizom/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

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
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/api/health', (): HealthResponse => ({ status: 'ok', version: pkg.version }));

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
