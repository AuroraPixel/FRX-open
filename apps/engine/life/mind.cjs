'use strict';
/* 心境 (阅历, 玩法设计第七节「心境」; plan item 36): frxPlay.mind, a number that only rises. It keeps
 * the player going out: below the current major realm's threshold cultivating is halved, and below
 * the next gate's the gate is shut (gate.cjs). The numbers are content/life/gates.json's `mind` and
 * each gate's `mind` threshold (炼气 0, 筑基 30, 结丹 100, 元婴 300, 化神 800).
 *
 * value(env) → the player's 心境 (0 before any).
 * need(realm) → the 心境 a major realm asks (its gate's mind; 0 for 凡人 and past the gates).
 * factor(env, c?) → { factor, have, need, realm }: cultivating's 心境 term, `half` below the current
 *   major realm's threshold, else 1 (c is mechanics.cultivator(env) when the caller has it).
 * view(env) → { value, text, now?: { realm, need, met }, next?: { realm, need, met } }: the state
 *   view's mind; text is the character panel's line 「阅历 62 · 筑基要 30，已到 · 结丹要 100」.
 * gain(env, amount, why) → { before, after, change, why } or null: raises it; never lowers it.
 * The sources, each through gain (frxPlay.minded keeps what has given already, so each gives once):
 *   closed(env, weight)        a scene closed: by its weight (小 2, 中 5, 大 12), every close
 *   arrived(env, dest, origin) a journey's end: the first visit to a map place +1, to a region +3;
 *                              the place and region left count as visited, giving nothing (a save
 *                              starts somewhere). dest and origin { place, region }
 *   talked(env, id, outcome)   论道 with a person: +1 to +3 by the 交涉's outcome, once a year each
 *   chapter(env, id)           a storyline chapter done (the director's run): once each
 *   knot(env, id)              a 心结 resolved (item 40): once each
 *   Each returns the gains made ([] or one or two of gain's results).
 * talkable(env, id) → whether 论道 with that person is open this year (talked: the year last).
 * line(made) → the close card's line for a gain: { kind: "mind", label, before, after, change, to,
 *   text } (scene.cjs). said(gains) → 「心境 +1（初到白苇集）」, for a summary.
 */
const mechanics = require('../mechanics.cjs');
const clock = require('./clock.cjs');
const { data } = require('./data.cjs');

const GATES = data('gates');
const RULES = GATES.mind;
const SOURCES = RULES.sources;
const ORDER = mechanics.COMBAT.realms.order;
const YEAR_DAYS = clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear;

const value = env => Math.max(0, Math.floor(Number(env.play?.mind) || 0));
const need = realm => Number(GATES.gates[realm]?.mind) || 0;

function factor(env, c = mechanics.cultivator(env)) {
  const realm = ORDER[c.major] ?? ORDER[0];
  const have = value(env), asked = need(realm);
  return { factor: RULES.open && have < asked ? RULES.half : 1, have, need: asked, realm };
}

function view(env) {
  const c = mechanics.cultivator(env);
  const have = value(env);
  const realm = ORDER[c.major];
  const next = ORDER[c.major + 1];
  const now = realm && need(realm) > 0 ? { realm, need: need(realm), met: have >= need(realm) } : null;
  const ahead = next && Object.hasOwn(GATES.gates, next) ? { realm: next, need: need(next), met: have >= need(next) } : null;
  const parts = [`阅历 ${have}`];
  if (now) parts.push(`${now.realm}要 ${now.need}，${now.met ? '已到' : `还差 ${now.need - have}`}`);
  if (ahead && ahead.need > 0) parts.push(`${ahead.realm}要 ${ahead.need}${ahead.met ? '，已到' : ''}`);
  return { value: have, text: parts.join(' · '), ...(now ? { now } : {}), ...(ahead ? { next: ahead } : {}) };
}

function gain(env, amount, why) {
  const change = Math.floor(Number(amount) || 0);
  if (change <= 0) return null;
  const before = value(env);
  env.play.mind = before + change;
  return { before, after: before + change, change, why };
}

// 诡异复苏 (world.cjs mindLoss): the one thing that lowers it; below the current major realm's
// threshold, `status` goes onto the status column's words (畸变) once.
function lose(env, amount, why, status = null) {
  const change = Math.floor(Number(amount) || 0);
  if (change <= 0) return null;
  const before = value(env);
  env.play.mind = Math.max(0, before - change);
  const realm = ORDER[mechanics.cultivator(env).major];
  const below = !!status && env.play.mind < need(realm);
  if (below) env.play.warped = status;
  return { before, after: env.play.mind, change: -change, why, ...(below ? { status } : {}) };
}

// What has given 心境 already, each kind once: places, regions, chapters, knots, and the year of
// each person's last 论道.
function minded(env) {
  const was = env.play.minded && typeof env.play.minded === 'object' ? env.play.minded : {};
  const lists = key => (Array.isArray(was[key]) ? [...was[key]] : []);
  env.play.minded = {
    places: lists('places'), regions: lists('regions'), chapters: lists('chapters'), knots: lists('knots'),
    talks: was.talks && typeof was.talks === 'object' ? { ...was.talks } : {},
  };
  return env.play.minded;
}

// Once a kind's key: record it and give `amount` the first time.
function once(env, kind, key, amount, why) {
  if (!key) return [];
  const seen = minded(env);
  if (seen[kind].includes(key)) return [];
  seen[kind].push(key);
  const made = gain(env, amount, why);
  return made ? [made] : [];
}

const closed = (env, weight) => {
  const made = gain(env, SOURCES.close[weight], `收场（${weight}）`);
  return made ? [made] : [];
};

function arrived(env, dest, origin = null) {
  const seen = minded(env);
  for (const [kind, key] of [['places', origin?.place], ['regions', origin?.region]]) {
    if (key && !seen[kind].includes(key)) seen[kind].push(key);
  }
  return [...once(env, 'places', dest?.place, SOURCES.place, `初到${dest?.place}`),
    ...once(env, 'regions', dest?.region, SOURCES.region, `初到${dest?.region}`)];
}

const yearOf = env => {
  const now = mechanics.readClock(env.state);
  return now ? Math.floor(Math.floor(now.minutes / clock.DAY_MINUTES) / YEAR_DAYS) + 1 : null;
};

function talkable(env, id) {
  const year = yearOf(env);
  return !!id && year !== null && minded(env).talks[id] !== year;
}

function talked(env, id, outcome) {
  if (!talkable(env, id)) return [];
  minded(env).talks[id] = yearOf(env);
  const made = gain(env, SOURCES.talk[outcome] ?? 0, '论道');
  return made ? [made] : [];
}

const chapter = (env, id) => once(env, 'chapters', id, SOURCES.chapter, '主线一章完成');
const knot = (env, id) => once(env, 'knots', id, SOURCES.knot, '了结一桩心结');

const line = made => ({ kind: 'mind', label: '心境', before: made.before, after: made.after, change: made.change, to: '心境',
  text: `心境 ${made.before}→${made.after}（+${made.change}）` });
const said = gains => gains.map(made => `心境 +${made.change}（${made.why}）`).join('；');

module.exports = { RULES, value, need, factor, view, gain, lose, closed, arrived, talkable, talked, chapter, knot, line, said };
