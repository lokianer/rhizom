// Errors, liveness, and the path and query parameters every route shares.
import { Type, type Static } from '@sinclair/typebox';

export const ErrorSchema = Type.Object(
  {
    statusCode: Type.Integer(),
    error: Type.String(),
    message: Type.String(),
  },
  { $id: 'Error', description: 'Shape of every error response' },
);

export const HealthSchema = Type.Object({
  status: Type.Literal('ok'),
  version: Type.String(),
});

export const NotePathParamsSchema = Type.Object({ '*': Type.String({ minLength: 1 }) });

export const PathQuerySchema = Type.Object({ path: Type.String({ minLength: 1 }) });

export type ErrorBody = Static<typeof ErrorSchema>;
