import { localGraph, type GraphData } from '@rhizom/core';
import type { FastifyReply } from 'fastify';

import type { VaultContextOf } from './vault-scope.js';
import {
  ErrorSchema,
  GraphQuerySchema,
  GraphSchema,
  LocalGraphQuerySchema,
} from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

/**
 * The response body of each whole-vault graph the index has built, serialised once. The index
 * hands out the same GraphData object until something is written, so the object is the key: a
 * write makes the index build a new one, and the old body goes with the old graph. It is sent as
 * bytes, which Fastify passes through untouched — the schema stays on the route for the OpenAPI
 * document, and the body was made by that schema's own serializer, so it is the same body the
 * route sent when it serialised on every request.
 */
const bodies = new WeakMap<GraphData, Buffer>();

/**
 * Sends a body that is already JSON. Through the untyped reply, because the typed one only
 * accepts what the response schema describes, and bytes are not that — they are what it turns
 * into.
 */
function sendJson(reply: FastifyReply, body: Buffer): FastifyReply {
  return reply.type('application/json; charset=utf-8').send(body);
}

export function registerGraphRoutes(app: TypedApp, context: VaultContextOf): void {
  app.get(
    '/graph',
    {
      schema: {
        tags: ['graph'],
        summary: 'The whole vault as nodes and edges',
        querystring: GraphQuerySchema,
        response: { 200: GraphSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const graph = context(request).index.graph(request.query.clusterBy ?? 'folder');
      let body = bodies.get(graph);
      if (body === undefined) {
        // A shallow copy only to satisfy the serializer's parameter type, which wants an index
        // signature that an interface does not have.
        body = Buffer.from(String(reply.serializeInput({ ...graph }, '200')));
        bodies.set(graph, body);
      }
      return sendJson(reply, body);
    },
  );

  app.get(
    '/graph/local',
    {
      schema: {
        tags: ['graph'],
        summary: 'The neighbourhood of one note',
        querystring: LocalGraphQuerySchema,
        response: { 200: GraphSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) =>
      // Cut from the cached whole graph rather than built for the request: the neighbourhood of
      // one note is a few percent of the vault, and reading every link to find it was 30 MB of
      // garbage per click.
      localGraph(
        context(request).index.graph(request.query.clusterBy ?? 'folder'),
        request.query.path,
        request.query.depth ?? 1,
      ),
  );
}
