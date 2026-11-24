'use strict';
/* 拜访 (玩法设计第四节, a standing verb; the owner's ask for more ways to go after the story): visit a
 * known person at this map place, a 时辰 or more, and a scene opens with origin visit. The rules and
 * words are content/life/visit.json.
 *
 * visitable(env) → [{ id, name, tie?, favour?, motive?, goal? }]: who may be visited here, by id:
 *   anyone alive in the character table whose location (column 16's third part) is at this map
 *   place (places.factsOf), and the player's ties (frxPlay.ties) alive in the people's book
 *   (frxPlay.people) at this map place. motive and goal are the table's columns 12 and 27.
 * listed(env) → the view's row (chained onto verbs.hooks.more): { kind: visit, glyph, label, options:
 *   [{ value: id, label: name }] } where someone not yet visited this month is here, none where
 *   nobody is; off with the reason when the verbs cannot be done now, or when everyone here has been
 *   visited this month.
 * The verb visit { id } (verbs.VERBS.visit): refused when that id is nobody visitable here, or was
 *   visited this month (frxPlay.visits { <id>: "0001-03" }). `minutes` pass, an annals line is
 *   written, and the receipt carries interruption { origin: visit, cause (seed: the tie, the motive
 *   and the goal), day: 1, date, minutes, visit: { id, name, tie, motive?, goal? } }: the server
 *   opens the scene from it as from a stretch of days broken off (item 16), the model writing the
 *   first beat from the visit. Cut short by a real interruption on the way, nobody is visited.
 *   Receipt { kind: "visit", ok, source: "verb", visit: { id, name, tie }, time, ... }.
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { ownsNothing } = require('./play.cjs');

const RULES = data('visit');
const FAVOUR = data('actions').favour;
// A row's status that says the person is dead, as the people's month reads it (people.cjs).
const DEAD = /身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落/;

const fill = (text, values) => chronicle.fill(text, values);
const cut = (value, most = 40) => [...plain(value ?? '').trim()].slice(0, most).join('');
const rowName = row => plain(row?.['1']).split('|')[0];
const placeText = row => plain(row?.['16']).split('|')[2]?.trim() || '';
const favourTier = value => {
  let found = FAVOUR.tiers[0];
  const number = Number(value);
  if (Number.isFinite(number)) for (const tier of FAVOUR.tiers) if (number >= tier.from) found = tier;
  return found.name;
};
const monthOf = env => clock.monthKey(clock.monthOf(mechanics.readClock(env.state).minutes));
const visited = (env, id) => (env.play?.visits && typeof env.play.visits === 'object' ? env.play.visits[id] : null);

function visitable(env) {
  const here = places.placeFacts(env).place;
  if (!here) return [];
  const at = text => !!text && places.factsOf(text, env.worldMap).place === here;
  const ties = env.play?.ties && typeof env.play.ties === 'object' ? env.play.ties : {};
  const found = new Map();
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    if (!/^[CG]/.test(id) || !row || DEAD.test(plain(row['4'])) || !at(placeText(row))) continue;
    found.set(id, { id, name: rowName(row) || id, tie: ties[id]?.kind || null, favour: favourTier(plain(row['15'])),
      ...(cut(row['12']) ? { motive: cut(row['12']) } : {}), ...(cut(row['27']) ? { goal: cut(row['27']) } : {}) });
  }
  for (const [id, tie] of Object.entries(ties)) {
    const person = env.play.people?.by?.[id];
    if (found.has(id) || !person || person.died || !at(person.place)) continue;
    found.set(id, { id, name: person.name || id, tie: tie?.kind || null });
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function listed(env) {
  const people = visitable(env);
  if (!people.length || !mechanics.readClock(env.state)) return [];
  const month = monthOf(env);
  const open = people.filter(each => visited(env, each.id) !== month);
  const blocked = require('./rewards.cjs').blockedFor(env, RULES.label);
  const why = blocked || (open.length ? null : '这里的熟人这个月都拜访过了');
  return [{ kind: 'visit', glyph: RULES.glyph, label: RULES.label, ...(why ? { note: why } : {}),
    ...(open.length ? { options: open.map(each => ({ value: each.id, label: each.name })) } : {}) }];
}

function visit(env, verb, upTo = null) {
  const now = mechanics.readClock(env.state);
  if (!now) return { refused: '时间行里没有可识别的日期，无法拜访' };
  const id = plain(verb.id ?? '');
  if (!id) return { refused: RULES.refused.id };
  const who = visitable(env).find(each => each.id === id);
  if (!who) return { refused: fill(RULES.refused.who, { 人: id }) };
  const month = monthOf(env);
  if (visited(env, id) === month) return { refused: fill(RULES.refused.month, { 人: who.name }) };
  const minutes = RULES.minutes;
  // a real interruption on the way cuts the visit short: nobody is visited
  const short = upTo !== null && upTo < minutes;
  const place = places.placeFacts(env).place;
  const relation = who.tie || who.favour || '相识';
  const seed = fill(RULES.seed, { 名: who.name, 关系: relation })
    + (who.motive ? fill(RULES.motive, { 名: who.name, 动机: who.motive }) : '')
    + (who.goal ? fill(RULES.goal, { 目标: who.goal }) : '');
  const shown = { id, name: who.name, tie: who.tie || null };
  const receipt = { kind: 'visit', ok: true, source: 'verb', visit: shown, commands: '', owns: ownsNothing(), summary: '' };
  return {
    minutes: short ? upTo : minutes, receipt,
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), formula: [],
      lines: [`去拜访${who.name}（${relation}），${chronicle.spanText(minutes)}，见了面开一场戏。`] },
    line: ['visit', { 地点: place, 名: who.name }],
    finish: settled => {
      if (short) {
        settled.summary = `去拜访${who.name}，半路上出了事；时间 ${settled.time.before}→${settled.time.after}`;
        return;
      }
      env.play.visits = { ...(env.play.visits && typeof env.play.visits === 'object' ? env.play.visits : {}), [id]: month };
      settled.interruption = { origin: 'visit', cause: seed, day: 1, date: clock.dateOf(mechanics.readClock(env.state).minutes), minutes,
        visit: { ...shown, ...(who.motive ? { motive: who.motive } : {}), ...(who.goal ? { goal: who.goal } : {}) } };
      settled.summary = `拜访${who.name}：${seed}；时间 ${settled.time.before}→${settled.time.after}`;
    },
  };
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.visit = visit;
  const before = verbs.hooks.more;
  verbs.hooks.more = env => [...before(env), ...listed(env)];
}

module.exports = { RULES, visitable, listed, install, visit };
