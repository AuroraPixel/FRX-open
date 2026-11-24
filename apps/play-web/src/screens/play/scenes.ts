// Scene files, read by the page for what the stage does not handle: whether a scene has been painted
// at all, and its ambience and music mood (docs/play-contracts.md, 五). A scene that is not there yet
// falls back to the one every save can stand in (the server does the same, content/art/scenes.json).
import type { SceneFile } from '../../contracts';

export const ASSETS = '/play/assets/';
export const FALLBACK_SCENE = 'guanyuntai';

const files = new Map<string, Promise<SceneFile | null>>();

function fetchScene(id: string): Promise<SceneFile | null> {
  let found = files.get(id);
  if (!found) {
    found = fetch(`${ASSETS}scenes/${encodeURIComponent(id)}/scene.json`)
      .then((response) => (response.ok ? (response.json() as Promise<SceneFile>) : null))
      .catch(() => null);
    files.set(id, found);
  }
  return found;
}

/** The scene file for a scene id, or the fallback scene's when that scene has not been painted. */
export async function sceneFile(id: string): Promise<SceneFile | null> {
  const own = await fetchScene(id);
  if (own || id === FALLBACK_SCENE) return own;
  return fetchScene(FALLBACK_SCENE);
}

/**
 * The ambience of a scene at an hour in a weather: the scene file's own for the hour, but the rain's where it rains
 * and the scene has rain (the stage shows rain there). Indoors, and where a scene never rains, its own sound stays,
 * as the stage keeps its own sky.
 */
export function ambienceOf(file: SceneFile, hour: keyof SceneFile['ambience'], weather: string): string | null {
  if (weather === 'rain' && file.weather.includes('rain')) return 'amb.rain';
  return file.ambience[hour] ?? null;
}

/** Whether the scene shows the formation while the protagonist cultivates or breaks through: unless it says not. */
export function hasFormation(file: SceneFile | null): boolean {
  return file?.formation !== false;
}
