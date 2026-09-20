// Query blocks: a ` ```rhizom-query ` block in a note, answered from the index.
//
// The block is sent as the text it is, and read here with the same parser the browser could
// use, so there is one grammar and one set of complaints about it. That is also the security
// story: the body is a closed set of keys with literal values, never an expression, because a
// vault is a folder that can come from anywhere — a shared repository, a colleague's archive —
// and reading somebody else's notes must never run somebody else's code.
//
// A block that is partly wrong still answers. The rows are what could be read; the problems are
// what could not, each with the line it stands on, and the renderer shows both.
import { parseQuery } from '@rhizom/core';

import type { VaultContext } from '../vault/context.js';
import { ErrorSchema, QueryBodySchema, QueryResultSchema } from './schemas.js';
import type { TypedApp } from './typed-app.js';

export function registerQueryRoutes(app: TypedApp, context: () => VaultContext): void {
  app.post(
    '/api/query',
    {
      schema: {
        tags: ['search'],
        summary: 'Runs a rhizom-query block against the index',
        body: QueryBodySchema,
        response: { 200: QueryResultSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => {
      const ctx = context();
      const { query, problems } = parseQuery(request.body.body);
      const { rows, total } = ctx.index.runQuery(query);
      return { rows, total, view: query.view, columns: query.columns, problems };
    },
  );
}
