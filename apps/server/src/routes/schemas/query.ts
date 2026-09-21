// What a query block asks and what comes back, including what could not be read.
import { Type } from '@sinclair/typebox';

export const QueryBodySchema = Type.Object({
  // A query block is text in a note; the server parses it with the same reader the browser
  // uses, so there is one grammar and one set of error messages.
  body: Type.String({ maxLength: 8000 }),
  fields: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
      maxItems: 20,
      description: 'Frontmatter keys wanted on every row, beyond the block own columns',
    }),
  ),
});

export const QueryRowSchema = Type.Object(
  {
    path: Type.String(),
    title: Type.String(),
    folder: Type.String(),
    tags: Type.Array(Type.String()),
    modifiedAt: Type.String({ format: 'date-time' }),
    size: Type.Integer(),
    fields: Type.Record(Type.String(), Type.String(), {
      description: 'Frontmatter values the query named as columns, rendered as text',
    }),
  },
  { $id: 'QueryRow' },
);

export const QueryProblemSchema = Type.Object(
  {
    line: Type.Integer({ minimum: 0, description: '0 when the problem is the whole block' }),
    message: Type.String(),
  },
  { $id: 'QueryProblem' },
);

export const QueryResultSchema = Type.Object({
  rows: Type.Array(QueryRowSchema),
  total: Type.Integer({ minimum: 0, description: 'Matches before the query own limit cut them' }),
  view: Type.Union([Type.Literal('list'), Type.Literal('table'), Type.Literal('cards')]),
  columns: Type.Array(Type.String()),
  problems: Type.Array(QueryProblemSchema),
});
