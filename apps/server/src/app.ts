import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { HealthResponse } from '@rhizom/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerAssetRoutes } from './routes/assets.js';
import { HttpError, registerErrorHandler } from './routes/errors.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerMaintenanceRoutes } from './routes/maintenance.js';
import { registerNoteRoutes } from './routes/notes.js';
import { registerQueryRoutes } from './routes/query.js';
import { registerRenameRoutes } from './routes/rename.js';
import { HealthSchema, TreeEntrySchema } from './routes/schemas/index.js';
import { registerMentionRoutes } from './routes/mentions.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerTagRenameRoutes } from './routes/tag-rename.js';
import { registerTermRoutes } from './routes/terms.js';
import { registerNotFound } from './plugins/not-found.js';
import { DEFAULT_WEB_DIST, registerStaticWeb } from './plugins/static-web.js';
import { registerSwagger } from './plugins/swagger.js';
import { openVaultContext, type VaultContext } from './vault/context.js';

// package.json sits one level above both src/ (tsx, vitest) and dist/ (tsc output).
const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export { DEFAULT_WEB_DIST };

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

  let context: VaultContext | undefined;
  if (options.vault !== undefined) {
    context = await openVaultContext({
      dir: options.vault.dir,
      dataDir: options.vault.dataDir,
      watch: options.vault.watch ?? true,
      ...(options.vault.templateDir === undefined
        ? {}
        : { templateDir: options.vault.templateDir }),
      ...(options.vault.dailyDir === undefined ? {} : { dailyDir: options.vault.dailyDir }),
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

  // The folder tree is the one schema that refers to itself. Registered by name, so the
  // published contract carries a definition the `$ref` can actually reach: an OpenAPI document
  // with a dangling reference is one no generator can read.
  app.addSchema(TreeEntrySchema);

  registerNoteRoutes(app, requireContext);
  registerRenameRoutes(app, requireContext);
  registerSearchRoutes(app, requireContext);
  registerTagRenameRoutes(app, requireContext);
  registerQueryRoutes(app, requireContext);
  registerTermRoutes(app, requireContext);
  registerMentionRoutes(app, requireContext);
  registerGraphRoutes(app, requireContext);
  registerMaintenanceRoutes(app, requireContext);
  await registerAssetRoutes(app, requireContext, context?.vault.root);

  const webDist = options.webDist ?? DEFAULT_WEB_DIST;
  const webRoot = webDist !== false && existsSync(webDist) ? webDist : null;

  if (webRoot !== null) {
    await registerStaticWeb(app, webRoot);
  }

  registerNotFound(app, webRoot);

  return app;
}
