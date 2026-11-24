'use strict';
/* 差事 and the notices (告示, 玩法设计第四节「差事」; plan item 35). The rules are
 * content/life/jobs.json.
 *
 * board(env, place?) → play_models.NoticeBoard: { place?, open, until?, notices: [notice] }: the
 *   notices up at a map place this half-year (the player's place by default; open when it has a
 *   venue of the file's, a 告示 or a 执事堂). A half-year's notices are drawn on a seed of the save,
 *   the place and the half-year, so they stand until it ends (until: its last day) and then a new
 *   lot goes up. A notice { id, kind, title, text, place, goal, days, pay, taken? }: kind one of
 *   the templates (采药, 猎妖, 护送, 寻人, 矿役), place where it is done (a map place of the
 *   template's kinds among the board's nearest of its main region that the player may go into,
 *   places.mayEnter, one it can be done from here in time), goal how (travel, gather, hunt, scene),
 *   days the time it gives once taken, pay the stones it pays, taken when the player took it. A
 *   board posted a 散修 a 矿役 at 石匣岭, the 诸院's, and he cultivated there for decades (the
 *   replayed 伪灵根 of docs/review/gameplay/playtest-2.md): what a board posts follows who reads it.
 *   The work of a notice takes the journey there at the slowest walk (travel.json speeds, the first:
 *   anyone makes it in time) and the work there (work: a gathering, a hunt's day, the wait for a
 *   scene); a board posts only notices whose work fits the longest days of their template, and
 *   gives at least that many. The pay follows the work, not the board: in the range of the tier of
 *   the place it is done (pay by places.tierAt), as far up as its days times the risk of that place
 *   (risk, by its danger) go toward `full`. (白汀城's board, of a 二阶 region, paid 138 for a 一阶
 *   hunt at 松灯林 against 17 for a mine in 云汀湾; boards posted notices no one could reach in their
 *   days: the real model's long playtest.)
 *   A notice done or lapsed is off its board for the rest of its half-year (frxPlay.jobsClosed).
 * The verb job { id } (installed into verbs.VERBS): takes the notice: a row in the quest table
 *   (table 6, 「差事：…」, 进行中), an own entry of the calendar (type job, on its last day) and an
 *   entry of frxPlay.jobs { id, kind, title, place, goal, pay, due, quest, entry, board }. Receipt
 *   { kind: "job", action: "take", job, commands, owns }.
 * settle(env) → after an op that may do one (watches(op)): each job its receipts did is paid (a
 *   travel: the player at its place, however they came there: a journey that arrived, one broken
 *   off on the road within the place's reach, the story's own move in a scene; a gather there, a
 *   hunt's loot there, a scene closed there):
 *   the stones the notice said into the purse, the goods of the rewards table's 差事 cell (the
 *   file's reward: the place's own cell, else its tier and danger band, without its 灵石: the
 *   stones are the pay; one pick fewer than rolled, one at least: a bonus, not a second wage) into
 *   the bag, its quest row 已完成, its calendar entry gone, a chronicle
 *   line; a job past its day is dropped (已失败), even when this op did it (too late).
 *   One receipt { kind: "job", action: "done" | "lapse", job, pay?, items? } each.
 * orphanAll(env): when the life ends and an heir goes on (legacy.cjs), every job taken is dropped
 *   the same way (已失败, its entry gone, off its board), receipt action "orphan": the heir does not
 *   take on the jobs of the one before.
 */
const mechanics = require('../mechanics.cjs');
const { create } = require('../core/random.cjs');
const goods = require('./goods.cjs');
const clock = require('./clock.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');

const RULES = data('jobs');
const ORDER = mechanics.COMBAT.realms.order;
const DAY = clock.DAY_MINUTES;
const SLOWEST = data('travel').speeds[0];

const between = (random, [low, high]) => low + Math.floor(random.random() * (high - low + 1));
const halfOf = env => Math.floor(clock.monthOf(mechanics.readClock(env.state).minutes) / RULES.every);
const fill = (text, values) => chronicle.fill(text, values);

// The board's nearest map places of its main region of the kinds given that the player may go into
// (places.mayEnter), nearest first, with the days the work of the goal takes there: the journey at
// the slowest walk and the work.
function nearby(env, poi, kinds, goal) {
  const fits = name => {
    const facts = places.factsOf(name, env.worldMap);
    return kinds.includes(facts.kind) && places.mayEnter(env, name, { facts });
  };
  return places.poisOf(env.worldMap)
    .filter(each => each.name !== poi.name && Number.isFinite(each.x) && Number.isFinite(each.y)
      && (each.main_region || '') === (poi.main_region || '') && fits(each.name))
    .map(each => ({ name: each.name, distance: Math.hypot(each.x - poi.x, each.y - poi.y) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, RULES.near)
    .map(each => ({ name: each.name, work: Math.max(1, Math.ceil(each.distance / SLOWEST)) + (RULES.work[goal] ?? 0) }));
}

// The risk of the work at a place: the factor of the highest of the file's dangers it reaches, 1
// below them all.
function riskAt(env, place) {
  const danger = Number(places.factsOf(place, env.worldMap).danger) || 0;
  return Object.entries(RULES.risk).reduce((factor, [at, value]) => (danger >= Number(at) ? Math.max(factor, value) : factor), 1);
}

// What the work pays: within the range of the tier of its place (pay), by how heavy it is, its days
// times its risk against `full`: the lightest at the bottom of the range, `full` or more at the top.
function payFor(env, place, work) {
  const [low, high] = RULES.pay[places.tierAt(place, env.worldMap)] || RULES.pay.default;
  return Math.round(low + (high - low) * Math.min(1, (work * riskAt(env, place)) / RULES.full));
}

function openAt(env, place) {
  return !!place && places.factsOf(place, env.worldMap).venues.some(venue => RULES.venues.includes(venue));
}

// A half-year's notices at a map place, as drawn (taken ones included).
function drawn(env, place, half) {
  const poi = places.poisOf(env.worldMap).find(each => each.name === place);
  if (!poi || !openAt(env, place)) return [];
  const kind = places.factsOf(place, env.worldMap).kind;
  // the templates this board posts, each with the places its work can be done from here in time
  const templates = Object.entries(RULES.templates).filter(([, rule]) => rule.boards.includes(kind))
    .map(([name, rule]) => ({ name, rule, options: nearby(env, poi, rule.at, rule.goal).filter(each => each.work <= rule.days[1]) }))
    .filter(each => each.options.length);
  const random = create(`${env.archiveId}:告示:${place}:${half}`);
  const count = RULES.count[kind] ?? RULES.count.default;
  const notices = [];
  for (let n = 1; n <= count && templates.length; n += 1) {
    const { name, rule, options } = templates[Math.floor(random.random() * templates.length)];
    const at = options[Math.floor(random.random() * options.length)];
    const days = between(random, [Math.max(rule.days[0], at.work), rule.days[1]]);
    const pay = payFor(env, at.name, at.work);
    const values = { 地: at.name, 期: chronicle.numeral(days), 酬: chronicle.numeral(pay) };
    notices.push({ id: `${place}·${half}·${n}`, kind: name, title: fill(rule.title, values), text: fill(rule.text, values),
      place: at.name, goal: rule.goal, days, pay });
  }
  return notices;
}

const taken = env => list(env.play?.jobs);

// The notices of this half-year done or lapsed (frxPlay.jobsClosed: their ids, which carry their
// half, `${place}·${half}·${n}`): off their board until the next lot goes up, and not taken again. A
// notice done went back up as free and was taken and paid again: the fourth long run took
// 停鹤城's best notice six times in one half-year (docs/review/gameplay/playtest-2.md).
const halfOfId = id => Number(String(id).split('·').at(-2));
const closedNow = (env, half) => new Set(list(env.play?.jobsClosed).filter(id => halfOfId(id) === half));

function board(env, place = places.placeFacts(env).place) {
  const now = mechanics.readClock(env.state);
  if (!place || !now || !openAt(env, place)) return { ...(place ? { place } : {}), open: false, notices: [] };
  const half = halfOf(env);
  const ids = new Set(taken(env).map(job => job.id));
  const shut = closedNow(env, half);
  const last = ((half + 1) * RULES.every) * clock.CALENDAR.daysPerMonth - 1;
  return { place, open: true, until: clock.dateOf(last * DAY),
    notices: drawn(env, place, half).filter(notice => !shut.has(notice.id))
      .map(notice => (ids.has(notice.id) ? { ...notice, taken: true } : notice)) };
}

// The next quest id: T and one more than the highest in table 6.
function questId(env) {
  const numbers = Object.keys(env.state['6'] || {}).map(id => /^T(\d+)$/.exec(id)?.[1]).filter(Boolean).map(Number);
  return `T${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

const today = env => Math.floor(mechanics.readClock(env.state).minutes / DAY);

function job(env, verb) {
  if (!mechanics.readClock(env.state)) return { refused: '时间行里没有可识别的日期，无法接差事' };
  const place = places.placeFacts(env).place;
  if (!openAt(env, place)) return { refused: '这里没有告示' };
  const id = String(verb.id ?? '');
  const notice = drawn(env, place, halfOf(env)).find(each => each.id === id);
  if (!notice) return { refused: '告示上没有这一张，或者已经换了一批' };
  if (closedNow(env, halfOf(env)).has(id)) return { refused: `「${notice.title}」已经办过了，等下一批告示` };
  if (taken(env).some(each => each.id === id)) return { refused: `「${notice.title}」已经接下了` };
  const quest = questId(env);
  const due = clock.dateKey(today(env) + notice.days);
  const realm = ORDER[mechanics.cultivator(env).major] ?? ORDER[0];
  const row = { 0: quest, 1: `差事：${notice.title}`, 2: `${place}的告示：${notice.text}`, 3: `灵石${notice.pay}块`, 4: '过了期限作罢',
    5: `进行中（${realm}）` };
  const owns = ownsNothing();
  owns.quests.push(quest);
  const receipt = { kind: 'job', ok: true, source: 'verb', action: 'take',
    job: { id, kind: notice.kind, title: notice.title, place: notice.place, goal: notice.goal, pay: notice.pay, due, quest },
    commands: `set(${JSON.stringify(row)})`, owns, summary: '' };
  const minutes = RULES.minutes;
  const now = mechanics.readClock(env.state);
  return {
    minutes, receipt,
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes),
      lines: [`揭下「${notice.title}」：${notice.text}`, `期限到${clock.dateOf((today(env) + notice.days) * DAY).text}，办成了得${chronicle.count(notice.pay)}块灵石。`],
      formula: [] },
    line: ['job', { 地点: place, 差事: notice.title }],
    finish: settled => {
      const entry = calendar.register(env, 'job', { date: due, title: notice.title, place: notice.place });
      env.play.jobs = [...taken(env), { ...receipt.job, entry: entry.id, board: place }];
      settled.summary = `接下差事「${notice.title}」：去${notice.place}，期限${clock.dateOf(clock.dayOfDate(due) * DAY).text}，酬${notice.pay}块灵石`;
    },
  };
}

// ---------------------------------------------------------------- done and lapsed

const WATCHED = new Set(['verb', 'act', 'scene', 'move', 'travel']);
const watches = op => WATCHED.has(op);

// Whether a receipt of this op did the job.
function did(job, receipt, here) {
  if (!receipt?.ok) return false;
  if (job.goal === 'travel') return receipt.kind === 'travel' && receipt.travel?.arrived && receipt.travel.to === job.place;
  if (job.goal === 'gather') return receipt.kind === 'gather' && (receipt.gather?.place || here) === job.place;
  if (job.goal === 'hunt') return receipt.kind === 'loot' && receipt.loot?.from === '狩猎' && here === job.place;
  if (job.goal === 'scene') return receipt.kind === 'close' && here === job.place;
  return false;
}

// The goods a job done gives besides its pay: the rewards table's cell for it (the file's reward) at
// the place it was done, its stones left out.
function goodsFor(env, entry) {
  const rewards = require('./rewards.cjs');
  const rule = RULES.reward;
  const facts = places.factsOf(entry.place, env.worldMap);
  return rewards.roll(env, rule.source, { place: entry.place, tier: places.tierAt(entry.place, env.worldMap),
    danger: Number(facts.danger) || 0, without: rule.without, fewer: rule.fewer, target: `${rule.seed}:${entry.id}` }).items;
}

// A job taken closed: done (paid, its goods), lapse (past its day) or orphan (its taker died before
// it was done: legacy.cjs, plan item 50's fixes). Lapse and orphan leave the quest row 已失败.
async function close(env, entry, action) {
  const row = env.state['6']?.[entry.quest];
  const commands = [], owns = ownsNothing();
  let pay = null, items = [];
  if (row) {
    const status = String(row['5'] ?? '');
    const level = /[（(](.+)[）)]$/.exec(status)?.[1] ?? '';
    commands.push(`add(${JSON.stringify(entry.quest)},${JSON.stringify({ 5: `${action === 'done' ? '已完成' : '已失败'}（${level}）` })})`);
    owns.quests.push(entry.quest);
  }
  if (action === 'done') {
    const stones = mechanics.stonesOf(env.state['0']?.B1);
    if (stones !== null) {
      pay = { before: stones, after: stones + entry.pay, amount: entry.pay };
      commands.push(`add("B1",{"26":"${pay.after}"})`);
      owns.currency = true;
    }
    items = goodsFor(env, entry);
    if (items.length) {
      const made = require('./rewards.cjs').grant(env, items);
      commands.push(...made.commands);
      for (const key of Object.keys(owns)) if (Array.isArray(owns[key]) && Array.isArray(made.owns[key])) owns[key].push(...made.owns[key]);
    }
  }
  calendar.remove(env, entry.entry);
  env.play.jobs = taken(env).filter(each => each.id !== entry.id);
  // off its board for the rest of its half-year (closedNow); the ids of halves gone are let go
  const half = halfOf(env);
  const shut = [...list(env.play.jobsClosed).filter(id => halfOfId(id) >= half), ...(halfOfId(entry.id) >= half ? [entry.id] : [])];
  if (shut.length) env.play.jobsClosed = shut;
  else delete env.play.jobsClosed;
  chronicle.write(env, { done: 'jobDone', orphan: 'jobOrphan' }[action] || 'jobLapse', { 差事: entry.title, 酬: chronicle.count(entry.pay) });
  const moves = action === 'done' ? require('./clocks.cjs').react(env, { kind: 'task', task: entry.title }) : [];
  await env.settle({ kind: 'job', ok: true, source: 'engine', action, job: entry, ...(pay ? { pay } : {}), ...(items.length ? { items } : {}),
    ...(moves.length ? { clocks: moves } : {}),
    commands: commands.join('\n'), owns,
    summary: action === 'done' ? `差事「${entry.title}」办成：灵石 ${pay ? `${pay.before}→${pay.after}` : `+${entry.pay}`}`
      + (items.length ? `；得${goods.listed(items)}` : '')
      : action === 'orphan' ? `差事「${entry.title}」：接下它的人已经坐化，作罢` : `差事「${entry.title}」过了期限，作罢` });
}

// Every job taken, closed as its taker's death leaves it (legacy.cjs: the heir does not take on
// the jobs of the one before): its quest row 已失败, its calendar entry gone, off its board for
// the half-year, one receipt each (action orphan).
async function orphanAll(env) {
  for (const entry of taken(env)) await close(env, entry, 'orphan');
}

async function settle(env) {
  const now = mechanics.readClock(env.state);
  if (!now || !taken(env).length) return;
  const here = places.placeFacts(env).place;
  const receipts = [...env.receipts];
  for (const entry of taken(env)) {
    // past its day it is dropped, even when this op did it: it was done too late
    if ((clock.dayOfDate(entry.due) ?? Infinity) < today(env)) await close(env, entry, 'lapse');
    // a journey's job is done by standing there: a journey broken off a day short within the place's
    // reach leaves the player there as the boards and the hints read it (a seed of the batch-4 runs:
    // 泊灯城 to 镜汀城, broken on day ten of eleven, never paid)
    else if ((entry.goal === 'travel' && here === entry.place) || receipts.some(receipt => did(entry, receipt, here))) {
      await close(env, entry, 'done');
    }
  }
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.job = job;
}

module.exports = { RULES, board, watches, settle, install, job, orphanAll };
