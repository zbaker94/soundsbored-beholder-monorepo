import '@fontsource-variable/figtree';
import { createListener, TokenFetchError } from '@soundsbored/core';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';
import './style.css';

const STORAGE_KEY = 'soundsbored.listener.config';

declare global {
  interface Window {
    __SOUNDSBORED__?: Partial<ListenerConfig>;
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const els = {
  niche: $<HTMLElement>('niche'),
  tokenEndpoint: $<HTMLInputElement>('tokenEndpoint'),
  room: $<HTMLInputElement>('room'),
  password: $<HTMLInputElement>('password'),
  enable: $<HTMLButtonElement>('enable'),
  stop: $<HTMLButtonElement>('stop'),
  volume: $<HTMLInputElement>('volume'),
  muteBtn: $<HTMLButtonElement>('muteBtn'),
  status: $<HTMLParagraphElement>('status'),
  error: $<HTMLParagraphElement>('error'),
  audio: $<HTMLAudioElement>('audio'),
};

// --- config: server-injected defaults < saved user input --------------------

function loadSaved(): Partial<ListenerConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ListenerConfig>) : {};
  } catch {
    return {};
  }
}

function saveConfig(config: ListenerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

const defaults = window.__SOUNDSBORED__ ?? {};
const saved = loadSaved();
els.tokenEndpoint.value = saved.tokenEndpoint ?? defaults.tokenEndpoint ?? '';
els.room.value = saved.room ?? defaults.room ?? '';
els.password.value = saved.password ?? '';

function readConfig(): ListenerConfig | null {
  const tokenEndpoint = els.tokenEndpoint.value.trim();
  const room = els.room.value.trim();
  const password = els.password.value;
  // tokenEndpoint may be empty for a same-origin deploy (relative /token).
  if (!room || !password) return null;
  return { tokenEndpoint, room, password };
}

// --- ui ---------------------------------------------------------------------

function showState(state: ListenerState): void {
  els.niche.dataset.state = state;
  els.status.textContent = state;
}

function showError(message: string | null): void {
  els.error.hidden = message === null;
  els.error.textContent = message ?? '';
}

function setConnected(connected: boolean): void {
  els.enable.hidden = connected;
  els.stop.hidden = !connected;
  els.tokenEndpoint.disabled = connected;
  els.room.disabled = connected;
  els.password.disabled = connected;
}

let muted = false;
function setMuted(next: boolean): void {
  muted = next;
  els.muteBtn.setAttribute('aria-pressed', String(muted));
  els.muteBtn.textContent = muted ? 'Muted' : 'Mute';
  listener?.setMuted(muted);
}

// --- listener wiring --------------------------------------------------------

let listener: Listener | null = null;

async function enable(): Promise<void> {
  const config = readConfig();
  if (!config) {
    showError('Enter a room and password.');
    return;
  }
  showError(null);
  saveConfig(config);

  listener = createListener(config);
  listener.attach(els.audio);
  listener.setVolume(Number(els.volume.value));
  listener.setMuted(muted);
  listener.onState(showState);

  setConnected(true);
  try {
    await listener.connect();
    // playback is unlocked by this click gesture
    await els.audio.play().catch(() => undefined);
  } catch (err) {
    const message =
      err instanceof TokenFetchError
        ? err.status === 401
          ? 'Wrong password.'
          : `Token endpoint error (${err.status ?? 'unreachable'}).`
        : 'Could not connect.';
    showError(message);
    await stop();
  }
}

async function stop(): Promise<void> {
  await listener?.disconnect();
  listener = null;
  setConnected(false);
}

els.enable.addEventListener('click', () => void enable());
els.stop.addEventListener('click', () => void stop());
els.volume.addEventListener('input', () => listener?.setVolume(Number(els.volume.value)));
els.muteBtn.addEventListener('click', () => setMuted(!muted));

showState('disconnected');
