'use strict';
/* Interruptions (过日子被打扰, 玩法设计第四节; plan item 16): a stretch of days spent on a standing verb
 * may be broken off, and then a scene opens (the server opens it from the receipt). The numbers and
 * the causes are content/life/interruptions.json.
 *
 * monthly(env, at?) → { chance, danger, steps, kind }: the chance that a month here is interrupted:
 *   the place's danger (places.placeFacts, in percent) plus perStep for every filled step of every
 *   clock whose scope holds where the player is (clocks.cjs scopes, here.within); at most 1.
 *   `at`, given to it and to forced, stop and view, is where the stretch is spent instead of the
 *   player's place: { kind, danger, place, where } (a journey's road: 山野's danger and causes, no
 *   map place, `where` as here.where gives a place; travel.cjs, plan item 28).
 *   A place sealed (hooks.sealed(env): a 禁制 laid there, arrays.cjs, plan item 43) has no chance
 *   at all (sealed: true), and no random scene waits at its end;
 *   the road never is. Nor has a place where 养伤 (injury.healing: resting injured in place) leaves
 *   no cause at all (sheltered: true).
 * chanceOver(monthly, minutes) → 1 − (1 − monthly)^(D / 30), D the stretch in days.
 * forced(env, minutes) → null, or the first certain stop inside the stretch: on the day a clock in
 *   scope fills by its `days` rise (origin "clock"), or a calendar entry falls due (origin
 *   "calendar"): a director entry of frxPlay.calendar (an own entry only of a type the file's
 *   calendar.own lists), a pending event triggered by its date, a fixed event of the calendar at
 *   the player's own map place, the main line's day (calendar.mainDay: the chapter's dated
 *   condition, if the player explicitly waits for it there; its line says where). Only days after today count, and
 *   the stop comes at this time of day on that day: { minutes, day, origin, cause, clock | event }.
 *   A story thread's time beginning at the player's place inside the stretch (threads.timed, batch
 *   9) stops it on that hour instead when it comes sooner (origin "thread"); never on the road.
 * stop(env, minutes) → null, or how the stretch that starts now is broken off, decided once and
 *   at most once: a forced stop inside it, whatever the dice; else the dice. One draw u on the
 *   timeline seed (seedOf: a check of type seedType on no target, so the same moment gives the same
 *   answer whatever the verb) is the moment t = 30 days × ln(1 − u) ÷ ln(1 − monthly), and the
 *   stretch is broken off when t falls inside it, on day ⌈t⌉ (on the hour, for a stretch under a
 *   day). A second draw picks the cause from causesHere. The stop:
 *     { minutes, day, date, origin, cause, line?, clock?, event?, chance? }
 *     minutes   into the stretch; day the day of the stretch (第几日), date the day it falls on
 *     origin    what opens the scene, a key of scene.json origins: interrupt (the dice), clock, calendar
 *     cause     the seed of the scene: the cause's name, the clock's name, the entry's title
 *     line      the chronicle's words for a cause of the dice; chance the stretch's chance in percent
 * causesHere(env, road?) → the causes of where the stretch is spent: the table of the place's kind;
 *   at a sect's or a family's place (a kind of the file's `outsiders`) the player does not belong to,
 *   the outsider's instead (memberHere). While 养伤
 *   (injury.healing: 静候 or 调息 in place with 内伤, plan item 50's fixes) the causes that would be
 *   someone met in the wild (foes.json encounters.causes) are left out: nothing out there finds
 *   the player resting.
 * memberHere(env, facts) → whether the player belongs to the sect or the family whose place it is
 *   (places.belongsTo, which the place's access reads too):
 *   frxPlay.sect names it (the sect whose place it is, sects.json), or the player's identity (column
 *   2 past the realm) has its name.
 * shown(stop) → what the verb's receipt carries as `interruption`.
 * view(env, minutes, road?) → { risk, line }: the preview's word on it: risk the chance in percent,
 *   100 when a forced stop falls inside the stretch; line says it, in tenths (成). Spent at a
 *   dangerous place whose foes may be above the player (encounter.warning), the line says that too.
 * after(env, stop) → what the stop leaves once the clock stands there: a clock that fills on the
 *   day is counted up to it (clocks.tick on that moment), so it fills then and sets its pending
 *   event; a fixed event worth a line gets the calendar's line now (calendar.said), any other
 *   cause or entry its interrupt line.
 */
const mechanics = require('../mechanics.cjs');
const { create } = require('../core/random.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const clocks = require('./clocks.cjs');
const calendar = require('./calendar.cjs');
const here = require('./here.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list } = require('./play.cjs');

const RULES = data('interruptions');
// the causes that are someone met in the wild (encounter.cjs makes them encounters)
const WILD = new Set(Object.keys(data('foes').encounters.causes));
const QUIET_VERBS = new Set(RULES.quietVerbs);
const hooks = { sealed: () => false };
const DAY = clock.DAY_MINUTES;

function monthly(env, road = null) {
  const facts = road || places.placeFacts(env);
  const at = road ? road.where : here.where(env);
  const steps = list(env.play?.clocks).filter(found => here.within(found.scope, at))
    .reduce((sum, found) => sum + Math.max(0, Number(found.value) || 0), 0);
  if (!road && hooks.sealed(env)) return { chance: 0, danger: 0, steps, kind: facts.kind, sealed: true };
  const pool = localCauses(env, road);
  if (!pool.length) return { chance: 0, danger: facts.danger, steps, kind: facts.kind, sheltered: true };
  // The difficulty moves it (world.json difficulties interrupts).
  const chance = Math.min(1, Math.max(0, (facts.danger / 100 + RULES.perStep * steps) * require('./world.cjs').difficulty(env).interrupts));
  // Every cause in this pool had an equal share of the original risk. Quiet verbs omit
  // the ambient shares, so filtering out visitors cannot make robberies more frequent.
  const fraction = causesHere(env, road, pool).length / pool.length;
  return { chance: chance * fraction, danger: facts.danger, steps, kind: facts.kind };
}

const chanceOver = (chance, minutes) => 1 - (1 - chance) ** (minutes / clock.MONTH_MINUTES);

// ---------------------------------------------------------------- what comes on its day

// Everything due on a day after today: [{ day, origin, cause, clock | event }].
function dueAfter(env, today, road = null) {
  const at = road ? road.where : here.where(env);
  const due = [];
  for (const found of list(env.play?.clocks)) {
    const rule = list(found.rises).find(each => each.kind === 'days');
    if (!rule || found.value >= found.size || !here.within(found.scope, at)) continue;
    // as clocks.tick counts: the days counted toward the next step, and the days since, at the
    // clock's pace (a 隐匿 array slows it: clocks.paceOf)
    const pace = clocks.paceOf(env, found);
    const gone = (Number(found.count?.days) || 0) + Math.max(0, today - (clock.dayOfDate(found.counted) ?? today)) * pace;
    const left = Math.ceil((Math.ceil((found.size - found.value) / rule.steps) * rule.days - gone) / pace);
    due.push({ day: today + Math.max(1, left), origin: 'clock', cause: found.name, clock: { id: found.id, name: found.name, full: found.full } });
  }
  for (const entry of list(env.play?.calendar)) {
    const day = clock.dayOfDate(entry?.date);
    if (entry?.kind === 'own' && !RULES.calendar.own.includes(entry.type)) continue;
    if (entry?.kind === 'director' && entry.place && !here.within({ kind: 'place', value: entry.place }, at)) continue;
    if (day !== null && day > today) {
      due.push({ day, origin: 'calendar', cause: entry.title, event: { kind: entry.kind, id: entry.id, title: entry.title } });
    }
  }
  for (const hook of list(env.play?.pending)) {
    const day = hook?.trigger?.kind === 'date' && !require('./pending.cjs').optional(hook) ? clock.dayOfDate(hook.trigger.value) : null;
    const title = String(hook?.seed ?? '').trim().slice(0, 30);
    if (day !== null && day > today && title) due.push({ day, origin: 'calendar', cause: title, event: { kind: 'pending', id: hook.id, title } });
  }
  // the map place the player is at, by its name or its coordinates (places.cjs)
  const mapPlace = road ? road.place : places.placeFacts(env).place;
  for (const fixed of calendar.CALENDAR.fixed) {
    // as the world line left it (a fixed event that no longer opens, or opens elsewhere)
    const next = mapPlace ? calendar.nextOpen(env, fixed, today) : null;
    if (!next || next.event.place !== mapPlace) continue;
    const { event } = next;
    due.push({ day: next.day, origin: 'calendar', cause: `${event.name}${event.opens}`,
      event: { kind: 'fixed', id: event.id, title: event.name, opens: event.opens, worth: event.worth } });
  }
  // A chapter date is a suggested destination. Go to the appointment only when the player
  // explicitly waits for that date there. Accepted thread appointments have independent timers.
  const main = env.verbKind === 'wait' && Number.isInteger(env.waitingUntil) ? calendar.mainDay(env) : null;
  if (main?.title && main.day === env.waitingUntil && (!main.place || here.within({ kind: 'place', value: main.place }, at))) {
    due.push({ day: main.day, origin: 'calendar', cause: `主线「${main.title}」之期`,
      event: { kind: 'main', title: main.title, ...(main.place ? { place: main.place } : {}) } });
  }
  return due;
}

function forced(env, minutes, road = null) {
  const now = mechanics.readClock(env.state);
  if (!now) return null;
  const today = Math.floor(now.minutes / DAY);
  const first = dueAfter(env, today, road).filter(each => (each.day - today) * DAY <= minutes)
    .reduce((best, each) => (!best || each.day < best.day ? each : best), null);
  const sure = first ? { ...first, minutes: (first.day - today) * DAY, day: first.day - today } : null;
  // a story thread's time here, on its hour
  const timed = road ? null : require('./threads.cjs').timed(env, minutes);
  return timed && (!sure || timed.minutes < sure.minutes) ? timed : sure;
}

// ---------------------------------------------------------------- the causes

// the place's own people, as its access reads them too (places.belongsTo)
const memberHere = (env, facts) => places.belongsTo(env, String(facts?.place || ''));

// 养伤 in place: resting injured (injury.healing), never on the road.
const sheltered = (env, road = null) => !road && require('./injury.cjs').healing(env);

function causesOf(env, road = null) {
  if (road) return RULES.causes[road.kind] || RULES.causes[RULES.fallback];
  const facts = places.placeFacts(env);
  const outside = RULES.outsiders?.[facts.kind];
  if (outside && !memberHere(env, facts)) return outside;
  return RULES.causes[facts.kind] || RULES.causes[RULES.fallback];
}

function localCauses(env, road) {
  const causes = causesOf(env, road);
  return sheltered(env, road) ? causes.filter(cause => !WILD.has(cause.name)) : causes;
}

function causesHere(env, road = null, pool = localCauses(env, road)) {
  return QUIET_VERBS.has(env.verbKind) ? pool.filter(cause => !cause.ambient) : pool;
}

// ---------------------------------------------------------------- the dice

function rolled(env, minutes, odds, road = null) {
  if (odds.chance <= 0) return null;
  const random = create(clock.seedOf(env, { kind: 'check', type: RULES.seedType }));
  const u = random.random();
  const at = odds.chance >= 1 ? 0 : clock.MONTH_MINUTES * Math.log(1 - u) / Math.log(1 - odds.chance);
  if (!(at < minutes)) return null;
  const unit = minutes >= DAY ? DAY : 60;
  const stopAt = Math.min(minutes, Math.max(unit, Math.ceil(at / unit) * unit));
  const causes = causesHere(env, road);
  if (!causes.length) return null;
  const cause = causes[Math.floor(random.random() * causes.length)];
  return { minutes: stopAt, day: Math.ceil(stopAt / DAY), origin: 'interrupt', cause: cause.name, line: cause.line };
}

function stop(env, minutes, road = null) {
  if (!(minutes > 0)) return null;
  const now = mechanics.readClock(env.state);
  if (!now) return null;
  const sure = forced(env, minutes, road);
  const odds = monthly(env, road);
  const made = sure || rolled(env, minutes, odds, road);
  if (!made) return null;
  return { ...made, date: clock.dateOf(now.minutes + made.minutes),
    ...(made.origin === 'interrupt' ? { chance: Math.round(chanceOver(odds.chance, minutes) * 100) } : {}) };
}

function shown(made) {
  const { minutes, day, date, origin, cause, clock: filled, event, chance } = made;
  return { origin, cause, day, date, minutes, ...(filled ? { clock: filled } : {}), ...(event ? { event } : {}),
    ...(chance !== undefined ? { chance } : {}) };
}

// ---------------------------------------------------------------- the preview and what is left

// A chance in tenths and halves of a tenth (成): 约一成半, 不到半成.
function chanceLine(chance) {
  if (chance <= 0) return '这段日子不会被打扰。';
  const halves = Math.round(chance * 20);
  if (halves >= 20) return '这段日子几乎一定会被打扰。';
  if (halves === 0) return '这段日子被打扰的可能不到半成。';
  const whole = Math.floor(halves / 2);
  return `这段日子被打扰的可能约${whole ? `${chronicle.count(whole)}成${halves % 2 ? '半' : ''}` : '半成'}。`;
}

function said(env, minutes, road) {
  const sure = forced(env, minutes, road);
  if (sure) {
    const date = clock.dateOf(mechanics.readClock(env.state).minutes + sure.minutes);
    return { risk: 100, line: `${date.text}${sure.origin === 'clock' ? `「${sure.cause}」将满` : sure.cause}，到时必停。` };
  }
  const chance = chanceOver(monthly(env, road).chance, minutes);
  return { risk: Math.round(chance * 100), line: chanceLine(chance) };
}

function view(env, minutes, road = null) {
  const word = said(env, minutes, road);
  // 养伤: nothing in the wild comes, so nothing is warned of
  if (sheltered(env, road)) return { ...word, line: `${require('./injury.cjs').HEAL.line}${word.line}` };
  // a stretch spent here that can be broken off: what may be met here, when it may be above the
  // player (the road is no dangerous place)
  const warned = road || !word.risk ? '' : require('./encounter.cjs').warning(env);
  return warned ? { ...word, line: `${word.line}${warned}` } : word;
}

function after(env, made) {
  const now = mechanics.readClock(env.state).minutes;
  if (made.origin === 'clock' && made.clock) clocks.tick(env, { minutes: now });
  else if (made.origin === 'interrupt') chronicle.write(env, 'interrupt', { 缘由: made.line });
  // a fixed event worth a line says it now, before the scene it opens (the month step then does not)
  else if (made.event.kind === 'fixed' && made.event.worth) calendar.said(env, made.event, Math.floor(now / DAY), now);
  // the main line's day says itself, and where it is
  else if (made.event.kind === 'main') chronicle.write(env, 'mainDay', { 章: made.event.title, 地: made.event.place || '' });
  else chronicle.write(env, 'interrupt', { 缘由: made.cause });
}

module.exports = { RULES, monthly, chanceOver, forced, stop, shown, view, after, hooks, causesHere, memberHere };
