// Every vault route lives under /api/v/:vault. One encapsulated plugin resolves the vault per
// request, before any handler runs, so a handler only ever sees a vault the operator registered.
import { Type, type TObject } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';

import type { VaultContext } from '../vault/context.js';
import type { VaultPool } from '../vault/pool.js';
import { VAULT_ID_PATTERN } from '../vault/registry.js';
import { HttpError } from './errors.js';
import { VaultSummarySchema } from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

declare module 'fastify' {
  interface FastifyRequest {
    vaultContext?: VaultContext;
  }
}

/** How a route reaches the vault its request was addressed to. */
export type VaultContextOf = (request: FastifyRequest) => VaultContext;

/** Keeps the request's vault open until the returned function is called. */
export type HoldVault = (request: FastifyRequest) => () => void;

const VaultParam = Type.String({ pattern: VAULT_ID_PATTERN.source, description: 'Vault id' });

function vaultIdOf(request: FastifyRequest): string {
  return (request.params as { vault?: string }).vault ?? '';
}

export const vaultContextOf: VaultContextOf = (request) => {
  const context = request.vaultContext;
  if (context === undefined) {
    throw new Error('A vault route ran without a resolved vault');
  }
  return context;
};

export async function registerVaultScope(
  app: TypedApp,
  pool: VaultPool | undefined,
  routes: (scoped: TypedApp, hold: HoldVault) => Promise<void>,
): Promise<void> {
  app.get(
    '/api/vaults',
    {
      schema: {
        tags: ['vault'],
        summary: 'The registered vaults',
        response: { 200: Type.Array(VaultSummarySchema) },
      },
    },
    () => (pool?.list() ?? []).map(({ id, name }) => ({ id, name })),
  );

  await app.register(
    async (scoped) => {
      // Every route below takes the vault as a path parameter; declaring it here keeps the
      // published contract honest without repeating it in every schema.
      scoped.addHook('onRoute', (route) => {
        const schema = (route.schema ??= {});
        const params = schema.params as TObject | undefined;
        schema.params = Type.Object({ vault: VaultParam, ...(params?.properties ?? {}) });
      });
      // onRequest, not preHandler: an unknown vault is a 404 before anything is parsed or
      // validated, and a body is never read for a vault that does not exist.
      scoped.addHook('onRequest', async (request) => {
        if (pool === undefined) {
          throw new HttpError(
            503,
            'No vault is configured (set RHIZOM_VAULTS or RHIZOM_VAULT_DIR)',
          );
        }
        const id = vaultIdOf(request);
        if (!VAULT_ID_PATTERN.test(id) || !pool.has(id)) {
          throw new HttpError(404, 'Unknown vault');
        }
        request.vaultContext = await pool.get(id);
      });
      const hold: HoldVault = (request) => pool?.hold(vaultIdOf(request)) ?? (() => undefined);
      await routes(scoped, hold);
    },
    { prefix: '/api/v/:vault' },
  );
}
