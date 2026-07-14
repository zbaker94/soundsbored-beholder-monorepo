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
