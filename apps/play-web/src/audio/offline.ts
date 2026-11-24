// Offline renders of the real sound graph (same mixer, limiter, player and crossfades as the live
// engine), measured. tools/audio-check.mjs runs these in headless Chrome through the lab page.
import { builtInSounds } from './catalog';
import { CROSSFADE } from './engine';
import { chain, gain, oscillator } from './instruments';
import { kitFor } from './kit';
import * as meter from './meter';
import { createMixer } from './mixer';
import type { Mood } from './music';
import { CrossfadeSlot, Player } from './player';
import { seeded } from './random';
import { SourceVoice, SoundRegistry, type PlayedNote, type SoundDef } from './registry';
import { DEFAULT_BUSES, copyBuses, type BusName, type BusSettings } from './settings';
import { downmix, encodeWav, toBase64 } from './wav';

export const CHECK_RATE = 44100;

export type Volumes = 'default' | 'full';

export interface Levels {
  peakDb: number;
  clipped: number;
  /** BS.1770 integrated loudness of the measured span, LUFS. */
  integrated: number;
  /** Short-term (3 s) loudness over the span when it is long enough, LUFS and LU. */
  shortTerm: { median: number; min: number; max: number; lra: number } | null;
}

export interface Rendered {
  seconds: number;
  levels: Levels;
  /** Base64 of a mono 16-bit WAV, when asked for. */
  wav?: string;
}

function busSettings(kind: Volumes, off?: BusName): BusSettings {
  const settings = copyBuses(DEFAULT_BUSES);
  if (kind === 'full') for (const bus of Object.values(settings)) bus.volume = 1;
  if (off) settings[off].on = false;
  return settings;
}

/** A steady sine on a bus: test signals for the crossfade and calibration checks. */
function tone(frequency: number, amplitude: number): SoundDef {
  return {
    bus: 'sfx',
    loop: true,
    release: 0.05,
    start(s) {
      const voice = new SourceVoice();
      const sine = voice.add(oscillator(s.ctx, 'sine', frequency));
      chain(sine, gain(s.ctx, amplitude), s.out);
      sine.start(s.when);
      return voice;
    },
  };
}

function checkSounds(): SoundRegistry {
  const registry = builtInSounds();
  registry.register('probe.low', tone(400, 0.25));
  registry.register('probe.high', tone(900, 0.25));
  registry.register('probe.calibrate', tone(1000, 10 ** (-30 / 20)));
  return registry;
}

async function render(seconds: number, settings: BusSettings, seed: number, script: (player: Player) => void): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * CHECK_RATE), sampleRate: CHECK_RATE });
  const player = new Player(createMixer(ctx, settings, kitFor(ctx).impulse), checkSounds(), seeded(seed));
  script(player);
  player.pump(seconds);
  return ctx.startRendering();
}

function channels(buffer: AudioBuffer, from = 0, to = buffer.duration): Float32Array[] {
  const start = Math.round(from * buffer.sampleRate);
  const end = Math.min(buffer.length, Math.round(to * buffer.sampleRate));
  return [0, 1].map((channel) => buffer.getChannelData(channel).subarray(start, end));
}

export function measure(buffer: AudioBuffer, from = 0, to = buffer.duration): Levels {
  const data = channels(buffer, from, to);
  const powers = meter.segmentPowers(data, buffer.sampleRate);
  const { peak, clipped } = meter.samplePeak(data);
  const shortTerm = meter.shortTerm(powers).sort((a, b) => a - b);
  return {
    peakDb: meter.dbfs(peak),
    clipped,
    integrated: meter.integrated(powers),
    shortTerm:
      shortTerm.length === 0
        ? null
        : { median: meter.percentile(shortTerm, 0.5), min: shortTerm[0]!, max: shortTerm[shortTerm.length - 1]!, lra: meter.loudnessRange(powers) },
  };
}

function wav(buffer: AudioBuffer, from: number, to: number): string {
  return toBase64(encodeWav(downmix(channels(buffer, from, to)), buffer.sampleRate));
}

/** Where the sound has died away: the last sample above −80 dBFS, plus a breath. */
function audibleEnd(buffer: AudioBuffer): number {
  let last = 0;
  for (const data of channels(buffer)) {
    for (let i = data.length - 1; i > last; i--) {
      if (Math.abs(data[i]!) > 1e-4) {
        last = i;
        break;
      }
    }
  }
  return Math.min(buffer.duration, last / buffer.sampleRate + 0.05);
}

export interface SoundJob {
  name: string;
  volumes: Volumes;
  seed: number;
  /** Loops only: how long to let it run before stopping it. */
  hold?: number;
  wav?: boolean;
}

/**
 * One-shots are measured whole (integrated loudness). Loops run for `hold` seconds, starting the way
 * the engine starts them (ambience fades in over the crossfade), and are measured on their steady part.
 */
export async function renderSound(job: SoundJob): Promise<Rendered & { loop: boolean }> {
  const def = checkSounds().get(job.name);
  if (!def) throw new Error(`no sound ${job.name}`);
  const hold = job.hold ?? 7;
  const fadeIn = def.loop && def.bus !== 'sfx' ? CROSSFADE : 0;
  const seconds = def.loop ? hold + (def.release ?? 0) + 0.5 : 7;
  const buffer = await render(seconds, busSettings(job.volumes), job.seed, (player) => {
    const voice = player.start(job.name, { seed: job.seed }, 0, fadeIn);
    if (def.loop) voice?.fadeOut(hold);
  });
  const levels = def.loop ? measure(buffer, Math.max(1, fadeIn + 0.5), hold) : measure(buffer);
  const end = def.loop ? hold + (def.release ?? 0) : audibleEnd(buffer);
  return { seconds: end, levels, loop: def.loop, wav: job.wav ? wav(buffer, 0, end) : undefined };
}

export interface MusicJob {
  mood: Mood;
  seconds: number;
  volumes: Volumes;
  seed: number;
  /** How many seconds from the start to return as a WAV. */
  wavSeconds?: number;
}

export interface MinuteComparison {
  counts: number[];
  /** For each pair of adjacent minutes: identical note sequences? */
  identical: boolean[];
  /** For each pair of adjacent minutes: the longest run of notes they share. */
  longestShared: number[];
}

/** Longest common run of two sequences (dynamic programming; minutes hold at most a few hundred notes). */
function longestRun(a: readonly string[], b: readonly string[]): number {
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = previous[j - 1]! + 1;
        best = Math.max(best, row[j]!);
      }
    }
    previous = row;
  }
  return best;
}

export function compareMinutes(notes: readonly PlayedNote[], minutes: number): MinuteComparison {
  const sequences = Array.from({ length: minutes }, (_, minute) =>
    notes.filter((note) => note.time >= minute * 60 && note.time < (minute + 1) * 60).map((note) => `${note.instrument}:${note.midi}`),
  );
  const pairs = sequences.slice(1).map((sequence, i) => [sequences[i]!, sequence] as const);
  return {
    counts: sequences.map((sequence) => sequence.length),
    identical: pairs.map(([a, b]) => a.length === b.length && a.every((note, i) => note === b[i])),
    longestShared: pairs.map(([a, b]) => longestRun(a, b)),
  };
}

/** A mood for `seconds`, measured after its fade-in; the notes it played are compared minute by minute. */
export async function renderMusic(job: MusicJob): Promise<Rendered & { minutes: MinuteComparison; shortTermSeries: number[] }> {
  const notes: PlayedNote[] = [];
  const buffer = await render(job.seconds, busSettings(job.volumes), job.seed, (player) => {
    player.start(`music.${job.mood}`, { seed: job.seed, onNote: (note) => notes.push(note) }, 0, CROSSFADE);
  });
  const settled = CROSSFADE;
  const powers = meter.segmentPowers(channels(buffer, settled), buffer.sampleRate);
  return {
    seconds: job.seconds,
    levels: measure(buffer, settled),
    minutes: compareMinutes(notes, Math.floor(job.seconds / 60)),
    shortTermSeries: meter.shortTerm(powers).filter((_, i) => i % 10 === 0),
    wav: job.wavSeconds ? wav(buffer, 0, job.wavSeconds) : undefined,
  };
}

export interface TransitionJob {
  from: string | null;
  to: string | null;
  at: number;
  seconds: number;
  seed: number;
}

export interface TransitionReport {
  /** Largest change between neighbouring momentary values (100 ms apart) in the steady parts, LU. */
  steadyStep: number;
  /** The same across the crossfade. */
  changeStep: number;
  /** Quietest momentary value in the steady parts and across the crossfade, LUFS. */
  steadyLow: number;
  changeLow: number;
}

function stepsAndLows(values: readonly number[], ranges: readonly (readonly [number, number])[]): { step: number; low: number } {
  let step = 0;
  let low = Infinity;
  for (const [from, to] of ranges) {
    for (let i = Math.max(0, from); i <= to && i < values.length; i++) {
      low = Math.min(low, values[i]!);
      if (i > from) step = Math.max(step, Math.abs(values[i]! - values[i - 1]!));
    }
  }
  return { step, low };
}

/** Plays `from`, switches to `to` at `at` through the engine's crossfade, and compares the seams. */
export async function renderTransition(job: TransitionJob): Promise<Rendered & { report: TransitionReport }> {
  const buffer = await render(job.seconds, busSettings('default'), job.seed, (player) => {
    const slot = new CrossfadeSlot(player);
    slot.switchTo(job.from, 0, CROSSFADE);
    player.pump(job.at);
    slot.switchTo(job.to, job.at, CROSSFADE);
  });
  const values = meter.momentary(meter.segmentPowers(channels(buffer), buffer.sampleRate));
  const index = (seconds: number): number => Math.round(seconds / meter.SEGMENT_SECONDS);
  const window = meter.BLOCK_SEGMENTS;
  const before: [number, number] = [index(CROSSFADE + 0.5), index(job.at) - window];
  const change: [number, number] = [index(job.at) - window, index(job.at + CROSSFADE)];
  const after: [number, number] = [index(job.at + CROSSFADE + 0.5), values.length - 1];
  const steadyRanges = [job.from ? before : null, job.to ? after : null].filter((range): range is [number, number] => range !== null);
  const steady = stepsAndLows(values, steadyRanges);
  const across = stepsAndLows(values, [change]);
  return {
    seconds: job.seconds,
    levels: measure(buffer),
    report: { steadyStep: steady.step, changeStep: across.step, steadyLow: steady.low, changeLow: across.low },
  };
}

export interface ProbeReport {
  /** Largest sample-to-sample jump during each crossfade, over the largest in the steady parts. */
  jumpRatios: number[];
  /** Largest change of the 10 ms RMS between neighbouring frames during each crossfade, over the steady RMS. */
  envelopeSteps: number[];
}

/**
 * Two steady sines switched through the engine's crossfade (silence → low → high → silence). With
 * pure tones any click or cut shows plainly, which real ambiences with their own crackle would hide.
 */
export async function renderProbe(): Promise<ProbeReport> {
  const plan: [string | null, number][] = [['probe.low', 0], ['probe.high', 4], [null, 8]];
  const seconds = 11;
  const buffer = await render(seconds, busSettings('full'), 1, (player) => {
    const slot = new CrossfadeSlot(player);
    for (const [name, at] of plan) {
      player.pump(at);
      slot.switchTo(name, at, CROSSFADE);
    }
  });
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const maxJump = (from: number, to: number): number => {
    let jump = 0;
    for (let i = Math.round(from * rate) + 1; i < Math.round(to * rate); i++) jump = Math.max(jump, Math.abs(data[i]! - data[i - 1]!));
    return jump;
  };
  const frame = Math.round(rate * 0.01);
  const rms = (start: number): number => {
    let sum = 0;
    for (let i = start; i < start + frame; i++) sum += data[i]! * data[i]!;
    return Math.sqrt(sum / frame);
  };
  const steadyJump = Math.max(maxJump(2.2, 3.9), maxJump(6.2, 7.9));
  const steadyRms = Math.max(rms(Math.round(3 * rate)), rms(Math.round(7 * rate)));
  const changes: [number, number][] = [[0, 2.2], [3.9, 6.2], [7.9, 10.2]];
  return {
    jumpRatios: changes.map(([from, to]) => maxJump(from, to) / steadyJump),
    envelopeSteps: changes.map(([from, to]) => {
      let step = 0;
      for (let i = Math.round(from * rate) + frame; i + frame < Math.round(to * rate); i += frame) step = Math.max(step, Math.abs(rms(i) - rms(i - frame)));
      return step / steadyRms;
    }),
  };
}

/** Many loud things at once, every bus at full volume: the limiter must keep it under −1 dBFS. */
export async function renderStack(seed: number): Promise<Rendered> {
  const cues: [string, number][] = [
    ['fx.formation', 2.8],
    ['ui.seal', 3],
    ['fx.bell', 3],
    ['ui.tap', 3.02],
    ['ui.receipt', 3.05],
    ['fx.sword', 3.1],
    ['fx.dice', 3.2],
    ['fx.thunder', 3.4],
    ['ui.error', 3.5],
  ];
  const buffer = await render(10, busSettings('full'), seed, (player) => {
    player.start('music.tense', {}, 0, CROSSFADE);
    player.start('amb.rain', {}, 0, CROSSFADE);
    player.start('fx.gather', {}, 1)?.fadeOut(8);
    for (const [name, at] of cues) player.start(name, {}, at);
  });
  return { seconds: 10, levels: measure(buffer) };
}

/** A sound with one bus switched off must be silent. */
export async function renderMuted(name: string, off: BusName, seed: number): Promise<Rendered> {
  const buffer = await render(4, busSettings('default', off), seed, (player) => {
    player.start(name, {}, 0, 0.5);
  });
  return { seconds: 4, levels: measure(buffer) };
}

/** Gain of the whole chain for a quiet signal, which should be unity once the limiter's make-up is trimmed. */
export async function calibrate(): Promise<number> {
  const buffer = await render(2, busSettings('full'), 1, (player) => {
    player.start('probe.calibrate', {}, 0);
  });
  const data = buffer.getChannelData(0).subarray(CHECK_RATE * 0.5, CHECK_RATE * 1.5);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
  return meter.dbfs(Math.sqrt((2 * sum) / data.length)) + 30;
}
