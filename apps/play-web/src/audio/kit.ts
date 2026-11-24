// Buffers computed once per audio context and shared by every sound: looping noise, the reverb's
// impulse response and plucked-string notes (Karplus–Strong, rendered in JavaScript ahead of playing).
import { seeded, type Random } from './random';

export interface Kit {
  /** 4 s of white noise (uniform, ±1) that loops without a seam. */
  white: AudioBuffer;
  /** 8 s of brown noise (RMS 0.3) that loops without a seam. */
  brown: AudioBuffer;
  /** Stereo impulse response for the shared reverb. */
  impulse: AudioBuffer;
  /** A plucked note at peak 1; cached by pitch, decay and brightness. */
  pluck(midi: number, decay: number, bright: number): AudioBuffer;
}

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export function whiteNoise(length: number, random: Random): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = random() * 2 - 1;
  return out;
}

/** Leaky-integrated white noise: falls 6 dB an octave above about 140 Hz. */
export function brownNoise(length: number, random: Random, rms = 0.3): Float32Array {
  const out = new Float32Array(length);
  let level = 0;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    level = (level + 0.02 * (random() * 2 - 1)) / 1.02;
    out[i] = level;
    sum += level;
  }
  const mean = sum / length;
  let power = 0;
  for (let i = 0; i < length; i++) {
    const value = out[i]! - mean;
    out[i] = value;
    power += value * value;
  }
  const scale = rms / Math.sqrt(power / length);
  for (let i = 0; i < length; i++) out[i] = out[i]! * scale;
  return out;
}

/**
 * Turns `fade` extra samples at the end into a crossfade with the start, so the result loops with
 * no step at the seam: the last sample is followed by what originally came after it.
 */
export function loopSeamlessly(samples: Float32Array, fade: number): Float32Array {
  const length = samples.length - fade;
  const out = samples.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = samples[i]! * Math.sqrt(w) + samples[length + i]! * Math.sqrt(1 - w);
  }
  return out;
}

/**
 * Karplus–Strong: a burst of noise circulates in a delay line one period long, losing a little and
 * getting a little duller on every pass. An allpass in the loop tunes the fractional part of the period.
 */
export function renderPluck(sampleRate: number, frequency: number, decay: number, bright: number, random: Random): Float32Array {
  const period = sampleRate / frequency;
  const length = Math.floor(period - 0.6);
  const fraction = period - 0.5 - length;
  const allpass = (1 - fraction) / (1 + fraction);
  const perPeriod = 10 ** (-3 / (frequency * decay));
  const loss = Math.min(0.99999, perPeriod / Math.cos((Math.PI * frequency) / sampleRate));

  const line = new Float32Array(length);
  const smooth = 0.12 + 0.88 * Math.min(1, Math.max(0, bright));
  let held = 0;
  let mean = 0;
  for (let i = 0; i < length; i++) {
    held += smooth * (random() * 2 - 1 - held);
    line[i] = held;
    mean += held;
  }
  mean /= length;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    line[i] = line[i]! - mean;
    peak = Math.max(peak, Math.abs(line[i]!));
  }
  for (let i = 0; i < length; i++) line[i] = line[i]! / (peak || 1);

  const total = Math.ceil(decay * 0.85 * sampleRate);
  const out = new Float32Array(total);
  let index = 0;
  let previous = 0;
  let apIn = 0;
  let apOut = 0;
  for (let n = 0; n < total; n++) {
    const x = line[index]!;
    out[n] = x;
    const average = 0.5 * (x + previous);
    previous = x;
    const tuned = allpass * average + apIn - allpass * apOut;
    apIn = average;
    apOut = tuned;
    line[index] = loss * tuned;
    index = index + 1 === length ? 0 : index + 1;
  }
  shapeEdges(out, Math.round(sampleRate * 0.0015), Math.round(sampleRate * 0.03));
  let outPeak = 0;
  for (let n = 0; n < total; n++) outPeak = Math.max(outPeak, Math.abs(out[n]!));
  for (let n = 0; n < total; n++) out[n] = out[n]! / (outPeak || 1);
  return out;
}

/** Raised-cosine fade-in and fade-out so a buffer starts and ends at zero. */
function shapeEdges(samples: Float32Array, fadeIn: number, fadeOut: number): void {
  for (let i = 0; i < fadeIn && i < samples.length; i++) samples[i] = samples[i]! * (0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn));
  for (let i = 0; i < fadeOut && i < samples.length; i++) {
    const n = samples.length - 1 - i;
    samples[n] = samples[n]! * (0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut));
  }
}

/** Noise decaying exponentially to −60 dB over `seconds`, darkened by a 12 dB/octave low-pass. */
export function renderImpulse(sampleRate: number, seconds: number, cutoff: number, random: Random): Float32Array {
  const length = Math.ceil(seconds * sampleRate);
  const out = new Float32Array(length);
  const tau = seconds / Math.log(1000);
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let first = 0;
  let second = 0;
  for (let i = 0; i < length; i++) {
    const noise = (random() * 2 - 1) * Math.exp(-i / sampleRate / tau);
    first += a * (noise - first);
    second += a * (first - second);
    out[i] = second;
  }
  shapeEdges(out, Math.round(sampleRate * 0.004), Math.round(sampleRate * 0.05));
  return out;
}

function toBuffer(ctx: BaseAudioContext, channels: Float32Array[]): AudioBuffer {
  const first = channels[0];
  if (!first) throw new Error('a buffer needs a channel');
  const buffer = ctx.createBuffer(channels.length, first.length, ctx.sampleRate);
  channels.forEach((data, channel) => buffer.getChannelData(channel).set(data));
  return buffer;
}

const kits = new WeakMap<BaseAudioContext, Kit>();

export function kitFor(ctx: BaseAudioContext): Kit {
  const known = kits.get(ctx);
  if (known) return known;
  const rate = ctx.sampleRate;
  const whiteFade = Math.round(rate * 0.05);
  const brownFade = Math.round(rate * 0.25);
  const plucks = new Map<string, AudioBuffer>();
  const kit: Kit = {
    white: toBuffer(ctx, [loopSeamlessly(whiteNoise(rate * 4 + whiteFade, seeded(11)), whiteFade)]),
    brown: toBuffer(ctx, [loopSeamlessly(brownNoise(rate * 8 + brownFade, seeded(12)), brownFade)]),
    impulse: toBuffer(ctx, [renderImpulse(rate, 2.2, 4000, seeded(13)), renderImpulse(rate, 2.2, 4000, seeded(14))]),
    pluck(midi, decay, bright) {
      const key = `${midi}:${decay.toFixed(2)}:${bright.toFixed(2)}`;
      let buffer = plucks.get(key);
      if (!buffer) {
        buffer = toBuffer(ctx, [renderPluck(rate, midiToHz(midi), decay, bright, seeded(1000 + midi))]);
        plucks.set(key, buffer);
      }
      return buffer;
    },
  };
  kits.set(ctx, kit);
  return kit;
}
