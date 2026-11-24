// The fixed part of the graph: three buses into the master, a shared reverb fed by music and
// ambience, then a limiter. The same mixer runs live and in the offline renders of the audio check.
import { gain } from './instruments';
import type { SoundBus } from './registry';
import { busGain, type BusName, type BusSettings } from './settings';

// The guide's starting point was −14 dB; at −10 dB single sounds pass untouched at the default
// volumes while a pile-up at full volume still stays under −1 dBFS (the audio check's stack test).
export const LIMITER = { threshold: -10, ratio: 4, knee: 0, attack: 0.003, release: 0.25 } as const;

// The Web Audio compressor applies make-up gain of its own: 0.6 × the reduction it would apply to a
// full-scale signal (measured in Chrome: +6.3 dB at −14 dB, 4:1, hard knee). The trim takes it back so
// quiet sounds pass at unity and the limiter only ever lowers the level.
export const LIMITER_TRIM_DB = -0.6 * -LIMITER.threshold * (1 - 1 / LIMITER.ratio);

// How much of each bus goes to the reverb (post-fader, so switching a bus off silences its tail too).
export const REVERB_SENDS = { music: 0.32, ambience: 0.2 } as const;

export interface Mixer {
  ctx: BaseAudioContext;
  input: Record<SoundBus, GainNode>;
  /** Moves the bus gains to `settings`, gliding over a few milliseconds so nothing clicks. */
  apply(settings: BusSettings): void;
}

export function createMixer(ctx: BaseAudioContext, settings: BusSettings, impulse: AudioBuffer): Mixer {
  const master = gain(ctx, busGain(settings.master));
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.ratio.value = LIMITER.ratio;
  limiter.knee.value = LIMITER.knee;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  const trim = gain(ctx, 10 ** (LIMITER_TRIM_DB / 20));
  master.connect(limiter);
  limiter.connect(trim);
  trim.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  reverb.connect(master);

  const input: Record<SoundBus, GainNode> = {
    music: gain(ctx, busGain(settings.music)),
    ambience: gain(ctx, busGain(settings.ambience)),
    sfx: gain(ctx, busGain(settings.sfx)),
  };
  for (const node of Object.values(input)) node.connect(master);
  for (const bus of ['music', 'ambience'] as const) {
    const send = gain(ctx, REVERB_SENDS[bus]);
    input[bus].connect(send);
    send.connect(reverb);
  }

  const gains: Record<BusName, GainNode> = { master, ...input };
  return {
    ctx,
    input,
    apply(next) {
      for (const [name, node] of Object.entries(gains) as [BusName, GainNode][]) {
        node.gain.setTargetAtTime(busGain(next[name]), ctx.currentTime, 0.02);
      }
    },
  };
}
