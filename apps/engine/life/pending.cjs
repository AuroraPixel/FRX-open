'use strict';
/* Pending events going off (待发生的事, 玩法设计第十一节「节奏」; plan items 15, 17, 30, 37 and 39,
 * and the first playtest's fixes). frxPlay.pending is filled by a clock that fills (a `now` event,
 * clocks.cjs), the director (any of content/life/pending.json's triggers, director.cjs), the people
 * (date, place, person; people.cjs), the world line (date, with `expires`; saga.cjs), 奇遇 (now;
 * rewards.cjs) and a capture in a fight (now; fight.cjs). An event goes off once its trigger holds
 * and opens a scene seeded from it; one past its `expires` day lapses with a chronicle line. The
 * words are content/life/pending.json (causes, origins, lapse) and chronicle.json (pendingFire,
 * pendingLapse).
 *
 * holds(env, hook) → whether its trigger holds now:
 *   now      always
 *   date     its day is today or before (a day ahead stops a stretch by itself: interrupt.forced)
 *   place    the player is there: the map place, the spot the time row writes, the region (云汀湾),
 *            or a place text the time row holds (潮岚道/云汀湾（泊灯城西市街口）holds 云汀湾 and 泊灯城西市)
 *   realm    the player's realm is that one or above (mechanics.parseRealm: major, then minor)
 *   clock    that clock of frxPlay.clocks (by id or name) is full
 *   person   someone of that id or name is on the scene (table 0)
 *   thread   that story thread of frxPlay.threads goes off by itself now (threads.holds: one with a
 *            time, the player at its place inside it): its event is the thread's (threads.cjs);
 *            it never lapses by its day, the thread runs out by the minute (threads.sweep)
 * due(env) → the event of frxPlay.pending that goes off now, or null: by the trigger kinds in the
 *   order of pending.json `order` (a `now` first), then in the list's order; lapsed ones never.
 * fire(env, hook, at?) → takes it out of frxPlay.pending, writes its line (pendingFire: the cause,
 *   which names what set it off) and returns what the scene opens from:
 *   { origin, cause, event: { kind: "pending", id, from, trigger, person? } }; origin by `from`
 *   (pending.json origins, a key of scene.json origins), cause by the trigger (pending.json causes).
 *   person { id, name }: a 故人 who is in the scene the event opens (presentOf): the people's events
 *   of pending.json present (来访, 求助 ...), while that person lives; the server opens the scene
 *   with them present (scene.cjs open { present }), back on the scene from their biography.
 * consume(env, id) takes one out without a line (a thread's event takes its thread with it);
 *   consumeNow(env, clockId) the `now` event a clock left, once its filling has stopped a stretch
 *   (the scene it opens is that event's). A thread's event that goes off says the thread's words
 *   (threads.fired: the cause, the thread, the person it is with) and takes the thread out.
 * lapse(env, before?) → the events whose `expires` day is before `before` (today when omitted)
 *   leave frxPlay.pending, a line each, dated the day after (pendingLapse: 事 the event's first
 *   words, 谁 who took the chance: a people event's person, else pending.json lapse.who by `from`).
 *   The threads past their time go first, with their events (threads.sweep).
 * ahead(env, kind, plan) → the preview's word that an event will take the verb's place, or null.
 *
 * The verbs (install, verbs.cjs hooks): a verb whose time would pass (plan.minutes > 0; not 冲关,
 * 悟得, 守拙) gives way, when it starts, to an event that goes off (接着办 not to the thread it takes
 * up): it is not done, and a receipt
 * `pending` (source engine) carries the interruption at its first moment (day 0), which the server
 * opens a scene from on item 16's path. A stretch that ran and was not broken off is broken at its
 * end by an event that went off during it (a clock's `now`, a 奇遇's clue, a realm reached, the
 * place a journey reached): its receipt carries the interruption, item 16's path again; not one
 * whose receipt carries a scene of its own already (拜访, 接着办). A stretch
 * broken off on a pending event's day, or by a clock filling, takes that event out. Lapses are
 * settled at both points.
 * The op "pending" { action: "fire", words? } → { fired: what fire returns | null }: the event that
 *   goes off for the scene the player's own words open (the server's before_story); its receipt
 *   `pending` is hidden and carries frxPlay. Words that carry on a live or under-way story thread
 *   (threads.carries: its person or its spot named) hold a `now` event back once (held: true;
 *   the owner typed 「送孙老道到落雁坡」 and got the chapter's reveal instead): it goes off at the
 *   next stretch, or at the next scene the player's words open after this one.
 * hooks.fired(env, day) runs when an event goes off (heartbeat.cjs counts the quiet days from it).
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const here = require('./here.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');
const threads = require('./threads.cjs');

const RULES = data('pending');
const hooks = { fired: () => {} };
const DAY = clock.DAY_MINUTES;
// The verbs that never give way to an event: a gate's attempt, a 悟得 taken, 守拙.
const STEADY = new Set(['breakthrough', 'perk', 'calm']);
// The people's events whose person is in the scene they open (来访, 求助 ...).
const PRESENT = new Set(RULES.present || []);
const DEAD = /身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落/;

const nameOf = row => plain(String(row?.['1'] ?? '')).split('|')[0].trim();
const today = env => clock.today(env);
const dayOf = text => clock.dayOfDate(text);
function expiresOn(hook) {
  const recorded = dayOf(hook?.expires);
  const window = hook?.from === 'saga' && require('./saga.cjs').invitation(hook);
  return window ? Math.min(window.last, recorded ?? window.last) : recorded;
}

const optional = hook => hook?.optional || (hook?.from === 'saga' && require('./saga.cjs').invitation(hook)?.optional);
const lapsedBy = (hook, day) => {
  const expires = expiresOn(hook);
  return expires !== null && day !== null && expires < day;
};

// ---------------------------------------------------------------- whether a trigger holds

function clockOf(env, value) {
  return list(env.play?.clocks).find(each => each?.id === value || each?.name === value) || null;
}

function personOf(env, value) {
  if (!value) return null;
  const rows = env.state['0'] || {};
  if (value !== 'B1' && rows[value]) return { id: value, name: nameOf(rows[value]) || value };
  const found = Object.entries(rows).find(([id, row]) => id !== 'B1' && row && nameOf(row) === value);
  return found ? { id: found[0], name: value } : null;
}

function atPlace(env, value) {
  if (!value) return false;
  const facts = places.placeFacts(env);
  const at = here.where(env);
  if ([facts.place, facts.spot, at.name, at.region].some(name => name && name === value)) return true;
  return [...value].length >= 2 && String(mechanics.placeOf(env.state) || '').includes(value);
}

function reached(env, value) {
  const target = mechanics.parseRealm(value);
  if (target.unknown) return false;
  const now = mechanics.parseRealm(env.state['0']?.B1?.['2']);
  return now.major > target.major || (now.major === target.major && now.minor >= target.minor);
}

function holds(env, hook) {
  const value = plain(String(hook?.trigger?.value ?? '')).trim();
  switch (hook?.trigger?.kind) {
    case 'now': return true;
    case 'date': {
      const day = dayOf(value), now = today(env);
      return day !== null && now !== null && day <= now;
    }
    case 'place': return atPlace(env, value);
    case 'realm': return reached(env, value);
    case 'clock': {
      const found = clockOf(env, value);
      return Boolean(found && Number(found.value) >= Number(found.size));
    }
    case 'person': return Boolean(personOf(env, value));
    case 'thread': return threads.holds(env, value);
    default: return false;
  }
}

// `skip`: the events that do not go off now: the one a verb takes up itself (接着办's thread), or
// those held back for the scene the player's words open (op), an id or a Set of them.
function due(env, skip = null) {
  const now = today(env);
  const skipped = hook => (skip instanceof Set ? skip.has(hook.id) : hook.id === skip);
  const open = list(env.play?.pending)
    .filter(hook => hook && typeof hook === 'object' && !lapsedBy(hook, now) && !(skip && skipped(hook))
      && !optional(hook));
  for (const kind of RULES.order) {
    const found = open.find(hook => hook.trigger?.kind === kind && holds(env, hook));
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------- going off and lapsing

// The cause as the annals and the scene's prompt say it: what set it off, then the event.
function causeOf(env, hook) {
  // the line and the template put their own stop after it
  const seed = String(hook.seed ?? '').trim().replace(/[。！？.!?；;，,\s]+$/, '');
  const value = plain(String(hook.trigger?.value ?? '')).trim();
  const kind = hook.trigger?.kind;
  const fill = (name, values) => chronicle.fill(RULES.causes[name], { 事: seed, ...values });
  if (kind === 'thread') return threads.causeFor(env, value) || fill('default', {});
  if ((kind === 'now' && hook.from === 'clock') || kind === 'clock') {
    const found = clockOf(env, value);
    if (found?.name) return fill('clock', { 钟: found.name });
  }
  if (kind === 'place' && value) return fill('place', { 地: value });
  if (kind === 'realm' && value) return fill('realm', { 境界: value });
  if (kind === 'person') return fill('person', { 人: personOf(env, value)?.name || value });
  return fill('default', {});
}

// The 故人 an event of the people brings into its scene: { id, name }, or null (not a people's
// event of pending.json present, nobody named, or dead by the people's book or the row).
function presentOf(env, hook) {
  if (hook?.from !== 'people' || !PRESENT.has(String(hook.event || ''))) return null;
  const id = String(hook.person || '');
  const row = env.state['0']?.[id] || env.biographies?.[id] || null;
  const kept = env.play?.people?.by?.[id] || null;
  if (!id || (!row && !kept) || kept?.alive === false || kept?.died || (row && DEAD.test(plain(row['4'])))) return null;
  return { id, name: nameOf(row) || plain(String(kept?.name || '')) || id };
}

function originOf(hook) {
  const origins = RULES.origins;
  if (hook.from === 'people' && origins.peopleEvents[hook.event]) return origins.peopleEvents[hook.event];
  return origins.from[hook.from] || origins.default;
}

function consume(env, id) {
  const hook = list(env.play.pending).find(each => each?.id === id);
  if (hook?.from === 'saga') require('./saga.cjs').opportunity(env, hook, 'presented');
  if (hook?.trigger?.kind === 'thread') threads.take(env, String(hook.trigger.value));
  env.play.pending = list(env.play.pending).filter(each => each?.id !== id);
}

function consumeNow(env, clockId) {
  env.play.pending = list(env.play.pending)
    .filter(each => !(each?.trigger?.kind === 'now' && each.from === 'clock' && each.trigger.value === clockId));
}

function fire(env, hook, at = mechanics.readClock(env.state)?.minutes) {
  // a story thread's: its words and the person it is with, and the thread goes with its event
  const thread = hook.trigger?.kind === 'thread' ? threads.fired(env, String(hook.trigger.value)) : null;
  const cause = thread?.cause || causeOf(env, hook);
  consume(env, hook.id);
  hooks.fired(env, Math.floor(at / DAY));
  chronicle.write(env, 'pendingFire', { 由头: cause }, at);
  const person = thread ? thread.person : presentOf(env, hook);
  return { origin: originOf(hook), cause,
    event: { kind: 'pending', id: hook.id, from: String(hook.from || ''), trigger: String(hook.trigger?.kind || ''),
      ...(thread ? { thread: thread.thread } : {}), ...(person ? { person } : {}) } };
}

// The event's first words, for a line: up to the first stop, at most lapse.words characters.
function firstWords(seed) {
  const text = String(seed ?? '').trim().split(/[，。；！？,;!?]/)[0] || String(seed ?? '').trim();
  return [...text].slice(0, RULES.lapse.words).join('');
}

function whoOf(env, hook) {
  if (hook.from === 'people') {
    const id = String(hook.person || '');
    const name = nameOf(env.state['0']?.[id]) || plain(String(env.play?.people?.by?.[id]?.name || ''));
    if (name) return name;
  }
  return RULES.lapse.who[hook.from] || RULES.lapse.who.default;
}

function lapse(env, before = today(env)) {
  if (before === null) return [];
  threads.sweep(env);
  const gone = list(env.play?.pending).filter(hook => lapsedBy(hook, before));
  if (!gone.length) return [];
  env.play.pending = list(env.play.pending).filter(hook => !gone.includes(hook));
  for (const hook of gone) {
    if (hook.from === 'saga') require('./saga.cjs').opportunity(env, hook, 'missed');
    chronicle.write(env, 'pendingLapse', { 事: firstWords(hook.seed), 谁: whoOf(env, hook) }, (expiresOn(hook) + 1) * DAY);
  }
  return gone;
}

// ---------------------------------------------------------------- the verbs and the op

const waiting = env => Boolean(env.play.scene || env.play.fight || env.play.encounter || list(env.play.offer).length);

// The event 接着办 takes up itself: its thread's, which it does not give way to.
const ownOf = (kind, plan) => (kind === 'follow' ? plan.receipt?.thread?.pending || null : null);

function ahead(env, kind, plan) {
  if (STEADY.has(kind) || !(plan.minutes > 0)) return null;
  const hook = due(env, ownOf(kind, plan));
  return hook ? chronicle.fill(RULES.ahead, { 由头: causeOf(env, hook) }) : null;
}

function install(verbs) {
  verbs.hooks.start = async (env, kind, plan) => {
    if (STEADY.has(kind) || !(plan.minutes > 0)) return false;
    lapse(env);
    const hook = due(env, ownOf(kind, plan));
    if (!hook) return false;
    const now = mechanics.readClock(env.state);
    const fired = fire(env, hook, now.minutes);
    await env.settle({ kind: 'pending', ok: true, source: 'engine', commands: '', owns: ownsNothing(),
      pending: { id: hook.id, from: fired.event.from, trigger: hook.trigger },
      interruption: { origin: fired.origin, cause: fired.cause, day: 0, date: clock.dateOf(now.minutes), minutes: 0, event: fired.event },
      summary: fired.cause });
    return true;
  };
  verbs.hooks.landed = async (env, kind, plan, broken) => {
    if (broken?.event?.kind === 'fixed') {
      require('./saga.cjs').sawOpening(env, broken.event.id, clock.dateKey(today(env)));
    }
    const taken = broken?.event?.kind === 'pending' ? broken.event.id : null;
    if (taken) consume(env, taken);
    if (broken?.origin === 'clock' && broken.clock?.id) consumeNow(env, broken.clock.id);
    lapse(env);
    // a verb whose receipt opens a scene of its own (拜访, 接着办) is not broken off at its end
    if (broken || STEADY.has(kind) || !(plan.minutes > 0) || waiting(env) || plan.receipt?.interruption) return;
    const hook = due(env);
    if (!hook) return;
    const now = mechanics.readClock(env.state);
    const fired = fire(env, hook, now.minutes);
    const date = clock.dateOf(now.minutes);
    plan.receipt.interruption = { origin: fired.origin, cause: fired.cause, day: Math.max(1, Math.ceil(plan.minutes / DAY)),
      date, minutes: plan.minutes, event: fired.event };
    plan.receipt.summary += `；${date.text}：${fired.cause}`;
  };
  verbs.hooks.ahead = ahead;
}

async function op(env, args) {
  if (String(args?.action ?? '') !== 'fire') return env.refuse('待发生的事只能 fire');
  if (waiting(env)) return { fired: null };
  // Sweeping can remove a completed thread whose pending event was already consumed.
  const pendingState = () => JSON.stringify([env.play.pending, env.play.threads]);
  const before = pendingState();
  lapse(env);
  // the player's words carry on a story thread: a `now` event not held before waits this once
  const held = new Set();
  if (threads.carries(env, args.words)) {
    env.play.pending = list(env.play.pending).map(each => {
      if (each?.trigger?.kind !== 'now' || each.held) return each;
      held.add(each.id);
      return { ...each, held: true };
    });
  }
  const hook = due(env, held);
  const fired = hook ? fire(env, hook) : null;
  if (pendingState() !== before) {
    await env.settle({ kind: 'pending', ok: true, hidden: true, source: 'engine', commands: '', owns: ownsNothing(),
      ...(hook ? { pending: { id: hook.id, from: fired.event.from, trigger: hook.trigger } } : {}),
      summary: fired ? fired.cause : held.size ? '待发生的事等这场戏过去' : '过期的待发生的事作罢' });
  }
  return { fired };
}

module.exports = { RULES, STEADY, PRESENT, hooks, holds, due, fire, consume, consumeNow, lapse, ahead, install, op, causeOf, originOf,
  presentOf, lapsedBy, optional, waiting, nameOf };
