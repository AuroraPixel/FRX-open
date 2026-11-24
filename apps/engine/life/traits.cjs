'use strict';
/* Talents (天赋; 玩法设计第七节「悟得」末段, plan item 48): what the player's talents do in the
 * cultivation life, read from content/life/traits.json in the perks' vocabulary (an effect is a
 * type and a few numbers, as content/life/perks.json writes them). A talent's own text and its
 * stat bonuses are creation's (content/creation.json, applied as they always were); nothing here
 * touches an attribute column.
 *
 * TRAITS          the file: kinds (the types it knows: live ones and what reads them, the rest by
 *                 the item that will), traits (each talent's effects, or only 文字)
 * namesIn(remarks) → the talent names a remarks object (parseRemarksString) holds in `traits`
 * talentsOf(env)  → the player's talents the file knows (B1's remarks)
 * effectsOf(name) → a talent's effects, [] for one that is only text or unknown
 * The rules read talents through perks.cjs, whose owned(env) and effectsOf(env, type) take the
 * talents with the perks.
 */
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');

const TRAITS = data('traits');

function namesIn(remarks) {
  try {
    const parsed = JSON.parse(remarks?.traits ?? '[]');
    return Array.isArray(parsed) ? parsed.map(trait => plain(trait?.name)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const talentsOf = env => namesIn(env.ctx.parseRemarksString(env.state['0']?.B1?.['9'])).filter(name => Object.hasOwn(TRAITS.traits, name));
const effectsOf = name => (Object.hasOwn(TRAITS.traits, name) ? TRAITS.traits[name].effects || [] : []);

module.exports = { TRAITS, namesIn, talentsOf, effectsOf };
