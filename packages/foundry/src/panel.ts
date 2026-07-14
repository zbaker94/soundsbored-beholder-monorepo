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
