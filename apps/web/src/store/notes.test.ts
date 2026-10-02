import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNoteSources } from './notes.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the note sources', () => {
  it('does not give up on a note because of a 404 meant for the vault before', async () => {
    const calls: string[] = [];
    let answer404: () => void = () => undefined;
    vi.stubGlobal('fetch', (input: string) => {
      calls.push(input);
      if (calls.length === 1) {
        // The first answer arrives only after the tab has switched vaults.
        return new Promise<Response>((resolve) => {
          answer404 = () => {
            resolve(new Response(JSON.stringify({ message: 'gone' }), { status: 404 }));
          };
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ content: '# Map', headings: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    useNoteSources.getState().request('Map.md');
    useNoteSources.getState().invalidate(null);
    answer404();
    // Let the 404 settle, the way it would before anything asks for the note again.
    await new Promise((resolve) => setTimeout(resolve, 0));

    useNoteSources.getState().request('Map.md');
    await vi.waitFor(() => {
      expect(useNoteSources.getState().sources['Map.md']?.content).toBe('# Map');
    });
  });
});
