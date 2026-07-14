import { createListener } from '@soundsbored/core';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';

/** Player-facing audio surface: join/leave a room and control local playback.
 *  All subscribe/reconnect/volume behaviour is delegated to `@soundsbored/core`. */
export interface AudioController {
  /** Connect + attach + play (must be called from a user gesture to unlock audio). */
  join(): Promise<void>;
  /** Disconnect and tear down the audio element. */
  leave(): Promise<void>;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
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

  let volume = deps.initialVolume ?? 1;
  let muted = deps.initialMuted ?? false;
  let state: ListenerState = 'disconnected';

  let listener: Listener | null = null;
  let el: HTMLAudioElement | null = null;

  const stateListeners = new Set<(s: ListenerState) => void>();
  function setState(next: ListenerState): void {
    state = next;
    for (const cb of stateListeners) cb(next);
  }

  function teardown(): void {
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
      l.onState(setState);
      l.attach(audio);
      l.setVolume(volume);
      l.setMuted(muted);
      try {
        await l.connect();
      } catch (err) {
        await l.disconnect().catch(() => undefined);
        teardown();
        setState('disconnected');
        throw err;
      }
      // Unlock playback via the caller's gesture; ignore autoplay rejections.
      await audio.play().catch(() => undefined);
    },

    async leave(): Promise<void> {
      const l = listener;
      teardown();
      await l?.disconnect();
      setState('disconnected');
    },

    setVolume(v: number): void {
      volume = v;
      listener?.setVolume(v);
    },

    setMuted(m: boolean): void {
      muted = m;
      listener?.setMuted(m);
    },

    onState(cb: (s: ListenerState) => void): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },

    getState: () => state,
    isJoined: () => listener !== null,
  };
}
