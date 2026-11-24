'use strict';
/* The director's plan for a save in the cultivation-life play (plan item 17, engine side):
 * WRITE_PLAN_LIFE adds clocks, dated events and pending events to WRITE_PLAN, and none of it
 * reaches frxPlay before the engine checked it here. The op "director" takes them as args:
 *   clocks   [{ name, scope: { kind: place | region | self, value }, size, value (起于几格),
 *            rises: [{ kind, days?, item?, steps? }], falls: [{ kind, days?, item?, stones?,
 *            person?, task?, steps?, clear? }], full (满了发生什么) }]: the vocabulary of
 *            content/life/clocks.json; a clock with any rule outside it is dropped whole, and no
 *            more than its limit run at once (clocks.check, clocks.start)
 *   dated    [{ date: "0001-03-15", title, place?, note? }]: into the calendar as kind director,
 *            today or later (calendar.schedule)
 *   pending  [{ trigger: { kind, value }, seed, expires? }]: kind one of content/life/
 *            pending.json's triggers (date: a date, place: a place, realm: a realm, clock: a clock
 *            by id or name, person: a person by id or name), seed one sentence, expires a date to
 *            come; no more than its limit hung by the director at once
 *   chapter  the id of the storyline chapter the run judged done: 心境 for it, once (mind.chapter,
 *            plan item 36); and, when the method worn cannot reach the next gate, the main line
 *            gives one that can (methods.gift: the numeric balance after plan item 50)
 *   leads    [{ id: "F3", line, where? }]: the player-facing line of a numbered thread and where to
 *            look (plan item 26), written in the chapter leadChapter (its title leadTitle); resolved
 *            the threads the run resolved: their leads come out proven by the story (leads.take)
 * Before taking anything, the run itself is a director run: clocks that rise by one take a step.
 * Returns { taken: { clocks, dated, pending, leads } (the ids made), dropped: [{ kind, name, reason }],
 * mind: the 心境 gains } and settles one receipt of kind "director" when frxPlay changed.
 *
 * markDue(env, month): the month step after the calendar's (month.cjs). A month in which the
 *   clocks moved or the calendar wrote a line leaves frxPlay.directorDue at that month ("0001-03"):
 *   the server runs the director after the first scene that closes from then on, and clears the key
 *   when it writes the run's frxPlay (card_director, plan item 17).
 */
const mechanics = require('../mechanics.cjs');
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const calendar = require('./calendar.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');
const mind = require('./mind.cjs');
const leads = require('./leads.cjs');
const methods = require('./methods.cjs');

const PENDING = data('pending');
const text = (value, most) => (typeof value === 'string' ? value.trim().slice(0, most) : '');

// A trigger's value as frxPlay keeps it, or why it is not one.
function triggerValue(env, kind, raw) {
  const value = text(raw, 30);
  if (!value) return { reason: '由头没有写明' };
  if (kind === 'date') {
    const day = clock.dayOfDate(value);
    if (day === null) return { reason: `日子要写成0001-03-15这样（${value}）` };
    return day < clock.today(env) ? { reason: `${value}已经过了` } : { value: clock.dateKey(day) };
  }
  if (kind === 'realm') return mechanics.parseRealm(value).unknown ? { reason: `认不出境界「${value}」` } : { value };
  if (kind === 'clock') {
    const found = list(env.play.clocks).find(each => each.id === value || each.name === value);
    return found ? { value: found.id } : { reason: `没有「${value}」这口钟` };
  }
  return { value };
}

function hang(env, item) {
  const seed = text(item?.seed, 120);
  const kind = text(item?.trigger?.kind, 10);
  if (!seed) return { refused: '待发生的事没有写种子' };
  if (!Object.hasOwn(PENDING.triggers, kind)) return { refused: `由头只认：${Object.values(PENDING.triggers).join('、')}` };
  const hung = list(env.play.pending).filter(each => each.from === 'director').length;
  if (hung >= PENDING.limit) return { refused: `待发生的事已有${PENDING.limit}件` };
  const trigger = triggerValue(env, kind, item.trigger.value);
  if (trigger.reason) return { refused: trigger.reason };
  let expires = null;
  if (item.expires !== undefined && item.expires !== null && item.expires !== '') {
    const day = clock.dayOfDate(item.expires);
    if (day === null || day <= clock.today(env)) return { refused: `过期的日子要是以后的一天（${text(item.expires, 20)}）` };
    expires = clock.dateKey(day);
  }
  const pending = { id: nextId(env, 'pending', 'P'), trigger: { kind, value: trigger.value }, seed, from: 'director',
    since: clock.dateKey(clock.today(env)), ...(expires ? { expires } : {}) };
  env.play.pending = [...list(env.play.pending), pending];
  return { pending };
}

async function director(env, args) {
  const before = JSON.stringify(env.play);
  const taken = { clocks: [], dated: [], pending: [], leads: [] }, dropped = [];
  const moved = clocks.react(env, { kind: 'director' });
  for (const spec of list(args.clocks)) {
    const started = clocks.start(env, { ...spec, from: 'director' });
    if (started.clock) taken.clocks.push(started.clock.id);
    else dropped.push({ kind: 'clock', name: text(spec?.name, 12), reason: started.refused });
  }
  for (const item of list(args.dated)) {
    const scheduled = calendar.schedule(env, item);
    if (scheduled.entry) taken.dated.push(scheduled.entry.id);
    else dropped.push({ kind: 'dated', name: text(item?.title, 20), reason: scheduled.refused });
  }
  for (const item of list(args.pending)) {
    const hung = hang(env, item);
    if (hung.pending) taken.pending.push(hung.pending.id);
    else dropped.push({ kind: 'pending', name: text(item?.seed, 20), reason: hung.refused });
  }
  const minded = typeof args.chapter === 'string' && args.chapter ? mind.chapter(env, args.chapter.slice(0, 20)) : [];
  // a chapter done while the cap stops the next gate: the main line's 机缘 is the method that reaches it
  if (minded.length) await methods.gift(env);
  const led = leads.take(env, { leads: args.leads, chapter: args.leadChapter, title: args.leadTitle, resolved: args.resolved });
  taken.leads.push(...led.taken);
  dropped.push(...led.dropped);
  if (JSON.stringify(env.play) !== before) {
    const said = [...moved.map(change => `${change.name}${change.after > change.before ? '涨' : '退'}到${change.after}格`),
      ...taken.clocks.map(id => `起钟「${list(env.play.clocks).find(each => each.id === id).name}」`),
      ...(taken.dated.length ? [`排了${taken.dated.length}件带日期的事`] : []),
      ...(taken.pending.length ? [`挂了${taken.pending.length}件待发生的事`] : []),
      ...(taken.leads.length ? [`记下${taken.leads.length}条疑点`] : []),
      ...led.reveals.map(hook => `挂上揭晓的戏（${hook.id}）`),
      ...(minded.length ? [mind.said(minded)] : [])];
    await env.settle({ kind: 'director', ok: true, source: 'engine', commands: '', owns: ownsNothing(),
      summary: `导演：${said.join('；') || '无'}` + (dropped.length ? `；未收${dropped.length}样` : '') });
  }
  return { taken, dropped, mind: minded };
}

// The lines a month's own steps write when something happened in it: the calendar's, the clocks',
// the people's.
const EVENTFUL = new Set(['calendar', 'clockStart', 'clockUp', 'clockDown', 'clockFull', 'clockGone', 'personRise', 'personDeath', 'personFeud', 'personGate', 'saga', 'homeLost']);

// The last of the month's steps: it reads the lines the steps before it wrote. The calendar dates
// its lines inside the month that ended, the clocks theirs on the first day of the month entered.
function markDue(env, month) {
  const [year, number] = month.previous.split('-').map(Number);
  const settled = date => (date?.year === year && date?.month === number)
    || (date?.year === month.year && date?.month === month.month && date?.day === 1);
  if (list(env.chronicle).some(line => EVENTFUL.has(line.kind) && settled(line.date))) env.play.directorDue = month.previous;
}

module.exports = { director, markDue };
