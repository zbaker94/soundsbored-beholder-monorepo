import '@fontsource-variable/figtree';
import { createListener, TokenFetchError } from '@soundsbored/core';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';
import { buildConfig, parseSavedConfig, parseSavedPrefs, resolveField } from './config.js';
import './style.css';

const STORAGE_KEY = 'soundsbored.listener.config';
const PREFS_KEY = 'soundsbored.listener.prefs';

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

function readSaved(): Partial<ListenerConfig> {
  try {
    return parseSavedConfig(localStorage.getItem(STORAGE_KEY));
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

function readPrefs(): ReturnType<typeof parseSavedPrefs> {
  try {
    return parseSavedPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return {};
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ volume: Number(els.volume.value), muted }),
    );
  } catch {
    /* storage unavailable — non-fatal */
  }
}

const defaults = window.__SOUNDSBORED__ ?? {};
const saved = readSaved();
const savedPrefs = readPrefs();

// Operator-locked fields are filled and their label hidden; the rest stay editable.
function applyField(input: HTMLInputElement, key: 'tokenEndpoint' | 'room'): void {
  const { value, locked } = resolveField(key, defaults, saved);
  input.value = value;
  if (locked) input.closest('label')?.setAttribute('hidden', '');
}

applyField(els.tokenEndpoint, 'tokenEndpoint');
applyField(els.room, 'room');
els.password.value = saved.password ?? '';

function readConfig(): ListenerConfig | null {
  return buildConfig(els.tokenEndpoint.value, els.room.value, els.password.value);
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

let muted = savedPrefs.muted ?? false;
function setMuted(next: boolean): void {
  muted = next;
  els.muteBtn.setAttribute('aria-pressed', String(muted));
  els.muteBtn.textContent = muted ? 'Muted' : 'Mute';
  listener?.setMuted(muted);
}

// --- listener wiring --------------------------------------------------------

let listener: Listener | null = null;

/** Map a failed connect() into a user-facing message. */
function connectErrorMessage(err: unknown): string {
  if (!(err instanceof TokenFetchError)) return 'Could not connect.';
  if (err.status === 401) return 'Wrong password.';
  return `Token endpoint error (${err.status ?? 'unreachable'}).`;
}

async function start(): Promise<void> {
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
  // Prime playback inside the click gesture: connect() is async, and the user
  // activation that unlocks autoplay can expire before the track arrives. Playing
  // now (even before there's a source) blesses the element so the real playback
  // after the track subscribes isn't blocked (NotAllowedError).
  void els.audio.play().catch(() => undefined);
  try {
    await listener.connect();
    await els.audio.play().catch(() => undefined);
  } catch (err) {
    showError(connectErrorMessage(err));
    await stop();
  }
}

async function stop(): Promise<void> {
  await listener?.disconnect();
  listener = null;
  setConnected(false);
}

els.enable.addEventListener('click', () => void start());
els.stop.addEventListener('click', () => void stop());
els.volume.addEventListener('input', () => {
  listener?.setVolume(Number(els.volume.value));
  savePrefs();
});
els.muteBtn.addEventListener('click', () => {
  setMuted(!muted);
  savePrefs();
});

// Restore saved playback prefs into the UI (start() reads these on connect).
els.volume.value = String(savedPrefs.volume ?? Number(els.volume.value));
setMuted(muted);
showState('disconnected');
