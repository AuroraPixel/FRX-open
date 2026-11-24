// Interface sounds and effects. Recipes from the implementation guide, section 7; how each should
// feel is in the interface spec, section 10. Levels were set with tools/audio-check.mjs so that sounds
// of one kind measure within 3 LU of each other.
import { chain, filter, gain, noise, oscillator, pluck } from './instruments';
import { between } from './random';
import { SourceVoice, type SoundDef, type SoundStart, type Voice } from './registry';

export type SfxName =
  | 'ui.tap'
  | 'ui.page'
  | 'ui.seal'
  | 'ui.receipt'
  | 'ui.error'
  | 'fx.gather'
  | 'fx.bell'
  | 'fx.thunder'
  | 'fx.sword'
  | 'fx.dice'
  | 'fx.formation';

// Output level of each sound, set by measurement (tools/audio-check.mjs); the mix inside a sound is
// written relative to 1.
const LEVEL: Readonly<Record<SfxName, number>> = {
  'ui.tap': 1.97,
  'ui.page': 0.79,
  'ui.seal': 1.37,
  'ui.receipt': 1.39,
  'ui.error': 3.13,
  'fx.gather': 0.63,
  'fx.bell': 0.22,
  'fx.thunder': 1.03,
  'fx.sword': 0.27,
  'fx.dice': 2.03,
  'fx.formation': 0.135,
};

/** A gain that jumps to `peak` over `attack` seconds, then decays with time constant `tau`. */
function strike(s: SoundStart, at: number, peak: number, attack: number, tau: number): GainNode {
  const node = gain(s.ctx, 0);
  node.gain.setValueAtTime(0, at);
  node.gain.linearRampToValueAtTime(peak, at + attack);
  node.gain.setTargetAtTime(0, at + attack, tau);
  return node;
}

/** A sine (or other wave) shaped by `strike`, connected to `out`, stopped at `stop`. */
function ping(s: SoundStart, voice: SourceVoice, at: number, frequency: number, peak: number, tau: number, stop: number, out: AudioNode = s.out): OscillatorNode {
  const tone = voice.add(oscillator(s.ctx, 'sine', frequency));
  chain(tone, strike(s, at, peak, 0.002, tau), out);
  tone.start(at);
  tone.stop(stop);
  return tone;
}

// 竹片轻敲：干、短、不刺 — a dry little knock, 0.06 s.
function tap(s: SoundStart): Voice {
  const t = s.when;
  const voice = new SourceVoice(t + 0.08);
  const burst = voice.add(noise(s, 'white', t, s.random() * 4));
  const click = gain(s.ctx, 0);
  click.gain.setValueAtTime(0, t);
  click.gain.linearRampToValueAtTime(1.2, t + 0.0005);
  click.gain.linearRampToValueAtTime(0, t + 0.006);
  chain(burst, click, filter(s.ctx, 'bandpass', 2200, 8), s.out);
  burst.stop(t + 0.03);
  ping(s, voice, t, 1800, 1, 0.008, t + 0.08);
  return voice;
}

// 纸页擦过：一小段沙沙声 — paper brushing past, 0.25 s.
function page(s: SoundStart): Voice {
  const t = s.when;
  const voice = new SourceVoice(t + 0.3);
  const hiss = voice.add(noise(s, 'white', t, s.random() * 4));
  const band = filter(s.ctx, 'bandpass', 1200, 1.1);
  band.frequency.setValueAtTime(1200, t);
  band.frequency.exponentialRampToValueAtTime(3000, t + 0.25);
  // Paper does not slide evenly: a little random flutter on the level.
  const flutter = gain(s.ctx, 1);
  const grain = new Float32Array(24).map(() => 0.65 + 0.35 * s.random());
  flutter.gain.setValueCurveAtTime(grain, t, 0.26);
  const level = gain(s.ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(1, t + 0.02);
  level.gain.linearRampToValueAtTime(0.75, t + 0.13);
  level.gain.linearRampToValueAtTime(0, t + 0.26);
  chain(hiss, band, flutter, level, s.out);
  hiss.stop(t + 0.3);
  return voice;
}

// 落印：闷而实的木头声，极短的余音 — a seal pressed down, 0.18 s. The guide's 110→70 Hz thud is
// under what phone and laptop speakers reproduce, so a short knock near 350 Hz carries it there.
function seal(s: SoundStart): Voice {
  const t = s.when;
  const voice = new SourceVoice(t + 0.25);
  const thud = ping(s, voice, t, 110, 1, 0.04, t + 0.25);
  thud.frequency.setValueAtTime(110, t);
  thud.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  const knock = ping(s, voice, t, 380, 0.58, 0.018, t + 0.2);
  knock.frequency.setValueAtTime(380, t);
  knock.frequency.exponentialRampToValueAtTime(300, t + 0.05);
  const press = voice.add(noise(s, 'white', t, s.random() * 4));
  const level = gain(s.ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(0.67, t + 0.002);
  level.gain.linearRampToValueAtTime(0, t + 0.04);
  chain(press, filter(s.ctx, 'lowpass', 300), level, s.out);
  press.stop(t + 0.06);
  return voice;
}

// 回执：一声清亮的拨弦 — one clear plucked D4, 0.6 s.
function receipt(s: SoundStart): Voice {
  return new SourceVoice(pluck(s, 62, s.when, { velocity: 1, decay: 0.6, bright: 0.85 }));
}

// 出错：低一个音、哑一些 — a lower, muffled pluck (A3 under 900 Hz), 0.4 s.
function error(s: SoundStart): Voice {
  return new SourceVoice(pluck(s, 57, s.when, { velocity: 1, decay: 0.42, bright: 0.45, lowpass: 900 }));
}

/** A slow sine that starts at its lowest point, for sweeps that should begin low. */
function lowStartLfo(s: SoundStart, voice: SourceVoice, rate: number): OscillatorNode {
  const lfo = voice.add(oscillator(s.ctx, 'sine', rate));
  lfo.setPeriodicWave(s.ctx.createPeriodicWave(new Float32Array([0, -1]), new Float32Array([0, 0]), { disableNormalization: true }));
  return lfo;
}

// 聚气：由低到高的风声加一层细细的泛音，可以一直持续 — reaches full strength in 0.8 s, loops.
function gather(s: SoundStart): Voice {
  const t = s.when;
  const voice = new SourceVoice();
  const swell = gain(s.ctx, 0);
  swell.gain.setValueAtTime(0, t);
  swell.gain.linearRampToValueAtTime(1, t + 0.8);
  swell.connect(s.out);

  const wind = voice.add(noise(s, 'white', t, s.random() * 4));
  const band = filter(s.ctx, 'bandpass', 750, 2.5);
  const sweep = lowStartLfo(s, voice, 0.3);
  chain(sweep, gain(s.ctx, 450)).connect(band.frequency);
  chain(wind, band, swell);

  const shimmer = gain(s.ctx, 0);
  shimmer.gain.setValueAtTime(0, t);
  shimmer.gain.linearRampToValueAtTime(0.06, t + 1.5);
  shimmer.connect(swell);
  for (const cents of [0, 7]) {
    const tone = voice.add(oscillator(s.ctx, 'sine', 1174.66));
    tone.detune.value = cents;
    tone.connect(shimmer);
    tone.start(t);
  }
  sweep.start(t);
  return voice;
}

// 突破的钟：一声钟，余音很长 — nine inharmonic partials over a 110 Hz strike, the high ones die first.
const BELL_RATIOS = [0.56, 0.92, 1.19, 1.71, 2.0, 2.74, 3.0, 3.76, 4.07];
const BELL_AMPS = [0.5, 0.6, 0.9, 0.55, 0.65, 0.4, 0.35, 0.25, 0.2];
function bell(s: SoundStart): Voice {
  const t = s.when;
  const end = t + 6;
  const voice = new SourceVoice(end);
  const out = s.out;
  BELL_RATIOS.forEach((ratio, i) => {
    const frequency = 110 * ratio;
    const t60 = Math.min(6, 6 * (61.6 / frequency) ** 0.6);
    const amp = BELL_AMPS[i] ?? 0;
    ping(s, voice, t, frequency, amp, t60 / Math.log(1000), end, out);
    // The low partials beat slowly against a near twin, the bell's "wah".
    if (i < 4) ping(s, voice, t, frequency + 0.45 + 0.2 * i, amp * 0.45, t60 / Math.log(1000), end, out);
  });
  const hit = voice.add(noise(s, 'white', t, s.random() * 4));
  const level = gain(s.ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(0.6, t + 0.002);
  level.gain.linearRampToValueAtTime(0, t + 0.03);
  chain(hit, filter(s.ctx, 'lowpass', 1500), level, out);
  hit.stop(t + 0.05);
  return voice;
}

// 远雷：滚过的低沉雷声 — brown noise under 120 Hz with a random rolling envelope, 3 s. A quieter band
// around 260 Hz lets small speakers hear it at all.
function thunder(s: SoundStart): Voice {
  const t = s.when;
  const length = 3;
  const voice = new SourceVoice(t + length + 0.05);
  const rumble = voice.add(noise(s, 'brown', t, s.random() * 8));
  const envelope = gain(s.ctx, 0);
  envelope.gain.setValueCurveAtTime(rollCurve(s, 64), t, length);
  chain(rumble, filter(s.ctx, 'lowpass', 120, 0.8), envelope);
  chain(rumble, filter(s.ctx, 'bandpass', 260, 0.9), gain(s.ctx, 0.35), envelope);
  envelope.connect(s.out);
  rumble.stop(t + length + 0.05);
  return voice;
}

/** A quick rise, then a slow uneven fall to silence: the roll of distant thunder. */
function rollCurve(s: SoundStart, points: number): Float32Array {
  const curve = new Float32Array(points);
  let wobble = 0.5;
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1);
    const arc = x < 0.08 ? x / 0.08 : (1 - (x - 0.08) / 0.92) ** 1.4;
    wobble = 0.6 * wobble + 0.4 * s.random();
    curve[i] = arc * (0.5 + 0.5 * wobble);
  }
  curve[points - 1] = 0;
  return curve;
}

// 剑鸣：高而细的金属长音，起音快 — FM, carrier 2.4 kHz, modulator 3.1 kHz, index 2, 1.2 s.
function sword(s: SoundStart): Voice {
  const t = s.when;
  const end = t + 1.3;
  const voice = new SourceVoice(end);
  const tone = filter(s.ctx, 'lowpass', 9000);
  tone.connect(s.out);
  for (const [detune, share] of [[1, 1], [1.0031, 0.5]] as const) {
    const carrier = voice.add(oscillator(s.ctx, 'sine', 2400 * detune));
    const modulator = voice.add(oscillator(s.ctx, 'sine', 3100 * detune));
    const index = gain(s.ctx, 2 * 3100 * detune);
    index.gain.setValueAtTime(2 * 3100 * detune, t);
    index.gain.setTargetAtTime(0.4 * 3100 * detune, t, 0.25);
    chain(modulator, index).connect(carrier.frequency);
    chain(carrier, strike(s, t, share, 0.004, 0.2), tone);
    carrier.start(t);
    modulator.start(t);
    carrier.stop(end);
    modulator.stop(end);
  }
  const draw = voice.add(noise(s, 'white', t, s.random() * 4));
  const level = gain(s.ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(0.5, t + 0.002);
  level.gain.linearRampToValueAtTime(0, t + 0.06);
  chain(draw, filter(s.ctx, 'highpass', 4500), level, tone);
  draw.stop(t + 0.08);
  return voice;
}

// 掷骰：两三下轻脆的骨头碰撞 — three short 3 kHz knocks, 60 to 90 ms apart.
function dice(s: SoundStart): Voice {
  let at = s.when;
  const voice = new SourceVoice();
  for (const share of [1, 0.75, 0.55]) {
    const knock = voice.add(noise(s, 'white', at, s.random() * 4));
    chain(knock, strike(s, at, share, 0.0005, 0.01), filter(s.ctx, 'bandpass', 3000 * between(s.random, 0.9, 1.15), 5), s.out);
    knock.stop(at + 0.05);
    ping(s, voice, at, 1200 * between(s.random, 0.9, 1.1), share * 0.35, 0.018, at + 0.09);
    at += between(s.random, 0.06, 0.09);
  }
  voice.end = at + 0.09;
  return voice;
}

// 法阵启动 (named in the plan, not in the guide): a rising whoosh that blooms into a soft chord and a
// bright ping as the array lights, 2.4 s.
function formation(s: SoundStart): Voice {
  const t = s.when;
  const end = t + 2.4;
  const voice = new SourceVoice(end);
  const out = s.out;
  const rush = voice.add(noise(s, 'white', t, s.random() * 4));
  const band = filter(s.ctx, 'bandpass', 200, 1.6);
  band.frequency.setValueAtTime(200, t);
  band.frequency.exponentialRampToValueAtTime(2400, t + 0.7);
  const rushLevel = gain(s.ctx, 0);
  rushLevel.gain.setValueAtTime(0, t);
  rushLevel.gain.linearRampToValueAtTime(1.6, t + 0.6);
  rushLevel.gain.linearRampToValueAtTime(0, t + 0.9);
  chain(rush, band, rushLevel, out);
  rush.stop(t + 1);
  for (const [frequency, share] of [[146.83, 1], [220, 0.8], [293.66, 0.7], [440, 0.45]] as const) {
    const tone = voice.add(oscillator(s.ctx, 'sine', frequency));
    const level = gain(s.ctx, 0);
    level.gain.setValueAtTime(0, t + 0.3);
    level.gain.linearRampToValueAtTime(share, t + 0.65);
    level.gain.setTargetAtTime(0, t + 0.65, 0.45);
    chain(tone, level, out);
    tone.start(t + 0.3);
    tone.stop(end);
  }
  ping(s, voice, t + 0.6, 1760, 0.5, 0.3, end, out);
  ping(s, voice, t + 0.6, 2637, 0.2, 0.18, end, out);
  return voice;
}

/** Runs a recipe into its own output gain, set to the sound's measured level. */
function effect(name: SfxName, recipe: (s: SoundStart) => Voice, loop = false): SoundDef {
  return {
    bus: 'sfx',
    loop,
    release: loop ? 1.2 : undefined,
    start(s) {
      const out = gain(s.ctx, LEVEL[name]);
      out.connect(s.out);
      return recipe({ ...s, out });
    },
  };
}

export const SOUNDS: Readonly<Record<SfxName, SoundDef>> = {
  'ui.tap': effect('ui.tap', tap),
  'ui.page': effect('ui.page', page),
  'ui.seal': effect('ui.seal', seal),
  'ui.receipt': effect('ui.receipt', receipt),
  'ui.error': effect('ui.error', error),
  'fx.gather': effect('fx.gather', gather, true),
  'fx.bell': effect('fx.bell', bell),
  'fx.thunder': effect('fx.thunder', thunder),
  'fx.sword': effect('fx.sword', sword),
  'fx.dice': effect('fx.dice', dice),
  'fx.formation': effect('fx.formation', formation),
};
