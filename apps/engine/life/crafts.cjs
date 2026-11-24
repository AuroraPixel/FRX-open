'use strict';
/* Crafts (技艺, 玩法设计第八节「技艺」; plan item 42): 炼丹, 炼器, 制符, 布阵 and 驭兽 under one rule, read
 * from content/life/crafts.json; the recipes are catalogue goods (goods.json kind 方 with a recipe:
 * craft, materials a batch, days a batch, output). No model is called here.
 *
 * frxPlay.crafts { <craft>: { done }, jobs: [{ id, recipe, batches, due, place, entry, items }] }:
 *   done  the batches that came out (成功 or 大成功) times 1 + the player's learn effects (traits):
 *         the mastery's count; jobs the hired work not yet fetched, entry its calendar entry
 * masteryOf(env, craft) → { name, modifier, top, done, next? }: the craft's mastery now (mastery: the
 *   last tier whose `from` the count reaches), next { name, need } the tier above.
 * modifier(env, craft) → the check bonus a craft's mastery gives: 布阵 for item 43, 驭兽 for 41.
 * practise(env, craft) → { before, after, done }: one success at a craft done another way (布阵: an
 *   array laid, arrays.cjs; 驭兽: a beast tamed, beasts.hooks.tamed): the count up by 1 + the learn
 *   effects, a craftRank line when the mastery goes up.
 * taming(env) → beasts.hooks.mastery: the 驭兽 mastery's bonus to 降服, { value, name? }.
 * The verb craft (verbs.VERBS, by install): { kind: "craft", recipe, batches?, hire? }
 *   recipe   a recipe's name (丹方·回气丹) or the bag id of one; batches 1 to the file's most
 *   made here: at a venue of the recipe's craft (crafts.<craft>.venues), the place's or a room of
 *            the player's home (frxPlay.home.rooms, home.cjs, item 45); the recipe in the bag; the
 *            mastery's top tier at least the recipe's; the materials of every batch in the bag.
 *            recipe.days a batch pass; each batch spends its materials (the better quality first:
 *            精, 常, 残) and rolls once, on the
 *            timeline seed { kind: check, type: 炼制·<craft>, target: the recipe, nth: the batch }:
 *            d10 plus the band of check.attribute, the mastery's modifier and the player's craft
 *            effects (traits), against check.tiers[the recipe's tier] (checks.json tiers), judged by
 *            turn-rules checkOutcome. The outcome's quality (results), one step down the ladder when
 *            every material that batch used was 残; 大失败 leaves nothing. A stretch broken off makes
 *            the batches that fit in it. receipt.craft { craft, recipe, batches, results, items,
 *            spent, mastery: { before, after, done } }; the preview gives the odds of each quality
 *            (preview.odds, in percent), never the roll
 *   hire     true: someone at the venue makes it without the player's recipe or mastery: the
 *            materials handed over, hire.fee[the recipe's tier] stones a batch, no time passes; the
 *            goods (hire.quality) are due recipe.days × batches + hire.wait days later, on the
 *            calendar (own entry craft) and in frxPlay.crafts.jobs until then.
 *            receipt.craft { craft, recipe, batches, hired: { fee, due }, spent }
 * deliver(env) → the receipts (kind craft, source engine) that put the goods of every job due by
 *   today in the bag, taking the job and its calendar entry off; the verbs' after hook calls it
 *   after every verb.
 * listed(env) → the view's 炼制 row where the place has a crafting venue, or the home a room of one.
 * install(verbs, beasts?): the verb, its row (chained onto hooks.more) and the after hook, once; with
 *   the beasts module (item 41), 驭兽 mastery feeds taming (hooks.mastery) and a beast tamed counts
 *   for it (hooks.tamed).
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const calendar = require('./calendar.cjs');
const places = require('./places.cjs');
const goods = require('./goods.cjs');
const perks = require('./perks.cjs');
const rewards = require('./rewards.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('crafts');
const DAY = clock.DAY_MINUTES;
const DIE = rules.RULES.die;
const OUTCOMES = ['大成功', '成功', '失败', '大失败'];
const LADDER = RULES.ladder;

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const bookOf = env => (isObject(env.play?.crafts) ? env.play.crafts : {});
const doneOf = (env, craft) => Number(bookOf(env)[craft]?.done) || 0;
const named = (env, facts) => facts.place || chronicle.placeName(env.state) || '这里';
const shown = (env, minutes, lines, more = {}) => ({
  ok: true, minutes, ends: clock.dateOf(mechanics.readClock(env.state).minutes + minutes), lines, formula: [], ...more,
});

// ---------------------------------------------------------------- mastery

function masteryOf(env, craft) {
  const done = doneOf(env, craft);
  const index = RULES.mastery.reduce((at, tier, i) => (done >= tier.from ? i : at), 0);
  const tier = RULES.mastery[index], next = RULES.mastery[index + 1];
  return { name: tier.name, modifier: tier.modifier, top: tier.top, done, ...(next ? { next: { name: next.name, need: next.from - done } } : {}) };
}

const modifier = (env, craft) => masteryOf(env, craft).modifier;

function practise(env, craft) {
  const before = masteryOf(env, craft);
  const done = Math.round((before.done + 1 + sumOf(env, 'learn', craft)) * 100) / 100;
  env.play.crafts = { ...bookOf(env), [craft]: { ...(bookOf(env)[craft] || {}), done } };
  const after = masteryOf(env, craft);
  if (after.name !== before.name) chronicle.write(env, 'craftRank', { 技艺: craft, 档: after.name });
  return { before: before.name, after: after.name, done };
}

const TAMING = '驭兽';
function taming(env) {
  const mastery = masteryOf(env, TAMING);
  return mastery.modifier ? { value: mastery.modifier, name: `${TAMING}「${mastery.name}」` } : { value: 0 };
}
const sumOf = (env, type, craft) => perks.effectsOf(env, type)
  .filter(effect => !effect.kinds || effect.kinds.includes(craft)).reduce((sum, effect) => sum + (Number(effect.value) || 0), 0);

// ---------------------------------------------------------------- recipes and materials

// The recipe a verb names: a catalogue recipe by its name, or by the bag id of one.
function recipeOf(env, value) {
  const text = plain(value);
  const row = env.state['1']?.[text];
  const good = goods.lookup(row ? row['1'] : text);
  return good?.kind === '方' && good.recipe ? good : null;
}

// The bag's stacks of a catalogue good, the better quality first: [{ id, count, quality }].
function stacksOf(env, good) {
  const stored = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {})
    .filter(([id, row]) => row && !stored.has(id) && goods.lookup(row['1'])?.id === good?.id)
    .map(([id, row]) => ({ id, count: Number(env.ctx.itemStackCount(row['5'])) || 0, quality: goods.qualityOf(row['1']) }))
    .filter(stack => stack.count > 0)
    .sort((a, b) => LADDER.indexOf(b.quality) - LADDER.indexOf(a.quality) || a.id.localeCompare(b.id));
}

const owned = (env, recipe) => stacksOf(env, recipe).length > 0;

// What `batches` batches take from the bag: { missing } with what is short, or { poor, commands,
// items, spent }: poor[n] whether every material batch n used was 残, the commands that take them,
// the ids touched and the goods spent by name.
function spend(env, recipe, batches) {
  const pools = recipe.recipe.materials.map(material => {
    const good = goods.lookup(material.name);
    return { good, need: material.count, stacks: stacksOf(env, good).map(stack => ({ ...stack, left: stack.count })) };
  });
  const missing = pools.filter(pool => pool.stacks.reduce((sum, stack) => sum + stack.count, 0) < pool.need * batches)
    .map(pool => `${pool.good.name}${chronicle.count(pool.need * batches)}${goods.unitOf(pool.good)}`);
  if (missing.length) return { missing };
  const poor = [];
  for (let n = 0; n < batches; n += 1) {
    let all = true;
    for (const pool of pools) {
      let need = pool.need;
      for (const stack of pool.stacks) {
        const take = Math.min(need, stack.left);
        if (!take) continue;
        stack.left -= take;
        need -= take;
        if (stack.quality !== '残') all = false;
        if (!need) break;
      }
    }
    poor.push(all);
  }
  const touched = pools.flatMap(pool => pool.stacks.filter(stack => stack.left !== stack.count));
  const commands = touched.map(stack => (stack.left ? `add(${JSON.stringify(stack.id)},{"5":"${stack.left}"})` : `de(${JSON.stringify(stack.id)})`));
  const spent = pools.map(pool => ({ name: pool.good.name, count: pool.need * batches, unit: goods.unitOf(pool.good) }));
  return { poor, commands, items: touched.map(stack => stack.id), spent };
}

// ---------------------------------------------------------------- the roll

const lower = quality => (quality ? LADDER[LADDER.indexOf(quality) - 1] ?? null : null);

// The die's terms for a craft: { modifier, terms, dc }.
function termsOf(env, craft, recipe) {
  const value = mechanics.totalStats(env, 'B1', mechanics.readStats(env, 'B1'))[RULES.check.attribute];
  const band = rules.modifierFor(value);
  const mastery = masteryOf(env, craft);
  const gift = sumOf(env, 'craft', craft);
  // A world factor's craft hook (科技修仙: 炼器 +1; world.cjs).
  const worldly = require('./world.cjs').craftBonus(env, craft);
  const dc = rules.RULES.tiers[RULES.check.tiers[recipe.tier]];
  return { modifier: band + mastery.modifier + gift + worldly, dc, mastery,
    terms: [{ label: RULES.check.attribute, value: band }, { label: mastery.name, value: mastery.modifier }, ...(gift ? [{ label: '天赋', value: gift }] : []),
      ...(worldly ? [{ label: '世界', value: worldly }] : [])] };
}

// The share of each quality a batch comes out with, in percent: { 精, 常, 残, 毁 }.
function oddsOf(terms, poor) {
  const counted = { 精: 0, 常: 0, 残: 0, 毁: 0 };
  for (let roll = 1; roll <= DIE; roll += 1) {
    const quality = RULES.results[rules.checkOutcome(roll, roll + terms.modifier, terms.dc)];
    counted[(poor ? lower(quality) : quality) ?? '毁'] += 1;
  }
  return Object.fromEntries(Object.entries(counted).map(([key, n]) => [key, Math.round(100 * n / DIE)]));
}

// ---------------------------------------------------------------- the verb

function venueOf(env, craft, facts) {
  const venues = RULES.crafts[craft]?.venues || [];
  const home = env.play?.home?.place && env.play.home.place === facts.place ? env.play.home : null;
  const room = home ? venues.find(venue => list(home.rooms).includes(venue)) : null;
  if (room) return `洞府${room}`;
  return venues.find(venue => list(facts.venues).includes(venue)) || null;
}

const itemsOf = (output, quality, count) => {
  const good = goods.lookup(output.name);
  return { id: good.id, name: good.name, class: good.class, tier: good.tier, count, unit: goods.unitOf(good), price: good.price, quality };
};

// The batches' goods, by quality: [item].
function made(recipe, results) {
  const out = recipe.recipe.output;
  return LADDER.slice().reverse().map(quality => itemsOf(out, quality, results.filter(each => each === quality).length * out.count))
    .filter(item => item.count > 0);
}

const saidAll = items => (items.length ? `成${goods.listed(items)}` : '一炉未成');

function craftPlan(env, verb, upTo = null) {
  const { label } = RULES.verb;
  const blocked = rewards.blockedFor(env, label);
  if (blocked) return { refused: blocked };
  const recipe = recipeOf(env, verb.recipe);
  if (!recipe) return { refused: plain(verb.recipe) ? `「${plain(verb.recipe).slice(0, 20)}」不是一张方子` : `${label}要选一张方子` };
  const craft = recipe.recipe.craft, rule = RULES.crafts[craft];
  const facts = places.placeFacts(env), here = named(env, facts);
  const venue = venueOf(env, craft, facts);
  if (!venue) return { refused: `${here}没有${rule.venues.join('或') || '做这门手艺的地方'}，${rule.verb}不了` };
  const batches = /^\d{1,2}$/.test(String(verb.batches ?? 1).trim()) ? Number(verb.batches ?? 1) : 0;
  if (batches < 1 || batches > RULES.most) return { refused: `一次做一到${chronicle.numeral(RULES.most)}炉` };
  const tierAt = goods.TIERS.indexOf(recipe.tier);
  if (verb.hire === true) return hirePlan(env, { recipe, craft, rule, facts, here, venue, batches, tierAt });
  if (!owned(env, recipe)) return { refused: `手里没有「${recipe.name}」` };
  const mastery = masteryOf(env, craft);
  if (tierAt > goods.TIERS.indexOf(mastery.top)) {
    return { refused: `${craft}的手艺还在「${mastery.name}」，只做得了${mastery.top}以下的方子，「${recipe.name}」是${recipe.tier}` };
  }
  const full = recipe.recipe.days * DAY;
  const fits = upTo === null ? batches : Math.max(0, Math.min(batches, Math.floor(upTo / full)));
  const minutes = upTo === null ? batches * full : Math.min(batches * full, upTo);
  const span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `${rule.verb}${span}${overrun}` };
  const used = spend(env, recipe, batches);
  if (used.missing) return { refused: `材料不够，还缺${used.missing.join('、')}` };
  const taken = fits === batches ? used : spend(env, recipe, fits);
  const terms = termsOf(env, craft, recipe);
  const results = [];
  for (let n = 1; n <= fits; n += 1) {
    const roll = Math.floor(env.random({ kind: 'check', type: `炼制·${craft}`, target: recipe.name, nth: n }).random() * DIE) + 1;
    const outcome = rules.checkOutcome(roll, roll + terms.modifier, terms.dc);
    const quality = RULES.results[outcome];
    results.push({ roll, outcome, quality: taken.poor[n - 1] ? lower(quality) : quality });
  }
  const qualities = results.map(each => each.quality);
  const items = made(recipe, qualities);
  const succeeded = results.filter(each => each.outcome === '大成功' || each.outcome === '成功').length;
  const learn = 1 + sumOf(env, 'learn', craft);
  const done = Math.round((mastery.done + succeeded * learn) * 100) / 100;
  const granted = rewards.grant(env, items);
  const odds = oddsOf(terms, used.poor.every(Boolean));
  const out = recipe.recipe.output, outGood = goods.lookup(out.name);
  const preview = shown(env, batches * full, [
    `在${here}的${venue}${rule.verb}${chronicle.spanText(batches * full)}，${clock.dateOf(mechanics.readClock(env.state).minutes + batches * full).text}出炉。`,
    `${batches > 1 ? `${chronicle.numeral(batches)}炉，` : ''}用${goods.listed(used.spent)}，每炉出${out.name}${chronicle.count(out.count)}${goods.unitOf(outGood)}。`,
    `${craft}「${mastery.name}」，骰加${terms.terms.map(term => `${term.label}${term.value}`).join('、')}，对难度${terms.dc}。`,
    `每炉：精${odds.精}%、常${odds.常}%、残${odds.残}%、毁${odds.毁}%。`,
    ...(used.poor.every(Boolean) ? ['材料全是残的，成色降一等。'] : []),
  ], { odds, formula: terms.terms.map(term => ({ label: term.label, value: `${term.value >= 0 ? '+' : ''}${term.value}` })) });
  const after = masteryOf({ play: { crafts: { [craft]: { done } } } }, craft);
  return {
    minutes, preview,
    receipt: {
      kind: 'craft', ok: true, source: 'verb',
      craft: { craft, recipe: recipe.name, batches: fits, results: qualities, items, spent: taken.spent,
        mastery: { before: mastery.name, after: after.name, done } },
      commands: [...taken.commands, ...granted.commands].join('\n'),
      owns: { ...granted.owns, items: [...new Set([...taken.items, ...granted.owns.items])] }, summary: '',
    },
    line: ['craft', { 地点: chronicle.placeName(env.state), 技艺: rule.verb, 时长: span, 所成: saidAll(items) }],
    finish: settled => {
      env.play.crafts = { ...bookOf(env), [craft]: { ...(bookOf(env)[craft] || {}), done } };
      if (after.name !== mastery.name) chronicle.write(env, 'craftRank', { 技艺: craft, 档: after.name });
      settled.summary = `${rule.verb}${span}：${saidAll(items)}；${craft}「${after.name}」${done}；时间 ${settled.time.before}→${settled.time.after}`;
    },
  };
}

function hirePlan(env, { recipe, craft, rule, facts, here, venue, batches, tierAt }) {
  const fee = RULES.hire.fee[Math.min(RULES.hire.fee.length - 1, Math.max(0, tierAt))] * batches;
  const purse = mechanics.stonesOf(env.state['0']?.B1);
  if (purse === null || purse < fee) return { refused: `请人${rule.verb}要${chronicle.numeral(fee)}块灵石，你只有${chronicle.numeral(purse || 0)}块` };
  const used = spend(env, recipe, batches);
  if (used.missing) return { refused: `材料不够，还缺${used.missing.join('、')}` };
  const today = clock.today(env);
  const day = today + recipe.recipe.days * batches + RULES.hire.wait;
  const due = clock.dateKey(day);
  const results = used.poor.map(poor => (poor ? lower(RULES.hire.quality) : RULES.hire.quality));
  const items = made(recipe, results);
  const when = clock.dateOf(day * DAY).text;
  const preview = shown(env, 0, [`在${here}的${venue}请人${rule.verb}：付${chronicle.numeral(fee)}块灵石，交出${goods.listed(used.spent)}。`,
    `${when}来取${goods.listed(items) || '（材料全毁）'}。`], { stones: fee });
  return {
    minutes: 0, preview,
    receipt: {
      kind: 'craft', ok: true, source: 'verb', craft: { craft, recipe: recipe.name, batches, hired: { fee, due }, spent: used.spent },
      commands: [...used.commands, `add("B1",{"26":"${purse - fee}"})`].join('\n'),
      owns: { ...ownsNothing(), items: used.items, currency: true }, summary: '',
    },
    line: ['craftHire', { 地点: chronicle.placeName(env.state), 技艺: rule.verb, 日期: when }],
    finish: settled => {
      const entry = calendar.register(env, 'craft', { date: due, title: `取「${recipe.recipe.output.name}」`, place: facts.place || '',
        note: `请人${rule.verb}的「${recipe.name}」，${chronicle.numeral(batches)}炉` });
      const job = { id: nextId(env, 'craft', 'J'), recipe: recipe.name, batches, due, place: facts.place || '', entry: entry.id,
        items: items.map(item => ({ id: item.id, count: item.count, quality: item.quality })) };
      env.play.crafts = { ...bookOf(env), jobs: [...list(bookOf(env).jobs), job] };
      settled.summary = `请人${rule.verb}「${recipe.name}」${chronicle.numeral(batches)}炉：付灵石 ${purse}→${purse - fee}，${when}取货`;
    },
  };
}

// ---------------------------------------------------------------- the jobs

async function deliver(env) {
  const today = clock.today(env);
  if (today === null) return [];
  const due = list(bookOf(env).jobs).filter(job => (clock.dayOfDate(job.due) ?? Infinity) <= today);
  const settled = [];
  for (const job of due) {
    const items = job.items.map(item => {
      const good = goods.byId(item.id);
      return { id: good.id, name: good.name, class: good.class, tier: good.tier, count: item.count, unit: goods.unitOf(good), price: good.price, quality: item.quality };
    });
    env.play.crafts = { ...bookOf(env), jobs: list(bookOf(env).jobs).filter(each => each.id !== job.id) };
    if (job.entry) calendar.remove(env, job.entry);
    const granted = rewards.grant(env, items);
    chronicle.write(env, 'craftFetch', { 所成: goods.listed(items) || '一炉也没成' }, clock.dayOfDate(job.due) * DAY);
    settled.push(await env.settle({
      kind: 'craft', ok: true, source: 'engine', craft: { recipe: job.recipe, batches: job.batches, fetched: true, job: job.id, items },
      commands: granted.commands.join('\n'), owns: granted.owns, summary: `取回请人做的「${job.recipe}」：${goods.listed(items) || '一炉也没成'}`,
    }));
  }
  return settled;
}

// ---------------------------------------------------------------- the list and the wiring

function listed(env) {
  const facts = places.placeFacts(env);
  const venues = new Set(Object.values(RULES.crafts).flatMap(rule => rule.venues));
  const home = env.play?.home?.place === facts.place && list(env.play.home.rooms).some(room => venues.has(room));
  if (!home && !list(facts.venues).some(venue => venues.has(venue))) return [];
  const why = rewards.blockedFor(env, RULES.verb.label);
  return [{ kind: 'craft', glyph: RULES.verb.glyph, label: RULES.verb.label, ...(why ? { note: why } : {}) }];
}

let installed = false;
function install(verbs, beasts = null) {
  if (installed) return;
  installed = true;
  if (beasts) {
    beasts.hooks.mastery = taming;
    beasts.hooks.tamed = env => practise(env, TAMING);
  }
  verbs.VERBS.craft = craftPlan;
  const before = verbs.hooks.more;
  verbs.hooks.more = env => [...before(env), ...listed(env)];
  const after = verbs.hooks.after;
  verbs.hooks.after = async (env, receipt) => {
    await after(env, receipt);
    await deliver(env);
  };
}

module.exports = { RULES, masteryOf, modifier, practise, taming, deliver, listed, install, craftPlan, oddsOf };
