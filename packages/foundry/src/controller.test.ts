import { describe, it, expect, vi, beforeEach } from 'vitest';

// Importing core (aliased to src) pulls in livekit-client; mock it so nothing
// real loads. The controller injects a fake listener, so only the module-load
// import needs stubbing (mirrors packages/core's own tests).
vi.mock('livekit-client', () => ({
  RoomEvent: {},
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
  Room: class {},
}));

import { createAudioController } from './controller.js';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';

const config: ListenerConfig = { tokenEndpoint: 'https://relay.example', room: 'world1', password: 'pw' };

function makeFakeListener() {
  let stateCb: ((s: ListenerState) => void) | undefined;
  const listener = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    attach: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    onState: vi.fn((cb: (s: ListenerState) => void) => {
      stateCb = cb;
      return () => { stateCb = undefined; };
    }),
    getState: vi.fn((): ListenerState => 'disconnected'),
    onPresence: vi.fn(() => () => {}),
    getPresence: vi.fn(() => ({ broadcaster: false, listeners: 0, self: null, listenerIds: [] })),
  } satisfies Listener & Record<string, unknown>;
  return { listener, emitState: (s: ListenerState) => stateCb?.(s) };
}

function makeFakeAudio() {
  return { play: vi.fn(async () => {}), remove: vi.fn(), volume: 1, muted: false } as unknown as HTMLAudioElement;
}

describe('createAudioController', () => {
  let fake: ReturnType<typeof makeFakeListener>;
  let audio: HTMLAudioElement;
  let createListenerImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fake = makeFakeListener();
    audio = makeFakeAudio();
    createListenerImpl = vi.fn(() => fake.listener);
  });

  const build = (over: Partial<Parameters<typeof createAudioController>[0]> = {}) =>
    createAudioController({
      config,
      createListenerImpl: createListenerImpl as unknown as typeof import('@soundsbored/core').createListener,
      createAudioEl: () => audio,
      ...over,
    });

  it('join() connects, attaches audio, applies volume/mute, then plays', async () => {
    const c = build({ initialVolume: 0.5, initialMuted: true });
    await c.join();
    expect(createListenerImpl).toHaveBeenCalledWith(config);
    expect(fake.listener.attach).toHaveBeenCalledWith(audio);
    expect(fake.listener.setVolume).toHaveBeenCalledWith(0.5);
    expect(fake.listener.setMuted).toHaveBeenCalledWith(true);
    expect(fake.listener.connect).toHaveBeenCalledOnce();
    // Plays twice: once to prime playback inside the gesture (before connect),
    // once after the track subscribes.
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(c.isJoined()).toBe(true);
  });

  it('primes playback within the gesture before connecting', async () => {
    const order: string[] = [];
    (audio.play as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push('play');
    });
    fake.listener.connect.mockImplementation(async () => {
      order.push('connect');
    });
    const c = build();
    await c.join();
    // First play happens before connect resolves (gesture capture).
    expect(order[0]).toBe('play');
    expect(order).toContain('connect');
  });

  it('leave() disconnects and removes the audio element', async () => {
    const c = build();
    await c.join();
    await c.leave();
    expect(fake.listener.disconnect).toHaveBeenCalledOnce();
    expect(audio.remove).toHaveBeenCalledOnce();
    expect(c.isJoined()).toBe(false);
  });

  it('a failed connect cleans up and rethrows', async () => {
    fake.listener.connect.mockRejectedValueOnce(new Error('boom'));
    const c = build();
    await expect(c.join()).rejects.toThrow('boom');
    expect(fake.listener.disconnect).toHaveBeenCalledOnce();
    expect(audio.remove).toHaveBeenCalledOnce();
    expect(c.isJoined()).toBe(false);
  });

  it('setVolume forwards to the listener when joined', async () => {
    const c = build();
    await c.join();
    c.setVolume(0.25);
    expect(fake.listener.setVolume).toHaveBeenLastCalledWith(0.25);
  });

  it('setMuted forwards to the listener when joined', async () => {
    const c = build();
    await c.join();
    c.setMuted(true);
    expect(fake.listener.setMuted).toHaveBeenLastCalledWith(true);
  });

  it('surfaces core state changes to onState subscribers', async () => {
    const seen: ListenerState[] = [];
    const c = build();
    c.onState((s) => seen.push(s));
    await c.join();
    fake.emitState('live');
    fake.emitState('reconnecting');
    expect(seen).toEqual(['live', 'reconnecting']);
  });

  it('setVolume before join remembers the value for the next join', async () => {
    const c = build();
    c.setVolume(0.4);
    await c.join();
    expect(fake.listener.setVolume).toHaveBeenCalledWith(0.4);
  });
});
