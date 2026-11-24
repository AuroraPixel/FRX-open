'use strict';
/* Where what a gate wants can be had (the numeric balance after plan item 50: a method's cap is a
 * goal, not a wall): a method that reaches the next realm, and the gate's pills. 接下来 (hints.cjs)
 * points at the nearest source, the director's main line gives a method when a chapter closes on a
 * cap (gift); the numbers are content/life/trade.json (the shelf of methods, the auction) and
 * content/life/sects.json (the exchange).
 *
 * need(env, sheet?) → null | { gate, target, tier }: the method worn (or none) cannot reach the next
 *   gate (by the gate's sheet, gate.sheet's unless one is handed in); tier is the catalogue's tier
 *   of a method that can (二阶 for 筑基 …).
 * fitting(env, tier) → the catalogue's methods of that tier, those of the root's elements first (契合:
 *   one of another element cultivates at verbs.json affinity.mismatch); matching(env, tier) only those
 *   of the root's elements.
 * sources(env, names, { until? }) → [{ kind, good, place?, days, price?, contribution?, date?, open? }], nearest
 *   first (the days to get there, and to the day it opens): kind bag (in the bag now), shop (a shop
 *   within the near places that sells one this year: trade.shopOf, its price trade.each), sect (the
 *   player's sect exchanges one at the player's status: its contribution), auction (one of the
 *   auction's next openings, trade.json auction.ahead of them and on to the day `until` when one is
 *   given, holds one among that year's lots: its place, date and price; open while it is on).
 * gift(env) → the settled receipt of a method given by the main line (kind gift, from 主线): the
 *   first fitting method of the needed tier, when the cap stops the next gate; else null (none of
 *   the tiers kept off every shelf, shop false: 五阶 comes only with the story's 机缘).
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const calendar = require('./calendar.cjs');
const goods = require('./goods.cjs');
const places = require('./places.cjs');
const speed = require('./speed.cjs');
const { data } = require('./data.cjs');

const ORDER = mechanics.COMBAT.realms.order;
const SECTS = data('sects');
const LADDER = SECTS.ladder;
// the most auctions looked through however long `until` is (a bound on the work, about a lifetime of 结丹)
const AUCTIONS_MOST = 400;

const rowName = row => plain(row?.['1'] ?? row?.name).split('|')[0];
const today = env => clock.today(env);
const hereName = env => places.placeFacts(env).place || '';

function need(env, sheet = require('./gate.cjs').sheet(env)) {
  if (sheet.beyond) return null;
  const capped = sheet.requires.find(each => each.key === 'cap' && !each.met);
  const none = sheet.requires.find(each => each.key === 'technique' && !each.met);
  if (!capped && !none) return null;
  const target = ORDER.indexOf(sheet.gate);
  return { gate: sheet.gate, target, tier: goods.tierOf(target) };
}

function fitting(env, tier) {
  const c = mechanics.cultivator(env);
  const root = speed.affinityOf(env, c).root || '';
  return goods.GOODS.filter(good => good.kind === '功法' && good.tier === tier)
    .sort((a, b) => (root.includes(b.element) ? 1 : 0) - (root.includes(a.element) ? 1 : 0) || a.id.localeCompare(b.id));
}

// The catalogue's methods of that tier of the root's own elements (fitting's first ones).
function matching(env, tier) {
  const c = mechanics.cultivator(env);
  const root = speed.affinityOf(env, c).root || '';
  return fitting(env, tier).filter(good => root.includes(good.element));
}

function inBag(env, good) {
  const stored = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {}).find(([id, row]) => row && !stored.has(id) && rowName(row) === good.name)?.[0] || null;
}

function sources(env, names, { until = null } = {}) {
  const trade = require('./trade.cjs');
  const travel = require('./travel.cjs');
  const wanted = names.map(name => goods.lookup(name)).filter(Boolean);
  const order = new Map(wanted.map((good, i) => [good.id, i]));
  const found = [];
  for (const good of wanted) {
    const id = inBag(env, good);
    if (id) found.push({ kind: 'bag', good, itemId: id, days: 0 });
  }
  const here = hereName(env);
  // every shop of the region that could keep one (its 卖什么 names the good, or its shelf of
  // methods), nearest first: the nearest forty places (as this read before) left out 白苇集's
  // shop from 溪国, the forty-seventh by distance
  const stops = [...(here ? [{ name: here, days: 0 }] : []), ...travel.near(env, Infinity)];
  for (const stop of stops) {
    if (!trade.openAt(env, stop.name)) continue;
    const facts = places.factsOf(stop.name, env.worldMap);
    if (!wanted.some(good => trade.named(good, facts.trade?.sells || []) || (good.kind === '功法' && trade.shelves(facts)))) continue;
    for (const good of trade.shopOf(env, stop.name).goods) {
      if (!order.has(good.id) || good.lot) continue;
      found.push({ kind: 'shop', good, place: stop.name, days: stop.days, price: trade.each(env, good, 'buy', false, stop.name) });
    }
  }
  const sect = env.play?.sect && typeof env.play.sect === 'object' ? env.play.sect : null;
  if (sect) {
    const home = SECTS.sects?.[sect.name]?.place || null;
    const way = home && home !== here ? travel.route(env, home) : { days: 0 };
    for (const entry of SECTS.exchange) {
      const good = entry.good ? goods.lookup(entry.good) : null;
      if (!good || !order.has(good.id) || way.refused) continue;
      if (LADDER.indexOf(sect.status) < LADDER.indexOf(entry.status)) continue;
      found.push({ kind: 'sect', good, entry: entry.id, hall: entry.hall, contribution: entry.price, status: entry.status,
        ...(home ? { place: home } : {}), days: way.days });
    }
  }
  // each sale's next openings (the auction's ahead of them, and on to `until`): the lots each holds
  const day = today(env);
  for (const rule of trade.AUCTIONS) {
    const event = trade.eventOf(rule);
    if (!event || day === null) continue;
    const route = event.place === here ? { days: 0 } : travel.route(env, event.place);
    const open = calendar.openNow(env, rule.calendar);
    let next = open || calendar.nextOpen(env, event, day);
    // the next `ahead` openings, and on to the day `until` (a gate's pills: as long as the years last)
    for (let n = 0; next && (n < (rule.ahead ?? 1) || (until !== null && next.day <= until)) && n < AUCTIONS_MOST && !route.refused; n += 1) {
      const year = Math.floor(next.day / (clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear)) + 1;
      for (const good of trade.lotsLeft(env, event.place, year, rule)) {
        if (!order.has(good.id)) continue;
        found.push({ kind: 'auction', good, place: event.place, event: event.name, date: clock.dateKey(next.day), open: n === 0 && !!open,
          days: Math.max(route.days, next.day - day), price: trade.each(env, good, 'buy', false, event.place) });
      }
      next = calendar.nextOpen(env, event, next.day + event.days);
    }
  }
  return found.sort((a, b) => a.days - b.days || order.get(a.good.id) - order.get(b.good.id));
}

async function gift(env) {
  const needed = need(env);
  if (!needed) return null;
  // a method kept off every shelf (五阶) comes only with the story's own 机缘, never as a gift
  const good = fitting(env, needed.tier).find(each => each.shop !== false);
  if (!good || inBag(env, good)) return null;
  const rewards = require('./rewards.cjs');
  const made = rewards.grant(env, [{ id: good.id, count: 1, price: good.price }]);
  return env.settle({ kind: 'gift', ok: true, source: 'engine', gift: { from: 'main', name: '主线', item: good.name, condition: '' },
    commands: made.commands.join('\n'), owns: made.owns, summary: `主线所得「${good.name}」：${good.uses}` });
}

module.exports = { need, fitting, matching, sources, gift };
