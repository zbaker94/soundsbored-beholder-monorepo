import { MODULE_ID, SETTINGS } from './settings.js';
import { openPanel } from './panel.js';

/** Registers one module setting — mirrors `game.settings.register`'s shape.
 *  Injected so {@link registerSettings} stays Foundry-free and testable. */
export type SettingRegister = (namespace: string, key: string, data: Record<string, unknown>) => void;

/** Register the five module settings. World-scope trio is GM-editable + readable
 *  by all clients (C6); volume/mute are per-client playback prefs. */
export function registerSettings(register: SettingRegister): void {
  register(MODULE_ID, SETTINGS.tokenEndpoint, {
    name: 'Token endpoint',
    hint: 'URL of the SoundsBored relay token endpoint (e.g. your Railway relay). Leave blank for a same-origin relay.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
  register(MODULE_ID, SETTINGS.room, {
    name: 'Room',
    hint: 'Must match the room the SoundsBored app publishes to.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
  register(MODULE_ID, SETTINGS.password, {
    name: 'Room password',
    hint: 'Shared listen-only password set on the relay. Distributed to players.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });
  register(MODULE_ID, SETTINGS.volume, {
    scope: 'client',
    config: false,
    type: Number,
    default: 1,
  });
  register(MODULE_ID, SETTINGS.muted, {
    scope: 'client',
    config: false,
    type: Boolean,
    default: false,
  });
}

/** Build the v13 scene-control entry that opens the panel. A non-tool button
 *  available to everyone. Pure so the control shape can be unit-tested. */
export function buildSceneControl(onClick: () => void): Record<string, unknown> {
  return {
    name: MODULE_ID,
    title: 'SoundsBored: Beholder',
    icon: 'fa-solid fa-headphones',
    tools: {
      panel: {
        name: 'panel',
        title: 'Open SoundsBored audio',
        icon: 'fa-solid fa-headphones',
        button: true,
        onClick,
      },
    },
    activeTool: 'panel',
  };
}

Hooks.once('init', () => {
  registerSettings((namespace, key, data) => game.settings.register(namespace, key, data));
});

// v13: getSceneControlButtons receives an object keyed by control name.
Hooks.on('getSceneControlButtons', (controls: Record<string, unknown>) => {
  controls[MODULE_ID] = buildSceneControl(() => openPanel());
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | ready`);
});
