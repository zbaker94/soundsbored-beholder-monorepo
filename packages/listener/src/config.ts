import type { ListenerConfig } from '@soundsbored/core';

// Pure config resolution for the listener shell — no DOM, so it's unit-testable
// independently of main.ts's wiring.

/** Parse persisted listener config from a raw localStorage value, keeping only
 *  known string fields. Returns {} for absent, non-JSON, or non-object data. */
export function parseSavedConfig(raw: string | null): Partial<ListenerConfig> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const rec = parsed as Record<string, unknown>;
  const saved: Partial<ListenerConfig> = {};
  if (typeof rec.tokenEndpoint === 'string') saved.tokenEndpoint = rec.tokenEndpoint;
  if (typeof rec.room === 'string') saved.room = rec.room;
  if (typeof rec.password === 'string') saved.password = rec.password;
  return saved;
}

/** Resolve a field the operator may pre-set. A key present in the server config
 *  is operator-locked (fill it, hide the field — it's not the listener's to set);
 *  an absent key stays user-editable and falls back to the saved value. */
export function resolveField(
  key: 'tokenEndpoint' | 'room',
  defaults: Partial<ListenerConfig>,
  saved: Partial<ListenerConfig>,
): { value: string; locked: boolean } {
  if (key in defaults) return { value: defaults[key] ?? '', locked: true };
  return { value: saved[key] ?? '', locked: false };
}

/** Validate raw form inputs into a ListenerConfig, or null if incomplete.
 *  tokenEndpoint may be empty for a same-origin deploy (relative /token). */
export function buildConfig(
  tokenEndpoint: string,
  room: string,
  password: string,
): ListenerConfig | null {
  const trimmedRoom = room.trim();
  if (!trimmedRoom || !password) return null;
  return { tokenEndpoint: tokenEndpoint.trim(), room: trimmedRoom, password };
}
