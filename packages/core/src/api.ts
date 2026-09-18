/** Response body of `GET /api/health`. */
export interface HealthResponse {
  status: 'ok';
  /** Version of the running server package. */
  version: string;
}
