// The player view: the vault as the table knows it, at a session. Every route here is handed the
// public view of the index and a way to read a note's file — and reads a file only after the
// public view has said the table may see that note. What it sends is cut by the same core
// function the index used, so search and reading agree on what is public.
import { publicMarkdown, type PublicNoteDocument, type SearchHit } from '@rhizom/core';
import { Type } from '@sinclair/typebox';
import type { FastifyRequest } from 'fastify';

import type { PublicIndex } from '../store/public-index.js';
import { errorBody } from './errors.js';
import {
  ErrorSchema,
  NotePathParamsSchema,
  PublicNoteDocumentSchema,
  PublicNoteSchema,
  SearchHitSchema,
  TableSearchQuerySchema,
  TableSessionQuerySchema,
  TableSessionsSchema,
} from './schemas/index.js';
import type { TypedApp } from './typed-app.js';

export interface TableAccess {
  view: PublicIndex;
  /** The file's text; called only for a note the view has already allowed. */
  readNote: (path: string) => Promise<string>;
}

const SEARCH_LIMIT = 50;

/** The session asked for, or the latest; never one past the latest, which nobody has played. */
function sessionOf(view: PublicIndex, asked: number | undefined): number {
  const latest = view.latestSession();
  return asked === undefined ? latest : Math.min(asked, latest);
}

export function registerTableRoutes(
  app: TypedApp,
  access: (request: FastifyRequest) => TableAccess,
): void {
  const tags = ['player view'];

  app.get(
    '/table/sessions',
    {
      schema: {
        tags,
        summary: 'The sessions of the campaign',
        response: { 200: TableSessionsSchema, 503: ErrorSchema },
      },
    },
    (request) => {
      const { view } = access(request);
      const campaign = view.campaign();
      return {
        campaign: campaign !== null,
        sessions: view.sessions(campaign).map((entry) => entry.session),
      };
    },
  );

  app.get(
    '/table/notes',
    {
      schema: {
        tags,
        summary: 'The notes the table may read at a session',
        querystring: TableSessionQuerySchema,
        response: { 200: Type.Array(PublicNoteSchema), '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request) => {
      const { view } = access(request);
      return view.list(sessionOf(view, request.query.session));
    },
  );

  app.get(
    '/table/notes/*',
    {
      schema: {
        tags,
        summary: 'A note as the table may read it at a session',
        params: NotePathParamsSchema,
        querystring: TableSessionQuerySchema,
        response: { 200: PublicNoteDocumentSchema, '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { view, readNote } = access(request);
      const session = sessionOf(view, request.query.session);
      const path = request.params['*'];
      const note = view.note(session, path);
      // A note the table may not read is answered exactly like one that is not there.
      if (note === undefined) {
        return reply.code(404).send(errorBody(404, `Note not found: ${path}`));
      }
      const document: PublicNoteDocument = {
        path: note.path,
        title: note.title,
        markdown: publicMarkdown(await readNote(note.path), session),
        session,
      };
      return document;
    },
  );

  app.get(
    '/table/search',
    {
      schema: {
        tags,
        summary: 'Full-text search over what the table may read at a session',
        querystring: TableSearchQuerySchema,
        response: { 200: Type.Array(SearchHitSchema), '4xx': ErrorSchema, 503: ErrorSchema },
      },
    },
    (request): SearchHit[] => {
      const { view } = access(request);
      return view.search(sessionOf(view, request.query.session), request.query.q, SEARCH_LIMIT);
    },
  );
}
