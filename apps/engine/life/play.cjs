'use strict';
/* Small helpers on frxPlay (docs/gameplay-plan.md, 「存档里多存什么」): a list key that may be
 * missing in an older value, and the next id from frxPlay.counters (K1 for clocks, D1 for calendar
 * entries, P1 for pending events), which never hands out an id twice in a save.
 */
const list = value => (Array.isArray(value) ? value : []);

function nextId(env, counter, prefix) {
  const counters = env.play.counters && typeof env.play.counters === 'object' ? env.play.counters : (env.play.counters = {});
  counters[counter] = (Number.isSafeInteger(counters[counter]) ? counters[counter] : 0) + 1;
  return prefix + counters[counter];
}

const ownsNothing = () => ({ items: [], stats: [], forbid: [], charStats: [], skills: [], quests: [], grants: [], currency: false });

module.exports = { list, nextId, ownsNothing };
