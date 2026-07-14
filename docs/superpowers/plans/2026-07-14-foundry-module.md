# Foundry VTT Module (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/foundry` — a thin Foundry VTT module that lets table players hear the GM's live SoundsBored mix (own volume/mute, resilient to drops) by reusing `@soundsbored/core`, plus the CI that releases it.

**Architecture:** A Vite library build bundles `@soundsbored/core` + `livekit-client` into one browser ESM that Foundry loads via `module.json`. Pure, unit-tested logic (`settings.ts` config resolution, `controller.ts` core wrapper) is isolated from thin, untested Foundry glue (`panel.ts` ApplicationV2 UI, `module.ts` lifecycle wiring). The module reimplements nothing of subscribe/play/volume/reconnect — that all lives in core.

**Tech Stack:** TypeScript (strict, ESM), Vite (library mode), Vitest, `@soundsbored/core`, `livekit-client`, Foundry VTT v13 client API (ApplicationV2, scene controls, settings), GitHub Actions.

## Global Constraints

- TS strict, ESM, single quotes, Node ≥20. Match monorepo conventions.
- Workspace deps use `"*"` (not `workspace:*`).
- `console` is allowed here (consumer surface, not the embedded `core` lib), but prefer `ui.notifications` for user-facing messages.
- Foundry target: **v13+ only** — `compatibility.minimum: "13"`. Scene controls use the v13 **keyed-object** `getSceneControlButtons` shape; UI uses `ApplicationV2`.
- Module id (fixed everywhere): **`soundsbored-audio`**.
- No new contract: module is a pure **C6** consumer + inherits **C7** from core. If a change to C1–C7 becomes necessary, STOP and update `CONTRACT.md` + the master plan in lockstep first.
- `password` is intentionally a **world** setting (readable by all clients) — the shared room password (C4/C6), listen-only (C3). Do not attempt to hide it from players.
- Verify any livekit-client / Foundry API against current docs (context7) before use — don't guess.

---

### Task 1: Scaffold package + `settings.ts` (config resolution)

Creates the workspace package and its one piece of pure, testable configuration logic: turning Foundry settings into a `ListenerConfig`.

**Files:**
- Create: `packages/foundry/package.json`
- Create: `packages/foundry/tsconfig.json`
- Create: `packages/foundry/src/settings.ts`
- Create: `packages/foundry/src/settings.test.ts`
- Modify: `vitest.config.ts` (root — add `@soundsbored/core` → src alias so foundry tests resolve core from source)

**Interfaces:**
- Consumes: `ListenerConfig` from `@soundsbored/core` (`{ tokenEndpoint: string; room: string; password: string }`).
- Produces:
  - `MODULE_ID = 'soundsbored-audio'` (const string)
  - `SETTINGS` — `{ tokenEndpoint, room, password, volume, muted }` (const record of setting-key strings)
  - `type SettingsGetter = (key: string) => unknown`
  - `resolveConfig(get: SettingsGetter): ListenerConfig | null`

- [ ] **Step 1: Create `packages/foundry/package.json`**

```json
{
  "name": "@soundsbored/foundry",
  "version": "0.0.1",
  "description": "Foundry VTT module for SoundsBored remote audio (thin shell over @soundsbored/core)",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite build --watch",
    "build": "tsc --noEmit && vite build && node scripts/assemble.mjs",
    "test": "vitest run --reporter=verbose",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@soundsbored/contract": "*",
    "@soundsbored/core": "*",
    "livekit-client": "^2.5.0"
  },
  "devDependencies": {
    "jsdom": "^29.1.1",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/foundry/tsconfig.json`** (mirrors `packages/listener/tsconfig.json` — Vite-built, typecheck-only)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "vite.config.ts", "scripts"]
}
```

- [ ] **Step 3: Add the core→src alias to the root `vitest.config.ts`**

Modify `vitest.config.ts` so the `alias` block reads (add the `@soundsbored/core` line; keep the existing contract line):

```ts
    alias: {
      '@soundsbored/core': path.resolve(
        import.meta.dirname,
        'packages/core/src/index.ts',
      ),
      '@soundsbored/contract': path.resolve(
        import.meta.dirname,
        'packages/contract/src/index.ts',
      ),
    },
```

- [ ] **Step 4: Install workspaces** (links the new package)

Run: `npm install`
Expected: completes; `node_modules/@soundsbored/foundry` symlink exists.

- [ ] **Step 5: Write the failing test — `packages/foundry/src/settings.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { resolveConfig, SETTINGS, MODULE_ID, type SettingsGetter } from './settings.js';

// Build a getter over a plain record of setting values.
const getter = (values: Record<string, unknown>): SettingsGetter => (key) => values[key];

describe('MODULE_ID', () => {
  it('is the fixed module id', () => {
    expect(MODULE_ID).toBe('soundsbored-audio');
  });
});

describe('resolveConfig', () => {
  it('returns a config when room + password are present', () => {
    const get = getter({
      [SETTINGS.tokenEndpoint]: 'https://relay.example',
      [SETTINGS.room]: 'world1',
      [SETTINGS.password]: 'pw',
    });
    expect(resolveConfig(get)).toEqual({
      tokenEndpoint: 'https://relay.example',
      room: 'world1',
      password: 'pw',
    });
  });

  it('trims tokenEndpoint and room', () => {
    const get = getter({
      [SETTINGS.tokenEndpoint]: '  https://relay.example  ',
      [SETTINGS.room]: '  world1  ',
      [SETTINGS.password]: 'pw',
    });
    expect(resolveConfig(get)).toEqual({
      tokenEndpoint: 'https://relay.example',
      room: 'world1',
      password: 'pw',
    });
  });

  it('allows an empty tokenEndpoint (same-origin relay)', () => {
    const get = getter({
      [SETTINGS.tokenEndpoint]: '',
      [SETTINGS.room]: 'world1',
      [SETTINGS.password]: 'pw',
    });
    expect(resolveConfig(get)).toEqual({ tokenEndpoint: '', room: 'world1', password: 'pw' });
  });

  it('returns null when room is blank', () => {
    const get = getter({ [SETTINGS.room]: '   ', [SETTINGS.password]: 'pw' });
    expect(resolveConfig(get)).toBeNull();
  });

  it('returns null when password is blank', () => {
    const get = getter({ [SETTINGS.room]: 'world1', [SETTINGS.password]: '' });
    expect(resolveConfig(get)).toBeNull();
  });

  it('returns null when settings are undefined', () => {
    const get = getter({});
    expect(resolveConfig(get)).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -w @soundsbored/foundry`
Expected: FAIL — cannot resolve `./settings.js` / `resolveConfig` not defined.

- [ ] **Step 7: Write minimal implementation — `packages/foundry/src/settings.ts`**

```ts
import type { ListenerConfig } from '@soundsbored/core';

/** Foundry module id — used as the settings namespace and module path. */
export const MODULE_ID = 'soundsbored-audio';

/** Setting keys registered under {@link MODULE_ID}. World-scope config (C6) plus
 *  per-client playback prefs. */
export const SETTINGS = {
  tokenEndpoint: 'tokenEndpoint',
  room: 'room',
  password: 'password',
  volume: 'volume',
  muted: 'muted',
} as const;

/** Reads a registered setting value. Wraps `game.settings.get(MODULE_ID, key)`
 *  in production; a plain record in tests — keeps this module Foundry-free. */
export type SettingsGetter = (key: string) => unknown;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Resolve the three C6 world settings into a {@link ListenerConfig}, or null if
 * the config is incomplete. Mirrors the listener's `buildConfig`: `room` and
 * `password` are required (non-blank); `tokenEndpoint` may be empty for a
 * same-origin relay and is otherwise trimmed.
 */
export function resolveConfig(get: SettingsGetter): ListenerConfig | null {
  const tokenEndpoint = asString(get(SETTINGS.tokenEndpoint)).trim();
  const room = asString(get(SETTINGS.room)).trim();
  const password = asString(get(SETTINGS.password));
  if (!room || !password) return null;
  return { tokenEndpoint, room, password };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -w @soundsbored/foundry`
Expected: PASS (all `resolveConfig` + `MODULE_ID` cases).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck -w @soundsbored/foundry`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/foundry/package.json packages/foundry/tsconfig.json packages/foundry/src/settings.ts packages/foundry/src/settings.test.ts vitest.config.ts package-lock.json
git commit -m "feat(foundry): scaffold package + config resolution from settings"
```

---

### Task 2: `controller.ts` (core wrapper)

The one behavioural unit: wraps `createListener`, owns a hidden `<audio>` element, and exposes join/leave/volume/mute/state. Foundry-free and fully unit-tested by injecting a fake `createListener`.

**Files:**
- Create: `packages/foundry/src/controller.ts`
- Create: `packages/foundry/src/controller.test.ts`

**Interfaces:**
- Consumes: `createListener`, `type Listener`, `type ListenerConfig`, `type ListenerState` from `@soundsbored/core`.
- Produces:
  - `interface AudioController { join(): Promise<void>; leave(): Promise<void>; setVolume(v: number): void; setMuted(m: boolean): void; onState(cb: (s: ListenerState) => void): () => void; getState(): ListenerState; isJoined(): boolean; }`
  - `interface AudioControllerDeps { config: ListenerConfig; initialVolume?: number; initialMuted?: boolean; createListenerImpl?: typeof createListener; createAudioEl?: () => HTMLAudioElement; }`
  - `function createAudioController(deps: AudioControllerDeps): AudioController`

- [ ] **Step 1: Write the failing test — `packages/foundry/src/controller.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Importing core (aliased to src) pulls in livekit-client; mock it so nothing
// real loads. The controller injects a fake listener, so only the module-load
// import needs stubbing (mirrors packages/core's own tests).
vi.mock('livekit-client', () => ({
  RoomEvent: {},
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
  Room: class {},
}));

import { createAudioController } from './controller.js';
import type { Listener, ListenerConfig, ListenerState } from '@soundsbored/core';

const config: ListenerConfig = { tokenEndpoint: 'https://relay.example', room: 'world1', password: 'pw' };

function makeFakeListener() {
  let stateCb: ((s: ListenerState) => void) | undefined;
  const listener = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    attach: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    onState: vi.fn((cb: (s: ListenerState) => void) => {
      stateCb = cb;
      return () => { stateCb = undefined; };
    }),
    getState: vi.fn((): ListenerState => 'disconnected'),
  } satisfies Listener & Record<string, unknown>;
  return { listener, emitState: (s: ListenerState) => stateCb?.(s) };
}

function makeFakeAudio() {
  return { play: vi.fn(async () => {}), remove: vi.fn(), volume: 1, muted: false } as unknown as HTMLAudioElement;
}

describe('createAudioController', () => {
  let fake: ReturnType<typeof makeFakeListener>;
  let audio: HTMLAudioElement;
  let createListenerImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fake = makeFakeListener();
    audio = makeFakeAudio();
    createListenerImpl = vi.fn(() => fake.listener);
  });

  const build = (over: Partial<Parameters<typeof createAudioController>[0]> = {}) =>
    createAudioController({
      config,
      createListenerImpl: createListenerImpl as unknown as typeof import('@soundsbored/core').createListener,
      createAudioEl: () => audio,
      ...over,
    });

  it('join() connects, attaches audio, applies volume/mute, then plays', async () => {
    const c = build({ initialVolume: 0.5, initialMuted: true });
    await c.join();
    expect(createListenerImpl).toHaveBeenCalledWith(config);
    expect(fake.listener.attach).toHaveBeenCalledWith(audio);
    expect(fake.listener.setVolume).toHaveBeenCalledWith(0.5);
    expect(fake.listener.setMuted).toHaveBeenCalledWith(true);
    expect(fake.listener.connect).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(c.isJoined()).toBe(true);
  });

  it('leave() disconnects and removes the audio element', async () => {
    const c = build();
    await c.join();
    await c.leave();
    expect(fake.listener.disconnect).toHaveBeenCalledOnce();
    expect(audio.remove).toHaveBeenCalledOnce();
    expect(c.isJoined()).toBe(false);
  });

  it('a failed connect cleans up and rethrows', async () => {
    fake.listener.connect.mockRejectedValueOnce(new Error('boom'));
    const c = build();
    await expect(c.join()).rejects.toThrow('boom');
    expect(fake.listener.disconnect).toHaveBeenCalledOnce();
    expect(audio.remove).toHaveBeenCalledOnce();
    expect(c.isJoined()).toBe(false);
  });

  it('setVolume forwards to the listener when joined', async () => {
    const c = build();
    await c.join();
    c.setVolume(0.25);
    expect(fake.listener.setVolume).toHaveBeenLastCalledWith(0.25);
  });

  it('setMuted forwards to the listener when joined', async () => {
    const c = build();
    await c.join();
    c.setMuted(true);
    expect(fake.listener.setMuted).toHaveBeenLastCalledWith(true);
  });

  it('surfaces core state changes to onState subscribers', async () => {
    const seen: ListenerState[] = [];
    const c = build();
    c.onState((s) => seen.push(s));
    await c.join();
    fake.emitState('live');
    fake.emitState('reconnecting');
    expect(seen).toEqual(['live', 'reconnecting']);
  });

  it('setVolume before join remembers the value for the next join', async () => {
    const c = build();
    c.setVolume(0.4);
    await c.join();
    expect(fake.listener.setVolume).toHaveBeenCalledWith(0.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @soundsbored/foundry`
Expected: FAIL — `./controller.js` / `createAudioController` not defined.

- [ ] **Step 3: Write minimal implementation — `packages/foundry/src/controller.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @soundsbored/foundry`
Expected: PASS (all controller + settings cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @soundsbored/foundry`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/foundry/src/controller.ts packages/foundry/src/controller.test.ts
git commit -m "feat(foundry): audio controller wrapping listener-core"
```

---

### Task 3: Foundry type shim + `panel.ts` (ApplicationV2 UI)

Thin, untested glue: the player-facing panel. A minimal ambient type shim lets it typecheck without pulling a large Foundry-types dependency. Verified against Foundry v13 ApplicationV2 docs; the live install (Task 7) is the real check.

**Files:**
- Create: `packages/foundry/src/foundry-env.d.ts`
- Create: `packages/foundry/src/panel.ts`
- Create: `packages/foundry/templates/panel.hbs`

**Interfaces:**
- Consumes: `createAudioController`, `AudioController` (Task 2); `resolveConfig`, `SETTINGS`, `MODULE_ID` (Task 1); `type ListenerState` from `@soundsbored/core`; the ambient `game`, `foundry`, `ui` globals from the shim.
- Produces:
  - `class SoundsBoredPanel` (extends the v13 `ApplicationV2` + `HandlebarsApplicationMixin`)
  - `function openPanel(): void` — instantiate + render the singleton panel.

- [ ] **Step 1: Create the type shim — `packages/foundry/src/foundry-env.d.ts`**

Loosely typed on purpose: covers only the members the glue uses. `ApplicationV2` is typed permissively because subclassing the full class is out of scope for a thin shell.

```ts
// Minimal ambient declarations for the Foundry v13 client globals this module
// uses. Not exhaustive — just enough for `tsc --noEmit` to pass on the glue.
export {};

declare global {
  const game: {
    settings: {
      register(namespace: string, key: string, data: Record<string, unknown>): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    user?: { isGM: boolean };
    i18n?: { localize(key: string): string };
  };

  const ui: {
    notifications?: {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
    };
  };

  const Hooks: {
    once(hook: string, fn: (...args: any[]) => void): number;
    on(hook: string, fn: (...args: any[]) => void): number;
  };

  // ApplicationV2 lives under the `foundry.applications.api` namespace in v13.
  // Typed loosely: the base class and mixin are treated as `any`-ish so a thin
  // subclass compiles without vendoring the full type surface.
  const foundry: {
    applications: {
      api: {
        ApplicationV2: FoundryApplicationV2Ctor;
        HandlebarsApplicationMixin: <T extends FoundryApplicationV2Ctor>(base: T) => T;
      };
    };
  };

  interface FoundryApplicationV2Instance {
    render(force?: boolean): Promise<unknown> | unknown;
    close(): Promise<unknown> | unknown;
    readonly element: HTMLElement;
  }
  interface FoundryApplicationV2Ctor {
    new (...args: any[]): FoundryApplicationV2Instance;
    DEFAULT_OPTIONS: Record<string, any>;
    PARTS: Record<string, any>;
  }
}
```

- [ ] **Step 2: Create the template — `packages/foundry/templates/panel.hbs`**

```hbs
<section class="soundsbored-panel">
  {{#if configured}}
    <p class="soundsbored-status" data-state="{{state}}">{{stateLabel}}</p>
    <div class="soundsbored-controls">
      {{#if joined}}
        <button type="button" data-action="leave">Leave audio</button>
      {{else}}
        <button type="button" data-action="join">Join audio</button>
      {{/if}}
      <label class="soundsbored-volume">
        Volume
        <input type="range" name="volume" min="0" max="1" step="0.01" value="{{volume}}" />
      </label>
      <label class="soundsbored-mute">
        <input type="checkbox" name="muted" {{#if muted}}checked{{/if}} /> Mute
      </label>
    </div>
  {{else}}
    <p class="soundsbored-unconfigured">
      {{#if isGM}}
        SoundsBored audio isn't configured yet. Open the module settings and set the token endpoint, room, and password.
      {{else}}
        The GM hasn't configured SoundsBored audio yet.
      {{/if}}
    </p>
  {{/if}}
</section>
```

- [ ] **Step 3: Write the panel — `packages/foundry/src/panel.ts`**

```ts
import type { ListenerState } from '@soundsbored/core';
import { createAudioController, type AudioController } from './controller.js';
import { MODULE_ID, SETTINGS, resolveConfig } from './settings.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STATE_LABELS: Record<ListenerState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

/** Reads a module setting. */
const get = (key: string): unknown => game.settings.get(MODULE_ID, key);

/** Player-facing control panel: status, Join/Leave, volume, mute. Thin — all
 *  behaviour lives in the injected {@link AudioController} / core. */
export class SoundsBoredPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'soundsbored-panel',
    tag: 'div',
    window: { title: 'SoundsBored Audio', icon: 'fa-solid fa-headphones' },
    position: { width: 320, height: 'auto' as const },
    actions: {
      join: SoundsBoredPanel.#onJoin,
      leave: SoundsBoredPanel.#onLeave,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/panel.hbs` },
  };

  #controller: AudioController | null = null;
  #unsub: (() => void) | null = null;

  /** Build (once) a controller from current settings, or null if unconfigured. */
  #ensureController(): AudioController | null {
    if (this.#controller) return this.#controller;
    const config = resolveConfig(get);
    if (!config) return null;
    const c = createAudioController({
      config,
      initialVolume: Number(get(SETTINGS.volume) ?? 1),
      initialMuted: Boolean(get(SETTINGS.muted) ?? false),
    });
    this.#unsub = c.onState(() => void this.render(false));
    this.#controller = c;
    return c;
  }

  // Rendering context consumed by panel.hbs.
  _prepareContext(): Record<string, unknown> {
    const config = resolveConfig(get);
    const state = (this.#controller?.getState() ?? 'disconnected') as ListenerState;
    return {
      configured: config !== null,
      isGM: game.user?.isGM ?? false,
      joined: this.#controller?.isJoined() ?? false,
      state,
      stateLabel: STATE_LABELS[state],
      volume: Number(get(SETTINGS.volume) ?? 1),
      muted: Boolean(get(SETTINGS.muted) ?? false),
    };
  }

  // Wire the range + checkbox inputs after each render (buttons use data-action).
  _onRender(): void {
    const root = this.element;
    root.querySelector<HTMLInputElement>('input[name="volume"]')?.addEventListener('input', (ev) => {
      const v = Number((ev.currentTarget as HTMLInputElement).value);
      this.#controller?.setVolume(v);
      void game.settings.set(MODULE_ID, SETTINGS.volume, v);
    });
    root.querySelector<HTMLInputElement>('input[name="muted"]')?.addEventListener('change', (ev) => {
      const m = (ev.currentTarget as HTMLInputElement).checked;
      this.#controller?.setMuted(m);
      void game.settings.set(MODULE_ID, SETTINGS.muted, m);
    });
  }

  static async #onJoin(this: SoundsBoredPanel): Promise<void> {
    const c = this.#ensureController();
    if (!c) return;
    try {
      await c.join();
    } catch {
      ui.notifications?.error('SoundsBored: could not connect. Check the password and endpoint.');
    }
    void this.render(false);
  }

  static async #onLeave(this: SoundsBoredPanel): Promise<void> {
    await this.#controller?.leave();
    this.#unsub?.();
    this.#unsub = null;
    this.#controller = null;
    void this.render(false);
  }
}

let panel: SoundsBoredPanel | null = null;

/** Open (or focus) the singleton panel. */
export function openPanel(): void {
  panel ??= new SoundsBoredPanel();
  void panel.render(true);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @soundsbored/foundry`
Expected: no errors.

> Note: `#onJoin`/`#onLeave` are declared `static` with a bound `this` because v13 ApplicationV2 invokes action handlers with the application instance as `this`. This is the documented pattern (context7: ApplicationV2 `actions`). If a live install shows the handler isn't bound as expected, switch to instance arrow-function actions — verify against the running Foundry, don't guess.

- [ ] **Step 5: Run existing tests (no regressions)**

Run: `npm test -w @soundsbored/foundry`
Expected: PASS (settings + controller unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/foundry/src/foundry-env.d.ts packages/foundry/src/panel.ts packages/foundry/templates/panel.hbs
git commit -m "feat(foundry): player audio panel (ApplicationV2)"
```

---

### Task 4: `module.ts` (lifecycle entry) + `styles`

The bundle entry point: register settings on `init`, add the scene-control tool (v13 keyed shape) that opens the panel, and a `ready` hook. Untested glue.

**Files:**
- Create: `packages/foundry/src/module.ts`
- Create: `packages/foundry/styles/soundsbored.css`

**Interfaces:**
- Consumes: `MODULE_ID`, `SETTINGS` (Task 1); `openPanel` (Task 3); ambient `game`, `Hooks` globals.
- Produces: side effects only (registers hooks at import time). This file is the Vite library entry.

- [ ] **Step 1: Write the entry — `packages/foundry/src/module.ts`**

```ts
import { MODULE_ID, SETTINGS } from './settings.js';
import { openPanel } from './panel.js';

/** Register the five module settings. World-scope trio is GM-editable + readable
 *  by all clients (C6); volume/mute are per-client playback prefs. */
function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.tokenEndpoint, {
    name: 'Token endpoint',
    hint: 'URL of the SoundsBored relay token endpoint (e.g. your Railway relay). Leave blank for a same-origin relay.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
  game.settings.register(MODULE_ID, SETTINGS.room, {
    name: 'Room',
    hint: 'Must match the room the SoundsBored app publishes to.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
  game.settings.register(MODULE_ID, SETTINGS.password, {
    name: 'Room password',
    hint: 'Shared listen-only password set on the relay. Distributed to players.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
  game.settings.register(MODULE_ID, SETTINGS.volume, {
    scope: 'client',
    config: false,
    type: Number,
    default: 1,
  });
  game.settings.register(MODULE_ID, SETTINGS.muted, {
    scope: 'client',
    config: false,
    type: Boolean,
    default: false,
  });
}

Hooks.once('init', () => {
  registerSettings();
});

// v13: getSceneControlButtons receives an object keyed by control name.
Hooks.on('getSceneControlButtons', (controls: Record<string, any>) => {
  controls[MODULE_ID] = {
    name: MODULE_ID,
    title: 'SoundsBored Audio',
    icon: 'fa-solid fa-headphones',
    // A non-tool control button that just opens the panel for everyone.
    tools: {
      panel: {
        name: 'panel',
        title: 'Open SoundsBored audio',
        icon: 'fa-solid fa-headphones',
        button: true,
        onClick: () => openPanel(),
      },
    },
    activeTool: 'panel',
  };
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | ready`);
});
```

> Verify the exact v13 scene-control object shape (control keys `tools`/`activeTool`/`order`, tool `button`/`onClick` vs `onChange`) against context7 / the running Foundry before finalizing — the API note (context7) confirms keyed-object + `button`→`onClick(): void`, but confirm field names on a live v13 install during Task 7.

- [ ] **Step 2: Write panel styles — `packages/foundry/styles/soundsbored.css`**

```css
.soundsbored-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
}
.soundsbored-status {
  margin: 0;
  font-weight: bold;
}
.soundsbored-status[data-state='live'] { color: var(--color-level-success, #2e7d32); }
.soundsbored-status[data-state='reconnecting'] { color: var(--color-level-warning, #b26a00); }
.soundsbored-status[data-state='disconnected'] { color: var(--color-level-error, #a11); }
.soundsbored-controls {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.soundsbored-volume { display: flex; flex-direction: column; gap: 0.25rem; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @soundsbored/foundry`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/foundry/src/module.ts packages/foundry/styles/soundsbored.css
git commit -m "feat(foundry): lifecycle entry + scene control + settings registration"
```

---

### Task 5: Vite library build + `module.json` + assemble script

Bundle the module into one ESM and assemble the exact tree Foundry installs.

**Files:**
- Create: `packages/foundry/vite.config.ts`
- Create: `packages/foundry/module.json`
- Create: `packages/foundry/lang/en.json`
- Create: `packages/foundry/scripts/assemble.mjs`
- Create: `packages/foundry/.gitignore`

**Interfaces:**
- Consumes: `src/module.ts` (Task 4) as the Vite entry.
- Produces: `dist/scripts/soundsbored-foundry.js` + assembled `dist/{module.json,lang,styles,templates}` (the installable module root).

- [ ] **Step 1: Create `packages/foundry/vite.config.ts`** (library mode; bundles core + livekit)

```ts
import { defineConfig } from 'vite';
import path from 'node:path';

// Bundle the workspace libs from source (like the listener) and livekit-client
// into a single browser ESM that Foundry loads via module.json `esmodules`.
export default defineConfig({
  resolve: {
    alias: {
      '@soundsbored/core': path.resolve(import.meta.dirname, '../core/src/index.ts'),
      '@soundsbored/contract': path.resolve(import.meta.dirname, '../contract/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/module.ts'),
      formats: ['es'],
      fileName: () => 'scripts/soundsbored-foundry.js',
    },
    rollupOptions: {
      // Foundry provides no bare modules at runtime — bundle everything.
      external: [],
    },
  },
});
```

- [ ] **Step 2: Create `packages/foundry/module.json`**

```json
{
  "id": "soundsbored-audio",
  "title": "SoundsBored Remote Audio",
  "description": "Hear a GM's live SoundsBored master mix in Foundry, with per-player volume and automatic reconnect.",
  "version": "0.0.1",
  "compatibility": {
    "minimum": "13",
    "verified": "13"
  },
  "authors": [{ "name": "zbaker94" }],
  "esmodules": ["scripts/soundsbored-foundry.js"],
  "styles": ["styles/soundsbored.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "manifest": "https://github.com/zbaker94/soundsbored-remote-audio/releases/latest/download/module.json",
  "download": "https://github.com/zbaker94/soundsbored-remote-audio/releases/download/foundry-v0.0.1/module.zip"
}
```

- [ ] **Step 3: Create `packages/foundry/lang/en.json`**

```json
{
  "SOUNDSBORED.Title": "SoundsBored Audio"
}
```

- [ ] **Step 4: Create `packages/foundry/scripts/assemble.mjs`** (copy assets into `dist/` next to the bundle)

```js
// Copy the static module assets alongside the Vite-built bundle so `dist/` is the
// exact tree Foundry installs: module.json + scripts/ + styles/ + lang/ + templates/.
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const dist = path.join(root, 'dist');

await mkdir(dist, { recursive: true });
await cp(path.join(root, 'module.json'), path.join(dist, 'module.json'));
await cp(path.join(root, 'styles'), path.join(dist, 'styles'), { recursive: true });
await cp(path.join(root, 'lang'), path.join(dist, 'lang'), { recursive: true });
await cp(path.join(root, 'templates'), path.join(dist, 'templates'), { recursive: true });

console.log('assembled dist/ (module.json + scripts + styles + lang + templates)');
```

- [ ] **Step 5: Create `packages/foundry/.gitignore`**

```gitignore
dist/
module.zip
```

- [ ] **Step 6: Build and verify the assembled tree**

Run: `npm run build -w @soundsbored/foundry`
Expected: `tsc --noEmit` passes, Vite emits `dist/scripts/soundsbored-foundry.js`, assemble logs its line.

- [ ] **Step 7: Verify the installable tree exists**

Run: `ls packages/foundry/dist packages/foundry/dist/scripts`
Expected: `dist/` contains `module.json`, `scripts/`, `styles/`, `lang/`, `templates/`; `dist/scripts/` contains `soundsbored-foundry.js`.

- [ ] **Step 8: Commit**

```bash
git add packages/foundry/vite.config.ts packages/foundry/module.json packages/foundry/lang packages/foundry/scripts packages/foundry/.gitignore
git commit -m "feat(foundry): vite library build + module manifest + asset assembly"
```

---

### Task 6: CI release workflow

GitHub Actions builds the module on a `foundry-v*` tag and publishes `module.json` + `module.zip` to a GitHub Release, so the static manifest URL always tracks the latest release.

**Files:**
- Create: `.github/workflows/foundry-release.yml`

**Interfaces:**
- Consumes: `npm run build -w @soundsbored/foundry` (Task 5) producing `packages/foundry/dist/`.
- Produces: a GitHub Release with `module.json` + `module.zip` assets.

- [ ] **Step 1: Create `.github/workflows/foundry-release.yml`**

```yaml
name: Foundry module release

on:
  push:
    tags:
      - 'foundry-v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - run: npm ci

      - name: Build module
        run: npm run build -w @soundsbored/foundry

      - name: Stamp version + download URL from the tag
        working-directory: packages/foundry/dist
        run: |
          VERSION="${GITHUB_REF_NAME#foundry-v}"
          REPO="${GITHUB_REPOSITORY}"
          DOWNLOAD="https://github.com/${REPO}/releases/download/${GITHUB_REF_NAME}/module.zip"
          jq --arg v "$VERSION" --arg d "$DOWNLOAD" \
            '.version=$v | .download=$d' module.json > module.json.tmp
          mv module.json.tmp module.json

      - name: Zip module
        working-directory: packages/foundry/dist
        run: zip -r ../module.zip .

      - name: Publish release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            packages/foundry/dist/module.json
            packages/foundry/module.zip
```

- [ ] **Step 2: Lint the workflow YAML locally**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/foundry-release.yml','utf8'); if(!y.includes('foundry-v')) throw new Error('tag filter missing'); console.log('workflow present')"`
Expected: prints `workflow present` (a smoke check; the real validation is a tagged run during release).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/foundry-release.yml
git commit -m "ci(foundry): release module.zip + manifest on foundry-v* tags"
```

---

### Task 7: Package README + repo wiring + M4 gate verification

Document install/config and verify the gate on a live Foundry instance.

**Files:**
- Create: `packages/foundry/README.md`
- Modify: `README.md` (root — add the foundry package to the packages list)

**Interfaces:**
- Consumes: everything above.
- Produces: docs + a passed M4 gate.

- [ ] **Step 1: Create `packages/foundry/README.md`**

```markdown
# @soundsbored/foundry

Foundry VTT module — hear a GM's live SoundsBored master mix in Foundry, with
per-player volume and automatic reconnect. A thin shell over
[`@soundsbored/core`](../core); it reimplements no audio logic.

## Install (Foundry v13+)

In Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/zbaker94/soundsbored-remote-audio/releases/latest/download/module.json
```

## Configure (GM)

Enable the module, then in **Game Settings → Configure Settings → SoundsBored
Remote Audio** set:

- **Token endpoint** — your relay URL (e.g. the Railway relay), or blank for a
  same-origin relay.
- **Room** — must match the room the SoundsBored app publishes to.
- **Room password** — the shared listen-only password set on the relay.

These are world settings (GM-only to edit). The password is readable by players'
clients by design — it is the shared room password (listen-only) they need to
fetch a token.

## Listen (any player)

Click the **headphones** scene control to open the audio panel, then **Join
audio** (a click is required to unlock browser audio). Adjust your own volume /
mute; both persist per client. The status line shows the live connection state
and rides reconnects automatically.

## Develop

```bash
npm run build -w @soundsbored/foundry   # bundle + assemble dist/
npm test -w @soundsbored/foundry        # unit tests (settings + controller)
```

Release: push a `foundry-vX.Y.Z` tag; CI publishes `module.json` + `module.zip`
to a GitHub Release.
```

- [ ] **Step 2: Add the foundry package to the root `README.md` packages table**

Add this row to the table under `## Packages` in the root `README.md` (after the `packages/listener` row):

```markdown
| `packages/foundry` | Foundry VTT module — thin shell over `core` (player audio panel, GM config, CI release) |
```

- [ ] **Step 3: Full test suite + typecheck (no regressions across the monorepo)**

Run: `npm test` then `npm run build -w @soundsbored/foundry`
Expected: all tests PASS; foundry build emits `dist/`.

- [ ] **Step 4: Commit docs**

```bash
git add packages/foundry/README.md README.md
git commit -m "docs(foundry): package README + root packages table"
```

- [ ] **Step 5: M4 gate — live verification** (manual; requires Foundry + a publishing SoundsBored app)

Local backend (host-browser dockerized), from `packages/relay`:

```powershell
$env:ROOM_PASSWORD="test"
docker compose -f docker-compose.yml -f docker-compose.localhost.yml up -d --build
```

Then:
1. Build the module (`npm run build -w @soundsbored/foundry`) and install `packages/foundry/dist` into a Foundry v13 data `modules/soundsbored-audio` folder (or install from a real release manifest URL for the internet/Railway check).
2. Start the SoundsBored app publishing to room `world1` (see the app-egress harness).
3. In Foundry (GM): enable the module, set tokenEndpoint `http://localhost:8080`, room `world1`, password `test`.
4. As a player client: open the headphones panel → **Join audio** → confirm the mix is audible; move the volume slider → confirm own volume changes; toggle mute.
5. Reconnect blip: `docker compose restart livekit` → panel pill shows `reconnecting` → `live`, audio resumes.
6. Internet/Railway leg of the gate: repeat 3–5 with tokenEndpoint pointing at the Railway relay and a second machine/player over the internet.

Expected: all steps pass. Record the result; if any fail, debug with superpowers:systematic-debugging before claiming the gate.

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch to open the PR / merge `feat/foundry-module`.

---

## Self-Review

**Spec coverage:**
- Package shape (Vite lib, bundles core+livekit) → Task 5. ✅
- File split settings/controller/panel/module → Tasks 1–4. ✅
- Settings C6 world-scope trio + client volume/mute → Task 4 (register), Task 1 (resolve). ✅
- Security note (password world-visible) → documented in Task 7 README + settings hint. ✅
- Lifecycle: init/getSceneControlButtons v13/ready + enable-audio gesture → Task 4 + panel Join (Task 3). ✅
- Config-unset UX → panel.hbs + `_prepareContext` (Task 3). ✅
- Connect-error mapping → panel `#onJoin` notification (Task 3). ✅ (Note: simplified to a single error notification rather than status-specific text; core's `TokenFetchError` distinctions are surfaced generically — acceptable for the thin shell; refine in M5 if desired.)
- Resilience inherited, pill renders state → controller `onState` + panel re-render (Tasks 2–3). ✅
- Testing: settings + controller unit-tested; panel/module glue untested → Tasks 1–2 tests; Task 7 live gate. ✅
- Build + CI (module.json, assemble, GitHub Actions on tag) → Tasks 5–6. ✅
- Gate mapping (manifest install, internet audio, own volume, reconnect) → Task 7 step 5. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"; all steps carry concrete code or exact commands. Two explicit "verify against live Foundry" notes (scene-control shape, action `this`-binding) are deliberate API-confirmation checkpoints, not placeholders — the surrounding code is complete and runnable.

**Type consistency:** `AudioController` / `AudioControllerDeps` / `createAudioController` names match across Tasks 2–3. `resolveConfig`/`SETTINGS`/`MODULE_ID` match across Tasks 1/3/4. `openPanel` produced in Task 3, consumed in Task 4. `ListenerState` union used consistently (`connecting|live|reconnecting|disconnected`).
```
