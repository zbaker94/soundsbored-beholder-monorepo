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
Hooks.on('getSceneControlButtons', (controls: Record<string, unknown>) => {
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
