import { afterEach, describe, expect, it, vi } from 'vitest';
import { GistClient } from './gist-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gist client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries patch on transient 409 conflicts', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(409, { message: 'Gist cannot be updated.' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'g1', files: { 'a.json': { filename: 'a.json' } } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new GistClient('token');
    const result = await client.patchGist('g1', {
      'a.json': { content: '{"ok":true}' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('g1');
    expect(result.files['a.json']).toBeTruthy();
  });
});
