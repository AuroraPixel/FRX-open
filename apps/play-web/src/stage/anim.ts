// Tweens and timed calls for the effects' timetables (界面规范第九节「特效的时间表」).

export type Ease = (u: number) => number;

export const io: Ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
export const out: Ease = (u) => 1 - Math.pow(1 - u, 3);
export const lin: Ease = (u) => u;

interface Tween<K> {
  key: K;
  to: number;
  dur: number;
  delay: number;
  t: number;
  from: number | null;
  ease: Ease;
  done: (() => void) | null;
}

interface Later {
  t: number;
  fn: () => void;
}

export class Timeline<K extends string> {
  readonly values: Record<K, number>;
  private tweens: Tween<K>[] = [];
  private laters: Later[] = [];

  constructor(values: Record<K, number>) {
    this.values = values;
  }

  // Move `key` to `to` over `dur` seconds after `delay`, from its value when the tween starts unless `from` is given.
  tween(key: K, to: number, dur: number, delay = 0, ease: Ease = io, from?: number, done?: () => void): void {
    this.tweens.push({ key, to, dur: Math.max(0.001, dur), delay, t: 0, from: from ?? null, ease, done: done ?? null });
  }

  later(seconds: number, fn: () => void): void {
    this.laters.push({ t: seconds, fn });
  }

  clear(): void {
    this.tweens = [];
    this.laters = [];
  }

  get busy(): boolean {
    return this.tweens.length > 0 || this.laters.length > 0;
  }

  step(dt: number): void {
    for (let i = this.laters.length - 1; i >= 0; i--) {
      const later = this.laters[i]!;
      later.t -= dt;
      if (later.t <= 0) {
        this.laters.splice(i, 1);
        later.fn();
      }
    }
    for (let j = this.tweens.length - 1; j >= 0; j--) {
      const k = this.tweens[j];
      if (!k) continue;
      if (k.delay > 0) {
        k.delay -= dt;
        continue;
      }
      if (k.from === null) k.from = this.values[k.key];
      k.t += dt / k.dur;
      const u = Math.min(1, k.t);
      this.values[k.key] = k.from + (k.to - k.from) * k.ease(u);
      if (u >= 1) {
        const at = this.tweens.indexOf(k);
        if (at >= 0) this.tweens.splice(at, 1);
        if (k.done) k.done();
      }
    }
  }

  // Run the timetable forward in small steps, for the deterministic mode.
  advance(seconds: number, step = 1 / 120): void {
    let left = seconds;
    while (left > 1e-9) {
      const dt = Math.min(step, left);
      this.step(dt);
      left -= dt;
    }
  }
}

// Exponential approach at `rate` per second: the stage's way of easing every continuous value.
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}
