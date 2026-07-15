import { createListener } from '@soundsbored/core';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';

/** Player-facing audio surface: join/leave a room and control local playback.
 *  All subscribe/reconnect/volume behaviour is delegated to `@soundsbored/core`. */
export interface AudioController {
  /** Connect + attach + play (must be called from a user gesture to unlock audio).
   *  @throws the underlying core connect error (e.g. token fetch or livekit
   *  connection failure) after tearing down; state is reset to 'disconnected'. */
  join(): Promise<void>;
  /** Disconnect and tear down the audio element. */
  leave(): Promise<void>;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Subscribe to core connection-state changes; returns an unsubscribe fn. */
  onState(cb: (s: ListenerState) => void): () => void;
  getState(): ListenerState;
  isJoined(): boolean;
}

export interface AudioControllerDeps {
  config: ListenerConfig;
  initialVolume?: number;
  initialMuted?: boolean;
  /** Injectable for tests; defaults to the real core factory. */
  createListenerImpl?: typeof createListener;
  /** Injectable for tests; defaults to a hidden <audio> appended to <body>. */
  createAudioEl?: () => HTMLAudioElement;
}

function defaultAudioEl(): HTMLAudioElement {
  const el = document.createElement('audio');
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

export function createAudioController(deps: AudioControllerDeps): AudioController {
  const makeListener = deps.createListenerImpl ?? createListener;
  const makeAudioEl = deps.createAudioEl ?? defaultAudioEl;

  let currentVolume = deps.initialVolume ?? 1;
  let currentMuted = deps.initialMuted ?? false;
  let state: ListenerState = 'disconnected';

  let listener: Listener | null = null;
  let el: HTMLAudioElement | null = null;
  let unsubListenerState: (() => void) | null = null;

  const stateListeners = new Set<(s: ListenerState) => void>();
  function setState(next: ListenerState): void {
    if (next === state) return;
    state = next;
    for (const cb of stateListeners) cb(next);
  }

  function teardown(): void {
    unsubListenerState?.();
    unsubListenerState = null;
    el?.remove();
    el = null;
    listener = null;
  }

  return {
    async join(): Promise<void> {
      if (listener) return;
      const l = makeListener(deps.config);
      const audio = makeAudioEl();
      listener = l;
      el = audio;
      unsubListenerState = l.onState(setState);
      l.attach(audio);
      l.setVolume(currentVolume);
      l.setMuted(currentMuted);
      // Prime playback inside the caller's gesture: connect() is async and the
      // user activation that unlocks autoplay can expire before the track
      // arrives. Playing now (even before there's a source) blesses the element
      // so the real playback after the track subscribes isn't blocked.
      void audio.play().catch(() => undefined);
      try {
        await l.connect();
      } catch (err) {
        await l.disconnect().catch(() => undefined);
        teardown();
        setState('disconnected');
        throw err;
      }
      // Play again once the track is subscribed (the primed element is unlocked).
      await audio.play().catch(() => undefined);
    },

    async leave(): Promise<void> {
      const l = listener;
      teardown();
      // Guard like the join() error path: a disconnect rejection must not skip
      // the state reset (or, upstream, the panel's controller cleanup).
      await l?.disconnect().catch(() => undefined);
      setState('disconnected');
    },

    setVolume(volume: number): void {
      currentVolume = volume;
      listener?.setVolume(volume);
    },

    setMuted(muted: boolean): void {
      currentMuted = muted;
      listener?.setMuted(muted);
    },

    onState(cb: (s: ListenerState) => void): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },

    getState: () => state,
    isJoined: () => listener !== null,
  };
}
