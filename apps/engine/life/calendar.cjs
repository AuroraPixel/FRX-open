'use strict';
/* The calendar (日历, 玩法设计第三节, plan item 14): what is ahead and when. Three kinds of entry:
 *   fixed     the region's recurring events of content/life/calendar.json, worked out from the game
 *             year each time and never stored
 *   own       what the engine registers for itself in frxPlay.calendar: { id, kind: "own", type,
 *             title, date, place?, note? } (type a key of the file's `own`: cooldown first)
 *   director  what the director scheduled (the director op): { id, kind: "director", title, date,
 *             place?, note? }
 * Dates are written "0001-03-03" in frxPlay; an own or director entry is over once its date is past.
 * The world line may change a fixed event for good (saga.cjs, plan item 39: the side that holds it
 * fell): frxPlay.world.calendar { <fixed id>: { since, stop?, place?, note? } }: from `since` on it
 * opens no more (stop), or opens at another map place. Everything below reads the fixed events
 * through it:
 * asOf(env, event, day) → the fixed event as it stands on that day, or null when it no longer opens;
 *   held(env, event, from, to) → [{ day, event }] its openings in [from, to) as the world stands;
 *   nextOpen(env, event, after) → the first of them after the day `after`, or null.
 *
 * An entry as the calendar shows it: { id, kind, type?, title, place?, note?, date: { text, year,
 *   month, day }, days, open? }: days from today to its date, 0 for a fixed event open today (open
 *   is true then: it opened and has not closed). Sorted by days, fixed before director before own.
 * upcoming(env, n) → the nearest n entries, today's included; ahead(env) → every entry of the next
 *   `ahead` years (the calendar op). openNow(env, id) → { day, until } while the fixed event `id` is
 *   open today (its opening day, and the day it is closed again), else null.
 * register(env, type, { date, place?, note?, title? }) → the own entry; a unique type replaces
 *   the one it had. remove(env, id) → the entry taken out, or null.
 * schedule(env, { date, title, place?, note? }) → { entry } | { refused }: a director entry, its
 *   date today or later.
 * settle(env, month): the month step, after the clocks'. For the month that ended: each fixed
 *   event worth a line that opened in it, while the player is in its region, gets a chronicle line
 *   (三月初三　春汀集开市。, keyed so a long stretch merges the repeats) and its row in the card's
 *   table 5 (世界大事: one row per event, rewritten when it opens again, settled once in the
 *   advance's last month as a receipt of kind "calendar"); own and director entries now past go.
 *   An opening already said when it stopped a stretch (said) gets no second line.
 * said(env, event, day, at) → the opening's line now, when it stops a stretch at the player's place
 *   (interrupt.after): the scene it opens comes after its line; frxPlay.said keeps it (the last
 *   `saidKept`), so the month step does not say it again.
 * mainDay(env) → the main line's day still to come: the current chapter's (mechanics.plotView on
 *   env.plot, the storyline the server hands a verb and the progress) dated condition not yet met
 *   (日期, 「时间不早于0001年09月09日」): { day, date: { text, … }, title, place? }, place the
 *   chapter's own 到达 when it has one; null without a storyline, a chapter or a day ahead. It
 *   stops a stretch on its day like a fair (interrupt.cjs), and 接下来 leads with the main line as
 *   it draws near (hints.cjs).
 */
const mechanics = require('../mechanics.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const here = require('./here.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const baseCalendar = data('calendar');
const CALENDAR = { ...baseCalendar, fixed: [...baseCalendar.fixed, ...data('human-journey').calendar] };
const { daysPerMonth, monthsPerYear } = clock.CALENDAR;
const YEAR_DAYS = daysPerMonth * monthsPerYear;
const DAY = clock.DAY_MINUTES;
const ORDER = { fixed: 0, director: 1, own: 2 };
// How many openings said at a stretch's stop frxPlay.said keeps (the month step reads the last ones).
const SAID_KEPT = 8;

const yearOf = day => Math.floor(day / YEAR_DAYS) + 1;
const openDay = (event, year) => (year - 1) * YEAR_DAYS + (event.month - 1) * daysPerMonth + event.day - 1;

// The days a fixed event opens on, from `from` to before `to`.
function openings(event, from, to) {
  const days = [];
  const after = Math.max(event.first, yearOf(Math.max(0, from)));
  for (let year = event.first + Math.ceil((after - event.first) / event.every) * event.every; ; year += event.every) {
    const day = openDay(event, year);
    if (day >= to) return days;
    if (day >= from) days.push(day);
  }
}

function asOf(env, event, day) {
  if (event.minMajor && (!env?.state || mechanics.cultivator(env).major < event.minMajor)) return null;
  const change = env?.play?.world?.calendar?.[event.id];
  const since = change ? clock.dayOfDate(change.since) : null;
  if (since === null || day < since) return event;
  return change.stop ? null : { ...event, place: change.place || event.place, note: change.note || event.note };
}

const held = (env, event, from, to) => openings(event, from, to).map(day => ({ day, event: asOf(env, event, day) })).filter(each => each.event);

function nextOpen(env, event, after) {
  // the openings of the cycle after it, and one more: a stop is for good, so none is null
  const [found] = held(env, event, after + 1, after + 1 + (event.every + 1) * YEAR_DAYS);
  return found || null;
}

function shown(entry, day, today) {
  return { id: entry.id, kind: entry.kind, ...(entry.type ? { type: entry.type } : {}), title: entry.title,
    ...(entry.place ? { place: entry.place } : {}), ...(entry.note ? { note: entry.note } : {}),
    date: clock.dateOf(day * DAY), days: Math.max(0, day - today), ...(day <= today ? { open: true } : {}) };
}

function ahead(env) {
  const today = clock.today(env);
  if (today === null) return [];
  const end = today + CALENDAR.ahead * YEAR_DAYS;
  const entries = [];
  for (const fixed of CALENDAR.fixed) {
    for (const { day, event } of held(env, fixed, today - fixed.days + 1, end)) {
      entries.push(shown({ id: `${event.id}-${yearOf(day)}`, kind: 'fixed', title: event.name, place: event.place, note: event.note }, day, today));
    }
  }
  for (const entry of list(env.play.calendar)) {
    const day = clock.dayOfDate(entry.date);
    if (day !== null && day >= today && day < end) entries.push(shown(entry, day, today));
  }
  return entries.sort((a, b) => a.days - b.days || ORDER[a.kind] - ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const upcoming = (env, n) => ahead(env).slice(0, n);

// The opening a fixed event is in today, { day, until } (until the first day it is closed again),
// or null when it is not open (a secret realm's gate: realm.cjs).
function openNow(env, id) {
  const event = CALENDAR.fixed.find(each => each.id === id);
  const today = clock.today(env);
  if (!event || today === null) return null;
  const [found] = held(env, event, today - event.days + 1, today + 1);
  return found ? { day: found.day, until: found.day + event.days } : null;
}

function register(env, type, fields = {}) {
  const kind = CALENDAR.own[type];
  if (!kind) throw new Error(`日历里没有「${type}」这种自己的事`);
  const day = clock.dayOfDate(fields.date);
  if (day === null) throw new Error(`日期要写成0001-03-03这样（${fields.date}）`);
  const entry = { id: nextId(env, 'calendar', 'D'), kind: 'own', type, title: fields.title || kind.title, date: clock.dateKey(day),
    ...(fields.place ? { place: String(fields.place) } : {}), note: fields.note || kind.note };
  env.play.calendar = [...list(env.play.calendar).filter(each => !(kind.unique && each.kind === 'own' && each.type === type)), entry];
  return entry;
}

function remove(env, id) {
  const found = list(env.play.calendar).find(each => each.id === id) || null;
  if (found) env.play.calendar = list(env.play.calendar).filter(each => each !== found);
  return found;
}

function schedule(env, item = {}) {
  const title = typeof item.title === 'string' ? item.title.trim().slice(0, 20) : '';
  if (!title) return { refused: '带日期的事没有名字' };
  const day = clock.dayOfDate(item.date);
  if (day === null) return { refused: `「${title}」的日期要写成0001-03-03这样` };
  if (day < clock.today(env)) return { refused: `「${title}」的日子已经过了` };
  const entry = { id: nextId(env, 'calendar', 'D'), kind: 'director', title, date: clock.dateKey(day),
    ...(typeof item.place === 'string' && item.place.trim() ? { place: item.place.trim().slice(0, 20) } : {}),
    ...(typeof item.note === 'string' && item.note.trim() ? { note: item.note.trim().slice(0, 80) } : {}) };
  env.play.calendar = [...list(env.play.calendar), entry];
  return { entry };
}

// The rows of table 5 the advance's events leave: one per event, rewritten when it opens again.
async function settleRows(env) {
  const rows = list(env.state['5']);
  const commands = [], said = [];
  for (const [id, day] of env.calendarRows) {
    const event = asOf(env, CALENDAR.fixed.find(each => each.id === id), day);
    const place = here.regionOfPlace(event.place, env.worldMap) + event.place;
    const date = mechanics.formatDay(day);
    const text = `${event.name}${event.opens}。${event.note}`;
    const old = rows.find(row => row?.['1'] === place && String(row?.['2'] ?? '').startsWith(event.name) && row.id);
    commands.push(old ? `updateWorldEvent(${JSON.stringify(old.id)},${JSON.stringify({ 0: date, 2: text })})`
      : `addWorldEvent(${JSON.stringify(date)},${JSON.stringify(place)},${JSON.stringify(text)})`);
    said.push(`${event.name}${event.opens}（${date}）`);
  }
  env.calendarRows.clear();
  await env.settle({ kind: 'calendar', ok: true, source: 'engine', commands: commands.join('\n'), owns: ownsNothing(),
    summary: `世界大事：${said.join('；')}` });
}

const saidKey = (id, day) => `${id}@${clock.dateKey(day)}`;

function said(env, event, day, at) {
  chronicle.write(env, 'calendar', { 名: event.title || event.name, 开: event.opens }, at, `calendar:${event.id}`);
  env.play.said = [...list(env.play.said).filter(key => key !== saidKey(event.id, day)), saidKey(event.id, day)].slice(-SAID_KEPT);
}

async function settle(env, month) {
  const to = Math.floor(month.minutes / DAY), from = to - daysPerMonth;
  const where = here.where(env);
  const already = new Set(list(env.play.said));
  for (const fixed of CALENDAR.fixed) {
    if (!fixed.worth || !where.region) continue;
    for (const { day, event } of held(env, fixed, from, to)) {
      if (here.regionOfPlace(event.place, env.worldMap) !== where.region) continue;
      if (!already.has(saidKey(event.id, day))) chronicle.write(env, 'calendar', { 名: event.name, 开: event.opens }, day * DAY, `calendar:${event.id}`);
      (env.calendarRows ||= new Map()).set(event.id, day);
    }
  }
  const kept = list(env.play.calendar).filter(entry => (clock.dayOfDate(entry.date) ?? to) >= to);
  if (kept.length !== list(env.play.calendar).length) env.play.calendar = kept;
  if (month.last && env.calendarRows?.size) await settleRows(env);
}

const DATED = /(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/;

function mainDay(env) {
  if (!env.plot || !Array.isArray(env.plot.chapters)) return null;
  const view = mechanics.plotView(env, env.plot);
  if (view.currentIndex === null) return null;
  const chapter = env.plot.chapters[view.currentIndex] || {};
  const conditions = view.chapters[view.currentIndex]?.conditions || [];
  const dated = conditions.find(each => each?.kind === '日期' && each.met === false && DATED.test(String(each.value || '')));
  if (!dated) return null;
  const [, year, month, date] = String(dated.value).match(DATED).map(Number);
  const day = (year - 1) * monthsPerYear * daysPerMonth + (month - 1) * daysPerMonth + date - 1;
  const now = mechanics.readClock(env.state);
  if (!now || day <= Math.floor(now.minutes / DAY)) return null;
  const place = conditions.find(each => each?.kind === '到达' && each.value)?.value;
  return { day, date: clock.dateOf(day * DAY), title: String(chapter.title || '').replace(/<[^>]*>/g, '').trim(), ...(place ? { place: String(place) } : {}) };
}

module.exports = { CALENDAR, ahead, upcoming, openNow, openings, asOf, held, nextOpen, register, remove, schedule, settle, said, mainDay };
