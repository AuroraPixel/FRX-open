'use strict';
/* Fights (斗法, 玩法设计第六节, plan items 19, 31, 33, 34 and 41): turn by turn, the player picks a
 * command and every foe acts on the intent it showed beforehand. Hit, damage and realm pressure are
 * the combat rules' own (mechanics.strike, content/combat.json), the player's totals with the
 * active gear only (gear.totals); the foes' intents, the losses, the statuses, the five elements,
 * the tiers and the fight's own few numbers are content/life/foes.json; the checks (遁 脱身, 察 探查,
 * 和 交涉) are priced by the actions module and rolled on the timeline seed.
 *
 * frxPlay.fight, null outside a fight:
 *   { id: "F1", round, first: player | foes, ambush: player | null, since,
 *     foes: [{ id, name, class, element, intent: { name, act } | null, cycle, out: null | fled | fallen }],
 *     statuses: { <fighter id>: { <status>: { since, left?, amount?, from? } } }, guard, probed: [ids], probe,
 *     idle?: [item ids], edge?, saved? }
 *   statuses the eight of foes.json `rules.statuses` on the player (B1) and the foes: since the round it
 *           was given in (0 at the opening), left the rounds it still lasts (rounds), amount what a
 *           护盾 still takes, from who gave it. 内伤 is not kept here: it is the calendar's
 *           (injury.cjs), and a fight reads it at every move
 *   guard   the player guards this round; probed the foes seen through by 察, probe whether 察 was
 *           used (once a fight); element a foe's element (elements: its name, else its identity)
 *   idle    the treasures whose mana could not be paid at the opening (gear.drive): they do not
 *           count this fight; edge the hit 回锋 gives the next blow after a miss; saved 护主 used
 *   beast   { id, name, temperament, out?: down | dead }: the spirit beast out with the player
 *           (beasts.joining at the opening); it fights while it stands
 *
 * open(env, { foes, first?, ambush? }) → { fight } | { refused }
 *   foes    [id | { id } | { name, realm, class? }]: people on the scene (or back from their
 *           biography) by id, or new foes by name and realm, registered as the combat rules
 *           register them (mechanics.fighter); class one of foes.json's, else read from the
 *           name, the identity and the species
 *   first   player | foes: who moves first in each round; by default the side with more 脚力
 *           (the player on a tie), and the ambusher when there is one
 *   ambush  player | foes: as the combat rules have it (+hit, ×damage, no reply): the player's
 *           first round carries it (the foes do not act in it), or every foe strikes at once
 *   Marks everyone in combat (column 31), sets each foe's first intent, carries the player's 中毒
 *   (the status column) into the fight, drives the active treasures with mana (gear.drive: the
 *   receipt's driven { paid, idle }), lets a stolen piece worn in its owner's region be seen
 *   (gear.stolenUse: clocks) and settles a receipt of kind "fight" (fight.opened).
 * fromAct(env, { target, outcome }) → { fight } | { refused }: the act op's 进斗法 (a card whose
 *   outcome or effect is fight): open with the card's target as the foe, the side caught unawares
 *   from the outcome (foes.json fromAct: 大失败 the foes' ambush, 大成功 the player's). A target
 *   that is no one on the scene or back from a biography, and no id, is a foe the story brought
 *   and never registered, by its name (batch 7): storyFoe makes it a new foe.
 * storyFoe(env, target) → { name, realm, class } | null: the foe such a target names (赤鳞毒蛇,
 *   赤鳞毒蛇·一阶妖兽, 炼气五层的劫修): beast or person and its class by the name (the species it
 *   ends in, foes.json people, story's words), its realm as the target writes it, else the tier
 *   of the place's encounter rows of its kind nearest the player's own, each held to what is met
 *   here by chance (encounter.capOf; the player's own where the place has no table); null for a
 *   name that is neither beast nor person (巨石) or an id.
 * move(env, { command, skillId?, itemId?, targetId? }) → { fight: view | null } | env.refuse(reason)
 *   strike  a blow at the target (the first foe standing by default)
 *   skill   a skill cast at the target: its cost and proficiency (mechanics.castSkill; the mana
 *           × elements.rootCost when its element is in the player's root), a spell blow
 *   item    a thing on the belt (gear.beltIds) used now, before the foes act (turn-rules useItem);
 *           its own receipt comes first; one whose effect names rules.statuses.中毒.cure takes the
 *           poison away. A 符宝 on the belt strikes instead, as a treasure of its tier (gear.talisman:
 *           that tier's realm and 法攻, nothing worn added, no penalty for the tier), and spends a
 *           use (the last one uses it up). A weapon or an armour from the bag is put on in place of
 *           the first one (switched): that is the move
 *   Gear traits of the active pieces (gear.traitsOf): 回锋 adds its hit to the blow after a miss,
 *   镇邪 multiplies the damage on its classes, 噬灵 brings back mana on a hit (drank), 护主 once a
 *   fight leaves its 气血 after a blow that would have downed the player (the strike's saved)
 *   guard   no blow; the blows taken this round × rules.guard; a foe that misses gets 破绽
 *   flee    a 脱身 check: success ends the fight, failure gives every foe a free blow
 *   probe   a 探查 check that is not a move: no round passes, no foe acts; once a fight; success
 *           shows the target's 气血, realm and next intent
 *   talk    a 交涉 check, only while a foe is below rules.talkBelow percent: success is a truce
 *   tame    降服: a 驭兽 check (beasts.tameTerms: 魅力, the talents' and the mastery's bonus; 中 on a
 *           beast of a lower major realm, 难 on one of the same) on a beast below tame.below percent
 *           of its 气血; refused on one a major realm above, and when no more can be kept. Success
 *           writes it to table 7 (beasts.tamed, not yet bound) and takes it off the scene (out
 *           tamed); 大失败 lets it get away (out fled)
 *   The spirit beast (beasts.cjs) moves first in every round but a 察: its temperament's act, or the
 *   order (args.order: attack, guard, harass) when its favour is high enough. attack (凶悍) strikes
 *   the target before anyone, harass (狡黠) puts 破绽 on it, guard (机警) takes the first blow meant
 *   for the player (foesAct); it holds back from striking a beast being tamed. A blow at it writes
 *   its row's 气血 (column 8); at 0 it is badly hurt (beasts.hurt: an injury on the calendar) or, in
 *   extreme mode, dead, and fights no more
 *   Then the foes act on their intents, in the order of `first`: strike, cast (a spell of its
 *   element, paying mana; a blow when it cannot), poison (a blow that poisons), charge (蓄势),
 *   guard (its blows taken × rules.guard), wait, flee. 定身 skips a fighter's next move (the
 *   player's whole command when it is on at the move's start). At the round's end 灼烧 and 中毒 take
 *   their share of 气血 and the statuses count down. A fight ends won (no foe standing), lost (the
 *   player down), fled or in a truce; a loss is the class's (foes.json losses): 劫财 takes the
 *   stones (half at most outside a dangerous place, losses.rob.safe, and in the life's first year,
 *   losses.rob.grace), 擒走 leaves a pending event that happens now, both spare the player; 补刀 leaves the
 *   player down, which in extreme mode is the existing death flow's. Every loss leaves 内伤
 *   (injury.register, by the tier of the foe that downed the player) and damages one active piece
 *   of gear (gear.damage: damaged). A felled person (rogue, disciple, evil) leaves a bag by their
 *   standing beyond the loot (gear.grantBag: bags), what came off a named owner marked stolen.
 *   Settles one receipt of kind "fight".
 * A blow (blow): mechanics.strike on the fight's seed, with 迟缓 halving 脚力 on either side and 破绽
 *   adding rules.statuses.破绽.hit; then its damage × the factors (guard, 蓄势, the five elements:
 *   elements.strong when the blow's element overcomes the defender's, weak when overcome, 内伤 on
 *   the player's own), rounded down and at least 1, less what a 护盾 takes. A spell's element then
 *   leaves its status (elements.statuses: 灼烧 迟缓 定身 on the one hit, 护盾 on the one who cast),
 *   and 破绽 on a defender it overcame.
 * view(env) → null | { round, foes: [{ charId, name, intent?, tags }], commands: [{ command, glyph,
 *   note, hint?, used?, off? }], belt: [{ itemId, name, quantity, type }], skills: [{ skillId,
 *   name, cost, odds, off?, note? }] }: the contract's PlayFight (the server adds each belt thing's
 *   icon); belt is the belt's things (gear.beltItems); beast { id, name, temperament, act, hp,
 *   obeys, orders: [{ order, glyph, label, note, off? }] } while one fights, tame { command, glyph,
 *   foeId, name, note, odds?, off? } while a beast foe is below tame.below percent (odds in percent;
 *   off with why: a major realm above, no room); the server maps both to PlayFight's beast and tame. A foe's intent shows when its major realm is not above the player's, or once 察 saw
 *   through it; its tags are its statuses. skills is what 术 can cast: the cost in words (耗法力八,
 *   the root's share off), the chance in percent to hit the first foe standing, and off with a
 *   note (法力不足, a daily limit) when it cannot be cast now.
 * tierOf(realm) → a fighter's tier (foes.json tiers: the tier whose realm is nearest, the lower on
 *   a tie); realmOfTier(tier, people) the realm a foe of that tier is written with.
 * loot(env, { id, name, class, tier, element }) → what rewards.loot (plan item 30) gives for a foe
 *   beaten, or null: the single call point, called for every foe that fell in a fight won, and
 *   null until the actions lane's apps/engine/life/rewards.cjs is there. What it gives goes on the
 *   receipt (fight.loot); applying it is item 30's.
 *
 * The receipt (kind "fight", source "engine" for the opening, "move" for a move):
 *   attack  shaped as resolve_attack's (attacker, target, style, skill, paid, strikes, rulesVersion),
 *           so play_blocks.combat_blocks draws its strikes; names maps every fighter's id to a name
 *   check   shaped as resolve_check's, for 遁, 察 and 和
 *   fight   { id, round, command?, target?, opened?, first?, foes: [{ id, name, did?, next?, out?,
 *           tags? }], self?, ticks?, perks?, end?, loss?: { kind, name, by, stones? }, injury?:
 *           { tier, days, until, pill? }, probed?: { id, name, hp, realm, next }, loot?, bags?,
 *           damaged?, driven?, switched?, drank?, clocks? }: did is the intent a foe acted on, next
 *           the one it shows for the coming round (only when it can be seen), tags a foe's
 *           statuses, self the player's (内伤 among them while injured), ticks what 灼烧 and 中毒
 *           took at the round's end ([{ id, status, damage, hp }]), perks the 悟得 that added to a
 *           hit (先声夺人); bags [{ foe, status, items, piece?: { name, condition, traits }, stolen? }],
 *           damaged { id, name }, driven { paid: [{ id, name, cost }], idle: [ids] }, switched
 *           { id, name, slot }, drank { before, after } (法力), clocks the stolen goods' clock
 *           changes, beast the spirit beast's move (or joined at the opening), tamed { foe, id,
 *           name }. A strike may carry talisman { id, name, tier, left }, edge, bane or saved
 * Every die is the fight's seed: { kind: "fight", fight, round, command, nth }, the player's blows
 * under the command, a foe's under its id, its intents under intent:<id>.
 * hooks: what another module adds to a fight without the fight knowing it (arrays.cjs, plan item 43:
 *   the arrays laid before it; home.cjs, item 45: the 守府 helper); unset, they change nothing:
 *   opening(env, fight, args, round)  once the fight is made, before anyone moves: it may set
 *                 fight.first and keep its own state on the fight (args are open's)
 *   blow(env, round, attacker, defender) → { bonus?, factor?, pace?: { <id>: f } } for every blow:
 *                 added to the hit, times the damage, the fighter's 脚力 times f
 *   stay(env, round, id) → why that fighter cannot flee (a foe's 遁 then holds it), or null
 *   intent(env, fight, entry, intent) → the intent a foe shows; acts { <act>: (env, round, entry,
 *                 foe) } what a foe does on an intent of an act the fight does not know
 *   moves { <command>: { check(env, round, args) → why not | null, run(env, round, args) →
 *                 { rolled? } } }: the player's own commands besides the fight's (no blow of theirs)
 *   round(env, round, tools) at the round's end, before the statuses tick; tools { blow, landed, asIs }
 *   ended(env, round, how) once the fight ends, before frxPlay.fight goes
 *   view(env, round) → { commands?, ...more }: rows added to the view's commands, keys to the view
 *   round.notes are lines of the receipt's summary (after the blows), round.extra keys of its fight.
 */
const fs = require('node:fs');
const path = require('node:path');
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const actions = require('./actions.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const gear = require('./gear.cjs');
const beasts = require('./beasts.cjs');
const world = require('./world.cjs');
const injury = require('./injury.cjs');
const perks = require('./perks.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');
const SPECIES = require('../../../content/art/species.json').rules;

const FOES = data('foes');
const RULES = FOES.rules;
const STATUS = RULES.statuses;
const ELEMENTS = FOES.elements;
const COMBAT = mechanics.COMBAT;
const COMMANDS = ['strike', 'skill', 'item', 'guard', 'flee', 'probe', 'talk', 'tame'];
const hooks = { opening: () => {}, blow: () => ({}), stay: () => null, intent: (env, fight, entry, intent) => intent, acts: {}, moves: {},
  round: () => {}, ended: () => {}, view: () => ({}) };
const TAME = beasts.BEASTS.tame;
const CHECK_OF = { flee: '脱身', probe: '探查', talk: '交涉' };
const SUCCESS = ['大成功', '成功'];
const STRIKING = ['strike', 'cast', 'poison'];
const NORMAL = '一切正常';
const J = JSON.stringify;

const rowName = row => plain(row?.['1']).split('|')[0];
const hpOf = stats => ({ current: mechanics.statValue(stats['血量']), max: mechanics.statValue(stats['血量'], 'max') });
const percentOf = stats => { const hp = hpOf(stats); return hp.max > 0 ? 100 * hp.current / hp.max : 0; };
const tenths = odds => (odds >= 5 ? chronicle.numeral(Math.min(10, Math.round(odds / 10))) + '成' : '不足一成');
const argOf = (args, camel, snake) => plain(args?.[camel] ?? args?.[snake] ?? '');
const round3 = value => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------- who the foes are

function classOf(row, given) {
  if (Object.hasOwn(FOES.classes, given)) return given;
  const name = rowName(row), text = `${name} ${plain(row?.['2'])}`;
  for (const group of FOES.people) if (group.words.some(word => text.includes(word))) return group.class;
  const species = SPECIES.find(rule => rule.anyWord.some(word => name.includes(word)))?.species;
  for (const [kind, names] of Object.entries(FOES.species)) if (species && names.includes(species)) return kind;
  return mechanics.parseRealm(row?.['2']).beast ? 'beast' : FOES.fallback.people;
}

// The tiers (foes.json tiers): a fighter's is the one whose realm is nearest to its own.
const TIERS = FOES.tiers.list;
const scalar = realm => (Number(realm?.major) || 0) * 100 + (Number(realm?.minor) || 0);
const TIER_AT = TIERS.map(each => ({ tier: each.tier, at: scalar(mechanics.parseRealm(each.people)) }));

function tierOf(realm) {
  const at = scalar(realm);
  let best = TIER_AT[0];
  for (const each of TIER_AT) if (Math.abs(each.at - at) < Math.abs(best.at - at)) best = each;
  return best.tier;
}

function realmOfTier(tier, people) {
  const row = TIERS[Math.max(0, Math.min(TIERS.length - 1, Number(tier) || 0))];
  return people ? row.people : row.beast;
}

// ---------------------------------------------------------------- the five elements

const ELEMENT_WORDS = Object.entries(ELEMENTS.words).flatMap(([element, words]) => words.map(word => [word, element]));

// The element a text names first (its earliest word), or null.
function elementIn(text) {
  const source = plain(text);
  let found = null, at = Infinity;
  for (const [word, element] of ELEMENT_WORDS) {
    const index = source.indexOf(word);
    if (index >= 0 && index < at) { found = element; at = index; }
  }
  return found;
}

const baseOf = element => ELEMENTS.base[element] || element;
const foeElement = row => elementIn(rowName(row)) || elementIn(row?.['2']);
const skillElement = row => elementIn(row?.['1']) || elementIn(`${plain(row?.['4'])} ${plain(row?.['6'])}`);

// The factor on a blow of the `attack` element at a defender of the `defend` element.
function elementFactor(attack, defend) {
  if (!attack || !defend) return 1;
  const a = baseOf(attack), d = baseOf(defend);
  if (ELEMENTS.overcomes[a] === d) return ELEMENTS.strong;
  if (ELEMENTS.overcomes[d] === a) return ELEMENTS.weak;
  return 1;
}

// The elements of the player's root (column 5, else the remark 灵根), as the root's words name them.
function rootElements(env) {
  const row = env.state['0']?.B1;
  const column = plain(row?.['5']);
  const text = column && column !== '待定' ? column : plain(env.ctx.parseRemarksString(row?.['9'])['灵根']);
  return new Set(Object.keys(ELEMENTS.words).filter(element => text.includes(element)));
}

// The factor on a skill's mana: rootCost when its element (or the one it counts as) is in the root.
function costFactor(env, row) {
  const element = skillElement(row);
  if (!element) return 1;
  const roots = rootElements(env);
  return roots.has(element) || roots.has(baseOf(element)) ? ELEMENTS.rootCost : 1;
}

function skillCostOf(env, row, stats) {
  const cost = mechanics.skillCost(row, stats);
  const factor = costFactor(env, row);
  if (cost?.stat === '法力' && factor !== 1) cost.amount = Math.max(1, Math.ceil(cost.amount * factor));
  return cost;
}

// ---------------------------------------------------------------- statuses

const statusesOf = (fight, id) => ((fight.statuses ||= {})[id] ||= {});
const has = (fight, id, name) => Boolean(fight.statuses?.[id]?.[name]);

function give(fight, id, name, at, extra = {}) {
  statusesOf(fight, id)[name] = { since: at, ...(STATUS[name].rounds ? { left: STATUS[name].rounds } : {}), ...extra };
}

function take(fight, id, name) {
  if (fight.statuses?.[id]) delete fight.statuses[id][name];
}

// A fighter's statuses, in the order of foes.json.
const tagsOf = (fight, id) => Object.keys(STATUS).filter(name => has(fight, id, name));

// The player's status column, as this round leaves it: a word added or taken away, the rest as it was.
function withWord(text, word) {
  const now = plain(text);
  if (!now || now === NORMAL) return word;
  return now.split('，').includes(word) ? now : `${now}，${word}`;
}

function withoutWord(text, word) {
  const kept = plain(text).split('，').filter(part => part.trim() !== word);
  return kept.join('，').trim() ? kept.join('，') : NORMAL;
}

const selfOf = (env, round) => (round.self ??= plain(env.state['0']?.B1?.['4']) || NORMAL);

// 迟缓 halves 脚力, for a blow and for a check.
function slowedIf(fight, fighter) {
  if (!has(fight, fighter.id, '迟缓')) return fighter;
  const now = mechanics.statValue(fighter.stats['脚力']), max = mechanics.statValue(fighter.stats['脚力'], 'max');
  return { ...fighter, stats: { ...fighter.stats, 脚力: { current: Math.floor(now * STATUS.迟缓.agility), max } } };
}

// 脚力 times f for a blow (hooks.blow's pace: an array's 困).
function paced(fighter, f = 1) {
  if (f === 1) return fighter;
  const now = mechanics.statValue(fighter.stats['脚力']), max = mechanics.statValue(fighter.stats['脚力'], 'max');
  return { ...fighter, stats: { ...fighter.stats, 脚力: { current: Math.floor(now * f), max } } };
}

// ---------------------------------------------------------------- intents

// The intent a foe shows for round `at`: its class's cycle, or a weighted pick from the first group
// whose condition holds; no second charge while one is held.
function decide(env, fight, entry, stats, at) {
  const kind = FOES.classes[entry.class] || FOES.classes[FOES.fallback.people];
  if (kind.cycle) {
    const step = kind.cycle[entry.cycle % kind.cycle.length];
    entry.cycle += 1;
    return { name: step.name, act: step.act };
  }
  const share = percentOf(stats);
  const group = kind.intents.find(each => !each.when || share < each.when.hpBelow) || kind.intents.at(-1);
  const charged = has(fight, entry.id, '蓄势');
  const open = group.pick.filter(each => !(charged && each.act === 'charge'));
  const pool = open.length ? open : group.pick;
  let left = env.random({ kind: 'fight', fight: fight.id, round: at, command: `intent:${entry.id}` }).random()
    * pool.reduce((sum, each) => sum + each.weight, 0);
  const picked = pool.find(each => (left -= each.weight) < 0) || pool.at(-1);
  return { name: picked.name, act: picked.act };
}

const majorOf = fighter => fighter.realm.major;
const visible = (fight, entry, foe, player) => majorOf(foe) <= majorOf(player) || list(fight.probed).includes(entry.id);

// A round's working set: the player and the foes still standing as fighters (mechanics.fighter:
// their rows, panels and realms; a foe off the scene or down is left out), the commands and what
// they own, the blows struck, what each foe did, and which foes' intents the player can see.
function roundOf(env, fight, { player = null, fighters = null } = {}) {
  const commands = [];
  player ||= mechanics.fighter(env, 'B1', '', '', '你', commands);
  const foes = [];
  for (const entry of list(fight.foes)) {
    if (entry.out) continue;
    const foe = fighters?.get(entry.id) || mechanics.fighter(env, entry.id, '', '', '对手', commands);
    if (!foe.error && hpOf(foe.stats).current > 0) foes.push({ entry, foe });
  }
  // The spirit beast out with the player, while it stands (beasts.cjs).
  const beast = fight.beast && !fight.beast.out ? beasts.fighterOf(env, fight.beast.id) : null;
  return { fight, player, foes, byId: Object.fromEntries(foes.map(({ foe }) => [foe.id, foe])), beast: beast && hpOf(beast.stats).current > 0 ? beast : null,
    seen: new Set(foes.filter(({ entry, foe }) => visible(fight, entry, foe, player)).map(({ entry }) => entry.id)),
    commands, owns: ownsNothing(), strikes: [], ticks: [], did: {}, registered: new Set(), played: fight.round, guard: false,
    injured: Boolean(injury.active(env)) };
}

// ---------------------------------------------------------------- blows

// One strike on the fight's seed (see the header): returns the strike with its damage final.
function blow(env, round, parts, attacker, defender, { style = '物理', skillFactor, ambush = false, bonus = 0, factor = 1, element = null } = {}) {
  const { fight } = round;
  const seeded = { ...env, seed: env.seedOf({ kind: 'fight', fight: fight.id, round: round.played, ...parts }) };
  const opening = has(fight, defender.id, '破绽') ? STATUS.破绽.hit : 0;
  const more = hooks.blow(env, round, attacker, defender) || {};
  const struck = mechanics.strike(seeded, paced(slowedIf(fight, attacker), more.pace?.[attacker.id]), paced(slowedIf(fight, defender), more.pace?.[defender.id]),
    { style, ambush, skillFactor, bonus: bonus + opening + (more.bonus || 0), totals: totalsFor }, 0, 0);
  if (struck.hit) {
    const defend = fight.foes.find(entry => entry.id === defender.id)?.element || null;
    const elemental = elementFactor(element, defend);
    // A world factor's element damage (极寒末世: 火 and 冰 spells × 1.2).
    const climate = element ? world.hooks(env, 'elementDamage').filter(hook => hook.elements.includes(baseOf(element)) || hook.elements.includes(element))
      .reduce((value, hook) => value * hook.factor, 1) : 1;
    const total = factor * elemental * climate * (more.factor ?? 1);
    if (total !== 1) {
      struck.damage = Math.max(1, Math.floor(struck.damage * total));
      struck.factor = round3(total);
    }
    if (elemental !== 1) struck.element = { attack: element, defend, factor: elemental };
    const shield = fight.statuses?.[defender.id]?.护盾;
    if (shield?.amount > 0) {
      const absorbed = Math.min(shield.amount, struck.damage);
      struck.damage -= absorbed;
      struck.absorbed = absorbed;
      shield.amount -= absorbed;
      if (shield.amount <= 0) take(fight, defender.id, '护盾');
    }
    struck.hp.after = Math.max(0, struck.hp.before - struck.damage);
    struck.defeated = struck.hp.after === 0;
    // 护主: once a fight, the blow that would have downed the player leaves the trait's 气血.
    const stand = defender.id === 'B1' && struck.defeated && !fight.saved ? gear.traitsOf(env, 'lastStand')[0] : null;
    if (stand) {
      struck.damage = Math.max(0, struck.hp.before - stand.left);
      struck.hp.after = struck.hp.before - struck.damage;
      struck.defeated = false;
      struck.saved = stand.name;
      fight.saved = true;
    }
  }
  defender.stats = { ...defender.stats, 血量: { current: struck.hp.after, max: struck.hp.max } };
  return struck;
}

// The totals a blow counts with: the player's with the active gear (gear.totals), a foe's as the
// combat rules have them.
const totalsFor = (env, id, stats) => gear.totals(env, id, stats);
// A 符宝's blow counts the talisman's own attack as it is, nothing worn added.
const asIs = (env, id, stats) => (id === 'B1' ? Object.fromEntries(mechanics.STATS.map(stat => [stat, mechanics.statValue(stats[stat])]))
  : mechanics.totalStats(env, id, stats));

function down(round, fighter) {
  if (fighter.id === 'B1') return;
  const status = mechanics.defeatStatus(fighter.row);
  if (status) round.commands.push(`add(${J(fighter.id)},{"4":${J(status)}})`);
}

// What a blow leaves: the commands, and the statuses its element or its poison brings.
function landed(env, round, struck, attacker, defender, { element = null, poison = false } = {}) {
  const { commands, owns, fight } = round;
  owns.charStats.push(`${struck.by}:血量`, `${struck.at}:血量`);
  if (struck.by === 'B1' || struck.at === 'B1') owns.stats.push('血量');
  round.strikes.push(struck);
  if (!struck.hit) return;
  commands.push(`updateAttribute(${J(struck.at)},"血量",{"current":${struck.hp.after},"max":${struck.hp.max}})`);
  if (struck.defeated) {
    if (defender.id === 'B1') round.self = withWord(selfOf(env, round), COMBAT.defeat.status);
    else down(round, defender);
  }
  const status = element ? ELEMENTS.statuses[element] : null;
  if (status && ELEMENTS.self.includes(status)) {
    give(fight, attacker.id, status, round.played, { amount: Math.max(1, Math.ceil(hpOf(attacker.stats).max * STATUS[status].hpPercent / 100)) });
  }
  if (struck.defeated) return;
  if (status && !ELEMENTS.self.includes(status)) give(fight, defender.id, status, round.played, { from: attacker.id });
  if (struck.element?.factor > 1) give(fight, defender.id, '破绽', round.played, { from: attacker.id });
  if (poison) {
    give(fight, defender.id, '中毒', round.played, { from: attacker.id });
    if (defender.id === 'B1') round.self = withWord(selfOf(env, round), '中毒');
  }
}

// A foe's spell: the mana the combat rules ask for, or a plain blow when it cannot pay.
function spellOf(env, round, foe) {
  const total = mechanics.totalStats(env, foe.id, foe.stats);
  const mana = mechanics.statValue(foe.stats['法力']), max = mechanics.statValue(foe.stats['法力'], 'max');
  const cost = mechanics.spellManaCost(max);
  if (total['法攻'] <= 0 || max <= 0 || mana < cost) return '物理';
  round.commands.push(`updateAttribute(${J(foe.id)},"法力",{"current":${mana - cost},"max":${max}})`);
  foe.stats = { ...foe.stats, 法力: { current: mana - cost, max } };
  round.owns.charStats.push(`${foe.id}:法力`);
  return '法术';
}

// Every standing foe's move this round, on its intent; `forced` makes it a blow whatever it showed.
function foesAct(env, round, { forced = false, ambush = false, label = '趁势出手' } = {}) {
  const { fight, player } = round;
  for (const { entry, foe } of round.foes) {
    if (entry.out || hpOf(foe.stats).current <= 0 || hpOf(player.stats).current <= 0) continue;
    if (has(fight, entry.id, '定身')) {
      take(fight, entry.id, '定身');
      round.did[entry.id] = '定身';
      continue;
    }
    const act = forced ? 'strike' : entry.intent?.act || 'strike';
    round.did[entry.id] = forced ? label : entry.intent?.name || '出手';
    if (act === 'charge') { give(fight, entry.id, '蓄势', round.played); continue; }
    if (act === 'flee') {
      const held = hooks.stay(env, round, entry.id);
      if (held) round.did[entry.id] = held;
      else entry.out = 'fled';
      continue;
    }
    if (hooks.acts[act]) { hooks.acts[act](env, round, entry, foe); continue; }
    if (!STRIKING.includes(act)) continue;
    const style = act === 'cast' ? spellOf(env, round, foe) : '物理';
    const element = style === '法术' ? entry.element || null : null;
    // A beast guarding the player (机警, or told to) takes the first blow meant for the player.
    const cover = round.cover && !round.covered && round.beast && hpOf(round.beast.stats).current > 0 ? round.beast : null;
    const factor = (has(fight, entry.id, '蓄势') ? STATUS.蓄势.damage : 1) * (round.guard && !cover ? RULES.guard : 1);
    const struck = blow(env, round, { command: entry.id, nth: 1 }, foe, cover || player, { style, factor, ambush, element });
    take(fight, entry.id, '蓄势');
    if (cover) {
      round.covered = true;
      petStruck(env, round, struck);
      continue;
    }
    landed(env, round, struck, foe, player, { element, poison: act === 'poison' });
    if (round.guard && !struck.hit) give(fight, entry.id, '破绽', round.played, { from: 'B1' });
  }
}

function playerActs(env, round) {
  const { fight, player, target } = round;
  // 定身 that came on earlier in this round (a foe's 雷 spell) takes the player's blow.
  if (has(fight, 'B1', '定身')) {
    take(fight, 'B1', '定身');
    round.frozen = true;
    return;
  }
  if (round.talisman) return talismanActs(env, round);
  // 先声夺人: the first move of a fight the player moves first in.
  const perk = perks.hitBonus(env, { first: round.played === 1 && fight.first === 'player' });
  if (perk.value) round.perks = perk.names;
  const element = round.skill ? skillElement(round.skill.row) : null;
  // The active gear's traits: 回锋 after a miss, 镇邪 on 邪物 and 鬼物.
  const edge = Number(fight.edge) || 0;
  const bane = gear.traitsOf(env, 'bane').filter(each => each.classes.includes(target.entry.class))
    .reduce((value, each) => value * each.factor, 1);
  const factor = (target.entry.intent?.act === 'guard' ? RULES.guard : 1) * (round.injured ? STATUS.内伤.attack : 1) * bane;
  const struck = blow(env, round, { command: round.command, nth: 1 }, player, target.foe, {
    style: round.skill ? '法术' : '物理', skillFactor: round.skill ? mechanics.skillFactor(round.skill.row) : undefined,
    ambush: round.surprised, bonus: perk.value + edge, factor, element,
  });
  if (edge) {
    struck.edge = edge;
    fight.edge = 0;
  }
  if (bane !== 1 && struck.hit) struck.bane = bane;
  landed(env, round, struck, player, target.foe, { element });
  if (!struck.hit) {
    const riposte = gear.traitsOf(env, 'missBonus').reduce((sum, each) => sum + each.value, 0);
    if (riposte) fight.edge = riposte;
  } else drink(round, gear.traitsOf(env, 'manaOnHit'));
  if (struck.defeated) target.entry.out = 'fallen';
}

// The spirit beast's move at the round's start (beasts.cjs): its temperament's act, or the player's
// order when its favour is high enough. attack (凶悍) strikes the target before anyone else, harass
// (狡黠) puts 破绽 on it, guard (机警) takes the first blow meant for the player (foesAct). It holds
// back from striking a beast the player is taming.
function petActs(env, round, { order, command }) {
  const { fight, beast, target } = round;
  const plan = beasts.actFor(env, beast.id, order);
  round.pet = { id: beast.id, name: beast.name, act: plan.act, ...(plan.order ? { order: plan.order, obeyed: plan.obeyed } : {}) };
  if (plan.act === 'attack' && command === 'tame') {
    round.pet.held = true;
    return;
  }
  if (plan.act === 'guard') round.cover = true;
  if (plan.act === 'harass') {
    give(fight, target.entry.id, '破绽', round.played, { from: beast.id });
    round.pet.at = target.entry.id;
  }
  if (plan.act === 'attack') {
    const struck = blow(env, round, { command: 'beast', nth: 1 }, beast, target.foe, { style: '物理' });
    landed(env, round, struck, beast, target.foe);
    round.pet.at = target.entry.id;
    if (struck.defeated) target.entry.out = 'fallen';
  }
}

// A blow that landed on the beast: its 气血 on its own row (column 8); at 0 it is badly hurt, or
// dead in extreme mode, and fights no more.
function petStruck(env, round, struck) {
  const { fight, beast } = round;
  round.strikes.push(struck);
  if (round.pet) round.pet.covered = true;
  if (!struck.hit) return;
  const after = beasts.hurt(env, beast.id, { current: struck.hp.after, max: struck.hp.max }, round.commands);
  if (after) {
    fight.beast.out = after.died ? 'dead' : 'down';
    round.petDown = after;
    round.beast = null;
  }
}

// 噬灵: a hit brings back a share of the mana's max.
function drink(round, traits) {
  if (!traits.length) return;
  const { player } = round;
  const mana = mechanics.statValue(player.stats['法力']), max = mechanics.statValue(player.stats['法力'], 'max');
  const gain = traits.reduce((sum, each) => sum + Math.ceil(max * each.percent / 100), 0);
  const after = Math.min(max, mana + gain);
  if (after === mana) return;
  player.stats = { ...player.stats, 法力: { current: after, max } };
  round.commands.push(`updateAttribute("B1","法力",{"current":${after},"max":${max}})`);
  round.owns.stats.push('法力');
  round.drank = { before: mana, after };
}

// A 符宝 from the belt: the talisman's tier hits with its own attack, as a treasure of that tier.
function talismanActs(env, round) {
  const { player, target, talisman } = round;
  const realm = mechanics.parseRealm(`${talisman.realm}初期`);
  const wielder = { ...player, realm, stats: { ...player.stats, 法攻: { current: talisman.attack, max: talisman.attack } } };
  const seeded = { ...env, seed: env.seedOf({ kind: 'fight', fight: round.fight.id, round: round.played, command: 'talisman', nth: 1 }) };
  const struck = mechanics.strike(seeded, wielder, target.foe, { style: '法术', totals: asIs }, 0, 0);
  target.foe.stats = { ...target.foe.stats, 血量: { current: struck.hp.after, max: struck.hp.max } };
  struck.talisman = { id: talisman.id, name: talisman.name, tier: talisman.tier, left: gear.spend(env, talisman.id, round.commands, round.owns) };
  landed(env, round, struck, player, target.foe);
  if (struck.defeated) target.entry.out = 'fallen';
}

// The round's end: 灼烧 and 中毒 take their share of 气血, and every status given before this round
// counts down.
function tick(env, round) {
  const { fight } = round;
  for (const [id, held] of Object.entries(fight.statuses || {})) {
    const fighter = id === 'B1' ? round.player : round.byId[id];
    for (const [name, status] of Object.entries(held)) {
      if (status.since >= round.played) continue;
      if (fighter && STATUS[name].hpPercent && name !== '护盾' && hpOf(fighter.stats).current > 0) {
        const hp = hpOf(fighter.stats);
        const damage = Math.min(hp.current, Math.max(1, Math.ceil(hp.max * STATUS[name].hpPercent / 100)));
        const after = hp.current - damage;
        fighter.stats = { ...fighter.stats, 血量: { current: after, max: hp.max } };
        round.commands.push(`updateAttribute(${J(id)},"血量",{"current":${after},"max":${hp.max}})`);
        round.owns.charStats.push(`${id}:血量`);
        if (id === 'B1') round.owns.stats.push('血量');
        round.ticks.push({ id, status: name, damage, hp: { before: hp.current, after, max: hp.max }, ...(status.from ? { from: status.from } : {}), ...(after === 0 ? { defeated: true } : {}) });
        if (after === 0) {
          if (id === 'B1') round.self = withWord(selfOf(env, round), COMBAT.defeat.status);
          else down(round, fighter);
        }
      }
      if (status.left !== undefined && (status.left -= 1) <= 0) delete held[name];
    }
  }
}

// ---------------------------------------------------------------- checks

function priced(env, player, foe, command) {
  const context = { stats: gear.totals(env, 'B1', player.stats), realm: player.row?.['2'], perks: gear.traitNames(env),
    target: { id: foe.id, name: foe.name, realm: foe.row?.['2'], favour: Number(foe.row?.['15']) } };
  return actions.price(context, { kind: CHECK_OF[command], title: CHECK_OF[command], target: foe.id });
}

// A check of the fight, priced by the actions module and rolled on the fight's seed, shaped as a
// resolve_check's.
function check(env, round, command, foe) {
  const terms = priced(env, slowedIf(round.fight, round.player), foe, command);
  const roll = Math.floor(env.random({ kind: 'fight', fight: round.fight.id, round: round.played, command }).random() * rules.RULES.die) + 1;
  const total = roll + terms.modifier;
  const outcome = rules.checkOutcome(roll, total, terms.dc);
  return { kind: terms.check, tier: terms.tier, dc: terms.dc, die: rules.RULES.die, roll, attribute: terms.attribute, value: terms.value,
    modifier: terms.modifier, total, outcome, consequence: actions.CHECKS[terms.check].results[outcome].text, effects: [],
    target: { id: foe.id, name: foe.name }, reason: '', rulesVersion: rules.RULES.version, odds: terms.odds };
}

// What 降服 is aimed at: the beast among the foes standing below tame.below percent of its 气血 (the
// one named, else the first), with the check's terms; or why it cannot be tried.
function tameTarget(env, round, targetId) {
  const wild = round.foes.filter(({ entry, foe }) => entry.class === 'beast' && percentOf(foe.stats) < TAME.below);
  const named = targetId ? round.foes.find(({ entry }) => entry.id === targetId) : null;
  if (named && named.entry.class !== 'beast') return { refused: chronicle.fill(TAME.texts.notBeast, { 名: named.entry.name }) };
  const target = (named && wild.includes(named) ? named : null) || (!named ? wild[0] : null);
  if (!target) return { refused: TAME.texts.none };
  const terms = beasts.tameTerms(env, round.player, target.foe);
  return terms.refused ? { refused: terms.refused } : { target, terms };
}

// One taming check (驭兽, on 魅力), rolled on the fight's seed and shaped as a resolve_check's.
function tameCheck(env, round, { target, terms }) {
  const roll = Math.floor(env.random({ kind: 'fight', fight: round.fight.id, round: round.played, command: 'tame' }).random() * rules.RULES.die) + 1;
  const total = roll + terms.modifier;
  const outcome = rules.checkOutcome(roll, total, terms.dc);
  return { kind: '驭兽', tier: terms.tier, dc: terms.dc, die: rules.RULES.die, roll, attribute: terms.attribute, value: terms.value,
    modifier: terms.modifier, total, outcome, consequence: TAME.results[outcome], effects: [],
    target: { id: target.entry.id, name: target.entry.name }, reason: '', rulesVersion: rules.RULES.version, odds: terms.odds,
    ...(terms.names ? { perks: terms.names } : {}) };
}

// ---------------------------------------------------------------- the end

function spare(env, round) {
  const { player, commands } = round;
  const hp = hpOf(player.stats);
  const kept = Math.min(hp.max, Math.max(Math.ceil(hp.max * FOES.spared.percent / 100), FOES.spared.least));
  commands.push(`updateAttribute("B1","血量",{"current":${kept},"max":${hp.max}})`);
  round.self = withWord(withoutWord(selfOf(env, round), COMBAT.defeat.status), FOES.spared.status);
  player.stats = { ...player.stats, 血量: { current: kept, max: hp.max } };
}

// Whether the fight is at a dangerous place (its danger at foes.json encounters.cap.dangerous or more).
const dangerousHere = env => (Number(require('./places.cjs').placeFacts(env).danger) || 0) >= FOES.encounters.cap.dangerous;

function lose(env, round) {
  const { fight } = round;
  const fatal = round.strikes.findLast(struck => struck.at === 'B1' && struck.defeated)?.by
    || round.ticks.findLast(each => each.id === 'B1' && each.defeated)?.from;
  const by = fight.foes.find(entry => entry.id === fatal) || fight.foes[0];
  // 补刀 only where the difficulty has it (world.cjs loss: extreme mode); elsewhere the file's loss.
  const kind = world.loss(env, (FOES.classes[by.class] || FOES.classes[FOES.fallback.people]).loss);
  const loss = FOES.losses[kind];
  round.loss = { kind, name: loss.name, by: by.id };
  if (loss.stonesPercent) {
    const stones = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
    // in the life's first year a 劫财 takes no more than its grace's share, and outside a dangerous
    // place no more than its safe share at any age (foes.json losses; a 窃贼 in 泊灯城 took the 1,484
    // stones saved for a 筑基丹: the turns lane's real-model run, plan item 50's fixes)
    const shares = [loss.stonesPercent, ...(loss.grace && injury.graced(env) ? [loss.grace.stonesPercent] : []),
      ...(loss.safe && !dangerousHere(env) ? [loss.safe.stonesPercent] : [])];
    const percent = Math.min(...shares);
    const taken = Math.floor(stones * percent / 100);
    if (taken > 0) {
      round.commands.push(`add("B1",{"26":${J(String(stones - taken))}})`);
      round.owns.currency = true;
      round.loss.stones = taken;
    }
  }
  if (loss.spared) spare(env, round);
  if (kind === 'capture') {
    env.play.pending = [...list(env.play.pending), { id: nextId(env, 'pending', 'P'), trigger: { kind: 'now', value: fight.id },
      seed: `${loss.name}：落在${by.name}手里`, from: 'fight', since: clock.dateKey(clock.today(env)) }];
  }
  const realm = round.byId[by.id]?.realm || mechanics.parseRealm(env.state['0']?.[by.id]?.['2']);
  round.injury = injury.register(env, { tier: tierOf(realm), commands: round.commands, owns: round.owns });
  // Beaten down, one active piece of gear is damaged (gear.json damage).
  const damaged = gear.damage(env, { random: env.random({ kind: 'fight', fight: fight.id, round: round.played, command: 'damage' }) });
  if (damaged) round.damaged = damaged;
}

// The spoils of a foe beaten (plan item 30): rewards.loot once the actions lane's rewards module is
// there; nothing until then.
function loot(env, foe) {
  if (!fs.existsSync(path.join(__dirname, 'rewards.cjs'))) return null;
  const rewards = require('./rewards.cjs');
  return typeof rewards.loot === 'function' ? rewards.loot(env, foe) ?? null : null;
}

function end(env, round, how) {
  round.end = how;
  if (how === 'lose') lose(env, round);
  if (how === 'win') {
    // looted in settle, before the fight's own receipt (rewards.loot settles a receipt of its own)
    round.felled = round.fight.foes.filter(each => each.out === 'fallen').map(entry => {
      const realm = round.byId[entry.id]?.realm || mechanics.parseRealm(env.state['0']?.[entry.id]?.['2']);
      return { id: entry.id, name: entry.name, class: entry.class, tier: tierOf(realm), element: entry.element || null };
    });
  }
  const gone = new Set(round.fight.foes.filter(entry => entry.out === 'tamed').map(entry => entry.id));
  for (const id of new Set(['B1', ...round.fight.foes.map(entry => entry.id)])) {
    if (!env.state['0']?.[id] && !round.registered.has(id)) continue;
    // A beast tamed leaves the scene's table: it is the player's, in table 7.
    round.commands.push(gone.has(id) ? `de(${J(id)})` : `add(${J(id)},{"31":"false"})`);
  }
  hooks.ended(env, round, how);
  env.play.fight = null;
}

// ---------------------------------------------------------------- the receipt

function describe(struck, names) {
  const who = names[struck.by] || struck.by, whom = names[struck.at] || struck.at;
  if (!struck.hit) return `${who}出手落空`;
  return `${who}${struck.critical ? '重创' : '击中'}${whom}，伤害${struck.damage}`
    + (struck.absorbed ? `（护盾挡下${struck.absorbed}）` : '')
    + `，气血 ${struck.hp.before}→${struck.hp.after}/${struck.hp.max}` + (struck.defeated ? '，重伤倒地' : '');
}

// The beast's move in words: what it did, and an order it did not heed.
function petLine(pet, names) {
  const said = beasts.ACTS[pet.act]?.label || '';
  const whom = pet.at ? names[pet.at] || pet.at : '';
  const did = pet.held ? '按住不扑' : pet.act === 'harass' ? `${said}，${whom}露出破绽` : pet.act === 'guard' ? said : `${said}${whom}`;
  return `「${pet.name}」${did}` + (pet.order && !pet.obeyed ? '（不听吩咐）' : '');
}

const realmOf = (round, id) => (id === 'B1' ? round.player : round.byId[id] || (round.petAt?.id === id ? round.petAt : null))?.realm?.text || '';
const ENDS = { win: '斗法得胜', flee: '脱身而去', truce: '罢手言和' };

async function settle(env, round, { opened = false, rolled = null, probed = null } = {}) {
  // The spoils of the foes felled this round: each loot receipt settles before the fight's, so the
  // fight's receipt stays the last one and carries what they left (fight.loot).
  for (const foe of round.felled || []) {
    const got = await loot(env, foe);
    if (got) (round.loot ||= []).push(got.loot || got);
    // A person's bag holds more by their standing (gear.bag); what came off a named owner is stolen.
    if (['rogue', 'disciple', 'evil'].includes(foe.class)) {
      const found = gear.grantBag(env, foe, round.commands, round.owns);
      if (found) (round.bags ||= []).push({ foe: foe.id, ...found });
    }
  }
  const { fight, player } = round;
  const names = { B1: player.name, ...Object.fromEntries(fight.foes.map(entry => [entry.id, entry.name])),
    ...(fight.beast ? { [fight.beast.id]: fight.beast.name } : {}) };
  const going = !!env.play.fight;
  const foes = fight.foes.map(entry => ({
    id: entry.id, name: entry.name, ...(round.did[entry.id] ? { did: round.did[entry.id] } : {}),
    ...(going && !entry.out && entry.intent && round.seen.has(entry.id) ? { next: entry.intent.name } : {}),
    ...(entry.out ? { out: entry.out } : {}),
    ...(going && tagsOf(fight, entry.id).length ? { tags: tagsOf(fight, entry.id) } : {}),
  }));
  const self = [...(going ? tagsOf(fight, 'B1') : []), ...(round.injured ? ['内伤'] : [])];
  const first = round.strikes[0];
  const attack = first && {
    attacker: { id: first.by, name: names[first.by], realm: realmOf(round, first.by) },
    target: { id: first.at, name: names[first.at], realm: realmOf(round, first.at) },
    style: first.style, skill: round.skill ? { id: round.skill.id, name: round.skill.name, factor: mechanics.skillFactor(round.skill.row) } : null,
    paid: round.paid || [], strikes: round.strikes, names, rulesVersion: COMBAT.version,
  };
  if (round.self !== undefined && round.self !== (plain(env.state['0']?.B1?.['4']) || NORMAL)) {
    round.commands.push(`add("B1",{"4":${J(round.self)}})`);
  }
  const lines = [
    ...(rolled ? [`${rolled.kind}检定：1d${rolled.die}=${rolled.roll}，修正${rolled.modifier}，总值${rolled.total}（难度${rolled.dc}）→${rolled.outcome}`] : []),
    ...(round.frozen ? ['你被定身，这一手动弹不得'] : []),
    ...(round.joined ? [`「${round.joined.name}」随你出战`] : []),
    ...(round.pet ? [petLine(round.pet, names)] : []),
    ...round.strikes.map(struck => describe(struck, names)),
    ...(round.notes || []),
    ...(round.petDown ? [`「${fight.beast?.name || ''}」${round.petDown.died ? '殒命' : '重伤，要养'}`] : []),
    ...(round.tamed ? [`降服了「${round.tamed.name}」`] : []),
    ...fight.foes.filter(entry => round.did[entry.id] && !round.strikes.some(struck => struck.by === entry.id)).map(entry => `${entry.name}${round.did[entry.id]}`),
    ...round.ticks.map(each => `${names[each.id] || each.id}${each.status}，气血 ${each.hp.before}→${each.hp.after}/${each.hp.max}`),
    ...(round.end ? [round.end === 'lose' ? `斗法落败，${round.loss.name}` : ENDS[round.end]] : []),
    ...(round.injury ? [`留下内伤，养${chronicle.spanText(round.injury.days * clock.DAY_MINUTES)}` + (round.injury.pill ? `（服了${round.injury.pill.name}）` : '')] : []),
  ];
  const owns = { ...round.owns, stats: [...new Set(round.owns.stats)], charStats: [...new Set(round.owns.charStats)] };
  return env.settle({
    kind: 'fight', ok: true, source: opened ? 'engine' : 'move',
    fight: { id: fight.id, round: round.played, ...(opened ? { opened: true, first: fight.first } : { command: round.command }),
      ...(round.target ? { target: round.target.entry.id } : {}), foes,
      ...(self.length ? { self } : {}), ...(round.ticks.length ? { ticks: round.ticks } : {}), ...(round.perks ? { perks: round.perks } : {}),
      ...(round.end ? { end: round.end } : {}), ...(round.loss ? { loss: round.loss } : {}), ...(round.injury ? { injury: round.injury } : {}),
      ...(probed ? { probed } : {}), ...(round.loot ? { loot: round.loot } : {}), ...(round.bags ? { bags: round.bags } : {}),
      ...(round.damaged ? { damaged: round.damaged } : {}), ...(round.driven ? { driven: round.driven } : {}),
      ...(round.switched ? { switched: round.switched } : {}), ...(round.drank ? { drank: round.drank } : {}),
      ...(round.clocks ? { clocks: round.clocks } : {}),
      ...(round.pet ? { beast: { ...round.pet, ...(round.petDown || {}) } } : round.joined ? { beast: round.joined } : {}),
      ...(round.tamed ? { tamed: round.tamed } : {}), ...(round.extra || {}) },
    ...(attack ? { attack } : {}), ...(rolled ? { check: rolled } : {}),
    commands: round.commands.join('\n'), owns, ...(round.dailyUses ? { dailyUses: round.dailyUses } : {}),
    summary: `${opened ? '斗法开始' : `斗法第${round.played}回合`}：` + (lines.join('；') || '各自观望'),
  });
}

// The intents for the round after the one played, unless the fight is over.
function nextRound(env, round) {
  if (!env.play.fight) return;
  const fight = env.play.fight;
  fight.round = round.played + 1;
  fight.guard = false;
  for (const { entry, foe } of round.foes) {
    if (!entry.out && hpOf(foe.stats).current > 0) entry.intent = hooks.intent(env, fight, entry, decide(env, fight, entry, foe.stats, fight.round));
  }
  round.seen = new Set(round.foes.filter(({ entry, foe }) => visible(fight, entry, foe, round.player)).map(({ entry }) => entry.id));
}

// ---------------------------------------------------------------- open and move

async function open(env, args = {}) {
  const { foes = [], first, ambush } = args;
  if (env.play.fight) return { refused: '已经在斗法了' };
  const commands = [];
  const player = mechanics.fighter(env, 'B1', '', '', '你', commands);
  if (player.error || hpOf(player.stats).current <= 0) return { refused: '你已重伤倒地，动不了手' };
  const entries = [], fighters = new Map(), registered = new Set();
  for (const spec of list(foes)) {
    const given = typeof spec === 'string' ? { id: spec } : spec && typeof spec === 'object' ? spec : {};
    const foe = mechanics.fighter(env, plain(given.id), given.name, given.realm, '对手', commands);
    if (foe.error) return { refused: foe.error };
    if (foe.id === 'B1') return { refused: '不能和自己斗法' };
    if (hpOf(foe.stats).current <= 0) return { refused: `${foe.name}已经重伤倒地` };
    if (fighters.has(foe.id)) continue;
    fighters.set(foe.id, foe);
    if (foe.registered) registered.add(foe.id);
    entries.push({ id: foe.id, name: foe.name, class: classOf(foe.row, plain(given.class)), element: foeElement(foe.row), intent: null, cycle: 0, out: null });
  }
  if (!entries.length) return { refused: '没有对手' };
  const side = value => (value === 'player' || value === 'foes' ? value : null);
  const swift = id => gear.totals(env, id, (id === 'B1' ? player : fighters.get(id)).stats)['脚力'];
  const fight = { id: nextId(env, 'fight', 'F'), round: 1, since: clock.dateKey(clock.today(env)),
    first: side(first) || side(ambush) || (swift('B1') >= Math.max(...entries.map(entry => swift(entry.id))) ? 'player' : 'foes'),
    ambush: side(ambush) === 'player' ? 'player' : null, foes: entries, statuses: {}, guard: false, probed: [], probe: false };
  env.play.fight = fight;
  const round = roundOf(env, fight, { player, fighters });
  round.played = 0;
  round.registered = registered;
  round.commands.unshift(...commands);
  // 中毒 does not end with a fight: the status column carries it into the next one.
  if (selfOf(env, round).split('，').includes('中毒')) give(fight, 'B1', '中毒', 0);
  // The treasures are driven with mana (gear.json drive); what is stolen and worn here is seen.
  const driven = gear.drive(env, fight, round.commands, round.owns);
  if (driven.paid.length || driven.idle.length) round.driven = driven;
  const seen = gear.stolenUse(env, 'use');
  if (seen.length) round.clocks = seen;
  // The spirit beast out with the player joins (beasts.cjs).
  const pet = beasts.joining(env, round.commands);
  if (pet) {
    fight.beast = { id: pet.id, name: pet.name, temperament: pet.temperament };
    round.beast = beasts.fighterOf(env, pet.id, pet.hp || null);
    round.joined = { id: pet.id, name: pet.name, temperament: pet.temperament, joined: true };
  }
  hooks.opening(env, fight, args, round);
  if (String(env.state['0']?.B1?.['31']).trim() !== 'true') round.commands.push('add("B1",{"31":"true"})');
  for (const entry of entries) {
    if (!registered.has(entry.id) && String(env.state['0']?.[entry.id]?.['31']).trim() !== 'true') round.commands.push(`add(${J(entry.id)},{"31":"true"})`);
  }
  if (side(ambush) === 'foes') {
    foesAct(env, round, { forced: true, ambush: true, label: '偷袭' });
    if (hpOf(round.player.stats).current <= 0) end(env, round, 'lose');
  }
  nextRound(env, round);
  await settle(env, round, { opened: true });
  return { fight: env.play.fight };
}

async function fromAct(env, { target, outcome = null } = {}) {
  const key = plain(target);
  if (!key) return { refused: '没有对手' };
  const ambush = Object.hasOwn(FOES.fromAct, String(outcome)) && outcome !== 'notes' ? FOES.fromAct[outcome] : null;
  const opened = await open(env, { foes: [key], ...(ambush ? { ambush } : {}) });
  if (!opened.refused || !opened.refused.includes('不在当前场景中')) return opened;
  // A foe the story brought but never registered (batch 7): the target is its name.
  const foe = storyFoe(env, key);
  return foe ? open(env, { foes: [foe], ...(ambush ? { ambush } : {}) }) : opened;
}

// ---------------------------------------------------------------- a foe the story names

const STORY = FOES.story;
// A target's parts: 赤鳞毒蛇·一阶妖兽, 劫修（炼气五层）.
const PARTS = /[·・•/／|｜,，、;；()（）[\]【】\s]+/;
// A realm at the head of a part: 一阶赤鳞蛇, 炼气五层的劫修, 筑基长老.
const REALM_HEAD = /^((?:[一二三四五六七八九十]+[阶级](?:妖兽)?)|(?:炼气|练气)(?:[一二三四五六七八九十\d]+层|大圆满|圆满|期)?|(?:筑基|结丹|金丹|元婴|化神)(?:初期|前期|中期|后期|大圆满|圆满|期)?|凡人|凡兽)(?:的|之)?/;
// 那条, 一头: how the story points at it, not its name.
const POINTING = /^(?:那|这|一)(?:条|头|只|个|群|伙|名|位|尾|匹|窝)/;

// The species a name ends in (its head noun: 赤鳞毒蛇 is a snake, 马匪 is no horse), with its class.
function tailOf(name) {
  const rule = SPECIES.find(each => each.anyWord.some(word => name.endsWith(word)));
  const kind = rule && Object.keys(FOES.species).find(each => FOES.species[each].includes(rule.species));
  return kind ? { species: rule.species, class: kind } : null;
}

// Beast or person and which class, by the name (foes.json people and story) and the realm given;
// null when the name says neither (巨石, 后院).
function storyKind(name, realm) {
  const tail = tailOf(name);
  if (tail?.class === 'beast') return { class: 'beast', people: false };
  const group = FOES.people.find(each => each.words.some(word => name.includes(word)));
  if (group) return { class: group.class, people: true };
  if (tail) return { class: tail.class, people: false };
  if (realm?.beast) return { class: 'beast', people: false };
  if (STORY.mortal.some(word => name.includes(word)) || STORY.suffix.some(word => name.endsWith(word))) return { class: FOES.fallback.people, people: true };
  if (STORY.beast.some(word => name.endsWith(word)) || STORY.beastAnywhere.some(word => name.includes(word))) return { class: 'beast', people: false };
  if (realm) return { class: FOES.fallback.people, people: true };
  return null;
}

// The tier of a foe whose realm the story leaves out: the place's encounter table's rows of its
// kind (else of its side, people or not), each held to what is met here by chance
// (encounter.capOf: no higher than the player's own tier outside a dangerous place), the one
// nearest the player's own tier, the lower on a tie; the player's own tier where the place has no
// table.
function nearestTier(env, kind) {
  const encounter = require('./encounter.cjs');
  const own = tierOf(mechanics.parseRealm(env.state['0']?.B1?.['2']));
  const { facts, rows } = encounter.table(env);
  const cap = encounter.capOf(env, facts);
  const whoOf = row => FOES.encounters.who[row.who] || {};
  const side = rows.filter(row => Boolean(whoOf(row).people) === kind.people);
  const same = side.filter(row => whoOf(row).class === kind.class);
  const tiers = (same.length ? same : side).map(row => Math.min(row.tier, cap));
  if (!tiers.length) return Math.min(own, cap);
  return tiers.reduce((best, tier) => {
    const nearer = Math.abs(tier - own) - Math.abs(best - own);
    return nearer < 0 || (nearer === 0 && tier < best) ? tier : best;
  });
}

// The foe a target names that is no one on the scene or back from a biography: { name, realm,
// class } for open (mechanics.fighter registers it), or null for an id or a name that is neither
// beast nor person. A realm or tier the target writes stands; else nearestTier.
function storyFoe(env, target) {
  const text = plain(target);
  if (!text || /^[A-Za-z]+\d+$/.test(text)) return null;
  let given = '', name = '';
  for (const part of text.split(PARTS).filter(Boolean)) {
    const head = part.match(REALM_HEAD);
    if (head && !given) given = head[1];
    const rest = (head ? part.slice(head[0].length) : part).replace(POINTING, '').replace(/们$/, '');
    if (rest && !name) name = rest;
  }
  name ||= given;
  if (!name) return null;
  const read = mechanics.parseRealm(given || name);
  const realm = read.unknown ? null : read;
  const kind = storyKind(name, realm);
  if (!kind) return null;
  const mortal = !realm && STORY.mortal.some(word => name.includes(word));
  const tier = realm ? tierOf(realm) : mortal ? 0 : nearestTier(env, kind);
  // a person's realm as the story writes it (炼气五层); a beast's, or one by tier, as the tiers write it
  const exact = realm && kind.people && !realm.beast && given;
  return { name: name.slice(0, 20), realm: exact ? given : realmOfTier(tier, kind.people), class: kind.class };
}

// A weapon or an armour in the bag put on in the first slot of its kind, in the fight: the move.
function switching(env, id) {
  const row = env.state['1']?.[id];
  const slot = { 武器: 'weapon', 护甲: 'armor' }[plain(row?.['2'])];
  if (!row || !slot || env.ctx.storedItemIds(env.state).has(id)) return null;
  const why = gear.canEquip(env, id);
  if (why) return { refused: why };
  return { slot, name: plain(row['1']).split('|')[0], commands: [`equipItem("B1",${J(slot)},{"index":0,"data":{"0":${J(id)}}})`, `de(${J(id)})`] };
}

// A thing whose effect names the poison's cure.
const cures = row => STATUS.中毒.cure.some(word => `${plain(row?.['1'])} ${plain(row?.['4'])}`.includes(word));

async function move(env, args = {}) {
  let fight = env.play.fight;
  if (!fight) return env.refuse('眼下没有在斗法');
  const command = plain(args.command);
  const own = Object.hasOwn(hooks.moves, command) ? hooks.moves[command] : null;
  if (!COMMANDS.includes(command) && !own) return env.refuse(`斗法里没有「${command.slice(0, 10)}」这一手`);
  const targetId = argOf(args, 'targetId', 'target_id');
  let round = roundOf(env, fight);
  if (!round.foes.length) return env.refuse('对手都已不在');
  const targetOf = () => round.foes.find(({ entry }) => entry.id === targetId) || round.foes[0];
  if (command === 'probe') {
    if (fight.probe) return env.refuse('这一场已经察过了');
    fight.probe = true;
    round.command = command;
    round.target = targetOf();
    const rolled = check(env, round, 'probe', round.target.foe);
    let probed = null;
    if (SUCCESS.includes(rolled.outcome)) {
      const { entry, foe } = round.target;
      fight.probed = [...new Set([...list(fight.probed), entry.id])];
      round.seen.add(entry.id);
      probed = { id: entry.id, name: entry.name, hp: hpOf(foe.stats), realm: foe.realm.text, next: entry.intent?.name || null };
    }
    await settle(env, round, { rolled, probed });
    return { fight: view(env) };
  }
  if (command === 'talk' && !round.foes.some(({ foe }) => percentOf(foe.stats) < RULES.talkBelow)) return env.refuse('对方还没到肯听你说话的时候');
  // What holds the player (an array's 困) and the checks of the player's own commands, before anything moves.
  const held = command === 'flee' && !has(fight, 'B1', '定身') ? hooks.stay(env, round, 'B1') : null;
  if (held) return env.refuse(held);
  const why = own ? own.check(env, round, args) : null;
  if (why) return env.refuse(why);
  // The order to the spirit beast (one a round) and 降服, checked before anything moves.
  const order = plain(args.order);
  if (order && !Object.hasOwn(beasts.ACTS, order)) return env.refuse(chronicle.fill(beasts.BEASTS.texts.noOrder, { 令: order.slice(0, 10) }));
  if (order && !round.beast) return env.refuse(beasts.BEASTS.texts.noOut);
  const taming = command === 'tame' ? tameTarget(env, round, targetId) : null;
  if (taming?.refused) return env.refuse(taming.refused);
  // 定身 from the round before takes the player's whole command.
  const frozen = has(fight, 'B1', '定身');
  // 物: only what hangs at the belt, a 符宝 there striking as its tier's treasure; a weapon or an
  // armour from the bag is put on in place of the first one, and that is the move.
  let swap = null, charm = null;
  const itemId = argOf(args, 'itemId', 'item_id');
  if (command === 'item' && !frozen) {
    const row = env.state['1']?.[itemId];
    swap = switching(env, itemId);
    if (swap?.refused) return env.refuse(swap.refused);
    if (!swap) {
      if (!gear.beltIds(env).includes(itemId)) return env.refuse('斗法里「物」只能用腰带上的东西');
      charm = gear.talisman(env, itemId);
      if (charm) charm = { id: itemId, name: plain(row?.['1']).split('|')[0], ...charm };
      else {
        const used = rules.useItem(env, { id: itemId, quantity: 1, consumed: true }, 'move');
        if (!used.ok) return env.refuse(used.reason || '这件东西用不了');
        await env.settle(used);
        fight = env.play.fight;
        round = roundOf(env, fight);
        if (cures(row) && (has(fight, 'B1', '中毒') || selfOf(env, round).split('，').includes('中毒'))) {
          take(fight, 'B1', '中毒');
          round.self = withoutWord(selfOf(env, round), '中毒');
        }
      }
    }
  }
  round.command = command;
  round.target = taming ? taming.target : targetOf();
  if (swap) {
    round.commands.push(...swap.commands);
    round.owns.items.push(itemId);
    round.switched = { id: itemId, name: swap.name, slot: swap.slot };
  }
  if (charm) round.talisman = charm;
  // Foes caught in the player's ambush have no reply in its round, as the combat rules have it.
  round.surprised = fight.ambush === 'player';
  fight.ambush = null;
  if (frozen) {
    take(fight, 'B1', '定身');
    round.frozen = true;
  }
  if (command === 'skill' && !frozen) {
    round.skill = mechanics.skillOf(env, 'B1', argOf(args, 'skillId', 'skill_id'));
    if (!round.skill) return env.refuse('还没学会这门术法');
    const cast = mechanics.castSkill(env, round.player, round.skill, round.commands, round.owns, { costFactor: costFactor(env, round.skill.row) });
    if (cast.error) return env.refuse(cast.error);
    round.paid = cast.paid;
    round.dailyUses = cast.dailyUses;
  }
  round.guard = fight.guard = command === 'guard' && !frozen;
  if (round.beast) {
    round.petAt = round.beast;
    petActs(env, round, { order, command });
  }
  const cleared = () => round.foes.every(({ entry, foe }) => entry.out || hpOf(foe.stats).current <= 0);
  let rolled = null;
  if (!frozen && !cleared() && (command === 'flee' || command === 'talk')) {
    rolled = check(env, round, command, round.target.foe);
    if (SUCCESS.includes(rolled.outcome)) end(env, round, command === 'flee' ? 'flee' : 'truce');
    else if (command === 'flee' && !round.surprised) foesAct(env, round, { forced: true });
  }
  if (!frozen && !cleared() && command === 'tame' && hpOf(round.target.foe.stats).current > 0) {
    rolled = tameCheck(env, round, taming);
    const { entry, foe } = round.target;
    if (SUCCESS.includes(rolled.outcome)) {
      const mana = foe.stats['法力'];
      const made = beasts.tamed(env, { name: entry.name, tier: tierOf(foe.realm), hp: hpOf(foe.stats), outcome: rolled.outcome, commands: round.commands,
        mp: { current: mechanics.statValue(mana), max: mechanics.statValue(mana, 'max') } });
      entry.out = 'tamed';
      round.tamed = { foe: entry.id, id: made.id, name: made.name };
    } else if (TAME.outcomes[rolled.outcome]?.flee) entry.out = 'fled';
  }
  if (!frozen && !cleared() && own) rolled = (await own.run(env, round, args))?.rolled || rolled;
  if (env.play.fight && !cleared() && (command !== 'flee' || frozen)) {
    for (const side of fight.first === 'foes' ? ['foes', 'player'] : ['player', 'foes']) {
      if (side === 'foes' && !round.surprised) foesAct(env, round);
      else if (side === 'player' && !frozen && (command === 'strike' || command === 'skill' || round.talisman)) playerActs(env, round);
      if (hpOf(round.player.stats).current <= 0 || round.foes.every(({ entry, foe }) => entry.out || hpOf(foe.stats).current <= 0)) break;
    }
  }
  if (env.play.fight && hpOf(round.player.stats).current > 0) hooks.round(env, round, { blow, landed, asIs });
  if (env.play.fight && hpOf(round.player.stats).current > 0) tick(env, round);
  for (const { entry, foe } of round.foes) if (!entry.out && hpOf(foe.stats).current <= 0) entry.out = 'fallen';
  if (env.play.fight && hpOf(round.player.stats).current <= 0) end(env, round, 'lose');
  else if (env.play.fight && fight.foes.every(entry => entry.out)) end(env, round, 'win');
  nextRound(env, round);
  await settle(env, round, { rolled });
  return { fight: view(env) };
}

// ---------------------------------------------------------------- what the player sees

function hitOdds(env, player, foe, bonus) {
  const sample = mechanics.strike({ ...env, seed: 'odds' }, player, foe, { style: '物理', bonus, totals: totalsFor }, 0, 0);
  const { die, dc } = COMBAT.hit;
  let hits = 0;
  for (let roll = 1; roll <= die; roll += 1) if (roll === die || (roll !== 1 && roll + sample.agility + sample.realm + bonus >= dc)) hits += 1;
  return Math.round(100 * hits / die);
}

// The belt (frxPlay.belt, gear.cjs): what 物 can use.
const belt = env => gear.beltItems(env);

function skillNote(env, player) {
  const words = FOES.commands.skill;
  const skills = Object.values(env.state['8'] || {}).filter(Boolean);
  if (!skills.length) return { note: words.none, off: true };
  for (const row of skills) {
    const cost = skillCostOf(env, row, player.stats);
    if (!cost || !cost.stat) return { note: words.free };
    if (mechanics.statValue(player.stats[cost.stat]) >= cost.amount) {
      return { note: chronicle.fill(words.note, { 项: cost.stat, 数: chronicle.numeral(cost.amount) }) };
    }
  }
  return { note: words.short, off: true };
}

// What 术 can cast now (PlayFight.skills): each skill's cost in words (the root's share off), the
// chance to hit the target, and off with why when it cannot be cast: short of what it costs, or
// what the combat rules refuse (its daily uses), tried on a copy so nothing is spent.
function skillsOf(env, player, odds) {
  const words = FOES.commands.skill;
  return Object.entries(env.state['8'] || {}).filter(([, row]) => row).map(([id, row]) => {
    const cost = skillCostOf(env, row, player.stats);
    const said = !cost ? words.free : cost.stat ? chronicle.fill(words.note, { 项: cost.stat, 数: chronicle.numeral(cost.amount) }) : [...plain(cost.narrative)].slice(0, 20).join('');
    const short = cost?.stat && mechanics.statValue(player.stats[cost.stat]) < cost.amount;
    const tried = short ? null : mechanics.castSkill({ ...env, castThisTurn: new Set() }, { ...player, stats: { ...player.stats } },
      { row, id, name: rowName(row), own: true }, [], ownsNothing(), { costFactor: costFactor(env, row) });
    const why = short ? (cost.stat === '法力' ? words.short : `${cost.stat}不足`) : tried.error || null;
    return { skillId: id, name: rowName(row) || id, cost: said, odds, ...(why ? { off: true, note: why } : {}) };
  });
}

function view(env) {
  const fight = env.play?.fight;
  if (!fight) return null;
  const round = roundOf(env, fight);
  if (!round.foes.length) return null;
  const { player } = round, target = round.foes[0], words = FOES.commands;
  const odds = command => chronicle.fill(words[command].note, { 成: tenths(priced(env, slowedIf(fight, player), target.foe, command).odds) });
  const items = belt(env);
  const charged = round.foes.some(({ entry }) => has(fight, entry.id, '蓄势') && round.seen.has(entry.id) && STRIKING.includes(entry.intent?.act));
  const bonus = (has(fight, target.entry.id, '破绽') ? STATUS.破绽.hit : 0) + (fight.ambush === 'player' ? COMBAT.hit.ambush : 0)
    + perks.hitBonus(env, { first: fight.round === 1 && fight.first === 'player' }).value;
  const hits = hitOdds(env, slowedIf(fight, player), slowedIf(fight, target.foe), bonus);
  const commands = [
    { command: 'strike', glyph: words.strike.glyph, note: chronicle.fill(words.strike.note, { 成: tenths(hits) }) },
    { command: 'skill', glyph: words.skill.glyph, ...skillNote(env, player) },
    { command: 'item', glyph: words.item.glyph, ...(items.length ? { note: chronicle.fill(words.item.note, { 数: chronicle.numeral(items.length) }) } : { note: words.item.none, off: true }) },
    { command: 'guard', glyph: words.guard.glyph, note: words.guard.note, ...(charged ? { hint: true } : {}) },
    { command: 'flee', glyph: words.flee.glyph, note: odds('flee') },
    { command: 'probe', glyph: words.probe.glyph, ...(fight.probe ? { note: words.probe.used, used: true } : { note: odds('probe') }) },
    ...(round.foes.some(({ foe }) => percentOf(foe.stats) < RULES.talkBelow) ? [{ command: 'talk', glyph: words.talk.glyph, note: odds('talk') }] : []),
  ];
  const foes = round.foes.map(({ entry, foe }) => {
    const tags = tagsOf(fight, entry.id);
    if (list(fight.probed).includes(entry.id)) tags.push(`气血 ${hpOf(foe.stats).current}/${hpOf(foe.stats).max}`, foe.realm.text);
    return { charId: entry.id, name: entry.name, ...(round.seen.has(entry.id) && entry.intent ? { intent: entry.intent.name } : {}), tags };
  });
  const { commands: more = [], ...added } = hooks.view(env, round) || {};
  return { round: fight.round, foes, commands: [...commands, ...more], belt: items, skills: skillsOf(env, player, hits),
    ...(round.beast ? { beast: petView(env, fight, round.beast) } : {}), ...tameView(env, round), ...added };
}

// The beast out in the fight: its temperament and the act it will make, its 气血, whether it heeds
// an order, and the orders (攻 护 扰; off with why when it will not heed them).
function petView(env, fight, beast) {
  const heeds = beasts.obeys(env, beast.id);
  const refused = chronicle.fill(beasts.BEASTS.obey.refused, { 名: beast.name });
  return { id: beast.id, name: beast.name, temperament: fight.beast.temperament, act: beasts.TEMPERS[fight.beast.temperament]?.act || null,
    hp: hpOf(beast.stats), obeys: heeds,
    orders: Object.entries(beasts.ACTS).map(([order, act]) => ({ order, glyph: act.glyph, label: act.label, note: heeds ? act.note : refused, ...(heeds ? {} : { off: true }) })) };
}

// 降服 while a beast among the foes is below tame.below percent of its 气血: aimed at the first such,
// with its chance, or off with why it cannot be tried (a major realm above, no room to keep it).
function tameView(env, round) {
  const wild = round.foes.find(({ entry, foe }) => entry.class === 'beast' && percentOf(foe.stats) < TAME.below);
  if (!wild) return {};
  const terms = beasts.tameTerms(env, round.player, wild.foe);
  return { tame: { command: 'tame', glyph: TAME.glyph, foeId: wild.entry.id, name: wild.entry.name,
    ...(terms.refused ? { note: terms.refused, off: true }
      : { note: chronicle.fill(TAME.texts.note, { 成: tenths(terms.odds) }), odds: Math.round(terms.odds) }) } };
}

// The op "fight": a fight the server opens (the act op opens one with fromAct).
async function openOp(env, args) {
  const opened = await open(env, args);
  return opened.refused ? env.refuse(opened.refused) : { fight: view(env) };
}

module.exports = {
  open, openOp, fromAct, storyFoe, move, view, classOf, tierOf, realmOfTier, elementIn, elementFactor, skillElement, costFactor, loot, hooks,
};
