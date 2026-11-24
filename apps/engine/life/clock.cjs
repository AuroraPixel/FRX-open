'use strict';
/* Time in the cultivation-life play. The clock is the time row (table 4), read as minutes from
 * 0001年 01月 01日 00:00 by mechanics.readClock, in the calendar of content/cultivation.json (a year
 * of 12 months, a month of 30 days). Only advance moves it (docs/gameplay-plan.md, 「时间和月结」).
 *
 * advance(env, minutes, receipt, place?) → receipt
 *   Moves the clock on by `minutes` (a whole number, 0 or more): the new time row and, when a new
 *   year began on the way, the age join the receipt's commands; `place`, when given, is what the
 *   new time row writes after its date (「/潮岚道/云汀湾（白苇集）3354,2040」: a journey's end), else
 *   the place stays as written. receipt.time ({ before, after,
 *   minutes }, written as the time row writes dates) and receipt.age ({ before, after } or null) say
 *   what moved. `receipt` is the caller's own, not yet settled: advance settles it (env.settle) and
 *   then settles every month the clock entered (month.cjs), whose steps may settle receipts of their
 *   own after it. Its commands are final once advance returns; its summary may still be written.
 *   While the months settle, env.advancing is { from, to }: the stretch in minutes (the clock
 *   already stands at `to`).
 *   advance holds the clock to no lifespan, and throws past MONTH_LIMIT months: a verb asks overrun
 *   first and refuses.
 * overrun(env, minutes) → null, or why the clock may not move that far, worded to follow the verb
 *   and its span (静候一年又四十日 + 跨了…个月): across more than MONTH_LIMIT months (limits.
 *   monthsPerCall of content/life/chronicle.json; the server splits a longer stretch), counted up to
 *   the lifespan's last day when it comes first (the stretch stops there: interrupt.forced), or any
 *   stretch at all once the lifespan is used up (超过剩余寿元). The date must be readable.
 * lifespanEnd(env) → the day the lifespan runs out (plan item 49): the new year on which the age,
 *   up by one at every new year as advance writes it, reaches the lifespan (寿元 and 年龄 of the
 *   player's remarks); null without both as numbers or a readable date. Every stretch stops on it
 *   (interrupt.forced) and the player dies there (legacy.cjs).
 * dateOf(at) → { text: "正月初四", year, month, day }: the date of a moment (minutes, or readClock's
 *   result).
 * dayOfDate(text) → the day of a date written "0001-03-03", counted as readClock counts; null when it
 *   is not one. dateKey(day) writes a day that way; today(env) is the day on the clock (or null).
 * Months are counted from 0001-01 (index 0) and written as frxPlay.month writes them ("0001-02"):
 *   monthOf(minutes) the month a moment is in, monthKey(index), monthIndex(key) (null when unreadable).
 * seedOf(env, parts) → the timeline seed of a roll (设计「骰子的种子」); see below.
 */
const mechanics = require('../mechanics.cjs');
const { data } = require('./data.cjs');

const CALENDAR = mechanics.CULTIVATION.calendar;
const DAY_MINUTES = CALENDAR.hoursPerDay * 60;
const MONTH_MINUTES = CALENDAR.daysPerMonth * DAY_MINUTES;
const YEAR_DAYS = CALENDAR.daysPerMonth * CALENDAR.monthsPerYear;
const NAMES = data('chronicle');
const MONTH_LIMIT = NAMES.limits.monthsPerCall;
const pad = value => String(value).padStart(2, '0');

function dateOf(at) {
  const day = Math.floor((typeof at === 'number' ? at : at.minutes) / DAY_MINUTES);
  const year = Math.floor(day / YEAR_DAYS);
  const within = day - year * YEAR_DAYS;
  const index = Math.floor(within / CALENDAR.daysPerMonth);
  const date = within - index * CALENDAR.daysPerMonth;
  return { text: NAMES.months[index] + NAMES.days[date], year: year + 1, month: index + 1, day: date + 1 };
}

function dayOfDate(text) {
  const match = /^(\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > CALENDAR.monthsPerYear || day < 1 || day > CALENDAR.daysPerMonth) return null;
  return (year - 1) * YEAR_DAYS + (month - 1) * CALENDAR.daysPerMonth + day - 1;
}

function dateKey(day) {
  const { year, month, day: date } = dateOf(day * DAY_MINUTES);
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(date)}`;
}

// Today's day on the clock (as readClock counts days), or null without a readable date.
function today(env) {
  const now = mechanics.readClock(env.state);
  return now ? Math.floor(now.minutes / DAY_MINUTES) : null;
}

const monthOf = minutes => Math.floor(minutes / MONTH_MINUTES);
const monthKey = index => `${String(Math.floor(index / CALENDAR.monthsPerYear) + 1).padStart(4, '0')}-${pad(index % CALENDAR.monthsPerYear + 1)}`;
function monthIndex(key) {
  const match = /^(\d{1,6})-(\d{1,2})$/.exec(String(key ?? ''));
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > CALENDAR.monthsPerYear) return null;
  return (Number(match[1]) - 1) * CALENDAR.monthsPerYear + Number(match[2]) - 1;
}

// A moment as the time row writes it: 0001年 01月 05日, with 07:20 when the row has a time of day.
function moment(minutes, timed) {
  const day = Math.floor(minutes / DAY_MINUTES), within = minutes - day * DAY_MINUTES;
  return mechanics.formatDay(day) + (timed ? ` ${pad(Math.floor(within / 60))}:${pad(within % 60)}` : '');
}

function lifespanEnd(env) {
  const now = mechanics.readClock(env.state);
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const life = mechanics.numberIn(remarks['寿元']), age = mechanics.numberIn(remarks['年龄']);
  if (!now || life === null || age === null) return null;
  return (Math.floor(Math.floor(now.minutes / DAY_MINUTES) / YEAR_DAYS) + Math.max(0, life - age)) * YEAR_DAYS;
}

function overrun(env, minutes) {
  const now = mechanics.readClock(env.state);
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const life = mechanics.numberIn(remarks['寿元']), age = mechanics.numberIn(remarks['年龄']);
  if (life !== null && age !== null && life - age <= 0 && minutes > 0) return `超过剩余寿元：寿元${life}，年龄${age}，只剩0年`;
  // A stretch that would cross the lifespan's last day stops there: the months counted are its.
  const end = lifespanEnd(env), today = Math.floor(now.minutes / DAY_MINUTES);
  const span = end !== null && end > today ? Math.min(minutes, (end - today) * DAY_MINUTES) : minutes;
  const crossed = monthOf(now.minutes + span) - monthOf(now.minutes);
  if (crossed > MONTH_LIMIT) return `跨了${crossed}个月，一次最多${MONTH_LIMIT}个月`;
  return null;
}

async function advance(env, minutes, receipt, place = null) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error(`时间只能向后推进整数分钟（${minutes}）`);
  const now = mechanics.readClock(env.state);
  if (!now) throw new Error('时间行里没有可识别的日期');
  const end = now.minutes + minutes;
  const row = mechanics.clockText(typeof place === 'string' ? { ...now, place } : now, minutes);
  const commands = minutes || (typeof place === 'string' && row !== now.text) ? [`add("TIME_LOCATION_ROW",${JSON.stringify({ 0: row })})`] : [];
  const age = mechanics.agedRemarks(env.ctx.parseRemarksString(env.state['0']?.B1?.['9']), now.minutes, end);
  if (age) commands.push(`add("B1",${JSON.stringify({ 9: { 年龄: String(age.after) } })})`);
  receipt.commands = [receipt.commands, ...commands].filter(Boolean).join('\n');
  receipt.time = { before: moment(now.minutes, now.timed), after: moment(end, now.timed), minutes };
  receipt.age = age;
  await env.settle(receipt);
  // Months already settled (frxPlay.month ahead of the clock) are not settled again, and months
  // before the life began (frxPlay.month behind the clock's starting month) are not made up.
  const from = Math.max(monthIndex(env.play.month) ?? -1, monthOf(now.minutes));
  // The stretch, for the month's steps (the clock already stands at its end while they run).
  env.advancing = { from: now.minutes, to: end };
  // Required here rather than at the top: the month's steps live in modules that require this one.
  await require('./month.cjs').settleMonths(env, monthKey(from), monthKey(Math.max(from, monthOf(end))));
  if (end > now.minutes) require('./saga.cjs').partialMonth(env, now.minutes, end);
  env.advancing = null;
  return receipt;
}

// The seed of a roll is its place on the timeline, not the request's: the same thing done to the
// same target at the same moment rolls the same through undo and ordinary resubmission; another
// way or another moment rolls anew. The explicit retry of a finished turn supplies a reserved
// `reroll:` seed from play_turns.py, which changes this turn's rolls even at the same moment.
// `parts` is one of
//   { kind: "check", type, target, nth }           <存档编号>:<游戏时间的分钟数>:<类型>:<对象编号>:<第几次>
//   { kind: "fight", fight, round, command, nth }  <存档编号>:<斗法编号>:<第几回合>:<指令>:<第几次出手>
//   { kind: "gate", gate }                         <存档编号>:<游戏时间的分钟数>:gate:<关名>
// target may be empty; nth counts from 1 within the turn (or the move) and is 1 when left out. The
// moment is the clock as env.state has it now. env.random(parts) is a seeded stream on the seed.
const SEED_PARTS = { check: ['type'], fight: ['fight', 'round', 'command'], gate: ['gate'] };

function seedOf(env, parts) {
  if (!Object.hasOwn(SEED_PARTS, String(parts?.kind))) throw new Error(`没有「${parts?.kind}」这种骰子的种子`);
  const missing = SEED_PARTS[parts.kind].filter(name => parts[name] === undefined || parts[name] === null || parts[name] === '');
  if (missing.length) throw new Error(`骰子的种子缺少${missing.join('、')}`);
  const now = mechanics.readClock(env.state)?.minutes ?? '-';
  const nth = parts.nth ?? 1;
  const key = parts.kind === 'check' ? [env.archiveId, now, parts.type, parts.target ?? '', nth]
    : parts.kind === 'fight' ? [env.archiveId, parts.fight, parts.round, parts.command, nth]
      : [env.archiveId, now, 'gate', parts.gate];
  if (typeof env.seed === 'string' && env.seed.startsWith('reroll:')) key.push(env.seed);
  return key.join(':');
}

module.exports = {
  CALENDAR, DAY_MINUTES, MONTH_MINUTES, MONTH_LIMIT,
  advance, overrun, lifespanEnd, dateOf, dayOfDate, dateKey, today, monthOf, monthKey, monthIndex, seedOf,
};
