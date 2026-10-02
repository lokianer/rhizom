import { Type } from '@sinclair/typebox';

import type { VaultContextOf } from './vault-scope.js';
import {
  ErrorSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  TagCountSchema,
} from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

export function registerSearchRoutes(app: TypedApp, context: VaultContextOf): void {
  app.get(
    '/search',
    {
      schema: {
        tags: ['search'],
        summary: 'Full-text search over titles and bodies',
        querystring: SearchQuerySchema,
        response: { 200: SearchResponseSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => context(request).index.search(request.query.q, request.query.limit ?? 50),
  );

  app.get(
    '/tags',
    {
      schema: {
        tags: ['search'],
        summary: 'All tags with the number of notes using them',
        response: { 200: Type.Array(TagCountSchema), 503: ErrorSchema },
      },
    },
    (request) => context(request).index.tags(),
  );
}
