import { rng } from '../kit/kit';

// The stage's time and randomness. Live, time runs with the frames (slower with reduced motion) and randomness is
// Math.random. Deterministic, the clock stands at t and every random stream comes from the seed, so a screenshot
// comes out the same every time. `reduced` can change with the settings' motion level.
export class Clock {
  readonly deterministic: boolean;
  reduced: boolean;
  readonly fixed: number;
  time: number;
  private readonly seed: string;

  constructor(deterministic: { seed: string | number; t: number } | undefined, reduced: boolean) {
    this.deterministic = !!deterministic;
    this.reduced = reduced;
    this.fixed = deterministic ? Math.max(0, deterministic.t) : 0;
    this.time = this.fixed;
    this.seed = deterministic ? String(deterministic.seed) : '';
  }

  advance(dt: number): void {
    if (!this.deterministic) this.time += dt * (this.reduced ? 0.35 : 1);
  }

  // A named random stream: the same name and seed give the same numbers, live or not.
  random(name: string): () => number {
    return this.deterministic ? rng(`${this.seed}:${name}`) : Math.random;
  }
}
