// Node helpers and the three instruments the music and some effects share: plucked string, xiao, drone.
// Factory methods (createGain…) rather than node constructors keep this usable with older Safari.
import { midiToHz } from './kit';
import { SourceVoice, type SoundStart } from './registry';

export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = Math.SQRT1_2): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

export function panner(ctx: BaseAudioContext, pan: number): StereoPannerNode {
  const node = ctx.createStereoPanner();
  node.pan.value = pan;
  return node;
}

export function oscillator(ctx: BaseAudioContext, type: OscillatorType, frequency: number): OscillatorNode {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  return node;
}

/** A looping noise source from the kit, started `at`, reading from `offset` seconds into the buffer. */
export function noise(start: SoundStart, kind: 'white' | 'brown', at: number, offset = 0): AudioBufferSourceNode {
  const source = start.ctx.createBufferSource();
  const buffer = start.kit[kind];
  source.buffer = buffer;
  source.loop = true;
  source.start(at, offset % buffer.duration);
  return source;
}

/** Connects nodes in a row and returns the last, for chains like source → filter → gain. */
export function chain<T extends AudioNode>(first: AudioNode, ...rest: [...AudioNode[], T]): T {
  let node = first;
  for (const next of rest) {
    node.connect(next);
    node = next;
  }
  return node as T;
}

export interface PluckOptions {
  velocity: number;
  /** Seconds to fall 60 dB. */
  decay: number;
  /** 0 is a dull, thumbed pluck; 1 a bright, picked one. */
  bright: number;
  pan?: number;
  lowpass?: number;
}

/** Plays a pre-rendered plucked note and returns when it has died away. */
export function pluck(start: SoundStart, midi: number, at: number, options: PluckOptions): number {
  const { ctx } = start;
  const buffer = start.kit.pluck(midi, options.decay, options.bright);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  let node: AudioNode = chain(source, gain(ctx, options.velocity));
  if (options.lowpass) node = chain(node, filter(ctx, 'lowpass', options.lowpass));
  if (options.pan) node = chain(node, panner(ctx, options.pan));
  node.connect(start.out);
  source.start(at);
  return at + buffer.duration;
}

/**
 * Xiao: a sine with a fifth of its octave, a little band-passed breath, 120 ms to speak, and after
 * 400 ms a vibrato of five cycles a second, six cents either way. Returns when the note has gone.
 */
export function xiao(start: SoundStart, midi: number, at: number, length: number, level: number, pan = 0): number {
  const { ctx } = start;
  const frequency = midiToHz(midi);
  const hold = at + Math.max(0.25, length);
  const end = hold + 0.3;

  const amp = gain(ctx, 0);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(level, at + 0.12);
  amp.gain.linearRampToValueAtTime(level * 1.08, at + Math.max(0.3, length * 0.45));
  amp.gain.linearRampToValueAtTime(level * 0.9, hold);
  amp.gain.linearRampToValueAtTime(0, end);

  const tone = oscillator(ctx, 'sine', frequency);
  const octave = oscillator(ctx, 'sine', frequency * 2);
  tone.connect(amp);
  chain(octave, gain(ctx, 0.2), amp);

  const vibrato = oscillator(ctx, 'sine', 5);
  const depth = gain(ctx, 0);
  vibrato.connect(depth);
  depth.connect(tone.detune);
  depth.connect(octave.detune);
  depth.gain.setValueAtTime(0, at + 0.4);
  depth.gain.linearRampToValueAtTime(6, at + 0.7);

  const breathLevel = gain(ctx, 0);
  breathLevel.gain.setValueAtTime(0.5, at);
  breathLevel.gain.setTargetAtTime(0.18, at + 0.04, 0.08);
  const breath = noise(start, 'white', at, start.random() * 4);
  chain(breath, filter(ctx, 'bandpass', Math.min(3600, Math.max(1500, frequency * 3)), 1.2), breathLevel, amp);

  chain(amp, panner(ctx, pan), start.out);
  for (const source of [tone, octave, vibrato]) {
    source.start(at);
    source.stop(end + 0.02);
  }
  breath.stop(end + 0.02);
  return end;
}

/**
 * A held, softly breathing tone (or interval) under the music. It fades in over `fade` and runs
 * until the returned voice is stopped; whoever stops it fades it out first.
 */
export function drone(start: SoundStart, midis: readonly number[], at: number, level: number, fade: number): SourceVoice {
  const { ctx } = start;
  const held = new SourceVoice();
  const amp = gain(ctx, 0);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(level, at + fade);
  const lowest = midiToHz(Math.min(...midis));
  const tone = filter(ctx, 'lowpass', Math.min(900, lowest * 4), 0.5);
  const breathing = gain(ctx, 1);
  chain(tone, breathing, amp, start.out);
  for (const midi of midis) {
    for (const cents of [-4, 4]) {
      const string = held.add(oscillator(ctx, 'triangle', midiToHz(midi)));
      string.detune.value = cents;
      chain(string, gain(ctx, 0.5 / midis.length), tone);
      string.start(at);
    }
  }
  const sway = held.add(oscillator(ctx, 'sine', 0.15));
  chain(sway, gain(ctx, 0.12)).connect(breathing.gain);
  sway.start(at);
  return held;
}
