import type { ListenerConfig } from '@soundsbored/core';

/** Foundry module id — used as the settings namespace and module path. */
export const MODULE_ID = 'soundsbored-beholder';

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
