import { describe, it, expect } from 'vitest';
import { resolveConfig } from './index.js';

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
