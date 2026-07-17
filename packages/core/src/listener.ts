import { Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrack } from 'livekit-client';
import {
  fetchSubscriberToken,
  parseJwtExp,
  type FetchLike,
  type ListenerConfig,
} from './token.js';

/** Connection state surfaced to consumers (Shared Contract C7 resilience).
 *  `connecting` = still establishing the connection; `waiting` = joined the room
 *  but the publisher's audio track hasn't arrived yet (or has dropped); `live` =
 *  audio is playing. */
export type ListenerState =
  | 'connecting'
  | 'waiting'
  | 'live'
  | 'reconnecting'
  | 'disconnected';

/** Who else is in the room (C5: one broadcaster publishing audio, N listeners). */
export interface Presence {
  /** A remote participant is publishing audio — the SoundsBored broadcaster. */
  broadcaster: boolean;
  /** How many other subscribe-only participants share the room. */
  listeners: number;
  /** This client's own identity, or null while disconnected. */
  self: string | null;
  /**
   * Identities of the fellow listeners (excludes the broadcaster and self),
   * sorted so a given identity keeps its position as others join and leave.
   */
  listenerIds: string[];
}

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
  /** Subscribe to room presence (broadcaster + other listeners); returns unsub. */
  onPresence(cb: (p: Presence) => void): () => void;
  getPresence(): Presence;
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
  const EMPTY_PRESENCE: Presence = {
    broadcaster: false,
    listeners: 0,
    self: null,
    listenerIds: [],
  };
  let presence: Presence = EMPTY_PRESENCE;

  const stateListeners = new Set<(s: ListenerState) => void>();
  const presenceListeners = new Set<(p: Presence) => void>();

  function samePresence(a: Presence, b: Presence): boolean {
    return (
      a.broadcaster === b.broadcaster &&
      a.self === b.self &&
      a.listenerIds.length === b.listenerIds.length &&
      a.listenerIds.every((id, i) => id === b.listenerIds[i])
    );
  }

  function setPresence(next: Presence): void {
    // Compared by identity, not just by count: one listener swapping for another
    // leaves the count untouched but must still reach consumers.
    if (samePresence(next, presence)) return;
    presence = next;
    for (const cb of presenceListeners) cb(next);
  }

  /** Classify the room's remote participants: the one publishing audio is the
   *  broadcaster, everyone else is a fellow listener. */
  function recomputePresence(): void {
    if (!room) {
      setPresence(EMPTY_PRESENCE);
      return;
    }
    let broadcaster = false;
    const listenerIds: string[] = [];
    for (const p of room.remoteParticipants.values()) {
      if (p.audioTrackPublications.size > 0) broadcaster = true;
      else listenerIds.push(p.identity);
    }
    listenerIds.sort();
    setPresence({
      broadcaster,
      listeners: listenerIds.length,
      self: room.localParticipant?.identity ?? null,
      listenerIds,
    });
  }

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
    if (room) setState('waiting');
  }

  function onReconnected(): void {
    // livekit auto-resubscribes surviving tracks; a new one arrives via
    // TrackSubscribed. Only claim 'live' if we actually hold a track — if the
    // publisher left during the blip, stay 'connecting' until it re-publishes.
    if (track) {
      attachTrack();
      setState('live');
    } else {
      setState('waiting');
    }
    recomputePresence();
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
    // Presence: recompute whenever the room's participant set or their
    // publications change.
    r.on(RoomEvent.ParticipantConnected, recomputePresence);
    r.on(RoomEvent.ParticipantDisconnected, recomputePresence);
    r.on(RoomEvent.TrackPublished, recomputePresence);
    r.on(RoomEvent.TrackUnpublished, recomputePresence);
  }

  /** Detach every handler wireRoom added, so a discarded Room's teardown can't
   *  leak stale state (e.g. a spurious 'disconnected') into the live listener. */
  function unwireRoom(r: Room): void {
    r.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    r.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    r.off(RoomEvent.Reconnecting, onReconnecting);
    r.off(RoomEvent.Reconnected, onReconnected);
    r.off(RoomEvent.Disconnected, onDisconnected);
    r.off(RoomEvent.ParticipantConnected, recomputePresence);
    r.off(RoomEvent.ParticipantDisconnected, recomputePresence);
    r.off(RoomEvent.TrackPublished, recomputePresence);
    r.off(RoomEvent.TrackUnpublished, recomputePresence);
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
    recomputePresence();
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
      // Room joined; the publisher's track arrives asynchronously via
      // TrackSubscribed. Until then we're waiting for audio, not connecting.
      if (!track) setState('waiting');
      recomputePresence();
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
      setPresence(EMPTY_PRESENCE);
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

    onPresence(cb: (p: Presence) => void): () => void {
      presenceListeners.add(cb);
      return () => {
        presenceListeners.delete(cb);
      };
    },

    getPresence(): Presence {
      return presence;
    },
  };
}
