// Development and screenshot builds only: open the creation on a later step with the earlier ones done, the
// same way every time (?step=<1–9>; &full=1 does that step too; &sex=f for a woman). The draws come from the
// sample set's draws.json like any other.
import type { CreationOptions } from '../../contracts';
import type { PortraitKit } from '../../kit/kit';
import { readParams } from '../../lib/params';
import { firstPortrait } from './LookStep';
import { STEPS, pointsLeft } from './rules';
import { useCreation } from './store';

/** Points spread over a few attributes, as far as they go. */
const SPREAD: [string, number][] = [
  ['神识', 8],
  ['法力', 6],
  ['气运', 6],
  ['脚力', 5],
  ['物攻', 4],
  ['法防', 4],
];

export async function prefill(options: CreationOptions, kit: PortraitKit, step: number): Promise<void> {
  const params = readParams(location.href);
  const upTo = Math.min(STEPS.length - 1, Math.max(0, step)) + (params.get('full') ? 1 : 0);
  const store = useCreation.getState;
  const change = (patch: Parameters<ReturnType<typeof store>['change']>[0]) => store().change(patch);
  if (upTo > 2) {
    const sex = params.get('sex') === 'f' ? 'f' : 'm';
    change({ sex, gender: sex === 'f' ? '女性' : '男性' });
  }
  if (upTo > 3) await store().drawRoot();
  if (upTo > 4) {
    const offer = (await store().drawTraits()) ?? [];
    for (const trait of offer.slice(0, 2)) store().toggleOffered(trait);
  }
  if (upTo > 5) {
    for (const [key, value] of SPREAD) {
      if (key in options.config.ATTRIBUTES) store().setAttribute(key, Math.min(value, Math.max(0, pointsLeft(options, store().c))));
    }
  }
  if (upTo > 6) store().setPortrait(firstPortrait(kit, store().c));
  if (upTo > 7) {
    const region = options.map.regions.find((r) => r.id === '潮岚道') ?? options.map.regions[0];
    const area = region?.areas.find((a) => a.id === '云汀湾') ?? region?.areas.find((a) => a.pois.length);
    const poi = area?.pois.find((p) => p.id === '听澜院') ?? area?.pois[0];
    change({ name: '陆沉', ...(region && area && poi ? { birthplace: { regionId: region.id, areaId: area.id, poiId: poi.id } } : {}) });
  }
  useCreation.setState({ step: Math.min(STEPS.length - 1, step) });
}
