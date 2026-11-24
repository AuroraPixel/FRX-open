// Starts named sounds on a mixer at given context times and keeps track of them until they are
// silent. Time is always passed in, so the live engine and the offline renders share this code.
import { gain } from './instruments';
import { kitFor } from './kit';
import type { Mixer } from './mixer';
import { childSeed, seeded, type Random } from './random';
import type { SoundBus, SoundDef, SoundParams, SoundRegistry, Voice } from './registry';

/** How far ahead notes and random events are scheduled. */
export const LOOKAHEAD = 0.5;
/** Fade used when a one-shot is cut short. */
const CUT = 0.05;

interface Ramp {
  start: number;
  end: number;
  from: number;
  to: number;
}

export class PlayingVoice {
  private ramp: Ramp;
  private stopAt = Infinity;

  constructor(
    readonly name: string,
    private readonly def: SoundDef,
    private readonly output: GainNode,
    private readonly voice: Voice,
    ramp: Ramp,
  ) {
    this.ramp = ramp;
  }

  get bus(): SoundBus {
    return this.def.bus;
  }

  /** Context time after which this voice can be let go. */
  get end(): number {
    return Math.min(this.voice.end, this.stopAt);
  }

  get stopping(): boolean {
    return this.stopAt < Infinity;
  }

  pump(until: number): void {
    this.voice.pump?.(Math.min(until, this.stopAt));
  }

  /** Fades to silence from `at` over `seconds`, then stops the sources. */
  fadeOut(at: number, seconds = this.def.release ?? CUT): void {
    if (at >= this.stopAt) return;
    const level = this.levelAt(at);
    const param = this.output.gain;
    param.cancelScheduledValues(at);
    param.setValueAtTime(level, at);
    param.linearRampToValueAtTime(0, at + seconds);
    this.ramp = { start: at, end: at + seconds, from: level, to: 0 };
    this.stopAt = at + seconds;
    this.voice.stop(this.stopAt);
  }

  release(): void {
    this.output.disconnect();
  }

  /** The fade gain at time `t`, from the ramps this class scheduled. */
  private levelAt(t: number): number {
    const { start, end, from, to } = this.ramp;
    if (t <= start) return from;
    if (t >= end) return to;
    return from + ((to - from) * (t - start)) / (end - start);
  }
}

export class Player {
  readonly live = new Set<PlayingVoice>();

  constructor(
    readonly mixer: Mixer,
    readonly registry: SoundRegistry,
    private readonly random: Random,
  ) {}

  /** Starts `name` at context time `at`, fading in over `fadeIn` seconds; null if no such sound. */
  start(name: string, params: SoundParams = {}, at = this.mixer.ctx.currentTime, fadeIn = 0): PlayingVoice | null {
    const def = this.registry.get(name);
    if (!def) return null;
    const { ctx } = this.mixer;
    const level = Math.min(1, Math.max(0, params.gain ?? 1));
    const output = gain(ctx, fadeIn > 0 ? 0 : level);
    if (fadeIn > 0) {
      output.gain.setValueAtTime(0, at);
      output.gain.linearRampToValueAtTime(level, at + fadeIn);
    }
    output.connect(this.mixer.input[def.bus]);
    const random = seeded(params.seed ?? childSeed(this.random));
    const voice = def.start({ ctx, out: output, when: at, random, kit: kitFor(ctx) }, params);
    const ramp = { start: at, end: at + fadeIn, from: fadeIn > 0 ? 0 : level, to: level };
    const playing = new PlayingVoice(name, def, output, voice, ramp);
    this.live.add(playing);
    playing.pump(at + LOOKAHEAD);
    return playing;
  }

  pump(until: number): void {
    for (const voice of this.live) voice.pump(until);
  }

  /** Lets go of voices that finished before `now`. */
  sweep(now: number): void {
    for (const voice of this.live) {
      if (voice.end + 0.1 < now) {
        voice.release();
        this.live.delete(voice);
      }
    }
  }
}

/** One place for a looping sound (the ambience, the music): a new one crossfades with the old. */
export class CrossfadeSlot {
  private current: PlayingVoice | null = null;

  constructor(private readonly player: Player) {}

  get playing(): string | null {
    return this.current?.name ?? null;
  }

  switchTo(name: string | null, at: number, fade: number, params?: SoundParams): void {
    if (this.playing === name) return;
    this.current?.fadeOut(at, fade);
    this.current = name === null ? null : this.player.start(name, params, at, fade);
  }
}
