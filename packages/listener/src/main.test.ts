// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenFetchError } from '@soundsbored/core';

// Side-effect-only imports main.ts pulls in — stubbed so the DOM test never
// touches Vite's CSS/font pipeline.
vi.mock('@fontsource-variable/figtree', () => ({}));
vi.mock('./style.css', () => ({}));

// A controllable fake for the core listener, shared with the module mock below.
const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  attach: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  onState: vi.fn(),
  getState: vi.fn(() => 'disconnected'),
  onPresence: vi.fn(),
  getPresence: vi.fn(() => ({ broadcaster: false, listeners: 0, self: null, listenerIds: [] })),
  createListener: vi.fn(),
}));

vi.mock('@soundsbored/core', () => {
  class TokenFetchErrorMock extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = 'TokenFetchError';
      this.status = status;
    }
  }
  const buildListenerConfig = (fields: { tokenEndpoint: string; room: string; password: string }) => {
    const room = fields.room.trim();
    if (!room || !fields.password) return null;
    return { tokenEndpoint: fields.tokenEndpoint.trim(), room, password: fields.password };
  };
  return { createListener: mocks.createListener, TokenFetchError: TokenFetchErrorMock, buildListenerConfig };
});

const STORAGE_KEY = 'soundsbored.listener.config';

function renderDom(): void {
  document.body.innerHTML = `
    <main id="niche" data-state="disconnected"></main>
    <p id="status"></p>
    <p id="presence"></p>
    <ul id="party"></ul>
    <label><span>Token endpoint</span><input id="tokenEndpoint" type="url" /></label>
    <label><span>Room</span><input id="room" type="text" /></label>
    <label><span>Password</span><input id="password" type="password" /></label>
    <p id="error" hidden></p>
    <button id="enable" type="button">Start Listening</button>
    <button id="stop" type="button" hidden>Stop listening</button>
    <input id="volume" type="range" min="0" max="1" step="0.01" value="1" />
    <button id="muteBtn" type="button" aria-pressed="false">Mute</button>
    <audio id="audio"></audio>
  `;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Reset the module registry and re-run main.ts against the current DOM. */
async function loadMain(): Promise<void> {
  vi.resetModules();
  await import('./main.js');
}

beforeEach(() => {
  localStorage.clear();
  delete (window as unknown as { __SOUNDSBORED__?: unknown }).__SOUNDSBORED__;
  renderDom();
  // jsdom does not implement media playback; make play() a resolved no-op.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  Object.values(mocks).forEach((m) => m.mockClear());
  mocks.connect.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.createListener.mockReturnValue({
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    attach: mocks.attach,
    setVolume: mocks.setVolume,
    setMuted: mocks.setMuted,
    onState: mocks.onState,
    getState: mocks.getState,
    onPresence: mocks.onPresence,
    getPresence: mocks.getPresence,
  });
});

describe('presence', () => {
  /** Drive the onPresence callback main.ts registered, then let the DOM settle. */
  async function emitPresence(p: unknown): Promise<void> {
    await loadMain();
    $<HTMLInputElement>('room').value = 'the-session';
    $<HTMLInputElement>('password').value = 'pw';
    $<HTMLButtonElement>('enable').click();
    await tick();
    const cb = mocks.onPresence.mock.calls.at(-1)?.[0] as (p: unknown) => void;
    cb(p);
  }

  it('counts the party the same way it draws it — you included', async () => {
    // p.listeners counts everyone BUT you, while the party draws you too. The
    // tally must match the figures, or the UI contradicts itself.
    await emitPresence({
      broadcaster: true,
      listeners: 3,
      self: 'subscriber-me',
      listenerIds: ['a', 'b', 'c'],
    });

    expect($('party').children).toHaveLength(4);
    expect($('presence').textContent).toBe('broadcaster · 4 listening');
  });

  it('says nothing about an empty room', async () => {
    await emitPresence({ broadcaster: false, listeners: 0, self: null, listenerIds: [] });
    expect($('party').children).toHaveLength(0);
    expect($('presence').textContent).toBe('');
  });

  it('marks exactly one figure as you', async () => {
    await emitPresence({
      broadcaster: false,
      listeners: 2,
      self: 'subscriber-me',
      listenerIds: ['a', 'b'],
    });
    expect($('party').querySelectorAll('.adventurer.self')).toHaveLength(1);
  });
});

describe('listener DOM wiring', () => {
  it('shows an operator-set field read-only + marked, not hidden', async () => {
    (window as unknown as { __SOUNDSBORED__?: unknown }).__SOUNDSBORED__ = { room: 'locked-room' };
    await loadMain();

    const room = $<HTMLInputElement>('room');
    expect(room.value).toBe('locked-room');
    expect(room.readOnly).toBe(true);
    expect(room.closest('label')?.hasAttribute('data-locked')).toBe(true);
    expect(room.closest('label')?.hasAttribute('hidden')).toBe(false);
    // A field with no server default stays editable.
    const te = $<HTMLInputElement>('tokenEndpoint');
    expect(te.readOnly).toBe(false);
    expect(te.closest('label')?.hasAttribute('data-locked')).toBe(false);
  });

  it('prefills saved user config when no server default locks the field', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tokenEndpoint: 'https://relay', room: 'r', password: 'p' }),
    );
    await loadMain();

    expect($<HTMLInputElement>('tokenEndpoint').value).toBe('https://relay');
    expect($<HTMLInputElement>('room').value).toBe('r');
    expect($<HTMLInputElement>('password').value).toBe('p');
  });

  it('restores saved playback prefs (volume + mute) on load', async () => {
    localStorage.setItem('soundsbored.listener.prefs', JSON.stringify({ volume: 0.3, muted: true }));
    await loadMain();

    expect($<HTMLInputElement>('volume').value).toBe('0.3');
    const muteBtn = $<HTMLButtonElement>('muteBtn');
    expect(muteBtn.getAttribute('aria-pressed')).toBe('true');
    expect(muteBtn.textContent).toBe('Muted');
  });

  it('persists volume + mute changes to storage', async () => {
    await loadMain();
    const volume = $<HTMLInputElement>('volume');
    volume.value = '0.25';
    volume.dispatchEvent(new Event('input'));
    $<HTMLButtonElement>('muteBtn').click();

    expect(JSON.parse(localStorage.getItem('soundsbored.listener.prefs')!)).toEqual({
      volume: 0.25,
      muted: true,
    });
  });

  it('shows a validation error and does not connect when room/password are blank', async () => {
    await loadMain();
    $<HTMLButtonElement>('enable').click();
    await tick();

    expect($('error').textContent).toBe('Enter a room and password.');
    expect(mocks.createListener).not.toHaveBeenCalled();
  });

  it('connects and flips the UI to the connected state on a valid submit', async () => {
    await loadMain();
    $<HTMLInputElement>('room').value = 'the-session';
    $<HTMLInputElement>('password').value = 'pw';
    $<HTMLButtonElement>('enable').click();
    await tick();

    expect(mocks.createListener).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect($('enable').hidden).toBe(true);
    expect($('stop').hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({
      room: 'the-session',
      password: 'pw',
    });
  });

  it('maps a 401 TokenFetchError to "Wrong password." and tears down', async () => {
    mocks.connect.mockRejectedValueOnce(new TokenFetchError('bad password', 401));
    await loadMain();
    $<HTMLInputElement>('room').value = 'r';
    $<HTMLInputElement>('password').value = 'wrong';
    $<HTMLButtonElement>('enable').click();
    await tick();

    expect($('error').textContent).toBe('Wrong password.');
    expect(mocks.disconnect).toHaveBeenCalled();
    expect($('enable').hidden).toBe(false);
  });

  it('maps a non-401 TokenFetchError to a status-bearing message', async () => {
    mocks.connect.mockRejectedValueOnce(new TokenFetchError('boom', 503));
    await loadMain();
    $<HTMLInputElement>('room').value = 'r';
    $<HTMLInputElement>('password').value = 'pw';
    $<HTMLButtonElement>('enable').click();
    await tick();

    expect($('error').textContent).toBe('Token endpoint error (503).');
  });

  it('toggles mute state on the mute button', async () => {
    await loadMain();
    const btn = $<HTMLButtonElement>('muteBtn');
    btn.click();

    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('Muted');
  });
});
