import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Delegate to the real mintToken by default; individual tests can override it.
vi.mock('./tokens.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tokens.js')>();
  return { ...actual, mintToken: vi.fn(actual.mintToken) };
});

import { buildServer } from './server.js';
import { mintToken } from './tokens.js';
import type { FastifyInstance } from 'fastify';

const TEST_DEPS = {
  apiKey: 'devkey',
  apiSecret: 'secret',
  roomPassword: 'correct-password',
  sfuUrl: 'ws://localhost:7880',
};

let app: FastifyInstance;

beforeEach(async () => {
  app = buildServer(TEST_DEPS);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /token', () => {
  it('returns 200 with token and url for valid publisher request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        room: 'my-room',
        role: 'publisher',
        password: 'correct-password',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.url).toBe(TEST_DEPS.sfuUrl);
  });

  it('returns 200 with token and url for valid subscriber request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        room: 'my-room',
        role: 'subscriber',
        password: 'correct-password',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.url).toBe(TEST_DEPS.sfuUrl);

    // Verify subscriber grant in token
    const [, payloadB64] = body.token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );
    expect(payload.video.canPublish).toBe(false);
    expect(payload.video.canSubscribe).toBe(true);
  });

  it('returns 401 with bad password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        room: 'my-room',
        role: 'publisher',
        password: 'wrong-password',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'bad password' });
  });

  it('returns 400 for missing room field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        role: 'publisher',
        password: 'correct-password',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad request' });
  });

  it('returns 400 for invalid role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        room: 'my-room',
        role: 'observer',
        password: 'correct-password',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad request' });
  });

  it('returns 400 for empty password in body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        room: 'my-room',
        role: 'publisher',
        password: '',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad request' });
  });

  it('mints an unpredictable identity, not one derived from join order', async () => {
    // Clients pick their avatar by hashing this identity, so an identity fixed by
    // join order would hand the first listener the same avatar every session.
    // A fresh server must not reissue the identity its predecessor started with.
    const identityFor = async (server: FastifyInstance): Promise<string> => {
      vi.mocked(mintToken).mockClear();
      await server.inject({
        method: 'POST',
        url: '/token',
        payload: { room: 'my-room', role: 'subscriber', password: 'correct-password' },
      });
      return vi.mocked(mintToken).mock.calls[0][0].identity;
    };

    const first = await identityFor(app);
    const other = buildServer(TEST_DEPS);
    await other.ready();
    const second = await identityFor(other);
    await other.close();

    expect(second).not.toBe(first);
  });

  it('keeps identities unique across requests to one server', async () => {
    vi.mocked(mintToken).mockClear();
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/token',
        payload: { room: 'my-room', role: 'subscriber', password: 'correct-password' },
      });
    }
    const identities = vi.mocked(mintToken).mock.calls.map((c) => c[0].identity);
    expect(new Set(identities).size).toBe(5);
  });

  it('returns 500 when token minting fails', async () => {
    vi.mocked(mintToken).mockRejectedValueOnce(new Error('signing failure'));

    const res = await app.inject({
      method: 'POST',
      url: '/token',
      payload: {
        room: 'my-room',
        role: 'publisher',
        password: 'correct-password',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'token generation failed' });
  });
});

describe('GET /healthz', () => {
  it('returns 200 with ok: true', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
