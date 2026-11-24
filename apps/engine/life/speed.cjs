'use strict';
/* How fast the player cultivates in the cultivation-life play, beyond the old rule's root, method,
 * aura and world factor (gameplay design 七「修炼速度」, plan item 12):
 *
 *   每日修为 = 100 ÷ 步日数 × 灵根 × 功法 × 契合 × 环境 × 世界因子 ×（1 + 加成）
 *
 * mechanics.cultivate takes the two new terms as options, so the old play never sees them. The
 * numbers are content/life/verbs.json's.
 *
 * affinityOf(env, c) → { factor, method, root, why }
 *   契合: the mismatch factor when the main method names its element (木属性, 火系; 五行 is all five)
 *   and the root names its elements and they share none; 1 when either names none, or when a talent
 *   of the player's waives it (an affinity effect in content/life/traits.json: 五行轮转 and its like,
 *   plan item 48). `c` is mechanics.cultivator(env). method and root are the elements read ("木",
 *   "水火"; "" when none); why says it in a few words for the preview.
 * bonusPool(env) → { value, sum, terms: [{ label, value }] }
 *   加成: every source's terms, summed and capped; `value` is what cultivating uses, a fraction
 *   (0.1 is +10%), `sum` the uncapped total.
 * POOL: the pool's sources, each (env) => [{ label, value }], value a fraction, label for the
 *   preview. 根基 (item 22), 悟得 and the talents (23, 48: perks.poolTerms) and 丹毒 (44) add theirs.
 * methodTexts(env, name) → the main method's texts (its worn 功法 row, the learned skill of that
 *   name): what an effect's `method` words are looked for in.
 * stepDaysOf(major) → the days a step of the realm takes in this play: the rule table's
 *   (content/cultivation.json stepDays) over content/life/verbs.json cultivate.pace. Cultivating,
 *   压境 and the people's cultivating all count by it (the numeric balance, plan item 50's fixes).
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');
const traits = require('./traits.cjs');

const RULES = data('verbs').cultivate;
const POOL = [];
const STEP_DAYS = mechanics.CULTIVATION.stepDays;
const ORDER = mechanics.COMBAT.realms.order;

function stepDaysOf(major) {
  const name = ORDER[Math.max(0, major)];
  const days = STEP_DAYS[name] ?? STEP_DAYS.higher;
  const pace = RULES.pace[name] ?? RULES.pace.higher;
  return days / pace;
}

const unique = text => [...new Set(text)].join('');

// The elements a text names: every word of `every` (五行) for all its elements, then each element
// character, or only those followed by 属性 or 系 when `marked` (a method's description says 金丹
// and 水平 without meaning either).
function elementsIn(text, marked) {
  const { elements, every } = RULES.affinity;
  let found = '';
  for (const [word, all] of Object.entries(every)) if (text.includes(word)) found += all;
  const pattern = new RegExp(`([${elements}])${marked ? '\\s*(?:属性|系)' : ''}`, 'g');
  for (const match of text.matchAll(pattern)) found += match[1];
  return unique(found);
}

// The main method's texts: the worn 功法 or the learned skill mechanics.cultivator took, by name.
function methodTexts(env, name) {
  if (!name) return [];
  const texts = [];
  for (const item of env.ctx.equippedItemRows(env.state['0']?.B1)) {
    if ((item?.type ?? item?.['2']) !== '功法' || plain(item.name ?? item['1']).split('|')[0] !== name) continue;
    texts.push(item.name ?? item['1'], item.grade ?? item['6'], item.description ?? item['3'], item.currentEffect ?? item['9'], item.effect ?? item['4']);
  }
  for (const skill of Object.values(env.state['8'] || {})) {
    if (skill && plain(skill['1']).split('|')[0] === name) texts.push(skill['1'], skill['2'], skill['3'], skill['4'], skill['5']);
  }
  return texts.map(plain);
}

// The first talent of the player's that waives 契合 (an affinity effect), or undefined.
const waiverIn = remarks => traits.namesIn(remarks).find(name => traits.effectsOf(name).some(effect => effect.type === 'affinity'));

function affinityOf(env, c) {
  const method = elementsIn(methodTexts(env, c.technique.name).join(' '), true);
  const root = c.root.assumed ? '' : elementsIn(c.root.label, false);
  const waived = waiverIn(c.remarks);
  const apart = method && root && ![...method].some(element => root.includes(element));
  if (!apart) return { factor: 1, method, root, why: method && root ? `功法属${method}，灵根有${root}` : '' };
  if (waived) return { factor: 1, method, root, why: `功法属${method}，灵根无此行，天赋「${waived}」免去` };
  return { factor: RULES.affinity.mismatch, method, root, why: `功法属${method}，灵根是${root}` };
}

function bonusPool(env) {
  const terms = POOL.flatMap(source => source(env));
  const sum = terms.reduce((total, term) => total + term.value, 0);
  return { value: Math.min(RULES.bonus.max, Math.max(RULES.bonus.min, sum)), sum, terms };
}

module.exports = { affinityOf, bonusPool, methodTexts, stepDaysOf, POOL };
