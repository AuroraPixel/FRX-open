'use strict';
/* 悟得 (玩法设计第七节「悟得」; plan item 23): every major realm broken offers three of a fixed list,
 * the player keeps one for good. The list, the rare chances and the effects are
 * content/life/perks.json. A perk changes numbers through the hooks below and never an attribute
 * (the player's column 11): the world book has attributes grow with realms only.
 *
 * frxPlay keeps: perks [names] the player has; offer null | [{ index, name, text, rare }] the three
 * waiting to be chosen; perkUses { 静气: "0001-03", 守拙: "0001" } the month or year a limited perk
 * was last used.
 *
 * available(name) → whether the perk can be drawn: the module of the item it depends on (needs) is
 *   there (apps/engine/life/<module>.cjs). A perk whose item is not done is not offered.
 * perksOf(env) → the player's perks (frxPlay.perks).
 * owned(env) → the names whose effects count: the perks, then the talents (天赋, traits.cjs, plan
 *   item 48), whose effects are written in the same vocabulary; every hook below reads both, a
 *   perk's term labelled 悟得「…」 and a talent's 天赋「…」.
 * draw(env, { gate, foundation, band }) → three distinct names: on the gate's timeline seed
 *   (seedOf { kind: gate, gate: <gate>·悟得 }), from the available perks the player does not have;
 *   each pick is rare with rare.chance[band] (band: the 气运 modifier band), and a foundation of
 *   rare.guaranteedBy makes one of the three rare when none came up.
 * offer(env, args) → the offer, drawn as above and kept in frxPlay.offer.
 * pending(env) → whether an offer waits to be chosen; hold(env, kind) the hook that makes every
 *   other verb wait for it (「先选一条悟得」).
 * The verb perk { index } (a verbs.cjs plan, installed by install): takes the offer's index-th perk
 *   into frxPlay.perks and clears the offer; 延年 adds to 寿元 (a remark, not an attribute).
 *   Receipt { kind: "perk", perk, lifespan? }.
 * The op calm { clock }: 守拙 turns one clock back a step, once a year (clocks.bump). Receipt
 *   { kind: "calm", perk, clock: the change }. Output { clock }.
 * calmRow(env) → 守拙 among the standing commands (chained onto verbs.hooks.more): where the player
 *   has it and a clock stands, { kind: calm, glyph: 拙, label, word: its once-a-year words, options:
 *   [{ value: clock id, label: clock name }] }; used this year, with the note why instead (off).
 * install(verbs, speed): the verb, the hold and aura hooks, 守拙's row and 草木知音's pool source, once.
 *
 * effectsOf(env, type) → the effects of that type the player has, each { name, type, … }.
 * The hooks, each reading the names as a list (pure) or from env:
 *   checkBonus(perks, kind)        → { value, names }  check bonus (脚底抹油: 脱身 +2), the price's
 *   tierSteps(perks, kind, hour)   → { steps, names }  tier down (夜行: 潜行 at night)
 *   insight(perks, kind)           → names             more on the card (察言观色: 交涉)
 *   canReroll(env, kind) / use(env, name)              monthly reroll (静气: 交涉, 欺瞒), the act's
 *   auraFloor(env, aura)           → aura              aura floor (吐纳绵长: 薄 counts as 中), for
 *                                                      the aura cultivating takes
 *   poolTerms(env, place)          → [{ label, value }] the bonus pool (草木知音: +10% in 山野); an
 *                                                      effect may hold only placeKinds, `when`
 *                                                      night, day or hurt (状态不是一切正常, or
 *                                                      内伤), or `method` words of the main method
 *   hitBonus(env, { first })       → { value, names }  hit bonus (先声夺人: the first strike when
 *                                                      the player moves first), for the fight; an
 *                                                      effect may hold only placeKinds, `when`
 *                                                      firstStrike or hurt, `weapon` words of the
 *                                                      weapon worn, or unarmed (none worn)
 *   calm(env, clockId)             → { refused } | { change } the yearly clock step (守拙)
 *   lifespan                       applied by choose (延年)
 */
const fs = require('node:fs');
const path = require('node:path');
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const { list, ownsNothing } = require('./play.cjs');
const traits = require('./traits.cjs');

const PERKS = data('perks');
const NAMES = Object.keys(PERKS.perks);
const isRare = name => !!PERKS.perks[name]?.rare;

const available = name => {
  const needs = PERKS.perks[name]?.needs;
  return !!needs && fs.existsSync(path.join(__dirname, `${needs.module}.cjs`));
};

const perksOf = env => list(env.play?.perks).filter(name => Object.hasOwn(PERKS.perks, name));
// The birth's own effects (content/life/births.json start.effects, plan item 47), as 出身·<name>.
const BIRTHS = data('births').births;
const BIRTH = '出身·';
const birthEffects = name => (String(name).startsWith(BIRTH) ? BIRTHS[String(name).slice(BIRTH.length)]?.start?.effects || null : null);
const birthNames = env => (birthEffects(BIRTH + env.play?.birth) ? [BIRTH + env.play.birth] : []);
const owned = env => [...perksOf(env), ...(env.state ? traits.talentsOf(env) : []), ...birthNames(env)];

// The effects of a type among the names, with each one's name: a perk has one, a gear trait (perks.json
// traits, written the same way; the actions module passes the worn gear's, gear.cjs) one, a talent any,
// and the use of the spirit beast out with the player one (灵兽·寻宝: content/life/beasts.json uses;
// beasts.useNames gives it to the actions module and the encounter's spotting).
const isTrait = name => name !== 'notes' && Boolean(PERKS.traits) && Object.hasOwn(PERKS.traits, name);
const BEAST_USES = data('beasts').uses;
const BEAST = '灵兽·';
const isBeastUse = name => String(name).startsWith(BEAST) && Object.hasOwn(BEAST_USES, String(name).slice(BEAST.length));
const entriesOf = name => {
  if (Object.hasOwn(PERKS.perks, name)) return [PERKS.perks[name].effect];
  if (isTrait(name)) return [PERKS.traits[name].effect];
  if (isBeastUse(name)) return [BEAST_USES[name.slice(BEAST.length)].effect];
  if (birthEffects(name)) return birthEffects(name);
  // A world factor's check hook (world.cjs checkNames: 世界·女性为尊·女).
  if (String(name).startsWith('世界·')) return [require('./world.cjs').effectOf(name)].filter(Boolean);
  return traits.effectsOf(name);
};
const effects = (names, type) => list(names).flatMap(name => entriesOf(name).filter(effect => effect?.type === type)
  .map(effect => ({ name, ...effect })));
const labelOf = name => (isBeastUse(name) ? `灵兽「${name.slice(BEAST.length)}」` : birthEffects(name) ? `出身「${name.slice(BIRTH.length)}」`
  : String(name).startsWith('世界·') ? `世界「${name.split('·')[1]}」`
  : `${Object.hasOwn(PERKS.perks, name) ? '悟得' : isTrait(name) ? '器物' : '天赋'}「${name}」`);

// The effects of a type the player has: { name, type, ...numbers } (丹田宽厚's poisonCap …).
const effectsOf = (env, type) => effects(owned(env), type);

// ---------------------------------------------------------------- drawing and choosing

function draw(env, { gate, foundation = null, band = 0 } = {}) {
  const random = env.random({ kind: 'gate', gate: `${gate}·悟得` });
  const chances = PERKS.rare.chance;
  const chance = chances[Math.max(0, Math.min(chances.length - 1, Number(band) || 0))];
  const mine = perksOf(env);
  const pool = NAMES.filter(name => available(name) && !mine.includes(name));
  const picked = [];
  while (picked.length < PERKS.offer.count && pool.length) {
    const rare = pool.filter(isRare), common = pool.filter(name => !isRare(name));
    const from = (random.random() < chance && rare.length) || !common.length ? rare : common;
    const name = from[Math.floor(random.random() * from.length)];
    picked.push(name);
    pool.splice(pool.indexOf(name), 1);
  }
  if (foundation === PERKS.rare.guaranteedBy && picked.length && !picked.some(isRare)) {
    const rare = pool.filter(isRare);
    if (rare.length) picked[picked.length - 1] = rare[Math.floor(random.random() * rare.length)];
  }
  return picked;
}

const shown = (name, index) => ({ index, name, text: PERKS.perks[name].text, ...(isRare(name) ? { rare: true } : {}) });

function offer(env, args) {
  const names = draw(env, args);
  env.play.offer = names.length ? names.map((name, i) => shown(name, i + 1)) : null;
  return env.play.offer;
}

const pending = env => list(env.play?.offer).length > 0;

// The verb perk { index }: a plan for verbs.cjs (nothing changes until it is done). The commands
// are 延年's years; the perk joins frxPlay.perks and the offer goes once the receipt is settled.
function perk(env, verb) {
  const offered = list(env.play.offer);
  if (!offered.length) return { refused: '眼下没有可选的悟得' };
  const picked = offered.find(entry => entry.index === Number(verb.index));
  if (!picked || !Object.hasOwn(PERKS.perks, picked.name)) return { refused: `没有第${String(verb.index ?? '').slice(0, 8)}条悟得` };
  const commands = [];
  let lifespan = null;
  for (const effect of effects([picked.name], 'lifespan')) {
    const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
    const before = mechanics.numberIn(remarks['寿元']);
    if (before === null) continue;
    lifespan = { before, after: before + effect.value };
    commands.push(`add("B1",${JSON.stringify({ 9: { 寿元: String(lifespan.after) } })})`);
  }
  const now = mechanics.readClock(env.state);
  const said = `悟得「${picked.name}」：${picked.text}` + (lifespan ? `；寿元 ${lifespan.before}→${lifespan.after}` : '');
  return {
    minutes: 0,
    receipt: { kind: 'perk', ok: true, source: 'verb', perk: picked, ...(lifespan ? { lifespan } : {}), commands: commands.join('\n'), owns: ownsNothing(), summary: said },
    line: ['perk', { 悟得: picked.name }],
    preview: { ok: true, minutes: 0, ends: clock.dateOf(now.minutes), lines: [said], formula: [] },
    finish: () => {
      env.play.perks = [...perksOf(env), picked.name];
      env.play.offer = null;
    },
  };
}

// Every verb but perk waits while an offer does (plan item 23).
const hold = (env, kind) => (kind !== 'perk' && pending(env) ? '先选一条悟得' : null);

// ---------------------------------------------------------------- the hooks

function checkBonus(perks, kind) {
  const found = effects(perks, 'checkBonus').filter(effect => effect.kinds.includes(kind));
  return { value: found.reduce((sum, effect) => sum + effect.value, 0), names: found.map(effect => effect.name) };
}

const atNight = hour => Number.isFinite(hour) && (hour >= PERKS.night.from || hour < PERKS.night.to);

function tierSteps(perks, kind, hour) {
  const found = effects(perks, 'tierDown').filter(effect => effect.kinds.includes(kind) && (effect.when !== 'night' || atNight(hour)));
  return { steps: found.reduce((sum, effect) => sum + effect.steps, 0), names: found.map(effect => effect.name) };
}

const insight = (perks, kind) => effects(perks, 'insight').filter(effect => effect.kinds.includes(kind)).map(effect => effect.name);

// The month or the year a limited perk counts its use by: "0001-03", "0001".
function periodOf(env, per) {
  const now = mechanics.readClock(env.state);
  if (!now) return null;
  const month = clock.monthKey(clock.monthOf(now.minutes));
  return per === 'year' ? month.slice(0, 4) : month;
}

function unused(env, name) {
  const effect = PERKS.perks[name]?.effect;
  const period = periodOf(env, effect?.per);
  return owned(env).includes(name) && period !== null && (env.play.perkUses?.[name] ?? null) !== period;
}

function canReroll(env, kind) {
  return effects(owned(env), 'reroll').find(effect => effect.kinds.includes(kind) && unused(env, effect.name))?.name ?? null;
}

function use(env, name) {
  const period = periodOf(env, PERKS.perks[name]?.effect?.per);
  env.play.perkUses = { ...(env.play.perkUses && typeof env.play.perkUses === 'object' ? env.play.perkUses : {}), [name]: period };
}

function auraFloor(env, aura) {
  const lift = effects(owned(env), 'auraFloor').find(effect => effect.from === plain(aura));
  return lift ? lift.to : aura;
}

// What an effect's conditions ask of the moment (required where used: these modules require this one).
const placeKind = env => require('./places.cjs').factsOf(mechanics.placeOf(env.state), env.worldMap).kind;
const hourOf = env => {
  const now = mechanics.readClock(env.state);
  return now?.timed ? Math.floor((now.minutes % clock.DAY_MINUTES) / 60) : null;
};
// Hurt: a status other than all well, or 内伤 not yet healed.
const hurt = env => !['', '一切正常'].includes(plain(env.state['0']?.B1?.['4'])) || !!require('./injury.cjs').active(env);
const methodText = env => require('./speed.cjs').methodTexts(env, mechanics.cultivator(env).technique.name).join(' ');
const weapons = env => env.ctx.equippedItemRows(env.state['0']?.B1).filter(item => (item?.type ?? item?.['2']) === '武器')
  .map(item => plain(item.name ?? item['1']));

function holds(env, effect, { kind, first }) {
  if (effect.placeKinds && !effect.placeKinds.includes(kind())) return false;
  if (effect.when === 'night' && !atNight(hourOf(env))) return false;
  if (effect.when === 'day' && atNight(hourOf(env))) return false;
  if (effect.when === 'hurt' && !hurt(env)) return false;
  if (effect.when === 'firstStrike' && !first) return false;
  if (effect.method && !effect.method.some(word => methodText(env).includes(word))) return false;
  if (effect.weapon && !weapons(env).some(name => effect.weapon.some(word => name.includes(word)))) return false;
  if (effect.unarmed && weapons(env).length) return false;
  return true;
}

// `place` is what the places module reads the place as (its kind); the player's own place when left out.
function poolTerms(env, place = null) {
  const kind = () => place?.kind ?? placeKind(env);
  return effects(owned(env), 'bonus').filter(effect => holds(env, effect, { kind }))
    .map(effect => ({ label: labelOf(effect.name), value: effect.value }));
}

function hitBonus(env, { first = false } = {}) {
  const found = effects(owned(env), 'hitBonus').filter(effect => holds(env, effect, { kind: () => placeKind(env), first }));
  return { value: found.reduce((sum, effect) => sum + effect.value, 0), names: found.map(effect => effect.name) };
}

function calm(env, clockId) {
  const effect = effects(owned(env), 'clockStep')[0];
  if (!effect) return { refused: '没有能让压力钟退一格的悟得' };
  if (!unused(env, effect.name)) return { refused: `「${effect.name}」今年已经用过了` };
  const found = list(env.play.clocks).find(each => each.id === clockId);
  if (!found) return { refused: '没有这口钟' };
  const change = clocks.bump(env, found.id, -effect.steps, `悟得「${effect.name}」`);
  if (!change) return { refused: `「${found.name}」退不了了` };
  use(env, effect.name);
  return { change, perk: effect.name };
}

// The op calm { clock }: 守拙 takes a step off a clock, once a year.
async function calmOp(env, args) {
  const done = calm(env, plain(args.clock));
  if (done.refused) return env.refuse(done.refused);
  await env.settle({ kind: 'calm', ok: true, source: 'verb', perk: done.perk, clock: done.change, commands: '', owns: ownsNothing(),
    summary: `悟得「${done.perk}」：「${done.change.name}」${done.change.before}→${done.change.after}格` });
  return { clock: done.change };
}

// 守拙 among the standing commands (the documents pass, #10: owned, it had no control on the page): its
// row where the player has a perk that steps a clock back and a clock stands, the clocks to choose from
// and the perk's own words (每年一次，让一口压力钟退一格); used this year, off with why. A clock chosen
// sends verb calm { clock }, which the server plays as the calm op.
function calmRow(env) {
  const effect = effects(owned(env), 'clockStep')[0];
  const standing = list(env.play?.clocks).filter(each => Number(each?.value) > 0);
  if (!effect || !standing.length) return [];
  const row = { kind: 'calm', glyph: '拙', label: effect.name };
  // the reason stands after its name under the commands: 「守拙　今年已经用过了」
  if (!unused(env, effect.name)) return [{ ...row, note: '今年已经用过了' }];
  return [{ ...row, word: PERKS.perks[effect.name]?.text || '', options: standing.map(each => ({ value: each.id, label: each.name })) }];
}

let installed = false;
function install(verbs, speed) {
  if (installed) return;
  installed = true;
  verbs.VERBS.perk = perk;
  verbs.hooks.hold = hold;
  verbs.hooks.aura = auraFloor;
  const more = verbs.hooks.more;
  verbs.hooks.more = env => [...more(env), ...calmRow(env)];
  speed.POOL.push(env => poolTerms(env));
}

module.exports = {
  PERKS, available, perksOf, owned, effectsOf, labelOf, draw, offer, pending, perk, hold,
  checkBonus, tierSteps, insight, canReroll, use, auraFloor, poolTerms, hitBonus, calm, calmOp, calmRow, atNight, install,
};
