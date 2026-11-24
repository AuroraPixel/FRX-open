'use strict';
/* Where something is, as far as the calendar and the pressure clocks ask: is the player in a
 * clock's scope, in an event's region. A place is read the one way the places module reads it
 * (places.factsOf: the map place a text belongs to, by name or by its coordinates, its kind); the
 * region is that map place's sub_region (云汀湾), or for a text that belongs to no map place the
 * area or region its time row writes (潮岚道/云汀湾（…）).
 *
 * where(env, place?) → { text, name, kind, region }
 *   place   omitted: the player's place, the time row after its date. A string: a place text or
 *           a map place's name. An object: what places.factsOf reads a place as ({ place, spot,
 *           kind, … }), as the act op has it.
 *   name    the map place it belongs to, else its spot; kind its kind (城镇, 山野 …)
 * within(scope, here) → whether a clock's scope ({ kind: place | region | self | home, value }) holds
 *   there; a home's is the map place of the home it was started on (home.cjs, plan item 45).
 * regionOfPlace(name, map) → the region of a map place by its name ('' when unknown).
 * The map is the save's (env.worldMap) when it has places, else content/map.json.
 */
const mechanics = require('../mechanics.cjs');
const places = require('./places.cjs');

const MAP = require('../../../content/map.json');

const own = map => (Array.isArray(map?.points_of_interest) && map.points_of_interest.length ? map : MAP);
const regionsByPlace = new WeakMap();

function regionOfPlace(name, map) {
  const source = own(map);
  if (!regionsByPlace.has(source)) regionsByPlace.set(source, new Map(places.mapFacts(source).map(place => [place.name, place.sub])));
  return regionsByPlace.get(source).get(name) || '';
}

// The area or region a place text writes, when it is one of the map's regions.
function writtenRegion(text, map) {
  const regions = new Set((Array.isArray(map?.sub_regions) && map.sub_regions.length ? map.sub_regions : MAP.sub_regions)
    .map(region => region?.name).filter(Boolean));
  const { area, region } = places.readWhere(text);
  return [area, region].find(part => regions.has(part)) || '';
}

function where(env, place) {
  let text, facts;
  if (place && typeof place === 'object') {
    facts = place;
    text = [place.place, place.spot].filter(value => typeof value === 'string' && value).join(' ');
  } else {
    if (typeof place === 'string') text = place;
    else {
      const row = String(mechanics.clockRow(env.state)?.['0'] ?? '');
      text = row.includes('/') ? row.slice(row.indexOf('/') + 1).trim() : '';
    }
    facts = places.factsOf(text, env.worldMap);
  }
  const mapPlace = typeof facts.place === 'string' ? facts.place : '';
  return {
    text, name: mapPlace || (typeof facts.spot === 'string' ? facts.spot : ''), kind: typeof facts.kind === 'string' ? facts.kind : '',
    region: (mapPlace && regionOfPlace(mapPlace, env.worldMap)) || writtenRegion(text, env.worldMap),
  };
}

function within(scope, here) {
  if (scope.kind === 'self') return true;
  if (!scope.value) return false;
  if (scope.kind === 'place' || scope.kind === 'home') return here.name === scope.value || here.text.includes(scope.value);
  return here.region === scope.value || here.text.includes(scope.value);
}

module.exports = { where, within, regionOfPlace };
