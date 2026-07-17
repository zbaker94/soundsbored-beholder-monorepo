import { describe, it, expect } from 'vitest';
import { SPRITE_COUNT, assignCast, fanLayout } from './cast.js';

describe('assignCast', () => {
  it('gives every member of the room a figure, self included', () => {
    const cast = assignCast('me', ['a', 'b']);
    expect(cast).toHaveLength(3);
    expect(cast.filter((c) => c.isSelf)).toHaveLength(1);
    expect(cast.find((c) => c.isSelf)?.identity).toBe('me');
  });

  it('is empty while disconnected (no self identity)', () => {
    expect(assignCast(null, [])).toEqual([]);
  });

  it('keeps an identity on the same figure as others come and go', () => {
    const before = assignCast('me', ['a', 'b']);
    const after = assignCast('me', ['b', 'c', 'd']);
    const sprite = (cast: typeof before, id: string) => cast.find((c) => c.identity === id)?.sprite;
    expect(sprite(after, 'me')).toBe(sprite(before, 'me'));
    expect(sprite(after, 'b')).toBe(sprite(before, 'b'));
  });

  it('agrees with the other clients in the room on who is who', () => {
    // Every client sees the same set of identities — itself plus the rest — so
    // the assignment must not depend on which one of them is 'self'.
    const mine = assignCast('a', ['b', 'c']);
    const theirs = assignCast('b', ['a', 'c']);
    const sprites = (cast: typeof mine) => cast.map((c) => [c.identity, c.sprite]);
    expect(sprites(mine)).toEqual(sprites(theirs));
  });

  it('hands out distinct figures until the sheet runs out', () => {
    const ids = Array.from({ length: SPRITE_COUNT }, (_, i) => `listener-${i}`);
    const cast = assignCast(ids[0], ids.slice(1));
    expect(new Set(cast.map((c) => c.sprite)).size).toBe(SPRITE_COUNT);
  });

  it('reuses figures once the room is larger than the sheet', () => {
    const ids = Array.from({ length: SPRITE_COUNT + 5 }, (_, i) => `listener-${i}`);
    const cast = assignCast(ids[0], ids.slice(1));
    expect(cast).toHaveLength(SPRITE_COUNT + 5);
    for (const c of cast) expect(c.sprite).toBeGreaterThanOrEqual(0);
    for (const c of cast) expect(c.sprite).toBeLessThan(SPRITE_COUNT);
  });

  it('spreads different identities across the sheet rather than clumping', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `subscriber-spike-${i}`);
    const cast = assignCast(ids[0], ids.slice(1));
    // Sequential relay identities must not map to sequential sprites.
    const sprites = cast.map((c) => c.sprite);
    expect(new Set(sprites).size).toBe(8);
    expect(sprites).not.toEqual([...sprites].sort((a, b) => a - b));
  });
});

describe('fanLayout', () => {
  it('stands a lone figure dead centre', () => {
    const [only] = fanLayout(1);
    expect(only.x).toBeCloseTo(0);
  });

  it('fans figures symmetrically about the centre', () => {
    const spots = fanLayout(4);
    expect(spots).toHaveLength(4);
    const xs = spots.map((s) => s.x);
    expect(xs[0]).toBeCloseTo(-xs[3]);
    expect(xs[1]).toBeCloseTo(-xs[2]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b)); // left to right
  });

  it('stands the middle of the party nearest, the wings further back', () => {
    const spots = fanLayout(5);
    expect(spots[2].y).toBeGreaterThan(spots[0].y);
    expect(spots[2].y).toBeGreaterThan(spots[4].y);
  });

  it('raises each figure a little higher the further out it stands', () => {
    // y descends (rises up the band) monotonically from the centre outward.
    const spots = fanLayout(7);
    const mid = 3;
    for (let i = 0; i < mid; i += 1) expect(spots[i].y).toBeLessThan(spots[i + 1].y);
    for (let i = mid; i < spots.length - 1; i += 1) expect(spots[i].y).toBeGreaterThan(spots[i + 1].y);
  });

  it('stacks figures nearer the centre in front of those further out', () => {
    const spots = fanLayout(7);
    const mid = 3;
    for (let i = 0; i < mid; i += 1) expect(spots[i].z).toBeLessThan(spots[i + 1].z);
    for (let i = mid; i < spots.length - 1; i += 1) expect(spots[i].z).toBeGreaterThan(spots[i + 1].z);
  });

  it('turns the left wing back toward the centre, and leaves the right alone', () => {
    const spots = fanLayout(6);
    expect(spots.slice(0, 3).every((s) => s.flip)).toBe(true);
    expect(spots.slice(3).some((s) => s.flip)).toBe(false);
  });

  it('leaves a lone figure unflipped', () => {
    expect(fanLayout(1)[0].flip).toBe(false);
  });

  it('drops every figure past the band so the gradient always cuts its feet', () => {
    for (const n of [1, 2, 5, 9, 20]) {
      for (const spot of fanLayout(n)) expect(spot.y).toBeGreaterThan(100);
    }
  });

  it('dissolves the whole party along one level horizon', () => {
    // Figures stand at different depths, so each needs its fade expressed in its
    // own height — but converted back to the band, every fade must land on the
    // same line, or the shadow would look ragged.
    const FIGURE_HEIGHT = (8 / 7) * 100; // must match cast.ts / the CSS
    const toBand = (spot: { y: number }, fade: number) =>
      (fade / 100) * FIGURE_HEIGHT + (spot.y - FIGURE_HEIGHT);
    const spots = fanLayout(7);
    const starts = spots.map((s) => toBand(s, s.fadeStart));
    const ends = spots.map((s) => toBand(s, s.fadeEnd));
    for (const line of starts) expect(line).toBeCloseTo(starts[0]);
    for (const line of ends) expect(line).toBeCloseTo(ends[0]);
  });

  it('starts the fade above the figure and finishes it below the feet', () => {
    for (const spot of fanLayout(5)) {
      expect(spot.fadeStart).toBeGreaterThan(0);
      expect(spot.fadeStart).toBeLessThan(100);
      expect(spot.fadeEnd).toBeGreaterThan(spot.fadeStart);
    }
  });

  it('never lets a raised figure clear the shadow and float', () => {
    // The fade lives in the figure's own box, so it must complete by its foot
    // (100%). If the wings ever rise past the rise budget, their feet reappear
    // above the shadow line and the party stops standing in the dark.
    for (const n of [1, 2, 5, 7, 12, 30]) {
      for (const spot of fanLayout(n)) expect(spot.fadeEnd).toBeLessThanOrEqual(100);
    }
  });

  it('widens the arc for a bigger party without exceeding the frame', () => {
    const wide = fanLayout(9);
    const narrow = fanLayout(3);
    const span = (s: ReturnType<typeof fanLayout>) => Math.max(...s.map((p) => Math.abs(p.x)));
    expect(span(wide)).toBeGreaterThan(span(narrow));
    expect(span(wide)).toBeLessThanOrEqual(43);
  });

  it('spaces the party evenly rather than bunching the wings', () => {
    const xs = fanLayout(7).map((s) => s.x);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]);
  });

  it('keeps even the widest party inside the panel', () => {
    // Figures may spill over the band into the panel's padding, but the panel
    // clips whatever crosses its edge — so no shoulder may reach it.
    const HALF_FIGURE = 13.6; // a figure is ~27% of the band wide (6.4rem of 23.5rem)
    const PANEL_EDGE = 57; // half the panel, in % of the band (13.5rem of 23.5rem)
    for (const n of [2, 5, 9, 30]) {
      for (const spot of fanLayout(n)) {
        expect(Math.abs(spot.x) + HALF_FIGURE).toBeLessThanOrEqual(PANEL_EDGE);
      }
    }
  });

  it('has no layout for an empty room', () => {
    expect(fanLayout(0)).toEqual([]);
  });
});
