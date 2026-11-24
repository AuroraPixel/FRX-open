'use strict';
/* The month settlement (月结): each time the clock crosses into a new month the world is settled
 * once, by the steps of STEPS in their fixed order (玩法设计第三节「月结」): the pressure clocks take
 * a step, the calendar's events fall due, 奇遇 is rolled (rewards.cjs, plan item 30), 丹毒 eases
 * (poison.cjs, item 44), eggs hatch and spirit beasts heal (beasts.cjs, item 41), the sect's stipend and
 * duty (sect.cjs, item 46), a new year near the lifespan's end is said (legacy.cjs, item 49), the
 * people of the world live a month, the month's great events
 * go to table 5, notices and prices. advance (clock.cjs) calls settleMonths; nothing else does.
 *
 * A step is `async (env, month) => void`, run once for every month the clock enters:
 *   month   { key: "0001-02", year: 1, month: 2, index, minutes, previous: "0001-01", last }: the
 *           month entered (index counts months from 0001-01, minutes is its first moment on the
 *           clock); the month that ended is `previous`; `last` is true for the last month this
 *           advance enters, where a step settles what it gathered over the months before
 *   it may  change env.play in place; settle a receipt with `await env.settle(receipt)` (applied at
 *           once, so the next step sees it); write a chronicle line with chronicle.write(env, kind,
 *           values, minutes) dated inside the month that ended.
 * A step must be cheap: one advance may cross limits.monthsPerCall months (content/life/
 * chronicle.json). Work on env.play, and settle a receipt only in a month where something happened.
 * Add a step with one line, at its place in the order. A step's module may require clock.cjs and
 * chronicle.cjs: this file is loaded only when the clock first moves.
 */
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const calendar = require('./calendar.cjs');
const director = require('./director.cjs');
const rewards = require('./rewards.cjs');
const saga = require('./saga.cjs');
const home = require('./home.cjs');
const people = require('./people.cjs');
const poison = require('./poison.cjs');
const beasts = require('./beasts.cjs');
const sect = require('./sect.cjs');
const legacy = require('./legacy.cjs');

const STEPS = [
  clocks.tick,
  calendar.settle,
  saga.month,         // the world line's stages (plan item 39)
  home.month,         // the rent of a rented home (plan item 45)
  rewards.fortune,
  poison.month,       // 丹毒 eases (plan item 44)
  beasts.month,       // eggs hatch, hurt beasts heal (plan item 41)
  sect.month,         // the sect's stipend and its yearly duty (plan item 46)
  legacy.month,       // a new year in the lifespan's last ten: the chronicle says so (plan item 49)
  people.month,       // everyone else's month (plan item 37)
  director.markDue,   // last: whether the steps before it wrote a line (plot evolution is due)
];

function monthAt(index, last) {
  const { monthsPerYear } = clock.CALENDAR;
  return { key: clock.monthKey(index), year: Math.floor(index / monthsPerYear) + 1, month: index % monthsPerYear + 1,
    index, minutes: index * clock.MONTH_MINUTES, previous: clock.monthKey(index - 1), last: index === last };
}

// Settles every month after `from` up to and including `to` (keys), one after another, and leaves
// frxPlay.month at `to`, or where it was when that is later: a month is never settled twice.
async function settleMonths(env, from, to) {
  const first = clock.monthIndex(from) + 1, last = clock.monthIndex(to);
  if (last - first + 1 > clock.MONTH_LIMIT) throw new Error(`一次最多结算${clock.MONTH_LIMIT}个月（${from}→${to}）`);
  for (let index = first; index <= last; index += 1) {
    const month = monthAt(index, last);
    for (const step of STEPS) await step(env, month);
    env.play.month = month.key;
  }
  const reached = clock.monthIndex(env.play.month);
  if (reached === null || reached < last) env.play.month = clock.monthKey(last);
}

module.exports = { STEPS, settleMonths };
