import { Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import {
  fetchSubscriberToken,
  parseJwtExp,
  type FetchLike,
  type ListenerConfig,
} from './token.js';

/** Connection state surfaced to consumers (Shared Contract C7). */
export type ListenerState = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

export interface Listener {
  /** Fetch a subscriber token (C4) and connect to the room. */
  connect(): Promise<void>;
  /** Leave the room and tear down. */
  disconnect(): Promise<void>;
  /** Attach the subscribed audio track to a caller-provided <audio> element. */
  attach(el: HTMLAudioElement): void;
  /** Per-listener playback volume, 0..1 (clamped). */
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  onState(cb: (s: ListenerState) => void): () => void;
  getState(): ListenerState;
}

export interface ListenerDeps {
  /** Room factory — overridden in tests. Defaults to a real livekit-client Room. */
  createRoom?: () => Room;
  /** fetch impl — overridden in tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

/** Re-fetch the token this many ms before it expires. */
const REFRESH_SKEW_MS = 30_000;

/**
 * Framework-agnostic listener: subscribes to the single remote audio track (C5),
 * plays it through a caller-provided element with per-listener volume, and rides
 * livekit-client's auto-reconnect while surfacing connection state (C7).
 */
export function createListener(config: ListenerConfig, deps: ListenerDeps = {}): Listener {
  const createRoom = deps.createRoom ?? (() => new Room());
  const fetchImpl = deps.fetchImpl ?? fetch;

  let room: Room | null = null;
  let el: HTMLAudioElement | null = null;
  let track: RemoteTrack | null = null;
  let volume = 1;
  let muted = false;
  let state: ListenerState = 'disconnected';
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const stateListeners = new Set<(s: ListenerState) => void>();

  function setState(next: ListenerState): void {
    if (next === state) return;
    state = next;
    for (const cb of stateListeners) cb(next);
  }

  function applyAudioSettings(): void {
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }

  function attachTrack(): void {
    if (!track || !el) return;
    track.attach(el);
    applyAudioSettings();
  }

  function onTrackSubscribed(t: RemoteTrack): void {
    if (t.kind !== Track.Kind.Audio) return;
    track = t;
    attachTrack();
    setState('live');
  }

  function wireRoom(r: Room): void {
    r.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    r.on(RoomEvent.Reconnecting, () => setState('reconnecting'));
    r.on(RoomEvent.Reconnected, () => {
      attachTrack();
      setState('live');
    });
    r.on(RoomEvent.Disconnected, () => setState('disconnected'));
  }

  function clearRefresh(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh(token: string): void {
    clearRefresh();
    const exp = parseJwtExp(token);
    if (exp == null) return;
    const fireIn = exp * 1000 - Date.now() - REFRESH_SKEW_MS;
    if (fireIn <= 0) return;
    refreshTimer = setTimeout(() => {
      void refresh();
    }, fireIn);
  }

  /** Proactive token refresh: livekit-client has no live-token setter, so fetch a
   *  fresh token and reconnect a new Room before the old token expires. */
  async function refresh(): Promise<void> {
    if (!room) return;
    let token: string;
    let url: string;
    try {
      ({ token, url } = await fetchSubscriberToken(config, fetchImpl));
    } catch {
      // Auto-reconnect may still carry us; retry at the next scheduled point is
      // not possible without a valid token, so bail quietly.
      return;
    }
    setState('reconnecting');
    const next = createRoom();
    wireRoom(next);
    try {
      await next.connect(url, token);
    } catch {
      return;
    }
    const previous = room;
    room = next;
    void previous?.disconnect();
    scheduleRefresh(token);
  }

  return {
    async connect(): Promise<void> {
      setState('connecting');
      let token: string;
      let url: string;
      try {
        ({ token, url } = await fetchSubscriberToken(config, fetchImpl));
      } catch (err) {
        setState('disconnected');
        throw err;
      }
      const r = createRoom();
      wireRoom(r);
      try {
        await r.connect(url, token);
      } catch (err) {
        setState('disconnected');
        throw err;
      }
      room = r;
      scheduleRefresh(token);
    },

    async disconnect(): Promise<void> {
      clearRefresh();
      if (track && el) track.detach(el);
      track = null;
      const r = room;
      room = null;
      await r?.disconnect();
      setState('disconnected');
    },

    attach(element: HTMLAudioElement): void {
      el = element;
      attachTrack();
    },

    setVolume(v: number): void {
      volume = Math.max(0, Math.min(1, v));
      applyAudioSettings();
    },

    setMuted(m: boolean): void {
      muted = m;
      applyAudioSettings();
    },

    onState(cb: (s: ListenerState) => void): () => void {
      stateListeners.add(cb);
      return () => {
        stateListeners.delete(cb);
      };
    },

    getState(): ListenerState {
      return state;
    },
  };
}
