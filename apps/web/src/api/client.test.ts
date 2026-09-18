import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiRequestError, encodeVaultPath, isAbortError } from './client.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Replaces fetch with one that records the request and answers with a fresh response every
 * time: a Response body can only be read once.
 */
function stubFetch(answer: () => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    return Promise.resolve(answer());
  });
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encodeVaultPath', () => {
  it('encodes each segment but keeps the separators', () => {
    expect(encodeVaultPath('Campaign/NPCs/Mira Voss.md')).toBe('Campaign/NPCs/Mira%20Voss.md');
    expect(encodeVaultPath('Research/Über die Wurzeln.md')).toBe(
      'Research/%C3%9Cber%20die%20Wurzeln.md',
    );
  });

  it('encodes a literal question mark so it cannot start a query string', () => {
    expect(encodeVaultPath('Notes/What now?.md')).toBe('Notes/What%20now%3F.md');
  });
});

describe('the note endpoints', () => {
  it('reads a note from its encoded path', async () => {
    const calls = stubFetch(() => jsonResponse({ path: 'Home.md' }));

    await api.note('Campaign/Mira Voss.md');

    expect(calls[0]?.url).toBe('/api/notes/Campaign/Mira%20Voss.md');
  });

  it('sends the loaded hash as a quoted If-Match header', async () => {
    const calls = stubFetch(() => jsonResponse({ path: 'Home.md' }));

    await api.saveNote('Home.md', { content: '# Home' }, 'abc123');

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(headers['if-match']).toBe('"abc123"');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ content: '# Home' }));
  });

  it('omits If-Match when no hash is known', async () => {
    const calls = stubFetch(() => jsonResponse({ path: 'Home.md' }));

    await api.saveNote('Home.md', { content: '# Home' });

    expect(calls[0]?.init?.headers).not.toHaveProperty('if-match');
  });

  it('reports a rejected save as a conflict', async () => {
    stubFetch(() =>
      jsonResponse({ statusCode: 412, error: 'Precondition Failed', message: 'changed' }, 412),
    );

    const failure = await api.saveNote('Home.md', { content: 'x' }, 'old').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiRequestError);
    expect(failure).toMatchObject({ status: 412, isConflict: true, message: 'changed' });
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    stubFetch(
      () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );

    const failure = await api.vault().catch((e: unknown) => e);

    expect(failure).toMatchObject({ status: 502, message: 'Bad Gateway', isConflict: false });
  });

  it('has nothing to parse after a deletion', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    await expect(api.deleteNote('Home.md')).resolves.toBeUndefined();
  });
});

describe('the query endpoints', () => {
  it('escapes the search term and the note path', async () => {
    const calls = stubFetch(() => jsonResponse({ query: '', hits: [], total: 0 }));

    await api.search('a & b');
    await api.backlinks('Campaign/Mira Voss.md');

    expect(calls[0]?.url).toBe('/api/search?q=a%20%26%20b');
    expect(calls[1]?.url).toBe('/api/backlinks?path=Campaign%2FMira%20Voss.md');
  });

  it('asks for the neighbourhood of one note', async () => {
    const calls = stubFetch(() => jsonResponse({ nodes: [], edges: [], clusters: [] }));

    await api.localGraph('Home.md', 2, 'tag');

    expect(calls[0]?.url).toBe('/api/graph/local?path=Home.md&depth=2&clusterBy=tag');
  });

  it('builds the URL of a file inside the vault', () => {
    expect(api.assetUrl('assets/map sketch.png')).toBe('/api/assets/assets/map%20sketch.png');
  });
});

describe('isAbortError', () => {
  it('knows a cancelled request from a real failure', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new DOMException('slow', 'TimeoutError'))).toBe(false);
    expect(isAbortError(new Error('offline'))).toBe(false);
  });
});
