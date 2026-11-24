'use strict';
/* Rewards (奖励, 玩法设计第十二节「材料与奖励」; plan item 30): what the engine hands out, read from
 * content/life/rewards.json, as goods of the catalogue (goods.cjs) under their catalogue names and
 * counts; the model only describes them. No model is called here.
 *
 * roll(env, source, ctx?) → { source, tier, band, place, items }
 *   source  差事 采集 狩猎 秘境 战利品 奇遇 大比 (the file's sources)
 *   ctx     tier     the reward's tier (一阶 …), by default the player's realm's (goods.tierOf); held to
 *                    the tiers the source has: the highest one below it, else the lowest
 *           danger   0 to 100, by default the place's (places.placeFacts): the band is the highest of
 *                    the file's dangers it reaches among those the source has (else the nearest);
 *                    a source with the file's `any` band does not look at danger
 *           place    a map place: its own cell (the file's places) takes the place of the source's
 *           classes  only entries of these classes (what a place produces)
 *           foe      the foe's class: 战利品's entries are each for one class (foes.json classes)
 *           species  a beast's species, or null: beast materials of that species only, else of none
 *           without  classes left out of the cell (差事's 灵石: a job's stones are its pay)
 *           picks    how many to give in place of the cell's roll of it: a number, or 'most' (the top
 *                    of the cell's picks)
 *           fewer    that many picks fewer than rolled, one at least (差事's goods: the cell's picks
 *                    counted its stones in, which a job's pay stands for)
 *           seed     the roll's own seed in place of the timeline's (奇遇's close: the same whenever
 *                    it is asked, so the beat the model writes and the close give the same)
 *           target, nth  the seed's target and count ('' and 1 by default)
 *   items   [{ id, name, class, tier, count, unit, price }]: at most the file's max, never the same
 *           good twice. How many is the cell's picks; each is an entry drawn by weight, then a good
 *           of its class and tier (or of its goods) drawn by 1/√price, key materials only where an
 *           entry names them; the count is in the entry's range. On the timeline seed { kind: check,
 *           type: 奖励·<source>, target, nth }: the same moment, source and target give the same.
 * grant(env, items) → { commands, owns }: the commands that put the items in the bag (an item's
 *   quality, when it has one, marks its name: goods.named; an item's `name`, when it is not the
 *   good's, is a piece of the story's: that name, its numbers the good's), on a stack of the same name and type
 *   when there is one (as the trade rule does), else under a free id, and the
 *   spirit stones in the purse (column 26) at their price in 下品灵石 (in the bag when the purse
 *   cannot be read).
 * loot(env, foe) → the settled receipt of kind "loot" (source "engine") of what a foe felled in a
 *   won fight leaves, or null when it leaves nothing. `foe` is what the fight engine passes for each
 *   foe felled (fight.loot): { id, name, class, tier } with tier foes.json's (0 凡俗, 1 一阶 …); an
 *   id alone will do (the tier is then read from its realm). The beast a hunt met leaves what the
 *   hunt showed (frxPlay.hunt, by name); any other foe a roll of 战利品 by its class, its species
 *   and its tier; a foe of tier 0 carries nothing a cultivator wants. receipt.loot: { foe: { id,
 *   name, class, species, tier }, from: 狩猎 | 战利品, items }, tier the goods' (一阶 …).
 * fortune(env, month): the month step of 奇遇 (month.cjs): one roll a month by the player's 气运
 *   band (the file's fortune.chance, in percent, moved by the points of the player's fortune
 *   effects, talents such as 大气运者), on the check seed of 奇遇 at the month's first
 *   moment. A hit puts a clue in frxPlay.pending ({ id, trigger: { kind: now, value: fortune }, seed,
 *   from: fortune, since }) and writes its chronicle line on the last day of the month that ended;
 *   it never gives a thing. At most fortune.waiting clues wait at once.
 * The 奇遇's scene (a scene a clue opened: origin fortune, pending.cjs) gives what the cell 奇遇
 *   holds when it closes (settle, after the ops that play a card or close a scene: watches): the
 *   outcomes of the cards rolled in it are kept on frxPlay.fortune { scene, outcomes, offer } while
 *   it is on, and the best of them says how much (the file's fortune.close.by: 大成功 the cell's
 *   most picks, 成功 its roll, 失败 one good of one, 大失败 or no card rolled nothing). The roll is
 *   at the place it closes: its own cell first, then its tier (places.tierAt) and its danger's
 *   band, on a seed of the save, the scene and `by` alone. offer { outcome, by, items } is what
 *   closing now gives, worked out after every op of the scene, so the beat that may close it is
 *   told what the player finds and writes it in (plan item 50's fixes: a scene gave the find to
 *   陆远 and the close then gave the player 雷击木 and 石中灵乳); the close gives exactly that.
 *   For a player whose gate ahead asks for a 机缘 it lacks (化神 for an 元婴: gate.chanceWanted), the
 *   offer may carry it too (offer.chance, the gate): the file's fortune.close.chance gives the
 *   percent by the best outcome, rolled on a seed of the save, the scene and `by` of its own; the
 *   close records it (gate.grantChance from fortune) and its receipt says so (fortune.chance).
 *   Receipt { kind: "fortune", source: "engine", fortune: { scene: { id, title }, outcome, by,
 *   tier, band, place, items } }, after the close card; nothing given still settles one (落空).
 *
 * The verbs, verbs.cjs plans (install puts them in verbs.VERBS; the view's list leaves them out
 * until the contract takes the kinds, so their glyph and label are the file's verbs):
 *   gather  { kind: "gather", days? }: 1 to 10 days (one by default) where the place produces something the 采集 table
 *           has (places.json trade.produces, 「类·阶」, item 27: its classes 灵草, 矿材, 灵石, 灵物, at
 *           the lowest of their tiers). One roll of 采集 for that tier, the place's danger and classes, the counts for gather.full days scaled to the days spent and raised
 *           by the player's gather effects (talents), and one more of the first 灵草 when the spirit
 *           beast out finds herbs (寻药, beasts.forage); a stretch broken off gathers for the days up to
 *           the break. receipt.gather: { days, place, kind, tier, items, beast? }; preview.goods the items.
 *   hunt    { kind: "hunt", tier }: tier 1, 2 … (or 「一阶」) among the beasts of the place's foe
 *           table (encounter.table: the rows whose kind of foe fights as a beast, tier 1 up; the
 *           place decides). One day, one target: when the day is over the player meets one
 *           (encounter.start with that kind and tier), and the beat comes before any fight, as with
 *           every encounter. The preview shows that very beast: start is tried on the moment the
 *           day ends (the same dice then), and its loot is rolled at once (狩猎, its species), so
 *           preview.target { name, realm, species, spotted } and preview.loot are what comes. A day
 *           broken off meets nothing of the hunt's (an interruption's encounter or scene comes
 *           instead). receipt.hunt: { tier, place, target | null, loot, encounter? }.
 * frxPlay.hunt: null | { encounter, name, tier, species, loot: [{ id, name, count }], since }: the
 *   beast the last hunt met, until loot hands out what it showed or the next hunt.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const goods = require('./goods.cjs');
const perks = require('./perks.cjs');
const beasts = require('./beasts.cjs');
const world = require('./world.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');
const SPECIES = require('../../../content/art/species.json').rules;

const RULES = data('rewards');
const FOES = data('foes');
const DAY = clock.DAY_MINUTES;
const STONES = '灵石';
const BEASTS = '妖兽材料';
const J = JSON.stringify;

const rowName = row => plain(row?.['1']).split('|')[0];
// A beast's species read from its name, as the fight engine reads it (species.json, first rule).
const speciesOf = name => SPECIES.find(rule => rule.anyWord.some(word => String(name ?? '').includes(word)))?.species ?? null;

// ---------------------------------------------------------------- the roll

const between = (random, [low, high]) => low + Math.floor(random.random() * (high - low + 1));

function pick(random, items, weightOf) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let left = random.random() * total;
  for (const item of items) {
    left -= weightOf(item);
    if (left < 0) return item;
  }
  return items.at(-1);
}

function tierIn(source, tier) {
  const have = Object.keys(RULES.sources[source]).sort((a, b) => goods.TIERS.indexOf(a) - goods.TIERS.indexOf(b));
  if (have.includes(tier)) return tier;
  const below = have.filter(each => goods.TIERS.indexOf(each) < goods.TIERS.indexOf(tier));
  return below.length ? below.at(-1) : have[0];
}

function bandOf(bands, danger) {
  if (Object.hasOwn(bands, RULES.any)) return RULES.any;
  const have = RULES.dangers.filter(band => Object.hasOwn(bands, band.name));
  return (have.filter(band => band.from <= danger).at(-1) || have[0]).name;
}

const playerTier = env => goods.tierOf(mechanics.parseRealm(env.state['0']?.B1?.['2']).major);
const classesOf = entry => (entry.goods ? entry.goods.map(name => goods.lookup(name).class) : [entry.class]);
const fits = (entry, ctx) => (!entry.foe || entry.foe === ctx.foe)
  && (!ctx.classes || classesOf(entry).every(name => ctx.classes.includes(name)))
  && (!ctx.without || !classesOf(entry).some(name => ctx.without.includes(name)));

// The goods an entry may give.
function candidates(entry, ctx) {
  if (entry.goods) return entry.goods.map(goods.lookup);
  const found = goods.GOODS.filter(good => good.class === entry.class && good.tier === entry.tier && !good.key
    && (!entry.kinds || entry.kinds.includes(good.kind)) && (!entry.part || good.part === entry.part));
  if (entry.class !== BEASTS || !Object.hasOwn(ctx, 'species')) return found;
  const own = found.filter(good => good.species === ctx.species);
  return own.length ? own : found.filter(good => !good.species);
}

const itemOf = (good, count) => ({ id: good.id, name: good.name, class: good.class, tier: good.tier, count, unit: goods.unitOf(good), price: good.price });

function roll(env, source, ctx = {}) {
  if (!Object.hasOwn(RULES.sources, source)) throw new Error(`没有「${source}」这种奖励的来源`);
  const tier = tierIn(source, ctx.tier || playerTier(env));
  const danger = Number.isFinite(ctx.danger) ? ctx.danger : places.placeFacts(env).danger;
  const band = bandOf(RULES.sources[source][tier], danger);
  const place = ctx.place && RULES.places[ctx.place]?.[source]?.[tier] ? ctx.place : null;
  const cell = place ? RULES.places[place][source][tier] : RULES.sources[source][tier][band];
  // the op's timeline dice (index.cjs run); a module called outside an op seeds them the same way
  const dice = env.random || (parts => create(clock.seedOf(env, parts)));
  const random = ctx.seed !== undefined ? create(String(ctx.seed))
    : dice({ kind: 'check', type: `奖励·${source}`, target: ctx.target ?? '', nth: ctx.nth ?? 1 });
  const pool = cell.pool.filter(entry => fits(entry, ctx));
  const drawn = ctx.picks === 'most' ? cell.picks[1] : Number.isInteger(ctx.picks) ? ctx.picks : between(random, cell.picks);
  const picks = Math.min(RULES.max, ctx.fewer ? Math.max(1, drawn - ctx.fewer) : drawn);
  const items = [];
  const left = entry => candidates(entry, ctx).filter(good => !items.some(item => item.id === good.id));
  for (let n = 0; n < picks; n += 1) {
    const open = pool.filter(entry => left(entry).length);
    if (!open.length) break;
    const entry = pick(random, open, each => each.weight);
    const good = pick(random, left(entry), each => 1 / Math.sqrt(each.price));
    items.push(itemOf(good, between(random, entry.count)));
  }
  return { source, tier, band, place, items };
}

// ---------------------------------------------------------------- into the bag

function grant(env, items) {
  const commands = [], owns = ownsNothing();
  const locked = env.ctx.storedItemIds(env.state);
  const purse = mechanics.stonesOf(env.state['0']?.B1);
  const pursed = item => purse !== null && goods.byId(item.id).class === STONES;
  const stones = items.filter(pursed).reduce((sum, item) => sum + item.count * item.price, 0);
  const bagged = items.filter(item => !pursed(item));
  const fresh = mechanics.nextItemIds(env, bagged.length);
  for (const item of bagged) {
    const good = goods.byId(item.id);
    // a piece of the story's bought as the catalogue's piece it is (actions.cjs dealOf): the story's
    // name, and what it is, in words
    const renamed = item.name && item.name !== good.name;
    const made = { ...goods.row(good, item.count, item.quality),
      ...(renamed ? { 1: item.name, 3: `数值同${good.name}` } : {}),
      ...(renamed && goods.GEAR_TYPES.includes(good.type) ? { 4: goods.pieceEffect(good) } : {}) };
    const stack = Object.entries(env.state['1'] || {}).find(([id, row]) => row && !locked.has(id) && rowName(row) === made[1]
      && (row['2'] || '') === made[2] && Number.isSafeInteger(env.ctx.itemStackCount(row['5'])));
    const id = stack ? stack[0] : fresh.shift();
    commands.push(stack ? `add(${J(id)},{"5":"${env.ctx.itemStackCount(stack[1]['5']) + item.count}"})` : `set(${J({ 0: id, ...made })})`);
    owns.items.push(id);
    owns.grants.push(made[1]);
  }
  if (stones) {
    commands.push(`add("B1",{"26":"${purse + stones}"})`);
    owns.currency = true;
  }
  return { commands, owns };
}

// ---------------------------------------------------------------- loot

// The goods' tier of a foes.json tier: 一阶 for 1 …; none for 0 (凡俗) and below.
const goodsTier = tier => (Number.isInteger(tier) && tier >= 1 ? goods.TIERS[Math.min(tier, goods.TIERS.length) - 1] : null);

// What a foe is, for its loot: its class (given, else as the fight engine reads it), its species
// and its tier (given as foes.json's, else read from its realm as the fight engine reads it).
// Required where they are used: the fight engine requires this module for loot.
function foeOf(env, entry) {
  const fight = require('./fight.cjs');
  const id = plain(entry.id);
  const row = (id && env.state['0']?.[id]) || null;
  const name = plain(entry.name) || rowName(row);
  const realmText = plain(row?.['2'] ?? entry.realm);
  const tier = Number.isInteger(entry.tier) ? entry.tier : fight.tierOf(mechanics.parseRealm(realmText));
  const kind = Object.hasOwn(FOES.classes, entry.class) ? entry.class : fight.classOf(row || { 1: name, 2: realmText }, '');
  return { id: id || null, name, class: kind, species: speciesOf(name), tier: goodsTier(tier) };
}

async function loot(env, foe) {
  const entry = typeof foe === 'string' ? { id: foe } : { ...(foe || {}) };
  const who = foeOf(env, entry);
  const hunted = env.play.hunt && who.name && env.play.hunt.name === who.name ? env.play.hunt : null;
  if (hunted) env.play.hunt = null;
  if (!hunted && !who.tier) return null;
  const items = hunted ? hunted.loot.map(item => itemOf(goods.byId(item.id), item.count))
    : roll(env, '战利品', { tier: who.tier, foe: who.class, species: who.species, danger: 0, target: who.id || who.name }).items;
  // A world factor's loot (诸神黄昏): a chance of one thing more, drawn on the loot's own seed.
  for (const hook of world.hooks(env, 'lootAdd')) {
    const random = create(`${env.archiveId || ''}:${hook.factor}:${who.id || who.name}:${clock.today(env)}`);
    if (random.random() * 100 < hook.chance) {
      const good = goods.lookup(hook.goods[Math.floor(random.random() * hook.goods.length)]);
      if (good) items.push(itemOf(good, 1));
    }
  }
  if (!items.length) return null;
  const made = grant(env, items);
  return env.settle({
    kind: 'loot', ok: true, source: 'engine', loot: { foe: who, from: hunted ? '狩猎' : '战利品', items },
    commands: made.commands.join('\n'), owns: made.owns,
    summary: hunted ? `猎得${who.name}，得${goods.listed(items)}` : `从${who.name}身上得${goods.listed(items)}`,
  });
}

// ---------------------------------------------------------------- the verbs

// Why the verb cannot be done here and now, whatever its args, or null (verbs.cjs reads its own
// verbs the same way).
function blockedFor(env, label) {
  const player = env.state['0']?.B1;
  if (!mechanics.readClock(env.state)) return `时间行里没有可识别的日期，无法${label}`;
  if (String(player?.['31']).trim() === 'true' || env.play?.fight) return `仍在战斗中，不能${label}`;
  const remarks = env.ctx.parseRemarksString(player?.['9']);
  const life = mechanics.numberIn(remarks['寿元']), age = mechanics.numberIn(remarks['年龄']);
  if (life !== null && age !== null && life - age <= 0) return `寿元已尽，无法${label}`;
  if (mechanics.isFallen(env.ctx, player)) return `你已重伤倒地，无法${label}`;
  return null;
}

const named = (env, facts) => facts.place || chronicle.placeName(env.state) || '这里';
const shown = (env, minutes, lines, more = {}) => ({
  ok: true, minutes, ends: clock.dateOf(mechanics.readClock(env.state).minutes + minutes), lines, formula: [], ...more,
});
const timeOf = settled => `时间 ${settled.time.before}→${settled.time.after}`;

// The classes the 采集 table can give (its entries' classes, and the classes of the goods it names).
const GATHERED = [...new Set(Object.values(RULES.sources['采集']).flatMap(bands => Object.values(bands))
  .flatMap(cell => cell.pool.flatMap(classesOf)))];

// What gathering here brings: the classes the place produces that the 采集 table has, at the lowest
// of their tiers; null where it produces none of them.
function producedOf(facts) {
  const found = list(facts.trade?.produces).map(text => String(text).split('·'))
    .filter(([kind, tier]) => GATHERED.includes(kind) && goods.TIERS.includes(tier));
  if (!found.length) return null;
  const tier = found.map(([, each]) => each).sort((a, b) => goods.TIERS.indexOf(a) - goods.TIERS.indexOf(b))[0];
  return { classes: [...new Set(found.map(([kind]) => kind))], tier };
}

// What gathering for a part of the full stretch gathers: the counts scaled and rounded, the goods
// that come to none left out, and one of the first when none is left.
function scaled(items, part) {
  if (part >= 1) return items;
  const kept = items.map(item => ({ ...item, count: Math.round(item.count * part) })).filter(item => item.count > 0);
  return kept.length ? kept : items.slice(0, 1).map(item => ({ ...item, count: 1 }));
}

// A player's gather effects (药农之子 …: traits.json gather) on what a gathering brings: the counts
// of their classes times 1 + their values, rounded.
function richer(env, items) {
  const found = perks.effectsOf(env, 'gather');
  if (!found.length) return items;
  return items.map(item => {
    const more = found.filter(effect => !effect.classes || effect.classes.includes(item.class)).reduce((sum, effect) => sum + (Number(effect.value) || 0), 0);
    return more ? { ...item, count: Math.max(1, Math.round(item.count * (1 + more))) } : item;
  });
}

// The spirit beast out with the player that finds herbs (寻药, beasts.cjs): one more share of the
// first 灵草 gathered, else of the first thing.
function foragedBy(env, items) {
  const found = beasts.forage(env);
  if (!found || !items.length) return { items };
  const at = Math.max(0, items.findIndex(item => item.class === '灵草'));
  return { items: items.map((item, i) => (i === at ? { ...item, count: item.count + found.count } : item)),
    beast: { id: found.beast.id, name: found.beast.name, use: found.use, item: items[at].name, count: found.count } };
}

// A world factor's contest (全民修仙): others are after the same, one check more; lost, what it
// brings is cut by the hook's factor (each good at least one).
function contestOf(env, verb, target, items) {
  const hook = world.hooks(env, 'contest').find(each => each.verbs.includes(verb));
  if (!hook || !items.length) return { items };
  const CHECKS = { ...rules.RULES.kinds, ...data('checks').kinds };
  const attribute = CHECKS[hook.check].attribute;
  const value = mechanics.totalStats(env, 'B1', mechanics.readStats(env, 'B1'))[attribute] ?? 0;
  const modifier = rules.modifierFor(value), dc = rules.RULES.tiers[hook.tier];
  const roll = Math.floor(env.random({ kind: 'check', type: `${hook.factor}·争抢`, target }).random() * rules.RULES.die) + 1;
  const outcome = rules.checkOutcome(roll, roll + modifier, dc);
  const won = ['大成功', '成功'].includes(outcome);
  return { items: won ? items : items.map(item => ({ ...item, count: Math.max(1, Math.floor(item.count * hook.factor)) })),
    contest: { factor: hook.factor, check: hook.check, roll, modifier, dc, outcome, won } };
}

function gather(env, verb, upTo = null) {
  const { label } = RULES.verbs.gather;
  const blocked = blockedFor(env, label);
  if (blocked) return { refused: blocked };
  const facts = places.placeFacts(env), here = named(env, facts);
  const yields = producedOf(facts);
  if (!yields) return { refused: `${here}是${facts.kind}，没有可${label}的东西` };
  const { min, max } = RULES.gather.days;
  const duration = String(verb.days ?? min).trim();
  const days = /^\d{1,2}$/.test(duration) ? Number(duration) : 0;
  if (days < min || days > max) return { refused: `${label}要写${min}到${max}日` };
  const minutes = upTo === null ? days * DAY : Math.min(days * DAY, upTo);
  const span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `${label}${span}${overrun}` };
  const rolled = roll(env, '采集', { tier: yields.tier, danger: facts.danger, place: facts.place, classes: yields.classes, target: facts.place || facts.kind });
  const foraged = foragedBy(env, richer(env, scaled(rolled.items, minutes / (RULES.gather.full * DAY))));
  const contested = contestOf(env, 'gather', facts.place || facts.kind, foraged.items);
  const items = contested.items;
  const got = goods.listed(items);
  const made = grant(env, items);
  const preview = shown(env, minutes, [], { goods: items });
  preview.lines = [`在${here}${label}${span}，${preview.ends.text}收手。`, `${here}是${facts.kind}，出${yields.tier}的${yields.classes.join('、')}。`, `得${got}。`];
  return {
    minutes, preview,
    receipt: { kind: 'gather', ok: true, source: 'verb', gather: { days, place: facts.place, kind: facts.kind, tier: yields.tier, items,
      ...(foraged.beast ? { beast: foraged.beast } : {}), ...(contested.contest ? { contest: contested.contest } : {}) },
      commands: made.commands.join('\n'), owns: made.owns, summary: '' },
    line: ['gather', { 地点: chronicle.placeName(env.state), 时长: span, 所得: got }],
    finish: settled => { settled.summary = `${label}${span}：得${got}；${timeOf(settled)}`; },
  };
}

// A realm as the preview says it: 炼气四层, 筑基初期.
function realmWords(text) {
  const realm = mechanics.parseRealm(text);
  if (realm.major === 1) return `炼气${chronicle.numeral(realm.minor)}层`;
  return realm.name + (Object.entries(mechanics.COMBAT.realms.stages).find(([, stage]) => stage === realm.minor)?.[0] || '');
}

// The hunt's tier as the verb gives it: 1, "2", 「一阶」 or 「二阶妖兽」; null when it is none.
function tierArg(value) {
  const text = plain(value);
  if (/^\d{1,2}$/.test(text)) return Number(text);
  const at = goods.TIERS.indexOf(text.match(/^([一二三四五六七八九十])阶/)?.[0] ?? '');
  return at >= 0 ? at + 1 : null;
}

const tierWord = tier => goods.TIERS[tier - 1] ?? `${chronicle.numeral(tier)}阶`;

// What can be hunted here: the rows of the place's foe table whose kind fights as a beast, tier 1
// up (凡兽 carry nothing a cultivator wants), by tier.
function grounds(env) {
  const { facts, rows } = require('./encounter.cjs').table(env);
  const by = new Map();
  for (const row of rows) {
    if (FOES.encounters.who[row.who]?.class === 'beast' && row.tier >= 1) by.set(row.tier, [...(by.get(row.tier) || []), row]);
  }
  return { facts, tiers: [...by.keys()].sort((a, b) => a - b), by };
}

// The env as it will stand when `minutes` have passed: the time row moved on as advance moves it,
// frxPlay a copy, the dice on that moment. encounter.start tried there meets whom it will meet when
// the stretch is over, so the preview can name the beast.
function later(env, minutes) {
  const now = mechanics.readClock(env.state);
  const row = mechanics.clockRow(env.state);
  const moved = {
    ...env, play: structuredClone(env.play),
    state: { ...env.state, 4: (env.state['4'] || []).map(each => (each === row ? { ...each, 0: mechanics.clockText(now, minutes) } : each)) },
  };
  moved.random = parts => create(clock.seedOf(moved, parts));
  moved.seedOf = parts => clock.seedOf(moved, parts);
  return moved;
}

const brief = met => ({ id: met.id, who: met.who, name: met.name, realm: met.realm, tier: met.tier, spotted: met.spotted });
const huntLoot = items => items.map(item => ({ id: item.id, name: item.name, count: item.count }));

function hunt(env, verb, upTo = null) {
  const { label } = RULES.verbs.hunt;
  const blocked = blockedFor(env, label);
  if (blocked) return { refused: blocked };
  const { facts, tiers, by } = grounds(env);
  const here = named(env, facts);
  if (!tiers.length) return { refused: `${here}是${facts.kind}，没有可猎的妖兽` };
  const tier = tierArg(verb.tier);
  const listed = tiers.map(tierWord).join('、');
  if (!tiers.includes(tier)) {
    return { refused: plain(verb.tier) ? `${here}没有${tier ? tierWord(tier) : plain(verb.tier).slice(0, 10)}的妖兽，有的是：${listed}` : `${label}要选打哪一阶：${listed}` };
  }
  const full = RULES.hunt.days * DAY;
  const minutes = upTo === null ? full : Math.min(full, upTo);
  const span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `${label}${span}${overrun}` };
  const encounter = require('./encounter.cjs');
  const realm = require('./fight.cjs').realmOfTier(tier, false);
  const place = chronicle.placeName(env.state);
  const receipt = { kind: 'hunt', ok: true, source: 'verb', hunt: { tier, place: facts.place, target: null, loot: [] }, commands: '', owns: ownsNothing(), summary: '' };
  const lines = [`在${here}${label}${span}，寻一头${realm}。`];
  if (minutes < full) {
    return {
      minutes, receipt, preview: shown(env, minutes, [...lines, '没寻着猎物便收手了。']), line: ['hunt', { 地点: place, 时长: span, 目标: '' }],
      finish: settled => { settled.summary = `${label}${span}，没寻着猎物；${timeOf(settled)}`; },
    };
  }
  // The kind of beast: the tier's only one here, else one by weight.
  const rows = by.get(tier);
  const who = rows.length === 1 ? rows[0].who : pick(env.random({ kind: 'check', type: label, target: String(tier) }), rows, row => row.weight).who;
  const met = encounter.start(later(env, minutes), { who, tier }).encounter;
  if (!met) return { refused: `${here}撞不上${realm}` };
  const lootOf = name => roll(env, '狩猎', { tier: tierWord(tier), danger: facts.danger, place: facts.place, species: speciesOf(name), target: name }).items;
  const items = lootOf(met.name);
  const target = { name: met.name, realm, species: speciesOf(met.name), spotted: met.spotted };
  Object.assign(receipt.hunt, { target, loot: items });
  const loss = FOES.losses[FOES.classes[met.class].loss].name;
  const first = met.spotted === 'player' ? '你先发现了它：抢先手还是绕开，由你。' : '它先发现了你：照面就得应战，或者遁走。';
  return {
    minutes, receipt,
    preview: shown(env, minutes, [...lines, `寻着的是一头${met.name}（${realm}，约${realmWords(realm)}）。`, first,
      `打赢了可得${goods.listed(items)}。`, `打输了的下场：${loss}。`], { target, loot: items }),
    line: ['hunt', { 地点: place, 时长: span, 目标: met.name }],
    // The day over, the beast is met (the beat before any fight); a day broken off meets none.
    finish: settled => {
      if (settled.interruption) {
        settled.summary = `${label}${span}，没寻着猎物便被打断；${timeOf(settled)}`;
        return;
      }
      const started = encounter.start(env, { who, tier });
      if (started.refused) {
        settled.summary = `${label}${span}，没撞上${met.name}：${started.refused}；${timeOf(settled)}`;
        return;
      }
      const found = started.encounter;
      if (found.name !== met.name) {
        settled.hunt.target = { name: found.name, realm, species: speciesOf(found.name), spotted: found.spotted };
        settled.hunt.loot = lootOf(found.name);
      }
      settled.hunt.encounter = brief(found);
      env.play.hunt = { encounter: found.id, name: found.name, tier, species: speciesOf(found.name), loot: huntLoot(settled.hunt.loot),
        since: clock.dateKey(clock.today(env)) };
      settled.summary = `${label}${span}，撞上${found.name}（${realm}）；打赢了可得${goods.listed(settled.hunt.loot)}；${timeOf(settled)}`;
    },
  };
}

// ---------------------------------------------------------------- 奇遇, the month step

// A month's chance of 奇遇: by the luck band, moved by the talents' points (大气运者 +5, 天生倒霉 −1;
// traits.json fortune) and multiplied by a world factor's fortune (洞天破碎).
function fortuneChance(env) {
  const rule = RULES.fortune;
  const band = rules.modifierFor(mechanics.totalStats(env, 'B1', mechanics.readStats(env, 'B1'))['气运']);
  const points = perks.effectsOf(env, 'fortune').reduce((sum, effect) => sum + (Number(effect.value) || 0), 0);
  const times = world.hooks(env, 'fortune').reduce((value, hook) => value * hook.factor, 1);
  return Math.min(1, Math.max(0, rule.chance[Math.min(band, rule.chance.length - 1)] + points) / 100 * times);
}

async function fortune(env, month) {
  const rule = RULES.fortune;
  if (list(env.play.pending).filter(each => each.from === 'fortune').length >= rule.waiting) return;
  const chance = fortuneChance(env);
  // The check seed of 奇遇 at the month's first moment (clock.seedOf's shape): a month rolls the
  // same however the stretch of days around it was cut.
  const random = create([env.archiveId, month.minutes, rule.seedType, '', 1].join(':'));
  if (!(random.random() < chance)) return;
  const clues = rule.clues[places.placeFacts(env).kind] || rule.clues[rule.fallback];
  const clue = clues[Math.floor(random.random() * clues.length)];
  const at = month.minutes - DAY;
  env.play.pending = [...list(env.play.pending),
    { id: nextId(env, 'pending', 'P'), trigger: { kind: 'now', value: 'fortune' }, seed: clue, from: 'fortune', since: clock.dateKey(at / DAY) }];
  chronicle.write(env, 'fortune', { 线索: clue }, at);
}

// ---------------------------------------------------------------- 奇遇, its scene's close

const FORTUNE = RULES.fortune.close;
const SOURCE = '奇遇';
const BEST = ['大成功', '成功', '失败', '大失败'];
const WATCHED = new Set(['act', 'scene']);
const watches = op => WATCHED.has(op);

// A card's outcome in the 奇遇's scene `id`, kept until it closes.
function noted(env, id, outcome) {
  const kept = env.play.fortune?.scene === id ? list(env.play.fortune.outcomes) : [];
  env.play.fortune = { scene: id, outcomes: [...kept, outcome] };
}

// What the 奇遇's scene gives if it closes now: the cell rolled as the best outcome in it says, at
// the place it is, on a seed of the save, the scene and that outcome alone (not the moment).
function offerOf(env, scene) {
  const outcomes = env.play.fortune?.scene === scene.id ? list(env.play.fortune.outcomes) : [];
  const outcome = BEST.find(each => outcomes.includes(each)) || null;
  const by = FORTUNE.by[outcome || 'none'] || 'none';
  const facts = places.placeFacts(env);
  const ctx = { place: facts.place, danger: facts.danger, target: `${FORTUNE.seed}:${scene.id}`,
    seed: J([env.archiveId || '', FORTUNE.seed, scene.id, by]),
    ...(facts.place ? { tier: places.tierAt(facts.place, env.worldMap) } : {}) };
  const picks = { none: { picks: 0 }, one: { picks: 1 }, most: { picks: 'most' } }[by] || {};
  const rolled = roll(env, SOURCE, { ...ctx, ...picks });
  const items = by === 'one' ? rolled.items.slice(0, 1).map(item => ({ ...item, count: 1 })) : rolled.items;
  // the 机缘 of a gate ahead that asks for one (化神 for an 元婴), by the outcome, on a seed of its own
  const wanted = require('./gate.cjs').chanceWanted(env);
  const odds = wanted ? Number(FORTUNE.chance?.by?.[outcome || 'none']) || 0 : 0;
  const chance = odds > 0 && create(J([env.archiveId || '', FORTUNE.seed, 'chance', scene.id, by])).random() * 100 < odds ? wanted : null;
  return { outcome, by, tier: rolled.tier, band: rolled.band, place: rolled.place, items, ...(chance ? { chance } : {}) };
}

// What the 奇遇's scene gives as it closes: its offer, granted with its receipt (a gate's 机缘 too).
async function fortuneOf(env, scene) {
  const { outcome, by, tier, band, place, items, chance } = offerOf(env, scene);
  delete env.play.fortune;
  const made = grant(env, items);
  const got = goods.listed(items);
  const granted = chance ? require('./gate.cjs').grantChance(env, { from: 'fortune', scene: scene.id, reason: `奇遇「${scene.title}」` }) : null;
  const won = granted && !granted.refused ? granted : null;
  if (won) chronicle.write(env, 'gateChance', { 关: won.name, 缘由: `奇遇「${scene.title}」` });
  const said = [got ? `得${got}` : '', won ? `得了一桩冲击${won.name}的机缘` : ''].filter(Boolean).join('，');
  return env.settle({
    kind: 'fortune', ok: true, source: 'engine',
    fortune: { scene: { id: scene.id, title: scene.title }, outcome, by, tier, band, place, items, ...(won ? { chance: { gate: won.gate, name: won.name } } : {}) },
    commands: made.commands.join('\n'), owns: made.owns,
    summary: said ? `奇遇「${scene.title}」：${said}` : `奇遇「${scene.title}」：机缘落空，一无所得`,
  });
}

// After an op that plays a card or closes a scene: a card's outcome in a 奇遇's scene is kept (the
// scene a 离开 closes in the same op is the card's), and a 奇遇's scene that closed gives its cell.
async function settle(env) {
  const receipts = [...env.receipts];
  receipts.forEach((receipt, at) => {
    if (receipt.kind !== 'act' || !receipt.ok || !receipt.outcome) return;
    const scene = receipts.slice(at + 1).find(each => each.kind === 'close')?.scene || env.play.scene;
    if (scene?.origin === FORTUNE.origin) noted(env, scene.id, receipt.outcome);
  });
  for (const receipt of receipts) {
    if (receipt.kind === 'close' && receipt.ok && receipt.scene?.origin === FORTUNE.origin) await fortuneOf(env, receipt.scene);
  }
  // a 奇遇's scene still on: what closing it now gives, for the beat that may close it
  const scene = env.play.scene;
  if (scene?.origin === FORTUNE.origin && scene.id) {
    const outcomes = env.play.fortune?.scene === scene.id ? list(env.play.fortune.outcomes) : [];
    const { outcome, by, items, chance } = offerOf(env, scene);
    env.play.fortune = { scene: scene.id, outcomes, offer: { outcome, by, items, ...(chance ? { chance } : {}) } };
  }
}

let installed = false;
// 采集 and 狩猎 for the view's verb list, only where this place has something to gather (its 产什么)
// or beasts to hunt (its encounter table), each off with the reason when it cannot be done now;
// 狩猎 with its options, the tiers of beast here ({ value: "1", label: "一阶" }), one of which goes as
// the verb's tier.
function listed(env) {
  const facts = places.placeFacts(env);
  const tiers = grounds(env).tiers;
  const here = [...(producedOf(facts) ? ['gather'] : []), ...(tiers.length ? ['hunt'] : [])];
  return here.map(kind => {
    const { glyph, label } = RULES.verbs[kind];
    const why = blockedFor(env, label);
    // 狩猎 takes a tier: the ones this place's beasts come in (the interface's picker; the verb's tier)
    const options = kind === 'hunt' ? tiers.map(tier => ({ value: String(tier), label: tierWord(tier) })) : [];
    const word = kind === 'gather' ? `耗时${chronicle.spanText(RULES.gather.days.min * DAY)}` : '';
    return { kind, glyph, label, ...(why ? { note: why } : word ? { word } : {}), ...(options.length ? { options } : {}) };
  });
}

function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.gather = gather;
  verbs.VERBS.hunt = hunt;
  const before = verbs.hooks.more;
  verbs.hooks.more = env => [...before(env), ...listed(env)];
}

module.exports = { roll, grant, loot, fortune, fortuneChance, gather, hunt, install, listed, speciesOf, blockedFor, watches, settle };
