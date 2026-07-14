import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from './server.js';
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
