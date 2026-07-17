import '@fontsource-variable/figtree';
import { createListener, TokenFetchError } from '@soundsbored/core';
import type { Listener, ListenerConfig, ListenerState, Presence } from '@soundsbored/core';
import { buildConfig, parseSavedConfig, parseSavedPrefs, resolveField } from './config.js';
import { assignCast, fanLayout, type CastMember } from './cast.js';
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
  presence: $<HTMLParagraphElement>('presence'),
  party: $<HTMLUListElement>('party'),
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

// Operator-set fields (baked into the server at runtime) are shown read-only and
// marked "set by host" — informational, not editable. The rest stay editable.
function applyField(input: HTMLInputElement, key: 'tokenEndpoint' | 'room'): void {
  const { value, locked } = resolveField(key, defaults, saved);
  input.value = value;
  if (locked) {
    input.readOnly = true;
    input.closest('label')?.setAttribute('data-locked', '');
  }
}

applyField(els.tokenEndpoint, 'tokenEndpoint');
applyField(els.room, 'room');
els.password.value = saved.password ?? '';

function readConfig(): ListenerConfig | null {
  return buildConfig(els.tokenEndpoint.value, els.room.value, els.password.value);
}

// --- ui ---------------------------------------------------------------------

// --- the eye follows the mouse while live -----------------------------------

const pupil = document.querySelector<SVGElement>('.pupil');
const sclera = document.querySelector<SVGGraphicsElement>('.sclera');
// matchMedia is absent in some test envs — optional so module load never throws.
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

/** Move the pupil toward the cursor, clamped inside the iris (SVG user units). */
function followMouse(e: MouseEvent): void {
  if (!pupil || !sclera) return;
  const r = sclera.getBoundingClientRect();
  if (!r.width) return;
  const scale = 140 / r.width; // the sclera spans ~140 SVG units
  const dx = (e.clientX - (r.left + r.width / 2)) * scale;
  const dy = (e.clientY - (r.top + r.height / 2)) * scale;
  const cx = Math.max(-18, Math.min(18, dx));
  const cy = Math.max(-12, Math.min(12, dy));
  pupil.style.transform = `translate(${cx}px, ${cy}px)`;
}

/** Gather the party around the eye: one adventurer per client, you marked gilt. */
function showParty(cast: CastMember[]): void {
  const spots = fanLayout(cast.length);
  els.party.replaceChildren(
    ...cast.map((member, i) => {
      const li = document.createElement('li');
      li.className = member.isSelf ? 'adventurer self' : 'adventurer';
      li.style.setProperty('--sprite', String(member.sprite));
      li.style.setProperty('--x', spots[i].x.toFixed(2));
      li.style.setProperty('--y', spots[i].y.toFixed(2));
      li.style.setProperty('--fade-start', spots[i].fadeStart.toFixed(2));
      li.style.setProperty('--fade-end', spots[i].fadeEnd.toFixed(2));
      li.style.setProperty('--flip', spots[i].flip ? '-1' : '1');
      li.style.zIndex = String(spots[i].z);
      li.setAttribute('aria-label', member.isSelf ? 'you' : 'a fellow listener');
      return li;
    }),
  );
}

/** Show who else is in the room: the party around the eye, and a line of text. */
function showPresence(p: Presence): void {
  const cast = assignCast(p.self, p.listenerIds);
  showParty(cast);
  const parts: string[] = [];
  if (p.broadcaster) parts.push('broadcaster');
  // Counted off the cast, so the tally can never disagree with the figures.
  // p.listeners excludes you; the party does not, and you are listening too.
  if (cast.length) parts.push(`${cast.length} listening`);
  els.presence.textContent = parts.join(' · ');
}

function showState(state: ListenerState): void {
  els.niche.dataset.state = state;
  els.status.textContent = state;
  // Live: the pupil tracks the cursor. Any other state hands the pupil back to
  // its CSS animation (clear the inline transform so keyframes apply).
  if (state === 'live' && !reduceMotion?.matches) {
    window.addEventListener('mousemove', followMouse);
  } else {
    window.removeEventListener('mousemove', followMouse);
    if (pupil) pupil.style.transform = '';
  }
}

function showError(message: string | null): void {
  els.error.hidden = message === null;
  els.error.textContent = message ?? '';
}

/**
 * Dev only: `?party=5` fans a fake party of 5 around the eye, so the fan can be
 * looked at without standing up a relay and five browsers. Stripped from prod
 * builds — `import.meta.env.DEV` is false there and the block is dead code.
 *
 * The identities are freshly random each load, mirroring what the relay mints —
 * so reloading reshuffles the cast, exactly as reconnecting does.
 */
function previewParty(): void {
  if (!import.meta.env.DEV) return;
  const n = Number(new URLSearchParams(window.location.search).get('party'));
  if (!Number.isInteger(n) || n < 1) return;
  const fakeIdentity = (i: number): string =>
    `subscriber-preview-${i}-${Math.random().toString(36).slice(2, 10)}`;
  els.niche.dataset.state = 'live';
  els.status.textContent = 'live';
  showPresence({
    broadcaster: true,
    listeners: n - 1,
    self: fakeIdentity(1),
    listenerIds: Array.from({ length: n - 1 }, (_, i) => fakeIdentity(i + 2)),
  });
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
  listener.onPresence(showPresence);

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
previewParty();
