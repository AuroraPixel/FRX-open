'use strict';
/* What a place is in the play mode 修仙人生 (gameplay design 九 and 四; plan items 11 and 27): the
 * map place a place text belongs to and its five fields: its kind, its aura, its danger (the
 * chance in a hundred that a month there is interrupted), its trade (专营: what it sells, buys and
 * produces, each 「类·阶」) and its access (开放: realm, status, calendar, null where nothing is
 * asked); a town may be a big city (big). Its venues (处所) follow from its kind by the standard
 * table (venues.kinds, venues.big for a big city). The data is content/life/places.json:
 *
 *   named     a map place written out by hand (every place of 云汀湾);
 *   drafts    every other map place, read by the rules below and kept in the file as drafts
 *             (draft: true) for the owner to look over (tools/life_places.cjs writes them);
 *   the rules a place no entry names (another map's) is read on the spot, as a draft:
 *     words     its kind from words in its name, then its description, then the name's late
 *               words (谷, 宫, 岛 …), in the order of the rules; a name that ends in a late word
 *               (苦藤屿) reads its description first; a rich-aura word
 *               (cultivation.json environment.richPlace) makes the aura 浓, a barren word 无, a
 *               deadly word the danger 60;
 *     fallback  山野, 薄, 15;
 *     draft     its trade from its kind (draft.trade), the tier from its region (draft.tiers), a
 *               big city by its name or description (draft.big, selling draft.bigSells more),
 *               its access's status from its kind (draft.status).
 *
 * A place text is what follows the date in the time row (mechanics.placeOf):
 * 「潮岚道/云汀湾（泊灯城·云水居客房）3395,1956」, or a bare name (「泊灯城·云水居客房」). It belongs to
 * the map place the server's map marks as here (play_world.map_view): the place its spot names,
 * the longest such name (play_art.named_poi), else the place nearest its coordinates within 15
 * map units (play_art.nearest_poi); the spot is read the way play_state.Location reads it. A spot
 * that belongs to a map place has that place's facts. A spot that belongs to none is read by the
 * words of its own name, and falls back to 山野.
 *
 * Pure: the result depends only on the text, the map given (the save's, else content/map.json)
 * and the rules data.
 *
 * placeFacts(env) → factsOf where the player is now: the time row's place (mechanics.placeOf) on
 * the save's map (env.worldMap). Takes settle.cjs's engineEnv as it is.
 *
 * Who may go into a place (its access, 开放; places.json access): read for the player, so these
 * take an env. A realm asked: a major realm (炼气) that realm only, with 「以上」 (筑基以上) at
 * least it. A status asked: as access.grants gives it: own, the player belongs to the sect or the
 * family whose place it is (belongsTo: frxPlay.sect names it, or the identity, column 2 past the
 * realm, has its name: 听澜院外门弟子, 避潮寨后人); a list of sects (content/life/sects.json), the
 * player belongs to one of them, read the same way (诸院弟子: 云汀湾's seven; 岩汀门, a mortal
 * martial sect in 云汀湾, is not one); a status no grant names, no player holds.
 * A calendar asked: only when its fixed event is what the player is sent for (open: its id; or
 * true, the story's own trip, whichever day: the main line's 到达, a director's hook). The
 * player's own home (frxPlay.home) is theirs, whatever its place asks. Nothing sends a player into
 * a place they may not go into: a board posts them no notice there (jobs.cjs) and 接下来 no hint
 * there (hints.cjs). Walking in oneself is not stopped, nor staying, nor anything done there
 * (赶路不拦, a deviation of the design). A 散修 who took a 矿役 notice at 石匣岭 (the 诸院's)
 * cultivated there for decades (the replayed 伪灵根 of docs/review/gameplay/playtest-2.md).
 *
 * mayEnter(env, name, { facts?, open? }) → whether the player may go into the map place `name`
 *   (facts: its factsOf, read when not given; open: the calendar event the player is sent for, or
 *   true for the story's own trip).
 * belongsTo(env, name) → whether the player belongs to the sect or the family of the map place.
 * accessKey(env) → what the access reads of the player, for a cache of what follows from it.
 */

const mechanics = require('../mechanics.cjs');
const { data } = require('./data.cjs');
const MAP = require('../../../content/map.json');
const PLACES = require('../../../content/life/places.json');
const CULTIVATION = require('../../../content/cultivation.json');

const { placeOf } = mechanics;
const SECTS = data('sects');

const REACH = 15; // map units (10 km each) within which a spot is at the nearest map place
const PAREN = /[（(]\s*([^（）()]*?)\s*[）)]/;
const DATE_HEAD = /^\s*\d+\s*年/;
const RICH = new RegExp(CULTIVATION.environment.richPlace);

// A region or area name without its coordinates and bracketed spot (play_state._clean).
const clean = part => part.split(/\s+-?\d/)[0].split(/[（(]/)[0].trim();
const length = text => [...text].length;

// The region, area, spot and coordinates of a place text, as play_state.Location reads the part
// of the time row after the date. A whole time row is cut after its date; a text without any
// 「/」 is a bare name, the spot itself (or the bracketed part of it).
function readWhere(text) {
  let rest = typeof text === 'string' ? text : '';
  if (DATE_HEAD.test(rest) && rest.includes('/')) rest = rest.slice(rest.indexOf('/') + 1);
  const coords = rest.match(/(-?\d+),(-?\d+)/);
  const xy = coords ? [Number(coords[1]), Number(coords[2])] : null;
  if (!rest.includes('/')) {
    const bracket = rest.match(PAREN);
    return { region: '', area: '', spot: bracket ? bracket[1] : clean(rest), xy };
  }
  const parts = rest.replaceAll('|', ' ').split('/').map(part => part.trim());
  const areaPart = parts[1] ?? '';
  const bracket = areaPart.match(PAREN);
  return { region: clean(parts[0]), area: clean(areaPart), spot: bracket ? bracket[1] : clean(parts[2] ?? ''), xy };
}

// The map's places (play_art.pois_of): the save's map, or the card's default map when the save
// carries none (play_world.map_of_state).
function poisOf(map) {
  const source = Array.isArray(map?.points_of_interest) && map.points_of_interest.length ? map : MAP;
  const own = source.points_of_interest.filter(poi => poi && typeof poi.name === 'string');
  const areas = Array.isArray(source.sub_regions) ? source.sub_regions : [];
  const storyPlaces = (data('travel').storyPlaces || []).filter(poi => !own.some(each => each.name === poi.name)
    && areas.some(area => area?.name === poi.sub_region && area.main_region === poi.main_region));
  return [...own, ...storyPlaces];
}

// The map place a spot names: the place itself, or the longest place name inside it.
function namedPoi(pois, spot) {
  if (!spot) return null;
  const exact = pois.find(poi => poi.name === spot);
  if (exact) return exact;
  let best = null;
  for (const poi of pois) if (poi.name && spot.includes(poi.name) && (!best || length(poi.name) > length(best.name))) best = poi;
  return best;
}

// The map place nearest to the coordinates, within REACH.
function mapPosition(text, map) {
  const where = readWhere(text);
  // A location like “旧城书斋” can be a local room whose name happens to contain a town.
  // Only an exact name or an explicitly scoped district can correct a different map anchor.
  const root = where.spot.split('·', 1)[0].trim();
  const poi = poisOf(map).find(point => point.name === root);
  if (!poi || !Number.isFinite(poi.x) || !Number.isFinite(poi.y)) return where;
  const region = poi.main_region || where.region;
  const area = poi.sub_region || region;
  const near = where.xy && Math.hypot(where.xy[0] - poi.x, where.xy[1] - poi.y) <= REACH;
  return { ...where, region, area, xy: near && region === where.region && area === where.area ? where.xy : [poi.x, poi.y] };
}

function normalizedTimeRow(text, map) {
  const at = String(text ?? '').indexOf('/');
  if (at < 0) return text;
  const raw = text.slice(at + 1), before = readWhere(raw), where = mapPosition(raw, map);
  if (!where.xy || (where.region === before.region && where.area === before.area
      && String(where.xy) === String(before.xy))) return text;
  return `${text.slice(0, at)}/${where.region}/${where.area}（${where.spot}）${where.xy.join(',')}`;
}

function nearestPoi(pois, xy) {
  if (!xy) return null;
  let best = null;
  let distance = Infinity;
  for (const poi of pois) {
    if (typeof poi.x !== 'number' || typeof poi.y !== 'number') continue;
    const here = (poi.x - xy[0]) ** 2 + (poi.y - xy[1]) ** 2;
    if (here < distance) { best = poi; distance = here; }
  }
  return best && distance <= REACH ** 2 ? best : null;
}

const firstWord = (words, text) => (words || []).find(word => text.includes(word));
const LATE = PLACES.words.rules.flatMap(rule => rule.late || []);

// The kind the words give a name and a description, or null: the first rule with a word in the
// name, else in the description, else among the name's late words. A name that ends with a late
// word (苦藤屿, 风巢谷) has it for its head: the description first, then that word.
function kindByWords(name, description) {
  const headed = LATE.some(word => name.endsWith(word));
  const passes = headed ? [['text', description], ['late', name]] : [['name', name], ['text', description], ['late', name]];
  for (const [list, text] of passes) {
    if (!text) continue;
    for (const rule of PLACES.words.rules) {
      const word = firstWord(rule[list], text);
      if (word) return { kind: rule.kind, word, in: list === 'text' ? '说明' : '名' };
    }
  }
  return null;
}

function fallback() {
  const { kind, aura, danger } = PLACES.fallback;
  return { kind, aura, danger, layer: 'fallback', why: '无字可依' };
}

// The facts of a name and a description by the words layer, or the fallback when no word says
// anything: the kind's aura and danger, changed by the rich, barren and deadly words.
function readWords(name, description = '') {
  const found = kindByWords(name, description);
  const both = `${name} ${description}`;
  const rich = both.match(RICH)?.[0];
  const barren = firstWord(PLACES.words.barren, both);
  const deadly = firstWord(PLACES.words.deadly, both);
  if (!found && !rich && !barren && !deadly) return fallback();
  const kind = found ? found.kind : PLACES.fallback.kind;
  let { aura, danger } = PLACES.kinds[kind];
  const reasons = found ? [`${found.in}有「${found.word}」`] : [];
  if (rich) { aura = '浓'; reasons.push(`「${rich}」灵气浓`); }
  else if (barren) { aura = '无'; reasons.push(`「${barren}」没有灵气`); }
  if (deadly) { danger = PLACES.dangers.凶地; reasons.push(`「${deadly}」是凶地`); }
  return { kind, aura, danger, layer: 'words', why: reasons.join('，') };
}

const DRAFT = PLACES.draft;
const own = (table, name) => (Object.hasOwn(table, name) ? table[name] : null);

// The tier a draft's goods are of: its sub-region's, else its main region's, else the default.
const tierOf = poi => own(DRAFT.tiers, poi?.sub_region || '') || own(DRAFT.tiers, poi?.main_region || '') || DRAFT.tiers.default;
const isBig = (name, description) => DRAFT.big.name.some(word => name.endsWith(word))
  || DRAFT.big.text.some(word => description.includes(word));

// A place read by the rules: the words' kind, aura and danger (or the fallback's), then the
// draft's trade, big and access. What tools/life_places.cjs writes into drafts.
function draftOf(name, description = '', poi = null) {
  const read = name ? readWords(name, description) : fallback();
  const big = read.kind === '城镇' && isBig(name, description);
  const rule = own(DRAFT.trade, read.kind) || { sells: [], buys: [], produces: [] };
  const tier = tierOf(poi);
  const goods = classes => classes.map(each => `${each}·${tier}`);
  const sells = big ? [...rule.sells, ...DRAFT.bigSells.filter(each => !rule.sells.includes(each))] : rule.sells;
  return {
    kind: read.kind, aura: read.aura, danger: read.danger, ...(big ? { big: true } : {}),
    trade: { sells: goods(sells), buys: goods(rule.buys), produces: goods(rule.produces) },
    access: { realm: null, status: own(DRAFT.status, read.kind), calendar: null },
    draft: true, layer: read.layer, why: read.why,
  };
}

// The venues of a place's kind (and a big city's more), by the standard table.
const venuesOf = row => [...(own(PLACES.venues.kinds, row.kind) || []), ...(row.big ? PLACES.venues.big : [])];

// The five fields and the rest of a place, the way factsOf gives them.
function complete(entry, layer, why) {
  const row = {
    kind: entry.kind, aura: entry.aura, danger: entry.danger, big: !!entry.big,
    trade: structuredClone(entry.trade), access: { ...entry.access }, draft: !!entry.draft, layer, why,
  };
  row.venues = venuesOf(row);
  return row;
}

const rows = new WeakMap();

// The facts of a map place: its named entry, else its draft, else the rules on the spot.
function factsOfPoi(poi) {
  if (rows.has(poi)) return rows.get(poi);
  const named = own(PLACES.named, poi.name);
  const drafted = named ? null : own(PLACES.drafts, poi.name)
    || draftOf(poi.name, typeof poi.description === 'string' ? poi.description : '', poi);
  const row = named ? complete(named, 'named', named.note) : complete(drafted, drafted.layer, drafted.why);
  rows.set(poi, row);
  return row;
}

// What a place text is: { place, spot, via, kind, aura, danger, big, trade, access, venues, draft,
// layer, why }. `place` is the map place it belongs to (null when none), `via` how ('name': its
// spot names the place; 'near': its coordinates; null), `danger` a whole percent, `layer` how the
// kind was read (named, words, fallback), `why` a short reason in Chinese and `draft` whether it
// is a draft. A spot on no map place is read by the rules on its own name, as a draft.
function factsOf(placeText, map) {
  const pois = poisOf(map);
  const where = readWhere(placeText);
  const byName = namedPoi(pois, where.spot);
  const poi = byName || nearestPoi(pois, where.xy);
  if (poi) return { place: poi.name, spot: where.spot, via: byName ? 'name' : 'near', ...factsOfPoi(poi) };
  const drafted = draftOf(where.spot);
  return { place: null, spot: where.spot, via: null, ...complete(drafted, drafted.layer, drafted.why) };
}

const placeFacts = env => factsOf(placeOf(env.state), env.worldMap);

// The map place where the player is, as a map entry ({ name, x, y, main_region, … }), or null.
function poiHere(env) {
  const name = placeFacts(env).place;
  return name ? poisOf(env.worldMap).find(poi => poi.name === name) || null : null;
}

// The tier a map place's goods and pay are of (draft.tiers by its region), by the place's name.
function tierAt(name, map) {
  return tierOf(poisOf(map).find(poi => poi.name === name) || null);
}

// The danger in words (dangerWords): 太平, 偶有凶险.
const dangerWord = danger => own(PLACES.dangerWords, String(danger)) || '';

// The place as the state view's play shows it (play_models.PlayPlace): the map place's name (none
// off the map), its kind, aura, danger in words and venues.
function placeView(env) {
  const facts = placeFacts(env);
  return { ...(facts.place ? { name: facts.place } : {}), kind: facts.kind, aura: facts.aura,
    danger: dangerWord(facts.danger), venues: facts.venues };
}

// ---------------------------------------------------------------- who may go into a place

const ACCESS = PLACES.access;
const AT_LEAST = '以上'; // a realm asked with it is the least one (access.notes)

const isObject = value => value && typeof value === 'object';
const SECT_TABLE = SECTS.sects || {};
// The player's sect (frxPlay.sect's name), or ''.
const sectName = env => (isObject(env.play?.sect) ? String(env.play.sect.name || '') : '');
// What the player is written as: column 2 past the realm (听澜院外门弟子, 避潮寨后人, 散修).
const identityOf = env => String(env.state?.['0']?.B1?.['2'] ?? '').replace(/<[^>]*>/g, '').split('|').slice(1).join('|');
// The map place of the player's home, or null.
const homePlace = env => (isObject(env.play?.home) && env.play.home.place) || null;

// Whether the player belongs to the sect or the family whose map place `name` is: frxPlay.sect
// names it (the sect whose place it is, sects.json), or the identity has its name. The outsiders'
// interruptions at such a place read it too (interrupt.memberHere).
function belongsTo(env, name) {
  if (!name) return false;
  const sect = Object.entries(SECT_TABLE).find(([, each]) => each?.place === name)?.[0] || name;
  const mine = sectName(env);
  if (mine && (mine === sect || mine === name)) return true;
  const identity = identityOf(env);
  return [sect, name].some(word => identity.includes(word));
}

// Whether the player holds the status a place asks (access.grants): own, they belong to the sect
// or the family whose place it is; a list of sects, they belong to one of them (each read by its
// map place as belongsTo reads one, the sect's own name where it has none). 诸院弟子 names 云汀湾's
// seven: any sect with its place in 云汀湾 also took in 岩汀门, a mortal martial sect.
function statusFits(env, name, status) {
  const rule = own(ACCESS.grants, status);
  if (rule === 'own') return belongsTo(env, name);
  return Array.isArray(rule) && rule.some(sect => belongsTo(env, SECT_TABLE[sect]?.place || sect));
}

// Whether the player's realm is the one a place asks.
function realmFits(env, asked) {
  const text = String(asked).trim();
  const least = text.endsWith(AT_LEAST);
  const need = mechanics.parseRealm(least ? text.slice(0, -AT_LEAST.length) : text);
  if (need.unknown) return false;
  const major = mechanics.cultivator(env).major;
  return least ? major >= need.major : major === need.major;
}

// Whether the player may go into the place `name` by its access (facts: its factsOf, read when not
// given; a spot, 泊灯城·云水居, is its map place's): the status, the realm and the calendar it asks,
// each held; a calendar's place only when its event is what the player is sent for (open: the
// event's id; true, the story's own trip, whichever day). The player's own home is theirs,
// whatever its place asks.
function mayEnter(env, name, { facts = null, open = null } = {}) {
  const read = facts || factsOf(name, env.worldMap);
  const place = read.place || name;
  if (place && homePlace(env) === place) return true;
  const access = read.access || {};
  if (access.status && !statusFits(env, place, access.status)) return false;
  if (access.realm && !realmFits(env, access.realm)) return false;
  return !access.calendar || open === true || open === access.calendar;
}

const accessKey = env => [sectName(env), identityOf(env), homePlace(env) || '', mechanics.parseRealm(env.state?.['0']?.B1?.['2']).major ?? ''].join('|');

// Every place of the map (content/map.json unless another is given), in the map's order, with
// what it is read as: the review table docs/review/gameplay/places.md (tools/life_places.cjs).
function mapFacts(map) {
  return poisOf(map).map(poi => ({
    name: poi.name, main: poi.main_region || '', sub: poi.sub_region || '', ...factsOfPoi(poi),
  }));
}

// The drafts of every map place that has no named entry, by the rules: what drafts should hold.
function mapDrafts(map) {
  return Object.fromEntries(poisOf(map).filter(poi => !own(PLACES.named, poi.name))
    .map(poi => [poi.name, draftOf(poi.name, typeof poi.description === 'string' ? poi.description : '', poi)]));
}

module.exports = { factsOf, placeFacts, poiHere, placeView, dangerWord, tierAt, poisOf, mapFacts, mapDrafts, readWhere, mapPosition, normalizedTimeRow, REACH,
  mayEnter, belongsTo, accessKey };
