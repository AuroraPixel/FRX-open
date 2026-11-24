// Makes a page load repeatable for screenshots: with ?seed= every Math.random call comes from a
// seeded generator, with ?t= the clock stands at that time and CSS motion is switched off. Installed
// once, before anything else runs, so the stage and every component see the same numbers.
import type { PagePins } from './params';

/** mulberry32: small, fast and good enough for visuals. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Date whose "now" is fixed; dates built from arguments behave as usual. */
export function pinnedDate(time: number): DateConstructor {
  const Real = Date;
  class PinnedDate extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(time);
      else super(...(args as [string | number | Date]));
    }
    static override now(): number {
      return time;
    }
  }
  return PinnedDate as DateConstructor;
}

export function installPins(pins: PagePins, root: HTMLElement = document.documentElement): void {
  if (pins.seed !== undefined) Math.random = seededRandom(pins.seed);
  if (pins.t !== undefined) {
    globalThis.Date = pinnedDate(pins.t);
    root.dataset.pinned = '';
  }
}
