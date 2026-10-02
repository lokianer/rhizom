import type { IndexEvent } from '@rhizom/core';

import type { HoldVault, VaultContextOf } from './vault-scope.js';
import { ErrorSchema, SyncResultSchema } from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

const HEARTBEAT_MS = 25_000;

export function registerMaintenanceRoutes(
  app: TypedApp,
  context: VaultContextOf,
  hold: HoldVault,
): void {
  app.post(
    '/index/rebuild',
    {
      schema: {
        tags: ['index'],
        summary: 'Re-scan the vault and update the index',
        response: { 200: SyncResultSchema, 503: ErrorSchema },
      },
    },
    (request) => context(request).rebuild(),
  );

  app.get(
    '/events',
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
      const ctx = context(request);
      reply.hijack();
      // The vault may have taken seconds to open, and the tab may have left meanwhile: its
      // `close` has then fired already and would never fire again for the listeners below.
      if (request.raw.destroyed || reply.raw.destroyed) {
        reply.raw.end();
        return;
      }
      // An open stream is a tab looking at this vault: it stays open as long as the tab does.
      const release = hold(request);
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
        release();
        reply.raw.end();
      });
    },
  );
}
