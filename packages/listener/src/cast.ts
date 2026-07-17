/**
 * The party around the eye: which adventurer stands for which client, and where
 * each one stands. Pure — no DOM, no livekit.
 */

/** Figures packed into `assets/adventurers.png`, left to right. */
export const SPRITE_COUNT = 30;

export interface CastMember {
  identity: string;
  /** Index into the sprite sheet. */
  sprite: number;
  /** True for this client's own figure — the one that gets the gilt mark. */
  isSelf: boolean;
}

export interface FanSpot {
  /** Horizontal offset from the band's centre, in % of the band's width. */
  x: number;
  /** Where the figure's feet land, in % of the band's height. */
  y: number;
  /** Stacking order: the nearer the centre, the higher it stands in front. */
  z: number;
  /** True for figures left of centre, which face back in toward the middle. */
  flip: boolean;
  /** Where this figure starts dissolving into shadow, in % of its own height. */
  fadeStart: number;
  /** Where it has dissolved completely, in % of its own height. */
  fadeEnd: number;
}

/** FNV-1a. Small, stable, and it scatters the relay's sequential identities
 *  (`subscriber-spike-1`, `-2`, …) instead of mapping them to neighbours. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Cast every client in the room — self plus fellow listeners — as an adventurer.
 *
 * The identity picks the figure, so it survives re-renders and stays put as
 * other people come and go; because the relay mints a fresh identity per
 * connection, it still comes up random each time you connect. Collisions probe
 * forward, so a small room gets distinct figures. Every client derives the same
 * assignment from the same sorted identity set.
 */
export function assignCast(self: string | null, listenerIds: string[]): CastMember[] {
  if (self === null) return [];
  const everyone = [self, ...listenerIds].sort();
  const taken = new Set<number>();
  return everyone.map((identity) => {
    let sprite = hash(identity) % SPRITE_COUNT;
    // Only probe while the sheet can still offer something new; past that the
    // room is bigger than the cast and figures simply repeat.
    for (let i = 0; taken.size < SPRITE_COUNT && taken.has(sprite); i += 1) {
      sprite = (sprite + 1) % SPRITE_COUNT;
    }
    taken.add(sprite);
    return { identity, sprite, isSelf: identity === self };
  });
}

/** How much further apart each extra body pushes the wings, in % of the band. */
const SPREAD_PER_HEAD = 13;
/**
 * Furthest a figure may stand from the centre, in % of the band. The wings spill
 * out over the panel's padding on purpose — the panel's own edge is the real
 * limit, and past this a figure's shoulder is clipped off by it.
 */
const MAX_X = 43;
/**
 * How much higher the wings stand than the middle, in % of the band. Bounded by
 * the rise budget: BASE_Y - SHADOW_END. Spend more than that and the outermost
 * figure's feet clear the shadow entirely and it reads as floating.
 */
const ARC_DEPTH = 24;
/** Angle the outermost figure sits at on the depth arc — 90° spends its full depth. */
const ARC_SWEEP = 90;
/**
 * Feet of the frontmost figure, in % of the band's height. Past 100 on purpose:
 * every figure is cut off by the shadow, so the party reads as standing in the
 * dark rather than posed on a shelf. It also buys the rise budget — the wings
 * can only climb as far as the gap down to SHADOW_END.
 */
const BASE_Y = 128;

/**
 * Where the shadow swallows the figures, in % of the band's height. One line
 * across the whole band, so a staggered party still dissolves along a level
 * horizon.
 */
const SHADOW_START = 86;
const SHADOW_END = 104;

/**
 * A figure's height, in % of the band's — it stands taller than its band, so the
 * middle of the party keeps its head up even while its feet sink well past the
 * shadow. Must match `.adventurer`'s height against `.party`'s in the CSS.
 */
const FIGURE_HEIGHT = (8 / 7) * 100;

/**
 * Fan `n` figures across the band: they spread wider as the party grows, the
 * middle standing nearest and in front, the wings further out, higher up, and
 * turned back toward the centre. No rotation — they stand upright.
 */
export function fanLayout(n: number): FanSpot[] {
  if (n < 1) return [];
  // A lone figure stands dead centre; each extra one pushes the wings out, until
  // the party is as wide as the panel allows and further arrivals just crowd in.
  // Spacing is even: placing figures along sin(angle) instead would bunch the
  // wings together while the middle stayed roomy.
  const spread = Math.min(MAX_X, SPREAD_PER_HEAD * (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1 .. 1, left to right
    const x = spread * t;
    // Further out means further back: higher up the band, and behind its
    // neighbours toward the centre.
    const y = BASE_Y - ARC_DEPTH * (1 - Math.cos((t * ARC_SWEEP * Math.PI) / 180));
    // The figure's box spans [y - FIGURE_HEIGHT, y] in band %. Re-expressing a
    // band-space line against that box puts the shadow in figure coordinates,
    // which is what CSS needs to mask each figure individually.
    const inFigureSpace = (line: number): number => ((line - (y - FIGURE_HEIGHT)) / FIGURE_HEIGHT) * 100;
    return {
      x,
      y,
      z: Math.round(100 - Math.abs(x)),
      flip: x < 0,
      fadeStart: inFigureSpace(SHADOW_START),
      fadeEnd: inFigureSpace(SHADOW_END),
    };
  });
}
