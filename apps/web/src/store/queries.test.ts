import type { QueryResult } from '@rhizom/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useQueryResults } from './queries.js';

const ANSWER: QueryResult = {
  rows: [
    {
      path: 'Campaign/NPCs/Mira.md',
      title: 'Mira',
      folder: 'Campaign/NPCs',
      tags: [],
      modifiedAt: '2026-01-02T00:00:00.000Z',
      size: 12,
      fields: {},
    },
  ],
  total: 1,
  view: 'list',
  columns: [],
  problems: [],
};

interface Call {
  url: string;
  body: string;
}

/** Replaces fetch with one that records the call and answers with a fresh response every time. */
function stubFetch(answer: () => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    calls.push({ url: input, body: typeof init?.body === 'string' ? init.body : '' });
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

function answerOf(body: string) {
  return useQueryResults.getState().results[body];
}

beforeEach(() => {
  useQueryResults.getState().invalidate();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the query store', () => {
  it('sends the body of the block and keeps the answer under it', async () => {
    const calls = stubFetch(() => jsonResponse(ANSWER));

    useQueryResults.getState().request('from: Campaign');
    await vi.waitFor(() => expect(answerOf('from: Campaign')).toBeDefined());

    expect(calls[0]?.url).toBe('/api/query');
    expect(calls[0]?.body).toBe(JSON.stringify({ body: 'from: Campaign' }));
    expect(answerOf('from: Campaign')).toEqual({ state: 'ready', result: ANSWER });
  });

  it('asks about one body once, however often the renderer draws it', async () => {
    const calls = stubFetch(() => jsonResponse(ANSWER));

    // Twice before the first answer is back, and again once it is: a preview that renders on
    // every keystroke asks about the same block over and over.
    useQueryResults.getState().request('tag: npc');
    useQueryResults.getState().request('tag: npc');
    await vi.waitFor(() => expect(answerOf('tag: npc')).toBeDefined());
    useQueryResults.getState().request('tag: npc');

    expect(calls).toHaveLength(1);
  });

  it('answers two blocks apart, because the body is the question', async () => {
    const calls = stubFetch(() => jsonResponse(ANSWER));

    useQueryResults.getState().request('tag: npc');
    useQueryResults.getState().request('tag: place');
    await vi.waitFor(() => {
      expect(answerOf('tag: npc')).toBeDefined();
      expect(answerOf('tag: place')).toBeDefined();
    });

    expect(calls).toHaveLength(2);
  });

  it('keeps a failure instead of asking again for ever', async () => {
    const calls = stubFetch(() => jsonResponse({ message: 'No vault is configured.' }, 503));

    useQueryResults.getState().request('from: Campaign');
    await vi.waitFor(() => expect(answerOf('from: Campaign')).toBeDefined());
    useQueryResults.getState().request('from: Campaign');

    expect(answerOf('from: Campaign')).toEqual({
      state: 'failed',
      message: 'No vault is configured.',
    });
    expect(calls).toHaveLength(1);
  });

  it('forgets every answer when the index says the vault changed', async () => {
    const calls = stubFetch(() => jsonResponse(ANSWER));

    useQueryResults.getState().request('from: Campaign');
    await vi.waitFor(() => expect(answerOf('from: Campaign')).toBeDefined());
    useQueryResults.getState().invalidate();

    expect(answerOf('from: Campaign')).toBeUndefined();
    useQueryResults.getState().request('from: Campaign');
    await vi.waitFor(() => expect(answerOf('from: Campaign')).toBeDefined());
    expect(calls).toHaveLength(2);
  });

  it('drops an answer that describes the vault as it was before the change', async () => {
    let release: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    stubFetch(() => pending);

    useQueryResults.getState().request('from: Campaign');
    // The index reports a change while the answer is still on its way.
    useQueryResults.getState().invalidate();
    release?.(jsonResponse(ANSWER));
    await pending;
    // Give the store's own `then` a turn before looking.
    await Promise.resolve();

    expect(answerOf('from: Campaign')).toBeUndefined();
  });
});
