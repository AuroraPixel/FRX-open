'use strict';
/* 赶路 (玩法设计第三节「日行」、第四节; plan item 28): the standing verb travel, { kind: "travel",
 * to }, and the model's move_place. The numbers and words are content/life/travel.json.
 *
 * route(env, to) → { refused } or { to, from, distance, walk, foot, days, ... }: the journey from
 *   where the player stands to the map place named `to`: the straight line on the map from the time
 *   row's coordinates (else those of the map place the player is at) to the place's; the day's walk
 *   by the band of 脚力 (gear.totals: the active gear counted; a 御风 piece or a 代步 beast out a band up) among content/checks.json's
 *   modifierBands; the days, the distance over the walk rounded up, at least one. Refused, with
 *   the reason in Chinese: a place the map does not have, the map place the player is already at
 *   (moving within it is the story's), a place in another main region (cross: across the sea, into
 *   the spirit world, or too far over land), a position the map cannot place. Another main region
 *   is reached where a teleport array links here and there (hooks.cross(env, at, dest) → null, a
 *   refusal, or { days, stones, station }: arrays.cjs, plan item 43): the trip is { ..., teleport }
 *   and takes its days and its stones.
 * plan(env, verb, upTo?) → verbs.cjs's plan of the verb travel: the whole journey, or the part of it
 *   up to `upTo` minutes when the road is broken off (verbs.cjs asks interrupt.stop with `at`, the
 *   road: road's danger and causes, no map place; at most once a journey). Broken off, the player
 *   stops where that day's walk leaves them on the straight line (roadSpot at those coordinates)
 *   and no arrival is written. The receipt { kind: "travel", ok, source, commands, owns, summary,
 *   travel: { from, to, distance, walk, days, walked, arrived } } moves the clock; the time row it
 *   writes (clock.advance's place) names the place at the end. Lines: on leaving 「出城，往白苇集，
 *   行十二日。」 (dated the day it starts), on arriving 「至白苇集。」 (the day it ends). Arriving,
 *   a first visit to the place and to its region adds 心境 (mind.arrived, item 36): the receipt's
 *   `mind` and its summary say it.
 * move(env, args) → the model's tool move_place { to, reason }: the same journey, settled as the verb
 *   settles it, a scene under way or not (a beat may take the player elsewhere); source "tool".
 * near(env, count?) → the 去处 list (play_models.PlayNear): the map places of the player's main
 *   region but the one they are at, nearest first, the first `count` of them (the file's `near` by
 *   default): { name, kind, venues, distance, days }.
 * install(verbs) adds travel to verbs.VERBS (index.cjs).
 */
const mechanics = require('../mechanics.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const gear = require('./gear.cjs');
const beasts = require('./beasts.cjs');
const interrupt = require('./interrupt.cjs');
const places = require('./places.cjs');
const mind = require('./mind.cjs');
const { data } = require('./data.cjs');
const { ownsNothing } = require('./play.cjs');

const RULES = data('travel');
const KINDS = data('places').kinds;
const BANDS = require('../../../content/checks.json').modifierBands;
const DAY = clock.DAY_MINUTES;

// The day's walk of a 脚力: the speed of the band it falls in (the top two bands are both 300),
// `up` bands higher for a flying piece of gear (御风, gear.cjs).
function walkOf(foot, up = 0) {
  let band = 0;
  BANDS.forEach(([floor], index) => { if (foot >= floor) band = index; });
  return RULES.speeds[Math.min(band + up, RULES.speeds.length - 1)];
}

// 脚力 as the life play totals it, the active gear counted (gear.cjs).
function footOf(env) {
  const stats = env.ctx.parseNestedJsonString(env.state['0']?.B1?.['11'], {});
  return gear.totals(env, 'B1', stats && typeof stats === 'object' ? stats : {})[RULES.stat] ?? 0;
}

// Bands up for the day's walk: a flying piece of gear (御风) and the spirit beast out with the player
// when it carries one (代步, beasts.cjs).
const flying = env => gear.traitsOf(env, 'travel').reduce((sum, trait) => sum + trait.bands, 0) + beasts.mountBands(env);
const hooks = { cross: () => null };

// Where the player stands: the map place they are at (or none), their coordinates, their regions.
function standing(env) {
  const text = mechanics.placeOf(env.state);
  const where = places.readWhere(text);
  const facts = places.factsOf(text, env.worldMap);
  const poi = facts.place ? places.poisOf(env.worldMap).find(each => each.name === facts.place) || null : null;
  const xy = where.xy || (poi && Number.isFinite(poi.x) && Number.isFinite(poi.y) ? [poi.x, poi.y] : null);
  return { facts, poi, xy, main: poi?.main_region || where.region || '', area: poi?.sub_region || where.area || '' };
}

// Why a journey between two main regions cannot be made now.
function across(from, to) {
  const spirit = RULES.spirit.includes(from) !== RULES.spirit.includes(to.main_region);
  if (spirit) return RULES.cross.spirit;
  if (RULES.seas.includes(from) || RULES.seas.includes(to.main_region)) return RULES.cross.sea;
  return chronicle.fill(RULES.cross.land, { 到: to.name, 区域: to.main_region });
}

function route(env, to) {
  const name = typeof to === 'string' ? to.trim() : '';
  if (!name) return { refused: '赶路要说往哪个地方去' };
  const dest = places.poisOf(env.worldMap).find(each => each.name === name);
  if (!dest || !Number.isFinite(dest.x) || !Number.isFinite(dest.y)) return { refused: `地图上没有「${name.slice(0, 20)}」这个地方` };
  const at = standing(env);
  if (at.facts.place === dest.name) return { refused: `你已在${dest.name}，在这里换个去处不算赶路` };
  if (!at.xy) return { refused: '认不出你在地图上的哪里，没法算路程' };
  const distance = Math.hypot(dest.x - at.xy[0], dest.y - at.xy[1]);
  const foot = footOf(env);
  if (at.main && dest.main_region && at.main !== dest.main_region) {
    const gate = hooks.cross(env, at, dest);
    if (!gate) return { refused: across(at.main, dest) };
    return gate.refused ? gate : { to: dest, from: at, distance, foot, walk: 0, days: gate.days, teleport: gate };
  }
  const walk = walkOf(foot, flying(env));
  return { to: dest, from: at, distance, foot, walk, days: Math.max(1, Math.ceil(distance / walk)) };
}

const rounded = distance => Math.round(distance);
const placeText = (main, area, spot, x, y) => `/${main}/${area || main}（${spot}）${Math.round(x)},${Math.round(y)}`;

// The road: 山野's danger and causes, no map place, the region the journey starts in.
function road(env, trip) {
  const kind = RULES.road;
  return { kind, danger: KINDS[kind].danger, place: null,
    where: { text: '', name: '', kind, region: trip.from.poi?.sub_region || trip.from.area || '' } };
}

// How the line on leaving says it: by the kind of the place left (出城, 出了山门, 离了白苇集).
function leaving(trip) {
  const kind = trip.from.facts.kind;
  const word = Object.hasOwn(RULES.leave, kind) ? RULES.leave[kind] : RULES.leave.default;
  return chronicle.fill(word, { 地点: trip.from.facts.place || trip.from.facts.spot || '' });
}

const fighting = env => String(env.state['0']?.B1?.['31']).trim() === 'true' || Boolean(env.play?.fight);

const ARRIVAL = '(?:暗渡回|渡回|潜回|返回|回到|抵达|到达|赶到|潜入|进入|踏入|走进|来到|移步至)';
const DESTINATION = new RegExp(`${ARRIVAL}(?<spot>[\\p{Script=Han}·]{2,30})[。！？；，、,.!?;\\s]*$`, 'u');
const NONARRIVAL = /(?:未能|没能|没有|没法|无法|不能|并未|尚未|还未|只差|差点|若|如果|打算|准备|设法|试图|计划|想要|即将|便可|就能|才(?:能|可))/;

// The successful act already paid for this movement. A district or nearby landmark can be
// more precise in the scene than on the map without granting a journey to another map point.
async function sceneArrival(env, args, earlier) {
  const act = earlier.findLast(receipt => receipt.ok && receipt.kind === 'act');
  if (!act || !['成功', '大成功'].includes(act.check?.outcome)
      || (act.check.kind !== '潜行' && act.check.kind !== '脱身' && act.card?.route !== '转移')
      || earlier.some(receipt => receipt.ok && receipt.kind === 'travel') || fighting(env)) return;
  const intent = String(act.card?.title || '').split(/[。！？；，、,.!?;\n]/).filter(part => part.trim()).at(-1)?.trim();
  const spot = intent?.match(DESTINATION)?.groups.spot;
  if (!spot || NONARRIVAL.test(intent)) return;

  const story = String(args.story || '').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/g, '');
  const confirmation = new RegExp(`${ARRIVAL}${spot}`, 'u');
  const confirmed = story.split(/[。！？；.!?;\n]/).some(sentence => /你|主角/.test(sentence)
    && sentence.split(/[，,]/).some(part => confirmation.test(part) && !NONARRIVAL.test(part)));
  if (!confirmed) return;

  const now = mechanics.readClock(env.state);
  const where = places.readWhere(now?.place.slice(1));
  if (!where.xy || !where.region || !where.area || spot === where.spot) return;
  const [x, y] = where.xy;
  const map = env.worldMap;
  const anchor = places.factsOf(placeText(where.region, where.area, '', x, y).slice(1), map).place;
  const point = places.poisOf(map).find(poi => poi.name === anchor);
  if (!point || point.main_region !== where.region
      || ![where.region, where.area, anchor].some(name => spot.startsWith(name))) return;
  const place = placeText(where.region, where.area, spot, x, y);
  if (places.factsOf(place.slice(1), map).place !== anchor) return;

  const row = mechanics.clockText({ ...now, place }, 0);
  await env.settle({ kind: 'scene_arrival', ok: true, source: 'engine',
    summary: `抵达${spot}`, arrival: { spot, place: place.slice(1) }, owns: ownsNothing(),
    commands: `add("TIME_LOCATION_ROW",${JSON.stringify({ 0: row })})` });
}

function plan(env, verb, upTo = null, source = 'verb') {
  if (!mechanics.readClock(env.state)) return { refused: '时间行里没有可识别的日期，无法赶路' };
  if (fighting(env)) return { refused: '仍在战斗中，不能赶路' };
  const trip = route(env, verb.to);
  if (trip.refused) return trip;
  const full = trip.days * DAY;
  const over = clock.overrun(env, full);
  if (over) return { refused: `赶路${chronicle.spanText(full)}${over}` };
  const minutes = upTo === null ? full : Math.max(DAY, Math.min(full, Math.ceil(upTo / DAY) * DAY));
  const arrived = minutes >= full;
  const walked = Math.round(minutes / DAY);
  const share = arrived ? 1 : walked / trip.days;
  const [x0, y0] = trip.from.xy, dest = trip.to;
  const place = arrived
    ? placeText(dest.main_region, dest.sub_region, dest.name, dest.x, dest.y)
    : placeText(trip.from.main, trip.from.area, RULES.roadSpot, x0 + (dest.x - x0) * share, y0 + (dest.y - y0) * share);
  const span = chronicle.spanText(full);
  const gate = trip.teleport || null;
  const purse = gate ? mechanics.stonesOf(env.state['0']?.B1) ?? 0 : null;
  const receipt = {
    kind: 'travel', ok: true, source, commands: gate ? `add("B1",{"26":"${purse - gate.stones}"})` : '',
    owns: gate ? { ...ownsNothing(), currency: true } : ownsNothing(),
    summary: gate ? `传送：从${gate.station}经传送阵往${dest.name}，付灵石${gate.stones}块`
      : `赶路：往${dest.name}，路程${rounded(trip.distance)}，日行${trip.walk}，${arrived ? `行${span}` : `行至第${chronicle.numeral(walked)}日`}`,
    travel: { from: trip.from.facts.place || trip.from.facts.spot || '', to: dest.name, distance: rounded(trip.distance),
      walk: trip.walk, days: trip.days, walked, arrived, ...(gate ? { teleport: { station: gate.station, stones: gate.stones } } : {}) },
  };
  const now = mechanics.readClock(env.state);
  const preview = gate ? {
    ok: true, reason: null, minutes, ends: clock.dateOf(now.minutes + minutes),
    lines: [`经${gate.station}的传送阵往${dest.name}，付灵石${chronicle.numeral(gate.stones)}块，${clock.dateOf(now.minutes + full).text}到。`],
    formula: [{ label: '传送阵', value: `${gate.station} → ${dest.name}` }, { label: '灵石', value: String(gate.stones) }],
  } : {
    ok: true, reason: null, minutes, ends: clock.dateOf(now.minutes + minutes),
    lines: [`往${dest.name}，路程约${chronicle.numeral(rounded(trip.distance))}，日行${chronicle.numeral(trip.walk)}，行${span}，${clock.dateOf(now.minutes + full).text}到。`],
    formula: [{ label: '路程', value: String(rounded(trip.distance)) }, { label: `${RULES.stat} ${trip.foot}`, value: `日行${trip.walk}` },
      { label: '日数', value: `${rounded(trip.distance)} ÷ ${trip.walk} → ${trip.days}` }],
  };
  return {
    minutes, receipt, preview, ...(gate ? {} : { at: road(env, trip) }), place,
    line: gate ? ['teleport', { 离: leaving(trip), 到: dest.name, 灵石: chronicle.numeral(gate.stones) }]
      : ['travel', { 离: leaving(trip), 到: dest.name, 时长: arrived ? span : '' }],
    finish: settled => {
      settled.summary += `；时间 ${settled.time.before}→${settled.time.after}` + (settled.age ? `；年龄 ${settled.age.before}→${settled.age.after}` : '');
      if (!arrived) return;
      chronicle.write(env, 'arrive', { 到: dest.name });
      // 心境 (item 36): the first visit to the place and to its region; the place left counts as seen
      const gains = mind.arrived(env, { place: dest.name, region: dest.sub_region || dest.main_region },
        { place: trip.from.facts.place, region: trip.from.poi ? trip.from.poi.sub_region || trip.from.poi.main_region : null });
      if (gains.length) {
        settled.mind = gains;
        settled.summary += `；${mind.said(gains)}`;
      }
    },
  };
}

const verbPlan = (env, verb, upTo = null) => plan(env, verb, upTo, 'verb');

// The model's move_place: the journey settled as the verb settles it (verbs.verb), but in a scene
// too and by source tool; refused with the reason when it cannot be made.
async function move(env, args) {
  const verb = { to: args?.to };
  let made = plan(env, verb, null, 'tool');
  if (made.refused) return env.refuse(made.refused);
  const broken = interrupt.stop(env, made.minutes, made.at);
  if (broken) {
    made = plan(env, verb, broken.minutes, 'tool');
    made.receipt.interruption = interrupt.shown(broken);
  }
  const why = typeof args?.reason === 'string' ? args.reason.trim().slice(0, 60) : '';
  if (why) made.receipt.summary += `（${why}）`;
  chronicle.write(env, ...made.line);
  await clock.advance(env, made.minutes, made.receipt, made.place);
  if (broken) interrupt.after(env, broken);
  made.finish(made.receipt);
  if (broken) made.receipt.summary += `；${broken.date.text}被打扰：${broken.cause}`;
  return { travel: made.receipt.travel };
}

function near(env, count = RULES.near) {
  const at = standing(env);
  if (!at.xy) return [];
  const walk = walkOf(footOf(env), flying(env));
  return places.poisOf(env.worldMap)
    .filter(poi => poi.name !== at.facts.place && Number.isFinite(poi.x) && Number.isFinite(poi.y)
      && (!at.main || !poi.main_region || poi.main_region === at.main))
    .map(poi => ({ poi, distance: Math.hypot(poi.x - at.xy[0], poi.y - at.xy[1]) }))
    .sort((a, b) => a.distance - b.distance || a.poi.name.localeCompare(b.poi.name))
    .slice(0, count)
    .map(({ poi, distance }) => {
      const facts = places.factsOf(poi.name, env.worldMap);
      return { name: poi.name, kind: facts.kind, venues: facts.venues, distance: rounded(distance),
        days: Math.max(1, Math.ceil(distance / walk)) };
    });
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.travel = verbPlan;
}

module.exports = { RULES, walkOf, route, plan, move, sceneArrival, near, install, hooks };
