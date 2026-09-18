import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import type { VaultContext } from '../vault/context.js';
import { HttpError } from './errors.js';
import { Type } from '@sinclair/typebox';

import { AssetSummarySchema, ErrorSchema, UploadResponseSchema } from './schemas.js';
import type { TypedApp } from './typed-app.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function registerAssetRoutes(
  app: TypedApp,
  context: () => VaultContext,
  vaultRoot: string | undefined,
): Promise<void> {
  // Files inside the vault (images, PDFs …) for embeds; hidden files are never served.
  if (vaultRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: vaultRoot,
      prefix: '/api/assets/',
      decorateReply: false,
      dotfiles: 'ignore',
      index: false,
      list: false,
    });
  }

  await app.register(fastifyMultipart, { limits: { files: 1, fileSize: MAX_UPLOAD_BYTES } });

  app.get(
    '/api/assets',
    {
      schema: {
        tags: ['assets'],
        summary: 'List the files in the vault that are not notes',
        response: { 200: Type.Array(AssetSummarySchema), 503: ErrorSchema },
      },
    },
    async () => {
      const files = await context().vault.listAssets();
      return files.map((file) => ({
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt.toISOString(),
      }));
    },
  );

  app.post(
    '/api/assets',
    {
      schema: {
        tags: ['assets'],
        summary: 'Upload a file into assets/',
        consumes: ['multipart/form-data'],
        response: { 201: UploadResponseSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const file = await request.file();
      if (file === undefined) {
        throw new HttpError(400, 'Expected one file in a multipart/form-data body');
      }
      const data = await file.toBuffer();
      if (file.file.truncated) {
        throw new HttpError(413, `File exceeds ${String(MAX_UPLOAD_BYTES)} bytes`);
      }
      const stored = await ctx.vault.storeAsset(file.filename, data);
      return reply.code(201).send(stored);
    },
  );
}
