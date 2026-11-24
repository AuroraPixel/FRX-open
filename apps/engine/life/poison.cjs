'use strict';
/* 丹毒 and 耐药 (玩法设计第八节「丹药和丹毒」; plan item 44): the two visible limits on pills in the
 * cultivation life, read from content/life/poison.json. In a life save they replace the daily limit
 * a cultivation pill's own text sets; the novel's saves never reach this module (the use-item rule
 * asks it only when env.play is there).
 *
 * frxPlay.toxin     0 … cap: 丹毒. cap is the file's max plus every poisonCap effect the player has
 *                   (悟得「丹田宽厚」, the talents of item 48).
 * frxPlay.toxinCut  the max mana 丹毒 took at mana.at, given back when it falls below or is cleared.
 * frxPlay.pills     { 炼气: { 回露丹: 3 } }: how many of each cultivation pill raised progress in each
 *                   major realm (耐药).
 *
 * pillOf(name, effects?) → null, or { name, tier, gain, cultivation }: what a thing taken is to 丹毒
 *   and 耐药: a pill by the catalogue (kind 丹), else by how its name ends (the file's pill); its
 *   name and tier the catalogue's (unknownTier when it does not list it); gain what one adds, minus
 *   what a detox pill takes off (a player's talents multiply what it adds: their toxin factors);
 *   cultivation when one of its effects is 修为.
 * check(env, { name, quantity, effects }) and after(env, { pill, quantity, helped, applied }): the
 *   use-item rule's hooks (turn-rules lifePills; install puts them there):
 *   check   → null for anything but a pill; { refused } at the cap (a detox pill is still taken);
 *             else { pill, daily, helps, spent, eases }: daily false for a cultivation pill (its own
 *             daily limit gives way to 耐药), helps how many of `quantity` still raise progress,
 *             spent what the rule says when none does, eases when it takes 丹毒 down (then it is
 *             taken even when its other effects would be wasted)
 *   after   → { commands, stats, parts, fields }: 丹毒 moved by the pills taken, max mana across
 *             mana.at, the pill's count raised by `helped`. fields go on the receipt: toxin { before,
 *             after, cap }, pill (as view.pills shows it) and frxPlay, the new value, which settling
 *             the receipt makes env.play
 * breakthrough(env, { succeeded, aids }) → the settled receipt of kind "toxin" (source engine) after a
 *   breakthrough, or null when nothing moved: success clears 丹毒 and gives max mana back; a failure
 *   keeps what its aids (breakthrough.aids) added.
 * full(env) → whether 丹毒 is at the cap; level(env), capOf(env) the numbers.
 * month(env): the month step: below decay.below, 丹毒 drops by decay.per.
 * pool(env) → the bonus pool's 丹毒 term from slow.at.
 * view(env) → { toxin: { value, cap, marks, effects }, pills: [{ itemId, name, taken, left, text }] }
 *   for the state view: the bar, its three lines (mana.at, slow.at, the cap) and the effects in
 *   force; every cultivation pill in the bag with 「此丹已服三枚，尚可见效两枚」.
 * install(speed): the pool's source and the use-item hooks, once.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const chronicle = require('./chronicle.cjs');
const goods = require('./goods.cjs');
const perks = require('./perks.cjs');
const { data } = require('./data.cjs');
const { ownsNothing } = require('./play.cjs');

const RULES = data('poison');
const TOXIN = RULES.toxin;
const TEXTS = RULES.texts;
const MOST = RULES.tolerance.most;

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const level = env => Math.max(0, Number(env.play?.toxin) || 0);
const capOf = env => TOXIN.max + perks.effectsOf(env, 'poisonCap').reduce((sum, effect) => sum + (Number(effect.value) || 0), 0);
const full = env => level(env) >= capOf(env);
const gainOf = tier => TOXIN.gain[Math.min(TOXIN.gain.length - 1, Math.max(0, goods.TIERS.indexOf(tier)))];
// What a pill adds for this player: its gain times every toxin factor of the talents (百毒不侵 …),
// rounded; a detox pill's is as it is.
const gainFor = (env, pill) => (pill.gain > 0
  ? Math.round(pill.gain * perks.effectsOf(env, 'toxin').reduce((product, effect) => product * (Number(effect.factor) || 1), 1))
  : pill.gain);

function pillOf(name, effects = []) {
  const good = goods.lookup(name);
  const text = plain(name).split('|')[0].trim();
  if (good ? good.kind !== '丹' : !TOXIN.pill.some(end => text.endsWith(end))) return null;
  const key = good?.name ?? text;
  const tier = good?.tier ?? TOXIN.unknownTier;
  const detox = Number(TOXIN.detox[key]) || 0;
  return { name: key, tier, gain: detox ? -detox : gainOf(tier), cultivation: effects.some(effect => effect.stat === '修为') };
}

// ---------------------------------------------------------------- 耐药

const realmOf = env => mechanics.parseRealm(env.state['0']?.B1?.['2']).name;
const takenOf = (env, name) => Number(env.play?.pills?.[realmOf(env)]?.[name]) || 0;

function shown(name, taken) {
  const left = Math.max(0, MOST - taken);
  const template = !taken ? TEXTS.fresh : left ? TEXTS.taken : TEXTS.spent;
  return { name, taken, left, text: chronicle.fill(template, { 服: chronicle.count(taken), 余: chronicle.count(left) }) };
}

// ---------------------------------------------------------------- the use-item rule's hooks

function check(env, { name, quantity, effects }) {
  const pill = pillOf(name, effects);
  if (!pill) return null;
  const cap = capOf(env);
  if (pill.gain > 0 && level(env) >= cap) return { refused: chronicle.fill(TEXTS.full, { 满: chronicle.numeral(cap) }) };
  const eases = pill.gain < 0 && level(env) > 0;
  if (!pill.cultivation) return { pill, daily: true, helps: quantity, eases };
  const taken = takenOf(env, pill.name);
  return { pill, daily: false, helps: Math.max(0, Math.min(quantity, MOST - taken)), eases,
    spent: chronicle.fill(TEXTS.useless, { 丹: pill.name, 服: chronicle.count(taken) }) };
}

// The player's mana as it stands, with what the pill just did to it (`applied`, the use-item rule's).
function manaOf(env, applied = []) {
  const stat = mechanics.readStats(env, 'B1')['法力'];
  if (!stat) return null;
  const changed = applied.find(each => each.stat === '法力');
  return { current: changed ? changed.after : mechanics.statValue(stat), max: changed ? changed.max : mechanics.statValue(stat, 'max') };
}

const manaCommand = (current, max) => `updateAttribute("B1","法力",${JSON.stringify({ current, max })})`;

// Max mana across mana.at: a share of it taken when 丹毒 reaches it, what was taken given back when
// 丹毒 falls below it. `play` keeps toxinCut.
function shift(play, before, after, mana) {
  if (!mana || !(mana.max > 0)) return [];
  const at = TOXIN.mana.at;
  if (before < at && after >= at && !(play.toxinCut > 0)) {
    const cut = Math.max(1, Math.round(mana.max * TOXIN.mana.share));
    play.toxinCut = cut;
    return [manaCommand(Math.min(mana.current, mana.max - cut), mana.max - cut)];
  }
  if (after < at && play.toxinCut > 0) {
    const back = play.toxinCut;
    delete play.toxinCut;
    return [manaCommand(mana.current, mana.max + back)];
  }
  return [];
}

function after(env, { pill, quantity, helped, applied = [] }) {
  const play = structuredClone(env.play);
  const before = level(env), cap = capOf(env);
  const toxin = Math.max(0, Math.min(cap, before + gainFor(env, pill) * quantity));
  play.toxin = toxin;
  let tolerance = null;
  if (pill.cultivation) {
    const realm = realmOf(env), taken = takenOf(env, pill.name) + helped;
    if (helped) play.pills = { ...(isObject(play.pills) ? play.pills : {}), [realm]: { ...(play.pills?.[realm] || {}), [pill.name]: taken } };
    tolerance = shown(pill.name, taken);
  }
  const commands = shift(play, before, toxin, manaOf(env, applied));
  const parts = [
    ...(toxin !== before ? [`丹毒 ${before}→${toxin}`] : []),
    ...(commands.length ? [toxin >= TOXIN.mana.at ? TEXTS.mana : '法力上限复原'] : []),
    ...(tolerance ? [tolerance.text] : []),
  ];
  return { commands, stats: commands.length ? ['法力'] : [], parts,
    fields: { toxin: { before, after: toxin, cap }, ...(tolerance ? { pill: tolerance } : {}), frxPlay: play } };
}

// ---------------------------------------------------------------- the breakthrough, the month, the pool

async function breakthrough(env, { succeeded, aids = [] }) {
  const before = level(env), cap = capOf(env);
  const gain = aids.reduce((sum, aid) => {
    const pill = pillOf(aid.name);
    return sum + (pill ? gainFor(env, pill) : 0) * (Number(aid.count) || 0);
  }, 0);
  const toxin = succeeded ? 0 : Math.max(0, Math.min(cap, before + gain));
  if (toxin === before && !(toxin < TOXIN.mana.at && env.play.toxinCut > 0)) return null;
  const commands = shift(env.play, before, toxin, manaOf(env));
  env.play.toxin = toxin;
  return env.settle({
    kind: 'toxin', ok: true, source: 'engine', toxin: { before, after: toxin, cap },
    commands: commands.join('\n'), owns: { ...ownsNothing(), stats: commands.length ? ['法力'] : [] },
    summary: (succeeded ? `${TEXTS.cleared}：` : '服下辅助丹药：') + `丹毒 ${before}→${toxin}` + (commands.length ? `；${toxin >= TOXIN.mana.at ? TEXTS.mana : '法力上限复原'}` : ''),
  });
}

async function month(env) {
  const toxin = level(env);
  if (toxin > 0 && toxin < TOXIN.decay.below) env.play.toxin = Math.max(0, toxin - TOXIN.decay.per);
}

const pool = env => (level(env) >= TOXIN.slow.at ? [{ label: TEXTS.pool, value: TOXIN.slow.value }] : []);

// ---------------------------------------------------------------- the view

function view(env) {
  const value = level(env), cap = capOf(env);
  const effects = [
    ...(value >= TOXIN.mana.at ? [TEXTS.mana] : []),
    ...(value >= TOXIN.slow.at ? [TEXTS.slow] : []),
    ...(value >= cap ? [chronicle.fill(TEXTS.full, { 满: chronicle.numeral(cap) })] : []),
  ];
  const stored = env.ctx.storedItemIds(env.state);
  const pills = Object.entries(env.state['1'] || {}).flatMap(([id, row]) => {
    if (!row || stored.has(id)) return [];
    const parsed = rules.parseEffects(row['4']).length ? rules.parseEffects(row['4']) : rules.parseEffects(row['3']);
    const pill = pillOf(row['1'], parsed);
    return pill?.cultivation ? [{ itemId: id, ...shown(pill.name, takenOf(env, pill.name)) }] : [];
  });
  return { toxin: { value, cap, marks: [TOXIN.mana.at, TOXIN.slow.at, cap], effects }, pills };
}

let installed = false;
function install(speed) {
  if (installed) return;
  installed = true;
  speed.POOL.push(pool);
  rules.lifePills.check = check;
  rules.lifePills.after = after;
}

module.exports = { RULES, pillOf, check, after, shift, breakthrough, full, level, capOf, month, pool, view, install };
