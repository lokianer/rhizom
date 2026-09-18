import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HealthResponse } from '@rhizom/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

describe('GET /api/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ webDist: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns status ok and the package version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body: HealthResponse = res.json();
    expect(body).toEqual({ status: 'ok', version: pkg.version });
  });

  it('returns a JSON 404 for unknown /api routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('returns a JSON 404 for page paths when no web build is configured', async () => {
    const res = await app.inject({ method: 'GET', url: '/some/client/route' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });
});

describe('web app with history-API fallback', () => {
  let app: FastifyInstance;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), 'rhizom-web-dist-'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Rhizom</title>');
    writeFileSync(join(webDist, 'app.js'), 'console.log("hi")');
    mkdirSync(join(webDist, 'assets'));
    writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'export {}');
    app = await buildApp({ webDist });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(webDist, { recursive: true, force: true });
  });

  it('serves files from the build directory', async () => {
    const res = await app.inject({ method: 'GET', url: '/app.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body).toContain('console.log');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('marks hashed assets as immutable', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves index.html for the root path', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<title>Rhizom</title>');
  });

  it('falls back to index.html for unknown GET paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings/profile?tab=2' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('<title>Rhizom</title>');
  });

  it('answers HEAD requests for pages without a body', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/settings' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toBe('');
  });

  it('keeps /api/* JSON even when the web app is served', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  it('treats API paths with a doubled slash or a fragment as API paths', async () => {
    for (const url of ['//api/nope', '/api#fragment', '/./api/nope']) {
      const res = await app.inject({ method: 'GET', url });

      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/^application\/json/);
    }
  });

  it('does not serve index.html for missing assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-old.js' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('does not fall back for non-GET requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/settings' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('never serves files outside the build directory', async () => {
    for (const url of [
      '/../package.json',
      '/%2e%2e/package.json',
      '/assets/..%2f..%2fpackage.json',
    ]) {
      const res = await app.inject({ method: 'GET', url });

      expect(res.body, url).not.toContain('"name"');
    }
  });

  it('ignores a configured directory that does not exist', async () => {
    const missing = await buildApp({ webDist: join(webDist, 'does-not-exist') });
    await missing.ready();
    const res = await missing.inject({ method: 'GET', url: '/' });
    await missing.close();

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });
});
