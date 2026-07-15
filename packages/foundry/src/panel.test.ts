import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ListenerConfig, ListenerState } from '@soundsbored/core';

// panel.ts destructures `foundry.applications.api` and extends ApplicationV2 at
// module-load time. Stub just enough of the global for the import to succeed,
// then pull in the Foundry-free exports we actually test.
type PanelModule = typeof import('./panel.js');
let buildPanelContext: PanelModule['buildPanelContext'];
let STATE_LABELS: PanelModule['STATE_LABELS'];

beforeAll(async () => {
  vi.stubGlobal('foundry', {
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base: unknown) => Base } },
  });
  ({ buildPanelContext, STATE_LABELS } = await import('./panel.js'));
});

const config: ListenerConfig = { tokenEndpoint: 'https://relay.example', room: 'world1', password: 'pw' };
const base = { config, state: 'disconnected' as ListenerState, joined: false, isGM: false, volume: 1, muted: false };

describe('STATE_LABELS', () => {
  it('labels every listener state', () => {
    const states: ListenerState[] = ['connecting', 'waiting', 'live', 'reconnecting', 'disconnected'];
    for (const s of states) expect(STATE_LABELS[s]).toBeTruthy();
  });
});

describe('buildPanelContext', () => {
  it('reports configured=true when a config is present', () => {
    expect(buildPanelContext(base).configured).toBe(true);
  });

  it('reports configured=false when config is null', () => {
    expect(buildPanelContext({ ...base, config: null }).configured).toBe(false);
  });

  it('maps state to its label', () => {
    expect(buildPanelContext({ ...base, state: 'live' })).toMatchObject({ state: 'live', stateLabel: STATE_LABELS.live });
  });

  it('passes through isGM, joined, volume and muted verbatim', () => {
    expect(buildPanelContext({ ...base, isGM: true, joined: true, volume: 0.25, muted: true })).toMatchObject({
      isGM: true,
      joined: true,
      volume: 0.25,
      muted: true,
    });
  });
});
