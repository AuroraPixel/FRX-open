/* The portrait kit: puts a portrait together from painted parts.

   Eight bases (young, middle-aged and old women and men, a girl and a boy), each with its own faces, hair and posed
   bodies. Parts of one base fit each other and nothing else, because every part was painted over that base. A portrait
   is a recipe, so a character costs a few bytes, not an image.

   This is a port of assets/portrait-kit/kit.js and must stay pixel-identical to it: the same canvases, the same
   drawing calls in the same order, the same arithmetic in the same order. The catalogue page still uses kit.js.

   Drawing order: tails (traits with layer 'back', not turned with the head), long hair that falls behind the
   shoulders, the body (its own bald head removed above the chin), then the head group turned by `tilt` degrees about a
   point under the chin: the face, 'skin' traits (marks, scales), the front of the hair, 'over' traits (ears, horns).

   Traits: a recipe's `trait` lists trait KINDS ('fox-ears', 'fox-tail' …), not part ids, so one recipe means the same
   on every base. They are resolved per base in the manifest's order; a kind the base does not have is left out. Traits
   painted in the hair colour (`tint`) take the recipe's hair tint, from the light table when they are painted white. */
import type { Recipe } from '../contracts';
import type { KitBase, KitHair, KitManifest, KitPart, KitTrait, RecipeFilter, Tint } from './types';

export type { KitBase, KitBody, KitGeometry, KitHair, KitManifest, KitPart, KitTrait, RecipeFilter, Tint } from './types';

const W = 1086;
const H = 1448;

// Hair colours: the painted luminance is mapped onto a dark-to-light ramp; saturated pixels (ribbons, jade) keep theirs.
export const TINTS: Readonly<Record<string, Tint>> = {
  brown: { label: '深棕', dark: [0.06, 0.04, 0.03], light: [0.46, 0.33, 0.24], gain: 1.8 },
  chestnut: { label: '栗色', dark: [0.08, 0.04, 0.03], light: [0.48, 0.3, 0.2], gain: 1.7 },
  wine: { label: '暗红', dark: [0.06, 0.02, 0.025], light: [0.38, 0.14, 0.15], gain: 1.7 },
  ink: { label: '青黛', dark: [0.03, 0.035, 0.05], light: [0.3, 0.34, 0.42], gain: 1.6 },
  snow: { label: '雪白', dark: [0.46, 0.49, 0.56], light: [0.98, 0.98, 1.0], gain: 4.2, gamma: 0.55 },
  grey: { label: '花白', dark: [0.2, 0.2, 0.22], light: [0.76, 0.76, 0.78], gain: 3.4, gamma: 0.75 },
};
// Tints for hair painted white (the old bases): a gentler ramp, since the painting is already light.
export const TINTS_LIGHT: Readonly<Record<string, Tint>> = {
  grey: { label: '花白', dark: [0.1, 0.1, 0.11], light: [0.78, 0.78, 0.8], gain: 1.0, gamma: 1.35 },
  ash: { label: '灰', dark: [0.12, 0.12, 0.13], light: [0.62, 0.62, 0.64], gain: 1.0, gamma: 1.2 },
};

type Source = HTMLImageElement | HTMLCanvasElement;
interface HairLayers {
  back: HTMLCanvasElement | null;
  front: HTMLCanvasElement;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('portrait kit: no 2d context');
  return g;
}

function hash(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// The kit's reproducible random numbers; recipes picked from a seed must match kit.js exactly.
export function rng(seed: string | number): () => number {
  let a = hash(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length) % list.length] as T;
}

function weighted<T>(r: () => number, pairs: readonly (readonly [T, number])[]): T {
  let sum = 0;
  for (const pair of pairs) sum += pair[1];
  let v = r() * sum;
  for (const pair of pairs) {
    v -= pair[1];
    if (v <= 0) return pair[0];
  }
  return (pairs[pairs.length - 1] as readonly [T, number])[0];
}

function recolour(src: Source, t: Tint | null): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const g = context(c);
  g.drawImage(src, 0, 0);
  if (!t) return c;
  const p = g.getImageData(0, 0, c.width, c.height);
  const d = p.data;
  const gain = t.gain || 2.4;
  const gamma = t.gamma || 0.8;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i]! / 255;
    const gg = d[i + 1]! / 255;
    const b = d[i + 2]! / 255;
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    const sv = mx > 0.001 ? (mx - mn) / mx : 0;
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const w =
      1 -
      Math.min(1, Math.max(0, (sv - 0.3) / 0.2)) * Math.min(1, Math.max(0, (l - 0.12) / 0.1));
    const u = Math.pow(Math.min(1, l * gain), gamma);
    d[i] = 255 * (r + (t.dark[0] + (t.light[0] - t.dark[0]) * u - r) * w);
    d[i + 1] = 255 * (gg + (t.dark[1] + (t.light[1] - t.dark[1]) * u - gg) * w);
    d[i + 2] = 255 * (b + (t.dark[2] + (t.light[2] - t.dark[2]) * u - b) * w);
  }
  g.putImageData(p, 0, 0);
  return c;
}

// Long hair: what hangs below the shoulders goes behind the body, the rest stays in front.
function split(src: Source, top: number, splitA: number, splitB: number, front: boolean) {
  const c = canvas(src.width, src.height);
  const g = context(c);
  g.drawImage(src, 0, 0);
  const p = g.getImageData(0, 0, c.width, c.height);
  const d = p.data;
  for (let y = 0; y < c.height; y++) {
    const Y = top + y;
    const f = Y < splitA ? 1 : Y > splitB ? 0 : (splitB - Y) / (splitB - splitA);
    const k = front ? f : 1 - f;
    if (k >= 1) continue;
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4 + 3;
      d[i] = Math.round(d[i]! * k);
    }
  }
  g.putImageData(p, 0, 0);
  return c;
}

export class PortraitKit {
  static readonly TINTS = TINTS;

  readonly manifest: KitManifest;
  readonly root: string;
  private readonly images = new Map<string, Promise<HTMLImageElement>>();
  private readonly layers = new Map<string, Promise<HairLayers>>();
  private readonly traitLayers = new Map<string, Promise<HTMLCanvasElement>>();

  constructor(manifest: KitManifest, root: string) {
    this.manifest = manifest;
    this.root = root;
  }

  static async load(url: string): Promise<PortraitKit> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`portrait kit: ${url} ${response.status}`);
    const manifest = (await response.json()) as KitManifest;
    return new PortraitKit(manifest, url.replace(/[^/]*$/, ''));
  }

  base(key: string): KitBase {
    const b = this.manifest.bases[key];
    if (!b) throw new Error(`portrait kit: no base ${key}`);
    return b;
  }

  part<K extends 'faces' | 'hair' | 'bodies' | 'traits'>(base: string, kind: K, id: string): NonNullable<KitBase[K]>[number] {
    const found = ((this.base(base)[kind] ?? []) as readonly KitPart[]).find((item) => item.id === id);
    if (!found) throw new Error(`portrait kit: no ${kind} ${id} on ${base}`);
    return found as NonNullable<KitBase[K]>[number];
  }

  // The trait kinds a base has, in the manifest's order ('fox-ears', 'horns' … 'fox-tail'); none for children.
  traitKinds(base: string): string[] {
    return (this.base(base).traits ?? []).map((t) => t.kind);
  }

  // The trait part ids of a base for some kinds, in the manifest's order (kit.js traitIds).
  traitIds(base: string, kinds: readonly string[]): string[] {
    return (this.base(base).traits ?? []).filter((t) => kinds.indexOf(t.kind) >= 0).map((t) => t.id);
  }

  // The trait parts a recipe wears on its base: its kinds in the manifest's order, unknown kinds left out.
  traitsOf(recipe: Recipe): KitTrait[] {
    const kinds = recipe.trait ?? [];
    if (!kinds.length) return [];
    return (this.base(recipe.base).traits ?? []).filter((t) => kinds.indexOf(t.kind) >= 0);
  }

  image(file: string): Promise<HTMLImageElement> {
    let loading = this.images.get(file);
    if (!loading) {
      loading = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
          this.images.delete(file);
          reject(new Error(`portrait kit: load ${file}`));
        };
        img.src = this.root + file;
      });
      this.images.set(file, loading);
    }
    return loading;
  }

  // A hair layer in a given colour, split into what goes behind the body and what stays in front.
  private hairLayers(base: string, hair: KitHair, tint: string | null | undefined): Promise<HairLayers> {
    const key = `${base}/${hair.id}/${tint || ''}`;
    let made = this.layers.get(key);
    if (!made) {
      made = this.image(hair.file).then((im) => {
        const table = hair.colour === 'white' ? TINTS_LIGHT : TINTS;
        const t = tint ? table[tint] || null : null;
        const c = recolour(im, t);
        const G = this.base(base).geometry;
        return hair.layer === 'split'
          ? { back: split(c, hair.y, G.splitA, G.splitB, false), front: split(c, hair.y, G.splitA, G.splitB, true) }
          : { back: null, front: c };
      });
      this.layers.set(key, made);
    }
    return made;
  }

  tints(base: string, hairId: string): string[] {
    const hair = this.part(base, 'hair', hairId);
    return Object.keys(hair.colour === 'white' ? TINTS_LIGHT : TINTS);
  }

  // A trait layer, in the hair tint when the trait is painted in the hair colour (kit.js traitLayer).
  private traitLayer(base: string, trait: KitTrait, tint: string | null | undefined): Promise<HTMLCanvasElement> {
    const key = `${base}/${trait.id}/${(trait.tint && tint) || ''}`;
    let made = this.traitLayers.get(key);
    if (!made) {
      made = this.image(trait.file).then((im) => {
        const table = trait.colour === 'white' ? TINTS_LIGHT : TINTS;
        return recolour(im, trait.tint && tint ? table[tint] || null : null);
      });
      this.traitLayers.set(key, made);
    }
    return made;
  }

  // recipe -> canvas, 1086 x 1448 at scale 1, transparent
  async compose(recipe: Recipe, scale?: number): Promise<HTMLCanvasElement> {
    const b = this.base(recipe.base);
    const G = b.geometry;
    const s = scale || 1;
    const face = this.part(recipe.base, 'faces', recipe.face);
    const hair = recipe.hair ? this.part(recipe.base, 'hair', recipe.hair) : null;
    const body = this.part(recipe.base, 'bodies', recipe.body);
    const traits = this.traitsOf(recipe);
    const [faceImg, hairs, bodyImg, traitImgs] = await Promise.all([
      this.image(face.file),
      hair ? this.hairLayers(recipe.base, hair, recipe.tint) : null,
      this.image(body.file),
      Promise.all(traits.map((t) => this.traitLayer(recipe.base, t, recipe.tint))),
    ]);
    const c = canvas(Math.round(W * s), Math.round(H * s));
    const g = context(c);
    const a = ((recipe.tilt || 0) * Math.PI) / 180;
    g.imageSmoothingQuality = 'high';
    g.scale(s, s);
    const head = (draw: () => void) => {
      g.save();
      g.translate(G.pivot[0], G.pivot[1]);
      g.rotate(a);
      g.translate(-G.pivot[0], -G.pivot[1]);
      draw();
      g.restore();
    };
    const layer = (name: KitTrait['layer']) =>
      traits.forEach((t, i) => {
        if (t.layer === name) g.drawImage(traitImgs[i] as HTMLCanvasElement, t.x, t.y);
      });
    layer('back');
    if (hair && hairs && hairs.back) {
      const back = hairs.back;
      head(() => g.drawImage(back, hair.x, hair.y));
    }
    g.drawImage(bodyImg, body.x, body.y);
    head(() => {
      g.drawImage(faceImg, face.x, face.y);
      layer('skin');
      if (hair && hairs) g.drawImage(hairs.front, hair.x, hair.y);
      layer('over');
    });
    return c;
  }

  // Square around the head on the composed canvas (at scale 1), for dialogue avatars.
  headBox(recipe: Recipe): [number, number, number, number] {
    const G = this.base(recipe.base).geometry;
    const size = 290;
    return [G.cx - size / 2, G.chin - 250, size, size];
  }

  // A reproducible random recipe; filter by base, sex ('f'/'m'), age ('young'/'mid'/'old'/'child') or role ('剑修');
  // filter.traits lists trait kinds to wear (only bases that have all of them are chosen).
  random(seed: string | number, filter?: RecipeFilter): Recipe {
    const f = filter || {};
    const r = rng(seed);
    const keys = Object.keys(this.manifest.bases).filter((k) => {
      const b = this.manifest.bases[k] as KitBase;
      if (f.base && f.base !== k) return false;
      if (f.sex && f.sex !== b.sex) return false;
      if (f.age && f.age !== b.age) return false;
      if (f.role && !b.bodies.some((x) => x.roles.indexOf(f.role as string) >= 0)) return false;
      if (f.traits && f.traits.some((kind) => !(b.traits ?? []).some((t) => t.kind === kind))) return false;
      return true;
    });
    if (!keys.length) throw new Error(`portrait kit: nothing matches ${JSON.stringify(f)}`);
    const base = pick(r, keys);
    const b = this.base(base);
    const bodies = f.role ? b.bodies.filter((x) => x.roles.indexOf(f.role as string) >= 0) : b.bodies;
    const hair = pick(r, b.hair);
    // Hair colours by who it is: mostly as painted; no grey for middle-aged men (their beards stay dark).
    const tints: readonly (readonly [string | null, number])[] =
      hair.colour === 'white'
        ? [[null, 8], ['grey', 2], ['ash', 1]]
        : b.age === 'child'
          ? [[null, 16], ['brown', 4]]
          : b.age === 'mid'
            ? b.sex === 'm'
              ? [[null, 14], ['brown', 3], ['ink', 2]]
              : [[null, 12], ['brown', 3], ['grey', 2], ['ink', 1]]
            : b.age === 'old'
              ? [[null, 6], ['snow', 2], ['grey', 2]]
              : b.sex === 'm'
                ? [[null, 14], ['brown', 4], ['ink', 2], ['snow', 1]]
                : [[null, 12], ['brown', 4], ['ink', 2], ['chestnut', 2], ['wine', 1], ['snow', 1]];
    const tint = weighted(r, tints);
    const tilt = pick(r, hair.layer === 'split' ? [-3, -2, 2, 3] : [-4, -3, -2, 2, 3, 4]);
    const recipe: Recipe = { base, face: pick(r, b.faces).id, hair: hair.id, body: pick(r, bodies).id, tilt };
    if (tint) recipe.tint = tint;
    if (f.traits && f.traits.length) recipe.trait = this.traitKinds(base).filter((kind) => f.traits!.indexOf(kind) >= 0);
    return recipe;
  }
}
