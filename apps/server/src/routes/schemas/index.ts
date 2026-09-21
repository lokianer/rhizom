// JSON schemas of the API, from which Fastify validates requests, serialises responses and
// @fastify/swagger derives the OpenAPI document. The TypeScript contracts in @rhizom/core
// describe the same shapes; index.test.ts keeps the two in step.
//
// One file per part of the API, and this barrel over them: a route file asks for the schemas
// it registers, not for the folder they happen to be sorted into.
export * from './assets.js';
export * from './common.js';
export * from './graph.js';
export * from './mentions.js';
export * from './notes.js';
export * from './query.js';
export * from './rename.js';
export * from './search.js';
export * from './tag-rename.js';
