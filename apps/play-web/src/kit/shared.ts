// The page's one portrait kit and the pictures cut from it outside the stage: round heads for lists
// (saves, people) and figures for panels and the portrait maker. Each picture is composed once per
// recipe and size and kept as a data URL, so a list that redraws asks for nothing new.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { Recipe } from '../contracts';
import { PortraitKit } from './kit';

/** How many pictures are being drawn: a page waits for none before it calls itself drawn (screenshots). */
export const usePictures = create<{ drawing: number; finished: number }>()(() => ({ drawing: 0, finished: 0 }));
const pending = new Set<string>();
const begin = (key: string) => {
  pending.add(key);
  usePictures.setState((s) => ({ drawing: s.drawing + 1 }));
};
const end = (key: string) => {
  pending.delete(key);
  usePictures.setState((s) => ({ drawing: Math.max(0, s.drawing - 1), finished: s.finished + 1 }));
};

export const KIT_URL = '/play/assets/portrait-kit/manifest.json';

let loading: Promise<PortraitKit> | null = null;

/** The kit, loaded once; a failed load is tried again next time. */
export function loadKit(): Promise<PortraitKit> {
  if (!loading) {
    loading = PortraitKit.load(KIT_URL);
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** The kit once it is loaded, else null (and it starts loading). */
export function useKit(): PortraitKit | null {
  const [kit, setKit] = useState<PortraitKit | null>(null);
  useEffect(() => {
    let live = true;
    void loadKit().then(
      (made) => live && setKit(made),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return kit;
}

/** What part of the composed portrait a picture shows. */
export type Crop = 'head' | 'half' | 'full';

const pictures = new Map<string, Promise<string | null>>();
const drawn = new Map<string, string>();

/** Composing at this scale keeps a 112 px head (56 px at 2×) and a 440 px half-length figure sharp. */
const SCALE: Record<Crop, number> = { head: 0.4, half: 0.5, full: 0.42 };
/** The picture's size in pixels: heads square, figures at the canvas's own proportions of the crop. */
const SIZE: Record<Crop, number> = { head: 112, half: 0, full: 0 };

/** The box of a crop on the composed canvas at scale 1: [x, y, w, h]. */
export function cropBox(kit: PortraitKit, recipe: Recipe, crop: Crop): [number, number, number, number] {
  const [w, h] = kit.manifest.size;
  if (crop === 'head') {
    // ears, horns and antlers rise above the kit's head box: a larger square, a little higher, keeps them
    if (kit.traitsOf(recipe).some((t) => t.layer === 'over')) {
      const G = kit.base(recipe.base).geometry;
      return [G.cx - 180, G.chin - 330, 360, 360];
    }
    return kit.headBox(recipe);
  }
  if (crop === 'full') return [0, 0, w, h];
  // half-length: from above the topknot to the waist, centred on the head
  const G = kit.base(recipe.base).geometry;
  const width = 700;
  return [G.cx - width / 2, Math.max(0, G.chin - 430), width, 860];
}

function keyOf(recipe: Recipe, crop: Crop): string {
  return `${crop}:${JSON.stringify(recipe)}`;
}

/** A picture of a recipe as a data URL (webp), cut to the crop; null when the kit cannot draw it. */
export function pictureOf(recipe: Recipe, crop: Crop): Promise<string | null> {
  const key = keyOf(recipe, crop);
  let made = pictures.get(key);
  if (!made) {
    begin(key);
    made = (async () => {
      const kit = await loadKit();
      const scale = SCALE[crop];
      const figure = await kit.compose(recipe, scale);
      const [x, y, w, h] = cropBox(kit, recipe, crop);
      const out = document.createElement('canvas');
      out.width = SIZE[crop] || Math.round(w * scale);
      out.height = SIZE[crop] || Math.round(h * scale);
      const g = out.getContext('2d');
      if (!g) return null;
      g.imageSmoothingQuality = 'high';
      g.drawImage(figure, x * scale, y * scale, w * scale, h * scale, 0, 0, out.width, out.height);
      const url = out.toDataURL('image/webp', 0.9);
      drawn.set(key, url);
      return url;
    })()
      .catch(() => null)
      .finally(() => end(key));
    pictures.set(key, made);
  }
  return made;
}

/** Whether the picture of a recipe is drawn already (or could not be): pages wait for theirs before screenshots. */
export function isDrawn(recipe: Recipe, crop: Crop): boolean {
  const key = keyOf(recipe, crop);
  return drawn.has(key) || (pictures.has(key) && !pending.has(key));
}

/** Re-renders whenever a picture is finished, for pages that wait on isDrawn. */
export function usePicturesTick(): number {
  return usePictures((s) => s.finished);
}

/** The picture of a recipe once it is drawn; undefined until then (a glyph stands in). */
export function usePicture(recipe: Recipe | undefined, crop: Crop): string | undefined {
  const key = recipe ? keyOf(recipe, crop) : '';
  const [, setDone] = useState(0);
  useEffect(() => {
    if (!recipe || drawn.has(key)) return;
    let live = true;
    void pictureOf(recipe, crop).then(() => live && setDone((n) => n + 1));
    return () => {
      live = false;
    };
    // the key stands for the recipe and the crop
  }, [key]);
  return drawn.get(key);
}
