// Panel actions (docs/play-contracts.md 四, POST /saves/{id}/actions): the things a player does to
// their own gear, their bonds and their beasts that take effect at once, without a turn. Each call
// carries the save's version and answers with the whole new state view, what changed and any
// chips the action queued.
//
// An equipment slot is named 「kind:index」: weapon, armor, technique or treasure, and 0 to 5
// (「weapon:2」 is the third weapon slot). Equipping without a slot takes the first free slot of the
// item's kind, as the engine's equipItem does.
import type { PanelResult } from '../contracts';
import { play } from './client';

export type EquipKind = 'weapon' | 'armor' | 'technique' | 'treasure';

export function slotName(kind: EquipKind, index: number): string {
  return `${kind}:${index}`;
}

/** 「weapon:2」 → { kind: 'weapon', index: 2 }; anything else → null. */
export function parseSlot(slot: string | undefined): { kind: EquipKind; index: number } | null {
  const match = /^(weapon|armor|technique|treasure):([0-5])$/.exec(slot ?? '');
  return match ? { kind: match[1] as EquipKind, index: Number(match[2]) } : null;
}

export const actions = {
  /** Puts an item from the bag on, into `slot` when given. */
  equip: (save: string, version: number, itemId: string, slot?: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'equip', itemId, ...(slot ? { slot } : {}) }),
  /** Takes an item off and puts it back in the bag. */
  unequip: (save: string, version: number, itemId: string, slot?: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'unequip', itemId, ...(slot ? { slot } : {}) }),
  primaryTechnique: (save: string, version: number, itemId: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'primary_technique', itemId }),
  /** Sorts the bag by kind, as the old page's 整理 did. */
  tidy: (save: string, version: number): Promise<PanelResult> => play.action(save, { version, action: 'tidy' }),
  /** Marks a character as bonded (the old page's 标记为羁绊). */
  bond: (save: string, version: number, charId: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'bond', charId }),
  /** Takes the bond back (取消羁绊). */
  unbond: (save: string, version: number, charId: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'unbond', charId }),
  /** Feeds a spirit beast one of the bag's consumables (the old page's 喂食/培养). */
  feed: (save: string, version: number, beastId: string, itemId: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'feed', beastId, itemId }),
  /** The cultivation life: what goes on the belt (bag ids, at most five; none empties it). */
  belt: (save: string, version: number, items: string[]): Promise<PanelResult> => play.action(save, { version, action: 'belt', items }),
  /** The cultivation life: this spirit beast goes out with the player (出战), or comes back (收回). */
  out: (save: string, version: number, beastId: string): Promise<PanelResult> => play.action(save, { version, action: 'out', beastId }),
  in: (save: string, version: number, beastId: string): Promise<PanelResult> => play.action(save, { version, action: 'in', beastId }),
  /** The cultivation life: an egg from the bag is hatched (孵化). */
  hatch: (save: string, version: number, itemId: string): Promise<PanelResult> => play.action(save, { version, action: 'hatch', itemId }),
  /** The cultivation life: a beast takes what lifts it a tier (升阶). */
  promote: (save: string, version: number, beastId: string, itemId: string): Promise<PanelResult> =>
    play.action(save, { version, action: 'promote', beastId, itemId }),
};
