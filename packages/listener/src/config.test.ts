import { describe, it, expect } from 'vitest';
import { buildConfig, parseSavedConfig, resolveField } from './config.js';

describe('parseSavedConfig', () => {
  it('returns {} for null (nothing stored)', () => {
    expect(parseSavedConfig(null)).toEqual({});
  });

  it('returns {} for non-JSON', () => {
    expect(parseSavedConfig('not json{')).toEqual({});
  });

  it('returns {} for JSON that is not an object', () => {
    expect(parseSavedConfig('"a string"')).toEqual({});
    expect(parseSavedConfig('42')).toEqual({});
    expect(parseSavedConfig('null')).toEqual({});
  });

  it('keeps only known string fields', () => {
    const raw = JSON.stringify({
      tokenEndpoint: 'https://relay.example.com',
      room: 'the-session',
      password: 'hunter2',
      extra: 'ignored',
    });
    expect(parseSavedConfig(raw)).toEqual({
      tokenEndpoint: 'https://relay.example.com',
      room: 'the-session',
      password: 'hunter2',
    });
  });

  it('drops fields with the wrong type', () => {
    const raw = JSON.stringify({ room: 42, password: 'ok', tokenEndpoint: null });
    expect(parseSavedConfig(raw)).toEqual({ password: 'ok' });
  });
});

describe('resolveField', () => {
  it('locks and fills a field present in server defaults', () => {
    const defaults = { room: 'locked-room' };
    const saved = { room: 'saved-room' };
    expect(resolveField('room', defaults, saved)).toEqual({ value: 'locked-room', locked: true });
  });

  it('treats a present-but-empty default as locked (operator chose blank)', () => {
    expect(resolveField('tokenEndpoint', { tokenEndpoint: '' }, {})).toEqual({
      value: '',
      locked: true,
    });
  });

  it('falls back to the saved value when the key is absent from defaults', () => {
    expect(resolveField('room', {}, { room: 'saved-room' })).toEqual({
      value: 'saved-room',
      locked: false,
    });
  });

  it('yields an empty editable field when neither defaults nor saved has the key', () => {
    expect(resolveField('tokenEndpoint', {}, {})).toEqual({ value: '', locked: false });
  });
});

describe('buildConfig', () => {
  it('returns null when room is missing', () => {
    expect(buildConfig('https://relay', '', 'pw')).toBeNull();
    expect(buildConfig('https://relay', '   ', 'pw')).toBeNull();
  });

  it('returns null when password is missing', () => {
    expect(buildConfig('https://relay', 'room', '')).toBeNull();
  });

  it('trims tokenEndpoint and room but preserves the password verbatim', () => {
    expect(buildConfig('  https://relay  ', '  room  ', '  pw  ')).toEqual({
      tokenEndpoint: 'https://relay',
      room: 'room',
      password: '  pw  ',
    });
  });

  it('allows an empty tokenEndpoint for same-origin deploys', () => {
    expect(buildConfig('', 'room', 'pw')).toEqual({
      tokenEndpoint: '',
      room: 'room',
      password: 'pw',
    });
  });
});
