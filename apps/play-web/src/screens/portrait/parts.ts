// What the portrait maker offers and how a choice changes a recipe (spec 七, 人物 · 改形象; 建角 · 形象).
// Rows: the base (by sex, ages in order), face, hair, hair colour, body and traits. Parts belong to their
// base, so moving to another base keeps each part's place in its list where it can; a hair colour the new
// hair cannot take is dropped; trait kinds stay as they are (the kit wears those the base has).
import type { Recipe } from '../../contracts';
import { type PortraitKit, TINTS, TINTS_LIGHT, type Tint } from '../../kit/kit';
import type { KitBase, KitPart } from '../../kit/types';

export type Row = 'base' | 'face' | 'hair' | 'tint' | 'body' | 'trait';
export const ROWS: readonly Row[] = ['base', 'face', 'hair', 'tint', 'body', 'trait'];
export const ROW_LABEL: Record<Row, string> = {
  base: '底模',
  face: '脸',
  hair: '发型',
  tint: '发色',
  body: '身体',
  trait: '特征',
};

const AGES: readonly KitBase['age'][] = ['young', 'mid', 'old', 'child'];

/** The bases a maker offers: of one sex when given, young to old, then the children. */
export function basesFor(kit: PortraitKit, sex?: 'm' | 'f'): string[] {
  return Object.keys(kit.manifest.bases)
    .filter((key) => !sex || kit.manifest.bases[key]!.sex === sex)
    .sort((a, b) => {
      const A = kit.manifest.bases[a]!;
      const B = kit.manifest.bases[b]!;
      return AGES.indexOf(A.age) - AGES.indexOf(B.age) || (A.sex === B.sex ? 0 : A.sex === 'f' ? -1 : 1);
    });
}

/** The colours a hair can take: as painted (null) first, then the kit's table for its paint. */
export function tintsFor(kit: PortraitKit, recipe: Recipe): (string | null)[] {
  return [null, ...kit.tints(recipe.base, recipe.hair)];
}

/** A colour's name and its dark-to-light ramp, for the swatch; as painted has none. */
export function tintOf(kit: PortraitKit, recipe: Recipe, tint: string | null): Tint | null {
  if (!tint) return null;
  const hair = kit.part(recipe.base, 'hair', recipe.hair);
  return (hair.colour === 'white' ? TINTS_LIGHT : TINTS)[tint] ?? null;
}

function sameIndex<T extends KitPart>(from: readonly T[], to: readonly T[], id: string): string {
  const at = Math.max(0, from.findIndex((part) => part.id === id));
  return (to[Math.min(at, to.length - 1)] ?? to[0]!).id;
}

/** The recipe on another base: each part at the same place in the new base's list, colour kept if it fits. */
export function rebase(kit: PortraitKit, recipe: Recipe, base: string): Recipe {
  if (base === recipe.base) return recipe;
  const from = kit.base(recipe.base);
  const to = kit.base(base);
  const next: Recipe = {
    base,
    face: sameIndex(from.faces, to.faces, recipe.face),
    hair: sameIndex(from.hair, to.hair, recipe.hair),
    body: sameIndex(from.bodies, to.bodies, recipe.body),
  };
  if (recipe.tilt !== undefined) next.tilt = recipe.tilt;
  if (recipe.trait?.length) next.trait = [...recipe.trait];
  if (recipe.tint && kit.tints(base, next.hair).includes(recipe.tint)) next.tint = recipe.tint;
  return next;
}

/** The recipe with one row changed; for traits the choice is a kind, worn or taken off. */
export function choose(kit: PortraitKit, recipe: Recipe, row: Row, value: string | null): Recipe {
  switch (row) {
    case 'base':
      return value ? rebase(kit, recipe, value) : recipe;
    case 'face':
      return value ? { ...recipe, face: value } : recipe;
    case 'body':
      return value ? { ...recipe, body: value } : recipe;
    case 'hair': {
      if (!value) return recipe;
      const next: Recipe = { ...recipe, hair: value };
      if (next.tint && !kit.tints(next.base, value).includes(next.tint)) delete next.tint;
      return next;
    }
    case 'tint': {
      const next: Recipe = { ...recipe };
      if (value) next.tint = value;
      else delete next.tint;
      return next;
    }
    case 'trait': {
      if (!value) return recipe;
      const worn = recipe.trait ?? [];
      const kinds = worn.includes(value) ? worn.filter((kind) => kind !== value) : [...worn, value];
      const next: Recipe = { ...recipe };
      // in the base's own order, so the same look is always the same recipe
      const ordered = kit.traitKinds(recipe.base).filter((kind) => kinds.includes(kind));
      const unknown = kinds.filter((kind) => !ordered.includes(kind));
      if (ordered.length || unknown.length) next.trait = [...ordered, ...unknown];
      else delete next.trait;
      return next;
    }
  }
}

/** Whether a row's option is the recipe's. */
export function chosen(recipe: Recipe, row: Row, value: string | null): boolean {
  switch (row) {
    case 'base':
      return recipe.base === value;
    case 'face':
      return recipe.face === value;
    case 'hair':
      return recipe.hair === value;
    case 'body':
      return recipe.body === value;
    case 'tint':
      return (recipe.tint ?? null) === value;
    case 'trait':
      return value !== null && (recipe.trait ?? []).includes(value);
  }
}

/** The options of a row: their value (null for as painted) and their name. */
export function optionsOf(kit: PortraitKit, recipe: Recipe, row: Row, sex?: 'm' | 'f'): { value: string | null; label: string }[] {
  const base = kit.base(recipe.base);
  switch (row) {
    case 'base':
      return basesFor(kit, sex).map((key) => ({ value: key, label: kit.manifest.bases[key]!.label }));
    case 'face':
      return base.faces.map((part) => ({ value: part.id, label: part.label }));
    case 'hair':
      return base.hair.map((part) => ({ value: part.id, label: part.label }));
    case 'body':
      return base.bodies.map((part) => ({ value: part.id, label: part.label }));
    case 'tint':
      return tintsFor(kit, recipe).map((tint) => ({ value: tint, label: tint ? (tintOf(kit, recipe, tint)?.label ?? tint) : '原色' }));
    case 'trait':
      return (base.traits ?? []).map((trait) => ({ value: trait.kind, label: trait.label }));
  }
}

/** Two recipes draw the same portrait (no field order, no absent-versus-empty differences). */
export function sameLook(a: Recipe | null | undefined, b: Recipe | null | undefined): boolean {
  if (!a || !b) return a === b;
  const norm = (r: Recipe) =>
    JSON.stringify([r.base, r.face, r.hair, r.tint ?? null, r.body, r.tilt ?? 0, r.trait ?? [], r.gain ?? null, r.rim ?? null]);
  return norm(a) === norm(b);
}
