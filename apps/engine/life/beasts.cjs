'use strict';
/* Spirit beasts in the cultivation-life play (灵兽, 玩法设计第八节「灵兽」; plan item 41): keeping
 * them, feeding them, their tier cap and promotion, their temperament, binding, their injuries, the
 * one that goes out with the player, its use in daily life, and the beast's side of a fight (the
 * fight engine, fight.cjs, calls joining, fighterOf, actFor, hurt, tameTerms and tamed). The numbers
 * are content/life/beasts.json. The beasts themselves stay the card's table 7 (P1, P2 …: 1 name,
 * 2 level 一阶下品, 3 looks, 4 personality, 5 skills, 6 mood, 7 aptitude 凡品|35, 8 气血 60/60,
 * 9 法力 20/20, 10 favour); the eight grades of aptitude and their maxima are the old page's
 * (core/beasts.cjs BEAST_APTITUDE_CONFIG, parseBeastAptitude). The old panel action feed
 * (panel.cjs, handlePersistentFeed) is untouched: a save in this play feeds through the op feed.
 *
 * frxPlay.beasts { <beast id>: record }, a record kept once an op has touched the beast:
 *   { temperament, bound?, out?, fed?: { month, count }, injury?: { until }, binding?, source?, since? }
 *   temperament 凶悍 | 机警 | 狡黠 (else read from the personality column's words, then drawn by
 *               species: temperOf); bound false until the verb bind is done (a row with no record
 *               counts as bound: the old play's beasts were tamed long ago); out the one that goes
 *               out with the player; fed the month's feeds; injury the day a badly hurt beast is
 *               well again; binding the days of binding done.
 * frxPlay.eggs [{ id, name, species, tier, due, laid, from }]: eggs hatching; one hatches at the
 *   first month step after its due day (month).
 *
 * keepCap(env) → base + the 神识 band (the panel's own 神识); eggs count as kept (keptCount).
 * outBeast(env) → { id, row, name } | null: the beast marked out, bound and not injured.
 * Its use (uses: one per species, content/art/species.json) is the only one that counts:
 *   mountBands(env) → bands the day's walk goes up (代步; travel.cjs)
 *   forage(env) → { count, beast } | null: one more share of what gathering brings (寻药; rewards.cjs)
 *   alert(env) → { beast } | null: an encounter from an interruption is spotted by the player first,
 *     so never an ambush (警戒; encounter.cjs)
 *   useNames(env) → ['灵兽·寻宝'] while a 寻宝 beast is out: the name perks.cjs reads as a checkBonus
 *     (探查 +2), for card prices (actions.cjs) and the encounter's spotting (encounter.cjs)
 *   helpers(env) → [{ id, name }]: the extra helper when the home is attacked (守府; item 45)
 * The fight's side:
 *   joining(env, commands) → { id, name, temperament, hp? } | null: the out beast joins a fight
 *     (its 气血 back when its injury is over); fighterOf(env, id) → the beast as a fighter (its
 *     tier's baseline panel with its own 气血 and 法力); actFor(env, id, order) → { act, order?,
 *     obeyed?, note? }: its temperament's act, or the order when its favour reaches obey.favour;
 *   hurt(env, id, hp, commands) → null | { injury } | { died }: its 气血 written, and at 0 badly
 *     hurt (injury by its tier, on the calendar), or dead in extreme mode (the row deleted);
 *   tameTerms(env, player, foe) → { refused } | the check's terms: 魅力 with the active gear, the
 *     talents' 驭兽 craft bonus and hooks.mastery (the 驭兽 mastery of plan item 42, +0 until that
 *     module sets the hook); tamed(env, { name, tier, hp, mp, outcome, commands }) → { id, name }:
 *     the beast written to table 7 (not yet bound); hooks.tamed is told of it.
 * The ops:
 *   feed { beastId, itemId }  feeds one thing from the bag: at most feed.perMonth a month; the old
 *                             feed's draw (feedDraw) with the gain times the food's tier and the
 *                             same element; receipt beast (action feed)
 *   beast { action, … }       out { beastId }, in, hatch { itemId }, buy { name, price, tier?,
 *                             species? }, gift { from }, promote { beastId, itemId }, view; receipt
 *                             beast (out and in hidden)
 * The verb bind { beastId } (verbs.cjs plan, install): bind.days days; receipt beast (action bind).
 * month(env, entered): the month step: eggs due hatch, injuries over heal, every beast not hurt is
 *   whole again; one receipt beast (action month) when something happened.
 * view(env) → { kept, cap, out, list: [beast], eggs } (the life view): each beast { id, name,
 *   species, use?, temperament, act, level, tier, cap, aptitude, hp, mp, favour, obeys, bound, out,
 *   injury?, feeds: { left, month }, foods: [{ itemId, name, tier, factor, same, low, high, crit }] }.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create: stream } = require('../core/random.cjs');
const { BEAST_APTITUDE_CONFIG, parseBeastAptitude } = require('../core/beasts.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const clock = require('./clock.cjs');
const gear = require('./gear.cjs');
const goods = require('./goods.cjs');
const perks = require('./perks.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');
const SPECIES = require('../../../content/art/species.json').rules;

const BEASTS = data('beasts');
const FOES = data('foes');
const TEXTS = BEASTS.texts;
const ACTS = BEASTS.acts;
const USES = BEASTS.uses;
const TEMPERS = Object.fromEntries(Object.entries(BEASTS.temperaments).filter(([, each]) => each && typeof each === 'object' && each.act));
const USE_OF = Object.fromEntries(Object.entries(USES).flatMap(([name, use]) => use.species.map(species => [species, name])));
const GRADES = BEAST_APTITUDE_CONFIG.map(grade => grade.name);
const BANDS = rules.RULES.modifierBands;
const DAY = clock.DAY_MINUTES;
const NUMERALS = '一二三四五六七八九十';
const PREFIX = '灵兽·';
const J = JSON.stringify;

const rowName = row => plain(row?.['1']).split('|')[0];
const fill = (template, values) => chronicle.fill(template, values);
const band = value => BANDS.reduce((found, [floor, bonus]) => (value >= floor ? bonus : found), 0);
const argOf = (args, camel, snake) => plain(args?.[camel] ?? args?.[snake] ?? '');

// The hooks the 驭兽 mastery plugs into (plan item 42, crafts.cjs): mastery(env) → { value, name? },
// and tamed(env, { id, name }) once a beast is tamed (it counts for the mastery).
const hooks = { mastery: () => ({ value: 0 }), tamed: () => {} };

// ---------------------------------------------------------------- reading a beast

const ELEMENT_WORDS = Object.entries(FOES.elements.words).flatMap(([element, words]) => words.map(word => [word, element]));
function elementIn(text) {
  const source = plain(text);
  let found = null, at = Infinity;
  for (const [word, element] of ELEMENT_WORDS) {
    const index = source.indexOf(word);
    if (index >= 0 && index < at) { found = element; at = index; }
  }
  return found;
}
const baseOf = element => FOES.elements.base[element] || element;

const speciesIn = text => SPECIES.find(rule => rule.anyWord.some(word => plain(text).includes(word)))?.species ?? null;
const speciesOf = row => speciesIn(rowName(row)) || speciesIn(row?.['3']);
const useOf = row => USE_OF[speciesOf(row)] || null;

// A species' element: the first catalogue 妖丹 of it that has one.
const speciesElement = species => goods.GOODS.find(good => good.species === species && good.element)?.element || null;
const elementOf = row => elementIn(rowName(row)) || speciesElement(speciesOf(row));

// 一阶下品 → 1; 凡兽 → 0; unreadable → 1.
function tierOfLevel(text) {
  const match = plain(text).match(/([一二三四五六七八九十])阶/);
  if (match) return NUMERALS.indexOf(match[1]) + 1;
  return plain(text).includes('凡') ? 0 : 1;
}
const tierName = n => `${NUMERALS[Math.max(0, Math.min(NUMERALS.length, n) - 1)]}阶`;
const levelOf = n => (n >= 1 ? `${tierName(n)}下品` : '凡兽');
const byTier = (table, n) => table[tierName(Math.max(1, n))] ?? Object.values(table).at(-1);

// "60/60" → { current, max }; a plain number is both.
function barOf(text, fallback = 0) {
  const source = plain(text);
  const match = source.match(/(-?\d+)\s*\/\s*(\d+)/);
  if (match) return { current: Math.max(0, Number(match[1])), max: Number(match[2]) };
  const value = Number(source);
  return source && Number.isFinite(value) ? { current: value, max: value } : { current: fallback, max: fallback };
}
const barText = bar => `${bar.current}/${bar.max}`;
const favourOf = row => Number(plain(row?.['10'])) || 0;

const rowsOf = env => Object.entries(env.state['7'] || {}).filter(([id, row]) => row && /^P\d+$/.test(id));

function recordOf(env, id) {
  const all = env.play?.beasts;
  return all && typeof all === 'object' && !Array.isArray(all) ? all[id] || null : null;
}

function mark(env, id) {
  if (!env.play.beasts || typeof env.play.beasts !== 'object' || Array.isArray(env.play.beasts)) env.play.beasts = {};
  return (env.play.beasts[id] ||= {});
}

function weighted(random, entries) {
  let left = random.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of entries) if ((left -= weight) < 0) return name;
  return entries.at(-1)[0];
}

function drawTemper(random, species) {
  const own = BEASTS.temperaments.bySpecies[species];
  return weighted(random, Object.keys(TEMPERS).map(name => [name, name === own ? BEASTS.temperaments.speciesWeight : 1]));
}

// Its temperament: kept, else the personality column's words, else drawn by species (the same
// draw every time for the same beast, so the view and the first op agree).
function temperOf(env, id, row) {
  const kept = recordOf(env, id)?.temperament;
  if (TEMPERS[kept]) return kept;
  const text = plain(row?.['4']);
  for (const [name, temper] of Object.entries(TEMPERS)) if (temper.words.some(word => text.includes(word))) return name;
  return drawTemper(stream(`${env.archiveId || ''}:性情:${id}`), speciesOf(row));
}

// The record of a beast an op touches, its temperament settled.
function touch(env, id, row) {
  const record = mark(env, id);
  record.temperament ||= temperOf(env, id, row);
  return record;
}

const boundOf = (env, id) => recordOf(env, id)?.bound !== false;

function injuryOf(env, id) {
  const until = recordOf(env, id)?.injury?.until;
  const day = clock.dayOfDate(until), today = clock.today(env);
  return day !== null && today !== null && today < day ? { until, days: day - today } : null;
}

const extreme = env => env.ctx.parseRemarksString(env.state['0']?.B1?.['9']).isExtreme === 'true';

// ---------------------------------------------------------------- keeping and the one out

function keepCap(env) {
  return BEASTS.keep.base + band(mechanics.statValue(mechanics.readStats(env, 'B1')['神识']));
}
const keptCount = env => rowsOf(env).length + list(env.play?.eggs).length;
const fullText = env => fill(TEXTS.full, { 数: chronicle.count(keepCap(env)) });

// Why this beast cannot go out now, or null.
function notReady(env, id) {
  const row = env.state['7']?.[id];
  if (!row) return TEXTS.noBeast;
  if (!boundOf(env, id)) return fill(TEXTS.notBound, { 名: rowName(row) });
  const hurt = injuryOf(env, id);
  if (hurt) return fill(TEXTS.hurt, { 名: rowName(row), 伤: BEASTS.injury.status, 日: chronicle.numeral(hurt.days) });
  return null;
}

function outId(env) {
  const all = env.play?.beasts;
  if (!all || typeof all !== 'object') return null;
  return Object.keys(all).find(id => all[id]?.out && env.state['7']?.[id]) || null;
}

function outBeast(env) {
  const id = outId(env);
  if (!id || notReady(env, id)) return null;
  const row = env.state['7'][id];
  return { id, row, name: rowName(row) };
}

function effectNow(env, type) {
  const beast = outBeast(env);
  const use = beast ? useOf(beast.row) : null;
  return use && USES[use].effect.type === type ? { use, beast: { id: beast.id, name: beast.name }, ...USES[use].effect } : null;
}

const mountBands = env => effectNow(env, 'mount')?.bands || 0;
const forage = env => effectNow(env, 'forage');
const alert = env => effectNow(env, 'alert');
const helpers = env => { const found = effectNow(env, 'guardHome'); return found ? Array.from({ length: found.helpers }, () => found.beast) : []; };
const useNames = env => { const found = effectNow(env, 'checkBonus'); return found ? [PREFIX + found.use] : []; };

// ---------------------------------------------------------------- making a beast

function nextBeastId(env, taken) {
  const numbers = [...Object.keys(env.state['7'] || {}), ...taken].map(id => Number(/^P(\d+)$/.exec(id)?.[1])).filter(Number.isSafeInteger);
  const id = `P${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
  taken.add(id);
  return id;
}

function drawAptitude(random, weights, least = 0) {
  const index = Math.min(GRADES.length - 1, Math.max(GRADES.indexOf(weighted(random, Object.entries(weights))), least));
  return `${GRADES[index]}|${Math.floor(random.random() * BEAST_APTITUDE_CONFIG[index].max / 2)}`;
}

// A new beast in table 7 and its record: the `set` command, not yet applied.
function make(env, spec, { commands, taken = new Set(), random }) {
  const id = nextBeastId(env, taken);
  const realm = mechanics.parseRealm(levelOf(spec.tier));
  const base = mechanics.baselineStats(realm.unknown ? mechanics.parseRealm('一阶下品') : realm, `${env.archiveId || ''}:${id}:${spec.name}`);
  const species = spec.species || speciesIn(spec.name);
  const temperament = TEMPERS[spec.temperament] ? spec.temperament : drawTemper(random, species);
  const hp = spec.hp || { current: base['血量'].max, max: base['血量'].max };
  const mp = spec.mp || { current: base['法力'].max, max: base['法力'].max };
  const row = { 0: id, 1: spec.name, 2: levelOf(spec.tier), 3: spec.looks || '', 4: temperament, 5: '尚未觉醒', 6: spec.mood || '',
    7: drawAptitude(random, spec.aptitude, spec.least || 0), 8: barText(hp), 9: barText(mp), 10: String(spec.favour || 0) };
  commands.push(`set(${J(row)})`);
  Object.assign(mark(env, id), { temperament, bound: spec.bound === true, source: spec.source, since: clock.dateKey(clock.today(env)) });
  return { id, row };
}

// ---------------------------------------------------------------- feeding

const D = BEASTS.feed.draw;

// One feed's draw, as the old feed draws it (handlePersistentFeed, core/beasts.cjs): the change
// in [min, max) by the grade, a perfect absorption that doubles its size; then the gain times
// `factor` (the food's tier and element). The aptitude after it: past the grade's maximum the next
// grade with the overflow, at the top grade its maximum.
function feedDraw(random, aptitude, factor = 1) {
  const now = parseBeastAptitude(plain(aptitude));
  const t = now.index || 0;
  const min = D.min.base + D.min.per * t, max = D.max.base + D.max.per * t;
  let change = Math.floor(random.random() * (max - min)) + min;
  let crit = false;
  if (random.random() < D.crit.chance) {
    change = Math.abs(change) * D.crit.factor;
    crit = true;
  }
  if (change > 0 && factor !== 1) change = Math.round(change * factor);
  const before = `${now.name}|${now.current}`;
  const reached = Math.max(0, now.current + change);
  if (reached >= now.max) {
    if (now.nextTier) return { before, after: `${now.nextTier.name}|${reached - now.max}`, change, crit, evolved: { from: now.name, to: now.nextTier.name } };
    return { before, after: `${now.name}|${now.max}`, change, crit, capped: true };
  }
  return { before, after: `${now.name}|${reached}`, change, crit };
}

// What a feed of this grade can bring with this factor: low the worst, high the most without a
// perfect absorption, crit the most with one.
function feedRange(aptitude, factor) {
  const t = parseBeastAptitude(plain(aptitude)).index || 0;
  const min = D.min.base + D.min.per * t, max = D.max.base + D.max.per * t;
  return { low: min, high: Math.round((max - 1) * factor), crit: Math.round((max - 1) * D.crit.factor * factor) };
}

const monthNow = env => {
  const now = mechanics.readClock(env.state);
  return now ? clock.monthKey(clock.monthOf(now.minutes)) : null;
};

function feedsLeft(env, id) {
  const fed = recordOf(env, id)?.fed, month = monthNow(env);
  const count = fed && fed.month === month ? Number(fed.count) || 0 : 0;
  return { month, count, left: Math.max(0, BEASTS.feed.perMonth - count) };
}

const bagRow = (env, id) => {
  const row = env.state['1']?.[id];
  return row && !env.ctx.storedItemIds(env.state).has(id) && Number(env.ctx.itemStackCount(row['5'])) > 0 ? row : null;
};

// A thing as food: its tier (the catalogue's, else one its name says, else 一阶) and element.
function foodOf(row) {
  const name = rowName(row), good = goods.lookup(name);
  const type = plain(row['2']);
  const eatable = BEASTS.feed.types.includes(type) || (good && BEASTS.feed.classes.includes(good.class));
  if (!eatable) return null;
  const said = name.match(/([一二三四五六七八九])阶/);
  const tier = good?.tier || (said ? `${said[1]}阶` : goods.TIERS[0]);
  return { name, tier, element: good?.element || elementIn(name) };
}

function feedTerms(env, id, row, food) {
  const tierFactor = BEASTS.feed.tiers[food.tier] ?? 1;
  const own = elementOf(row);
  const same = !!own && !!food.element && baseOf(own) === baseOf(food.element);
  const factor = Math.round(tierFactor * (same ? BEASTS.feed.sameElement : 1) * 1000) / 1000;
  return { factor, same, ...feedRange(row['7'], factor) };
}

async function feedOp(env, args) {
  const id = argOf(args, 'beastId', 'beast_id'), itemId = argOf(args, 'itemId', 'item_id');
  const row = env.state['7']?.[id];
  if (!row) return env.refuse(TEXTS.noBeast);
  const fed = feedsLeft(env, id);
  if (!fed.left) return env.refuse(fill(TEXTS.fed, { 名: rowName(row), 数: chronicle.numeral(fed.count) }));
  const item = bagRow(env, itemId);
  if (!item) return env.refuse(TEXTS.noItem);
  const food = foodOf(item);
  if (!food) return env.refuse(fill(TEXTS.notFood, { 物: rowName(item) }));
  const terms = feedTerms(env, id, row, food);
  const drawn = feedDraw(env.random({ kind: 'check', type: '喂食', target: id, nth: fed.count + 1 }), row['7'], terms.factor);
  const favour = favourOf(row) + BEASTS.feed.favour;
  const count = env.ctx.itemStackCount(item['5']);
  const commands = [count > 1 ? `add(${J(itemId)},{"5":"${count - 1}"})` : `de(${J(itemId)})`, `add(${J(id)},${J({ 7: drawn.after, 10: String(favour) })})`];
  const record = touch(env, id, row);
  record.fed = { month: fed.month, count: fed.count + 1 };
  const owns = ownsNothing();
  owns.items.push(itemId);
  const shown = { action: 'feed', id, name: rowName(row), item: food.name, factor: terms.factor, ...(terms.same ? { same: true } : {}),
    change: drawn.change, ...(drawn.crit ? { crit: true } : {}), before: drawn.before, after: drawn.after,
    ...(drawn.evolved ? { evolved: drawn.evolved } : {}), ...(drawn.capped ? { capped: true } : {}), left: fed.left - 1 };
  await env.settle({ kind: 'beast', ok: true, source: 'engine', beast: shown, commands: commands.join('\n'), owns,
    summary: `喂「${rowName(row)}」${food.name}：资质 ${drawn.before}→${drawn.after}` + (drawn.evolved ? `，血脉蜕变为${drawn.evolved.to}` : '') + `；这个月还能喂${fed.left - 1}次` });
  return { fed: shown, beasts: view(env) };
}

// ---------------------------------------------------------------- the op beast

function promoteTerms(env, id, row, item) {
  const now = tierOfLevel(row['2']), next = now + 1;
  const aptitude = parseBeastAptitude(plain(row['7']));
  const cap = aptitude.index + 1;
  if (next > cap) return { refused: fill(TEXTS.capped, { 名: rowName(row), 资质: aptitude.name, 阶: tierName(cap) }) };
  const species = speciesOf(row), element = elementOf(row);
  const needs = fill(TEXTS.promoteNeeds, { 阶: tierName(next), 种: rowName(row), 属: element || '同' });
  const good = item ? goods.lookup(rowName(item)) : null;
  const fits = good && goods.TIERS.indexOf(good.tier) + 1 >= next
    && ((BEASTS.promote.parts.includes(good.part) && species && good.species === species)
      || (BEASTS.promote.classes.includes(good.class) && element && good.element && baseOf(good.element) === baseOf(element)));
  return fits ? { next, good } : { refused: needs };
}

async function promote(env, id, itemId) {
  const row = env.state['7']?.[id];
  if (!row) return env.refuse(TEXTS.noBeast);
  const item = bagRow(env, itemId);
  const terms = promoteTerms(env, id, row, item);
  if (terms.refused) return env.refuse(terms.refused);
  const realm = mechanics.parseRealm(levelOf(terms.next));
  const base = mechanics.baselineStats(realm, `${env.archiveId || ''}:${id}:${rowName(row)}`);
  const hp = { current: base['血量'].max, max: base['血量'].max }, mp = { current: base['法力'].max, max: base['法力'].max };
  const count = env.ctx.itemStackCount(item['5']);
  const commands = [count > 1 ? `add(${J(itemId)},{"5":"${count - 1}"})` : `de(${J(itemId)})`,
    `add(${J(id)},${J({ 2: levelOf(terms.next), 8: barText(hp), 9: barText(mp) })})`];
  touch(env, id, row);
  const owns = ownsNothing();
  owns.items.push(itemId);
  await env.settle({ kind: 'beast', ok: true, source: 'engine', beast: { action: 'promote', id, name: rowName(row), before: plain(row['2']), after: levelOf(terms.next), item: terms.good.name },
    commands: commands.join('\n'), owns, summary: `「${rowName(row)}」服下${terms.good.name}，等阶 ${plain(row['2'])}→${levelOf(terms.next)}` });
  return { beasts: view(env) };
}

async function goOut(env, id) {
  const why = notReady(env, id);
  if (why) return env.refuse(why);
  const row = env.state['7'][id];
  for (const [other, record] of Object.entries(env.play.beasts || {})) if (other !== id && record) delete record.out;
  touch(env, id, row).out = true;
  await env.settle({ kind: 'beast', ok: true, hidden: true, source: 'engine', beast: { action: 'out', id, name: rowName(row) }, commands: '', owns: ownsNothing(),
    summary: `出战的灵兽：「${rowName(row)}」` });
  return { beasts: view(env) };
}

async function callIn(env) {
  const id = outId(env);
  if (!id) return env.refuse(TEXTS.noOut);
  delete env.play.beasts[id].out;
  await env.settle({ kind: 'beast', ok: true, hidden: true, source: 'engine', beast: { action: 'in', id, name: rowName(env.state['7'][id]) }, commands: '', owns: ownsNothing(),
    summary: '没有灵兽出战' });
  return { beasts: view(env) };
}

async function hatch(env, itemId) {
  const item = bagRow(env, itemId);
  if (!item) return env.refuse(TEXTS.noItem);
  const name = rowName(item);
  const word = BEASTS.hatch.words.find(each => name.includes(each));
  if (!word) return env.refuse(fill(TEXTS.notEgg, { 物: name }));
  if (keptCount(env) >= keepCap(env)) return env.refuse(fullText(env));
  const good = goods.lookup(name), said = name.match(/([一二三四五六七八九])阶/);
  const tier = good?.tier || (said ? `${said[1]}阶` : goods.TIERS[0]);
  const months = BEASTS.hatch.months[tier] ?? Object.values(BEASTS.hatch.months).at(-1);
  const today = clock.today(env);
  const due = today + months * clock.CALENDAR.daysPerMonth;
  const beast = name.replace(/[一二三四五六七八九]阶/, '').replace(word, '').trim() || '幼兽';
  const egg = { id: nextId(env, 'egg', 'E'), name: beast, species: speciesIn(beast), tier, due: clock.dateKey(due), laid: clock.dateKey(today), from: name };
  env.play.eggs = [...list(env.play.eggs), egg];
  calendar.register(env, 'hatch', { date: egg.due, title: `「${beast}」破壳` });
  const count = env.ctx.itemStackCount(item['5']);
  const owns = ownsNothing();
  owns.items.push(itemId);
  await env.settle({ kind: 'beast', ok: true, source: 'engine', beast: { action: 'hatch', egg },
    commands: count > 1 ? `add(${J(itemId)},{"5":"${count - 1}"})` : `de(${J(itemId)})`, owns,
    summary: `孵起${name}，${chronicle.numeral(months)}个月后破壳（${egg.due}）` });
  return { beasts: view(env) };
}

async function buy(env, args) {
  const name = plain(args.name).slice(0, 20);
  if (!name) return env.refuse('要说买的是哪一只');
  const price = Number(args.price);
  if (!Number.isSafeInteger(price) || price < 0) return env.refuse('价钱要是不小于零的整数');
  const have = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
  if (have < price) return env.refuse(fill(TEXTS.price, { 数: chronicle.count(price), 有: chronicle.count(have) }));
  if (keptCount(env) >= keepCap(env)) return env.refuse(fullText(env));
  const tier = Number.isSafeInteger(Number(args.tier)) && Number(args.tier) >= 1 ? Number(args.tier) : 1;
  const commands = price ? [`add("B1",{"26":"${have - price}"})`] : [];
  const random = env.random({ kind: 'check', type: '灵兽·买', target: name });
  const made = make(env, { name, tier, species: plain(args.species) || null, aptitude: BEASTS.buy.aptitude, least: tier - 1, source: 'bought' }, { commands, random });
  const owns = ownsNothing();
  owns.currency = price > 0;
  await env.settle({ kind: 'beast', ok: true, source: 'engine', beast: { action: 'buy', id: made.id, name, price },
    commands: commands.join('\n'), owns, summary: `买下「${name}」` + (price ? `，灵石 ${have}→${have - price}` : '') });
  return { beasts: view(env) };
}

async function gift(env, args) {
  const from = plain(args.from);
  const person = env.state['0']?.[from];
  if (!/^[CG]/.test(from) || !person) return env.refuse('这个人不在场');
  const { favourTier } = require('./actions.cjs');
  const tiers = data('actions').favour.tiers.map(tier => tier.name);
  const who = rowName(person);
  if (tiers.indexOf(favourTier(plain(person['15']))) < tiers.indexOf(BEASTS.gift.favour)) return env.refuse(fill(TEXTS.giftFavour, { 名: who, 好感: BEASTS.gift.favour }));
  const last = clock.dayOfDate(env.play.gifts?.[from]), today = clock.today(env);
  if (last !== null && today - last < BEASTS.gift.everyDays) return env.refuse(fill(TEXTS.giftOnce, { 名: who }));
  if (keptCount(env) >= keepCap(env)) return env.refuse(fullText(env));
  const random = env.random({ kind: 'check', type: '灵兽·赠', target: from });
  const name = BEASTS.gift.names[Math.floor(random.random() * BEASTS.gift.names.length)];
  const tier = Math.max(1, mechanics.parseRealm(env.state['0']?.B1?.['2']).major || 1);
  const commands = [];
  const made = make(env, { name, tier, aptitude: BEASTS.gift.aptitude, source: 'gift' }, { commands, random });
  env.play.gifts = { ...(env.play.gifts && typeof env.play.gifts === 'object' ? env.play.gifts : {}), [from]: clock.dateKey(today) };
  await env.settle({ kind: 'beast', ok: true, source: 'engine', beast: { action: 'gift', id: made.id, name, from, by: who },
    commands: commands.join('\n'), owns: ownsNothing(), summary: `${who}赠你一只「${name}」` });
  return { beasts: view(env) };
}

async function op(env, args) {
  const action = plain(args.action);
  const id = argOf(args, 'beastId', 'beast_id'), itemId = argOf(args, 'itemId', 'item_id');
  if (action === 'out') return goOut(env, id);
  if (action === 'in') return callIn(env);
  if (action === 'hatch') return hatch(env, itemId);
  if (action === 'buy') return buy(env, args);
  if (action === 'gift') return gift(env, args);
  if (action === 'promote') return promote(env, id, itemId);
  if (action === 'view') return { beasts: view(env) };
  return env.refuse(`灵兽没有「${action.slice(0, 10)}」这一项`);
}

// ---------------------------------------------------------------- the verb bind

function bind(env, verb, upTo = null) {
  const id = argOf(verb, 'beastId', 'beast_id');
  const row = env.state['7']?.[id];
  if (!row) return { refused: TEXTS.noBeast };
  if (boundOf(env, id)) return { refused: fill(TEXTS.bound, { 名: rowName(row) }) };
  const need = BEASTS.bind.days, done = Number(recordOf(env, id)?.binding) || 0;
  const days = Math.min(need - done, upTo === null ? need - done : Math.max(1, Math.floor(upTo / DAY)));
  const minutes = days * DAY, span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `认主${span}${overrun}` };
  const full = done + days >= need;
  const favour = favourOf(row) + (full ? BEASTS.bind.favour : 0);
  const now = mechanics.readClock(env.state);
  const name = rowName(row);
  return {
    minutes,
    receipt: { kind: 'beast', ok: true, source: 'verb', beast: { action: 'bind', id, name, days, done: done + days, need, bound: full },
      commands: full ? `add(${J(id)},${J({ 10: String(favour) })})` : '', owns: ownsNothing(), summary: '' },
    line: ['bind', { 名: name, 时长: span, 成: full ? '认了主' : `还差${chronicle.numeral(need - done - days)}日` }],
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), lines: [`替「${name}」认主${span}，${full ? '认了主，肯跟你出战了' : `还差${chronicle.numeral(need - done - days)}日`}。`], formula: [] },
    finish: receipt => {
      const record = touch(env, id, row);
      if (full) {
        record.bound = true;
        delete record.binding;
      } else record.binding = done + days;
      receipt.summary = `替「${name}」认主${span}：${done + days}/${need}日${full ? '，认了主' : ''}；时间 ${receipt.time.before}→${receipt.time.after}`;
    },
  };
}

// ---------------------------------------------------------------- the month

async function month(env, entered) {
  const start = Math.floor(entered.minutes / DAY);
  const commands = [], born = [], healed = [], taken = new Set();
  const eggs = list(env.play.eggs);
  const due = eggs.filter(egg => (clock.dayOfDate(egg.due) ?? Infinity) < start);
  for (const egg of due) {
    const random = stream(`${env.archiveId || ''}:破壳:${egg.id}`);
    const made = make(env, { name: egg.name, tier: Math.max(1, goods.TIERS.indexOf(egg.tier) + 1), species: egg.species, aptitude: BEASTS.hatch.aptitude,
      favour: BEASTS.hatch.favour, bound: true, source: 'egg' }, { commands, taken, random });
    born.push({ id: made.id, name: egg.name, egg: egg.id });
    chronicle.write(env, 'beastBorn', { 名: egg.name }, clock.dayOfDate(egg.due) * DAY);
  }
  if (due.length) env.play.eggs = eggs.filter(egg => !due.includes(egg));
  for (const [id, row] of rowsOf(env)) {
    const record = recordOf(env, id);
    const until = clock.dayOfDate(record?.injury?.until);
    if (record?.injury && until !== null && until > start) continue;
    const hp = barOf(row['8']), mp = barOf(row['9']);
    if (record?.injury) {
      delete record.injury;
      healed.push({ id, name: rowName(row) });
    }
    if ((hp.max > 0 && hp.current < hp.max) || (mp.max > 0 && mp.current < mp.max)) {
      commands.push(`add(${J(id)},${J({ 8: barText({ current: hp.max, max: hp.max }), 9: barText({ current: mp.max, max: mp.max }) })})`);
    }
  }
  if (!commands.length && !healed.length) return;
  await env.settle({ kind: 'beast', ok: true, ...(born.length ? {} : { hidden: true }), source: 'engine', beast: { action: 'month', born, healed },
    commands: commands.join('\n'), owns: ownsNothing(),
    summary: [...born.map(each => `「${each.name}」破壳`), ...healed.map(each => `「${each.name}」伤愈`)].join('；') || '灵兽养好了气血' });
}

// ---------------------------------------------------------------- the fight's side

// The out beast joining a fight: { id, name, temperament, hp? } (hp when its 气血 is back after an
// injury that is over: the command that writes it is pushed).
function joining(env, commands) {
  const out = outBeast(env);
  if (!out) return null;
  const hp = barOf(out.row['8']);
  const joined = { id: out.id, name: out.name, temperament: touch(env, out.id, out.row).temperament };
  if (hp.current <= 0 && hp.max > 0) {
    commands.push(`add(${J(out.id)},${J({ 8: barText({ current: hp.max, max: hp.max }) })})`);
    joined.hp = { current: hp.max, max: hp.max };
  }
  return joined;
}

function fighterOf(env, id, hp = null) {
  const row = env.state['7']?.[id];
  if (!row) return null;
  const parsed = mechanics.parseRealm(row['2']);
  const realm = parsed.unknown ? mechanics.parseRealm('一阶下品') : parsed;
  const base = mechanics.baselineStats(realm, `${env.archiveId || ''}:${id}:${rowName(row)}`);
  return { id, name: rowName(row), realm, row, beast: true,
    stats: { ...base, 血量: hp || barOf(row['8'], base['血量'].max), 法力: barOf(row['9'], base['法力'].max) } };
}

const obeys = (env, id) => favourOf(env.state['7']?.[id]) >= BEASTS.obey.favour;

function actFor(env, id, order = '') {
  const row = env.state['7']?.[id];
  const own = TEMPERS[temperOf(env, id, row)].act;
  if (!order) return { act: own };
  if (obeys(env, id)) return { act: order, order, obeyed: true };
  return { act: own, order, obeyed: false, note: fill(BEASTS.obey.refused, { 名: rowName(row) }) };
}

function hurt(env, id, hp, commands) {
  const row = env.state['7']?.[id];
  commands.push(`add(${J(id)},${J({ 8: barText(hp) })})`);
  if (hp.current > 0) return null;
  if (extreme(env)) {
    commands.push(`de(${J(id)})`);
    if (env.play.beasts) delete env.play.beasts[id];
    return { died: true };
  }
  const days = byTier(BEASTS.injury.days, tierOfLevel(row?.['2']));
  const until = clock.dateKey(clock.today(env) + days);
  touch(env, id, row).injury = { until };
  calendar.register(env, 'beast', { date: until, title: `「${rowName(row)}」伤愈` });
  return { injury: { until, days } };
}

function oddsOf(modifier, dc) {
  let won = 0;
  for (let roll = 1; roll <= rules.RULES.die; roll += 1) if (['大成功', '成功'].includes(rules.checkOutcome(roll, roll + modifier, dc))) won += 1;
  return Math.round(100 * won / rules.RULES.die);
}

function tameTerms(env, player, foe) {
  const T = BEASTS.tame.texts;
  if (foe.realm.major > player.realm.major) return { refused: fill(T.above, { 名: foe.name, 境界: foe.realm.text }) };
  if (keptCount(env) >= keepCap(env)) return { refused: fill(T.full, { 数: chronicle.count(keepCap(env)) }) };
  const tier = foe.realm.major < player.realm.major ? BEASTS.tame.tiers.lower : BEASTS.tame.tiers.same;
  const dc = rules.RULES.tiers[tier];
  const value = gear.totals(env, 'B1', player.stats)['魅力'];
  const crafted = perks.effectsOf(env, 'craft').filter(effect => list(effect.kinds).includes('驭兽'));
  const mastery = hooks.mastery(env) || { value: 0 };
  const bonus = crafted.reduce((sum, effect) => sum + (Number(effect.value) || 0), 0) + (Number(mastery.value) || 0);
  const modifier = rules.modifierFor(value) + bonus;
  return { tier, dc, attribute: '魅力', value, modifier, bonus, odds: oddsOf(modifier, dc),
    ...(crafted.length || mastery.name ? { names: [...crafted.map(effect => effect.name), ...(mastery.name ? [mastery.name] : [])] } : {}) };
}

function tamed(env, { name, tier, hp, mp, outcome, commands }) {
  const random = env.random({ kind: 'check', type: '灵兽·降服', target: name });
  const made = make(env, { name, tier, aptitude: BEASTS.tame.aptitude, least: Math.max(0, tier - 1), hp: { current: Math.max(1, hp.current), max: hp.max },
    mp, favour: BEASTS.tame.outcomes[outcome]?.favour || 0, mood: BEASTS.tame.texts.mood, source: 'tamed' }, { commands, random });
  hooks.tamed(env, { id: made.id, name });
  return { id: made.id, name };
}

// ---------------------------------------------------------------- the view

function foodsFor(env, id, row) {
  return Object.entries(env.state['1'] || {}).flatMap(([itemId, item]) => {
    if (!bagRow(env, itemId)) return [];
    const food = foodOf(item);
    if (!food) return [];
    const terms = feedTerms(env, id, row, food);
    return [{ itemId, name: food.name, tier: food.tier, factor: terms.factor, ...(terms.same ? { same: true } : {}), low: terms.low, high: terms.high, crit: terms.crit }];
  });
}

function shownOf(env, id, row) {
  const aptitude = parseBeastAptitude(plain(row['7']));
  const species = speciesOf(row), use = useOf(row);
  const temper = temperOf(env, id, row);
  const hurt = injuryOf(env, id);
  const fed = feedsLeft(env, id);
  return {
    id, name: rowName(row), species, ...(use ? { use: { name: use, text: USES[use].text } } : {}),
    temperament: temper, act: TEMPERS[temper].act, level: plain(row['2']), tier: tierOfLevel(row['2']), cap: aptitude.index + 1,
    aptitude: { grade: aptitude.name, current: aptitude.current, max: aptitude.max },
    hp: barOf(row['8']), mp: barOf(row['9']), favour: favourOf(row), obeys: obeys(env, id), bound: boundOf(env, id),
    out: outId(env) === id, ...(hurt ? { injury: hurt } : {}), feeds: { left: fed.left, month: fed.month }, foods: foodsFor(env, id, row),
  };
}

function view(env) {
  return {
    kept: keptCount(env), cap: keepCap(env), out: outId(env),
    list: rowsOf(env).map(([id, row]) => shownOf(env, id, row)),
    eggs: list(env.play?.eggs).map(egg => ({ id: egg.id, name: egg.name, tier: egg.tier, due: egg.due,
      days: Math.max(0, (clock.dayOfDate(egg.due) ?? 0) - (clock.today(env) ?? 0)) })),
  };
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.bind = bind;
}

module.exports = {
  BEASTS, ACTS, TEMPERS, USES, PREFIX, hooks, keepCap, keptCount, outBeast, mountBands, forage, alert, helpers, useNames,
  feedDraw, feedRange, joining, fighterOf, actFor, obeys, hurt, tameTerms, tamed, barOf, view, month, install,
  feed: feedOp, op,
};
