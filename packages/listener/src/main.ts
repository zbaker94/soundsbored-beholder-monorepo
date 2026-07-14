import { createListener, TokenFetchError } from '@soundsbored/core';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';
import './style.css';

const STORAGE_KEY = 'soundsbored.listener.config';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const els = {
  tokenEndpoint: $<HTMLInputElement>('tokenEndpoint'),
  room: $<HTMLInputElement>('room'),
  password: $<HTMLInputElement>('password'),
  enable: $<HTMLButtonElement>('enable'),
  stop: $<HTMLButtonElement>('stop'),
  volume: $<HTMLInputElement>('volume'),
  muted: $<HTMLInputElement>('muted'),
  state: $<HTMLSpanElement>('state'),
  error: $<HTMLParagraphElement>('error'),
  audio: $<HTMLAudioElement>('audio'),
};

// --- config persistence -----------------------------------------------------

function loadConfig(): Partial<ListenerConfig> {
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

const saved = loadConfig();
els.tokenEndpoint.value = saved.tokenEndpoint ?? '';
els.room.value = saved.room ?? '';
els.password.value = saved.password ?? '';

function readConfig(): ListenerConfig | null {
  const tokenEndpoint = els.tokenEndpoint.value.trim();
  const room = els.room.value.trim();
  const password = els.password.value;
  if (!tokenEndpoint || !room || !password) return null;
  return { tokenEndpoint, room, password };
}

// --- ui state ---------------------------------------------------------------

function showState(state: ListenerState): void {
  els.state.textContent = state;
  els.state.className = `pill pill--${state}`;
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

// --- listener wiring --------------------------------------------------------

let listener: Listener | null = null;

async function enable(): Promise<void> {
  const config = readConfig();
  if (!config) {
    showError('Fill in token endpoint, room, and password.');
    return;
  }
  showError(null);
  saveConfig(config);

  listener = createListener(config);
  listener.attach(els.audio);
  listener.setVolume(Number(els.volume.value));
  listener.setMuted(els.muted.checked);
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
          ? 'Bad password.'
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
els.muted.addEventListener('change', () => listener?.setMuted(els.muted.checked));

showState('disconnected');
