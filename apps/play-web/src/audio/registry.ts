// Every sound has a name. Callers only ever say the name; what plays behind it is a synthesis
// function today and can become a recording later by registering a new definition under the same name.
import type { Kit } from './kit';
import type { Random } from './random';

export type SoundBus = 'music' | 'ambience' | 'sfx';

/** A note a music voice has scheduled; reported so the audio check can compare minutes. */
export interface PlayedNote {
  time: number;
  midi: number;
  instrument: 'pluck' | 'xiao';
}

export interface SoundParams {
  /** Seeds the sound's randomness; left out, the player draws one. */
  seed?: number;
  /** Extra gain on top of the bus, 0 to 1. */
  gain?: number;
  onNote?: (note: PlayedNote) => void;
}

export interface SoundStart {
  ctx: BaseAudioContext;
  /** The voice's own output; everything the sound makes connects here. */
  out: AudioNode;
  /** Context time at which the sound begins. */
  when: number;
  random: Random;
  kit: Kit;
}

export interface Voice {
  /** Context time after which the voice is silent; Infinity while a loop runs. */
  end: number;
  /** Schedules whatever falls before `until`. Voices with notes or random events need it called regularly. */
  pump?(until: number): void;
  /** Stops the voice's sources at `at`; whoever stops it has already faded it out. */
  stop(at: number): void;
}

export interface SoundDef {
  bus: SoundBus;
  /** Loops play until stopped; one-shots end by themselves. */
  loop: boolean;
  /** Fade-out used when a loop is stopped without saying how long. */
  release?: number;
  start(start: SoundStart, params: SoundParams): Voice;
}

const NAME = /^[a-z]+\.[a-z0-9-]+$/;

export class SoundRegistry {
  private readonly defs = new Map<string, SoundDef>();

  constructor(entries: Iterable<readonly [string, SoundDef]> = []) {
    for (const [name, def] of entries) this.register(name, def);
  }

  /** Adds a sound, or replaces the one already under that name. */
  register(name: string, def: SoundDef): void {
    if (!NAME.test(name)) throw new Error(`sound names look like "ui.tap", got "${name}"`);
    this.defs.set(name, def);
  }

  get(name: string): SoundDef | undefined {
    return this.defs.get(name);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  names(prefix = ''): string[] {
    return [...this.defs.keys()].filter((name) => name.startsWith(prefix));
  }
}

/** A voice made of scheduled sources that all stop together. */
export class SourceVoice implements Voice {
  end: number;
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(end = Infinity) {
    this.end = end;
  }

  add<T extends AudioScheduledSourceNode>(source: T): T {
    this.sources.push(source);
    return source;
  }

  stop(at: number): void {
    for (const source of this.sources) {
      try {
        source.stop(at);
      } catch {
        // a source that never started has nothing to stop
      }
    }
    this.end = Math.min(this.end, at);
  }
}
