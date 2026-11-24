// Seeded randomness, so an offline render or a test hears exactly the same notes and drops every time.

export type Random = () => number;

/** mulberry32: small, fast and good enough for musical choices. */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function between(random: Random, low: number, high: number): number {
  return low + (high - low) * random();
}

export function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** A seed for a new voice, drawn from the parent's sequence so a seeded session stays repeatable. */
export function childSeed(random: Random): number {
  return Math.floor(random() * 4294967296);
}
