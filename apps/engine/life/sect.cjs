'use strict';
/* 宗门 (玩法设计第八节「宗门」; plan item 46): the second ladder beside the realm. The rules are
 * content/life/sects.json. A loose cultivator (no frxPlay.sect) has no stipend and no duty.
 *
 * frxPlay.sect, null outside a sect:
 *   { name, status, contribution, earned, joined, duty: { since, done }, bought: { <id>: { year,
 *     count } }, entered?: { contest, date }, herbs, assigned? }
 *   status a step of the ladder; contribution what can be spent, earned all ever earned (promotion
 *   reads it); joined the day; duty the duties done in the year from `since` (a year from the day
 *   of joining, then year by year); bought what the exchange gave, by year (perYear); entered the
 *   contest signed up for and its day; herbs the 沉钟泽 herbs handed in toward the next pill;
 *   assigned a duty the sect gave at the start (births.json), its id.
 *
 * The op sect { action, … } → { sect: view }:
 *   join     { sect, by: fair | token }: 开院会 (the fixed calendar event join.fair.calendar open
 *            today, the player at its place, age at most fair.maxAge, a root of fair.roots) or a
 *            听澜帖 from the bag (used up). The sect's join.status, the issued weapon into the bag.
 *            Receipt sect (action join)
 *   exchange { id }: an entry of the exchange list: the status it asks, its price in contribution,
 *            perYear; a catalogue good (rewards.grant) or a method written into table 1
 *   promote  the next step of the ladder when the realm and earned reach its promote entry
 *   enter    { contest: 小比 | 大比 }: signed up; the contest's next day on the calendar (own entry
 *            contest)
 *   view     the view
 * The verb contest (宗门比试, verbs.cjs plan): on that day (within its days) a string of bouts
 *   against fellow disciples, the engine's own (no model): each to the first down or `rounds`
 *   exchanges of blows (mechanics.strike, the player's totals with the active gear, both at full
 *   气血); stopped by the first loss; a day passes. The place by the bouts won (places), the prize
 *   the contribution of that place and rolls of the rewards table's 大比. Receipt sect (action
 *   contest, bouts, place, contribution, items; source verb)
 * The verb duty { id? } (verbs.cjs plan, install): a duty of the list (the assigned one, else the
 *   first), at the sect's map place when it has one: its days pass, its contribution is earned, the
 *   year's duty counts and the 门规责罚 clock (duty.clock) is cleared (clocks.react task). Receipt
 *   sect (action duty, source verb).
 * month(env, entered): the month step: the stipend of the status into the purse every month (one
 *   receipt sect, action stipend, in the advance's last month for all the months crossed), and the
 *   yearly duty: a year since `since` with fewer than perYear duties done starts the 门规责罚 clock
 *   (or puts it a step up), and the next year begins.
 * disciple(env) → whether the player belongs to a sect (or is written as a disciple): the secret
 *   realms that ask for one (realm.cjs). handIn(env, herbs, commands, owns) → { contribution, pills }
 *   or null: the 沉钟泽 herbs handed to the sect (realm.cjs out).
 * view(env) → null | { name, status, contribution, earned, stipend, place?, here, next?: { status,
 *   realm, earned, met }, duty: { done, need, since, assigned?, next: { id, title, days,
 *   contribution } }, exchange: [{ id, hall, name, price, status, off?, note? }], contests: [{ name,
 *   date, days, every, open?, entered? }], entered? }: place the sect's map place (its duties are
 *   done there; none for a sect without one) and here whether the player is there; duty.next the
 *   duty the verb duty would do; contests each contest's next day (this one's while it runs)
 * joining(env) → null in a sect, else how a loose cultivator gets in (the panel's 入门): { sects:
 *   [{ name, place? }], fair: { name, place, date?, open?, why? }, token: { name, have } }: the fair's
 *   next day (today's while it runs), why it would not take the player now (joinTerms' words), and
 *   whether a 听澜帖 is in the bag
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const gear = require('./gear.cjs');
const goods = require('./goods.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');

const SECTS = data('sects');
const LADDER = SECTS.ladder;
const DAY = clock.DAY_MINUTES;
const YEAR_DAYS = clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear;
const J = JSON.stringify;
const fill = (template, values) => chronicle.fill(template, values);
const rowName = row => plain(row?.['1']).split('|')[0];

const sectOf = env => (env.play?.sect && typeof env.play.sect === 'object' ? env.play.sect : null);
const rank = status => LADDER.indexOf(status);
const yearOf = env => Math.floor(clock.today(env) / YEAR_DAYS) + 1;
const atLeast = (have, need) => have.major > need.major || (have.major === need.major && (have.minor || 0) >= (need.minor || 0));

function disciple(env) {
  if (sectOf(env)) return true;
  const identity = plain(env.state['0']?.B1?.['2']).split('|').slice(1).join('|');
  return SECTS.bloodland.identity.some(word => identity.includes(word));
}

// ---------------------------------------------------------------- joining

function grantGood(env, name, commands, owns) {
  const good = goods.lookup(name);
  if (!good) return null;
  const made = require('./rewards.cjs').grant(env, [{ id: good.id, name: good.name, class: good.class, tier: good.tier, count: 1, unit: goods.unitOf(good), price: good.price }]);
  commands.push(...made.commands);
  for (const key of Object.keys(owns)) if (Array.isArray(owns[key]) && Array.isArray(made.owns[key])) owns[key].push(...made.owns[key]);
  if (made.owns.currency) owns.currency = true;
  return good.name;
}

const bagWith = (env, words) => Object.entries(env.state['1'] || {})
  .find(([id, row]) => row && !env.ctx.storedItemIds(env.state).has(id) && words.some(word => rowName(row).includes(word))
    && Number(env.ctx.itemStackCount(row['5'])) > 0) || null;

function joinTerms(env, name, by) {
  if (sectOf(env)) return { refused: `已是${sectOf(env).name}的人` };
  if (!Object.hasOwn(SECTS.sects, name)) return { refused: `没有「${name.slice(0, 10)}」这个宗门` };
  if (by === 'token') {
    const token = bagWith(env, SECTS.join.token);
    return token ? { token } : { refused: `行囊里没有${SECTS.join.token.join('、')}` };
  }
  const fair = SECTS.join.fair;
  const event = calendar.CALENDAR.fixed.find(each => each.id === fair.calendar);
  if (!calendar.openNow(env, fair.calendar)) return { refused: `${event.name}眼下没有开` };
  if (places.placeFacts(env).place !== event.place) return { refused: `要先到${event.place}` };
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const age = mechanics.numberIn(remarks['年龄']);
  if (age !== null && age > fair.maxAge) return { refused: `${event.name}只收${chronicle.numeral(fair.maxAge)}岁以下的` };
  const root = plain(remarks['灵根']);
  if (!fair.roots.some(kind => root.startsWith(kind))) return { refused: `灵根是${root || '没有'}，${event.name}上没人要` };
  return {};
}

async function join(env, args) {
  const name = plain(args.sect), by = plain(args.by) === 'token' ? 'token' : 'fair';
  const terms = joinTerms(env, name, by);
  if (terms.refused) return env.refuse(terms.refused);
  const commands = [], owns = ownsNothing();
  if (terms.token) {
    const [id, row] = terms.token;
    const count = env.ctx.itemStackCount(row['5']);
    commands.push(count > 1 ? `add(${J(id)},{"5":"${count - 1}"})` : `de(${J(id)})`);
    owns.items.push(id);
  }
  const issued = grantGood(env, SECTS.join.issued, commands, owns);
  const today = clock.dateKey(clock.today(env));
  env.play.sect = { name, status: SECTS.join.status, contribution: 0, earned: 0, joined: today, duty: { since: today, done: 0 }, bought: {}, herbs: 0 };
  await env.settle({ kind: 'sect', ok: true, source: 'engine', sect: { action: 'join', name, status: SECTS.join.status, by, ...(issued ? { issued } : {}) },
    commands: commands.join('\n'), owns, summary: `入${name}，做${SECTS.join.status}弟子` + (issued ? `；领到${issued}` : '') });
  return { sect: view(env) };
}

// ---------------------------------------------------------------- exchange, promotion

function boughtThisYear(env, sect, id) {
  const record = sect.bought?.[id];
  return record && record.year === yearOf(env) ? record.count : 0;
}

function exchangeTerms(env, sect, entry) {
  if (rank(sect.status) < rank(entry.status)) return `要${entry.status}以上才换得`;
  if (entry.perYear && boughtThisYear(env, sect, entry.id) >= entry.perYear) return `一年只换得${chronicle.numeral(entry.perYear)}次`;
  if (sect.contribution < entry.price) return `贡献不够：要${chronicle.count(entry.price)}，只有${chronicle.count(sect.contribution)}`;
  return null;
}

const nameOf = entry => entry.good || entry.item.name;

async function exchange(env, args) {
  const sect = sectOf(env);
  if (!sect) return env.refuse('不在宗门里');
  const entry = SECTS.exchange.find(each => each.id === plain(args.id));
  if (!entry) return env.refuse('兑换的单子上没有这一样');
  const why = exchangeTerms(env, sect, entry);
  if (why) return env.refuse(why);
  const commands = [], owns = ownsNothing();
  if (entry.good) grantGood(env, entry.good, commands, owns);
  else {
    const [id] = mechanics.nextItemIds(env, 1);
    commands.push(`set(${J({ 0: id, 1: entry.item.name, 2: '功法', 3: entry.item.description, 4: entry.item.effect, 5: '1', 6: entry.item.grade, 7: entry.item.cap })})`);
    owns.items.push(id);
  }
  const before = sect.contribution;
  sect.contribution -= entry.price;
  sect.bought = { ...(sect.bought || {}), [entry.id]: { year: yearOf(env), count: boughtThisYear(env, sect, entry.id) + 1 } };
  await env.settle({ kind: 'sect', ok: true, source: 'engine', sect: { action: 'exchange', id: entry.id, hall: entry.hall, name: nameOf(entry), price: entry.price,
    contribution: { before, after: sect.contribution } }, commands: commands.join('\n'), owns,
  summary: `在${entry.hall}用${chronicle.count(entry.price)}点贡献换${nameOf(entry)}；贡献 ${before}→${sect.contribution}` });
  return { sect: view(env) };
}

function nextStep(env, sect) {
  const status = LADDER[rank(sect.status) + 1];
  const need = status ? SECTS.promote[status] : null;
  if (!need) return null;
  const realm = mechanics.parseRealm(env.state['0']?.B1?.['2']);
  const met = atLeast(realm, mechanics.parseRealm(need.realm)) && sect.earned >= need.earned;
  return { status, realm: need.realm, earned: need.earned, met };
}

async function promote(env) {
  const sect = sectOf(env);
  if (!sect) return env.refuse('不在宗门里');
  const next = nextStep(env, sect);
  if (!next) return env.refuse(`${sect.status}已是最高`);
  if (!next.met) return env.refuse(`升${next.status}要${next.realm}、累计贡献${chronicle.count(next.earned)}`);
  const before = sect.status;
  sect.status = next.status;
  await env.settle({ kind: 'sect', ok: true, source: 'engine', sect: { action: 'promote', before, after: next.status }, commands: '', owns: ownsNothing(),
    summary: `在${sect.name}由${before}升为${next.status}` });
  return { sect: view(env) };
}

// ---------------------------------------------------------------- contests

// The contest's next day from today (this year's when it has not passed, else the next year it is held).
function contestDay(env, spec) {
  const today = clock.today(env);
  for (let year = yearOf(env); year < yearOf(env) + spec.every + 2; year += 1) {
    if ((year - 1) % spec.every) continue;
    const day = (year - 1) * YEAR_DAYS + (spec.month - 1) * clock.CALENDAR.daysPerMonth + spec.day - 1;
    if (day + spec.days > today) return day;
  }
  return null;
}

async function enter(env, args) {
  const sect = sectOf(env);
  if (!sect) return env.refuse('不在宗门里');
  const name = plain(args.contest);
  const spec = SECTS.contests[name];
  if (!spec) return env.refuse('没有这样的比试');
  if (sect.entered) return env.refuse(`已报了${sect.entered.contest}`);
  const day = contestDay(env, spec);
  const date = clock.dateKey(day);
  sect.entered = { contest: name, date };
  calendar.register(env, 'contest', { date, title: `${sect.name}${name}`, ...(SECTS.sects[sect.name].place ? { place: SECTS.sects[sect.name].place } : {}) });
  await env.settle({ kind: 'sect', ok: true, hidden: true, source: 'engine', sect: { action: 'enter', contest: name, date }, commands: '', owns: ownsNothing(),
    summary: `报名${sect.name}${name}，${clock.dateOf(day * DAY).text}开比` });
  return { sect: view(env) };
}

const full = stats => Object.fromEntries(Object.entries(stats).map(([stat, value]) => [stat, { current: mechanics.statValue(value, 'max'), max: mechanics.statValue(value, 'max') }]));
const share = stats => mechanics.statValue(stats['血量']) / Math.max(1, mechanics.statValue(stats['血量'], 'max'));

// One bout: both at full 气血, the faster first, blow for blow until one is down or `rounds` are out.
function bout(env, spec, seed, foe) {
  const player = mechanics.fighter(env, 'B1', '', '', '你', []);
  const me = { ...player, stats: full(player.stats) };
  const them = { ...foe, stats: full(foe.stats) };
  const swift = fighter => gear.totals(env, fighter.id, fighter.stats)['脚力'];
  const order = swift(me) >= swift(them) ? [me, them] : [them, me];
  let round = 0;
  for (; round < spec.rounds; round += 1) {
    for (let side = 0; side < 2; side += 1) {
      const [attacker, defender] = side ? [order[1], order[0]] : order;
      const struck = mechanics.strike({ ...env, seed: `${seed}:${round}:${side}` }, attacker, defender, { style: '物理', totals: gear.totals }, 0, 0);
      defender.stats = { ...defender.stats, 血量: { current: struck.hp.after, max: struck.hp.max } };
      if (struck.hp.after <= 0) return { won: defender !== me, rounds: round + 1, mine: mechanics.statValue(me.stats['血量']), theirs: mechanics.statValue(them.stats['血量']) };
    }
  }
  return { won: share(me.stats) >= share(them.stats), rounds: round, mine: mechanics.statValue(me.stats['血量']), theirs: mechanics.statValue(them.stats['血量']) };
}

// The verb contest (宗门比试): on the signed-up day (within its days) a string of bouts against
// fellow disciples, the engine's own (no model is asked): each to the first down or `rounds`
// exchanges of blows (mechanics.strike, the player's totals with the active gear, both at full
// 气血), stopped by the first loss. A day passes. The place by the bouts won, the prize that
// place's contribution and rolls of the rewards table's 大比. Past the days, it was missed.
function contest(env, verb, upTo = null) {
  const sect = sectOf(env);
  if (!sect?.entered) return { refused: '没有报名比试' };
  const spec = SECTS.contests[sect.entered.contest];
  const day = clock.dayOfDate(sect.entered.date), today = clock.today(env);
  if (today < day) return { refused: `${sect.entered.contest}${clock.dateOf(day * DAY).text}才开比` };
  const name = sect.entered.contest;
  const commands = [], owns = ownsNothing();
  const bouts = [];
  if (today < day + spec.days) {
    const base = `${env.archiveId || ''}:${sect.name}:${name}:${sect.entered.date}`;
    const c = mechanics.cultivator(env);
    const random = create(`${base}:对手`);
    for (let n = 1; n <= spec.bouts; n += 1) {
      const step = Math.max(1, Math.min(mechanics.stepsIn(c.major), c.step + Math.floor(random.random() * (2 * spec.spread + 1)) - spec.spread));
      const realm = mechanics.parseRealm(mechanics.stepName(c.major, step));
      const foeName = SECTS.names[Math.floor(random.random() * SECTS.names.length)];
      const foe = { id: `S${n}`, name: foeName, realm, stats: mechanics.baselineStats(realm, `${base}:${n}`) };
      const result = bout(env, spec, `${base}:${n}`, foe);
      bouts.push({ foe: { name: foeName, realm: realm.text }, ...result });
      if (!result.won) break;
    }
  }
  const wins = bouts.filter(each => each.won).length;
  const place = bouts.length ? spec.places[String(wins)] : null;
  const contribution = place ? spec.contribution[String(place)] || 0 : 0;
  const items = [];
  if (place) {
    const rewards = require('./rewards.cjs');
    for (let nth = 1; nth <= (spec.rolls[String(place)] || 0); nth += 1) {
      items.push(...rewards.roll(env, '大比', { tier: spec.tier, danger: 0, target: `${sect.name}·${name}`, nth }).items);
    }
    if (items.length) {
      const made = rewards.grant(env, items);
      commands.push(...made.commands);
      for (const key of Object.keys(owns)) if (Array.isArray(owns[key]) && Array.isArray(made.owns[key])) owns[key].push(...made.owns[key]);
      if (made.owns.currency) owns.currency = true;
    }
  }
  const minutes = bouts.length ? DAY : 0;
  const said = !bouts.length ? `误了${name}的日子` : `${name}比了${chronicle.numeral(bouts.length)}场，赢${chronicle.numeral(wins)}场，名列第${chronicle.numeral(place)}`;
  const now = mechanics.readClock(env.state);
  return {
    minutes,
    receipt: { kind: 'sect', ok: true, source: 'verb', sect: { action: 'contest', contest: name, bouts, place, contribution, items },
      commands: commands.join('\n'), owns, summary: '' },
    line: ['contest', { 宗: sect.name, 比: name, 果: said }],
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), lines: [`在${sect.name}参加${name}，打一串比试，不用问天。`], formula: [] },
    finish: receipt => {
      sect.contribution += contribution;
      sect.earned += contribution;
      delete sect.entered;
      const entry = list(env.play.calendar).find(each => each.kind === 'own' && each.type === 'contest');
      if (entry) calendar.remove(env, entry.id);
      receipt.summary = said + (contribution ? `；贡献 +${contribution}` : '') + (items.length ? `；得${goods.listed(items)}` : '')
        + (receipt.time ? `；时间 ${receipt.time.before}→${receipt.time.after}` : '');
    },
  };
}

// ---------------------------------------------------------------- the verb duty

function duty(env, verb, upTo = null) {
  const sect = sectOf(env);
  if (!sect) return { refused: '不在宗门里，没有差事' };
  const wanted = plain(verb.id) || sect.assigned || SECTS.duties[0].id;
  const task = SECTS.duties.find(each => each.id === wanted);
  if (!task) return { refused: '没有这件差事' };
  const home = SECTS.sects[sect.name]?.place;
  if (home && places.placeFacts(env).place !== home) return { refused: `差事要回${home}领` };
  const days = upTo === null ? task.days : Math.max(1, Math.min(task.days, Math.floor(upTo / DAY)));
  const minutes = days * DAY, span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `${task.title}${span}${overrun}` };
  const done = days >= task.days;
  const now = mechanics.readClock(env.state);
  return {
    minutes,
    receipt: { kind: 'sect', ok: true, source: 'verb', sect: { action: 'duty', id: task.id, title: task.title, days, done, contribution: done ? task.contribution : 0 },
      commands: '', owns: ownsNothing(), summary: '' },
    line: ['duty', { 宗: sect.name, 事: task.title, 时长: span }],
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), lines: [`在${sect.name}${task.title}${span}，${done ? `得贡献${chronicle.count(task.contribution)}` : '没办完，不算'}。`], formula: [] },
    finish: receipt => {
      if (done) {
        sect.contribution += task.contribution;
        sect.earned += task.contribution;
        sect.duty = { ...(sect.duty || { since: clock.dateKey(clock.today(env)) }), done: (Number(sect.duty?.done) || 0) + 1 };
        if (sect.assigned === task.id) delete sect.assigned;
        const cleared = clocks.react(env, { kind: 'task', task: SECTS.duty.task });
        if (cleared.length) receipt.clocks = cleared;
      }
      receipt.summary = `${task.title}${span}` + (done ? `：贡献 +${task.contribution}` : '：没办完') + `；时间 ${receipt.time.before}→${receipt.time.after}`;
    },
  };
}

// ---------------------------------------------------------------- the month

async function month(env, entered) {
  const sect = sectOf(env);
  if (!sect) return;
  const start = Math.floor(entered.minutes / DAY);
  const pay = SECTS.stipend[sect.status] || 0;
  if (pay > 0) env.sectPay = { months: (env.sectPay?.months || 0) + 1, stones: (env.sectPay?.stones || 0) + pay };
  // The year of duty from `since`: once it is over, fewer than perYear duties start the clock.
  const since = clock.dayOfDate(sect.duty?.since);
  const changes = [];
  if (since !== null && start - since >= YEAR_DAYS) {
    if ((Number(sect.duty.done) || 0) < SECTS.duty.perYear) {
      const spec = SECTS.duty.clock;
      const running = list(env.play.clocks).find(found => found.name === spec.name);
      if (running) {
        const change = clocks.bump(env, running.id, 1, '又一年没办宗门差事', entered.minutes - DAY);
        if (change) changes.push(change);
      } else {
        const started = clocks.start(env, { ...spec, scope: { kind: spec.scope, value: '' } }, '一年没办宗门差事', entered.minutes - DAY);
        if (started.clock) changes.push({ id: started.clock.id, name: spec.name, before: 0, after: started.clock.value, started: true });
      }
    }
    sect.duty = { since: clock.dateKey(since + YEAR_DAYS), done: 0 };
  }
  if (changes.length) env.sectClocks = [...(env.sectClocks || []), ...changes];
  if (!entered.last || (!env.sectPay && !env.sectClocks)) return;
  const paid = env.sectPay, moved = env.sectClocks;
  env.sectPay = null;
  env.sectClocks = null;
  const commands = [], owns = ownsNothing();
  let before = null;
  if (paid) {
    before = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
    commands.push(`add("B1",{"26":"${before + paid.stones}"})`);
    owns.currency = true;
  }
  await env.settle({ kind: 'sect', ok: true, hidden: true, source: 'engine', sect: { action: 'stipend', name: sect.name, status: sect.status,
    ...(paid ? { months: paid.months, stones: paid.stones } : {}), ...(moved ? { clocks: moved } : {}) },
  commands: commands.join('\n'), owns,
  summary: [paid ? `${sect.name}的月俸${chronicle.count(paid.months)}个月共${chronicle.count(paid.stones)}块灵石；灵石 ${before}→${before + paid.stones}` : '',
    moved ? '一年没办宗门差事，门规责罚的钟起来了' : ''].filter(Boolean).join('；') });
}

// ---------------------------------------------------------------- 沉钟泽's herbs

function handIn(env, herbs, commands, owns) {
  const sect = sectOf(env);
  if (!sect) return null;
  const rule = SECTS.bloodland;
  const count = herbs.reduce((sum, herb) => sum + herb.count, 0);
  if (!count) return null;
  const contribution = count * rule.perHerb;
  sect.contribution += contribution;
  sect.earned += contribution;
  const total = (Number(sect.herbs) || 0) + count;
  const pills = Math.floor(total / rule.pill.herbs);
  sect.herbs = total % rule.pill.herbs;
  for (let n = 0; n < pills; n += 1) grantGood(env, rule.pill.good, commands, owns);
  return { herbs: count, contribution, pills };
}

// ---------------------------------------------------------------- the view

// The contests as the panel shows them: each one's next day (this one's while it runs).
function contestsOf(env, sect) {
  const today = clock.today(env);
  return Object.entries(SECTS.contests).map(([name, spec]) => {
    const day = contestDay(env, spec);
    if (day === null) return null;
    return { name, date: clock.dateKey(day), days: spec.days, every: spec.every,
      ...(day <= today && today < day + spec.days ? { open: true } : {}), ...(sect.entered?.contest === name ? { entered: true } : {}) };
  }).filter(Boolean);
}

function view(env) {
  const sect = sectOf(env);
  if (!sect) return null;
  const next = nextStep(env, sect);
  const home = SECTS.sects[sect.name]?.place || null;
  const task = SECTS.duties.find(each => each.id === sect.assigned) || SECTS.duties[0];
  return {
    name: sect.name, status: sect.status, contribution: sect.contribution, earned: sect.earned, stipend: SECTS.stipend[sect.status] || 0,
    ...(home ? { place: home } : {}), here: !home || places.placeFacts(env).place === home,
    ...(next ? { next } : {}),
    duty: { done: Number(sect.duty?.done) || 0, need: SECTS.duty.perYear, since: sect.duty?.since || null, ...(sect.assigned ? { assigned: sect.assigned } : {}),
      next: { id: task.id, title: task.title, days: task.days, contribution: task.contribution } },
    contests: contestsOf(env, sect),
    exchange: SECTS.exchange.map(entry => {
      const why = exchangeTerms(env, sect, entry);
      return { id: entry.id, hall: entry.hall, name: nameOf(entry), price: entry.price, status: entry.status, ...(why ? { off: true, note: why } : {}) };
    }),
    ...(sect.entered ? { entered: sect.entered } : {}),
  };
}

// How a loose cultivator gets into a sect: the sects, 开院会 and 听澜帖 (the panel's 入门).
function joining(env) {
  if (sectOf(env)) return null;
  const fair = SECTS.join.fair;
  const event = calendar.CALENDAR.fixed.find(each => each.id === fair.calendar);
  const today = clock.today(env);
  const open = calendar.openNow(env, fair.calendar);
  const next = open || (today === null ? null : calendar.nextOpen(env, event, today));
  const terms = joinTerms(env, Object.keys(SECTS.sects)[0], 'fair');
  return {
    sects: Object.entries(SECTS.sects).map(([name, spec]) => ({ name, ...(spec.place ? { place: spec.place } : {}) })),
    fair: { name: event.name, place: event.place, ...(next ? { date: clock.dateKey(next.day) } : {}), ...(open ? { open: true } : {}),
      ...(terms.refused ? { why: terms.refused } : {}) },
    token: { name: SECTS.join.token[0], have: Boolean(bagWith(env, SECTS.join.token)) },
  };
}

async function op(env, args) {
  const action = plain(args.action);
  if (action === 'join') return join(env, args);
  if (action === 'exchange') return exchange(env, args);
  if (action === 'promote') return promote(env);
  if (action === 'enter') return enter(env, args);
  if (action === 'view') return { sect: view(env) };
  return env.refuse(`宗门没有「${action.slice(0, 10)}」这一项`);
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.duty = duty;
  verbs.VERBS.contest = contest;
}

module.exports = { SECTS, sectOf, disciple, handIn, view, joining, month, install, op, bout, contestDay };
