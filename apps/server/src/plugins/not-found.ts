// What answers a URL no route claimed. The web app is a single-page app, so a deep link into
// it is a page the router will resolve once the app is running, not a mistake — but only for a
// page: an unknown API path or a missing asset is a 404 and has to say so.
import { posix } from 'node:path';

import type { FastifyInstance } from 'fastify';

/**
 * Registers the history-API fallback. `webRoot` is null when no web app is served, in which
 * case everything unmatched is a plain 404.
 */
export function registerNotFound(app: FastifyInstance, webRoot: string | null): void {
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
}
