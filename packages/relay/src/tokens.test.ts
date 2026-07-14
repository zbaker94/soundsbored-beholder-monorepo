import { describe, it, expect } from 'vitest';
import { buildGrant, mintToken } from './tokens.js';

describe('buildGrant', () => {
  it('publisher grant has canPublish true and canSubscribe false', () => {
    const grant = buildGrant('publisher', 'test-room');
    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toBe('test-room');
    expect(grant.canPublish).toBe(true);
    expect(grant.canSubscribe).toBe(false);
  });

  it('subscriber grant has canPublish false and canSubscribe true', () => {
    const grant = buildGrant('subscriber', 'test-room');
    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toBe('test-room');
    expect(grant.canPublish).toBe(false);
    expect(grant.canSubscribe).toBe(true);
  });
});

describe('mintToken', () => {
  it('returns a non-empty JWT string', async () => {
    const token = await mintToken({
      apiKey: 'devkey',
      apiSecret: 'secret',
      identity: 'publisher-test-room-1',
      room: 'test-room',
      role: 'publisher',
    });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(token.split('.').length).toBe(3);
  });

  it('decoded payload contains expected video grant and sub identity for publisher', async () => {
    const identity = 'publisher-test-room-1';
    const token = await mintToken({
      apiKey: 'devkey',
      apiSecret: 'secret',
      identity,
      room: 'test-room',
      role: 'publisher',
    });
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );
    expect(payload.sub).toBe(identity);
    expect(payload.video).toBeDefined();
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.room).toBe('test-room');
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(false);
  });

  it('decoded payload contains expected video grant for subscriber', async () => {
    const identity = 'subscriber-test-room-1';
    const token = await mintToken({
      apiKey: 'devkey',
      apiSecret: 'secret',
      identity,
      room: 'test-room',
      role: 'subscriber',
    });
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );
    expect(payload.video.canPublish).toBe(false);
    expect(payload.video.canSubscribe).toBe(true);
  });
});
