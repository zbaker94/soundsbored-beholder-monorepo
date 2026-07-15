import { describe, it, expect, vi, beforeAll } from 'vitest';
import { MODULE_ID, SETTINGS } from './settings.js';

// module.ts imports panel.ts → controller.ts → core (livekit). Mock the media
// lib so nothing real loads (mirrors controller.test.ts / core's tests).
vi.mock('livekit-client', () => ({ RoomEvent: {}, Track: { Kind: { Audio: 'audio', Video: 'video' } }, Room: class {} }));

// module.ts wires Hooks and panel.ts destructures `foundry.applications.api` at
// module-load time. Stub the globals, then import for the Foundry-free exports.
type ModuleModule = typeof import('./module.js');
let registerSettings: ModuleModule['registerSettings'];
let buildSceneControl: ModuleModule['buildSceneControl'];

beforeAll(async () => {
  vi.stubGlobal('Hooks', { once: vi.fn(), on: vi.fn() });
  vi.stubGlobal('game', { settings: { register: vi.fn(), get: vi.fn(), set: vi.fn() } });
  vi.stubGlobal('foundry', {
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base: unknown) => Base } },
  });
  ({ registerSettings, buildSceneControl } = await import('./module.js'));
});

describe('registerSettings', () => {
  it('registers all five settings under the module namespace', () => {
    const register = vi.fn();
    registerSettings(register);
    const keys = register.mock.calls.map((c) => c[1]);
    expect(register).toHaveBeenCalledTimes(5);
    expect(keys).toEqual([SETTINGS.tokenEndpoint, SETTINGS.room, SETTINGS.password, SETTINGS.volume, SETTINGS.muted]);
    for (const call of register.mock.calls) expect(call[0]).toBe(MODULE_ID);
  });

  it('scopes the config trio to world (visible) and playback prefs to client (hidden)', () => {
    const register = vi.fn();
    registerSettings(register);
    const byKey = Object.fromEntries(register.mock.calls.map((c) => [c[1], c[2]]));
    for (const k of [SETTINGS.tokenEndpoint, SETTINGS.room, SETTINGS.password]) {
      expect(byKey[k]).toMatchObject({ scope: 'world', config: true });
    }
    for (const k of [SETTINGS.volume, SETTINGS.muted]) {
      expect(byKey[k]).toMatchObject({ scope: 'client', config: false });
    }
  });
});

describe('buildSceneControl', () => {
  it('builds a v13 control that fires onClick from its panel tool', () => {
    const onClick = vi.fn();
    const control = buildSceneControl(onClick);
    expect(control).toMatchObject({ name: MODULE_ID, activeTool: 'panel' });
    const tool = (control.tools as Record<string, { button: boolean; onClick: () => void }>).panel;
    expect(tool.button).toBe(true);
    tool.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
