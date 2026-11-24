// The shape of assets/portrait-kit/manifest.json, written by tools/portrait-kit/manifest.py.

export interface KitGeometry {
  cx: number;
  chin: number;
  pivot: [number, number];
  splitA: number;
  splitB: number;
  bottom: number;
}

export interface KitPart {
  id: string;
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface KitHair extends KitPart {
  layer: 'front' | 'split';
  colour: 'black' | 'white';
}

export interface KitBody extends KitPart {
  roles: string[];
}

/**
 * A demon trait (tools/portrait-kit/README.md, 特征层): beast ears, horns, marks, antlers, scales, cat ears, a fox tail.
 * `layer` says when it is drawn: back (tails) first of all and not turned with the head; skin (marks, scales) on the
 * face under the hair; over (ears, horns) on top of the hair. `tint`: painted in the hair colour, so it takes the
 * recipe's hair tint, from the light table when `colour` is white.
 */
export interface KitTrait extends KitPart {
  kind: string;
  layer: 'back' | 'skin' | 'over';
  tint: boolean;
  colour: 'black' | 'white';
}

export interface KitBase {
  label: string;
  sex: 'f' | 'm';
  age: 'young' | 'mid' | 'old' | 'child';
  // how tall the figure stands next to an adult (children are 0.9)
  display: number;
  geometry: KitGeometry;
  faces: KitPart[];
  hair: KitHair[];
  bodies: KitBody[];
  // children have none; every adult base has one of each kind (the old bases no fox tail)
  traits?: KitTrait[];
}

export interface KitManifest {
  version: number;
  size: [number, number];
  bases: Record<string, KitBase>;
}

export interface Tint {
  label: string;
  dark: [number, number, number];
  light: [number, number, number];
  gain: number;
  gamma?: number;
}

export interface RecipeFilter {
  base?: string;
  sex?: 'f' | 'm';
  age?: 'young' | 'mid' | 'old' | 'child';
  role?: string;
  // trait kinds to wear: only bases that have all of them are chosen, and the recipe wears them
  traits?: string[];
}
