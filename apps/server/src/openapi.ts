import { buildApp } from './app.js';

/** The OpenAPI document of the API as plain JSON data, generated from the route schemas. */
export async function generateOpenApi(): Promise<unknown> {
  const app = await buildApp({ webDist: false });
  try {
    await app.ready();
    return JSON.parse(JSON.stringify(app.swagger())) as unknown;
  } finally {
    await app.close();
  }
}
