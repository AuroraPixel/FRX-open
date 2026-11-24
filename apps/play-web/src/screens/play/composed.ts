// A place whose scene is composed from its family's kit (docs/play-contracts.md 五, ComposedPlace): the kit is
// fetched once, the composer is loaded only when a composed place first shows, and the scene goes to the stage whole,
// the place's name written on its plaques by the stage. The same place always gives the same scene: the composer is
// seeded with its id, as the stage lab composes it.
import type { ComposedPlace, SceneFile } from '../../contracts';
import type { SceneSpec } from '../../stage';
import type { KitFile } from '../../stage/compose/kit';
import { ASSETS } from './scenes';

const kits = new Map<string, Promise<KitFile | null>>();

/** The scene composed for a place, or null when its kit cannot be had (the family's one painting then stands in). */
export async function composedScene(place: ComposedPlace): Promise<(SceneSpec & { file: SceneFile }) | null> {
  const [{ compose }, { loadKit }] = await Promise.all([import('../../stage/compose/compose'), import('../../stage/compose/kit')]);
  let kit = kits.get(place.kit);
  if (!kit) {
    kit = loadKit(`${ASSETS}scenes/${encodeURIComponent(place.kit)}/kit.json`).catch(() => null);
    kits.set(place.kit, kit);
  }
  const found = await kit;
  if (!found) return null;
  const c = compose(found, {
    id: place.id, name: place.name, region: place.region, description: place.description, ...(place.kind ? { kind: place.kind } : {}),
    ...(place.look ? { look: place.look } : {}),
  });
  return { file: c.scene, folder: `${ASSETS}scenes/${found.id}/`, plaques: c.plaques };
}

/** Forgets the kits fetched (tests). */
export function forgetKits(): void {
  kits.clear();
}
