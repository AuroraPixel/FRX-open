'use strict';
/* The kinds of action on a scene's cards and the price of a card (玩法设计第五节, plan item 6).
 *
 * price(ctx, card) prices one card the model handed back; classify(text) sorts a sentence into one
 * of the twelve kinds. Both are pure: they read their arguments and the rule data, nothing else,
 * and the same input always gives the same output. The rule data is content/life/actions.json
 * (the kinds, the difficulty rules, favour, tones), content/life/checks.json (the five new checks)
 * and content/checks.json (the die, the tiers, the modifier bands and the old checks). How a roll
 * turns into one of the four outcomes is turn-rules.cjs's own checkOutcome, the function
 * resolveCheck rolls with, so the odds on a card are the odds of the real roll.
 *
 * card: one card as the model handed it back (plan 「行动卡」), already split into fields:
 *   kind      string   one of the twelve kinds or an alias of one; anything else is replaced by
 *                      classify(title), with a note
 *   title     string   kept as given
 *   target    string   the object, by id or by name: a person (C1, G2), a bag item (I3) or a
 *                      skill (S4); '' for none
 *   tier      string   the difficulty the model proposed (易, 中, 难, 极难); '' for none
 *   gate      string   the optional fifth segment: 神识<数>, 境界<名>, 持有<物品编号>, 好感<档名>
 *   route, intent     the proposed purpose of a narrative route (kept on the chosen receipt)
 *   index     number   optional, passed through (from 1, like a turn's option)
 *   fallback  boolean  optional, passed through: a card made from a <branches> sentence
 *   price     number   optional: what a purchase costs, when the server knows it (contextOf reads it)
 *
 * ctx: what the engine knows when it prices the card, as plain values; contextOf(env, card) builds
 * it from the save. A missing field reads as empty (no stats, unknown realm, no stones, nothing).
 *   stats       object   the player's attributes, B1 column 11 parsed: { 魅力: { current, max } or a
 *                        number, … }. A check reads `current` (or the number) exactly as
 *                        resolveCheck does. Mana is stats.法力.
 *   realm       string   the player's realm, B1 column 2 ("炼气三层|散修"), read with
 *                        mechanics.parseRealm; or an already parsed { major, minor }
 *   stones      number   当前灵石, B1 column 26, in 下品灵石 (mechanics.stonesOf)
 *   bag         array    the stacks in the bag, stored items left out: [{ id, name, count, type,
 *                        aid, unusable }], aid when it is a breakthrough pill (mechanics.isAid),
 *                        unusable why taking one now would be refused (contextOf: the use-item
 *                        rule tried and nothing changed, turn-rules useItem: mana or blood already
 *                        full, a daily limit reached, 丹毒 at its cap); optional, '' when it can be
 *                        taken
 *   skills      array    the player's skills, table 8: [{ id, name, cost }], cost being
 *                        mechanics.skillCost(row, stats): null, { stat, amount } or { narrative }
 *   target      object   null, or the person on the scene the card's target names (table 0 row):
 *                        { id, name, realm, favour }, realm as above (column 2), favour column 15
 *                        as a number (the card's favour runs from −100 to 100; actions.json
 *                        `favour`). It counts only when its id or name is the card's target.
 *   relationshipGains object optional, the scene's positive favour already received, by person
 *                        id and action kind. A repeated success only tops up a better result;
 *                        losses and every other cost remain payable.
 *   clockSteps  number   steps filled on the pressure clock the card bears on (clocks.clockStepsFor:
 *                        a clock whose rule names the target, or whose scope holds where it is
 *                        played); 0 when none
 *   clockName   string   that clock's name, for the card's text; optional
 *   clockId     string   that clock's id (K1), for the act to move it; optional
 *   perks       array    the player's 悟得 (perks.cjs): 脚底抹油 adds to a check, 夜行 lowers the
 *                        tier at night, 察言观色 shows more on a talk; optional
 *   hour        number   the hour of day on the clock (0 to 23), null when the row has none
 *   price       number   the stones a purchase costs or a sale fetches, when the engine knows the
 *                        price (contextOf: the card's own, else dealOf's); optional
 *   good        object   a purchase's catalogue good { id, name }, which the act puts in the bag;
 *                        optional (a thing of the story's has none)
 *   unpriced    boolean  a sale of a thing the catalogue does not list: 无市价, the card is locked
 *
 * price returns the priced card:
 *   index?, fallback?, leave? (the model wrote 离开), kind, glyph, title, target, targetName,
 *   object      null or { type: person | item | skill, id, name }: what the target was found to be
 *   clock       null or { id, name, steps }: the pressure clock the card bears on (ctx.clockId)
 *   plain       true when no die is rolled: a kind without a check, or a card with a gate
 *   check, attribute, value, modifier, tier, dc   the roll: check kind, attribute and its value,
 *               the modifier from its band, the difficulty tier and number (null when plain)
 *   odds        0 to 100: the share of the die's faces that come out 成功 or 大成功 (null when plain)
 *   faces       { 大成功, 成功, 失败, 大失败 }: how many faces give each (null when plain)
 *   tone        good, mid or poor, from the odds (null when plain)
 *   proposed    the model's tier when it was one of the four, else null
 *   adjust      [{ rule, step, text }]: the difficulty rules that moved the tier from 中 (a perk
 *               that lowers it is rule "perk")
 *   bonus?      { value, names }: what perks add to the check's modifier (already in modifier)
 *   insight?    { name, tier, how, perks } on a talk with 察言观色: the person's favour tier and how
 *               the difficulty came about (also in sub)
 *   gate        null or { kind, value, text }: the model's gate, when it is one of the four forms
 *   locked, reason   不够格 and why, in Chinese for the player ('' when not locked)
 *   cost        { minutes, stones, stats: [{ stat, amount }], items: [{ id, name, count, consumed }] }
 *   trade?      { direction: buy or sell, item, price } for 买卖
 *   outcomes    { 大成功, 成功, 失败, 大失败 } → consequence, for a roll (null when plain)
 *   effect      the consequence of doing it, when plain (null for a roll)
 *               consequence: { favour?, clock?, harm?, fight?, doubleCost?, use?, trade?, text }:
 *               favour already scaled to the card's range and only with a person; harm the percent
 *               of 血量 the check takes at this tier
 *   failure     what failing costs, in Chinese ('' when it costs nothing more than the attempt)
 *   sub         the card's small line: kind, what it looks at, difficulty, costs, what failing costs
 *   notes       what the engine changed in the card, for the progress record
 *
 * contextOf(env, card) → ctx, read from the life env (index.cjs) as the card's target names it.
 *
 * op "cards" (plan item 6), args { cards: [card], fallback? }: prices the model's cards (at most
 *   cards.max of them, the rest left out) and a 「离开」 card after them, a plain 静观 with leave
 *   (the model's own 离开 card, when it gave one, else cards.leave); numbers them from 1, keeps them
 *   in frxPlay.cards and settles a receipt { kind: "cards", hidden: true } to carry it (it settles
 *   like any receipt but has no block of its own: not readOnly, which is not settled). fallback marks the
 *   model's cards (made from <branches>). Output { cards: [priced card] }.
 * op "act" (plan item 8), args { index } (frxPlay.cards[index - 1]) or { card } (an ad hoc card:
 *   free text the server classified), and nth (the turn's how-many-th roll on that kind and target,
 *   1 by default). The card is priced again on the state as it is; a missing or ineligible one is
 *   refused with the reason. Then, settling:
 *   - the costs: a 施术 card's skill through mechanics.useSkill and a used-up thing through
 *     rules.useItem (their own receipts: mana, proficiency, the item's effect and limits); stones
 *     at a known price; the minutes through clock.advance, on the act receipt; a 买卖 card's deal
 *     (dealt): the catalogue good bought into the bag (rewards.grant), the thing sold out of it,
 *     one piece, and its price into the purse (`paid`), the receipt's trade marked settled;
 *   - the roll (unless plain): 1d10 on env.random({ kind: "check", type: kind, target, nth }), taken
 *     at the moment before the minutes pass, and turn-rules' checkOutcome;
 *   - the outcome's consequence (the priced card's outcomes, or its effect when plain): favour on
 *     the person's column 15 (held to the favour range), harm off 血量, the cost again on doubleCost,
 *     fight: once the act's receipt is settled the fight opens (fight.fromAct, items 19 and 31) with
 *     the card's target as the foe and the outcome saying who is caught unawares (foes.json
 *     fromAct); a target that names a foe the story never registered is one of its kind and tier
 *     (fight.storyFoe); a target that is no one to fight leaves only the flag, for the story;
 *   - the pressure clocks: clocks.raiseFor with the kind, the outcome, the place and a thing shown
 *     (the clocks' own rules: fumble, strike in scope, shown, started); then the outcome's clock
 *     steps on the clock the card bears on (card.clock) with clocks.bump, unless raiseFor moved it;
 *   - in a scene: marks it rolled and keeps the clock moves for the close card; the 离开 card
 *     closes it as 小 (scene.cjs).
 *   The act receipt: { kind: "act", ok, source: "card", card: { index, kind, glyph, title, target,
 *   object, plain, leave? }, check?: the check_block shape of resolveCheck's (kind is the card's kind,
 *   rule the check's name, plus seed), outcome, effects: [{ stat, before, after, max, damage? }],
 *   paid: [{ stat, before, after }], favour?: { id, name, before, after, change }, fight?, clocks?:
 *   [the clock moves: { id, name, before, after, full?, gone?, started? } or { name, refused }],
 *   trade?, encounter?, commands, owns, summary, time, age }. Output { card, outcome, fight? }: fight
 *   the fight's view when one opened.
 * 论道 (item 36): when someone of mind.talk's favour or more is on the scene and the player has not
 *   talked the Way with them this year (mind.talkable), the cards op adds one 交涉 card, 「与X论道」
 *   (talk: true), before 离开; played, its outcome adds 心境 +1 to +3 (mind.talked: the receipt's
 *   `mind` and the summary say it), once a year with that person.
 *   While an encounter waits (frxPlay.encounter, encounter.cjs) its beat's cards are the cards: the
 *   cards op keeps them, act plays only them (priced by encounter.price), and once settled
 *   encounter.after says what the beat came to (the receipt's `encounter`), maybe a fight.
 */
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../turn-rules.cjs');
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const places = require('./places.cjs');
const goods = require('./goods.cjs');
const scene = require('./scene.cjs');
const perkLib = require('./perks.cjs');
const gear = require('./gear.cjs');
const mind = require('./mind.cjs');
const beasts = require('./beasts.cjs');

const read = file => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../content', file), 'utf8'));
const ACTIONS = read('life/actions.json');
const LIFE_CHECKS = read('life/checks.json');
const RULES = rules.RULES;
// The checks a card can roll: the old ones no tool settles on its own, and the five new ones.
const CHECKS = {
  ...Object.fromEntries(Object.entries(RULES.kinds).filter(([, kind]) => !kind.tool)),
  ...LIFE_CHECKS.kinds,
};
const TIERS = Object.keys(RULES.tiers).sort((a, b) => RULES.tiers[a] - RULES.tiers[b]);
const OUTCOMES = ['大成功', '成功', '失败', '大失败'];
const FAVOUR = ACTIONS.favour;
// The direct way (batch 8): a gated success earns a fraction of the relationship gain.
const DIRECT = ACTIONS.direct;
const directWay = spec => (spec?.favour ? { ...spec, favour: spec.favour * DIRECT.gain } : spec);
const FAVOUR_SCALE = (FAVOUR.range[1] - FAVOUR.range[0]) / (FAVOUR.scaleFrom[1] - FAVOUR.scaleFrom[0]);
const NUMERALS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];
const STONES = '灵石';
const ORDER = mechanics.COMBAT.realms.order;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const numeral = n => NUMERALS[n] ?? String(n);
const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- kinds and classify

const NAMES = new Map(Object.entries(ACTIONS.kinds)
  .flatMap(([name, kind]) => [[name, name], ...(kind.aliases || []).map(alias => [alias, name])]));

// The kind a name on a card means, or null.
const kindName = given => NAMES.get(plain(given)) ?? null;

const TABLES = { COMBAT_WORDS: rules.COMBAT_WORDS, SKILL_WORDS: rules.SKILL_WORDS, TRADE_WORDS: rules.TRADE_WORDS };

function table(name) {
  const [base, group] = name.split('.');
  if (base === 'CHECK_WORDS' && rules.CHECK_GROUPS[group]) return new RegExp(rules.CHECK_GROUPS[group]);
  if (!group && TABLES[base]) return TABLES[base];
  throw new Error(`content/life/actions.json names a word table turn-rules.cjs does not have: ${name}`);
}

const PATTERNS = Object.fromEntries(Object.entries(ACTIONS.kinds).map(([name, kind]) => {
  const words = kind.keywords?.words || [];
  return [name, [...(kind.keywords?.tables || []).map(table), ...(words.length ? [new RegExp(words.map(escape).join('|'))] : [])]];
}));
const IGNORED = (ACTIONS.classify.ignore || []).length ? new RegExp(ACTIONS.classify.ignore.map(escape).join('|'), 'g') : null;

// The kind a sentence describes: the first kind in the classify order with a word in it, else 静观.
function classify(text) {
  const source = IGNORED ? plain(text).replace(IGNORED, '，') : plain(text);
  for (const name of ACTIONS.classify.order) {
    if (PATTERNS[name].some(pattern => pattern.test(source))) return name;
  }
  return ACTIONS.classify.fallback;
}

// ---------------------------------------------------------------- what the card is about

function statOf(stats, name) {
  const entry = stats && typeof stats === 'object' ? stats[name] : undefined;
  return Number(entry?.current ?? entry ?? 0) || 0;
}

function realmOf(value) {
  if (value && typeof value === 'object') {
    const major = Number(value.major);
    return Number.isInteger(major) ? { major, minor: Number(value.minor) || 0, text: plain(value.text || value.name) } : null;
  }
  if (!plain(value)) return null;
  const realm = mechanics.parseRealm(value);
  return realm.unknown ? null : realm;
}

const realmText = realm => realm.text || ORDER[realm.major] || '';
const atLeast = (have, need) => have.major > need.major || (have.major === need.major && (!need.minor || have.minor >= need.minor));

// The favour tier of a column-15 value; an unreadable value is the lowest tier.
function favourTier(value) {
  const number = Number(value);
  let found = FAVOUR.tiers[0];
  if (Number.isFinite(number)) for (const tier of FAVOUR.tiers) if (number >= tier.from) found = tier;
  return found.name;
}
const tierRank = name => FAVOUR.tiers.findIndex(tier => tier.name === name);

function findIn(list, key) {
  const wanted = plain(key);
  if (!wanted) return null;
  return list.find(entry => entry.id === wanted) || list.find(entry => plain(entry.name) === wanted) || null;
}

// The entry whose name the title mentions (the longest, two characters or more).
function namedIn(list, title) {
  const text = plain(title);
  return list.filter(entry => plain(entry.name).length >= 2 && text.includes(plain(entry.name)))
    .sort((a, b) => plain(b.name).length - plain(a.name).length)[0] || null;
}

// A reason for the player names a thing by its name, never by an id (I3, C2-1).
const isName = key => /[\u4e00-\u9fff]/.test(key);
const missingItem = key => (isName(key) ? `行囊里没有「${key}」` : '行囊里没有这件东西');
const missingSkill = key => (isName(key) ? `还没学会「${key}」` : '还没学会这门术法');

// ---------------------------------------------------------------- gates

const GATES = ['神识', '境界', '持有', '好感']
  .map(kind => [kind, new RegExp(`^${kind}\\s*[:：≥>=＝]*\\s*(${kind === '神识' ? '\\d+' : '.+'})$`)]);

// The model's gate when it is one of the four forms; anything else is left out with a note.
function parseGate(text) {
  const source = plain(text);
  if (!source) return { gate: null };
  for (const [kind, pattern] of GATES) {
    const match = source.match(pattern);
    if (!match) continue;
    const value = match[1].trim().replace(/^[「『《“"]+|[」』》”"]+$/g, '');
    if (kind === '神识') return { gate: { kind, value: Number(value), text: source } };
    if (kind === '境界') {
      const realm = realmOf(value);
      return realm ? { gate: { kind, value, realm, text: source } } : { note: `门槛「${source}」的境界认不出，没有采用` };
    }
    if (kind === '好感') return tierRank(value) >= 0 ? { gate: { kind, value, text: source } } : { note: `门槛「${source}」的好感档不认识，没有采用` };
    return { gate: { kind, value, text: source } };
  }
  return { note: `门槛「${source}」不是四种写法之一，没有采用` };
}

// Why the player falls short of the gate, or '' when they meet it.
function shortOf(gate, ctx, bag, person) {
  if (gate.kind === '神识') {
    const have = statOf(ctx.stats, '神识');
    return have >= gate.value ? '' : `神识不到 ${gate.value}（现有 ${have}）`;
  }
  if (gate.kind === '境界') {
    const actor = realmOf(ctx.realm);
    if (actor && atLeast(actor, gate.realm)) return '';
    return `境界不到${realmText(gate.realm)}` + (actor ? `（现为${realmText(actor)}）` : '');
  }
  if (gate.kind === '持有') return findIn(bag, gate.value) ? '' : missingItem(gate.value);
  if (!person) return `好感不到「${gate.value}」`;
  const now = favourTier(person.favour);
  return tierRank(now) >= tierRank(gate.value) ? '' : `${plain(person.name) || '对方'}的好感不到「${gate.value}」（现为「${now}」）`;
}

function gateLabel(gate, bag) {
  if (gate.kind === '神识') return `神识 ${gate.value}`;
  if (gate.kind === '境界') return `境界${realmText(gate.realm)}`;
  if (gate.kind === '持有') return `持有「${findIn(bag, gate.value)?.name || gate.value}」`;
  return `好感「${gate.value}」`;
}

// ---------------------------------------------------------------- odds and consequences

// How many of the die's faces give each outcome against this modifier and difficulty.
function facesOf(modifier, dc) {
  const faces = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0]));
  for (let roll = 1; roll <= RULES.die; roll += 1) faces[rules.checkOutcome(roll, roll + modifier, dc)] += 1;
  return faces;
}

const oddsOf = faces => Math.round(100 * (faces['大成功'] + faces['成功']) / RULES.die);
const toneOf = odds => (odds >= ACTIONS.tones.good ? 'good' : odds < ACTIONS.tones.poor ? 'poor' : 'mid');

function spanText(minutes) {
  if (minutes >= 120 && minutes % 120 === 0) return `${numeral(minutes / 120)}个时辰`;
  if (minutes === 60) return '半个时辰';
  if (minutes < 120 && minutes % 15 === 0) return `${numeral(minutes / 15)}刻`;
  return `${minutes}分钟`;
}

function consequenceText(c, ctx) {
  const parts = [];
  if (c.favour) parts.push(`好感${c.favour > 0 ? '+' : '−'}${Math.abs(c.favour)}`);
  const clockName = plain(ctx.clockName);
  if (c.clock && (clockName || Number(ctx.clockSteps) > 0)) parts.push(`${clockName ? `「${clockName}」` : '钟'}加${numeral(c.clock)}格`);
  if (c.harm) parts.push(`受伤（气血−${c.harm}%）`);
  if (c.fight) parts.push('动起手来');
  if (c.doubleCost) parts.push('代价加倍');
  return parts.join('，');
}

// One outcome's consequence on this card: favour scaled and only with a person, harm read from the
// check's damage for the outcome at this tier.
function consequence(spec, ctx, { person, kind, check, outcome, tier }) {
  const c = {};
  if (spec.favour && person) c.favour = Math.round(spec.favour * FAVOUR_SCALE);
  if (c.favour > 0) {
    const received = Number(ctx.relationshipGains?.[person.id]?.[kind]) || 0;
    c.favour = Math.max(0, c.favour - Math.max(0, received));
  }
  if (spec.clock) c.clock = spec.clock;
  if (spec.harm) {
    const percent = check?.results?.[outcome]?.damagePercent?.[tier];
    if (percent) c.harm = percent;
  }
  for (const flag of ['fight', 'doubleCost', 'use', 'trade']) if (spec[flag]) c[flag] = true;
  return { ...c, text: consequenceText(c, ctx) };
}

// ---------------------------------------------------------------- price

function price(ctx, card) {
  ctx = ctx && typeof ctx === 'object' ? ctx : {};
  card = card && typeof card === 'object' ? card : {};
  const notes = [];
  const given = plain(card.kind);
  const title = plain(card.title);
  let name = kindName(given);
  if (!name) {
    name = classify(title);
    notes.push(given ? `类型「${given}」不认识，按标题归为${name}` : `没有写类型，按标题归为${name}`);
  }
  const kind = ACTIONS.kinds[name];
  const bag = (Array.isArray(ctx.bag) ? ctx.bag : []).filter(entry => entry && typeof entry === 'object');
  const skills = (Array.isArray(ctx.skills) ? ctx.skills : []).filter(entry => entry && typeof entry === 'object');
  const stones = Number(ctx.stones) || 0;
  const key = plain(card.target);
  // The person counts only when it is the card's object.
  const person = key && ctx.target && typeof ctx.target === 'object'
    && (plain(ctx.target.id) === key || plain(ctx.target.name) === key) ? ctx.target : null;
  if (key && /^[CG]\d+$/.test(key) && !person) notes.push(`对象 ${key} 不在场，按没有对象标价`);
  const reasons = [];
  const cost = { minutes: kind.minutes, stones: 0, stats: [], items: [] };
  let item = null, skill = null, trade = null;

  // What the kind itself needs: the thing to use, the skill and its cost, the stones to pay. The
  // object is found by id or name, else by a name the title mentions.
  if (kind.effect?.use) {
    item = findIn(bag, key) || namedIn(bag, title);
    // A consumable is used up unless the title only shows it (亮出, 出示); anything else is shown.
    const shown = (kind.shows || []).some(word => title.includes(word));
    const consumed = !!item && !shown && rules.expendable(item.type, true);
    if (item) cost.items.push({ id: item.id, name: plain(item.name), count: 1, consumed });
    else reasons.push(missingItem(key));
    // A breakthrough pill does its work only in a breakthrough (mechanics.isAid); a thing the act
    // could not use now is no way to take either (batch 8's real-model run: 回元丹 at full mana
    // was offered and refused four times over).
    if (consumed && item.aid) reasons.push(`「${plain(item.name)}」要留到冲关时服用`);
    else if (consumed && plain(item.unusable)) reasons.push(plain(item.unusable));
  }
  if (kind.object === 'skill') {
    skill = findIn(skills, key) || namedIn(skills, title);
    if (!skill) reasons.push(missingSkill(key));
    else if (skill.cost?.stat && Number.isFinite(Number(skill.cost.amount))) {
      const amount = Number(skill.cost.amount), have = statOf(ctx.stats, skill.cost.stat);
      cost.stats.push({ stat: skill.cost.stat, amount });
      if (have < amount) reasons.push(`${skill.cost.stat}不够：要 ${amount} 点，只剩 ${have} 点`);
    }
  }
  if (kind.effect?.trade) {
    // Selling is trading a thing from the bag; anything else is buying.
    const sellWords = !ctx.fee && /卖|售|典当/.test(title) && !/买|购/.test(title);
    item = ctx.fee ? null : saleItem(bag, key, title, sellWords);
    const known = ctx.price !== undefined && ctx.price !== null && Number.isFinite(Number(ctx.price)) ? Number(ctx.price) : null;
    if (item || sellWords) {
      trade = { direction: 'sell', item: item ? { id: item.id, name: plain(item.name) } : null, price: known };
      if (item) cost.items.push({ id: item.id, name: plain(item.name), count: 1, consumed: true });
      else reasons.push(missingItem(key));
      // a thing the catalogue does not list fetches no stones (dealOf: 无市价)
      if (item && ctx.unpriced) reasons.push(`「${plain(item.name)}」无市价，换不来灵石`);
    } else {
      trade = { direction: 'buy', item: null, price: known, ...(ctx.fee ? { fee: true } : {}),
        ...(ctx.good ? { good: { id: ctx.good.id, name: plain(ctx.good.name) } } : {}) };
      if (known !== null) {
        cost.stones = known;
        if (stones < known) reasons.push(`灵石不够：要 ${known} 块，只有 ${stones} 块`);
      }
    }
  }

  const parsed = parseGate(card.gate);
  if (parsed.note) notes.push(parsed.note);
  const gate = parsed.gate;
  if (gate) {
    const short = shortOf(gate, ctx, bag, person);
    if (short) reasons.push(short);
  }

  const proposedGiven = plain(card.tier);
  const proposed = TIERS.includes(proposedGiven) ? proposedGiven : null;
  if (proposedGiven && !proposed) notes.push(`难度「${proposedGiven}」不是四档之一，没有采用`);

  const dice = !!kind.check && !gate;
  const check = dice ? CHECKS[kind.check] : null;
  const actor = realmOf(ctx.realm), other = person ? realmOf(person.realm) : null;
  const gap = actor && other ? other.major - actor.major : null;
  const who = plain(person?.name) || '对方';
  const adjust = [];
  let roll = null;  // the terms of the roll, when there is one
  let bonus = { value: 0, names: [] };  // a perk's check bonus (脚底抹油)
  if (dice) {
    const D = ACTIONS.difficulty;
    // Something fitting in hand: the card's object when it is in the bag, or a lasting thing (a
    // token, a letter, a weapon; not a pill the title happens to mention) the title names.
    const leverage = findIn(bag, key) || namedIn(bag.filter(entry => !rules.expendable(entry.type, false)), title);
    if (gap !== null && gap >= D.realm.farGap) {
      if (!leverage) reasons.push(`${who}是${realmText(other)}，高你${numeral(gap)}个大境界，办不到`);
      adjust.push({ rule: 'realm', step: D.realm.farStep, text: `对方高${numeral(gap)}个大境界` });
    } else if (gap !== null && gap >= 1) adjust.push({ rule: 'realm', step: D.realm.above, text: '对方高一个大境界' });
    else if (gap !== null && gap <= -1) adjust.push({ rule: 'realm', step: D.realm.below, text: `对方低${numeral(-gap)}个大境界` });
    if (D.friendly.kinds.includes(name) && person && tierRank(favourTier(person.favour)) >= tierRank(D.friendly.tier)) {
      adjust.push({ rule: 'favour', step: D.friendly.step, text: `好感到了「${D.friendly.tier}」` });
    }
    if (leverage) adjust.push({ rule: 'leverage', step: D.leverage, text: `手里有「${plain(leverage.name)}」` });
    const clockSteps = Number(ctx.clockSteps) || 0;
    if (clockSteps >= D.clock.steps) adjust.push({ rule: 'clock', step: D.clock.step, text: `压力钟到了 ${clockSteps} 格` });
    const easier = perkLib.tierSteps(ctx.perks, name, ctx.hour);
    if (easier.steps) adjust.push({ rule: 'perk', step: -easier.steps, text: `悟得「${easier.names.join('、')}」` });
    const top = TIERS.length - 1;
    const ruled = clamp(TIERS.indexOf(D.start) + adjust.reduce((sum, a) => sum + a.step, 0), 0, top);
    const at = proposed ? clamp(clamp(TIERS.indexOf(proposed), ruled - D.proposalReach, ruled + D.proposalReach), 0, top) : ruled;
    if (proposed && at !== TIERS.indexOf(proposed)) notes.push(`模型提议「${proposed}」，夹到「${TIERS[at]}」`);
    const tier = TIERS[at];
    const value = statOf(ctx.stats, check.attribute);
    bonus = perkLib.checkBonus(ctx.perks, name);
    const modifier = Math.floor(rules.modifierFor(value) * (check.modifierFactor ?? 1)) + bonus.value;
    const faces = facesOf(modifier, RULES.tiers[tier]);
    roll = { check: kind.check, attribute: check.attribute, value, modifier, tier, dc: RULES.tiers[tier], odds: oddsOf(faces), faces };
    roll.tone = toneOf(roll.odds);
  }

  const outcomes = dice
    ? Object.fromEntries(OUTCOMES.map(outcome => [outcome, consequence(kind.outcomes[outcome] || {}, ctx, { person, kind: name, check, outcome, tier: roll.tier })]))
    : null;
  // A card with a gate is done without a roll: what a success brings, the plain way (a smaller
  // gain: actions.json direct); the better outcome is the rolled cards'.
  const effect = dice ? null : consequence((kind.check ? directWay(kind.outcomes['成功']) : kind.effect) || {}, ctx, { person, kind: name });
  const failure = outcomes ? outcomes['失败'].text : '';
  const fumble = outcomes ? outcomes['大失败'].text : '';

  const sold = trade?.direction === 'sell' && Number.isFinite(trade.price) ? trade.price : null;
  const costs = [
    ...cost.stats.map(s => `${s.stat} ${s.amount}`),
    ...(cost.stones ? [`灵石 ${cost.stones} 块`] : []),
    ...cost.items.map(i => (sold !== null ? `卖出${i.name}得${sold}块` : `${i.consumed ? '用掉' : '亮出'}${i.name}`)),
    ...(cost.minutes > 0 ? [spanText(cost.minutes)] : []),
  ];
  // What the card is about, as found: the person, the thing in the bag, the skill.
  const found = (type, entry) => (entry ? { type, id: entry.id, name: plain(entry.name) } : null);
  const object = found('person', person) || found('item', item) || found('skill', skill)
    || found('item', findIn(bag, key)) || found('skill', findIn(skills, key));
  // 察言观色: the person's favour tier and how the difficulty came about, on a talk.
  const seen = dice && person && perkLib.insight(ctx.perks, name).length
    ? { name: plain(person.name) || '对方', tier: favourTier(person.favour), how: adjust.map(a => a.text), perks: perkLib.insight(ctx.perks, name) } : null;
  const locked = reasons.length > 0;
  const reason = reasons.join('；');
  let sub;
  if (locked) sub = [name, reason];
  else if (dice) {
    sub = [name, `看${kind.looks}`, ...(bonus.value ? [`悟得「${bonus.names.join('、')}」${sign(bonus.value)}`] : []), `难度${roll.tier}`,
      ...(seen ? [`${seen.name}${seen.tier}`, ...seen.how] : []), ...costs,
      ...(failure ? [`败了${failure}`] : fumble ? [`大失败则${fumble}`] : [])];
  } else if (gate) sub = [name, `需${gateLabel(gate, bag)}`, ...costs, DIRECT.label, '不掷骰'];
  else if (kind.effect?.fight) sub = [name, kind.looks, ...(gap !== null && gap >= 1 ? [`对方高你${numeral(gap)}个大境界`] : [])];
  else sub = [name, ...(costs.length ? costs : kind.looks === '不掷骰' ? [] : [kind.looks]), '不掷骰'];

  return {
    ...(Number.isInteger(card.index) ? { index: card.index } : {}),
    ...(card.fallback ? { fallback: true } : {}),
    ...(card.talk ? { talk: true } : {}),
    ...(card.route && card.intent ? { route: plain(card.route).slice(0, 8), intent: plain(card.intent).slice(0, 64) } : {}),
    ...(given === '离开' ? { leave: true } : {}),
    kind: name,
    glyph: Object.hasOwn(ACTIONS.cards.routes, card.route) ? ACTIONS.cards.routes[card.route] : kind.glyph,
    title,
    target: key,
    targetName: plain(object?.name),
    object,
    clock: plain(ctx.clockId) ? { id: plain(ctx.clockId), name: plain(ctx.clockName), steps: Number(ctx.clockSteps) || 0 } : null,
    plain: !dice,
    check: roll?.check ?? null,
    attribute: roll?.attribute ?? null,
    value: roll?.value ?? null,
    modifier: roll?.modifier ?? null,
    tier: roll?.tier ?? null,
    dc: roll?.dc ?? null,
    odds: roll?.odds ?? null,
    faces: roll?.faces ?? null,
    tone: roll?.tone ?? null,
    proposed,
    adjust,
    ...(bonus.value ? { bonus } : {}),
    ...(seen ? { insight: seen } : {}),
    gate: gate ? { kind: gate.kind, value: gate.value, text: gate.text } : null,
    locked,
    reason,
    cost,
    ...(trade ? { trade } : {}),
    outcomes,
    effect,
    failure,
    sub: sub.join(' · '),
    // a light scene's card (batch 8): the model's line of what comes of it, done or not, which
    // the server writes in place of a beat (scene.json light); never shown before it is taken
    ...(saidOf(card.said) ? { said: saidOf(card.said) } : {}),
    notes,
  };
}

// The lines of a light scene's card: { success, failure }, both of scene.saidLine's form, or null.
function saidOf(given) {
  if (!given || typeof given !== 'object') return null;
  const success = scene.saidLine(given.success), failure = scene.saidLine(given.failure);
  return success && failure ? { success, failure } : null;
}

// ---------------------------------------------------------------- the save: contextOf

const ownsNothing = () => ({ items: [], stats: [], forbid: [], charStats: [], skills: [], quests: [], grants: [], currency: false });
const rowName = row => plain(row?.['1']).split('|')[0];
// Column 15 as a number; blank or unreadable is 0, a stranger.
const favourOf = row => (Number.isFinite(Number(plain(row?.['15']))) ? Number(plain(row?.['15'])) : 0);
const given = value => value !== undefined && value !== null && value !== '';

// The hour of the day on the clock, or null when the time row has no time of day.
function hourOf(env) {
  const now = mechanics.readClock(env.state);
  return now?.timed ? Math.floor((now.minutes % clock.DAY_MINUTES) / 60) : null;
}

// Where the player is, as the places module reads it (clocks and their scopes ask).
const placeHere = env => places.factsOf(mechanics.placeOf(env.state), env.worldMap);

// Why the act could not use one of a thing now ('' when it could): the use-item rule tried on the
// save as it is, its commands left unapplied (turn-rules useItem changes nothing itself). Only a
// thing a card would use up is tried; the rest are only shown.
function unusable(env, id, row) {
  if (!rules.expendable(plain(row['2']), true)) return '';
  const tried = rules.useItem(env, { id, quantity: 1, consumed: true }, 'card');
  return tried.ok ? '' : plain(tried.reason);
}

function contextOf(env, card) {
  const player = env.state['0']?.B1 || {};
  // The panel as the life play totals it: the active gear counted (gear.cjs, plan item 33).
  const stats = gear.panelOf(env);
  const stored = env.ctx.storedItemIds(env.state);
  const bag = Object.entries(env.state['1'] || {}).filter(([id, row]) => row && !stored.has(id)).map(([id, row]) => ({
    id, name: rowName(row), count: env.ctx.itemStackCount(row['5']), type: plain(row['2']), aid: mechanics.isAid(rowName(row)),
    unusable: unusable(env, id, row),
  }));
  const skills = Object.entries(env.state['8'] || {}).filter(([, row]) => row)
    .map(([id, row]) => ({ id, name: rowName(row), cost: mechanics.skillCost(row, stats) }));
  const key = plain(card?.target);
  const cast = Object.entries(env.state['0'] || {}).filter(([id, row]) => /^[CG]/.test(id) && row);
  const [id, row] = (key && (cast.find(([each]) => each === key) || cast.find(([, each]) => rowName(each) === key))) || [];
  // 买卖: the engine's price (dealOf); a price the card carries (the server's, or the one it was
  // shown with) stands, and the good it buys is still the engine's
  const fee = Number(card?.fee);
  const paysFee = plain(card?.kind) === '买卖' && Number.isSafeInteger(fee) && fee > 0;
  const priced = given(card?.price) && Number.isFinite(Number(card.price));
  const deal = paysFee ? { price: fee, fee: true }
    : plain(card?.kind) === '买卖' ? dealOf(env, card, bag) : null;
  return {
    stats, realm: plain(player['2']), stones: mechanics.stonesOf(player) ?? 0, bag, skills,
    target: row ? { id, name: rowName(row), realm: plain(row['2']), favour: favourOf(row) } : null,
    relationshipGains: env.play.scene?.relationshipGains,
    ...clocks.clockStepsFor(env, { targetId: id || '', place: placeHere(env) }),
    perks: [...perkLib.owned(env), ...gear.traitNames(env), ...beasts.useNames(env), ...require('./world.cjs').checkNames(env)],
    hour: hourOf(env),
    ...(!paysFee && priced ? { price: Number(card.price), ...(deal?.good ? { good: deal.good } : {}) } : deal || {}),
  };
}

// 买卖 priced by the engine (the plan's first principle: a purchase through a card costs what the
// engine prices, and the model writes no number). Selling a thing of the bag (the card's target,
// else the one its title names) fetches what a shop would pay for it this year (trade.each), or
// nothing when the catalogue does not list it ({ unpriced }: 无市价, and the card is locked). Buying
// a good the catalogue lists (named by the target, else the longest catalogue name in the title;
// spirit stones never) costs what a shop would ask ({ price, good }: the good goes into the bag on
// the act); a piece of gear the story names (买下那面玄甲盾) is the catalogue's piece of its kind at
// the place's tier (goods.likeFor) and costs what a shop asks for that piece, and goes into the bag
// under the story's name with that piece's numbers (rewards.grant); a piece of the story's in the
// bag sells as that piece too (goods.ofItem). Buying anything else, a thing of the story's, costs
// trade.json's `unlisted` price for the tier of the place (the player's own tier off the map), and
// the story registers the thing.
function dealOf(env, card, bag) {
  const trade = require('./trade.cjs');
  const title = plain(card?.title), key = plain(card?.target);
  const sellWords = /卖|售|典当/.test(title) && !/买|购/.test(title);
  const item = saleItem(bag, key, title, sellWords);
  if (item || sellWords) {
    const good = item ? goods.ofItem(env.state['1']?.[item.id] || { 1: item.name }) : null;
    return good && good.class !== STONES ? { price: trade.each(env, good, 'sell') } : item ? { unpriced: true } : {};
  }
  const method = METHOD_PURCHASE.test(purchaseName(title));
  const good = [goods.lookup(key)].find(each => each && each.class !== STONES && (!method || each.type === '功法'))
    || namedGood(title, method ? '功法' : null);
  if (good) return { price: trade.each(env, good, 'buy'), good: { id: good.id, name: good.name } };
  const place = places.placeFacts(env).place;
  const tier = (place && places.tierAt(place, env.worldMap)) || goods.tierOf(mechanics.parseRealm(env.state['0']?.B1?.['2']).major);
  const asked = pieceAsked(key, title);
  const like = asked && goods.likeFor({ name: asked.name, type: asked.type, text: title, tier });
  if (like) return { price: trade.each(env, like, 'buy'), good: { id: like.id, name: asked.name } };
  const unlisted = data('trade').unlisted || {};
  const price = Number(unlisted[tier] ?? unlisted.default);
  return Number.isFinite(price) && price > 0 ? { price } : {};
}

// A card's deal, settled (act): the purchase's good granted (rewards.grant), a sale's thing taken
// out of the bag, one piece, and its price paid into the purse. Adds to the act's commands, owns and
// paid; marks the trade settled, with the thing's name.
function dealt(env, card, commands, owns, paid) {
  const trade = card.trade;
  if (trade.direction === 'buy' && trade.good && card.cost.stones) {
    const granted = require('./rewards.cjs').grant(env, [{ id: trade.good.id, count: 1, price: trade.price, name: trade.good.name }]);
    commands.push(...granted.commands);
    owns.items.push(...granted.owns.items);
    owns.grants.push(...granted.owns.grants);
    trade.name = trade.good.name;
    trade.settled = true;
  } else if (trade.direction === 'sell' && trade.item?.id && Number.isFinite(trade.price)) {
    const row = env.state['1']?.[trade.item.id];
    const count = row ? env.ctx.itemStackCount(row['5']) : 0;
    if (!row || !(count >= 1)) return;
    commands.push(count > 1 ? `add(${JSON.stringify(trade.item.id)},{"5":"${count - 1}"})` : `de(${JSON.stringify(trade.item.id)})`);
    owns.items.push(trade.item.id);
    const before = paid.find(entry => entry.stat === '灵石')?.after ?? mechanics.stonesOf(env.state['0']?.B1) ?? 0;
    const after = before + trade.price;
    commands.push(`add("B1",{"26":"${after}"})`);
    owns.currency = true;
    paid.push({ stat: '灵石', before, after });
    trade.name = trade.item.name;
    trade.settled = true;
  }
}

// The thing of the bag a 买卖 card sells: its target, else one its title names when it says sell.
// A title that says buy and not sell buys, whatever thing of the bag the target names, unless the
// title names that thing too (「作价买入下品乌木盾」 aimed at the rusty sword buys the shield; the
// owner's copy, 2026-11-16, had it locked as a sale of a sword with no price).
function saleItem(bag, key, title, sellWords) {
  const target = findIn(bag, key);
  const buying = /买|购/.test(title) && !/卖|售|典当/.test(title);
  if (target && buying && !title.includes(plain(target.name).split('|')[0].trim())) return null;
  return target || (sellWords ? namedIn(bag, title) : null);
}

// The piece of gear a buying card names, the catalogue aside: its target when that is a name and
// not an id, else what follows the title's verb (「买下那面玄甲盾」 is 玄甲盾), up to a joining word;
// { name, type } when the name ends in a piece's word (goods.gearTypeOf), else null.
const BUY_VERB = /买下|买入|购入|购买|购得|换取|换得|求购|订下|拿下|买/;
const MEASURE = /^(?:那|这)?(?:[一两二三四五六七八九十]+)?(?:面|件|把|柄|口|副|套|枚|张|杆|只|顶|双|袭|领|具)?/;
const METHOD_PURCHASE = /(?:功法|心法|[诀经功](?:拓本|抄本|全本|残卷|残篇|残册|玉简)?)[》」』】]*$/;
function purchaseName(title) {
  const said = BUY_VERB.test(title) ? title.slice(title.search(BUY_VERB)).replace(BUY_VERB, '') : '';
  return said.split(/[与和及、，,。并再后]/)[0].replace(MEASURE, '').trim();
}

function pieceAsked(key, title) {
  for (const name of [/^[A-Za-z]+\d+$/.test(key) ? '' : key, purchaseName(title)]) {
    const type = name ? goods.gearTypeOf(name, '') : null;
    if (type) return { name, type };
  }
  return null;
}

// The catalogue good whose name (or alias) the title says, the longest; spirit stones never.
function namedGood(title, type) {
  let best = null;
  for (const good of goods.GOODS) {
    if (good.class === STONES || (type && good.type !== type)) continue;
    for (const name of [good.name, ...(good.aliases || [])]) {
      if (name.length >= 2 && title.includes(name) && (!best || name.length > best.length)) best = { good, length: name.length };
    }
  }
  return best?.good || null;
}

// ---------------------------------------------------------------- op "cards"

const LEAVE = ACTIONS.cards.leave;
const leaving = card => plain(card.kind) === LEAVE.kind;

async function cards(env, args) {
  if (!Array.isArray(args.cards)) return env.refuse('行动卡要是一组');
  // An encounter's beat (encounter.cjs) offers its own cards; the model's wait until it is over.
  if (env.play.encounter) return { cards: env.play.cards || [] };
  const handed = args.cards.filter(card => card && typeof card === 'object');
  const own = handed.filter(card => !leaving(card));
  const kept = own.slice(0, ACTIONS.cards.max).map(card => (args.fallback ? { ...card, fallback: true } : card));
  const talk = talkCard(env);
  const shown = [...kept, ...(talk ? [talk] : []), handed.find(leaving) || LEAVE];
  const priced = shown.map((card, i) => price(contextOf(env, card), { ...card, index: i + 1 }));
  env.play.cards = priced;
  const dropped = own.length - kept.length;
  await env.settle({ kind: 'cards', ok: true, hidden: true, source: 'engine', commands: '', owns: ownsNothing(),
    summary: `行动卡${priced.length}张` + (dropped ? `，多出的${dropped}张没有采用` : '') });
  return { cards: priced };
}

// 论道: a 交涉 card with the first one on the scene of the favour mind.talk asks for, not yet this year.
function talkCard(env) {
  const rule = mind.RULES.talk;
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    if (!/^[CG]/.test(id) || !row || mechanics.isFallen(env.ctx, row)) continue;
    if (tierRank(favourTier(favourOf(row))) < tierRank(rule.favour) || !mind.talkable(env, id)) continue;
    const name = plain(row['1']).split('|')[0];
    return { kind: rule.kind, title: rule.title.replace('{人}', name), target: id, tier: rule.tier, talk: true };
  }
  return null;
}

// ---------------------------------------------------------------- op "act"

const num = n => (n < 0 ? `−${-n}` : String(n));
const sign = n => (n >= 0 ? `+${n}` : num(n));
const statNumbers = entry => ({ before: Number(entry?.current ?? entry) || 0, max: Number(entry?.max ?? entry?.current ?? entry) || 0 });

// A clock's move as the summary says it: 盘查 1→2, 惹上盘查, 盘查已满.
const clockText = change => (change.started ? `惹上「${change.name}」`
  : `「${change.name}」${change.before}→${change.after}格${change.full ? '，已满' : change.gone ? '，平息' : ''}`);

// The card the player picked: a shown card by index, or an ad hoc one (free text, classified).
function pickedCard(env, args) {
  if (given(args.index)) {
    const index = Number(args.index);
    const shown = Number.isInteger(index) && index >= 1 && Array.isArray(env.play.cards) ? env.play.cards[index - 1] : null;
    if (!shown) return { refused: `没有第${String(args.index).slice(0, 8)}张行动卡` };
    return { index, raw: { kind: shown.leave ? LEAVE.kind : shown.kind, title: shown.title, target: shown.target,
      tier: shown.proposed || '', gate: shown.gate?.text || '', ...(given(shown.trade?.price) ? { price: shown.trade.price } : {}),
      ...(shown.talk ? { talk: true } : {}),
      ...(shown.intent ? { route: shown.route, intent: shown.intent } : {}),
      ...(shown.said ? { said: shown.said } : {}),
      ...(shown.beat ? { beat: shown.beat } : {}) } };
  }
  if (args.card && typeof args.card === 'object') {
    const { kind, title, target, tier, gate, price: cost, fee } = args.card;
    return { index: null, raw: { kind, title, target, tier, gate, price: cost, fee } };
  }
  return { refused: '要选一张行动卡' };
}

async function act(env, args) {
  if (env.play.fight || String(env.state['0']?.B1?.['31']).trim() === 'true') return env.refuse('斗法之中只能出招');
  const picked = pickedCard(env, args);
  if (picked.refused) return env.refuse(picked.refused);
  // An encounter's beat is played with its own cards (encounter.cjs, required here: it requires
  // this module).
  const meeting = env.play.encounter ? require('./encounter.cjs') : null;
  if (meeting && !picked.raw.beat) return env.refuse('眼前撞上的事还没了，先在这一拍的卡里拿个主意');
  // Priced again on the state as it is now: a card that is no longer eligible is refused.
  const card = meeting ? meeting.price(env, picked.raw.beat) : price(contextOf(env, picked.raw), picked.raw);
  if (!card) return env.refuse('这张卡眼下用不上了');
  if (card.locked) return env.refuse(card.reason);
  const kind = ACTIONS.kinds[card.kind];
  // What the old rules settle in their own receipts: the skill (mana, proficiency, its limits) and
  // the thing used up (its effect, its daily limits).
  if (kind.object === 'skill' && card.object?.type === 'skill') {
    const cast = mechanics.useSkill(env, { skill_id: card.object.id, reason: card.title }, 'card');
    if (!cast.ok) return env.refuse(cast.reason);
    await env.settle(cast);
  }
  if (kind.effect?.use) {
    for (const item of card.cost.items.filter(entry => entry.consumed)) {
      const used = rules.useItem(env, { id: item.id, quantity: item.count, consumed: true }, 'card');
      if (!used.ok) return env.refuse(used.reason);
      await env.settle(used);
    }
  }
  // The timeline fixes the roll unless the server explicitly retries a completed turn.
  let rolled = null, spec = card.effect;
  const dice = { kind: 'check', type: card.kind, target: card.target, nth: Number.isSafeInteger(Number(args.nth)) && Number(args.nth) > 0 ? Number(args.nth) : 1 };
  if (!card.plain) {
    const roll = Math.floor(env.random(dice).random() * RULES.die) + 1;
    const total = roll + card.modifier;
    rolled = { roll, total, outcome: rules.checkOutcome(roll, total, card.dc), seed: env.seedOf(dice) };
    // 静气: a failed talk or lie is rolled once more, once a month, on a seed of its own.
    const perk = rolled.outcome.endsWith('失败') ? perkLib.canReroll(env, card.kind) : null;
    if (perk) {
      const again = { ...dice, type: `${card.kind}·${perk}` };
      const second = Math.floor(env.random(again).random() * RULES.die) + 1;
      rolled = { roll: second, total: second + card.modifier, outcome: rules.checkOutcome(second, second + card.modifier, card.dc),
        seed: env.seedOf(again), reroll: { perk, roll, total, outcome: rolled.outcome, seed: rolled.seed } };
      perkLib.use(env, perk);
    }
    spec = card.outcomes[rolled.outcome];
  }
  const commands = [], effects = [], paid = [], owns = ownsNothing();
  if (rolled) owns.forbid.push(...(CHECKS[card.check].results[rolled.outcome].forbid || []));
  const stats = mechanics.readStats(env, 'B1');
  const spend = (stat, amount) => {
    const { before, max } = statNumbers(stats[stat]);
    const after = Math.max(0, before - amount);
    stats[stat] = { current: after, max };
    commands.push(`updateAttribute("B1",${JSON.stringify(stat)},{"current":${after},"max":${max}})`);
    if (!owns.stats.includes(stat)) owns.stats.push(stat);
    return { stat, before, after, max };
  };
  // The cost the card names besides: stones (a purchase at a known price), twice over on a 大失败
  // that doubles the cost, and the skill's cost a second time then.
  const times = spec.doubleCost ? 2 : 1;
  if (card.cost.stones) {
    const before = mechanics.stonesOf(env.state['0']?.B1) ?? 0, after = Math.max(0, before - card.cost.stones * times);
    commands.push(`add("B1",{"26":"${after}"})`);
    owns.currency = true;
    paid.push({ stat: '灵石', before, after });
  }
  // 买卖 settled by the engine (dealOf): the good a purchase names goes into the bag; a sale takes
  // the thing out and pays its price. A thing of the story's that was bought the story registers.
  if (card.trade && !meeting) dealt(env, card, commands, owns, paid);
  if (spec.doubleCost) for (const { stat, amount } of card.cost.stats) effects.push(spend(stat, amount));
  if (spec.harm) {
    // As resolveCheck takes it: the percent of the full bar, rounded up.
    const { before, max } = statNumbers(stats['血量']);
    const damage = Math.ceil(max * spec.harm / 100);
    if (max > 0) effects.push({ ...spend('血量', damage), damage: Math.min(before, damage) });
  }
  let favour = null;
  const person = card.object?.type === 'person' ? env.state['0']?.[card.object.id] : null;
  if (spec.favour && person) {
    const before = favourOf(person), after = clamp(before + spec.favour, FAVOUR.range[0], FAVOUR.range[1]);
    if (after !== before) {
      commands.push(`add(${JSON.stringify(card.object.id)},${JSON.stringify({ 15: String(after) })})`);
      favour = { id: card.object.id, name: card.object.name, before, after, change: after - before };
      effects.push({ stat: '好感', before, after, max: FAVOUR.range[1] });
      // This scene records real positive gains, not the current favour balance. A failure
      // therefore cannot replenish the allowance, and renaming a card cannot farm it again.
      // The scene travels with normal receipts/snapshots, so replay and undo need no side store.
      if (after > before && env.play.scene) {
        const gains = (env.play.scene.relationshipGains ||= {});
        const target = (gains[card.object.id] ||= {});
        target[card.kind] = (Number(target[card.kind]) || 0) + after - before;
      }
    }
  }
  // The pressure clocks: what the clocks' own rules make of the act (a fumble, a strike in their
  // scope, a thing shown, a clock started), then the card's outcome on the clock it bears on, unless
  // the rules moved that one already.
  const shown = kind.effect?.use ? card.cost.items.find(entry => !entry.consumed)?.name : '';
  const moved = clocks.raiseFor(env, { kind: card.kind, outcome: rolled?.outcome ?? '', place: placeHere(env), ...(shown ? { item: shown } : {}) });
  // Gear (gear.cjs): a critical failure damages one of the active pieces the check leaned on;
  // selling stolen goods where their owner's people are is noticed.
  const damaged = rolled?.outcome === '大失败'
    ? gear.damage(env, { check: { attribute: card.attribute, kind: card.kind }, random: env.random({ ...dice, type: `${card.kind}·受损` }) })
    : null;
  if (card.trade?.direction === 'sell' && card.trade.item?.id) moved.push(...gear.stolenUse(env, 'sell', [card.trade.item.id]));
  if (spec.clock && card.clock?.id && !moved.some(change => change.id === card.clock.id)) {
    const change = clocks.bump(env, card.clock.id, spec.clock, `${card.kind}${rolled?.outcome ?? ''}`);
    if (change) moved.push(change);
  }
  const target = person ? { id: card.object.id, name: card.object.name } : null;
  const result = rolled ? CHECKS[card.check].results[rolled.outcome] : null;
  const receipt = {
    kind: 'act', ok: true, source: 'card',
    card: { index: picked.index, kind: card.kind, glyph: card.glyph, title: card.title, target: card.target, object: card.object,
            plain: card.plain, ...(card.leave ? { leave: true } : {}),
            ...(card.intent ? { route: card.route, intent: card.intent } : {}),
            // done by its gate: the direct way, which the beat's prompt says (life_prompt.act_words)
            ...(card.plain && card.gate?.text ? { gate: card.gate.text } : {}) },
    ...(rolled ? { check: { kind: card.kind, rule: card.check, tier: card.tier, dc: card.dc, die: RULES.die, roll: rolled.roll,
      attribute: card.attribute, value: card.value, modifier: card.modifier, total: rolled.total, outcome: rolled.outcome,
      consequence: result.text, effects, target, reason: card.title, seed: rolled.seed, rulesVersion: RULES.version,
      ...(rolled.reroll ? { reroll: rolled.reroll } : {}) } } : {}),
    outcome: rolled?.outcome ?? null, effects, paid,
    ...(favour ? { favour } : {}),
    // 进斗法: the fight opens once this receipt is settled (below); a beat card's fight is the beat's.
    ...(spec.fight && !card.beat ? { fight: true } : {}),
    ...(moved.length ? { clocks: moved } : {}),
    ...(card.trade ? { trade: card.trade } : {}),
    ...(damaged ? { damaged } : {}),
    commands: commands.join('\n'), owns, summary: '',
  };
  await clock.advance(env, card.cost.minutes, receipt);
  const parts = [
    ...(rolled?.reroll ? [`${card.kind}检定1d${RULES.die}=${rolled.reroll.roll}，${rolled.reroll.outcome}；悟得「${rolled.reroll.perk}」重掷`] : []),
    rolled ? `${card.kind}检定（${card.tier}，难度${card.dc}）：1d${RULES.die}=${rolled.roll}，${card.attribute}修正${sign(card.modifier)}，总值${rolled.total} → ${rolled.outcome}：${result.text}`
      : `${card.kind}，${card.leave ? '离开' : '直行'}`,
    ...paid.map(p => `${p.stat} ${num(p.before)}→${num(p.after)}`),
    ...effects.map(e => `${e.stat} ${num(e.before)}→${num(e.after)}`),
    ...(spec.fight && !card.beat ? ['动起手来'] : []),
    ...moved.filter(change => !change.refused).map(clockText),
    `时间 ${receipt.time.before}→${receipt.time.after}`,
  ];
  // 论道: the outcome adds 心境, once a year with this person (mind.cjs)
  const talked = card.talk && rolled && person ? mind.talked(env, card.object.id, rolled.outcome) : [];
  if (talked.length) {
    receipt.mind = talked;
    parts.push(mind.said(talked));
  }
  receipt.summary = `行动「${card.title}」：` + parts.join('；');
  scene.noteAct(env, { rolled: !!rolled, won: ['成功', '大成功'].includes(rolled?.outcome), clocks: moved });
  // What the card does to an encounter's beat (encounter.after), or the fight it starts (item 19):
  // the card's target is the foe (by its name when the story never registered it: fight.storyFoe),
  // and the outcome says who is caught unawares (fight.fromAct; a target that is no one to fight
  // leaves the flag for the story). Required here: fight.cjs requires this module.
  const fights = require('./fight.cjs');
  if (meeting) {
    const met = await meeting.after(env, card, rolled?.outcome ?? null);
    receipt.encounter = met.shown;
    receipt.summary += `；${met.shown.text}`;
  } else if (spec.fight) {
    await fights.fromAct(env, { target: card.object?.type === 'person' ? card.object.id : card.target, outcome: rolled?.outcome ?? null });
  }
  // a light scene's 离开 closes with the 回目 the model wrote when it opened (batch 8)
  if (card.leave && env.play.scene) await scene.close(env, data('scene').plainWeight, 'leave', env.play.scene.light?.couplet || '');
  return { card, outcome: rolled?.outcome ?? null, ...(env.play.fight ? { fight: fights.view(env) } : {}) };
}

module.exports = { ACTIONS, CHECKS, TIERS, price, classify, kindName, favourTier, facesOf, contextOf, cards, act };
