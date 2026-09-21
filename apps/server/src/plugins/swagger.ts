// The published contract. Everything a generator, a client author or a curious reader needs to
// know about this API comes from here, so the description and the tag list are part of it
// rather than decoration.
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

/** Registers the OpenAPI document and the browsable copy of it under `/api/docs`. */
export async function registerSwagger(app: FastifyInstance, version: string): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Rhizom API',
        description:
          'REST API of a Rhizom server. Note paths are vault paths: POSIX, relative to the vault root, with extension.',
        version,
      },
      tags: [
        { name: 'vault', description: 'The open vault' },
        { name: 'notes', description: 'Notes, links and backlinks' },
        { name: 'search', description: 'Full-text search and tags' },
        { name: 'terms', description: 'The vocabulary the vault defines' },
        { name: 'mentions', description: 'Where a note is named without a link' },
        { name: 'graph', description: 'Graph data for the bubble field' },
        { name: 'assets', description: 'Files inside the vault' },
        { name: 'index', description: 'Index maintenance and live events' },
      ],
    },
    // A schema is published under its own `$id`. Without this every shared schema arrives as
    // `def-0`, which is a name no reader of the contract can do anything with.
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, index) =>
        typeof json.$id === 'string' ? json.$id : `def-${String(index)}`,
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/docs' });
}
