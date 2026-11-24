'use strict';
/* Encounters (遭遇战, 玩法设计第六节「遭遇战」「战前和战后」; plan item 31): someone met in the wild,
 * and the beat (一拍) before any fight. Who is met comes from the place's foe table, read through
 * places.factsOf: the place's kind picks the table, its region lifts the tiers. The tiers never
 * rise with the player; but met by chance where the place is not dangerous (its danger below
 * encounters.cap.dangerous), no one is above the player's own tier (fight.tierOf), or cap.least
 * when that is higher: a mortal or a low 炼气 near the towns meets 一阶 at most (a mortal on her
 * first errand met a 三阶 bear at 南磷岭, the real model's long playtest). In the life's first year
 * (injury.graced) someone met by chance there is held near the player's own layer (cap.newcomer):
 * a person of the player's own realm, a beast of the highest tier no stronger than the player
 * (凡兽 for a mortal or a low 炼气), so a newcomer's fight is about even (plan item 50's fixes: the
 * first year's hints player lost 91% of its fights). A dangerous place holds whatever its table
 * does, and the stretch's preview says so (warning). The tables, the cap, the
 * beat's cards and their results are content/life/foes.json (encounters, beat).
 *
 * frxPlay.encounter, null outside one:
 *   { id: "E1", who, class, people, hostile, tier, name, realm, place, kind, region, cause, since,
 *     spot: { player: { check, roll, modifier, total }, foe: { … } }, spotted: player | foe, seen,
 *     used: [beat] }
 *   who       the kind of encounter (encounters.who: 妖兽, 劫修, 同道, 商队 …); class its fight class,
 *             people, hostile as the file says; tier the table's tier lifted by the region (held to
 *             the cap when met by chance), realm that tier's realm (fight.realmOfTier), name one of
 *             the who's names not already taken
 *   spot      who spots whom: the player's 探查 against the foe's 潜行 (by its tier's baseline),
 *             each 1d10 plus its modifier band once, on the timeline seed; the player first on a tie,
 *             and always after an interruption while an alert spirit beast is out (警戒: warned, the
 *             beast; beasts.alert)
 *   seen      the player has seen what it is (察); used the beat cards played
 *
 * start(env, { cause?, who?, tier? }) → { encounter } | { refused }: someone met where the player is,
 *   from the rows of the place's table that the cause (encounters.causes), who and tier allow, by
 *   weight on the seed { kind: check, type: 遭遇, target: cause | who }. Without a tier (met by
 *   chance) a row above the cap here (capOf) counts as that tier; a tier asked for (a hunt) is
 *   met as it is. It is kept in
 *   frxPlay.encounter and its beat cards in frxPlay.cards: the cards the turns lane shows, played
 *   with the act op ({ index }) like any card. Nothing fights yet: a fight comes only from a card.
 * table(env) → { facts, region, rows }: the place's facts, its region and its table's rows with the
 *   tiers lifted (what the hunt of item 30 can choose from).
 * capOf(env, facts) → the highest tier met by chance at a place of these facts: the top of the
 *   tiers where it is dangerous, else the player's own tier or cap.least, the higher.
 * warning(env) → the words the preview of a stretch here adds to its risk line (interrupt.view),
 *   or '': at a dangerous place whose table's highest tier is above the player's own.
 * The beat's cards (beat.cards): 察 always; 潜行绕开 and 抢先手 only when the player spotted first
 *   (抢先手, without a roll, with one who means harm; with one who does not, 抢先下手, a 潜行 roll:
 *   a beat has at most one card without a roll, batch 8);
 *   遁 always; 交涉 with people; 结伴 with 同道; 买卖 with 商队; 迎战 when the foe spotted first and
 *   means harm. Each is priced as a card of its kind (actions.price, with the foe's realm), never
 *   locked; sub says what success and failure bring here.
 * price(env, beat) → the beat card as it stands now, or null when it is not offered.
 * after(env, card, outcome) → { shown, fight? }: what a beat card played did (the act op calls it
 *   once its receipt is settled): seen / stay give the next beat (new cards), unless the foe
 *   spotted first and means harm, which makes them ambush; gone, join and trade end it; fight,
 *   ambush and first end it in a fight (fight.open: the foe first, with its ambush when its class
 *   ambushes, or the player first with the player's ambush); with someone who means no harm a
 *   fight or ambush is gone. shown { id, beat, result, text, foe?, fight?, refused? } goes on the
 *   act receipt as `encounter`.
 * op "encounter" { cause?, who?, tier? } → { encounter, cards }: starts one here (receipt kind
 *   "encounter", hidden); refused while one is on or a fight is, or when nothing here fits.
 * install(verbs): an interruption in the wild becomes an encounter (verbs.hooks.broken: when the
 *   interruption's origin is the dice and its cause is one of encounters.causes, start with that
 *   cause; the verb's receipt carries it as interruption.encounter), and no verb is done while one
 *   waits (verbs.hooks.hold, chained). One interruption a stretch, so one encounter a stretch.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const actions = require('./actions.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const fight = require('./fight.cjs');
const perkLib = require('./perks.cjs');
const beasts = require('./beasts.cjs');
const world = require('./world.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const FOES = data('foes');
const ENCOUNTERS = FOES.encounters;
const CAP = ENCOUNTERS.cap;
const NEWCOMER = CAP.newcomer;
const BEAT = FOES.beat;
const TOP = FOES.tiers.list.length - 1;
const SUCCESS = ['大成功', '成功'];
const ENDS_IN_FIGHT = ['fight', 'ambush', 'first'];

const rowName = row => plain(row?.['1']).split('|')[0];

// ---------------------------------------------------------------- where, and the table

const DEFAULT_MAP = {};
const regionsByMap = new WeakMap();

// The map's places with their regions, by name.
function poiRegions(map) {
  const key = map && typeof map === 'object' ? map : DEFAULT_MAP;
  if (!regionsByMap.has(key)) regionsByMap.set(key, new Map(places.mapFacts(map).map(poi => [poi.name, { main: poi.main, sub: poi.sub }])));
  return regionsByMap.get(key);
}

// The place's facts and the encounters' region: the map place's region on the map, else the region
// the time row writes; sub first, then main, then the fallback.
function here(env) {
  const text = mechanics.placeOf(env.state);
  const facts = places.factsOf(text, env.worldMap);
  const written = places.readWhere(text);
  const poi = facts.place ? poiRegions(env.worldMap).get(facts.place) : null;
  const main = poi?.main || written.region, sub = poi?.sub || written.area;
  const region = ENCOUNTERS.regions.find(each => list(each.sub).includes(sub))
    || ENCOUNTERS.regions.find(each => list(each.main).includes(main))
    || ENCOUNTERS.regions.find(each => each.name === ENCOUNTERS.fallback);
  return { facts, region };
}

function table(env) {
  const { facts, region } = here(env);
  // A world factor's danger (妖兽主宰) lifts them further.
  const up = (Number(region?.up) || 0) + world.hooks(env, 'danger').reduce((sum, hook) => sum + hook.up, 0);
  const rows = list(ENCOUNTERS.tables[facts.kind]).map(row => ({ ...row, tier: Math.min(TOP, row.tier + up) }));
  return { facts, region, rows };
}

// The player's own tier: 凡人 零阶, 炼气一到七层 一阶, 筑基初期 三阶 (fight.tierOf).
const ownTier = env => fight.tierOf(mechanics.parseRealm(env.state['0']?.B1?.['2']));
const dangerous = facts => (Number(facts?.danger) || 0) >= CAP.dangerous;

function capOf(env, facts) {
  return dangerous(facts) ? TOP : Math.max(CAP.least, ownTier(env));
}

// The scale of a realm, as the fight's tiers read one: 100 a major realm, 1 a layer.
const scaleOf = realm => (Number(realm?.major) || 0) * 100 + (Number(realm?.minor) || 0);

// Someone a newcomer meets by chance outside a dangerous place (cap.newcomer): a person of the
// player's own realm (moved by `layer`), a beast of the highest tier whose realm is no higher. Null
// past the life's first year.
function heldFor(env, people) {
  if (!NEWCOMER || !require('./injury.cjs').graced(env)) return null;
  const own = mechanics.parseRealm(env.state['0']?.B1?.['2']);
  if (people) {
    const at = Math.max(0, scaleOf(own) + (Number(NEWCOMER.layer) || 0));
    const major = Math.floor(at / 100), minor = at % 100;
    const realm = major ? mechanics.stepName(major, Math.max(1, minor)) : mechanics.parseRealm('凡人').text;
    return { realm, tier: fight.tierOf(mechanics.parseRealm(realm)) };
  }
  let tier = 0;
  for (let t = 1; t <= TOP; t += 1) if (scaleOf(mechanics.parseRealm(fight.realmOfTier(t, false))) <= scaleOf(own)) tier = t;
  return { realm: fight.realmOfTier(tier, false), tier };
}

function warning(env) {
  const { facts, rows } = table(env);
  if (!dangerous(facts) || !rows.length) return '';
  const top = Math.max(...rows.map(row => row.tier));
  if (top <= ownTier(env)) return '';
  return chronicle.fill(CAP.warning, { 险: places.dangerWord(facts.danger) || places.dangerWord(CAP.dangerous),
    阶: `${chronicle.numeral(top)}阶`, 境: fight.realmOfTier(top, true) });
}

// ---------------------------------------------------------------- who is met

// A name on the who's list not already someone's: on the scene, or back from a biography.
function nameFor(env, names, random) {
  const taken = name => Object.values(env.state['0'] || {}).some(row => rowName(row) === name)
    || Object.values(env.biographies || {}).some(row => rowName(row) === name && !mechanics.isFallen(env.ctx, row));
  const from = Math.floor(random.random() * names.length);
  for (let n = 0; n < names.length; n += 1) if (!taken(names[(from + n) % names.length])) return names[(from + n) % names.length];
  for (let n = 2; ; n += 1) if (!taken(`${names[from]}${chronicle.numeral(n)}`)) return `${names[from]}${chronicle.numeral(n)}`;
}

function spot(env, met) {
  // The player's 神识 with the active gear counted (gear.cjs).
  const stats = require('./gear.cjs').panelOf(env);
  const look = actions.CHECKS['探查'], hide = actions.CHECKS['潜行'];
  const foe = mechanics.baselineStats(mechanics.parseRealm(met.realm), `${env.archiveId || ''}:${met.id}:${met.name}`);
  const roll = type => Math.floor(env.random({ kind: 'check', type, target: met.id }).random() * rules.RULES.die) + 1;
  const band = (value, check) => Math.floor(rules.modifierFor(value) * (check.modifierFactor ?? 1));
  const mine = roll('遭遇·探查'), theirs = roll('遭遇·潜行');
  const modifier = band(mechanics.statValue(stats[look.attribute]), look) + perkLib.checkBonus([...perkLib.owned(env), ...beasts.useNames(env)], '探查').value;
  const hidden = band(mechanics.statValue(foe[hide.attribute]), hide);
  return { player: { check: '探查', roll: mine, modifier, total: mine + modifier }, foe: { check: '潜行', roll: theirs, modifier: hidden, total: theirs + hidden } };
}

const brief = met => ({ id: met.id, who: met.who, name: met.name, realm: met.realm, tier: met.tier, people: met.people, hostile: met.hostile });
const shownOf = met => ({ ...brief(met), spotted: met.spotted, spot: met.spot, seen: met.seen, place: met.place, region: met.region,
  ...(met.warned ? { warned: met.warned } : {}) });

function start(env, { cause = '', who = null, tier = null } = {}) {
  if (env.play.encounter) return { refused: '眼前撞上的事还没了' };
  if (env.play.fight) return { refused: '已经在斗法了' };
  const { facts, region, rows } = table(env);
  const whos = cause ? list(ENCOUNTERS.causes[cause]) : null;
  const wanted = tier === null || tier === undefined || tier === '' ? null : Number(tier);
  // met by chance: no one above the cap here (a hunt asks for its tier and meets it)
  const cap = wanted === null ? capOf(env, facts) : TOP;
  const fits = rows.map(row => (row.tier > cap ? { ...row, tier: cap } : row))
    .filter(row => (!whos || whos.includes(row.who)) && (!who || row.who === who) && (wanted === null || row.tier === wanted));
  if (!fits.length) return { refused: '这里撞不上这样的对手' };
  const random = env.random({ kind: 'check', type: '遭遇', target: cause || who || '' });
  let left = random.random() * fits.reduce((sum, row) => sum + row.weight, 0);
  const row = fits.find(each => (left -= each.weight) < 0) || fits.at(-1);
  const kind = ENCOUNTERS.who[row.who];
  // a newcomer met by chance outside a dangerous place: held near the player's own layer
  const held = wanted === null && !dangerous(facts) ? heldFor(env, kind.people) : null;
  const met = { id: nextId(env, 'encounter', 'E'), who: row.who, class: kind.class, people: kind.people, hostile: kind.hostile,
    tier: held ? held.tier : row.tier, name: nameFor(env, kind.names, random), realm: held ? held.realm : fight.realmOfTier(row.tier, kind.people),
    place: facts.place || facts.spot || '', kind: facts.kind, region: region?.name || '', cause: cause || null,
    since: clock.dateKey(clock.today(env)), seen: false, used: [] };
  met.spot = spot(env, met);
  met.spotted = met.spot.player.total >= met.spot.foe.total ? 'player' : 'foe';
  // An interruption in the wild with an alert spirit beast out (警戒, beasts.cjs): it gives warning,
  // so the player sees them first and is never set upon.
  const warned = cause ? beasts.alert(env) : null;
  if (warned) {
    met.spotted = 'player';
    met.warned = warned.beast;
  }
  // Meeting something uncanny under 诡异复苏 costs 心境 (world.cjs mindLoss).
  const uncanny = world.mindLoss(env, met.class);
  if (uncanny) met.mind = require('./mind.cjs').lose(env, uncanny.value, `${uncanny.factor}：撞上${met.name}`, uncanny.status);
  env.play.encounter = met;
  env.play.cards = cardsFor(env, met);
  return { encounter: met };
}

// ---------------------------------------------------------------- the beat

// friendly: only with one who means no harm (抢先下手, rolled; batch 8: a beat offers at most one
// card without a roll, and with them it is 结伴 or 买卖, while 抢先手 is for one who means harm).
const offered = (spec, met) => !list(met.used).includes(spec.beat)
  && (!spec.hidden || met.spotted === 'player') && (!spec.spotted || met.spotted === 'foe')
  && (!spec.hostile || met.hostile) && (!spec.friendly || !met.hostile)
  && (!spec.people || met.people) && (!spec.who || spec.who.includes(met.who));

// What a result comes to with this one: someone who means no harm does not fight back, and one
// who spotted the player first and means harm strikes once the beat is over.
function effective(met, result) {
  if (result === 'spotted') return met.hostile ? 'ambush' : 'stay';
  if (!met.hostile && (result === 'fight' || result === 'ambush')) return 'gone';
  if (met.hostile && met.spotted === 'foe' && (result === 'seen' || result === 'stay')) return 'ambush';
  return result;
}

const ambushes = met => Boolean(FOES.classes[met.class]?.ambushes);
const wordOf = (met, result) => BEAT.results[result === 'ambush' && !ambushes(met) ? 'ambushQuiet' : result];

// The card's small line: its kind, what it looks at, its difficulty and what success and failure
// come to here (a look that ends in its pounce says both).
function subOf(card, spec, met) {
  const kind = actions.ACTIONS.kinds[card.kind];
  if (spec.plain) return [card.kind, wordOf(met, effective(met, spec.plain)), '不掷骰'].join(' · ');
  const said = result => {
    const comes = effective(met, result);
    return (result === 'seen' || result === 'stay') && comes !== result ? `${wordOf(met, result)}，${wordOf(met, comes)}` : wordOf(met, comes);
  };
  return [card.kind, `看${kind.looks}`, `难度${card.tier}`, `成了${said(spec.ok)}`, `败了${said(spec.miss)}`].join(' · ');
}

function priceCard(env, met, spec) {
  const ctx = { ...actions.contextOf(env, { target: '' }), target: { id: met.id, name: met.seen ? met.name : BEAT.unknown, realm: met.realm, favour: 0 } };
  const card = actions.price(ctx, { kind: spec.kind, title: spec.title, target: met.id });
  return { ...card, locked: false, reason: '', beat: spec.beat, sub: subOf(card, spec, met) };
}

function cardsFor(env, met) {
  return BEAT.cards.filter(spec => offered(spec, met)).map((spec, i) => ({ ...priceCard(env, met, spec), index: i + 1 }));
}

function price(env, beat) {
  const met = env.play?.encounter;
  const spec = BEAT.cards.find(each => each.beat === plain(beat));
  return met && spec && offered(spec, met) ? priceCard(env, met, spec) : null;
}

async function after(env, card, outcome) {
  const met = env.play.encounter;
  const spec = BEAT.cards.find(each => each.beat === card.beat);
  const raw = spec.plain || (SUCCESS.includes(outcome) ? spec.ok : outcome === '大失败' ? spec.fumble : spec.miss);
  if (raw === 'spotted') met.spotted = 'foe';
  if (raw === 'seen') met.seen = true;
  const result = effective(met, raw);
  met.used = [...list(met.used), spec.beat];
  // A look, or being seen, says what it was, and then what it came to when that is more.
  const said = word => wordOf(met, word);
  const text = raw === 'spotted' ? (result === 'ambush' ? `${said('spotted')}，${said('ambush')}` : said('spotted'))
    : (raw === 'seen' || raw === 'stay') && result !== raw ? `${said(raw)}，${said(result)}` : said(result);
  const shown = { id: met.id, beat: spec.beat, result, text, ...(met.seen ? { foe: brief(met) } : {}) };
  if (result === 'seen' || result === 'stay') {
    env.play.cards = cardsFor(env, met);
    return { shown };
  }
  env.play.encounter = null;
  env.play.cards = null;
  if (!ENDS_IN_FIGHT.includes(result)) return { shown };
  const opened = await fight.open(env, {
    foes: [{ name: met.name, realm: met.realm, class: met.class }],
    first: result === 'first' ? 'player' : 'foes',
    ...(result === 'first' ? { ambush: 'player' } : result === 'ambush' && ambushes(met) ? { ambush: 'foes' } : {}),
    // where the fight came from, for its report: a beast a hunt met, or one met in the wild, is a
    // routine fight whose report the engine writes (report.cjs, batch 9)
    from: { kind: env.play.hunt?.encounter === met.id ? 'hunt' : 'encounter', class: met.class, name: met.name },
  });
  if (opened.refused) return { shown: { ...shown, refused: opened.refused } };
  return { shown: { ...shown, fight: opened.fight?.id ?? null } };
}

// ---------------------------------------------------------------- the op and the hooks

async function op(env, args) {
  const started = start(env, { cause: plain(args.cause), who: plain(args.who) || null, tier: args.tier ?? null });
  if (started.refused) return env.refuse(started.refused);
  const met = started.encounter;
  await env.settle({ kind: 'encounter', ok: true, hidden: true, source: 'engine', encounter: shownOf(met), commands: '', owns: ownsNothing(),
    summary: `撞上${met.spotted === 'player' ? '' : '，被对方先发现'}：${met.name}（${met.realm}）` });
  return { encounter: shownOf(met), cards: env.play.cards };
}

// An interruption of a stretch in the wild that may be an encounter (verbs.hooks.broken).
async function fromInterruption(env, made, receipt) {
  if (made?.origin !== 'interrupt' || !Object.hasOwn(ENCOUNTERS.causes, made.cause)) return null;
  const started = start(env, { cause: made.cause });
  if (!started.encounter) return null;
  if (receipt?.interruption) receipt.interruption.encounter = shownOf(started.encounter);
  return started.encounter;
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.hooks.broken = fromInterruption;
  const before = verbs.hooks.hold;
  verbs.hooks.hold = (env, kind) => before(env, kind) || (env.play?.encounter ? '眼前撞上的事还没了，先在这一拍里拿个主意' : null);
}

module.exports = { start, table, capOf, warning, price, after, op, fromInterruption, install, cardsFor, nameFor };
