import { describe, it, expect, vi } from 'vitest';
import { fetchSubscriberToken, TokenFetchError, type ListenerConfig } from './token.js';

const config: ListenerConfig = {
  tokenEndpoint: 'http://localhost:8080',
  room: 'spike',
  password: 'test',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchSubscriberToken', () => {
  it('POSTs /token with subscriber role and returns token + url on 200', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { token: 'jwt.abc.def', url: 'ws://localhost:7880' }),
    );

    const result = await fetchSubscriberToken(config, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ token: 'jwt.abc.def', url: 'ws://localhost:7880' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('http://localhost:8080/token');
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      room: 'spike',
      role: 'subscriber',
      password: 'test',
    });
  });

  it('does not double a trailing slash on the token endpoint', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { token: 't', url: 'ws://x' }),
    );

    await fetchSubscriberToken(
      { ...config, tokenEndpoint: 'http://localhost:8080/' },
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl.mock.calls[0]![0]).toBe('http://localhost:8080/token');
  });

  it('throws TokenFetchError with status 401 on bad password', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'bad password' }));

    await expect(
      fetchSubscriberToken(config, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'TokenFetchError', status: 401 });
  });

  it('throws TokenFetchError with status 400 on bad request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: 'bad request' }));

    await expect(
      fetchSubscriberToken(config, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'TokenFetchError', status: 400 });
  });

  it('throws TokenFetchError on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(
      fetchSubscriberToken(config, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(TokenFetchError);
  });

  it('throws TokenFetchError on malformed 200 body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { token: '' }));

    await expect(
      fetchSubscriberToken(config, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(TokenFetchError);
  });
});
