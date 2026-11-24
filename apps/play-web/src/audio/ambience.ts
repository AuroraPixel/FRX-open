// Ambience: a quiet, never-ending bed for each kind of place, with random events (drops, drips,
// crackles, insect trains) booked a little ahead by the scheduler. All of them sit under the music.
import { chain, filter, gain, noise, oscillator, panner } from './instruments';
import { between, type Random } from './random';
import { SourceVoice, type SoundDef, type SoundStart, type Voice } from './registry';

export type AmbienceName = 'amb.wind' | 'amb.sea' | 'amb.rain' | 'amb.drip' | 'amb.fire' | 'amb.insects';

// Output level of each ambience, set by measurement (tools/audio-check.mjs); the mix inside is
// written relative to 1.
const LEVEL: Readonly<Record<AmbienceName, number>> = {
  'amb.wind': 0.19,
  'amb.sea': 0.296,
  'amb.rain': 0.05,
  'amb.drip': 0.144,
  'amb.fire': 0.13,
  'amb.insects': 0.14,
};

/** Adds a slow sine of `depth` around the parameter's own value: gusts, swells, waves. */
function sway(s: SoundStart, voice: SourceVoice, param: AudioParam, rate: number, depth: number): void {
  const lfo = voice.add(oscillator(s.ctx, 'sine', rate));
  chain(lfo, gain(s.ctx, depth)).connect(param);
  lfo.start(s.when);
}

/** Seconds to the next event of a process that averages `rate` events a second. */
export function poissonGap(random: Random, rate: number): number {
  return -Math.log(1 - random()) / rate;
}

/** A bed plus random events: `gap` draws the wait to the next event, `fire` plays one. */
function withEvents(bed: SourceVoice, first: number, gap: () => number, fire: (at: number) => void): Voice {
  let next = first;
  return {
    get end() {
      return bed.end;
    },
    pump(until: number) {
      while (next < until) {
        fire(next);
        next += gap();
      }
    },
    stop(at: number) {
      bed.stop(at);
    },
  };
}

// 山风 — brown noise through a wide band at 400 Hz, pushed by a slow 0.07 Hz swell; two
// decorrelated layers for width and a faint whistle that rides the gusts.
function wind(s: SoundStart): Voice {
  const voice = new SourceVoice();
  for (const side of [-1, 1]) {
    const air = voice.add(noise(s, 'brown', s.when, side < 0 ? 0.7 : 4.9));
    const level = gain(s.ctx, 1);
    sway(s, voice, level.gain, side < 0 ? 0.07 : 0.053, 0.35);
    chain(air, filter(s.ctx, 'bandpass', side < 0 ? 380 : 430, 0.6), level, panner(s.ctx, side * 0.5), s.out);
  }
  const whistle = voice.add(noise(s, 'white', s.when, 1.3));
  const level = gain(s.ctx, 0.08);
  sway(s, voice, level.gain, 0.07, 0.07);
  chain(whistle, filter(s.ctx, 'bandpass', 1100, 3), level, s.out);
  return voice;
}

// 海浪 — white noise under 600 Hz rising and falling about every eight seconds, brighter at the crest.
function sea(s: SoundStart): Voice {
  const voice = new SourceVoice();
  for (const side of [-1, 1]) {
    const surf = voice.add(noise(s, 'white', s.when, side < 0 ? 0.4 : 2.6));
    const low = filter(s.ctx, 'lowpass', 600, 0.5);
    const rate = side < 0 ? 0.12 : 0.093;
    sway(s, voice, low.frequency, rate, 250);
    const level = gain(s.ctx, 1);
    sway(s, voice, level.gain, rate, 0.45);
    chain(surf, low, level, panner(s.ctx, side * 0.5), s.out);
  }
  return voice;
}

// 雨 — white noise above 2 kHz with short drops landing at random, about nine a second.
function rain(s: SoundStart): Voice {
  const bed = new SourceVoice();
  for (const side of [-1, 1]) {
    const hiss = bed.add(noise(s, 'white', s.when, side < 0 ? 0.9 : 3.1));
    chain(hiss, filter(s.ctx, 'highpass', 2000), filter(s.ctx, 'lowpass', 9000), gain(s.ctx, 1), panner(s.ctx, side * 0.6), s.out);
  }
  const drop = (at: number): void => {
    const pitch = between(s.random, 2500, 5000);
    const tone = oscillator(s.ctx, 'sine', pitch);
    tone.frequency.setValueAtTime(pitch, at);
    tone.frequency.exponentialRampToValueAtTime(pitch * 0.8, at + 0.012);
    const level = gain(s.ctx, 0);
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(0.67 * between(s.random, 0.3, 1), at + 0.001);
    level.gain.setTargetAtTime(0, at + 0.001, 0.005);
    chain(tone, level, panner(s.ctx, between(s.random, -0.7, 0.7)), s.out);
    tone.start(at);
    tone.stop(at + 0.05);
  };
  return withEvents(bed, s.when + poissonGap(s.random, 9), () => poissonGap(s.random, 9), drop);
}

// 洞内滴水 — a drop every 2 to 7 s, a high short sine falling a little, answered by the cave's
// echo; under it the cave's own low air so the place is never dead silent.
function drip(s: SoundStart): Voice {
  const bed = new SourceVoice();
  const air = bed.add(noise(s, 'brown', s.when, 2.2));
  chain(air, filter(s.ctx, 'lowpass', 260), s.out);
  const echo = s.ctx.createDelay(1);
  echo.delayTime.value = 0.23;
  const feedback = gain(s.ctx, 0.42);
  chain(echo, filter(s.ctx, 'lowpass', 2500), feedback, echo);
  chain(echo, gain(s.ctx, 0.55), s.out);
  const fall = (at: number): void => {
    const pitch = between(s.random, 1200, 2000);
    const tone = oscillator(s.ctx, 'sine', pitch);
    tone.frequency.setValueAtTime(pitch, at);
    tone.frequency.exponentialRampToValueAtTime(pitch * 0.88, at + 0.06);
    const level = gain(s.ctx, 0);
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(2 * between(s.random, 0.6, 1), at + 0.002);
    level.gain.setTargetAtTime(0, at + 0.002, 0.018);
    const placed = chain(tone, level, panner(s.ctx, between(s.random, -0.5, 0.5)));
    placed.connect(s.out);
    placed.connect(echo);
    tone.start(at);
    tone.stop(at + 0.15);
  };
  return withEvents(bed, s.when + between(s.random, 0.4, 2), () => between(s.random, 2, 7), fall);
}

// 火 — noise under 1.5 kHz that flickers, with crackles that come in bursts and the odd pop.
function fire(s: SoundStart): Voice {
  const bed = new SourceVoice();
  const roar = bed.add(noise(s, 'brown', s.when, 5.5));
  const level = gain(s.ctx, 1);
  sway(s, bed, level.gain, 0.23, 0.15);
  sway(s, bed, level.gain, 0.61, 0.1);
  chain(roar, filter(s.ctx, 'lowpass', 1500), level, s.out);
  let burst = false;
  const gap = (): number => {
    if (s.random() < 0.12) burst = !burst;
    return poissonGap(s.random, burst ? 16 : 2.5);
  };
  const crackle = (at: number): void => {
    const pop = s.random() < 0.1;
    const length = pop ? 0.008 : between(s.random, 0.002, 0.005);
    const snap = noise(s, 'white', at, s.random() * 4);
    const shape = gain(s.ctx, 0);
    shape.gain.setValueAtTime(0, at);
    shape.gain.linearRampToValueAtTime(pop ? 1.5 : between(s.random, 0.3, 1), at + 0.0003);
    shape.gain.linearRampToValueAtTime(0, at + length);
    const tone = pop ? filter(s.ctx, 'bandpass', 700, 1.5) : filter(s.ctx, 'highpass', 1800);
    chain(snap, shape, tone, panner(s.ctx, between(s.random, -0.6, 0.6)), s.out);
    snap.stop(at + length + 0.01);
  };
  return withEvents(bed, s.when + poissonGap(s.random, 3), gap, crackle);
}

// 夜虫 — a 4.2 kHz sine switched on and off 28 times a second, in trains; two insects take turns
// over a faint night air.
function insects(s: SoundStart): Voice {
  const bed = new SourceVoice();
  const air = bed.add(noise(s, 'brown', s.when, 6.1));
  chain(air, filter(s.ctx, 'lowpass', 320), s.out);
  const singers = [
    { pitch: 4200 * 0.97, pan: -0.45 },
    { pitch: 4200 * 1.04, pan: 0.4 },
  ];
  let turn = 0;
  const train = (at: number): void => {
    const singer = singers[turn++ % singers.length]!;
    const length = between(s.random, 0.4, 1.6);
    const tone = oscillator(s.ctx, 'sine', singer.pitch);
    const pulse = oscillator(s.ctx, 'sine', 28);
    const chirp = gain(s.ctx, 0.5);
    chain(pulse, gain(s.ctx, 0.5)).connect(chirp.gain);
    const level = gain(s.ctx, 0);
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(0.33, at + 0.06);
    level.gain.setValueAtTime(0.33, at + length - 0.1);
    level.gain.linearRampToValueAtTime(0, at + length);
    chain(tone, chirp, level, panner(s.ctx, singer.pan), s.out);
    for (const source of [tone, pulse]) {
      source.start(at);
      source.stop(at + length + 0.02);
    }
  };
  return withEvents(bed, s.when + between(s.random, 0.3, 1.5), () => between(s.random, 0.8, 3), train);
}

/** Runs a recipe into its own output gain, set to the ambience's measured level. */
function ambience(name: AmbienceName, recipe: (s: SoundStart) => Voice): SoundDef {
  return {
    bus: 'ambience',
    loop: true,
    release: 2,
    start(s) {
      const out = gain(s.ctx, LEVEL[name]);
      out.connect(s.out);
      return recipe({ ...s, out });
    },
  };
}

export const AMBIENCES: Readonly<Record<AmbienceName, SoundDef>> = {
  'amb.wind': ambience('amb.wind', wind),
  'amb.sea': ambience('amb.sea', sea),
  'amb.rain': ambience('amb.rain', rain),
  'amb.drip': ambience('amb.drip', drip),
  'amb.fire': ambience('amb.fire', fire),
  'amb.insects': ambience('amb.insects', insects),
};
