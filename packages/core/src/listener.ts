import { Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import {
  fetchSubscriberToken,
  parseJwtExp,
  type FetchLike,
  type ListenerConfig,
} from './token.js';

/** Connection state surfaced to consumers (Shared Contract C7 resilience). */
export type ListenerState = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

export interface Listener {
  /**
   * Fetch a subscriber token (Shared Contract C4) and connect to the room (C5/C7).
   * @throws {TokenFetchError} if the token request fails or its response is malformed.
   * @throws the underlying livekit-client error if the room connection itself fails.
   */
  connect(): Promise<void>;
  /** Leave the room and tear down. */
  disconnect(): Promise<void>;
  /** Attach the subscribed audio track to a caller-provided <audio> element. */
  attach(el: HTMLAudioElement): void;
  /** Per-listener playback volume, 0..1 (clamped). */
  setVolume(volume: number): void;
  /** Mute or unmute this listener's playback without leaving the room. */
  setMuted(muted: boolean): void;
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
/** After a failed refresh, retry this often until the current token expires. */
const REFRESH_RETRY_MS = 15_000;

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
  /** The token currently in use — bounds how long refresh retries keep trying. */
  let currentToken: string | null = null;

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

  function onTrackUnsubscribed(t: RemoteTrack): void {
    if (t !== track) return;
    if (el) t.detach(el);
    track = null;
    // Still joined to the room — just waiting for the publisher to (re)appear.
    if (room) setState('connecting');
  }

  function onReconnected(): void {
    // livekit auto-resubscribes surviving tracks; a new one arrives via
    // TrackSubscribed. Only claim 'live' if we actually hold a track — if the
    // publisher left during the blip, stay 'connecting' until it re-publishes.
    if (track) {
      attachTrack();
      setState('live');
    } else {
      setState('connecting');
    }
  }

  function onReconnecting(): void {
    setState('reconnecting');
  }

  function onDisconnected(): void {
    setState('disconnected');
  }

  function wireRoom(r: Room): void {
    r.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    r.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    r.on(RoomEvent.Reconnecting, onReconnecting);
    r.on(RoomEvent.Reconnected, onReconnected);
    r.on(RoomEvent.Disconnected, onDisconnected);
  }

  /** Detach every handler wireRoom added, so a discarded Room's teardown can't
   *  leak stale state (e.g. a spurious 'disconnected') into the live listener. */
  function unwireRoom(r: Room): void {
    r.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    r.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    r.off(RoomEvent.Reconnecting, onReconnecting);
    r.off(RoomEvent.Reconnected, onReconnected);
    r.off(RoomEvent.Disconnected, onDisconnected);
  }

  /** Create, wire, and connect a fresh Room. Shared by connect() and refresh().
   *  On connect failure the half-built Room is unwired and torn down before the
   *  error propagates, so a caller never inherits a dangling wired Room. */
  async function openRoom(url: string, token: string): Promise<Room> {
    const r = createRoom();
    wireRoom(r);
    try {
      await r.connect(url, token);
    } catch (err) {
      unwireRoom(r);
      void r.disconnect();
      throw err;
    }
    return r;
  }

  function clearRefresh(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  function scheduleRefresh(token: string): void {
    clearRefresh();
    currentToken = token;
    const exp = parseJwtExp(token);
    if (exp == null) return;
    const fireIn = exp * 1000 - Date.now() - REFRESH_SKEW_MS;
    // Already inside the skew window (e.g. a slow retry) — refresh very soon.
    if (fireIn <= 0) {
      scheduleRetry();
      return;
    }
    refreshTimer = setTimeout(() => {
      void refresh();
    }, fireIn);
  }

  /** Re-attempt a failed refresh after a short delay, but only while the current
   *  token still has life left; once it expires there's nothing to preserve and
   *  livekit's own reconnect takes over. */
  function scheduleRetry(): void {
    clearRefresh();
    if (currentToken == null) return;
    const exp = parseJwtExp(currentToken);
    if (exp != null && exp * 1000 <= Date.now()) return;
    refreshTimer = setTimeout(() => {
      void refresh();
    }, REFRESH_RETRY_MS);
  }

  /** Proactive token refresh: livekit-client has no live-token setter, so fetch a
   *  fresh token and reconnect a new Room before the old token expires. The old
   *  Room keeps serving audio until the new one is live, so the swap is seamless
   *  and never surfaces a transient 'reconnecting'/'disconnected' to consumers. */
  async function refresh(): Promise<void> {
    if (!room) return;
    let token: string;
    let url: string;
    try {
      ({ token, url } = await fetchSubscriberToken(config, fetchImpl));
    } catch {
      // No fresh token yet: the existing Room + livekit auto-reconnect still
      // stand. Keep retrying so we get a valid token before the current expires.
      scheduleRetry();
      return;
    }
    let next: Room;
    try {
      next = await openRoom(url, token);
    } catch {
      // New Room failed to connect — discard it, keep the current one live, and
      // retry the whole refresh shortly.
      scheduleRetry();
      return;
    }
    const previous = room;
    room = next;
    // Detach the old Room's handlers before disconnecting so its teardown can't
    // fire 'disconnected' into the now-live listener.
    unwireRoom(previous);
    void previous.disconnect();
    scheduleRefresh(token);
  }

  return {
    async connect(): Promise<void> {
      setState('connecting');
      let token: string;
      let url: string;
      try {
        ({ token, url } = await fetchSubscriberToken(config, fetchImpl));
        room = await openRoom(url, token);
      } catch (err) {
        setState('disconnected');
        throw err;
      }
      scheduleRefresh(token);
    },

    async disconnect(): Promise<void> {
      clearRefresh();
      currentToken = null;
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
