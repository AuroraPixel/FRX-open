'use strict';
/* World factors and difficulty in the cultivation-life play (玩法设计第九节「世界因子」; plan item 47).
 * The rules are content/life/world.json: each world factor chosen at creation (env.worldFactors, read
 * from the opening log by mechanics.worldFactorsOf) is a set of hooks the rules read; the difficulty
 * (frxPlay.difficulty, recorded at creation by new_life; the file's default when absent) a few knobs.
 * 灵气断绝's halved cultivation and 全民修仙's least realm stay the old code's (mechanics.cjs).
 *
 * factorsOf(env) → the save's world factors the file knows.
 * hooks(env, type) → [{ factor, type, … }]: the hooks of a type of those factors. The rules that read
 *   them: price and shopDrop (trade.cjs), danger and mindLoss (encounter.cjs), fortune, contest and
 *   lootAdd (rewards.cjs), pool (speed's pool, install), elementDamage (fight.cjs), craft
 *   (crafts.cjs), check (the names checkNames gives the actions and the encounter's spotting, read
 *   by perks.cjs).
 * priceFactor(env, good) → the factor on a good's price: the price hooks it falls under times the
 *   difficulty's prices. dropped(env, good) → whether a shop does not sell it (shopDrop).
 * difficulty(env) → { name, interrupts, prices, finish }.
 * loss(env, kind) → the loss a fight lost to `kind` comes to: finish (补刀) only where the difficulty
 *   allows it or the save is in extreme mode; else the file's `loss`.
 * checkNames(env) → ['世界·女性为尊·女'] …: the names perks.cjs reads as checkBonus effects (the check
 *   hook, by the player's sex in column 1).
 * craftBonus(env, craft) → the craft hooks' sum for a craft.
 * mindLoss(env, foeClass) → null | { value, factor, status? }: what meeting a foe of that class costs.
 * install(speed): the pool hook as a source of the bonus pool, once.
 */
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');

const WORLD = data('world');
const PREFIX = '世界·';

const factorsOf = env => [...new Set(env.worldFactors || [])].filter(name => Object.hasOwn(WORLD.factors, name));

function hooks(env, type) {
  return factorsOf(env).flatMap(factor => WORLD.factors[factor].hooks.filter(hook => hook.type === type).map(hook => ({ factor, ...hook })));
}

function difficulty(env) {
  const name = Object.hasOwn(WORLD.difficulties, env.play?.difficulty) ? env.play.difficulty : WORLD.difficulty;
  return { name, ...WORLD.difficulties[name] };
}

const covers = (hook, good) => (hook.kinds || []).includes(good?.kind) || (hook.classes || []).includes(good?.class);

function priceFactor(env, good) {
  return hooks(env, 'price').filter(hook => covers(hook, good)).reduce((value, hook) => value * hook.factor, 1) * difficulty(env).prices;
}

function dropped(env, good) {
  return hooks(env, 'shopDrop').some(hook => covers(hook, good) && (hook.words || []).some(word => plain(good.effect).includes(word))
    && require('./goods.cjs').TIERS.indexOf(good.tier) > require('./goods.cjs').TIERS.indexOf(hook.above));
}

const extreme = env => env.ctx.parseRemarksString(env.state['0']?.B1?.['9']).isExtreme === 'true';

function loss(env, kind) {
  return kind === 'finish' && !difficulty(env).finish && !extreme(env) ? WORLD.loss : kind;
}

// The player's sex: 女 or 男, read from column 1 (「林砚|男」, 「你|女性」); null when it says neither.
function sexOf(env) {
  const said = plain(env.state['0']?.B1?.['1']).split('|').slice(1).join('');
  return said.includes('女') ? '女' : said.includes('男') ? '男' : null;
}

function checkNames(env) {
  const sex = sexOf(env);
  return sex ? hooks(env, 'check').map(hook => `${PREFIX}${hook.factor}·${sex}`) : [];
}

// The effect a name of checkNames stands for (perks.cjs entriesOf), or null.
function effectOf(name) {
  if (!String(name).startsWith(PREFIX)) return null;
  const [factor, sex] = String(name).slice(PREFIX.length).split('·');
  const hook = WORLD.factors[factor]?.hooks.find(each => each.type === 'check');
  return hook ? { type: 'checkBonus', kinds: hook.kinds, value: sex === '女' ? hook.female : hook.male } : null;
}

const craftBonus = (env, craft) => hooks(env, 'craft').filter(hook => hook.crafts.includes(craft)).reduce((sum, hook) => sum + hook.value, 0);

function mindLoss(env, foeClass) {
  const found = hooks(env, 'mindLoss').find(hook => hook.classes.includes(foeClass));
  return found ? { value: found.value, factor: found.factor, ...(found.status ? { status: found.status } : {}) } : null;
}

// The bonus pool's term of a pool hook: the main method's texts with one of its words.
function pool(env) {
  const terms = hooks(env, 'pool');
  if (!terms.length) return [];
  const mechanics = require('../mechanics.cjs');
  const name = mechanics.cultivator(env).technique.name;
  const text = name ? require('./speed.cjs').methodTexts(env, name).join(' ') : '';
  return terms.filter(hook => hook.method.some(word => text.includes(word))).map(hook => ({ label: hook.factor, value: hook.value }));
}

let installed = false;
function install(speed) {
  if (installed) return;
  installed = true;
  speed.POOL.push(pool);
}

module.exports = { WORLD, PREFIX, factorsOf, hooks, difficulty, priceFactor, dropped, loss, sexOf, checkNames, effectOf, craftBonus, mindLoss, install };
