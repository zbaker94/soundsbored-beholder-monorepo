import type { ListenerConfig, ListenerState } from '@soundsbored/core';
import { createAudioController, type AudioController } from './controller.js';
import { MODULE_ID, SETTINGS, resolveConfig } from './settings.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const STATE_LABELS: Record<ListenerState, string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for audio…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
};

/** Fields the panel exposes to panel.hbs. */
export interface PanelContext {
  configured: boolean;
  isGM: boolean;
  joined: boolean;
  state: ListenerState;
  stateLabel: string;
  volume: number;
  muted: boolean;
}

/** Pure view-model for panel.hbs — derives the template context from resolved
 *  values. Kept Foundry-free so it can be unit-tested; {@link SoundsBoredPanel}
 *  reads the globals and delegates here. */
export function buildPanelContext(input: {
  config: ListenerConfig | null;
  state: ListenerState;
  joined: boolean;
  isGM: boolean;
  volume: number;
  muted: boolean;
}): PanelContext {
  return {
    configured: input.config !== null,
    isGM: input.isGM,
    joined: input.joined,
    state: input.state,
    stateLabel: STATE_LABELS[input.state],
    volume: input.volume,
    muted: input.muted,
  };
}

/** Reads a module setting. */
const get = (key: string): unknown => game.settings.get(MODULE_ID, key);

/** Player-facing control panel: status, Join/Leave, volume, mute. Thin — all
 *  behaviour lives in the injected {@link AudioController} / core. */
export class SoundsBoredPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'soundsbored-panel',
    tag: 'div',
    window: { title: 'SoundsBored: Beholder', icon: 'fa-solid fa-headphones' },
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
  async _prepareContext(options?: unknown): Promise<Record<string, unknown>> {
    const context = await super._prepareContext(options);
    const state = (this.#controller?.getState() ?? 'disconnected') as ListenerState;
    return Object.assign(context, buildPanelContext({
      config: resolveConfig(get),
      state,
      joined: this.#controller?.isJoined() ?? false,
      isGM: game.user?.isGM ?? false,
      volume: Number(get(SETTINGS.volume) ?? 1),
      muted: Boolean(get(SETTINGS.muted) ?? false),
    }));
  }

  // Wire the range + checkbox inputs after each render (buttons use data-action).
  _onRender(context?: unknown, options?: unknown): void {
    super._onRender(context, options);
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
