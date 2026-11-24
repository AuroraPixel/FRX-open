'use strict';
/* The cultivation-life play's own terms of a gate's odds, which the player's gates (gate.cjs) and
 * the people's (people.cjs) share (the numeric balance, plan item 50's fixes; content/life/gates.json):
 *
 * senseModifier(major, value) → the 神识 term: 神识 against what is normal for the realm the
 *   attempt is made from (content/combat.json baselines, the top of the realm's range), stepped by
 *   gates.json sense.steps ([ratio, modifier], the highest reached). The old rule's bands are
 *   absolute, and 神识 grows tenfold a realm, so every gate came easier than the one before.
 *   气运 does not grow with the realm and keeps the old bands.
 * dcOf(target, dc) → the gate into the major realm `target` as hard as this play has it: the old
 *   rule's difficulty by the root (`dc`) plus gates.json gates[realm].harder.
 */
const mechanics = require('../mechanics.cjs');
const { data } = require('./data.cjs');

const GATES = data('gates');
const ORDER = mechanics.COMBAT.realms.order;

function senseModifier(major, value) {
  const range = mechanics.COMBAT.baselines[ORDER[Math.max(0, major)]]?.[GATES.sense.stat];
  const top = range ? range[1] : 0;
  if (!(top > 0)) return mechanics.modifierFor(value);
  const ratio = (Number(value) || 0) / top;
  return GATES.sense.steps.reduce((found, [floor, modifier]) => (ratio >= floor ? modifier : found), 0);
}

function dcOf(target, dc) {
  return dc + (Number(GATES.gates[ORDER[target]]?.harder) || 0);
}

module.exports = { senseModifier, dcOf };
