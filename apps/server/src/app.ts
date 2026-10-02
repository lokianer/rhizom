import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { HealthResponse } from '@rhizom/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerAssetRoutes } from './routes/assets.js';
import { registerErrorHandler } from './routes/errors.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerMaintenanceRoutes } from './routes/maintenance.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerQueryRoutes } from './routes/query.js';
import { registerRenameRoutes } from './routes/rename.js';
import { HealthSchema, TreeEntrySchema } from './routes/schemas/index.js';
import { registerMentionRoutes } from './routes/mentions.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerTagRenameRoutes } from './routes/tag-rename.js';
import { registerTableRoutes } from './routes/table.js';
import { registerTermRoutes } from './routes/terms.js';
import { registerVaultScope, vaultContextOf } from './routes/vault-scope.js';
import { registerNotFound } from './plugins/not-found.js';
import { DEFAULT_WEB_DIST, registerStaticWeb } from './plugins/static-web.js';
import { registerSwagger } from './plugins/swagger.js';
import { openVaultContext } from './vault/context.js';
import { VaultPool } from './vault/pool.js';
import { singleVault, type RegisteredVault } from './vault/registry.js';

// package.json sits one level above both src/ (tsx, vitest) and dist/ (tsc output).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export { DEFAULT_WEB_DIST };

export interface VaultsOption {
  list: readonly RegisteredVault[];
  /** Folder for the index databases (one subfolder per vault), or ':memory:'. */
  dataDir: string;
  /** Watch the vaults for external changes (default true). */
  watch?: boolean;
  /** Template folder, when the operator would rather say than let each vault decide. */
  templateDir?: string;
  /** Daily-note folder, likewise. */
  dailyDir?: string;
  /** How long an unused vault stays open (default ten minutes). */
  idleMs?: number;
}

export interface BuildAppOptions {
  /** Forwarded to Fastify's `logger` option. Defaults to `false` (silent), which tests want. */
  logger?: FastifyServerOptions['logger'];
  /**
   * Absolute path of the built web app, served with a history-API fallback; `false` disables
   * static serving. Defaults to DEFAULT_WEB_DIST, which is only used if the directory exists.
   */
  webDist?: string | false;
  /** The vaults to serve. Without them only the health route and the web app are available. */
  vaults?: VaultsOption;
  /** Shorthand for one vault with the id `default`. */
  vault?: {
    dir: string;
    /** Folder for the index database, or ':memory:'. */
    dataDir: string;
    /** Watch the vault for external changes (default true). */
    watch?: boolean;
    /** Template folder, when the operator would rather say than let the vault decide. */
    templateDir?: string;
    /** Daily-note folder, likewise. */
    dailyDir?: string;
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false }).withTypeProvider<TypeBoxTypeProvider>();
  registerErrorHandler(app);

  await registerSwagger(app, pkg.version);

  app.get(
    '/api/health',
    { schema: { tags: ['vault'], summary: 'Liveness check', response: { 200: HealthSchema } } },
    (): HealthResponse => ({ status: 'ok', version: pkg.version }),
  );
  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());

  const vaults = vaultsOf(options);
  let pool: VaultPool | undefined;
  if (vaults !== undefined) {
    const { dataDir } = vaults;
    pool = new VaultPool({
      vaults: vaults.list,
      ...(vaults.idleMs === undefined ? {} : { idleMs: vaults.idleMs }),
      onLog: (message) => {
        app.log.info(message);
      },
      open: (vault) =>
        openVaultContext({
          dir: vault.dir,
          dataDir: dataDir === ':memory:' ? ':memory:' : join(dataDir, vault.id),
          watch: vaults.watch ?? true,
          ...(vaults.templateDir === undefined ? {} : { templateDir: vaults.templateDir }),
          ...(vaults.dailyDir === undefined ? {} : { dailyDir: vaults.dailyDir }),
          onLog: (message) => {
            app.log.info(message);
          },
          onWatchError: (error) => {
            app.log.warn(error, 'vault watcher error');
          },
        }),
    });
    const opened = pool;
    app.addHook('onClose', async () => {
      await opened.close();
    });
    // Files inside each vault (images, PDFs …) for embeds; hidden files are never served. One
    // registration per vault, because the set is fixed at start-up and each is bound to a root.
    for (const vault of vaults.list) {
      await app.register(fastifyStatic, {
        root: vault.dir,
        prefix: `/api/v/${vault.id}/assets/`,
        decorateReply: false,
        dotfiles: 'ignore',
        index: false,
        list: false,
        // A note is not an asset. `GET …/assets` already leaves notes out, and this is the same
        // contract: one door to the notes, which is `…/notes/*`. A second one would be a way
        // around whatever that door is given to check later.
        allowedPath: (pathName) => !/\.(md|markdown)$/i.test(pathName),
      });
    }
  }

  // The folder tree is the one schema that refers to itself. Registered by name, so the
  // published contract carries a definition the `$ref` can actually reach: an OpenAPI document
  // with a dangling reference is one no generator can read.
  app.addSchema(TreeEntrySchema);

  await registerVaultScope(app, pool, async (scoped, hold) => {
    registerNoteRoutes(scoped, vaultContextOf);
    registerRenameRoutes(scoped, vaultContextOf);
    registerSearchRoutes(scoped, vaultContextOf);
    registerTagRenameRoutes(scoped, vaultContextOf);
    registerQueryRoutes(scoped, vaultContextOf);
    registerTermRoutes(scoped, vaultContextOf);
    registerMentionRoutes(scoped, vaultContextOf);
    registerGraphRoutes(scoped, vaultContextOf);
    registerMaintenanceRoutes(scoped, vaultContextOf, hold);
    // The player view gets the public side of the index and nothing else.
    registerTableRoutes(scoped, (request) => {
      const context = vaultContextOf(request);
      return {
        view: context.index.publicView(),
        readNote: async (path) => (await context.vault.readNote(path)).content,
      };
    });
    await registerAssetRoutes(scoped, vaultContextOf);
  });

  const webDist = options.webDist ?? DEFAULT_WEB_DIST;
  const webRoot = webDist !== false && existsSync(webDist) ? webDist : null;

  if (webRoot !== null) {
    await registerStaticWeb(app, webRoot);
  }

  registerNotFound(app, webRoot);

  return app;
}

/** The vaults to serve, with the single-vault shorthand spelled out. */
function vaultsOf(options: BuildAppOptions): VaultsOption | undefined {
  if (options.vaults !== undefined || options.vault === undefined) {
    return options.vaults;
  }
  const { dir, dataDir, watch, templateDir, dailyDir } = options.vault;
  return {
    list: [singleVault(dir)],
    dataDir,
    ...(watch === undefined ? {} : { watch }),
    ...(templateDir === undefined ? {} : { templateDir }),
    ...(dailyDir === undefined ? {} : { dailyDir }),
  };
}
