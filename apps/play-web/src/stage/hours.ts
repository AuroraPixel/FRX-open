import type { HourTune } from '../contracts';
import { approach } from './anim';
import type { Hour } from './types';

export type Rgb = [number, number, number];

// Everything about the light that changes with the hour. Night is the pole the layers were painted for; the other
// hours are the "lit" pole and the shaders blend the two by `day` (0 at night, 1 otherwise).
export interface HourLook {
  // 界面规范第九节「时辰」: the generic values; a scene's `hours` may correct these seven
  exposure: number;
  fog: number;
  mist: Rgb;
  key: Rgb;
  tint: Rgb;
  sat: number;
  vignette: number;
  // the sky colour that distance fades to: zenith, horizon away from the sun, horizon towards it, the sun's glow
  zenith: Rgb;
  horizon: Rgb;
  sunward: Rgb;
  sunGlow: Rgb;
  sunColor: Rgb;
  // the stage's own cloud sea, shadow and lit side
  cloudDark: Rgb;
  cloudLit: Rgb;
  // portraits: the ambient light and the mist their feet fade into
  ambient: Rgb;
  foot: Rgb;
  // the panorama's gain, and its regrade while the hour borrows dawn's panorama (the scene loader clears the
  // regrade for an hour whose sky set has its own picture)
  skyGain: number;
  skyTint: Rgb;
  skySat: number;
  // the page's colours: night and dusk read light on dark (0), dawn and day dark on light (1)
  ui: number;
}

// Night and dawn are the prototype's measured values. Day and dusk start from the spec's table; their sky colours,
// cloud colours, portrait light and the stand-in sky regrade are first guesses until item 32 paints their skies.
export const HOURS: Readonly<Record<Hour, HourLook>> = {
  night: {
    exposure: 1.7, fog: 0.0058, mist: [0.1, 0.14, 0.22], key: [0.42, 0.56, 0.9], tint: [1, 1, 1], sat: 1, vignette: 0.6,
    zenith: [0.26, 0.42, 0.7], horizon: [0.86, 0.66, 0.62], sunward: [1.1, 0.74, 0.42], sunGlow: [1.0, 0.66, 0.36],
    sunColor: [1.0, 0.74, 0.44], cloudDark: [0.42, 0.36, 0.48], cloudLit: [1.05, 0.84, 0.66],
    ambient: [0.74, 0.6, 0.5], foot: [0.9, 0.68, 0.58], skyGain: 0.5, skyTint: [1, 1, 1], skySat: 1, ui: 0,
  },
  dawn: {
    exposure: 1.05, fog: 0.0026, mist: [0.8, 0.62, 0.56], key: [1.0, 0.68, 0.4], tint: [2.3, 1.75, 1.45], sat: 0.55,
    vignette: 0.22, zenith: [0.26, 0.42, 0.7], horizon: [0.86, 0.66, 0.62], sunward: [1.1, 0.74, 0.42],
    sunGlow: [1.0, 0.66, 0.36], sunColor: [1.0, 0.74, 0.44], cloudDark: [0.42, 0.36, 0.48],
    cloudLit: [1.05, 0.84, 0.66], ambient: [0.74, 0.6, 0.5], foot: [0.9, 0.68, 0.58], skyGain: 0.62,
    skyTint: [1, 1, 1], skySat: 1, ui: 1,
  },
  day: {
    exposure: 1.0, fog: 0.0022, mist: [0.78, 0.82, 0.88], key: [1.0, 0.96, 0.88], tint: [2.6, 2.5, 2.35], sat: 0.85,
    vignette: 0.18, zenith: [0.3, 0.48, 0.8], horizon: [0.78, 0.82, 0.88], sunward: [0.98, 0.94, 0.86],
    sunGlow: [1.0, 0.95, 0.85], sunColor: [1.0, 0.94, 0.82], cloudDark: [0.52, 0.56, 0.64],
    cloudLit: [1.02, 1.0, 0.97], ambient: [0.8, 0.78, 0.74], foot: [0.84, 0.88, 0.94], skyGain: 0.62,
    skyTint: [0.86, 1.0, 1.26], skySat: 0.3, ui: 1,
  },
  dusk: {
    exposure: 1.25, fog: 0.004, mist: [0.62, 0.36, 0.3], key: [1.0, 0.52, 0.28], tint: [2.2, 1.35, 1.05], sat: 0.65,
    vignette: 0.45, zenith: [0.16, 0.2, 0.42], horizon: [0.8, 0.46, 0.4], sunward: [1.2, 0.56, 0.3],
    sunGlow: [1.0, 0.5, 0.24], sunColor: [1.0, 0.55, 0.28], cloudDark: [0.3, 0.2, 0.26],
    cloudLit: [1.05, 0.62, 0.44], ambient: [0.66, 0.46, 0.42], foot: [0.68, 0.4, 0.34], skyGain: 0.55,
    skyTint: [1.16, 0.8, 0.72], skySat: 1.1, ui: 0,
  },
};

const rgb = (value: unknown[] | undefined): Rgb | undefined =>
  value && value.length === 3 ? [Number(value[0]), Number(value[1]), Number(value[2])] : undefined;

// The generic look of an hour with a scene's corrections applied.
export function hourLook(hour: Hour, tune?: HourTune): HourLook {
  const base = HOURS[hour];
  if (!tune) return { ...base };
  return {
    ...base,
    exposure: tune.exposure ?? base.exposure,
    fog: tune.fog ?? base.fog,
    mist: rgb(tune.mist) ?? base.mist,
    key: rgb(tune.key) ?? base.key,
    tint: rgb(tune.tint) ?? base.tint,
    sat: tune.sat ?? base.sat,
    vignette: tune.vignette ?? base.vignette,
  };
}

const NUMBERS = ['exposure', 'fog', 'sat', 'vignette', 'skyGain', 'skySat', 'ui'] as const;
const COLOURS = [
  'mist', 'key', 'tint', 'zenith', 'horizon', 'sunward', 'sunGlow', 'sunColor', 'cloudDark', 'cloudLit', 'ambient',
  'foot', 'skyTint',
] as const;

function copy(look: HourLook): HourLook {
  const out = { ...look };
  for (const key of COLOURS) out[key] = [...look[key]] as Rgb;
  return out;
}

// The light as it moves between hours: everything approaches the target at 1.1 per second. `night` holds the night
// pole; `lit` the lit pole, which stays put while the target is night so a night-to-dawn change is a pure blend.
export class HourState {
  day = 0;
  ui = 0;
  night: HourLook;
  lit: HourLook;
  hour: Hour = 'night';
  private nightTo: HourLook;
  private litTo: HourLook;

  constructor(night: HourLook, lit: HourLook) {
    this.night = copy(night);
    this.nightTo = copy(night);
    this.lit = copy(lit);
    this.litTo = copy(lit);
  }

  target(hour: Hour, looks: Record<Hour, HourLook>, snap: boolean): void {
    this.hour = hour;
    this.nightTo = copy(looks.night);
    if (hour !== 'night') this.litTo = copy(looks[hour]);
    if (snap) this.step(0, true);
  }

  get dayTarget(): number {
    return this.hour === 'night' ? 0 : 1;
  }

  step(dt: number, snap = false): void {
    const rate = 1.1;
    const move = (v: number, to: number) => (snap ? to : approach(v, to, rate, dt));
    this.day = move(this.day, this.dayTarget);
    const uiTo = this.hour === 'night' ? this.night.ui : this.litTo.ui;
    this.ui = move(this.ui, uiTo);
    for (const pole of [
      [this.night, this.nightTo],
      [this.lit, this.litTo],
    ] as const) {
      const [now, to] = pole;
      for (const key of NUMBERS) now[key] = move(now[key], to[key]);
      for (const key of COLOURS) for (let i = 0; i < 3; i++) now[key][i] = move(now[key][i]!, to[key][i]!);
    }
  }

  // A value of the current light, between the poles.
  mix(key: 'exposure' | 'fog' | 'vignette'): number {
    return this.night[key] + (this.lit[key] - this.night[key]) * this.day;
  }

  mixRgb(key: 'mist', out: Rgb): Rgb {
    for (let i = 0; i < 3; i++) out[i] = this.night[key][i]! + (this.lit[key][i]! - this.night[key][i]!) * this.day;
    return out;
  }
}
