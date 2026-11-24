'use strict';
/* 打探 (玩法设计第四节; plan item 35): the verb ask { by? }, half a day in a 茶肆, a 坊市 or a 宗门
 * (verbs.json where.ask). The rules are content/life/ask.json.
 *
 * The check: `by` (探查 or 交涉) or, without it, the one of the file's checks with the better
 *   modifier, at the file's tier, rolled on the timeline seed (check type 打探, target the place):
 *   turn-rules' checkOutcome. How many clues: the file's clues by the outcome (失败 1, 成功 2,
 *   大成功 3).
 * candidates(env) → the clues the player does not know yet, each { key, kind, text }, from five
 *   places: the world line's rumours (saga.rumours, plan item 39: a great event's rumour texts
 *   before it and its aftermath's after it, kind rumour); the director's pending events
 *   (frxPlay.pending from the director, a trigger other than now); the calendar within `days`
 *   (calendar.ahead: fixed and the director's); this area's foe tables (foes.json encounters for
 *   the kinds of the nearest `near` map places, one who each, its name drawn); this area's shops'
 *   rare goods (of those places with a shop, the dearest of its list when its base is `rare` or
 *   more).
 * The clues are drawn from the candidates on the roll's own stream, the world line's rumours first
 *   (they are what the teahouses talk of: the 传闻 stage reaches whoever asks), written into
 *   frxPlay.clues ({ id: "L3", key, kind, text, date }) and said by the file's lines; no model is
 *   asked.
 * Receipt { kind: "ask", ok, source: "verb", check: { kind: 打探, rule, tier, dc, die, roll, attribute,
 *   value, modifier, total, outcome, consequence }, clues: [{ id, kind, text }], commands, owns,
 *   summary }; the clock moves `minutes`. preview(…) gives the chance and the counts, never the roll.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const clock = require('./clock.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const travel = require('./travel.cjs');
const trade = require('./trade.cjs');
const saga = require('./saga.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('ask');
const FOES = data('foes').encounters;
const CHECKS = { ...rules.RULES.kinds, ...data('checks').kinds };
const OUTCOMES = ['大成功', '成功', '失败', '大失败'];

const known = env => new Set(list(env.play?.clues).map(clue => clue.key));

function candidates(env) {
  const seen = known(env), found = [];
  const add = (key, kind, text, origin) => {
    if (!seen.has(key)) found.push({ key, kind, text, ...(origin ? { origin } : {}) });
  };
  for (const heard of saga.rumours(env)) {
    add(`rumour:${heard.event}:${heard.stage}:${heard.since}:${heard.text}`, 'rumour', chronicle.fill(RULES.lines.rumour, { 事: heard.text }),
      { event: heard.event, at: heard.at, stage: heard.stage, since: heard.since });
  }
  for (const hook of list(env.play?.pending)) {
    if (hook?.from !== 'director' || hook.trigger?.kind === 'now' || !hook.seed) continue;
    add(`pending:${hook.id}`, 'pending', chronicle.fill(RULES.lines.pending, { 事: hook.seed }));
  }
  for (const entry of calendar.ahead(env)) {
    if (entry.kind === 'own' || entry.days > RULES.days) continue;
    add(`calendar:${entry.id}:${entry.date.text}`, 'calendar', chronicle.fill(RULES.lines.calendar, { 日: entry.date.text, 地: entry.place || '', 事: entry.title }));
  }
  const near = travel.near(env, RULES.near);
  for (const place of near) {
    const table = FOES.tables[place.kind];
    if (!Array.isArray(table) || !table.length) continue;
    const pick = env.random({ kind: 'check', type: '打探·对手', target: place.name }).random();
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let at = pick * total, entry = table[0];
    for (const each of table) { at -= each.weight; if (at < 0) { entry = each; break; } }
    const names = FOES.who[entry.who]?.names || [entry.who];
    const name = names[Math.floor(pick * 997) % names.length];
    add(`foe:${place.name}:${entry.who}`, 'foe', chronicle.fill(RULES.lines.foe, { 地: place.name, 名: name }));
  }
  for (const place of near) {
    if (!trade.openAt(env, place.name)) continue;
    const dearest = trade.shopOf(env, place.name).goods.reduce((best, good) => (!best || good.price > best.price ? good : best), null);
    if (dearest && dearest.price >= RULES.rare) {
      add(`goods:${place.name}:${dearest.id}`, 'goods', chronicle.fill(RULES.lines.goods, { 地: place.name, 货: dearest.name }));
    }
  }
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

// The check the ask rolls: `by`, or the better of the file's.
function checkOf(env, by) {
  const totals = mechanics.totalStats(env, 'B1', mechanics.readStats(env, 'B1'));
  const options = RULES.checks.map(kind => {
    const attribute = CHECKS[kind].attribute, value = totals[attribute] ?? 0;
    return { kind, attribute, value, modifier: rules.modifierFor(value) };
  });
  if (by) return options.find(option => option.kind === by) || null;
  return options.reduce((best, option) => (option.modifier > best.modifier ? option : best));
}

function ask(env, verb) {
  const now = mechanics.readClock(env.state);
  if (!now) return { refused: '时间行里没有可识别的日期，无法打探' };
  const by = typeof verb.by === 'string' && verb.by ? verb.by : null;
  const check = checkOf(env, by);
  if (!check) return { refused: `打探只用${RULES.checks.join('或')}` };
  const place = places.placeFacts(env).place || chronicle.placeName(env.state) || '这里';
  const dc = rules.RULES.tiers[RULES.tier];
  const stream = env.random({ kind: 'check', type: '打探', target: place });
  const roll = Math.floor(stream.random() * rules.RULES.die) + 1;
  const outcome = rules.checkOutcome(roll, roll + check.modifier, dc);
  const pool = candidates(env);
  const shuffled = some => {
    for (let i = some.length - 1; i > 0; i -= 1) {
      const j = Math.floor(stream.random() * (i + 1));
      [some[i], some[j]] = [some[j], some[i]];
    }
    return some;
  };
  // the world line's rumours first, then the rest
  const got = [...shuffled(pool.filter(clue => clue.kind === 'rumour')), ...shuffled(pool.filter(clue => clue.kind !== 'rumour'))]
    .slice(0, RULES.clues[outcome]);
  const faces = Object.fromEntries(OUTCOMES.map(each => [each, 0]));
  for (let face = 1; face <= rules.RULES.die; face += 1) faces[rules.checkOutcome(face, face + check.modifier, dc)] += 1;
  const odds = Math.round(100 * (faces['大成功'] + faces['成功']) / rules.RULES.die);
  const minutes = RULES.minutes;
  const receipt = {
    kind: 'ask', ok: true, source: 'verb',
    check: { kind: '打探', rule: check.kind, tier: RULES.tier, dc, die: rules.RULES.die, roll, attribute: check.attribute, value: check.value,
      modifier: check.modifier, total: roll + check.modifier, outcome, consequence: `得${chronicle.numeral(got.length)}条线索` },
    clues: [], commands: '', owns: ownsNothing(), summary: '',
  };
  const counts = OUTCOMES.filter(each => each !== '大失败').map(each => `${each}${chronicle.count(RULES.clues[each])}条`).join('，');
  return {
    minutes, receipt,
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), formula: [],
      lines: [`在${place}打探消息，${chronicle.spanText(minutes)}。${check.kind}检定（${RULES.tier}），成算${odds}%：${counts}。`,
        pool.length ? `这一带还有${chronicle.numeral(pool.length)}条消息可打听。` : '这一带能打听的都已知道了。'] },
    line: ['ask', { 地点: place, 条: chronicle.numeral(got.length) }],
    finish: settled => {
      const date = clock.dateKey(clock.today(env));
      const clues = got.map(clue => ({ id: nextId(env, 'clue', 'L'), ...clue, date }));
      env.play.clues = [...list(env.play.clues), ...clues];
      settled.clues = clues.map(({ id, kind, text }) => ({ id, kind, text }));
      settled.summary = `打探（${check.kind}${outcome}）：${clues.length ? `得${chronicle.count(clues.length)}条线索` : '没有打听到新的'}；时间 ${settled.time.before}→${settled.time.after}`;
    },
  };
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.ask = ask;
}

module.exports = { RULES, candidates, install, ask };
