// What a released drag means, for the phone's sliding surfaces: the book page's two docking places
// (useDock) and the bottom sheet (useSheetDrag). Pure functions, so the rules are tested directly.

/** A flick faster than this (px per ms) decides by direction alone. */
export const FLICK = 0.5;

/** Follows a pointer and reports the speed at release, from the last 100 ms of movement. */
export class Tracker {
  private samples: { t: number; y: number }[] = [];
  readonly startY: number;

  constructor(y: number, t: number) {
    this.startY = y;
    this.samples.push({ t, y });
  }

  move(y: number, t: number): number {
    this.samples.push({ t, y });
    while (this.samples.length > 2 && t - (this.samples[0]?.t ?? t) > 100) this.samples.shift();
    return y - this.startY;
  }

  /** px per ms, positive downward */
  velocity(): number {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t === first.t) return 0;
    return (last.y - first.y) / (last.t - first.t);
  }
}

export type SheetStop = 'open' | 'full';

export interface SheetSizes {
  /** height when open: min(72dvh, 560px) */
  open: number;
  /** height when pulled up: 92dvh */
  full: number;
}

/** Where a phone sheet goes when the finger lifts after moving `dy` (positive down). */
export function settleSheet(stop: SheetStop, dy: number, velocity: number, sizes: SheetSizes): SheetStop | 'close' {
  const start = stop === 'full' ? sizes.full : sizes.open;
  const height = start - dy;
  if (velocity <= -FLICK) return 'full';
  if (velocity >= FLICK) return stop === 'full' && height > sizes.open * 0.6 ? 'open' : 'close';
  if (height >= (sizes.open + sizes.full) / 2) return 'full';
  if (height >= sizes.open * 0.6) return 'open';
  return 'close';
}

/** Where a sheet as tall as its content (the navigation) goes: it has one place, and closes when
 *  flicked down or pulled down more than 40% of its height. */
export function settleFit(dy: number, velocity: number, height: number): 'open' | 'close' {
  if (velocity >= FLICK) return 'close';
  if (velocity <= -FLICK) return 'open';
  return dy > height * 0.4 ? 'close' : 'open';
}

export type DockStop = 'half' | 'full';

export interface DockSizes {
  /** the book's top edge when half open: 41% of the screen */
  half: number;
  /** the book's top edge when fully open: 96 px below the safe area */
  full: number;
}

/** Where the book page docks when the finger lifts after moving its top edge by `dy`. */
export function settleDock(stop: DockStop, dy: number, velocity: number, sizes: DockSizes): DockStop {
  if (velocity <= -FLICK) return 'full';
  if (velocity >= FLICK) return 'half';
  const top = (stop === 'full' ? sizes.full : sizes.half) + dy;
  return top < (sizes.half + sizes.full) / 2 ? 'full' : 'half';
}

/** How far (px) and how fast (px per ms) a swipe up the half-open page's text must go to open it. */
export const RISE = { distance: 24, speed: 0.3 };

/** Where the half-open page goes when a swipe up its text lifts: reading on opens it fully, eagerly (a
 *  short reading swipe, not only one past the middle), and only a barely moved finger leaves it. */
export function riseDock(dy: number, velocity: number): DockStop {
  return dy <= -RISE.distance || velocity <= -RISE.speed ? 'full' : 'half';
}
