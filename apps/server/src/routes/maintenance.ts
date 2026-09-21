import type { IndexEvent } from '@rhizom/core';

import type { VaultContext } from '../vault/context.js';
import { ErrorSchema, SyncResultSchema } from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

const HEARTBEAT_MS = 25_000;

export function registerMaintenanceRoutes(app: TypedApp, context: () => VaultContext): void {
  app.post(
    '/api/index/rebuild',
    {
      schema: {
        tags: ['index'],
        summary: 'Re-scan the vault and update the index',
        response: { 200: SyncResultSchema, 503: ErrorSchema },
      },
    },
    () => context().rebuild(),
  );

  app.get(
    '/api/events',
    {
      schema: {
        tags: ['index'],
        summary: 'Index changes as server-sent events',
        description:
          'Emits `indexed`, `removed` and `rebuilt` events with a JSON payload whenever the index changes, plus a comment every 25 s as heartbeat.',
        produces: ['text/event-stream'],
        response: { 503: ErrorSchema },
      },
    },
    (request, reply) => {
      const ctx = context();
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      reply.raw.write(': connected\n\n');

      const send = (event: IndexEvent): void => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const heartbeat = setInterval(() => {
        reply.raw.write(': heartbeat\n\n');
      }, HEARTBEAT_MS);
      ctx.events.on('index', send);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        ctx.events.off('index', send);
        reply.raw.end();
      });
    },
  );
}
