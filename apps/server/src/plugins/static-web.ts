// Serving the built web app beside the API, so that one process answers both and a self-hosted
// Rhizom is one thing to start.
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** The web app build, resolved relative to this file: the same depth from src/ and dist/. */
export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../web/dist', import.meta.url));

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export async function registerStaticWeb(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
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
