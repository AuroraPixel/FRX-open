'use strict';
/* 买卖 (玩法设计第十二节「价目的尺度」; plan item 35): the shops of a map place, their prices and the
 * verb trade. The rules are content/life/trade.json; the goods content/life/goods.json (goods.cjs).
 *
 * shopOf(env, place?) → { place, year, goods: [good] }: what a map place's shops sell this year (the
 *   player's place by default): the catalogue's goods whose class and tier one of the place's sells
 *   (places.factsOf trade.sells, 「丹·一阶」) names, key materials and spirit stones left out, `size`
 *   of them drawn on a seed of the save, the place and the year; the same all year long. Beside
 *   them: at a 坊市 or a big town every method of the file's methods.tiers (the 功法 shelf), and
 *   while the calendar's auction is open at a place with its venue, this year's lots (lotsOf: each
 *   lot of the file's auction drawn on its chance, a seed of the save, the place and the year),
 *   marked lot (they sell at auction.sell).
 * AUCTIONS: the sales with lots, the auction and the file's fairs (the 春汀集), each on its calendar
 *   event at that event's place with its venue, its lots and its sell.
 * lotsOf(env, place, year, rule?) → [good + lot, sell, sale]: that sale's lots of that year at that
 *   place, open or not (the sale held there by default); lotsLeft the same without those bought (a
 *   lot is one piece: frxPlay.lots { year, ids }, the year's lots bought, written by the buy, the
 *   good's id at the auction and place:id at a fair; the shop lists only those left, and a lot is
 *   bought one at a time).
 * market(env, good) → its market price this year: the base price moved within ± drift by a seed of
 *   the save, the good and the year (not rounded).
 * each(env, good, side, haggled?, place?) → the price of one piece at the shop of `place` (the
 *   player's by default): what the shop sells at (side "buy": the player buys) is the market × sell,
 *   rounded up; what it pays (side "sell") the market × buy, rounded down; at least `least`. The
 *   market here is moved first, once each way, by world.priceFactor (the world factors' price hooks
 *   times the difficulty's prices) and by saga.priceFactor (the world line's aftermath prices in the
 *   place's region). A haggle that came off takes `off` from the first, adds it to the second.
 * view(env) → play_models.ShopView: { place, open, appraise, haggle: { open, off }, sells, buys }.
 *   sells the shop's goods [{ id, name, unit, price }], buys the player's bag things the shop takes
 *   [{ id (the bag's), name, unit, count, price }]; with the perk 识货 (appraise) each also says its
 *   true tier, its base and its market price this year. open is whether a shop is here (the verb's
 *   venues, verbs.json where.trade); haggle.open whether this month's haggle at this shop is unused.
 * The verb trade { side: buy | sell, id, count, haggle? } (installed into verbs.VERBS):
 *   buy   id a good of the shop's list; the stones go down by the price of a piece times count, and
 *         the goods go into the bag (rewards.grant: onto a stack of the same name, else a new row)
 *   sell  id a thing in the bag the shop takes; it leaves the bag, the stones go up the same way
 *   haggle  a 交涉 check first, once a month at a shop (frxPlay.haggled[place] = "0001-03"); a
 *         second in the same month is refused. Came off (成功, 大成功): the price moves by off.
 *         A buy needs the asking price in the purse, haggled or not (the refusal never tells the
 *         roll).
 *   Receipt { kind: "trade", ok, source: "verb", item: { id, before? } (the bag row bought into or
 *   sold from: the server's after-story receipts leave it to this one), trade: { side, place,
 *   good: { id, name, class, tier }, count, each, total, stones: { before, after }, haggle?:
 *   { check, attribute, value, modifier, roll, total, dc, tier, outcome, odds, off } }, commands,
 *   owns, summary }; the clock moves `minutes`.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const goods = require('./goods.cjs');
const places = require('./places.cjs');
const calendar = require('./calendar.cjs');
const world = require('./world.cjs');
const saga = require('./saga.cjs');
const rewards = require('./rewards.cjs');
const perks = require('./perks.cjs');
const { data } = require('./data.cjs');

const RULES = data('trade');
const VERBS = data('verbs');
const CHECKS = { ...rules.RULES.kinds, ...data('checks').kinds };
const STONES = '灵石';
const PRODUCTS = new Set(Object.keys(goods.CLASSES));
const DAY = clock.DAY_MINUTES;

const yearOf = env => Math.floor(Math.floor(mechanics.readClock(env.state).minutes / DAY) / (clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear)) + 1;
const monthKey = env => clock.monthKey(clock.monthOf(mechanics.readClock(env.state).minutes));

// A good is named by one of a place's 「类·阶」: its class (or, for 成品, its kind) and its tier.
function named(good, entries) {
  return entries.some(entry => {
    const [kind, tier] = String(entry).split('·');
    return tier === good.tier && (good.class === kind || (good.class === '成品' && good.kind === kind));
  });
}

const placeName = env => places.placeFacts(env).place;

// Whether a place's shop keeps the shelf of methods (trade.json methods: its kinds, and the big towns).
const shelves = facts => RULES.methods.kinds.includes(facts.kind) || Boolean(RULES.methods.big && facts.big);

function shopOf(env, place = placeName(env)) {
  const year = yearOf(env);
  if (!place) return { place: null, year, goods: [] };
  const sells = places.factsOf(place, env.worldMap).trade.sells;
  const candidates = goods.GOODS.filter(good => good.class !== STONES && !good.key && good.shop !== false && named(good, sells) && !world.dropped(env, good))
    .sort((a, b) => a.id.localeCompare(b.id));
  const random = create(`${env.archiveId}:货单:${place}:${year}`);
  const drawn = [...candidates];
  for (let i = drawn.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random.random() * (i + 1));
    [drawn[i], drawn[j]] = [drawn[j], drawn[i]];
  }
  const kept = new Set(drawn.slice(0, RULES.size).map(good => good.id));
  const facts = places.factsOf(place, env.worldMap);
  const shelf = shelves(facts)
    ? goods.GOODS.filter(good => good.kind === '功法' && !good.key && good.shop !== false && RULES.methods.tiers.includes(good.tier) && !kept.has(good.id))
    : [];
  const auction = AUCTIONS.filter(rule => openHere(env, place, rule)).flatMap(rule => lotsLeft(env, place, year, rule));
  return { place, year, goods: [...candidates.filter(good => kept.has(good.id)), ...shelf, ...auction] };
}

// The sales with lots: the auction, and the fairs that sell lots the same way (trade.json fairs:
// the 春汀集), each on its calendar event at the event's place.
const AUCTIONS = [RULES.auction, ...(Array.isArray(RULES.fairs) ? RULES.fairs : [])];
const eventOf = rule => calendar.CALENDAR.fixed.find(each => each.id === rule.calendar) || null;
const ruleAt = place => AUCTIONS.find(rule => eventOf(rule)?.place === place) || RULES.auction;
// A lot's key in frxPlay.lots: the good's id at the auction (as the first round wrote it), the place
// and the id at a fair.
const lotKey = (rule, id) => (rule === RULES.auction ? id : `${eventOf(rule)?.place}:${id}`);

// The lots bought this year (frxPlay.lots { year, ids }: one piece each, gone once bought; another
// year's record counts for nothing).
function boughtLots(env, year) {
  const record = env.play?.lots;
  return record && typeof record === 'object' && record.year === year && Array.isArray(record.ids) ? record.ids : [];
}

// The year's lots at a place still to be had: lotsOf without those bought.
function lotsLeft(env, place, year, rule = ruleAt(place)) {
  const gone = new Set(boughtLots(env, year));
  return lotsOf(env, place, year, rule).filter(good => !gone.has(lotKey(rule, good.id)));
}

// Whether a sale (the auction or a fair) is open now at this place, which has its venue.
function openHere(env, place, rule) {
  const event = eventOf(rule);
  return !!event && event.place === place && places.factsOf(place, env.worldMap).venues.includes(rule.venue) && !!calendar.openNow(env, rule.calendar);
}
const auctionOpen = (env, place) => AUCTIONS.some(rule => openHere(env, place, rule));

// A sale's lots are fixed by the save, the place and the year: drawn once, kept (接下来 looks
// through a lifetime of openings for a gate's pill; a bounded cache, emptied when full).
const LOTS = new Map();
const LOTS_MOST = 20000;
function lotsOf(env, place, year, rule = ruleAt(place)) {
  const key = `${env.archiveId}|${place}|${year}|${rule.calendar}`;
  const kept = LOTS.get(key);
  if (kept) return kept;
  if (LOTS.size >= LOTS_MOST) LOTS.clear();
  const lots = drawLots(env, place, year, rule);
  LOTS.set(key, lots);
  return lots;
}

function drawLots(env, place, year, rule) {
  const random = create(`${env.archiveId}:拍品:${place}:${year}`);
  const lots = [];
  for (const lot of rule.lots) {
    const hit = random.random() < lot.chance;
    const pool = lot.goods ? lot.goods.map(goods.lookup).filter(Boolean)
      : goods.GOODS.filter(good => good.kind === lot.kind && lot.tiers.includes(good.tier) && good.shop !== false);
    const order = [...pool].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (hit) lots.push(...order.slice(0, lot.count).filter(good => !lots.some(each => each.id === good.id)).map(good => ({ ...good, lot: true, sell: rule.sell, sale: rule.calendar })));
  }
  return lots;
}

function market(env, good) {
  const random = create(`${env.archiveId}:市价:${good.id}:${yearOf(env)}`);
  return good.price * (1 + (random.random() * 2 - 1) * RULES.drift);
}

function each(env, good, side, haggled = false, place = null) {
  const off = haggled ? RULES.haggle.off : 0;
  // The market moved, once and both ways, by the world factors' price hooks and the difficulty's
  // prices (world.priceFactor: 灵气断绝's 丹药 twice, 极限模式 ×1.2) and by what the world line has
  // done to the good in the shop's region (saga.priceFactor: 筑基丹 twice in 云汀湾's shops once the
  // 魔道六宗 hold it); an auction's lot at the auction's price.
  const valued = market(env, good) * world.priceFactor(env, good) * saga.priceFactor(env, good.name, place);
  const asking = good.lot ? good.sell ?? RULES.auction.sell : RULES.sell;
  const raw = side === 'buy' ? valued * asking * (1 - off) : valued * RULES.buy * (1 + off);
  const rounded = Math[RULES.round[side === 'buy' ? 'sell' : 'buy']](raw - (side === 'buy' ? 1e-9 : -1e-9));
  return Math.max(RULES.round.least, rounded);
}

// Whether a map place has a shop: a venue the trade verb takes (verbs.json where.trade).
const openAt = (env, place) => !!place && (VERBS.where?.trade?.venues || []).some(venue => places.factsOf(place, env.worldMap).venues.includes(venue));
const open = env => openAt(env, placeName(env));

const appraises = env => perks.owned(env).some(name => perks.PERKS.perks[name]?.effect?.type === 'appraise');
const haggledAt = (env, place) => (env.play?.haggled && typeof env.play.haggled === 'object' ? env.play.haggled[place] : null);

// The bag's things the place takes: catalogue goods its buys name, not stored away.
function takes(env, place) {
  const facts = places.factsOf(place, env.worldMap);
  const buys = facts.trade.buys;
  const stored = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {}).flatMap(([id, row]) => {
    if (!row || stored.has(id)) return [];
    // a piece of the story's sells as the catalogue's piece it is (goods.ofItem), under its own name
    const good = goods.forSale(row);
    const count = Number(env.ctx.itemStackCount(row['5']));
    if (!good || good.class === STONES || !Number.isSafeInteger(count) || count < 1) return [];
    if (!named(good, buys) && !(facts.big && good.marketSalvage)) return [];
    return [{ id, good, count, name: goods.lookup(row['1']) ? good.name : plain(row['1']).split('|')[0].trim() }];
  });
}

function view(env) {
  const place = placeName(env);
  const here = open(env) && !!place;
  const seen = appraises(env);
  const truly = good => (seen ? { tier: good.tier, base: good.price, market: Math.round(market(env, good)) } : {});
  return {
    ...(place ? { place } : {}), open: here, appraise: seen,
    haggle: { open: here && haggledAt(env, place) !== monthKey(env), off: Math.round(RULES.haggle.off * 100) },
    sells: here ? shopOf(env, place).goods.map(good => ({ id: good.id, name: good.name, unit: goods.unitOf(good), price: each(env, good, 'buy', false, place), ...truly(good) })) : [],
    buys: here ? takes(env, place).map(({ id, good, count, name }) => ({ id, name, unit: goods.unitOf(good), count, price: each(env, good, 'sell', false, place), ...truly(good) })) : [],
  };
}

// The haggle's roll: a check of the file's kind and tier, on the timeline seed at this shop.
function haggle(env, place) {
  const rule = RULES.haggle, check = CHECKS[rule.check];
  const value = mechanics.totalStats(env, 'B1', mechanics.readStats(env, 'B1'))[check.attribute] ?? 0;
  const modifier = rules.modifierFor(value);
  const dc = rules.RULES.tiers[rule.tier];
  const roll = Math.floor(env.random({ kind: 'check', type: `${rule.check}·讨价`, target: place }).random() * rules.RULES.die) + 1;
  const outcome = rules.checkOutcome(roll, roll + modifier, dc);
  const won = new Set(['成功', '大成功']);
  let faces = 0;
  for (let face = 1; face <= rules.RULES.die; face += 1) if (won.has(rules.checkOutcome(face, face + modifier, dc))) faces += 1;
  return { check: rule.check, attribute: check.attribute, value, modifier, roll, total: roll + modifier, dc, tier: rule.tier, outcome,
    odds: Math.round(100 * faces / rules.RULES.die), off: won.has(outcome) ? Math.round(rule.off * 100) : 0 };
}

const wholeCount = value => (/^\d{1,6}$/.test(String(value ?? '').trim()) ? Number(value) : 0);

function trade(env, verb, upTo = null) {
  if (!mechanics.readClock(env.state)) return { refused: '时间行里没有可识别的日期，无法买卖' };
  const place = placeName(env);
  if (!place || !open(env)) return { refused: '这里没有店铺' };
  const side = plain(verb.side);
  if (side !== 'buy' && side !== 'sell') return { refused: '买卖要说是买还是卖' };
  const count = wholeCount(verb.count ?? 1);
  if (count < 1) return { refused: '件数要是正整数' };
  const id = plain(verb.id);
  let good, name, item = null;
  if (side === 'buy') {
    good = shopOf(env, place).goods.find(each => each.id === id);
    if (!good) return { refused: `${place}的店里今年没有这样货` };
    if (good.lot && count > 1) return { refused: `「${good.name}」是拍品，只有一${goods.unitOf(good)}` };
    ({ name } = good);
  } else {
    const held = takes(env, place).find(each => each.id === id);
    if (!held) {
      const row = env.state['1']?.[id];
      return { refused: row ? `${place}的店里不收「${plain(row['1']).split('|')[0]}」` : '储物袋里没有这样东西' };
    }
    if (held.count < count) return { refused: `「${held.name}」只有${chronicle.count(held.count)}${goods.unitOf(held.good)}` };
    ({ good, name } = held);
    item = { id, before: held.count };
  }
  let bargained = null;
  if (verb.haggle === true) {
    if (haggledAt(env, place) === monthKey(env)) return { refused: `这个月已经在${place}的店里讨过价了` };
    bargained = haggle(env, place);
  }
  const price = each(env, good, side, !!bargained?.off, place);
  const total = price * count;
  // What the preview says of a haggle: both prices and the chance, never the roll.
  const plainEach = each(env, good, side, false, place), cutEach = each(env, good, side, true, place);
  const stones = mechanics.stonesOf(env.state['0']?.B1);
  if (stones === null) return { refused: '当前灵石无法识别' };
  // A buyer pays the asking price, or less when a haggle comes off: the purse must hold the asking
  // price either way, so whether a haggled buy is refused never tells the roll.
  if (side === 'buy' && plainEach * count > stones) return { refused: `灵石不够：要${chronicle.count(plainEach * count)}块，只有${chronicle.count(stones)}块` };
  const minutes = RULES.minutes;
  const commands = [];
  let owns;
  if (side === 'buy') {
    const granted = rewards.grant(env, [{ id: good.id, count, price: good.price }]);
    commands.push(...granted.commands);
    ({ owns } = granted);
    item = { id: owns.items[0] };
  } else {
    const left = item.before - count;
    commands.push(left ? `add(${JSON.stringify(id)},{"5":"${left}"})` : `de(${JSON.stringify(id)})`);
    owns = { items: [id], stats: [], forbid: [], charStats: [], skills: [], quests: [], grants: [], currency: false };
  }
  const after = side === 'buy' ? stones - total : stones + total;
  commands.push(`add("B1",{"26":"${after}"})`);
  owns.currency = true;
  const unit = goods.unitOf(good);
  const words = `${side === 'buy' ? '买下' : '卖出'}${name}${chronicle.count(count)}${unit}`;
  const receipt = {
    kind: 'trade', ok: true, source: 'verb', item,
    trade: { side, place, good: { id: good.id, name, class: good.class, tier: good.tier }, count, each: price, total,
      stones: { before: stones, after }, ...(bargained ? { haggle: bargained } : {}) },
    commands: commands.join('\n'), owns, summary: '',
  };
  const now = mechanics.readClock(env.state);
  const lines = bargained
    ? [`先讨价：${bargained.check}检定（${bargained.tier}），成算${bargained.odds}%。`,
      `讨成了${side === 'buy' ? '便宜' : '多给'}${chronicle.count(Math.round(RULES.haggle.off * 10))}成：每${unit}${chronicle.count(cutEach)}块，共${chronicle.count(cutEach * count)}块；`
        + `讨不成每${unit}${chronicle.count(plainEach)}块，共${chronicle.count(plainEach * count)}块灵石。`]
    : [`${words}，每${unit}${chronicle.count(price)}块，共${chronicle.count(total)}块灵石。`];
  return {
    minutes, receipt,
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), lines,
      stones: side === 'buy' ? (bargained ? Math.max(plainEach, cutEach) * count : total) : null,
      formula: [{ label: '每件', value: `${chronicle.count(bargained ? plainEach : price)}块` }, { label: '件数', value: String(count) }] },
    line: ['trade', { 地点: place, 事: words, 价: chronicle.count(total) }],
    finish: settled => {
      if (bargained) env.play.haggled = { ...(env.play.haggled && typeof env.play.haggled === 'object' ? env.play.haggled : {}), [place]: monthKey(env) };
      if (side === 'buy' && good.lot) {
        const rule = AUCTIONS.find(each => each.calendar === good.sale) || RULES.auction;
        env.play.lots = { year: yearOf(env), ids: [...boughtLots(env, yearOf(env)), lotKey(rule, good.id)] };
      }
      settled.summary = `${words}：灵石 ${stones}→${after}` + (bargained ? `；讨价${bargained.outcome}` : '') + `；时间 ${settled.time.before}→${settled.time.after}`;
    },
  };
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.trade = trade;
}

module.exports = { lotsOf, lotsLeft, auctionOpen, AUCTIONS, eventOf, RULES, shopOf, shelves, market, each, view, openAt, named, install, trade };
