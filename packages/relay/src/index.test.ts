import { describe, it, expect, vi } from 'vitest';

// Mock the server so start() never binds a real port. Refs go through
// vi.hoisted so they exist when the hoisted vi.mock factory runs.
const { listen, buildServer } = vi.hoisted(() => {
  const listen = vi.fn(async () => 'http://127.0.0.1:8080');
  const buildServer = vi.fn(() => ({ listen }));
  return { listen, buildServer };
});
vi.mock('./server.js', () => ({ buildServer }));

import { resolveConfig, start } from './index.js';

describe('resolveConfig', () => {
  it('throws when ROOM_PASSWORD is unset (C5)', () => {
    expect(() => resolveConfig({})).toThrow(/ROOM_PASSWORD/);
  });

  it('applies C5 defaults when only ROOM_PASSWORD is set', () => {
    const { port, deps } = resolveConfig({ ROOM_PASSWORD: 'secret-pw' });
    expect(port).toBe(8080);
    expect(deps).toEqual({
      apiKey: 'devkey',
      apiSecret: 'secret',
      sfuUrl: 'ws://localhost:7880',
      roomPassword: 'secret-pw',
    });
  });

  it('honors every environment override', () => {
    const { port, deps } = resolveConfig({
      PORT: '9090',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'shh',
      SFU_URL: 'wss://sfu.example.com',
      ROOM_PASSWORD: 'pw',
    });
    expect(port).toBe(9090);
    expect(deps).toEqual({
      apiKey: 'key',
      apiSecret: 'shh',
      sfuUrl: 'wss://sfu.example.com',
      roomPassword: 'pw',
    });
  });
});

describe('start', () => {
  it('builds the server with resolved deps and returns the bound address', async () => {
    buildServer.mockClear();
    listen.mockClear();

    const address = await start({ ROOM_PASSWORD: 'pw', PORT: '8099' });

    expect(address).toBe('http://127.0.0.1:8080');
    expect(buildServer).toHaveBeenCalledWith({
      apiKey: 'devkey',
      apiSecret: 'secret',
      sfuUrl: 'ws://localhost:7880',
      roomPassword: 'pw',
    });
    expect(listen).toHaveBeenCalledWith({ port: 8099, host: '0.0.0.0' });
  });

  it('propagates the missing-password failure', async () => {
    await expect(start({})).rejects.toThrow(/ROOM_PASSWORD/);
  });
});
