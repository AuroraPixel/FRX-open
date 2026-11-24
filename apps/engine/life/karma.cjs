'use strict';
/* 因果, 心结 and 心魔 (玩法设计第七节「心结」、第十一节「因果」; plan item 40). The rules and words
 * are content/life/karma.json.
 *
 * frxPlay.karma [{ id: "Y3", kind, who: { id, name }, what, back, year, date, due?, entry?, from,
 *   done?: { date, how? }, broken? }]: the ledger. kind 恩 (someone owes you), 怨 (someone hates
 *   you), 债 (you owe someone), 诺 (you promised: due its day, entry its calendar entry); from rule
 *   (the engine's own) or model (note_karma); done once settled, broken a 诺's day it lapsed.
 * frxPlay.knots [{ id: "J2", kind, who: { id, name }, what, year, date }]: the open heart knots.
 *   gate.cjs counts them: each −1 on the odds, −3 at most, less with a talent's knotCap.
 *
 * settle(env), after an op that may make an entry (watches(op): verb, act, scene, move, travel):
 *   恩  a card that saves someone (rules.rescue): rolled 成功 or 大成功, aimed at a person, a card
 *       kind of the rule's, its title with one of the rule's words and none of its not-words
 *   债  a 交涉 card that borrows (rules.loan), the same way
 *   怨  a card that takes from someone (rules.take), and a fight whose spoils came off a named person
 *       (the fight receipt's bags; named: a C or G row whose name the encounter tables do not give)
 *   and every 诺 past its day (its due before today): broken, and a 怨 with that person dated the
 *   day after its due; with their favour at promise.knot.favour or closer, a 失信 knot too.
 * op "karma", the model's note_karma: { kind, who, what, back?, days? } a new entry with a person
 *   present (their row in the character table, alive); a 诺 needs days, its day goes on the
 *   calendar (own type promise). { done: "Y3", how? } settles an open entry, its person present.
 * op "knot", the model's note_knot: { kind, who, what, name? } a new knot of the five kinds, its person
 *   present or just dead (dead on their row; on the scene when it opened and gone since; or dead
 *   within knots.recentDays by the people's book, frxPlay.people); name is theirs once their row is
 *   gone. { resolve: "J2", who, heir?, how? } the knot resolved in a scene (one must be on) with its
 *   person present,
 *   or, once they are dead, whoever stands for them (heir: true): 心境 through mind.knot, once a
 *   knot. Receipts { kind: karma | knot, action: note | done | resolve | broken, entry | knot }.
 * demons(env, gate) → { rolls: [{ knot, check }], penalty }: at the gates of demons.gates (结丹,
 *   元婴) each open knot is a 心魔, a check on demons.attribute at demons.tier on the timeline seed
 *   (type 心魔, target the knot's id); each failure takes demons.fail more off this attempt (gate.cjs
 *   adds it to the odds, the breakthrough receipt carries the rolls as demons).
 * view(env) → { karma: [{ id, kind, who, what, back, year, due?, done? }], knots: [{ id, kind, who,
 *   what, year }] }: the state view's play.karma and play.knots, the open entries first.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const mind = require('./mind.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('karma');
const FAVOUR = data('actions').favour;
const NAMELESS = new Set(Object.values(data('foes').encounters.who).flatMap(kind => list(kind.names)));
// A row's status that says the person is dead, as the people's month reads it (people.cjs).
const DEAD = /身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落/;
const KINDS = Object.keys(RULES.kinds);
const WON = new Set(['成功', '大成功']);
const YEAR_DAYS = clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear;

const cut = (value, most) => (typeof value === 'string' ? [...value.trim()].slice(0, most).join('') : '');
const rowName = row => plain(row?.['1']).split('|')[0];
const ledger = env => list(env.play?.karma);
// The heart knots, each an object (a bare string, as older data has it, is the deed alone).
const knotsOf = env => list(env.play?.knots).map((entry, n) => (entry && typeof entry === 'object' ? entry
  : { id: `J0${n + 1}`, kind: '', who: { id: '', name: '' }, what: String(entry ?? ''), year: null }));
const yearOf = day => Math.floor(day / YEAR_DAYS) + 1;
const said = (text, values) => chronicle.fill(text, values);
const tierRank = name => FAVOUR.tiers.findIndex(tier => tier.name === name);
const favourTier = value => {
  let found = FAVOUR.tiers[0];
  const number = Number(value);
  if (Number.isFinite(number)) for (const tier of FAVOUR.tiers) if (number >= tier.from) found = tier;
  return found.name;
};

// Someone on the scene: their row in the character table, alive.
function present(env, id) {
  const key = plain(id);
  const row = /^[CG]/.test(key) ? env.state['0']?.[key] : null;
  return row && !DEAD.test(plain(row['4'])) ? { id: key, name: rowName(row) || key } : null;
}

// Someone a knot may be about: present, or just dead.
function presentOrJustDead(env, id, name) {
  const key = plain(id);
  if (!/^[CG]/.test(key)) return null;
  const row = env.state['0']?.[key];
  if (row) return { id: key, name: rowName(row) || key, dead: DEAD.test(plain(row['4'])) };
  const person = env.play.people?.by?.[key];
  const died = clock.dayOfDate(person?.died), today = clock.today(env);
  const recent = died !== null && today !== null && today - died <= RULES.knots.recentDays;
  const opened = env.play.scene?.start?.favour;
  if (recent || (opened && Object.hasOwn(opened, key))) return { id: key, name: person?.name || cut(name, 20) || key, dead: true };
  return null;
}

// At most RULES.most entries: the earliest settled go first, then the earliest.
function trimmed(entries) {
  const kept = [...entries];
  while (kept.length > RULES.most) {
    const closed = kept.findIndex(entry => entry.done || entry.broken);
    kept.splice(closed >= 0 ? closed : 0, 1);
  }
  return kept;
}

// A new entry of the ledger, dated `day` (today by default).
function record(env, kind, who, what, { back, from = 'rule', day = clock.today(env), due } = {}) {
  const entry = { id: nextId(env, 'karma', 'Y'), kind, who: { id: who.id, name: who.name }, what: cut(what, RULES.whatMost),
    back: cut(back, RULES.backMost) || RULES.kinds[kind].back, year: yearOf(day), date: clock.dateKey(day), ...(due ? { due } : {}), from };
  env.play.karma = trimmed([...ledger(env), entry]);
  return entry;
}

function knot(env, kind, who, what, day = clock.today(env)) {
  const entry = { id: nextId(env, 'knot', 'J'), kind, who: { id: who.id, name: who.name }, what: cut(what, RULES.whatMost),
    year: yearOf(day), date: clock.dateKey(day), ...(who.dead ? { dead: true } : {}) };
  env.play.knots = [...knotsOf(env), entry];
  return entry;
}

const brief = entry => ({ id: entry.id, kind: entry.kind, who: entry.who, what: entry.what });

// ---------------------------------------------------------------- the engine's own entries

const WATCHED = new Set(['verb', 'act', 'scene', 'move', 'travel']);
const watches = op => WATCHED.has(op);

// The rule a card's receipt meets: a roll that came off, aimed at a person, the rule's card kind and
// words.
function cardRule(receipt) {
  if (receipt.kind !== 'act' || !receipt.ok || !WON.has(receipt.outcome)) return null;
  const card = receipt.card || {};
  if (card.object?.type !== 'person' || !card.object.id) return null;
  const title = plain(card.title);
  const found = Object.entries(RULES.rules).find(([name, rule]) => name !== 'spoils' && list(rule.cards).includes(card.kind)
    && list(rule.words).some(word => title.includes(word)) && !list(rule.not).some(word => title.includes(word)));
  return found ? { rule: found[1], who: { id: card.object.id, name: plain(card.object.name) || card.object.id }, title } : null;
}

// The named people a fight's spoils came off.
function robbed(env, receipt) {
  if (receipt.kind !== 'fight' || !receipt.ok) return [];
  return list(receipt.bags).flatMap(bag => {
    const id = plain(bag?.foe);
    const row = env.state['0']?.[id] || env.biographies?.[id];
    const name = rowName(row);
    return /^[CG]/.test(id) && name && !NAMELESS.has(name) ? [{ id, name }] : [];
  });
}

async function settle(env) {
  const today = clock.today(env);
  if (today === null) return;
  const made = [];
  for (const receipt of [...env.receipts]) {
    const met = cardRule(receipt);
    if (met) made.push(record(env, met.rule.kind, met.who, said(met.rule.what, { 卡: met.title, 名: met.who.name }), { back: met.rule.back }));
    for (const who of robbed(env, receipt)) {
      const rule = RULES.rules.spoils;
      made.push(record(env, rule.kind, who, said(rule.what, { 名: who.name }), { back: rule.back }));
    }
  }
  // 诺 past their day
  const broken = [], knotted = [];
  for (const entry of ledger(env)) {
    const due = clock.dayOfDate(entry.due);
    if (entry.kind !== '诺' || entry.done || entry.broken || due === null || due >= today) continue;
    const lapsed = due + 1;
    env.play.karma = ledger(env).map(each => (each.id === entry.id ? { ...each, broken: clock.dateKey(lapsed) } : each));
    if (entry.entry) calendar.remove(env, entry.entry);
    const what = said(RULES.promise.what, { 名: entry.who.name, 事: entry.what });
    broken.push({ promise: entry.id, entry: record(env, '怨', entry.who, what, { back: RULES.promise.back, day: lapsed }) });
    const row = env.state['0']?.[entry.who.id];
    if (row && tierRank(favourTier(plain(row['15']))) >= tierRank(RULES.promise.knot.favour)) {
      knotted.push(knot(env, RULES.promise.knot.kind, entry.who, what, lapsed));
    }
  }
  if (!made.length && !broken.length) return;
  const parts = [...made.map(entry => `${entry.kind}：${entry.who.name}，${entry.what}`),
    ...broken.map(each => `诺过期，${each.entry.what}`), ...knotted.map(each => `心结（${each.kind}）：${each.what}`)];
  for (const each of broken) chronicle.write(env, 'promiseBroken', { 名: each.entry.who.name });
  for (const each of knotted) chronicle.write(env, 'knot', { 事: each.what });
  await env.settle({ kind: 'karma', ok: true, source: 'engine', action: broken.length && !made.length ? 'broken' : 'note',
    entries: [...made, ...broken.map(each => each.entry)].map(brief), ...(knotted.length ? { knots: knotted.map(brief) } : {}),
    commands: '', owns: ownsNothing(), summary: `因果：${parts.join('；')}` });
}

// ---------------------------------------------------------------- the model's tools

async function karmaOp(env, args) {
  const refused = RULES.refused;
  const today = clock.today(env);
  if (today === null) return env.refuse('时间行里没有可识别的日期');
  if (args.done !== undefined && args.done !== null && args.done !== '') {
    const id = cut(String(args.done), 8);
    const entry = ledger(env).find(each => each.id === id);
    if (!entry) return env.refuse(said(refused.none, { 编号: id }));
    if (entry.done || entry.broken) return env.refuse(said(refused.closed, { 编号: id }));
    if (!present(env, entry.who.id)) return env.refuse(said(refused.who, { 人: entry.who.name }));
    const how = cut(args.how, RULES.whatMost);
    env.play.karma = ledger(env).map(each => (each.id === id ? { ...each, done: { date: clock.dateKey(today), ...(how ? { how } : {}) } } : each));
    if (entry.entry) calendar.remove(env, entry.entry);
    await env.settle({ kind: 'karma', ok: true, source: 'tool', action: 'done', entry: brief(entry), commands: '', owns: ownsNothing(),
      summary: `了结一笔${entry.kind}：${entry.who.name}，${entry.what}` + (how ? `（${how}）` : '') });
    return { entry: { id, done: true } };
  }
  const kind = plain(args.kind);
  if (!KINDS.includes(kind)) return env.refuse(refused.kind);
  const who = present(env, args.who);
  if (!who) return env.refuse(said(refused.who, { 人: plain(args.who) || '这个人' }));
  const what = cut(args.what, RULES.whatMost);
  if (!what) return env.refuse(refused.what);
  let due = null;
  if (kind === '诺') {
    const days = Number(args.days);
    if (!Number.isSafeInteger(days) || days < 1 || days > 10 * YEAR_DAYS) return env.refuse(refused.days);
    due = clock.dateKey(today + days);
  }
  const entry = record(env, kind, who, what, { back: args.back, from: 'model', due });
  if (due) {
    const marked = calendar.register(env, 'promise', { date: due, title: `答应${who.name}的事` });
    env.play.karma = ledger(env).map(each => (each.id === entry.id ? { ...each, entry: marked.id } : each));
  }
  await env.settle({ kind: 'karma', ok: true, source: 'tool', action: 'note', entry: brief(entry), commands: '', owns: ownsNothing(),
    summary: `记一笔${kind}：${who.name}，${entry.what}` + (due ? `，期限${clock.dateOf(clock.dayOfDate(due) * clock.DAY_MINUTES).text}` : '') });
  return { entry: { id: entry.id } };
}

async function knotOp(env, args) {
  const refused = RULES.refused;
  const today = clock.today(env);
  if (today === null) return env.refuse('时间行里没有可识别的日期');
  if (args.resolve !== undefined && args.resolve !== null && args.resolve !== '') {
    const id = cut(String(args.resolve), 8);
    const found = knotsOf(env).find(each => each.id === id);
    if (!found) return env.refuse(said(refused.noKnot, { 编号: id }));
    if (!env.play.scene) return env.refuse(refused.resolveScene);
    const there = present(env, args.who);
    const own = !!there && there.id === found.who.id;
    // whoever stands for them, once they are dead: dead on their row, in the people's book, or when
    // the knot was noted
    const row = env.state['0']?.[found.who.id];
    const dead = !!found.dead || (row && DEAD.test(plain(row['4']))) || !!env.play.people?.by?.[found.who.id]?.died;
    if (!own && !(args.heir === true && there && dead)) return env.refuse(refused.resolveWho);
    env.play.knots = knotsOf(env).filter(each => each.id !== id);
    const gained = mind.knot(env, id);
    const how = cut(args.how, RULES.whatMost);
    chronicle.write(env, 'unknot', { 事: found.what });
    await env.settle({ kind: 'knot', ok: true, source: 'tool', action: 'resolve', knot: brief(found), ...(gained.length ? { mind: gained } : {}),
      ...(own ? {} : { heir: { id: there.id, name: there.name } }), commands: '', owns: ownsNothing(),
      summary: `了结心结（${found.kind}）：${found.what}` + (how ? `（${how}）` : '') + (gained.length ? `；${mind.said(gained)}` : '') });
    return { knot: { id, resolved: true } };
  }
  const kind = plain(args.kind);
  if (!RULES.knots.kinds.includes(kind)) return env.refuse(refused.knotKind);
  const who = presentOrJustDead(env, args.who, args.name);
  if (!who) return env.refuse(said(refused.knotWho, { 人: plain(args.name) || plain(args.who) || '这个人' }));
  const what = cut(args.what, RULES.whatMost);
  if (!what) return env.refuse(refused.what);
  const made = knot(env, kind, who, what);
  chronicle.write(env, 'knot', { 事: made.what });
  await env.settle({ kind: 'knot', ok: true, source: 'tool', action: 'note', knot: brief(made), commands: '', owns: ownsNothing(),
    summary: `落下一桩心结（${kind}）：${who.name}，${made.what}` });
  return { knot: { id: made.id } };
}

// ---------------------------------------------------------------- 心魔

function demons(env, gate) {
  const rule = RULES.demons;
  if (!rule.gates.includes(gate)) return { rolls: [], penalty: 0 };
  const totals = mechanics.totalStats(env, 'B1', mechanics.readStats(env, 'B1'));
  const value = totals[rule.attribute] ?? 0;
  const modifier = rules.modifierFor(value);
  const dc = rules.RULES.tiers[rule.tier];
  const rolls = knotsOf(env).map(entry => {
    const dice = { kind: 'check', type: '心魔', target: entry.id };
    const roll = Math.floor(env.random(dice).random() * rules.RULES.die) + 1;
    const outcome = rules.checkOutcome(roll, roll + modifier, dc);
    return { knot: { ...brief(entry), year: entry.year ?? null, date: entry.date ?? null }, check: { kind: '心魔', rule: rule.attribute, tier: rule.tier, dc, die: rules.RULES.die, roll, attribute: rule.attribute,
      value, modifier, total: roll + modifier, outcome, target: { id: entry.who.id, name: entry.who.name }, seed: env.seedOf(dice),
      consequence: WON.has(outcome) ? '守住了心神' : `心魔缠身，这次冲关再减${chronicle.numeral(-rule.fail)}` } };
  });
  return { rolls, penalty: rolls.filter(each => !WON.has(each.check.outcome)).length * rule.fail };
}

// ---------------------------------------------------------------- the view

function view(env) {
  const shown = ledger(env).map(entry => ({ id: entry.id, kind: entry.kind, who: entry.who.name, what: entry.what, back: entry.back, year: entry.year,
    ...(entry.due ? { due: clock.dateOf(clock.dayOfDate(entry.due) * clock.DAY_MINUTES) } : {}),
    ...(entry.done ? { done: true } : {}), ...(entry.broken ? { broken: true } : {}) }));
  return {
    karma: [...shown.filter(entry => !entry.done && !entry.broken), ...shown.filter(entry => entry.done || entry.broken)],
    knots: knotsOf(env).filter(entry => RULES.knots.kinds.includes(entry.kind))
      .map(entry => ({ id: entry.id, kind: entry.kind, who: entry.who?.name || '', what: entry.what, year: entry.year })),
  };
}

module.exports = { RULES, watches, settle, karma: karmaOp, knot: knotOp, demons, view, present, presentOrJustDead };
