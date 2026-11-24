// Loudness after ITU-R BS.1770-4 (K-weighting, gated 400 ms blocks) and EBU Tech 3341/3342
// (3 s short-term loudness, loudness range), plus sample peak. Pure functions over rendered samples,
// used by the audio check and the lab.

/** Signals are measured in 100 ms segments; blocks and windows are whole numbers of them. */
export const SEGMENT_SECONDS = 0.1;
export const BLOCK_SEGMENTS = 4;
export const SHORT_TERM_SEGMENTS = 30;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages for any sample rate (the analog prototypes of BS.1770, as in libebur128). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
  };
  const passK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const passQ = 0.5003270373238773;
  const passA0 = 1 + passK / passQ + passK * passK;
  const highpass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (passK * passK - 1)) / passA0,
    a2: (1 - passK / passQ + passK * passK) / passA0,
  };
  return [shelf, highpass];
}

/** K-weighted mean square of each 100 ms segment, summed over the channels (weight 1 each). */
export function segmentPowers(channels: readonly Float32Array[], sampleRate: number): Float64Array {
  const size = Math.round(sampleRate * SEGMENT_SECONDS);
  const count = Math.floor((channels[0]?.length ?? 0) / size);
  const powers = new Float64Array(count);
  const [shelf, pass] = kWeighting(sampleRate);
  for (const data of channels) {
    let s1 = 0;
    let s2 = 0;
    let p1 = 0;
    let p2 = 0;
    for (let segment = 0; segment < count; segment++) {
      let sum = 0;
      for (let n = segment * size, last = n + size; n < last; n++) {
        const x = data[n]!;
        const y = shelf.b0 * x + s1;
        s1 = shelf.b1 * x - shelf.a1 * y + s2;
        s2 = shelf.b2 * x - shelf.a2 * y;
        const z = pass.b0 * y + p1;
        p1 = pass.b1 * y - pass.a1 * z + p2;
        p2 = pass.b2 * y - pass.a2 * z;
        sum += z * z;
      }
      powers[segment] = powers[segment]! + sum / size;
    }
  }
  return powers;
}

export function lufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

export function dbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

/** Mean power of every run of `width` segments, stepping one segment at a time. */
export function windowed(powers: Float64Array, width: number): Float64Array {
  const out = new Float64Array(Math.max(0, powers.length - width + 1));
  let sum = 0;
  for (let i = 0; i < powers.length; i++) {
    sum += powers[i]!;
    if (i >= width) sum -= powers[i - width]!;
    if (i >= width - 1) out[i - width + 1] = Math.max(0, sum) / width;
  }
  return out;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** BS.1770-4 integrated loudness: 400 ms blocks, gated at −70 LUFS and 10 LU under their mean. */
export function integrated(powers: Float64Array): number {
  const blocks = [...windowed(powers, BLOCK_SEGMENTS)].filter((power) => lufs(power) > -70);
  if (blocks.length === 0) return -Infinity;
  const gate = lufs(mean(blocks)) - 10;
  const kept = blocks.filter((power) => lufs(power) > gate);
  return lufs(mean(kept));
}

/** Short-term loudness (3 s windows, 100 ms apart), in LUFS. */
export function shortTerm(powers: Float64Array): number[] {
  return [...windowed(powers, SHORT_TERM_SEGMENTS)].map(lufs);
}

/** Momentary loudness (400 ms windows, 100 ms apart), in LUFS. */
export function momentary(powers: Float64Array): number[] {
  return [...windowed(powers, BLOCK_SEGMENTS)].map(lufs);
}

/** Linear interpolation between the closest ranks of an ascending list. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return NaN;
  const position = (sorted.length - 1) * fraction;
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below);
}

/** EBU Tech 3342 loudness range: 95th minus 10th percentile of gated short-term loudness. */
export function loudnessRange(powers: Float64Array): number {
  const windows = [...windowed(powers, SHORT_TERM_SEGMENTS)].filter((power) => lufs(power) > -70);
  if (windows.length < 2) return 0;
  const gate = lufs(mean(windows)) - 20;
  const kept = windows.map(lufs).filter((value) => value > gate).sort((a, b) => a - b);
  return percentile(kept, 0.95) - percentile(kept, 0.1);
}

/** Highest absolute sample, and how many samples reach full scale. */
export function samplePeak(channels: readonly Float32Array[]): { peak: number; clipped: number } {
  let peak = 0;
  let clipped = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]!);
      if (value > peak) peak = value;
      if (value >= 1) clipped++;
    }
  }
  return { peak, clipped };
}
