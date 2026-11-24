// The names the panels give to the state view's kinds (spec 七, 八).
import type { EquipKind } from '../../api/actions';
import type { Item, Quest, Skill } from '../../contracts';

export type ItemType = Item['type'];

/** What the bag calls each item type: 「消耗品」 shows as 丹药 (spec 七, 行囊). */
export const TYPE_LABEL: Record<ItemType, string> = {
  武器: '兵器',
  护甲: '防具',
  功法: '功法',
  法宝: '法宝',
  消耗品: '丹药',
  材料: '材料',
  重要物品: '要物',
  其他物品: '其他',
};

export type BagTab = 'all' | ItemType;

/** The bag's tabs, in the spec's order. */
export const BAG_TABS: { id: BagTab; label: string }[] = [
  { id: 'all', label: '全部' },
  ...(Object.keys(TYPE_LABEL) as ItemType[]).map((type) => ({ id: type, label: TYPE_LABEL[type] })),
];

/** The four equipment rows (spec 七, 角色): kind, its name, and the item type it takes. */
export const EQUIP_ROWS: { kind: EquipKind; label: string; type: ItemType }[] = [
  { kind: 'weapon', label: '兵器', type: '武器' },
  { kind: 'armor', label: '防具', type: '护甲' },
  { kind: 'technique', label: '功法', type: '功法' },
  { kind: 'treasure', label: '法宝', type: '法宝' },
];

export function kindOfType(type: ItemType): EquipKind | undefined {
  return EQUIP_ROWS.find((row) => row.type === type)?.kind;
}

export const SKILL_TABS: { id: Skill['kind']; label: string }[] = [
  { id: 'technique', label: '功法' },
  { id: 'spell', label: '法术' },
  { id: 'misc', label: '杂学' },
];

/** The brush character at the top right of a quest (spec 三, 列表项). */
export const QUEST_GLYPH: Record<Quest['status'], string> = { active: '进', done: '成', failed: '败' };
export const QUEST_STATE_NAME: Record<Quest['status'], string> = { active: '进行中', done: '已完成', failed: '未成' };
