// What the cultivation life's belt takes (content/life/gear.json belt, read by the engine's gear.cjs): what a
// thing is, never a word in its name — a pill or a talisman by its bag row's type (消耗品, and the 丹药 and
// 符箓 older rows write), or a 符宝 (its name says so) kept as a treasure. The engine checks again (a
// catalogue good by its kind); this only keeps the panel from offering what it would refuse, so a wolf
// core (妖兽材料) or a recipe never shows among the choices.
import type { Item } from '../contracts';

export const BELT_SIZE = 5;
export const BELT_TYPES = ['消耗品', '丹药', '符箓'] as const;
const TALISMAN = { words: ['符宝'], types: ['法宝', '消耗品'] };

export const beltable = (item: Pick<Item, 'name' | 'type'>): boolean =>
  (BELT_TYPES as readonly string[]).includes(item.type) ||
  (TALISMAN.words.some((word) => item.name.includes(word)) && TALISMAN.types.includes(item.type));
