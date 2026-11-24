/* The regional palette: each main region of content/map.json leans the painted layers a little, so a town in the
   blood-soaked 血天 does not look like one in 潮岚道. `night` multiplies every layer's colour at night; `lit` multiplies
   the lit hours' tint and `sat` shifts their saturation. The leans stay small (a few per cent): the paintings were
   painted as one family and must still read as one. 潮岚道, where the story starts and the scenes were painted, is
   neutral. A region the table does not know is neutral too. */
import type { HourTune } from '../../contracts';
import { HOURS, type Rgb } from '../hours';

export interface RegionPalette {
  night: Rgb;
  lit: Rgb;
  sat: number;
  // the place words this region makes likelier (see placeTags): the seas favour water, the steppes dry ground
  tags?: string[];
}

const NEUTRAL: RegionPalette = { night: [1, 1, 1], lit: [1, 1, 1], sat: 0 };
const SEA: RegionPalette = { night: [0.95, 1.0, 1.06], lit: [0.95, 1.01, 1.05], sat: -0.02, tags: ['water'] };

export const REGIONS: Readonly<Record<string, RegionPalette>> = {
  潮岚道: NEUTRAL,
  // the empire: richer, a touch warmer
  长圃帝国: { night: [1.02, 1.0, 0.97], lit: [1.04, 1.0, 0.95], sat: 0.04 },
  // the steppes: dry and ochre
  风盐原: { night: [1.03, 1.01, 0.95], lit: [1.05, 1.02, 0.92], sat: 0.02, tags: ['dry'] },
  砥风原: { night: [1.03, 1.01, 0.95], lit: [1.05, 1.02, 0.92], sat: 0.02, tags: ['dry'] },
  浮沙洲: { night: [1.05, 1.0, 0.92], lit: [1.08, 1.0, 0.88], sat: -0.03, tags: ['dry'] },
  // the seas: blue-green sea air
  长汛海: SEA,
  东海: SEA,
  南海: { night: [0.97, 1.01, 1.03], lit: [1.0, 1.02, 1.0], sat: 0.03, tags: ['water'] },
  落灯海: SEA,
  五龙海域: SEA,
  远潮海: SEA,
  冰海: { night: [0.94, 0.99, 1.08], lit: [0.94, 0.99, 1.07], sat: -0.08 },
  // the spirit realm's continents: thunder grey-violet, blood red, and the green of the wind continent
  雷炉洲: { night: [0.96, 0.98, 1.06], lit: [0.95, 0.97, 1.05], sat: -0.06 },
  赤圃洲: { night: [1.06, 0.95, 0.95], lit: [1.07, 0.94, 0.92], sat: -0.02 },
  晾云洲: { night: [0.97, 1.02, 1.03], lit: [0.97, 1.02, 1.0], sat: 0.02 },
};

export function paletteOf(region: string | undefined): RegionPalette {
  return (region && REGIONS[region]) || NEUTRAL;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// The scene's hour corrections for a region: the lit hours' tint and saturation, leaned. `own`: the family's own
// corrections (a room is dimmer in the lit hours), kept and leaned likewise.
export function hoursOf(
  palette: RegionPalette, own: Partial<Record<'night' | 'dawn' | 'day' | 'dusk', HourTune>> = {},
): Partial<Record<'night' | 'dawn' | 'day' | 'dusk', HourTune>> {
  if (palette === NEUTRAL || (palette.lit.every((v) => v === 1) && palette.sat === 0)) return { ...own };
  const tune = (hour: 'dawn' | 'day' | 'dusk'): HourTune => ({
    ...own[hour],
    tint: ((own[hour]?.tint as Rgb | undefined) ?? HOURS[hour].tint).map((v, i) => round(v * palette.lit[i]!)) as [number, number, number],
    sat: round(Math.min(1, Math.max(0, (own[hour]?.sat ?? HOURS[hour].sat) + palette.sat))),
  });
  return { ...own, dawn: tune('dawn'), day: tune('day'), dusk: tune('dusk') };
}

// A layer's own night tint (if it has one) times the region's.
export function nightTint(palette: RegionPalette, own?: Rgb): [number, number, number] | undefined {
  const base = own ?? [1, 1, 1];
  const out = base.map((v, i) => round(v * palette.night[i]!)) as [number, number, number];
  return out.every((v) => v === 1) ? undefined : out;
}
