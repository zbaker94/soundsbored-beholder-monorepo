import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock livekit-client so importing the core never loads the real (browser) module.
// Only the RoomEvent / Track enum values are consumed by the core; the Room itself
// is injected via createListener's deps.
vi.mock('livekit-client', () => ({
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackPublished: 'trackPublished',
    TrackUnpublished: 'trackUnpublished',
  },
  Track: {
    Kind: { Audio: 'audio', Video: 'video' },
  },
  Room: class {},
}));

import { createListener } from './listener.js';
import type { Presence } from './listener.js';
import type { ListenerConfig } from './token.js';

const config: ListenerConfig = {
  tokenEndpoint: 'http://localhost:8080',
  room: 'spike',
  password: 'test',
};

type Handler = (...args: unknown[]) => void;

class FakeRoom {
  handlers = new Map<string, Handler[]>();
  connect = vi.fn(async (_url: string, _token: string) => {});
  disconnect = vi.fn(async () => {});
  remoteParticipants = new Map<string, { audioTrackPublications: Map<string, unknown> }>();

  /** Add/replace a participant; `hasAudio` marks it as the broadcaster. */
  addParticipant(id: string, hasAudio: boolean): void {
    this.remoteParticipants.set(id, {
      audioTrackPublications: hasAudio ? new Map([['a', {}]]) : new Map(),
    });
  }

  on(event: string, cb: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, cb: Handler): this {
    const list = this.handlers.get(event);
    if (list) {
      const i = list.indexOf(cb);
      if (i !== -1) list.splice(i, 1);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of [...(this.handlers.get(event) ?? [])]) cb(...args);
  }
}

function fakeAudioTrack() {
  return { kind: 'audio', attach: vi.fn(), detach: vi.fn() };
}

function fakeElement() {
  return { volume: 1, muted: false } as unknown as HTMLAudioElement;
}

function okTokenFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token: 'jwt.header.payload', url: 'ws://localhost:7880' }),
  })) as unknown as typeof fetch;
}

describe('createListener', () => {
  let room: FakeRoom;
  const makeDeps = (fetchImpl = okTokenFetch()) => {
    room = new FakeRoom();
    return { createRoom: () => room as never, fetchImpl };
  };

  it('starts in disconnected state', () => {
    const l = createListener(config, makeDeps());
    expect(l.getState()).toBe('disconnected');
  });

  it('connect() fetches a subscriber token then joins the room, state waiting', async () => {
    const fetchImpl = okTokenFetch();
    const l = createListener(config, makeDeps(fetchImpl));
    await l.connect();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(room.connect).toHaveBeenCalledWith('ws://localhost:7880', 'jwt.header.payload');
    // Joined the room but no audio track yet.
    expect(l.getState()).toBe('waiting');
  });

  it('goes live and attaches the track to the element on TrackSubscribed (audio)', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();

    const track = fakeAudioTrack();
    room.emit('trackSubscribed', track, {}, {});

    expect(track.attach).toHaveBeenCalledWith(el);
    expect(l.getState()).toBe('live');
  });

  it('ignores non-audio tracks', async () => {
    const l = createListener(config, makeDeps());
    l.attach(fakeElement());
    await l.connect();

    const video = { kind: 'video', attach: vi.fn(), detach: vi.fn() };
    room.emit('trackSubscribed', video, {}, {});

    expect(video.attach).not.toHaveBeenCalled();
    expect(l.getState()).toBe('waiting');
  });

  it('attaches a late-provided element to an already-subscribed track', async () => {
    const l = createListener(config, makeDeps());
    await l.connect();

    const track = fakeAudioTrack();
    room.emit('trackSubscribed', track, {}, {});
    expect(track.attach).not.toHaveBeenCalled();

    const el = fakeElement();
    l.attach(el);
    expect(track.attach).toHaveBeenCalledWith(el);
  });

  it('setVolume clamps 0..1 and applies to the element', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();
    room.emit('trackSubscribed', fakeAudioTrack(), {}, {});

    l.setVolume(0.3);
    expect(el.volume).toBe(0.3);
    l.setVolume(5);
    expect(el.volume).toBe(1);
    l.setVolume(-2);
    expect(el.volume).toBe(0);
  });

  it('setMuted applies to the element', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();
    room.emit('trackSubscribed', fakeAudioTrack(), {}, {});

    l.setMuted(true);
    expect(el.muted).toBe(true);
    l.setMuted(false);
    expect(el.muted).toBe(false);
  });

  it('remembers volume/mute set before a track/element exists', async () => {
    const l = createListener(config, makeDeps());
    l.setVolume(0.5);
    l.setMuted(true);

    const el = fakeElement();
    l.attach(el);
    await l.connect();
    room.emit('trackSubscribed', fakeAudioTrack(), {}, {});

    expect(el.volume).toBe(0.5);
    expect(el.muted).toBe(true);
  });

  it('drives state through the reconnect lifecycle and re-attaches on Reconnected', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();

    const track = fakeAudioTrack();
    room.emit('trackSubscribed', track, {}, {});
    expect(l.getState()).toBe('live');

    room.emit('reconnecting');
    expect(l.getState()).toBe('reconnecting');

    room.emit('reconnected');
    expect(l.getState()).toBe('live');
    // re-attached the current track after the blip
    expect(track.attach).toHaveBeenCalledTimes(2);
  });

  it('drops to waiting (still in room) when the track is unsubscribed', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();

    const track = fakeAudioTrack();
    room.emit('trackSubscribed', track, {}, {});
    expect(l.getState()).toBe('live');

    // publisher leaves -> livekit unsubscribes the track
    room.emit('trackUnsubscribed', track, {}, {});
    expect(track.detach).toHaveBeenCalledWith(el);
    expect(l.getState()).toBe('waiting');
  });

  it('Reconnected with no active track stays waiting, not a false live', async () => {
    const l = createListener(config, makeDeps());
    l.attach(fakeElement());
    await l.connect();
    // never received a track (or lost it) before the blip
    room.emit('reconnecting');
    room.emit('reconnected');
    expect(l.getState()).toBe('waiting');
  });

  it('goes live again when the publisher re-publishes after a reconnect', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();

    const first = fakeAudioTrack();
    room.emit('trackSubscribed', first, {}, {});
    room.emit('trackUnsubscribed', first, {}, {}); // publisher dropped
    room.emit('reconnecting');
    room.emit('reconnected');
    expect(l.getState()).toBe('waiting');

    // publisher back -> fresh track subscribed
    const second = fakeAudioTrack();
    room.emit('trackSubscribed', second, {}, {});
    expect(second.attach).toHaveBeenCalledWith(el);
    expect(l.getState()).toBe('live');
  });

  it('sets disconnected on RoomEvent.Disconnected', async () => {
    const l = createListener(config, makeDeps());
    await l.connect();
    room.emit('disconnected');
    expect(l.getState()).toBe('disconnected');
  });

  it('tracks room presence: broadcaster + fellow listeners', async () => {
    const l = createListener(config, makeDeps());
    const seen: Presence[] = [];
    l.onPresence((p) => seen.push(p));
    await l.connect();
    expect(l.getPresence()).toEqual({ broadcaster: false, listeners: 0 });

    // a fellow listener joins (subscribe-only, no audio publication)
    room.addParticipant('l1', false);
    room.emit('participantConnected', {});
    expect(l.getPresence()).toEqual({ broadcaster: false, listeners: 1 });

    // the broadcaster joins (publishes audio)
    room.addParticipant('gm', true);
    room.emit('participantConnected', {});
    expect(l.getPresence()).toEqual({ broadcaster: true, listeners: 1 });

    // broadcaster leaves
    room.remoteParticipants.delete('gm');
    room.emit('participantDisconnected', {});
    expect(l.getPresence()).toEqual({ broadcaster: false, listeners: 1 });

    // disconnect resets presence
    await l.disconnect();
    expect(l.getPresence()).toEqual({ broadcaster: false, listeners: 0 });

    expect(seen).toContainEqual({ broadcaster: true, listeners: 1 });
  });

  it('onState notifies subscribers and unsubscribes cleanly', async () => {
    const l = createListener(config, makeDeps());
    const seen: string[] = [];
    const off = l.onState((s) => seen.push(s));

    await l.connect();
    room.emit('trackSubscribed', fakeAudioTrack(), {}, {});
    off();
    room.emit('reconnecting');

    expect(seen).toEqual(['connecting', 'waiting', 'live']);
  });

  it('connect() failure surfaces the error and returns to disconnected', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const l = createListener(config, makeDeps(failing));

    await expect(l.connect()).rejects.toThrow();
    expect(l.getState()).toBe('disconnected');
  });

  it('disconnect() detaches the track and tears down the room', async () => {
    const l = createListener(config, makeDeps());
    const el = fakeElement();
    l.attach(el);
    await l.connect();
    const track = fakeAudioTrack();
    room.emit('trackSubscribed', track, {}, {});

    await l.disconnect();

    expect(track.detach).toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalled();
    expect(l.getState()).toBe('disconnected');
  });
});

describe('createListener token refresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('proactively re-fetches a token and reconnects before expiry', async () => {
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    // exp = now + 120s
    const exp = Math.floor(Date.now() / 1000) + 120;
    const token = makeJwt(exp);

    const rooms: FakeRoom[] = [];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token, url: 'ws://localhost:7880' }),
    })) as unknown as typeof fetch;

    const l = createListener(config, {
      createRoom: () => {
        const r = new FakeRoom();
        rooms.push(r);
        return r as never;
      },
      fetchImpl,
    });

    await l.connect();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(rooms).toHaveLength(1);

    // Advance to just past the refresh point (exp - 30s skew).
    await vi.advanceTimersByTimeAsync(91_000);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rooms).toHaveLength(2);
  });

  it('keeps the live connection when the refresh token fetch fails', async () => {
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const token = makeJwt(Math.floor(Date.now() / 1000) + 120);

    const rooms: FakeRoom[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token, url: 'ws://localhost:7880' }),
        };
      }
      throw new Error('endpoint down');
    }) as unknown as typeof fetch;

    const l = createListener(config, {
      createRoom: () => {
        const r = new FakeRoom();
        rooms.push(r);
        return r as never;
      },
      fetchImpl,
    });

    await l.connect();
    rooms[0].emit('trackSubscribed', fakeAudioTrack(), {}, {});
    expect(l.getState()).toBe('live');

    // Refresh fires, token fetch throws — old room stays, no new room, still live.
    await vi.advanceTimersByTimeAsync(91_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rooms).toHaveLength(1);
    expect(l.getState()).toBe('live');
  });

  it('retries a failed refresh and swaps in a fresh room on a later attempt', async () => {
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const token = makeJwt(Math.floor(Date.now() / 1000) + 120);

    const rooms: FakeRoom[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      // First refresh (call 2) fails; the retry (call 3) succeeds.
      if (call === 2) throw new Error('endpoint down');
      return {
        ok: true,
        status: 200,
        json: async () => ({ token, url: 'ws://localhost:7880' }),
      };
    }) as unknown as typeof fetch;

    const l = createListener(config, {
      createRoom: () => {
        const r = new FakeRoom();
        rooms.push(r);
        return r as never;
      },
      fetchImpl,
    });

    await l.connect();
    rooms[0].emit('trackSubscribed', fakeAudioTrack(), {}, {});

    // Refresh at exp-30s fails; a retry is scheduled 15s later and succeeds.
    await vi.advanceTimersByTimeAsync(91_000); // failed refresh
    expect(rooms).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000); // retry succeeds
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(rooms).toHaveLength(2);
    expect(l.getState()).toBe('live');
  });

  it('keeps the old room live when the refresh reconnect fails', async () => {
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const token = makeJwt(Math.floor(Date.now() / 1000) + 120);

    const rooms: FakeRoom[] = [];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token, url: 'ws://localhost:7880' }),
    })) as unknown as typeof fetch;

    const l = createListener(config, {
      createRoom: () => {
        const r = new FakeRoom();
        // The second (refresh) room fails to connect.
        if (rooms.length === 1) {
          r.connect = vi.fn(async () => {
            throw new Error('reconnect failed');
          });
        }
        rooms.push(r);
        return r as never;
      },
      fetchImpl,
    });

    await l.connect();
    rooms[0].emit('trackSubscribed', fakeAudioTrack(), {}, {});
    expect(l.getState()).toBe('live');

    await vi.advanceTimersByTimeAsync(91_000);
    // New room was attempted and torn down; old room never disconnected.
    expect(rooms).toHaveLength(2);
    expect(rooms[1].disconnect).toHaveBeenCalled();
    expect(rooms[0].disconnect).not.toHaveBeenCalled();
    expect(l.getState()).toBe('live');
  });

  it('does not leak a spurious disconnect from the swapped-out room after refresh', async () => {
    vi.setSystemTime(new Date('2026-07-14T00:00:00Z'));
    const token = makeJwt(Math.floor(Date.now() / 1000) + 120);

    const rooms: FakeRoom[] = [];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token, url: 'ws://localhost:7880' }),
    })) as unknown as typeof fetch;

    const l = createListener(config, {
      createRoom: () => {
        const r = new FakeRoom();
        rooms.push(r);
        return r as never;
      },
      fetchImpl,
    });

    await l.connect();
    rooms[0].emit('trackSubscribed', fakeAudioTrack(), {}, {});
    // New room comes up live, then old room is torn down.
    await vi.advanceTimersByTimeAsync(91_000);
    rooms[1].emit('trackSubscribed', fakeAudioTrack(), {}, {});
    expect(l.getState()).toBe('live');

    // The discarded room's teardown fires Disconnected — must be ignored.
    rooms[0].emit('disconnected');
    expect(l.getState()).toBe('live');
  });
});

function makeJwt(exp: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp })}.sig`;
}
