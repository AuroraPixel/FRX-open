// Generative music: plucked strings walking a pentatonic scale by rule, a xiao that comes in now and
// then for two bars of long notes, and a held drone underneath. It is filler until real pieces exist.
//
// Rules (implementation guide, section 7): four beats a bar; each half-beat sounds with the bar's
// density; a sounding note steps to a neighbour 60% of the time, skips one 25%, leaps otherwise; every
// four bars a phrase ends on the tonic or the fifth with the last beat left empty; the xiao enters
// every 4 to 8 bars for two bars of long notes.
import { drone, gain, pluck, xiao } from './instruments';
import { midiToHz } from './kit';
import { between, pick, seeded, type Random } from './random';
import type { SoundDef, SoundStart, Voice } from './registry';

export type Mood = 'calm' | 'tense' | 'solemn';
export const MOOD_NAMES: readonly Mood[] = ['calm', 'tense', 'solemn'];

export interface MoodSpec {
  /** Semitones above the tonic. The fifth (7) is always the fourth entry. */
  scale: readonly number[];
  /** MIDI note of the tonic. */
  tonic: number;
  bpm: number;
  /** Chance that a half-beat sounds, before the bar's own variation. */
  density: number;
  /**
   * The plucked line never stays silent for this many half-beats: the next one sounds. Long gaps
   * would let the 3 s loudness sag far below the rest (the check allows 6 LU of movement).
   */
  longestRest: number;
  /** Range of the plucked line, in scale steps from the tonic (5 steps make an octave). */
  low: number;
  high: number;
  /** Range of the xiao, in scale steps from the tonic. */
  xiaoLow: number;
  xiaoHigh: number;
  /** Chance that a plucked note is doubled by its fifth. */
  fifths: number;
  /** Notes held under everything, in semitones from the tonic. */
  drone: readonly number[];
  bright: number;
  /** Output level of the mood (set by measurement), and the balance of its three parts. */
  gain: number;
  level: { pluck: number; xiao: number; drone: number };
}

export const MOODS: Readonly<Record<Mood, MoodSpec>> = {
  // 平静: D major pentatonic, sparse, phrases settle on the tonic or the fifth.
  calm: {
    scale: [0, 2, 4, 7, 9],
    tonic: 62,
    bpm: 54,
    density: 0.25,
    longestRest: 6,
    low: -3,
    high: 8,
    xiaoLow: 0,
    xiaoHigh: 6,
    fifths: 0.1,
    drone: [-12, -5],
    bright: 0.7,
    gain: 0.475,
    level: { pluck: 1, xiao: 0.23, drone: 0.36 },
  },
  // 紧张: A minor pentatonic in the low register over a held tonic.
  tense: {
    scale: [0, 3, 5, 7, 10],
    tonic: 57,
    bpm: 76,
    density: 0.5,
    longestRest: 4,
    low: -5,
    high: 4,
    xiaoLow: 3,
    xiaoHigh: 8,
    fifths: 0.05,
    drone: [-12],
    bright: 0.5,
    gain: 0.44,
    level: { pluck: 1, xiao: 0.25, drone: 0.34 },
  },
  // 庄严: G shang mode, slow, often in open fifths.
  solemn: {
    scale: [0, 2, 5, 7, 10],
    tonic: 55,
    bpm: 44,
    density: 0.2,
    longestRest: 6,
    low: -4,
    high: 6,
    xiaoLow: 3,
    xiaoHigh: 8,
    fifths: 0.5,
    drone: [-12, -5],
    bright: 0.6,
    gain: 0.455,
    level: { pluck: 1, xiao: 0.23, drone: 0.4 },
  },
};

export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 4;
const HALF_BEATS = BEATS_PER_BAR * 2;
const TONIC = 0;
const FIFTH = 3;
// Beats per note of a xiao entry; each fills two bars.
const XIAO_RHYTHMS: readonly (readonly number[])[] = [[4, 4], [2, 2, 4], [3, 1, 4], [2, 2, 2, 2], [6, 2], [1, 3, 4]];

export interface NoteEvent {
  /** Seconds from the start of the music. */
  time: number;
  /** Position in beats from the start, before the small human unevenness in `time`. */
  beat: number;
  instrument: 'pluck' | 'xiao';
  midi: number;
  /** Seconds the xiao holds the note; plucks ring on by themselves. */
  length: number;
  velocity: number;
  pan: number;
  /** The note that closes a phrase. */
  cadence: boolean;
}

/** MIDI note of a scale step counted from the tonic. */
export function pitchOf(spec: MoodSpec, step: number): number {
  const octave = Math.floor(step / spec.scale.length);
  const degree = step - octave * spec.scale.length;
  return spec.tonic + 12 * octave + (spec.scale[degree] ?? 0);
}

export function inScale(spec: MoodSpec, midi: number): boolean {
  return spec.scale.includes((((midi - spec.tonic) % 12) + 12) % 12);
}

/** The fifth above if the scale has it, else the fifth below (or a fourth), for doubled notes. */
export function fifthOf(spec: MoodSpec, midi: number): number {
  for (const interval of [7, -7, 5, -5]) if (inScale(spec, midi + interval)) return midi + interval;
  return midi + 12;
}

/** The step nearest `step` whose degree is one of `degrees`, inside [low, high]. */
function nearestDegree(step: number, degrees: readonly number[], low: number, high: number): number {
  let best = step;
  let distance = Infinity;
  for (let candidate = low; candidate <= high; candidate++) {
    const degree = ((candidate % 5) + 5) % 5;
    const away = Math.abs(candidate - step);
    if (degrees.includes(degree) && away < distance) {
      best = candidate;
      distance = away;
    }
  }
  return best;
}

export class MusicGenerator {
  readonly spec: MoodSpec;
  /** Seconds per beat. */
  readonly beat: number;
  private readonly random: Random;
  private bar = 0;
  private step = 0;
  private quiet = 0;
  private xiaoNext: number;
  private xiaoUntil = -1;

  constructor(
    readonly mood: Mood,
    seed: number,
  ) {
    this.spec = MOODS[mood];
    this.beat = 60 / this.spec.bpm;
    this.random = seeded(seed);
    this.xiaoNext = 2 + Math.floor(this.random() * 3);
  }

  get barLength(): number {
    return this.beat * BEATS_PER_BAR;
  }

  /** The notes of the next bar, in time order. */
  nextBar(): NoteEvent[] {
    const index = this.bar++;
    const first = index * BEATS_PER_BAR;
    const notes: NoteEvent[] = [];
    let xiaoBar = index <= this.xiaoUntil;
    if (index === this.xiaoNext) {
      notes.push(...this.xiaoEntry(first));
      this.xiaoUntil = index + 1;
      this.xiaoNext = index + 4 + Math.floor(this.random() * 5);
      xiaoBar = true;
    }
    const closing = index % BARS_PER_PHRASE === BARS_PER_PHRASE - 1;
    const density = this.spec.density * between(this.random, 0.85, 1.15) * (xiaoBar ? 0.5 : 1);
    for (let half = 0; half < HALF_BEATS; half++) {
      const beat = first + half / 2;
      if (closing && half >= HALF_BEATS / 2) {
        if (half === HALF_BEATS / 2) {
          notes.push(...this.cadence(beat, index));
          this.quiet = 0;
        } else {
          this.quiet++;
        }
        continue;
      }
      if (this.random() < density || this.quiet + 1 >= this.spec.longestRest) {
        this.step = this.walk(this.step);
        notes.push(...this.plucked(beat, this.step, false));
        this.quiet = 0;
      } else {
        this.quiet++;
      }
    }
    return notes.sort((a, b) => a.time - b.time);
  }

  private walk(step: number): number {
    const roll = this.random();
    const size = roll < 0.6 ? 1 : roll < 0.85 ? 2 : 3 + Math.floor(this.random() * 3);
    const up = this.random() < 0.5;
    let next = up ? step + size : step - size;
    if (next > this.spec.high || next < this.spec.low) next = up ? step - size : step + size;
    return Math.min(this.spec.high, Math.max(this.spec.low, next));
  }

  /** The phrase's last note: back to the tonic (every second phrase) or to the tonic or fifth. */
  private cadence(beat: number, bar: number): NoteEvent[] {
    const phrase = Math.floor(bar / BARS_PER_PHRASE);
    const homes = phrase % 2 === 1 ? [TONIC] : [TONIC, FIFTH];
    this.step = nearestDegree(this.step, homes, this.spec.low, this.spec.high);
    return this.plucked(beat, this.step, true);
  }

  private plucked(beat: number, step: number, cadence: boolean): NoteEvent[] {
    const time = Math.max(0, beat * this.beat + between(this.random, -0.008, 0.008));
    const accent = beat % 2 === 0 ? 1.06 : 1;
    const velocity = Math.min(1, (cadence ? 0.95 : between(this.random, 0.72, 0.92)) * accent);
    const midi = pitchOf(this.spec, step);
    const pan = between(this.random, -0.25, 0.25);
    const note: NoteEvent = { time, beat, instrument: 'pluck', midi, length: 0, velocity, pan, cadence };
    if (this.random() >= this.spec.fifths) return [note];
    const double: NoteEvent = { ...note, time: time + 0.012, midi: fifthOf(this.spec, midi), velocity: velocity * 0.8, pan: -pan };
    return [note, double];
  }

  /** Two bars of long xiao notes, moving by step and coming to rest on the tonic or the fifth. */
  private xiaoEntry(first: number): NoteEvent[] {
    const { xiaoLow, xiaoHigh } = this.spec;
    const rhythm = pick(this.random, XIAO_RHYTHMS);
    let step = xiaoLow + 1 + Math.floor(this.random() * (xiaoHigh - xiaoLow - 1));
    let beat = first;
    return rhythm.map((beats, i) => {
      const last = i === rhythm.length - 1;
      if (last) step = nearestDegree(step, [TONIC, FIFTH], xiaoLow, xiaoHigh);
      else if (i > 0) step = Math.min(xiaoHigh, Math.max(xiaoLow, step + (this.random() < 0.5 ? -1 : 1)));
      const note: NoteEvent = {
        time: beat * this.beat,
        beat,
        instrument: 'xiao',
        midi: pitchOf(this.spec, step),
        length: beats * this.beat - 0.12,
        velocity: between(this.random, 0.82, 0.95),
        pan: 0.15,
        cadence: last,
      };
      beat += beats;
      return note;
    });
  }
}

/** Seconds a plucked note takes to die away: longer low, shorter high. */
export function pluckDecay(midi: number): number {
  return Math.min(2.6, Math.max(1, 2.6 * (220 / midiToHz(midi)) ** 0.45));
}

function playNote(s: SoundStart, spec: MoodSpec, note: NoteEvent): void {
  const at = s.when + note.time;
  if (note.instrument === 'pluck') {
    pluck(s, note.midi, at, { velocity: spec.level.pluck * note.velocity, decay: pluckDecay(note.midi), bright: spec.bright, pan: note.pan });
  } else {
    xiao(s, note.midi, at, note.length, spec.level.xiao * note.velocity, note.pan);
  }
}

function moodSound(mood: Mood): SoundDef {
  return {
    bus: 'music',
    loop: true,
    release: 2,
    start(outer, params): Voice {
      const spec = MOODS[mood];
      const out = gain(outer.ctx, spec.gain);
      out.connect(outer.out);
      const s = { ...outer, out };
      const generator = new MusicGenerator(mood, Math.floor(s.random() * 4294967296));
      const held = drone(s, spec.drone.map((offset) => spec.tonic + offset), s.when, spec.level.drone, 3);
      const queue: NoteEvent[] = [];
      let written = 0;
      let end = Infinity;
      return {
        get end() {
          return end;
        },
        pump(until) {
          const horizon = until - s.when;
          while (written < horizon + generator.barLength) {
            queue.push(...generator.nextBar());
            written += generator.barLength;
          }
          while (queue.length > 0 && queue[0]!.time < horizon) {
            const note = queue.shift()!;
            playNote(s, spec, note);
            params.onNote?.({ time: s.when + note.time, midi: note.midi, instrument: note.instrument });
          }
        },
        stop(at) {
          end = at;
          held.stop(at);
        },
      };
    },
  };
}

export type MusicName = `music.${Mood}`;

export const MUSIC: Readonly<Record<MusicName, SoundDef>> = {
  'music.calm': moodSound('calm'),
  'music.tense': moodSound('tense'),
  'music.solemn': moodSound('solemn'),
};
