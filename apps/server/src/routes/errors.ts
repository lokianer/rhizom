import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { VaultError, type VaultErrorCode } from '../vault/files.js';
import type { ErrorBody } from './schemas.js';

const STATUS_BY_CODE: Record<VaultErrorCode, number> = {
  INVALID_ROOT: 503,
  UNSAFE_PATH: 400,
  NOT_A_NOTE: 400,
  NOT_FOUND: 404,
  EXISTS: 409,
  HASH_MISMATCH: 412,
};

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** An error that carries the HTTP status it should be answered with. */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function errorBody(statusCode: number, message: string): ErrorBody {
  return { statusCode, error: REASONS[statusCode] ?? 'Error', message };
}

/** Maps vault, validation and HTTP errors to the one JSON error shape of the API. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof VaultError) {
        const status = STATUS_BY_CODE[error.code];
        return reply.code(status).send(errorBody(status, error.message));
      }
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send(errorBody(error.statusCode, error.message));
      }
      const statusCode =
        'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      if (statusCode >= 500) {
        app.log.error(error);
        return reply.code(statusCode).send(errorBody(statusCode, 'Something went wrong'));
      }
      return reply.code(statusCode).send(errorBody(statusCode, error.message));
    },
  );
}
