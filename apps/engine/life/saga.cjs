'use strict';
/* The world line (世界线, 玩法设计第十一节; plan item 39): the 云汀湾 stretch's great events, read from
 * content/life/saga.json. Each goes through its stages on their days whether the player takes part
 * or not: 传闻 (rumours to be heard, a chronicle line), 逼近 (a clock on its region, filled step by
 * step by the day), 发生 (a chronicle line, and pending events by the player's standing when the
 * player is in the region), 余波 (owners, prices and people changed, kept in frxPlay.world). The
 * outcome is the file's (the novel's). No model is called here.
 *
 * frxPlay.world { start, events: { <id>: { year?, clock?, stages: { <stage>: date } } }, owners:
 *   { <place>: owner }, prices: { <region>: { <good>: factor } }, people: [{ name, fate, note,
 *   date }], calendar: { <fixed id>: { since, stop? | place?, note? } } }
 *   start   the year the windows count from: the year of the first month the world line settles
 *   year    a one-off event's year (start + a year of its window, on the save's seed)
 *   stages  the day each stage of the event's last time was done. Earlier occurrences move to
 *           world.past[eventId][opening]. facts are world outcomes, entered is proved by realm
 *           entry, opportunities distinguish an invitation presented from one allowed to expire.
 *   prices  what the aftermaths did to prices, by the event's region (a calendar-linked event's:
 *           the region of the place it was held at; '' for an event of no region, every shop):
 *           each change multiplied into its region's factor for the good
 *   calendar what an aftermath did to the calendar's events of a side it defeated (an event's
 *           owners among the aftermath's defeated): from its day on the event stops, or opens at
 *           the fallen.place; calendar.cjs reads every fixed event through it (asOf)
 * dayOf(env, event) → the day of a one-off event (window, month, day) for this save; null for one
 *   that follows the calendar (calendar.json fixed: its every and first) or is a stub.
 * month(env, month): the month step (month.cjs): every stage whose day falls in the month that
 *   ended is done, in the order of the days (a calendar-linked event's as the calendar holds it
 *   then: none once stopped, at the new place once moved); and an approaching event's clock is brought up to the
 *   step the day calls for. Its pending events (from: saga) carry `expires` (happen.lasts days, 30
 *   when not written, after they open; calendar invitations close with their event) and go once
 *   that day is past, with a line saying who took
 *   the chance (pending.lapse, which every event with `expires` goes by).
 * rumours(env) → [{ event, name, stage, text, since, at }]: what can be heard now: an event's rumour
 *   texts from its rumour day to its day, its aftermath texts for `lasts` days after the aftermath,
 *   a stub's texts from its `from` year on (a moved event's are its fallen.rumours). For the ask
 *   verb (plan item 35).
 * standingOf(env) → sect | demonic | loose: the player's, by the words of the identity (column 2
 *   after the realm).
 * protagonist(name) → whether a name is the novel's protagonist's (saga.json protagonist): he is
 *   in rumours only, and the story's commands may not put him on the scene (settle.cjs).
 * ownerOf(env, place) → who holds a place now, null where the world line has not changed it;
 *   priceFactor(env, name, place?) → what it has done to a good's price at a shop's place (the
 *   player's by default): the factors of the place's region and of '' (1 for nothing; 云汀湾's 筑基丹
 *   is twice once the 魔道六宗 hold it, a shop in 远帆埠 keeps its price). An older save's
 *   prices written as { <good>: factor } count at every shop, as they did then.
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const here = require('./here.cjs');
const goods = require('./goods.cjs');
const { data } = require('./data.cjs');
const { list, nextId } = require('./play.cjs');

const RULES = data('saga');
const DAY = clock.DAY_MINUTES;
const MONTH_DAYS = clock.CALENDAR.daysPerMonth;
const YEAR_DAYS = MONTH_DAYS * clock.CALENDAR.monthsPerYear;
const STAGES = ['rumour', 'approach', 'happen', 'aftermath'];
const LASTS = 30;   // days a pending event of the world line stays open, unless happen.lasts says

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const yearOfDay = day => Math.floor(day / YEAR_DAYS) + 1;
const dayOfDate = (year, month, day) => (year - 1) * YEAR_DAYS + (month - 1) * MONTH_DAYS + (day - 1);
const fixedOf = event => calendar.CALENDAR.fixed.find(each => each.id === event.calendar) || null;

function worldOf(env, year) {
  if (!isObject(env.play.world)) env.play.world = { start: year, events: {}, owners: {}, prices: {}, people: [] };
  return env.play.world;
}

// The year the windows count from: the world's, else this one (nothing settled yet).
const startOf = env => env.play?.world?.start ?? yearOfDay(clock.today(env) ?? 0);

function dayOf(env, event, start = startOf(env)) {
  if (event.stub || event.calendar || !Array.isArray(event.window)) return null;
  const [low, high] = event.window;
  const pick = Math.floor(create(`${env.archiveId}:saga:${event.id}`).random() * (high - low + 1));
  return dayOfDate(start + low + pick, event.month || 1, event.day || 1);
}

// The days a stage is done for an event, falling in [from, to): [{ stage, day, at, place? }], at the
// event's day the stage belongs to, place where a calendar-linked one is held then.
const offset = (event, stage) => (stage === 'rumour' || stage === 'approach' ? -event[stage].before : stage === 'aftermath' ? event.aftermath.after : 0);

function stagesIn(env, event, from, to, start) {
  const found = [];
  for (const stage of STAGES.filter(name => event[name])) {
    const shift = offset(event, stage);
    if (event.calendar) {
      const fixed = fixedOf(event);
      if (!fixed || stage === 'approach') continue;
      // the openings in [from, to) as the world stands; a stage `shift` days off its day looks there
      for (const held of calendar.held(env, fixed, from - shift, to - shift)) {
        found.push({ stage, day: held.day + shift, at: held.day, place: held.event.place });
      }
    } else {
      const at = dayOf(env, event, start);
      if (at !== null && at + shift >= from && at + shift < to) found.push({ stage, day: at + shift, at });
    }
  }
  return found;
}

// ---------------------------------------------------------------- who the player is

function standingOf(env) {
  const identity = plain(env.state['0']?.B1?.['2']).split('|').slice(1).join('|');
  for (const key of ['demonic', 'sect']) if (list(RULES.standings[key].words).some(word => identity.includes(word))) return key;
  return 'loose';
}

// The event's region: the region of the place a calendar-linked event is held at, else its own.
const regionOf = (env, event, place = null) => (place ? here.regionOfPlace(place, env.worldMap) || event.region : event.region) || '';
const inRegion = (env, event, place = null) => {
  const region = regionOf(env, event, place);
  return !region || here.where(env).region === region;
};

// ---------------------------------------------------------------- the stages

const line = (env, text, day) => chronicle.write(env, 'saga', { 事: text }, day * DAY);

// What the world keeps of an event: the day it falls on (at), its year when it comes once, and the
// day each stage was done.
function occurrence(world, event, at) {
  const old = world.events?.[event.id];
  if (old?.at === at) return old;
  if (old?.at && old.at > at) return world.past?.[event.id]?.[at];
  if (old?.at) {
    world.past ||= {};
    (world.past[event.id] ||= {})[old.at] = old;
  }
  world.events ||= {};
  const record = { at, stages: {} };
  world.events[event.id] = record;
  return record;
}

// Read each calendar invitation against the actual dates of its opening. This also holds
// when an already-saved invitation recorded a longer expiry than the calendar allows.
function invitation(hook) {
  const event = hook?.from === 'saga' && RULES.events.find(each => each.id === hook.event);
  const fixed = event?.calendar && fixedOf(event);
  const at = fixed && clock.dayOfDate(hook.since);
  if (!fixed || at === null) return null;
  return { last: at + fixed.days - 1, optional: list(event.happen?.pending?.loose).some(entry => entry.seed === hook.seed) };
}

function opportunity(env, hook, status) {
  if (hook?.from !== 'saga' || !hook.event || !hook.since) return;
  const world = env.play.world;
  const current = world?.events?.[hook.event];
  const record = current?.at === hook.since ? current : world?.past?.[hook.event]?.[hook.since];
  if (!record) return;
  const slots = record.opportunities ||= [];
  const found = slots.find(slot => slot.id === hook.id);
  if (found) found.status = status;
  else slots.push({ id: hook.id, text: hook.seed, expires: hook.expires, status });
}

// A public opening seen in person, or an invitation overtaken by actual entry, is no
// longer waiting to be announced. Being present does not mean entering the trial.
function sawOpening(env, calendarId, opening) {
  for (const hook of list(env.play.pending)) {
    if (hook?.from === 'saga' && hook.event === calendarId && hook.since === opening) {
      require('./pending.cjs').consume(env, hook.id);
    }
  }
}

function enteredRealm(env, calendarId, opening) {
  const event = RULES.events.find(each => each.calendar === calendarId);
  if (!event) return;
  const today = clock.today(env);
  const record = occurrence(worldOf(env, yearOfDay(today)), event, opening);
  if (record) record.entered = clock.dateKey(today);
  sawOpening(env, calendarId, opening);
}

function firstOpening(event, day) {
  const fixed = fixedOf(event);
  return fixed && day === dayOfDate(fixed.first, fixed.month, fixed.day);
}

function approach(env, event, record, day) {
  const rule = event.approach.clock;
  const started = clocks.start(env, {
    name: rule.name, scope: { kind: 'region', value: event.region }, size: rule.size, value: 0,
    rises: [{ kind: 'director', steps: 1 }], falls: [{ kind: 'task', task: rule.fall || `了结${event.name}` }], full: rule.full, from: 'engine',
  }, event.approach.why || '', day * DAY);
  if (started.clock) record.clock = started.clock.id;
}

// The clock up to the step the day calls for: none at the approach's first day, one short of full
// the day before the event.
function climb(env, event, record, day) {
  const found = list(env.play.clocks).find(each => each.id === record?.clock);
  if (!found || !event.approach) return;
  const at = dayOf(env, event), from = at - event.approach.before;
  const target = Math.max(0, Math.min(found.size - 1, Math.floor(found.size * (day - from) / (at - from))));
  if (target > found.value) clocks.bump(env, found.id, target - found.value, event.approach.why || '', day * DAY);
}

const dropClock = (env, id) => {
  env.play.clocks = list(env.play.clocks).filter(each => each.id !== id);
};

function happen(env, event, record, day, place) {
  const found = list(env.play.clocks).find(each => each.id === record?.clock);
  const present = inRegion(env, event, place);
  // The clock fills where the player is to see it (its full is the opening scene); away, it goes.
  if (found && present) clocks.bump(env, found.id, found.size - found.value, event.approach?.why || '', day * DAY);
  else if (found) dropClock(env, found.id);
  if (!present || record.entered) return;
  const standing = standingOf(env);
  const opening = found ? 1 : 0;
  for (const entry of list(event.happen.pending?.[standing]).filter(each => each.after >= opening)) {
    const fixed = fixedOf(event);
    const lasts = fixed ? fixed.days - 1 : event.happen.lasts ?? LASTS;
    const hook = { id: nextId(env, 'pending', 'P'), trigger: { kind: 'date', value: clock.dateKey(day + entry.after) },
      seed: entry.seed, from: 'saga', event: event.id, since: clock.dateKey(day), expires: clock.dateKey(day + entry.after + lasts),
      ...(fixed && standing === 'loose' ? { optional: true } : {}) };
    env.play.pending = [...list(env.play.pending), hook];
    opportunity(env, hook, 'open');
  }
}

function aftermath(env, world, event, record, day, place) {
  const rule = event.aftermath;
  if (record?.clock) dropClock(env, record.clock);
  world.owners = { ...(isObject(world.owners) ? world.owners : {}), ...(rule.owners || {}) };
  // the prices it moves, in its own region's shops only (its own words: 「云汀湾的坊市如今是魔道的人在管」)
  const prices = { ...(isObject(world.prices) ? world.prices : {}) };
  const moved = Object.entries(rule.prices || {});
  if (moved.length) {
    const region = regionOf(env, event, place);
    const table = { ...(isObject(prices[region]) ? prices[region] : {}) };
    for (const [name, factor] of moved) table[name] = Math.round((table[name] ?? 1) * factor * 100) / 100;
    prices[region] = table;
  }
  world.prices = prices;
  world.people = [...list(world.people), ...list(rule.people).map(each => ({ ...each, date: clock.dateKey(day) }))];
  // The calendar's events of a side defeated stop, or go where that side went.
  const defeated = list(rule.defeated);
  for (const held of RULES.events.filter(each => each.calendar && each.fallen && defeated.includes(each.owners))) {
    const fallen = held.fallen;
    world.calendar = { ...(isObject(world.calendar) ? world.calendar : {}),
      [held.calendar]: { since: clock.dateKey(day), ...(fallen.stop ? { stop: true } : { place: fallen.place }), ...(fallen.note ? { note: fallen.note } : {}) } };
    if (fallen.line) line(env, fallen.line, day);
  }
}

// Settle dated stages once, including stages crossed within a month. An open calendar fair
// can finish before its month does. Waiting until month end would create a stale invitation.
function settleStages(env, from, to, start) {
  const due = RULES.events.filter(event => !event.stub)
    .flatMap(event => stagesIn(env, event, from, to, start).map(found => ({ ...found, event })))
    .sort((a, b) => a.day - b.day || STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  if (!due.length) return;
  const world = worldOf(env, start);
  for (const { event, stage, day, at, place } of due) {
    const record = occurrence(world, event, clock.dateKey(at));
    if (!record || record.stages?.[stage]) continue;
    (record.stages ||= {})[stage] = clock.dateKey(day);
    if (!event.calendar) record.year = yearOfDay(at);
    if (stage === 'approach') approach(env, event, record, day);
    if (stage === 'happen') happen(env, event, record, day, place);
    if (stage === 'aftermath') {
      aftermath(env, world, event, record, day, place);
      if (event.aftermath.firstFact && firstOpening(event, at)) record.facts = [event.aftermath.firstFact];
    }
    if (event[stage].line) line(env, event[stage].line, day);
  }
}

function partialMonth(env, startMinutes, endMinutes) {
  const last = Math.floor(endMinutes / DAY);
  const first = Math.max(Math.floor(startMinutes / DAY), last - last % MONTH_DAYS);
  settleStages(env, first, last + 1, env.play.world?.start ?? yearOfDay(first));
  const pending = require('./pending.cjs');
  if (list(env.play.pending).some(hook => hook?.from === 'saga' && pending.lapsedBy(hook, last))) pending.lapse(env, last);
}

async function month(env, entered) {
  const to = Math.floor(entered.minutes / DAY), from = to - MONTH_DAYS;
  const world = worldOf(env, yearOfDay(Math.max(0, from)));
  // Pending events nobody took up lapse on their day, each with its line (pending.cjs).
  require('./pending.cjs').lapse(env, from);
  settleStages(env, from, to, world.start);
  // An approaching clock climbs by the day.
  for (const event of RULES.events.filter(each => each.approach && !each.calendar && !each.stub)) {
    const at = dayOf(env, event, world.start);
    if (at !== null && to - 1 >= at - event.approach.before && to - 1 < at) climb(env, event, world.events[event.id], to - 1);
  }
}

// ---------------------------------------------------------------- what can be heard

function rumours(env) {
  const today = clock.today(env);
  if (today === null) return [];
  const start = startOf(env);
  const heard = [];
  const add = (event, stage, since, at, texts = null) => {
    const rule = stage === 'stub' ? event : event[stage];
    for (const text of texts || list(rule?.texts)) heard.push({ event: event.id, name: event.name, stage, text, since: clock.dateKey(since), at: clock.dateKey(at) });
  };
  for (const event of RULES.events) {
    if (event.stub) {
      const from = dayOfDate(start + (event.from || 0), 1, 1);
      if (today >= from) add(event, 'stub', from, from);
      continue;
    }
    const fixed = event.calendar ? fixedOf(event) : null;
    // a calendar-linked event as the world holds it (none once stopped; moved, its fallen.rumours)
    const days = fixed
      ? calendar.held(env, fixed, today - (event.aftermath ? event.aftermath.after + (event.aftermath.lasts || 0) : 0), today + (event.rumour?.before || 0) + 1)
        .map(held => ({ at: held.day, moved: held.event.place !== fixed.place }))
      : [{ at: dayOf(env, event, start), moved: false }];
    for (const { at, moved } of days) {
      const texts = moved && event.fallen?.rumours ? event.fallen.rumours : null;
      if (event.rumour && today >= at - event.rumour.before && today < at) add(event, 'rumour', at - event.rumour.before, at, texts);
      if (event.aftermath && today >= at + event.aftermath.after && today < at + event.aftermath.after + (event.aftermath.lasts || 0)) {
        const special = firstOpening(event, at) ? event.aftermath.firstTexts : null;
        add(event, 'aftermath', at + event.aftermath.after, at, special);
      }
    }
  }
  return heard;
}

// ---------------------------------------------------------------- the rest

const NAMES = list(RULES.protagonist?.names);
const protagonist = name => !!plain(name) && NAMES.some(each => plain(name).includes(each));
const ownerOf = (env, place) => env.play?.world?.owners?.[place] ?? null;
function priceFactor(env, name, place = null) {
  const prices = env.play?.world?.prices;
  if (!isObject(prices)) return 1;
  const good = goods.lookup(name)?.name ?? plain(name);
  let factor = 1, region = null;
  for (const [key, value] of Object.entries(prices)) {
    if (typeof value === 'number') {
      if (key === good) factor *= value || 1;
      continue;
    }
    if (!isObject(value) || !(good in value)) continue;
    if (key && region === null) region = place ? here.regionOfPlace(place, env.worldMap) || here.where(env, place).region : here.where(env).region;
    if (!key || key === region) factor *= Number(value[good]) || 1;
  }
  return factor;
}

module.exports = { RULES, dayOf, month, partialMonth, opportunity, invitation, sawOpening, enteredRealm, rumours, standingOf, protagonist, ownerOf, priceFactor };
