// A seeded random source: the same seed always gives the same sequence (FNV-1a of the text, then mulberry32).

export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Random {
  private state: number;

  constructor(seed: string) {
    this.state = hash32(seed) || 0x9e3779b9;
  }

  // 0 <= value < 1
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  // one of the items, each as likely as its weight (none: null)
  pick<T>(items: readonly T[], weight: (item: T) => number = () => 1): T | null {
    const weights = items.map((item) => Math.max(0, weight(item)));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return null;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  // all the items, in an order drawn by weight (a heavier one tends to come first)
  order<T>(items: readonly T[], weight: (item: T) => number = () => 1): T[] {
    const left = [...items];
    const out: T[] = [];
    while (left.length) {
      const item = this.pick(left, weight) ?? left[0]!;
      out.push(item);
      left.splice(left.indexOf(item), 1);
    }
    return out;
  }
}

// A short name for a place in a file path or a scene id: eight hex digits of its hash.
export function slug(text: string): string {
  return hash32(text).toString(16).padStart(8, '0');
}
