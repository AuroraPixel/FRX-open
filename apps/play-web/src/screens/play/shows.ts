// The play screen's performances (plan 演出; items 58-61): what a turn being written stages besides
// its words — a journey's passage, cultivation, a breakthrough, a fight — as data, with their
// timetables on the page's side as pure functions of the time into the show, so a still at any
// moment (?at= with a pinned clock) comes out the same as the live show at that moment.
import type { Block, CheckBlock, CombatBlock, ReceiptBlock, SceneBlock } from '../../contracts';
import type { Motion } from '../../store/settings';

/** How fully the shows play: the motion setting, where the system's reduced motion makes full weak. */
export type ShowLevel = Motion;

interface ShowBase {
  /** `${turn}:${block}` of the block that started it */
  key: string;
  turn: number;
}

export interface TravelShow extends ShowBase {
  kind: 'travel';
  scene: SceneBlock;
  /** the player's own words for the journey, or the travel chip's */
  line: string;
}

export interface CultivateShow extends ShowBase {
  kind: 'cultivate';
  receipt: ReceiptBlock;
  seconds: number;
}

export interface BreakthroughShow extends ShowBase {
  kind: 'breakthrough';
  receipt: ReceiptBlock;
  success: boolean;
  realm: string;
}

export interface CombatShow extends ShowBase {
  kind: 'combat';
  blocks: CombatBlock[];
}

export type Show = TravelShow | CultivateShow | BreakthroughShow | CombatShow;

export const keyOf = (turn: number, id: string) => `${turn}:${id}`;

/** A card that lands with its show rather than on its own: a fight's exchange, a receipt with an effect. */
export function isShowCard(block: Block): boolean {
  return block.type === 'combat' || (block.type === 'receipt' && block.fx !== undefined);
}

/** The keys of the cards a show lands. */
export function cardsOf(show: Show): string[] {
  if (show.kind === 'combat') return show.blocks.map((b) => keyOf(show.turn, b.id));
  if (show.kind === 'travel') return [];
  return [keyOf(show.turn, show.receipt.id)];
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** The interface's ease (cubic-bezier(.2, .7, .2, 1)), close enough: quick out, slow settle. */
export const ease = (u: number) => 1 - (1 - clamp(u)) ** 3;
const ramp = (t: number, from: number, length: number) => clamp((t - from) / length);

// ---------------------------------------------------------------- the journey's passage (item 58)

/** Seconds: in, the line, the name, how long it holds at least, out. Weak: plain fades, shorter. */
export const PASSAGE = {
  full: { in: 0.45, line: 0.25, name: 0.5, rise: 0.9, hold: 2.1, out: 0.8 },
  weak: { in: 0.3, line: 0, name: 0, rise: 0.3, hold: 1.4, out: 0.3 },
} as const;

export interface PassageLook {
  /** the ink over the picture, 0..1 */
  veil: number;
  line: number;
  name: number;
  /** px the words still have to rise */
  rise: number;
}

/**
 * The passage `t` seconds in; `leaving` is when the fade began (null while the passage holds).
 */
export function passageAt(t: number, level: ShowLevel, leaving: number | null): PassageLook {
  const p = level === 'full' ? PASSAGE.full : PASSAGE.weak;
  const out = leaving === null ? 1 : 1 - ramp(t, leaving, p.out);
  const lift = level === 'full' ? 16 : 0;
  return {
    veil: ease(ramp(t, 0, p.in)) * out,
    line: ease(ramp(t, p.line, p.rise)) * out,
    name: ease(ramp(t, p.name, p.rise)) * out,
    rise: lift * (1 - ease(ramp(t, p.name, p.rise * 1.6))),
  };
}

// ---------------------------------------------------------------- breakthrough (item 59, spec 九)

/** Seconds: the bars, the title (at 2.6, out at 6.5), the seal pressed beside it, and the end. */
export const BREAK = { bars: 0.7, title: 2.6, seal: 3.4, out: 6.5, end: 7.2, bell: 1.0, thunder: 1.3 } as const;

export interface BreakthroughLook {
  /** the black bars: 0 gone, 1 in */
  bars: number;
  title: { opacity: number; y: number; scale: number; blur: number };
  side: number;
  seal: { opacity: number; scale: number };
}

/** The breakthrough's page side `t` seconds in (spec 二, 大字: opacity 0.9 s, movement 1.6 s, blur 1.1 s). */
export function breakthroughAt(t: number, level: ShowLevel): BreakthroughLook {
  const full = level === 'full';
  const leave = ramp(t, BREAK.out, BREAK.end - BREAK.out);
  const bars = (full ? ease(ramp(t, 0, BREAK.bars)) : ramp(t, 0, 0.3)) * (1 - ease(leave));
  const shown = 1 - leave;
  if (!full) {
    const fade = ramp(t, BREAK.title, 0.3) * shown;
    return { bars, title: { opacity: fade, y: 0, scale: 1, blur: 0 }, side: fade, seal: { opacity: ramp(t, BREAK.seal, 0.3) * shown, scale: 1 } };
  }
  const since = t - BREAK.title;
  const move = 1 - ease(ramp(since, 0, 1.6));
  return {
    bars,
    title: { opacity: ease(ramp(since, 0, 0.9)) * shown, y: 18 * move, scale: 1 + 0.06 * move, blur: 12 * (1 - ease(ramp(since, 0, 1.1))) },
    side: ease(ramp(since, 0.55, 0.9)) * shown,
    seal: { opacity: ramp(t, BREAK.seal, 0.12) * shown, scale: 1 + 0.9 * (1 - ease(ramp(t, BREAK.seal, 0.3))) },
  };
}

/** A realm without its stage, as the breakthrough's title stands: 「筑基初期」 → 「筑基」, 「炼气十三层」 → 「炼气」. */
export function realmName(realm: string): string {
  return realm.replace(/(?:初期|中期|后期|大圆满|圆满|[一二三四五六七八九十]+层)$/, '') || realm;
}

/**
 * The words of the title: the realm reached (its name, 「筑基」), or 未竟; the line beside it with the stage
 * (「破境 · 筑基初期」) or the realm aimed at (「冲关 · 筑基」); the seal. The server names the realm with its
 * stage (筑基初期): standing whole, four brush characters ran off the screen (item 73's walkthrough).
 */
export function breakthroughWords(show: BreakthroughShow): { title: string; side: string; seal: string } {
  if (!show.success) return { title: '未竟', side: `冲关 · ${realmName(show.realm)}`, seal: '再来' };
  const stage = show.receipt.lines.find((line) => line.label === '境界')?.value ?? show.realm;
  return { title: realmName(show.realm), side: `破境 · ${stage}`, seal: '道成' };
}

// ---------------------------------------------------------------- cultivation (item 59)

/** The gathering lasts what the settlement says (the stage never shorter than 2.2 s); the receipt lands at its end. */
export function cultivateEnd(seconds: number): number {
  return Math.max(2.2, seconds);
}

// ---------------------------------------------------------------- a fight (item 60, spec 七 交锋)

/** Seconds: the foe walks on, then one exchange every `gap`; the big stamp, the foe leaving, the end. */
export const FIGHT = {
  full: { enter: 0.8, gap: 1.5, stamp: 0.55, leave: 0.9, end: 1.6 },
  weak: { enter: 0.4, gap: 0.9, stamp: 0.3, leave: 0.5, end: 0.9 },
} as const;

export interface FightPlan {
  /** when each exchange lands, by block id */
  cards: { id: string; at: number }[];
  /** when the big 胜 or 负 is pressed onto the last card; null when the fight goes on */
  stamp: number | null;
  /** when the foe fades away */
  leave: number;
  end: number;
}

export function fightPlan(blocks: readonly CombatBlock[], level: ShowLevel): FightPlan {
  const p = level === 'full' ? FIGHT.full : FIGHT.weak;
  const cards = blocks.map((block, i) => ({ id: block.id, at: p.enter + i * p.gap }));
  const last = cards[cards.length - 1]?.at ?? p.enter;
  const ended = blocks.some((block) => block.end);
  const stamp = ended ? last + p.stamp : null;
  const leave = (stamp ?? last) + p.leave;
  return { cards, stamp, leave, end: leave + p.end };
}

/** The opponent's health just before each exchange lands and after the last one, as far as the cards tell. */
export function healthAlong(blocks: readonly CombatBlock[], isFoe: (side: CombatBlock['defender']) => boolean): ({ current: number; max: number } | null)[] {
  const first = blocks.find((b) => isFoe(b.defender) && b.defenderHp);
  let hp = first?.defenderHp ? { current: Math.min(first.defenderHp.max, first.defenderHp.current + (first.hit ? (first.damage ?? 0) : 0)), max: first.defenderHp.max } : null;
  const along: ({ current: number; max: number } | null)[] = [hp];
  for (const block of blocks) {
    if (isFoe(block.defender) && block.defenderHp) hp = { ...block.defenderHp };
    along.push(hp);
  }
  return along;
}

// ---------------------------------------------------------------- a check (item 61)

/** Seconds: the dice tumble, the roll settles, then the stamp is pressed (spec 七: 骰点先出，再落结果的印). */
export const DICE = { full: { settle: 0.6, stamp: 0.85 }, weak: { settle: 0.35, stamp: 0.5 } } as const;

export type CheckPhase = 'roll' | 'settled' | 'stamped';

export function checkPhase(t: number, level: ShowLevel): CheckPhase {
  if (level === 'off') return 'stamped';
  const p = level === 'full' ? DICE.full : DICE.weak;
  return t < p.settle ? 'roll' : t < p.stamp ? 'settled' : 'stamped';
}

/** The check cards of blocks, for the dice. */
export function checksOf(blocks: readonly Block[]): CheckBlock[] {
  return blocks.filter((b): b is CheckBlock => b.type === 'check');
}
