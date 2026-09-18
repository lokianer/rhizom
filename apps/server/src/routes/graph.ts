import { buildGraph, localGraph } from '@rhizom/core';

import type { VaultContext } from '../vault/context.js';
import { ErrorSchema, GraphQuerySchema, GraphSchema, LocalGraphQuerySchema } from './schemas.js';
import type { TypedApp } from './typed-app.js';

export function registerGraphRoutes(app: TypedApp, context: () => VaultContext): void {
  app.get(
    '/api/graph',
    {
      schema: {
        tags: ['graph'],
        summary: 'The whole vault as nodes and edges',
        querystring: GraphQuerySchema,
        response: { 200: GraphSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => {
      const input = context().index.graphInput();
      return buildGraph(input.notes, input.links, {
        clusterBy: request.query.clusterBy ?? 'folder',
      });
    },
  );

  app.get(
    '/api/graph/local',
    {
      schema: {
        tags: ['graph'],
        summary: 'The neighbourhood of one note',
        querystring: LocalGraphQuerySchema,
        response: { 200: GraphSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => {
      const input = context().index.graphInput();
      const graph = buildGraph(input.notes, input.links, {
        clusterBy: request.query.clusterBy ?? 'folder',
      });
      return localGraph(graph, request.query.path, request.query.depth ?? 1);
    },
  );
}
