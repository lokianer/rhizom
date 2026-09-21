import { Type } from '@sinclair/typebox';

import type { VaultContext } from '../vault/context.js';
import {
  ErrorSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  TagCountSchema,
} from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

export function registerSearchRoutes(app: TypedApp, context: () => VaultContext): void {
  app.get(
    '/api/search',
    {
      schema: {
        tags: ['search'],
        summary: 'Full-text search over titles and bodies',
        querystring: SearchQuerySchema,
        response: { 200: SearchResponseSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => context().index.search(request.query.q, request.query.limit ?? 50),
  );

  app.get(
    '/api/tags',
    {
      schema: {
        tags: ['search'],
        summary: 'All tags with the number of notes using them',
        response: { 200: Type.Array(TagCountSchema), 503: ErrorSchema },
      },
    },
    () => context().index.tags(),
  );
}
