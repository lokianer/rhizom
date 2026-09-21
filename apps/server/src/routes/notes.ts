import { noteNameOf, type NoteDocument } from '@rhizom/core';
import { Type } from '@sinclair/typebox';

import type { VaultContext } from '../vault/context.js';
import { errorBody } from './errors.js';
import {
  BacklinkSchema,
  CreateNoteBodySchema,
  ErrorSchema,
  NoteDocumentSchema,
  NoteLinkSchema,
  NotePathParamsSchema,
  NoteSummarySchema,
  PathQuerySchema,
  SaveNoteBodySchema,
  TreeEntrySchema,
  VaultInfoSchema,
} from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

/** Reads the current file and index record of a note into the API document shape. */
export async function readNoteDocument(context: VaultContext, path: string): Promise<NoteDocument> {
  const file = await context.vault.readNote(path);
  let record = context.index.getNote(file.path);
  if (record?.hash !== file.hash) {
    await context.indexPaths([file.path]);
    record = context.index.getNote(file.path);
  }
  const summary = context.index.summary(file.path);
  return {
    path: file.path,
    name: noteNameOf(file.path),
    title: record?.title ?? noteNameOf(file.path),
    folder: record?.folder ?? '',
    tags: record?.tags ?? [],
    aliases: record?.aliases ?? [],
    modifiedAt: file.modifiedAt.toISOString(),
    size: file.size,
    linkCount: summary?.linkCount ?? 0,
    backlinkCount: summary?.backlinkCount ?? 0,
    content: file.content,
    hash: file.hash,
    frontmatter: record?.frontmatter ?? {},
    headings: record?.headings ?? [],
  };
}

function ifMatchHash(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '' || value.trim() === '*') {
    return undefined;
  }
  return value.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

export function registerNoteRoutes(app: TypedApp, context: () => VaultContext): void {
  const tags = ['notes'];

  app.get(
    '/api/vault',
    {
      schema: {
        tags: ['vault'],
        summary: 'Describe the open vault',
        response: { 200: VaultInfoSchema, 503: ErrorSchema },
      },
    },
    () => {
      const ctx = context();
      const stats = ctx.index.stats();
      return {
        name: ctx.vault.name,
        noteCount: stats.noteCount,
        indexedAt: stats.indexedAt,
        templates: ctx.templates(),
        daily: ctx.daily(),
      };
    },
  );

  app.get(
    '/api/tree',
    {
      schema: {
        tags,
        summary: 'Folder tree of the vault',
        response: { 200: Type.Array(Type.Ref(TreeEntrySchema)), 503: ErrorSchema },
      },
    },
    () => context().index.tree(),
  );

  app.get(
    '/api/notes',
    {
      schema: {
        tags,
        summary: 'List all notes',
        response: { 200: Type.Array(NoteSummarySchema), 503: ErrorSchema },
      },
    },
    () => context().index.listNotes(),
  );

  app.post(
    '/api/notes',
    {
      schema: {
        tags,
        summary: 'Create a note',
        body: CreateNoteBodySchema,
        response: { 201: NoteDocumentSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const created = await ctx.vault.createNote(request.body.path, request.body.content ?? '');
      await ctx.indexPaths([created.path]);
      const document = await readNoteDocument(ctx, created.path);
      return reply.code(201).header('etag', `"${document.hash}"`).send(document);
    },
  );

  app.get(
    '/api/notes/*',
    {
      schema: {
        tags,
        summary: 'Read a note',
        params: NotePathParamsSchema,
        response: { 200: NoteDocumentSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const document = await readNoteDocument(context(), request.params['*']);
      return reply.header('etag', `"${document.hash}"`).send(document);
    },
  );

  app.put(
    '/api/notes/*',
    {
      schema: {
        tags,
        summary: 'Save a note',
        description:
          'Overwrites the whole note. Send the hash from the last read as If-Match to be told (412) when the file changed on disk in the meantime.',
        params: NotePathParamsSchema,
        body: SaveNoteBodySchema,
        response: { 200: NoteDocumentSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const path = request.params['*'];
      const expected = ifMatchHash(request.headers['if-match']);
      await ctx.vault.readNote(path);
      const written = await ctx.vault.writeNote(path, request.body.content, expected);
      await ctx.indexPaths([written.path]);
      const document = await readNoteDocument(ctx, written.path);
      return reply.header('etag', `"${document.hash}"`).send(document);
    },
  );

  app.delete(
    '/api/notes/*',
    {
      schema: {
        tags,
        summary: 'Move a note to the trash',
        params: NotePathParamsSchema,
        response: { 204: Type.Null(), '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      const path = request.params['*'];
      await ctx.vault.deleteNote(path);
      await ctx.indexPaths([path]);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/api/links',
    {
      schema: {
        tags,
        summary: 'Outgoing links of a note',
        querystring: PathQuerySchema,
        response: { 200: Type.Array(NoteLinkSchema), '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const ctx = context();
      if (ctx.index.getNote(request.query.path) === undefined) {
        return reply.code(404).send(errorBody(404, `Note not found: ${request.query.path}`));
      }
      return ctx.index.linksFrom(request.query.path);
    },
  );

  app.get(
    '/api/backlinks',
    {
      schema: {
        tags,
        summary: 'Notes that link to a note',
        querystring: PathQuerySchema,
        response: { 200: Type.Array(BacklinkSchema), '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => context().index.backlinks(request.query.path),
  );
}
