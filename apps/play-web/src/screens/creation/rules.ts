// The creation's rules as the old page kept them (its script js/app.js, calculateRemainingPoints and the
// draw buttons; the server re-plays them with the page's own functions, apps/engine/creation.cjs):
//
//   points left = the difficulty's points − the attributes − the birth's and the race's cost − the cost the
//                 root has in LINGGEN (a drawn root whose name is a LINGGEN key counts too) − every trait draw
//                 (traitDraw.cost) − every trait picked from the whole list (traitPick.cost) − every root
//                 draw (rootDraw.cost)
//   a trait draw needs traitDraw.cost points left; a root draw needs rootDraw.cost points left counting the
//   current root's cost back; at most maxTraits traits; each attribute 0 to attributeMax.
//
// The server charges the fewest draws that offer what is claimed, never more than counted here, so a creation
// these rules allow is never refused for points. The claimed traits go in the order of the draws that offered
// them, picked ones last, the order the server's plan looks for them in.
import type { CreationInput, CreationOptions, CreationTrait, Recipe } from '../../contracts';

export interface ChosenTrait {
  trait: CreationTrait;
  /** the draw that offered it; null when picked from the whole list (自选) */
  round: number | null;
}

export interface Place {
  regionId: string;
  areaId: string;
  poiId: string;
}

export type Pronoun = NonNullable<CreationInput['pronoun']>;

/** The old page's 人称选择: who the story says the player is. */
export const PRONOUNS: { id: Pronoun; said: string }[] = [
  { id: '第一人称', said: '故事里写作「我」' },
  { id: '第二人称', said: '写作「你」' },
  { id: '第三人称', said: '旁人的口吻' },
];

/** The body the portrait is drawn on for each of the old page's four genders. */
export const SEX_OF_GENDER: Record<string, 'm' | 'f'> = { 男性: 'm', 女性: 'f', 男生女相: 'm', 扶她: 'f' };

/** The page's 初始年龄: its input's bounds and where it starts. */
export const AGE = { min: 1, max: 999, start: 16 } as const;

export interface Creation {
  seed: string;
  difficulty: string | null;
  worldFactors: string[];
  birth: string | null;
  race: string | null;
  /** one of the config's GENDERS (男性, 女性, 男生女相, 扶她) */
  gender: string | null;
  /** the portrait's body, following the gender */
  sex: 'm' | 'f' | null;
  age: number;
  pronoun: Pronoun;
  root: string | null;
  rootRounds: number;
  traitRounds: number;
  /** the latest trait draw: what can be chosen now */
  offer: CreationTrait[];
  traits: ChosenTrait[];
  attributes: Record<string, number>;
  portrait: Recipe | null;
  name: string;
  birthplace: Place | null;
}

export function fresh(seed: string): Creation {
  return {
    seed,
    difficulty: null,
    worldFactors: [],
    birth: null,
    race: null,
    gender: null,
    sex: null,
    age: AGE.start,
    pronoun: '第二人称',
    root: null,
    rootRounds: 0,
    traitRounds: 0,
    offer: [],
    traits: [],
    attributes: {},
    portrait: null,
    name: '',
    birthplace: null,
  };
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** What the root costs as chosen: its price in LINGGEN, or nothing when its name is not one of them. */
export function rootCost(options: CreationOptions, root: string | null): number {
  return root ? (options.config.LINGGEN[root]?.cost ?? 0) : 0;
}

export function pointsTotal(options: CreationOptions, c: Creation): number {
  return c.difficulty ? (options.config.DIFFICULTIES[c.difficulty]?.points ?? 0) : 0;
}

export function pointsLeft(options: CreationOptions, c: Creation): number {
  const { config, rules } = options;
  const picked = c.traits.filter((t) => t.round === null).length;
  return (
    pointsTotal(options, c) -
    sum(Object.values(c.attributes)) -
    (c.birth ? (config.BIRTHS[c.birth]?.cost ?? 0) : 0) -
    (c.race ? (config.RACES[c.race]?.cost ?? 0) : 0) -
    rootCost(options, c.root) -
    c.traitRounds * rules.traitDraw.cost -
    picked * rules.traitPick.cost -
    c.rootRounds * rules.rootDraw.cost
  );
}

/** Whether choosing this birth or race fits: the points left with the current one given back. */
export function canAfford(options: CreationOptions, c: Creation, kind: 'birth' | 'race', name: string): boolean {
  const table = kind === 'birth' ? options.config.BIRTHS : options.config.RACES;
  const current = c[kind];
  const back = current ? (table[current]?.cost ?? 0) : 0;
  return pointsLeft(options, c) + back >= (table[name]?.cost ?? Infinity);
}

/** How many more trait draws the points allow. */
export function traitDrawsLeft(options: CreationOptions, c: Creation): number {
  return Math.max(0, Math.floor(pointsLeft(options, c) / options.rules.traitDraw.cost));
}

/** How many more root draws the points allow (the current root's price comes back with a new one). */
export function rootDrawsLeft(options: CreationOptions, c: Creation): number {
  return Math.max(0, Math.floor((pointsLeft(options, c) + rootCost(options, c.root)) / options.rules.rootDraw.cost));
}

export function canPickRoot(options: CreationOptions, c: Creation, root: string): boolean {
  return pointsLeft(options, c) + rootCost(options, c.root) >= rootCost(options, root);
}

export function canPickTrait(options: CreationOptions, c: Creation): boolean {
  return c.traits.length < options.rules.maxTraits && pointsLeft(options, c) >= options.rules.traitPick.cost;
}

/** Every trait of the config and the player's own, by name: what 自选词条 lists. */
export function allTraits(options: CreationOptions): CreationTrait[] {
  const out: CreationTrait[] = [];
  for (const [rarity, list] of Object.entries(options.config.TRAITS)) {
    for (const trait of list ?? []) out.push({ ...trait, rarity });
  }
  for (const own of options.custom.traits) {
    if (typeof own.name === 'string' && own.name) out.push(own as CreationTrait);
  }
  return out;
}

/** The traits in the order the server looks for them: by the draw that offered them, picked ones last. */
export function claimedTraits(c: Creation): string[] {
  const drawn = c.traits.filter((t) => t.round !== null).sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  const picked = c.traits.filter((t) => t.round === null);
  return [...drawn, ...picked].map((t) => t.trait.name);
}

/** What the birth, the race and the traits add to an attribute. */
export function bonusOf(options: CreationOptions, c: Creation, attribute: string): number {
  const { config } = options;
  const from = [
    c.birth ? config.BIRTHS[c.birth]?.bonus : undefined,
    c.race ? config.RACES[c.race]?.bonus : undefined,
    ...c.traits.map((t) => t.trait.bonus),
  ];
  return sum(from.map((bonus) => Number(bonus?.[attribute] ?? 0) || 0));
}

/** The steps, in order, and whether each is done enough to go on from. */
export const STEPS = ['难度', '出身', '种族与性别', '灵根', '词条', '属性', '形象', '名字与出生地', '确认'] as const;

export function stepDone(options: CreationOptions, c: Creation, step: number): boolean {
  switch (step) {
    case 0:
      return c.difficulty !== null;
    case 1:
      return c.birth !== null && pointsLeft(options, c) >= 0;
    case 2:
      return c.race !== null && c.gender !== null && c.sex !== null && pointsLeft(options, c) >= 0;
    case 3:
      return c.root !== null && pointsLeft(options, c) >= 0;
    case 4:
      return c.traits.length <= options.rules.maxTraits && pointsLeft(options, c) >= 0;
    case 5:
      return pointsLeft(options, c) >= 0;
    case 6:
      return c.portrait !== null;
    case 7:
      return nameProblem(c.name) === null && c.birthplace !== null;
    default:
      return STEPS.slice(0, -1).every((_, at) => stepDone(options, c, at));
  }
}

/** What is wrong with a save's name, or null. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '这一世还没有名字';
  if ([...trimmed].length > 20) return '名字最多二十个字';
  return null;
}

/** The request for POST /saves, once every step is done. */
export function creationInput(options: CreationOptions, c: Creation): CreationInput | null {
  if (options.play?.available !== true) return null;
  if (!stepDone(options, c, STEPS.length - 1) || !c.difficulty || !c.birth || !c.race || !c.sex || !c.root) return null;
  if (!c.gender || !(c.gender in SEX_OF_GENDER)) return null;
  if (!c.portrait || !c.birthplace) return null;
  const attributes: Record<string, number> = {};
  for (const key of Object.keys(options.config.ATTRIBUTES)) attributes[key] = c.attributes[key] ?? 0;
  return {
    name: c.name.trim(),
    difficulty: c.difficulty,
    birth: c.birth,
    race: c.race,
    sex: c.sex,
    gender: c.gender as NonNullable<CreationInput['gender']>,
    initialAge: c.age,
    pronoun: c.pronoun,
    attributes,
    seed: c.seed,
    traits: claimedTraits(c),
    root: c.root,
    worldFactors: c.worldFactors,
    birthplace: c.birthplace,
    portrait: c.portrait,
    play: 'life',
  };
}

/** The colour of a rarity, as a quality edge (spec 二: 品质的颜色只用在格子的边上). */
export const RARITY_EDGE: Record<string, string> = {
  平庸: 'var(--line-soft)',
  普通: 'var(--line)',
  稀有: 'var(--jade)',
  史诗: 'var(--mp)',
  传说: 'var(--gold)',
  神迹: 'var(--cin)',
  负面状态: 'var(--faint)',
};

/** 「神识 +3 · 魅力 +2」 */
export function bonusSaid(bonus: Record<string, number | undefined> | undefined): string {
  return Object.entries(bonus ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key} ${(value ?? 0) > 0 ? '+' : ''}${value}`)
    .join(' · ');
}
