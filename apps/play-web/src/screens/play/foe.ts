// Who a fight is against and how the stage shows them (spec 七, 交锋: 妖兽用图鉴的图，人用立绘). Someone
// the save knows (a character id) stands in their own portrait, unless the people table lists a beast
// (isBeast), which shows as its bestiary picture like any other; anyone else is named only, so the
// name decides: a beast's kind by the server's own keyword rules (content/art/species.json, the ones
// play_art.species_of uses) and its bestiary picture; a person by the words of people (修士, 劫匪 …)
// and a portrait drawn for that name; anything else the bestiary's silhouette.
import { useEffect } from 'react';
import speciesRules from '../../../../../content/art/species.json';
import type { BestiaryManifest, CombatBlock, Recipe, StateView } from '../../contracts';
import type { FoeSpec } from '../../stage';
import { beastPicture, loadArtLists, useArtLists } from '../sheets/art';
import { askRecipe, randomRecipe, recipeInView } from './people';

export interface Opponent {
  name: string;
  charId?: string;
}

type Side = CombatBlock['attacker'];

/** Whether a side of an exchange is the player. */
export function isPlayer(side: Side, player: { id: string; name: string }): boolean {
  return side.charId === player.id || side.name === player.name || side.name === '你';
}

/** The other side of the first exchange: the one the player is fighting. */
export function opponentOf(blocks: readonly CombatBlock[], player: { id: string; name: string }): Opponent | null {
  const first = blocks[0];
  if (!first) return null;
  const side = isPlayer(first.attacker, player) ? first.defender : first.attacker;
  return isPlayer(side, player) ? null : { name: side.name, ...(side.charId ? { charId: side.charId } : {}) };
}

/** The bestiary kind a name maps to, by the server's rules; null when no rule matches. */
export function speciesOf(name: string): string | null {
  for (const rule of (speciesRules as { rules: { anyWord: string[]; species: string }[] }).rules) {
    if (rule.anyWord.some((word) => word && name.includes(word))) return rule.species;
  }
  return null;
}

// words that name a person, not a beast, even when a beast's word is in the name too (「魔修」, 「狼帮弟子」)
const PEOPLE = ['修士', '散修', '劫修', '魔修', '邪修', '鬼修', '弟子', '长老', '掌门', '宗主', '道人', '道士', '真人', '和尚', '僧', '剑客', '刀客', '侠', '匪', '贼', '盗', '护卫', '守卫', '头领', '首领', '寨主', '公子', '书生', '将军', '捕快', '杀手', '刺客'];

export function looksHuman(name: string): boolean {
  return PEOPLE.some((word) => name.includes(word));
}

// a beast's realm is its grade (「一阶妖兽」「二阶上品」) or says beast; a person's is a cultivation stage
const BEAST_GRADE = /[一二三四五六七八九十]阶|妖兽|凶兽|魔兽|异兽|妖禽/;
const BEAST_ROLE = /妖兽|凶兽|魔兽|异兽|妖禽/;
const PERSON_REALM = /凡人|炼气|练气|筑基|结丹|金丹|元婴|化神|炼虚|合体|大乘|渡劫|真仙|化形|妖修|人形/;

/**
 * Whether someone in the people table is a beast rather than a person: the model lists the beasts a
 * scene brings (噬灵鼠, realm 「一阶妖兽」; 噬灵鼠群, role 「妖兽」) among the people. A beast has no
 * portrait in the kit, so it never stands as one (its words would draw it as a child or a farmer); in a
 * fight it shows as its bestiary picture. A transformed beast (化形, 妖修) is a person with traits.
 * An arrival's role reads 「role · realm」, so passing it as the role is enough.
 */
export function isBeast(who: { name: string; realm?: string; role?: string }): boolean {
  const realm = who.realm ?? '';
  const role = who.role ?? '';
  if (PERSON_REALM.test(`${realm} ${role}`) || looksHuman(`${who.name} ${role}`)) return false;
  return BEAST_GRADE.test(realm) || BEAST_ROLE.test(role) || /[一二三四五六七八九十]阶/.test(role);
}

/**
 * The bestiary picture of someone the people table lists, when they are a beast (isBeast): the people
 * panel and the spoken lines show it in place of a portrait, as the stage and the fights do (实玩二:
 * 噬灵鼠 had a child's face there). Undefined for a person; the silhouette until the bestiary's list
 * arrives.
 */
export function useBeastFace(who: { name: string; realm?: string; role?: string } | null | undefined): string | undefined {
  const bestiary = useArtLists((s) => s.bestiary);
  const beast = Boolean(who && isBeast(who));
  useEffect(() => {
    if (beast) void loadArtLists();
  }, [beast]);
  return who && beast ? beastPicture(bestiary, speciesOf(who.name) ?? '').url : undefined;
}

/** The bestiary picture of a kind: the half-size one on phones; the silhouette for an unknown kind. */
export function bestiaryPicture(bestiary: BestiaryManifest | null, species: string | null, assets: string, phone: boolean): { url: string; size: number } {
  const entry = (species && bestiary?.species[species]) || bestiary?.species[bestiary?.fallback ?? ''];
  const file = entry?.file ?? 'silhouette.webp';
  return { url: `${assets}bestiary/${phone ? 'half/' : ''}${file}`, size: entry?.size ?? 1 };
}

/**
 * How the stage should show the opponent. A beast waits for the bestiary's list (fetched once, at
 * most a moment): read before it arrives, every beast would be the silhouette for the whole fight.
 */
export async function foeSpecOf(opponent: Opponent, view: StateView, saveId: string, assets: string, phone: boolean): Promise<FoeSpec> {
  const listed = opponent.charId ? view.people.find((person) => person.id === opponent.charId) : undefined;
  if (opponent.charId && !(listed && isBeast(listed))) {
    const recipe: Recipe | null = recipeInView(view, opponent.charId) ?? (await askRecipe(saveId, opponent.charId));
    if (recipe) return { recipe };
  }
  if (looksHuman(opponent.name)) {
    const recipe = await randomRecipe(`foe:${opponent.name}`);
    if (recipe) return { recipe };
  }
  await loadArtLists();
  const { url, size } = bestiaryPicture(useArtLists.getState().bestiary, speciesOf(opponent.name), assets, phone);
  return { picture: url, size };
}
