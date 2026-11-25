'use strict';
/* Gear in the cultivation-life play (装备, 玩法设计第八节「装备」「装备的来路」; plan items 33, 34):
 * which worn pieces count, what each gives, attunement, condition, damage, the belt, 符宝, stolen
 * goods, the bags of the fallen and gifts. The numbers are content/life/gear.json; the traits are
 * content/life/perks.json `traits`. The old play's totals (mechanics.totalStats) are not touched:
 * every life-mode total goes through totals() here.
 *
 * frxPlay.gear { <item id>: record }, a record kept once the engine knows something of a piece:
 *   { attuned, condition?, damaged?, fixedOn?, traits?, uses?, stolen?: { owner, name, faction,
 *     region, since }, tier? }
 *   tier     a method's tier when neither the catalogue nor its own texts give one: the player's
 *            tier the day it was first taken up (equip), kept so that it no longer rises with the
 *            player's realm; its cap, when none is written, is that tier's realm (gate.cjs)
 *   attuned  the days of refining done (full at attune.days of its tier: a new piece works at half
 *            until then); condition 残 | 常 | 精 (常 when none); damaged its effect halved until
 *            repaired (fixedOn: the day a smith hands it back); traits from perks.json traits (also
 *            read from the piece's own texts); uses a 符宝's uses left; stolen the owner it was taken
 *            from, gone after stolen.years or one full refining.
 * frxPlay.belt [item id × at most belt.size]: what 物 can use in a fight; never set, the first
 *   beltable things in the bag (beltIds); a thing set there that cannot hang there (an older save's
 *   妖丹 taken for a pill by its name) is left out when it is read.
 *
 * tierOfItem(env, item) → the tier a piece counts as: the catalogue's, one its texts name (三阶),
 *   the one recorded for it (record.tier), else the player's own.
 * pieceOf(env, item, slot, index) → { id, name, slot, index, type, tier, quality?, from: catalogue |
 *   written, base: { stat: n }, above, unusable?, attune: { done, need }, condition, damaged,
 *   traits, stolen?, factor, bonus: { stat: n } }: what one worn piece gives: its base (a catalogue
 *   good by its tier and quality over the tier's stat span; else as its effect is written) times
 *   above (a tier up: above.effect), the attunement (attune.half until full), the condition and
 *   the damage.
 * allGear(env) → { active: [piece + role?], inactive: [piece + reason] }; activeGear(env) the active.
 *   Weapon and armour: the first usable piece each. Treasures: the first 1 + the 神识 band (the
 *   panel's 神识, content/checks.json modifierBands), most slots.treasure.most. Methods: the first is
 *   the main one (role main), then aux by major realm (role aux). Two tiers up: unusable.
 * totals(env, id, stats) → { stat: n } as mechanics.totalStats gives, but the player's gear counted
 *   as above (the statuses' buffs and the traits' bonuses as before; a treasure idle in the fight
 *   under way, fight.idle, does not count). panelOf(env) the player's, for the checks.
 * traitNames(env) → the traits of the active pieces; traitsOf(env, type) → [effect + name + piece].
 * drive(env, fight, commands, owns) → { paid, idle }: at a fight's opening, each active treasure
 *   takes drive.percent of the mana's max (× above.drive a tier up) in order; those that cannot be
 *   paid idle for this fight (fight.idle).
 * canEquip(env, itemId) → null | a reason in Chinese (two tiers up). The ops:
 *   equip { itemId }    mechanics.equipItem, refused two tiers up (receipt equip_item)
 *   unequip { itemId }  mechanics.unequipItem (receipt unequip_item)
 *   belt { items }      the belt: at most belt.size ids of things in the bag that can hang there
 *                       (beltable: what the thing is, never a word in its name), receipt belt, hidden
 *   gift { from }       a person of gifts.favour or more gives a fitting piece, once in
 *                       gifts.everyDays (receipt gift)
 * The verbs (verbs.cjs plans, install):
 *   refine { itemId, days? }  attunes a piece (worn or in the bag): days of its tier at most, the
 *                             rest by default; a full refining clears a stolen mark (receipt refine)
 *   repair { itemId, smith? } mends a damaged piece: a material of its tier and days, or a smith's
 *                             stones and days on the calendar (own entry repair; receipt repair)
 * damage(env, { random, check? }) → { id, name } | null: one active piece damaged, drawn on
 *   random: any, for a loss in a fight; with check { attribute, kind }, a check's critical
 *   failure, one of the pieces it leaned on (adding to its attribute, or a trait bearing on its
 *   kind). damageItem(env, id) damages a given piece.
 * talisman(env, itemId) → null | { uses, tier, attack }: a 符宝 on the belt; spend(env, itemId, commands)
 *   uses one (the last one consumes it).
 * bag(env, foe, { extra }) → { status, items, piece? }: what a felled person's bag holds beyond
 *   the loot: rewards.roll 战利品 rolls times by status, and a gear piece with gear percent (a
 *   catalogue 器 good of the foe's tier, condition and traits rolled); with extra false also the
 *   loot's own roll, for comparing bags. grantBag(env, foe, commands, owns) grants it and marks the
 *   piece stolen when its owner is someone (markStolen: a person of the character table whose name
 *   is not one the encounter tables give), with their faction (factionOf: a sect or family of the
 *   map named in their identity, else their region's people).
 * stolenUse(env, how, ids?) → [clock changes]: using (an active stolen piece, in a fight) or selling
 *   one in its owner's faction's region bumps that faction's clock, or starts it.
 * view(env) → { active: [...], inactive: [...], belt: [...], pieces: { id: marks }, totals } (the life
 *   view; totals the player's as totals() gives them, for the panel in this play).
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const clock = require('./clock.cjs');
const clocks = require('./clocks.cjs');
const goods = require('./goods.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');

const GEAR = data('gear');
const TRAITS = Object.fromEntries(Object.entries(data('perks').traits || {}).filter(([name]) => name !== 'notes'));
const ORDER = mechanics.COMBAT.realms.order;
const BANDS = rules.RULES.modifierBands;
const TYPES = Object.fromEntries(Object.entries(GEAR.slots).map(([slot, rule]) => [rule.type, slot]));
const DAY = clock.DAY_MINUTES;
const YEAR_DAYS = clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear;
const J = JSON.stringify;

const rowName = row => plain(row?.['1'] ?? row?.name).split('|')[0];
const tierIndex = tier => goods.TIERS.indexOf(tier);
const band = value => BANDS.reduce((found, [floor, bonus]) => (value >= floor ? bonus : found), 0);
const playerMajor = env => mechanics.parseRealm(env.state['0']?.B1?.['2']).major;
const playerTier = env => goods.tierOf(playerMajor(env));
const recordOf = (env, id) => (env.play?.gear && typeof env.play.gear === 'object' ? env.play.gear[id] : null) || null;

function mark(env, id) {
  if (!env.play.gear || typeof env.play.gear !== 'object') env.play.gear = {};
  return (env.play.gear[id] ||= { attuned: 0 });
}

// A worn or bagged piece's own texts, whatever the shape (an equipment entry or a table row).
function textsOf(item) {
  return {
    name: rowName(item), type: plain(item?.type ?? item?.['2']),
    effect: plain(item?.currentEffect ?? item?.['9'] ?? '') && plain(item?.type ?? item?.['2']) === '功法'
      ? plain(item?.currentEffect ?? item?.['9']) : plain(item?.effect ?? item?.['4']),
    description: plain(item?.description ?? item?.['3']),
  };
}

// "物攻+10，法攻+6" → [{ stat, value, percent }], read as the old totals read it.
function written(effect) {
  const found = [];
  for (const part of String(effect).split(/[,，]/)) {
    const match = part.trim().match(/([一-龥]+)\s*([+-])\s*(\d+\.?\d*)(%?)/);
    if (match && mechanics.STATS.includes(match[1])) found.push({ stat: match[1], value: (match[2] === '+' ? 1 : -1) * parseFloat(match[3]), percent: !!match[4] });
  }
  return found;
}

// The span of a tier's realm for a stat (content/combat.json baselines).
function span(tier, stat) {
  const range = mechanics.COMBAT.baselines[GEAR.tiers[tier]]?.[stat];
  return range ? range[1] - range[0] : 0;
}

function tierOfText(texts) {
  const found = `${texts.name} ${texts.description} ${texts.effect}`.match(/([一二三四五六七八九])阶/);
  return found ? `${found[1]}阶` : null;
}

function traitsIn(env, id, texts, slot) {
  const kept = list(recordOf(env, id)?.traits);
  const said = Object.keys(TRAITS).filter(name => `${texts.description} ${texts.effect}`.includes(name));
  return [...new Set([...kept, ...said])].filter(name => TRAITS[name] && (!slot || TRAITS[name].slots.includes(slot)));
}

const isTalismanText = texts => GEAR.talisman.words.some(word => texts.name.includes(word) || texts.type.includes(word));

function attuneNeed(tier) {
  return GEAR.attune.days[tier] ?? Object.values(GEAR.attune.days).at(-1);
}

function stolenOf(env, id) {
  const stolen = recordOf(env, id)?.stolen;
  if (!stolen) return null;
  const since = clock.dayOfDate(stolen.since), today = clock.today(env);
  return since !== null && today !== null && today - since >= GEAR.stolen.years * YEAR_DAYS ? null : stolen;
}

function damagedOf(env, id) {
  const record = recordOf(env, id);
  if (!record?.damaged) return false;
  const fixed = clock.dayOfDate(record.fixedOn);
  return fixed === null || clock.today(env) === null || clock.today(env) < fixed;
}

// A piece of the story's is the catalogue's piece it was registered as (goods.ofItem): its tier
// and numbers are that piece's.
function tierOfItem(env, item) {
  const texts = textsOf(item);
  const good = goods.ofItem(texts);
  return (good && good.tier) || tierOfText(texts) || recordOf(env, plain(item?.id ?? item?.['0']))?.tier || playerTier(env);
}

function pieceOf(env, item, slot, index = null) {
  const id = plain(item?.id ?? item?.['0']);
  const texts = textsOf(item);
  const good = goods.ofItem(texts);
  const graded = good && good.quality && (plain(good.effect) === texts.effect || goods.pieceEffect(good) === texts.effect);
  const tier = tierOfItem(env, item);
  const base = {};
  if (graded) {
    for (const entry of written(good.effect)) base[entry.stat] = Math.round(span(good.tier, entry.stat) * GEAR.qualities[good.quality]);
  } else {
    const stats = mechanics.readStats(env, 'B1');
    for (const entry of written(texts.effect)) {
      base[entry.stat] = (base[entry.stat] || 0) + (entry.percent ? Math.floor(mechanics.statValue(stats[entry.stat], 'max') * entry.value / 100) : entry.value);
    }
  }
  const above = Math.max(0, tierIndex(tier) - tierIndex(playerTier(env)));
  const record = recordOf(env, id);
  const need = attuneNeed(tier);
  const done = Math.min(need, Number(record?.attuned) || 0);
  const condition = record?.condition && GEAR.conditions[record.condition] ? record.condition : '常';
  const damaged = damagedOf(env, id);
  const factor = (above ? GEAR.above.effect : 1) * (done >= need ? 1 : GEAR.attune.half) * GEAR.conditions[condition] * (damaged ? GEAR.damage.factor : 1);
  const bonus = Object.fromEntries(Object.entries(base).map(([stat, value]) => [stat, value * factor]));
  const stolen = stolenOf(env, id);
  return {
    id, name: texts.name, slot, index, type: texts.type, tier, ...(graded ? { quality: good.quality } : {}), from: graded ? 'catalogue' : 'written',
    base, above, ...(above >= GEAR.above.most ? {
      unusable: slot === 'technique'
        ? `境界不足：「${texts.name}」为${tier}功法，高出当前${chronicle.numeral(above)}阶，暂时无法修习`
        : chronicle.fill(GEAR.above.reason, { 名: texts.name, 阶: tier, 差: chronicle.numeral(above) }),
    } : {}),
    attune: { done, need }, condition, damaged, traits: traitsIn(env, id, texts, slot), ...(stolen ? { stolen } : {}),
    ...(isTalismanText(texts) ? { talisman: true } : {}), factor, bonus,
  };
}

// The worn pieces by slot, in their slots' order: { weapon: [{ item, index }] … }.
function wornOf(env) {
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const equipment = env.ctx.parseNestedJsonString(remarks.equipment, {}) || {};
  return Object.fromEntries(Object.keys(GEAR.slots).map(slot => [slot,
    (Array.isArray(equipment[slot]) ? equipment[slot] : []).map((item, index) => (item ? { item, index } : null)).filter(Boolean)]));
}

function allGear(env) {
  const major = playerMajor(env);
  const sense = mechanics.statValue(mechanics.readStats(env, 'B1')['神识']);
  const active = [], inactive = [];
  for (const [slot, worn] of Object.entries(wornOf(env))) {
    const rule = GEAR.slots[slot];
    const take = slot === 'treasure' ? Math.min(rule.most, 1 + band(sense))
      : slot === 'technique' ? 1 + (rule.aux[ORDER[major]] ?? rule.aux.higher) : 1;
    let taken = 0;
    for (const { item, index } of worn) {
      const piece = pieceOf(env, item, slot, index);
      if (piece.unusable) inactive.push({ ...piece, reason: piece.unusable });
      else if (taken < take) {
        active.push({ ...piece, ...(slot === 'technique' ? { role: taken === 0 ? 'main' : 'aux' } : {}) });
        taken += 1;
      } else inactive.push({ ...piece, reason: '备用，不算数' });
    }
  }
  return { active, inactive };
}

const activeGear = env => allGear(env).active;

// ---------------------------------------------------------------- totals

const bareContexts = new WeakMap();
// The old totals without the worn gear: the statuses' buffs and the traits' bonuses only.
function bare(env) {
  if (!bareContexts.has(env.ctx)) bareContexts.set(env.ctx, Object.create(env.ctx, { equippedItemRows: { value: () => [] } }));
  return { ...env, ctx: bareContexts.get(env.ctx) };
}

function totals(env, id, stats) {
  if (id !== 'B1') return mechanics.totalStats(env, id, stats);
  const found = mechanics.totalStats(bare(env), id, stats);
  const idle = new Set(list(env.play?.fight?.idle));
  const added = {};
  for (const piece of activeGear(env)) {
    if (idle.has(piece.id)) continue;
    for (const [stat, value] of Object.entries(piece.bonus)) added[stat] = (added[stat] || 0) + value;
    for (const trait of piece.traits) {
      const effect = TRAITS[trait].effect;
      if (effect.type === 'statBonus') added[effect.stat] = (added[effect.stat] || 0) + effect.value;
    }
  }
  // Summed first and rounded once, as the old totals round a stat once.
  for (const [stat, value] of Object.entries(added)) if (stat in found) found[stat] = Math.max(0, Math.round(found[stat] + value));
  return found;
}

// The player's stats for a check: each total as current, its max raised by the same bonus.
function panelOf(env) {
  const raw = mechanics.readStats(env, 'B1');
  const found = totals(env, 'B1', raw);
  return Object.fromEntries(Object.entries(found).map(([stat, value]) => {
    const current = mechanics.statValue(raw[stat]);
    return [stat, { current: value, max: Math.max(0, mechanics.statValue(raw[stat], 'max') + value - current) }];
  }));
}

const traitNames = env => [...new Set(activeGear(env).flatMap(piece => piece.traits))];

function traitsOf(env, type) {
  return activeGear(env).flatMap(piece => piece.traits.filter(name => TRAITS[name].effect.type === type)
    .map(name => ({ name, piece: piece.id, ...TRAITS[name].effect })));
}

// ---------------------------------------------------------------- the fight's side

function drive(env, fight, commands, owns) {
  const stats = mechanics.readStats(env, 'B1');
  let mana = mechanics.statValue(stats['法力']);
  const max = mechanics.statValue(stats['法力'], 'max');
  const paid = [], idle = [];
  for (const piece of activeGear(env).filter(each => each.slot === 'treasure')) {
    const cost = Math.max(1, Math.ceil(max * GEAR.drive.percent / 100)) * (piece.above ? GEAR.above.drive : 1);
    if (mana >= cost) {
      mana -= cost;
      paid.push({ id: piece.id, name: piece.name, cost });
    } else idle.push(piece.id);
  }
  if (paid.length) {
    commands.push(`updateAttribute("B1","法力",{"current":${mana},"max":${max}})`);
    owns.stats.push('法力');
  }
  if (idle.length) fight.idle = idle;
  return { paid, idle };
}

function damageItem(env, id) {
  const record = mark(env, id);
  record.damaged = true;
  delete record.fixedOn;
  return id;
}

// One active piece damaged (a loss in a fight): drawn on `random`. With `check` { attribute,
// kind }, a critical failure of a check: only among the pieces the check leaned on, those adding
// to its attribute (their own effect or a trait's) or bearing a trait that changed it (敛息 on
// 潜行); none, nothing is damaged.
function damage(env, { random, check = null }) {
  const leanedOn = piece => {
    if (!check) return true;
    if ((piece.bonus[check.attribute] || 0) > 0) return true;
    return piece.traits.some(name => {
      const effect = TRAITS[name].effect;
      return (effect.type === 'statBonus' && effect.stat === check.attribute) || list(effect.kinds).includes(check.kind);
    });
  };
  const active = activeGear(env).filter(piece => !piece.damaged && leanedOn(piece));
  if (!active.length) return null;
  const piece = active[Math.floor(random.random() * active.length)];
  damageItem(env, piece.id);
  return { id: piece.id, name: piece.name };
}

// ---------------------------------------------------------------- the belt and 符宝

const bagRow = (env, id) => {
  const row = env.state['1']?.[id];
  return row && !env.ctx.storedItemIds(env.state).has(id) ? row : null;
};

// What hangs at the belt is what a thing is, never a word in its name (「一阶狼妖丹」 is a 妖兽材料,
// 「丹方·聚气散」 a recipe): a good the catalogue lists, by its kind (belt.kinds: 丹, 符); one it
// does not list, by the bag row's type (belt.types: 消耗品, and the 丹药 and 符箓 older rows write);
// a 符宝 (its name says so) whose row's type is a treasure's (belt.talisman).
function beltable(env, id) {
  const row = bagRow(env, id);
  if (!row) return '行囊里没有这件东西';
  const texts = textsOf(row);
  const good = goods.lookup(texts.name);
  const fits = good ? GEAR.belt.kinds.includes(good.kind)
    : GEAR.belt.types.includes(texts.type) || (isTalismanText(texts) && GEAR.belt.talisman.includes(texts.type));
  return fits ? null : chronicle.fill(GEAR.belt.refused, { 名: texts.name });
}

// The belt's ids: what the player set (less what cannot hang there), or, never set, the first
// beltable things in the bag.
function beltIds(env) {
  if (Array.isArray(env.play?.belt)) return env.play.belt.filter(id => !beltable(env, id));
  return Object.keys(env.state['1'] || {}).filter(id => !beltable(env, id)).slice(0, GEAR.belt.size);
}

function beltItems(env) {
  return beltIds(env).map(id => {
    const row = bagRow(env, id);
    const count = row ? env.ctx.itemStackCount(row['5']) : 0;
    return row && Number.isSafeInteger(count) && count > 0 ? { itemId: id, name: rowName(row), quantity: count, type: plain(row['2']) } : null;
  }).filter(Boolean);
}

function usesOf(env, id) {
  const record = recordOf(env, id);
  if (Number.isSafeInteger(record?.uses)) return record.uses;
  const [low, high] = GEAR.talisman.uses;
  return low + Math.floor(create(`${env.archiveId || ''}:符宝:${id}`).random() * (high - low + 1));
}

function talisman(env, id) {
  const row = bagRow(env, id);
  if (!row || !isTalismanText(textsOf(row))) return null;
  const tier = GEAR.talisman.tier;
  const realm = GEAR.tiers[tier];
  const [low, high] = mechanics.COMBAT.baselines[realm]['法攻'];
  return { uses: usesOf(env, id), tier, realm, attack: Math.round(low + (high - low) * GEAR.talisman.attack) };
}

// One use of a 符宝; the last one uses it up.
function spend(env, id, commands, owns) {
  const left = usesOf(env, id) - 1;
  mark(env, id).uses = left;
  if (left <= 0) {
    const count = env.ctx.itemStackCount(env.state['1']?.[id]?.['5']);
    commands.push(count > 1 ? `add(${J(id)},{"5":"${count - 1}"})` : `de(${J(id)})`);
    owns.items.push(id);
    delete env.play.gear[id];
    if (count <= 1 && Array.isArray(env.play.belt)) env.play.belt = env.play.belt.filter(each => each !== id);
  }
  return left;
}

// ---------------------------------------------------------------- stolen goods

// The faction a person belongs to: a sect or family of the map named in the identity; else the
// people of their region (the map place they live at, else where they fell).
function factionOf(env, row) {
  const identity = plain(row?.['2']).split('|').slice(1).join('|');
  const poi = places.mapFacts(env.worldMap).find(each => ['宗门', '家族'].includes(each.kind) && identity.includes(each.name));
  if (poi) return { faction: poi.name, region: poi.sub || poi.main };
  const at = places.factsOf(plain(row?.['16']).split('|')[2] || '', env.worldMap);
  const there = at.place ? places.mapFacts(env.worldMap).find(each => each.name === at.place)?.sub : '';
  const region = there || regionHere(env);
  return { faction: region, region };
}

// The names the encounter tables give (content/life/foes.json encounters.who): 劫修, 银栖阁弟子 …
// are nobody in particular; a person with a name of their own is someone.
const NAMELESS = new Set(Object.values(data('foes').encounters.who).flatMap(kind => list(kind.names)));
const named = (id, row) => /^[CG]/.test(id) && !!row && !!rowName(row) && !NAMELESS.has(rowName(row));

function markStolen(env, id, ownerId, ownerRow) {
  if (!named(ownerId, ownerRow)) return null;
  const { faction, region } = factionOf(env, ownerRow);
  if (!faction) return null;
  mark(env, id).stolen = { owner: ownerId, name: rowName(ownerRow), faction, region, since: clock.dateKey(clock.today(env)) };
  return mark(env, id).stolen;
}

// The region the player is in (the map place's sub region).
function regionHere(env) {
  const facts = places.placeFacts(env);
  const poi = facts.place ? places.mapFacts(env.worldMap).find(each => each.name === facts.place) : null;
  return poi?.sub || places.readWhere(mechanics.placeOf(env.state)).area || '';
}

function stolenUse(env, how, ids = null) {
  const region = regionHere(env);
  const changes = [];
  const pieces = ids ? ids.map(id => ({ id, name: rowName(bagRow(env, id) || {}) || id })) : activeGear(env);
  for (const piece of pieces) {
    const stolen = stolenOf(env, piece.id);
    if (!stolen || !region || stolen.region !== region) continue;
    const name = chronicle.fill(GEAR.stolen.clock.name, { 势力: stolen.faction });
    const found = list(env.play.clocks).find(each => each.name === name);
    if (found) {
      const change = clocks.bump(env, found.id, 1, `${how === 'sell' ? '卖' : '用'}了${stolen.name}的「${piece.name}」`);
      if (change) changes.push(change);
    } else {
      const spec = GEAR.stolen.clock;
      const started = clocks.start(env, { name, scope: { kind: 'region', value: stolen.region }, size: spec.size, value: spec.value,
        rises: spec.rises, falls: spec.falls, full: chronicle.fill(spec.full, { 势力: stolen.faction, 物: piece.name }) },
      `${how === 'sell' ? '卖' : '用'}了${stolen.name}的「${piece.name}」`);
      if (started.clock) changes.push({ id: started.clock.id, name, before: 0, after: started.clock.value, started: true });
    }
  }
  return changes;
}

// ---------------------------------------------------------------- bags and gifts

function weighted(random, weights) {
  const entries = Object.entries(weights);
  let left = random.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of entries) if ((left -= weight) < 0) return name;
  return entries.at(-1)[0];
}

function statusOf(row) {
  const identity = plain(row?.['2']).split('|').slice(1).join('|');
  return GEAR.bags.statuses.find(status => status.words.some(word => identity.includes(word))) || GEAR.bags.fallback;
}

// A catalogue 器 good of a tier, its condition and traits drawn on `random`.
function pieceGood(tier, random, conditions) {
  const pool = goods.GOODS.filter(good => good.class === '成品' && good.kind === '器' && good.tier === tier);
  const fallback = goods.GOODS.filter(good => good.class === '成品' && good.kind === '器');
  const from = pool.length ? pool : fallback;
  if (!from.length) return null;
  const good = from[Math.floor(random.random() * from.length)];
  const slot = TYPES[good.type] || null;
  const traits = Object.keys(TRAITS).filter(name => (!slot || TRAITS[name].slots.includes(slot)));
  const picked = [];
  for (let n = 0; n < 2 && traits.length; n += 1) {
    if (random.random() * 100 >= GEAR.bags.traitChance) continue;
    const name = traits.splice(Math.floor(random.random() * traits.length), 1)[0];
    picked.push(name);
  }
  return { good, condition: weighted(random, conditions), traits: picked };
}

function bag(env, foe, { extra = true } = {}) {
  const row = env.state['0']?.[foe.id] || env.biographies?.[foe.id] || foe.row || {};
  const status = statusOf(row);
  const realm = mechanics.parseRealm(row['2'] ?? foe.realm);
  const tier = goods.tierOf(realm.major);
  const items = [];
  const rolls = (extra ? 0 : 1) + status.rolls;
  for (let n = 0; n < rolls; n += 1) {
    items.push(...require('./rewards.cjs').roll(env, '战利品', { tier, foe: foe.class || 'rogue', danger: 0, target: `bag:${foe.id || foe.name}`, nth: n + 1 }).items);
  }
  const random = create(`${env.archiveId || ''}:bag:${foe.id || foe.name}:${clock.today(env)}`);
  const piece = random.random() * 100 < status.gear ? pieceGood(tier, random, GEAR.bags.conditionWeights) : null;
  return { status: status.name, items, ...(piece ? { piece } : {}) };
}

const valueOf = found => found.items.reduce((sum, item) => sum + item.price * item.count, 0) + (found.piece ? found.piece.good.price : 0);

// Grants a felled person's bag (beyond the loot) and marks what came off a named owner stolen.
function grantBag(env, foe, commands, owns) {
  const found = bag(env, foe);
  const rewards = require('./rewards.cjs');
  const items = [...found.items];
  if (found.piece) items.push({ id: found.piece.good.id, name: found.piece.good.name, class: found.piece.good.class, tier: found.piece.good.tier, count: 1, unit: goods.unitOf(found.piece.good), price: found.piece.good.price });
  if (foe.id) markOpened(env, foe.id);
  if (!items.length) return null;
  const made = rewards.grant(env, items);
  commands.push(...made.commands);
  for (const key of Object.keys(owns)) if (Array.isArray(owns[key]) && Array.isArray(made.owns[key])) owns[key].push(...made.owns[key]);
  if (made.owns.currency) owns.currency = true;
  // The piece's row id: a fresh id the grant wrote (set), found by its name among the commands.
  let stolen = null;
  if (found.piece) {
    const set = made.commands.map(text => text.match(/^set\((\{.*\})\)$/)).filter(Boolean).map(match => JSON.parse(match[1]))
      .find(row => row['1'] === found.piece.good.name);
    const id = set?.['0'] || Object.entries(env.state['1'] || {}).find(([, row]) => rowName(row) === found.piece.good.name)?.[0];
    if (id) {
      const record = mark(env, id);
      record.condition = found.piece.condition;
      if (found.piece.traits.length) record.traits = found.piece.traits;
      const row = env.state['0']?.[foe.id] || env.biographies?.[foe.id];
      if (row) stolen = markStolen(env, id, foe.id, row);
    }
  }
  return { status: found.status, items, ...(found.piece ? { piece: { name: found.piece.good.name, condition: found.piece.condition, traits: found.piece.traits } } : {}), ...(stolen ? { stolen } : {}) };
}

// Whose bags have been opened (frxPlay.bags { <person id>: day }): a felled person's in a won
// fight, or one handed over in the story; each opens once.
function markOpened(env, id) {
  const opened = env.play.bags && typeof env.play.bags === 'object' ? env.play.bags : {};
  env.play.bags = { ...opened, [id]: clock.dateKey(clock.today(env)) };
}

// A 储物袋 the story has someone on the scene hand over (the owner's fourth playtest: 孙老道 gave his
// for the escort he had promised it for, and nothing came of it): opened as a felled person's
// would be (bag(), the loot's own roll and the status's: extra false), by the owner's identity and
// realm, once per person (frxPlay.bags, which a won fight's grantBag marks too). A sect's person
// carries a disciple's loot, anyone else a rogue's. args { from, row? }: the owner's id, on the
// scene; or, when the story's own commands took them off it in the beat they handed it over, their
// row as the beat began (`row`: the server's, life_turns.bags_opened; the page cannot call this op).
// Receipt bag: bag { from, name, status }, items (as loot's), the goods in the bag and the stones
// in the purse.
async function handoverOp(env, args) {
  const id = plain(args.from);
  const given = args.row && typeof args.row === 'object' && !Array.isArray(args.row) ? args.row : null;
  const row = env.state['0']?.[id] || given;
  if (!/^[CG]/.test(id) || !row) return env.refuse('这个人不在场');
  if (env.play.bags?.[id]) return env.refuse(`${rowName(row)}的储物袋已经开过了`);
  const status = statusOf(row);
  const found = bag(env, { id, name: rowName(row), class: status.name === '宗门' ? 'disciple' : 'rogue', row }, { extra: false });
  const items = [...found.items];
  if (found.piece) items.push({ id: found.piece.good.id, name: found.piece.good.name, class: found.piece.good.class, tier: found.piece.good.tier, count: 1, unit: goods.unitOf(found.piece.good), price: found.piece.good.price });
  const made = require('./rewards.cjs').grant(env, items);
  if (found.piece) {
    // the piece's condition and traits, as a felled person's bag records them (grantBag); given, not stolen
    const set = made.commands.map(text => text.match(/^set\((\{.*\})\)$/)).filter(Boolean).map(match => JSON.parse(match[1]))
      .find(each => each['1'] === found.piece.good.name);
    const pieceId = set?.['0'] || Object.entries(env.state['1'] || {}).find(([, each]) => rowName(each) === found.piece.good.name)?.[0];
    if (pieceId) Object.assign(mark(env, pieceId), { condition: found.piece.condition, ...(found.piece.traits.length ? { traits: found.piece.traits } : {}) });
  }
  markOpened(env, id);
  const said = items.length ? goods.listed(items) : '空无一物';
  await env.settle({ kind: 'bag', ok: true, source: 'engine', bag: { from: id, name: rowName(row), status: found.status }, items,
    commands: made.commands.join('\n'), owns: made.owns, summary: `${rowName(row)}的储物袋里：${said}` });
  return { bag: { from: id, items } };
}

async function giftOp(env, args) {
  const id = plain(args.from);
  const row = env.state['0']?.[id];
  if (!/^[CG]/.test(id) || !row) return env.refuse('这个人不在场');
  const { favourTier } = require('./actions.cjs');
  const tiers = data('actions').favour.tiers.map(tier => tier.name);
  if (tiers.indexOf(favourTier(plain(row['15']))) < tiers.indexOf(GEAR.gifts.favour)) return env.refuse(`${rowName(row)}和你的交情还没到「${GEAR.gifts.favour}」`);
  const last = clock.dayOfDate(env.play.gifts?.[id]);
  const today = clock.today(env);
  if (last !== null && today - last < GEAR.gifts.everyDays) return env.refuse(`${rowName(row)}前不久才送过你东西`);
  const random = create(`${env.archiveId || ''}:gift:${id}:${today}`);
  const piece = pieceGood(playerTier(env), random, GEAR.gifts.conditionWeights);
  if (!piece) return env.refuse('眼下没有合用的器物');
  const item = { id: piece.good.id, name: piece.good.name, class: piece.good.class, tier: piece.good.tier, count: 1, unit: goods.unitOf(piece.good), price: piece.good.price };
  const made = require('./rewards.cjs').grant(env, [item]);
  const set = made.commands.map(text => text.match(/^set\((\{.*\})\)$/)).filter(Boolean).map(match => JSON.parse(match[1])).find(each => each['1'] === piece.good.name);
  const itemId = set?.['0'] || Object.entries(env.state['1'] || {}).find(([, each]) => rowName(each) === piece.good.name)?.[0];
  if (itemId) Object.assign(mark(env, itemId), { condition: piece.condition, ...(piece.traits.length ? { traits: piece.traits } : {}) });
  env.play.gifts = { ...(env.play.gifts && typeof env.play.gifts === 'object' ? env.play.gifts : {}), [id]: clock.dateKey(today) };
  await env.settle({ kind: 'gift', ok: true, source: 'engine', gift: { from: id, name: rowName(row), item: piece.good.name, condition: piece.condition, traits: piece.traits },
    commands: made.commands.join('\n'), owns: made.owns, summary: `${rowName(row)}赠你「${piece.good.name}」（${piece.condition}）` });
  return { gift: { item: piece.good.name, itemId: itemId || null, condition: piece.condition, traits: piece.traits } };
}

// ---------------------------------------------------------------- the ops

function canEquip(env, itemId) {
  const row = bagRow(env, itemId);
  if (!row) return '行囊里没有这件东西';
  const slot = TYPES[plain(row['2'])];
  if (!slot) return `「${rowName(row)}」不能装备`;
  return pieceOf(env, { ...row, id: itemId }, slot).unusable || null;
}

async function equipOp(env, args) {
  const id = plain(args.itemId ?? args.item_id);
  const row = env.state['1']?.[id];
  const made = mechanics.equipItem(env, { item_id: id }, 'engine');
  if (!made.ok) return env.refuse(made.reason);
  // A method of no tier the catalogue or its texts know keeps the player's tier of this day: its
  // tier, and its cap when none is written (gate.cjs), no longer rise with the player.
  const texts = textsOf(row);
  if (!made.readOnly && texts.type === '功法' && !(goods.lookup(texts.name)?.tier) && !tierOfText(texts) && !recordOf(env, id)?.tier) {
    mark(env, id).tier = playerTier(env);
  }
  await env.settle(made);
  return { gear: view(env) };
}

async function unequipOp(env, args) {
  const made = mechanics.unequipItem(env, { item_id: plain(args.itemId ?? args.item_id) }, 'engine');
  if (!made.ok) return env.refuse(made.reason);
  await env.settle(made);
  return { gear: view(env) };
}

async function beltOp(env, args) {
  if (!Array.isArray(args.items)) return env.refuse('腰带要给一组东西');
  const ids = [...new Set(args.items.map(plain).filter(Boolean))];
  if (ids.length > GEAR.belt.size) return env.refuse(`腰带只有${chronicle.numeral(GEAR.belt.size)}格`);
  for (const id of ids) {
    const why = beltable(env, id);
    if (why) return env.refuse(why);
  }
  env.play.belt = ids;
  await env.settle({ kind: 'belt', ok: true, hidden: true, source: 'engine', belt: ids, commands: '', owns: ownsNothing(),
    summary: `腰带：${ids.map(id => rowName(bagRow(env, id))).join('、') || '空'}` });
  return { belt: beltItems(env) };
}

// ---------------------------------------------------------------- the verbs

// The piece a verb names: worn (with its slot) or in the bag.
function findPiece(env, id) {
  for (const [slot, worn] of Object.entries(wornOf(env))) {
    const hit = worn.find(({ item }) => plain(item?.id ?? item?.['0']) === id);
    if (hit) return pieceOf(env, hit.item, slot, hit.index);
  }
  const row = bagRow(env, id);
  const slot = row ? TYPES[plain(row['2'])] : null;
  return row && slot ? pieceOf(env, { ...row, id }, slot) : null;
}

function refine(env, verb, upTo = null) {
  const id = plain(verb.itemId ?? verb.item_id);
  const piece = findPiece(env, id);
  if (!piece) return { refused: '没有这件可以祭炼的器物' };
  if (piece.unusable) return { refused: piece.unusable };
  const left = piece.attune.need - piece.attune.done;
  if (left <= 0) return { refused: `「${piece.name}」已经祭炼过了` };
  const asked = verb.days === undefined || verb.days === null || verb.days === '' ? left : Number(verb.days);
  if (!Number.isSafeInteger(asked) || asked < 1) return { refused: '祭炼的日数要是正整数' };
  const days = Math.min(left, asked, upTo === null ? Infinity : Math.max(1, Math.floor(upTo / DAY)));
  const minutes = days * DAY;
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `祭炼${chronicle.spanText(minutes)}${overrun}` };
  const done = piece.attune.done + days;
  const full = done >= piece.attune.need;
  const now = mechanics.readClock(env.state);
  return {
    minutes,
    receipt: { kind: 'refine', ok: true, source: 'verb', refine: { itemId: id, name: piece.name, tier: piece.tier, days, done, need: piece.attune.need, full },
      commands: '', owns: ownsNothing(), summary: '' },
    line: ['refine', { 物: piece.name, 时长: chronicle.spanText(minutes), 成: full ? '祭炼圆满' : `祭炼${chronicle.numeral(done)}日，还差${chronicle.numeral(piece.attune.need - done)}日` }],
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), lines: [`祭炼「${piece.name}」${chronicle.spanText(minutes)}，${full ? '祭炼圆满，效果全出' : `还差${chronicle.spanText((piece.attune.need - done) * DAY)}`}。`], formula: [] },
    finish: receipt => {
      const record = mark(env, id);
      record.attuned = done;
      if (full) delete record.stolen;
      receipt.summary = `祭炼「${piece.name}」${chronicle.spanText(minutes)}：${done}/${piece.attune.need}日${full ? '，圆满' : ''}；时间 ${receipt.time.before}→${receipt.time.after}`;
    },
  };
}

function repair(env, verb, upTo = null) {
  const id = plain(verb.itemId ?? verb.item_id);
  const piece = findPiece(env, id);
  if (!piece) return { refused: '没有这件器物' };
  if (!piece.damaged) return { refused: `「${piece.name}」没有受损` };
  const rule = GEAR.damage.repair;
  const now = mechanics.readClock(env.state);
  const commands = [], owns = ownsNothing();
  if (verb.smith === true) {
    const stones = rule.smith.stones[piece.tier] ?? Object.values(rule.smith.stones).at(-1);
    const days = rule.smith.days[piece.tier] ?? Object.values(rule.smith.days).at(-1);
    const have = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
    if (have < stones) return { refused: `找炼器师要${chronicle.count(stones)}块灵石，只有${chronicle.count(have)}块` };
    commands.push(`add("B1",{"26":"${have - stones}"})`);
    owns.currency = true;
    const back = clock.dateKey(clock.today(env) + days);
    return {
      minutes: 0,
      receipt: { kind: 'repair', ok: true, source: 'verb', repair: { itemId: id, name: piece.name, smith: true, stones, until: back }, commands: commands.join('\n'), owns, summary: '' },
      line: ['repair', { 物: piece.name, 法: `交给炼器师，付${chronicle.count(stones)}块灵石，${clock.dateOf(clock.dayOfDate(back) * DAY).text}取回` }],
      preview: { ok: true, minutes: 0, ends: clock.dateOf(now.minutes), lines: [`交给炼器师修「${piece.name}」：${chronicle.count(stones)}块灵石，${chronicle.numeral(days)}日后取回。`], formula: [] },
      finish: receipt => {
        mark(env, id).fixedOn = back;
        calendar.register(env, 'repair', { date: back, title: `取回「${piece.name}」` });
        receipt.summary = `交给炼器师修「${piece.name}」：灵石 ${have}→${have - stones}，${back}取回`;
      },
    };
  }
  // By one's own hand: a material of the piece's tier, taken when the mending starts, and the days
  // (a stretch broken off keeps the days done: record.mending).
  const need = rule.days[piece.tier] ?? Object.values(rule.days).at(-1);
  const done = Number(recordOf(env, id)?.mending) || 0;
  let material = null;
  if (!done) {
    const stored = env.ctx.storedItemIds(env.state);
    material = Object.entries(env.state['1'] || {}).find(([key, row]) => row && !stored.has(key) && goods.lookup(rowName(row))?.class === rule.material
      && goods.lookup(rowName(row)).tier === piece.tier && env.ctx.itemStackCount(row['5']) > 0);
    if (!material) return { refused: `自己修要一份${piece.tier}的${rule.material}` };
    const count = env.ctx.itemStackCount(material[1]['5']);
    commands.push(count > 1 ? `add(${J(material[0])},{"5":"${count - 1}"})` : `de(${J(material[0])})`);
    owns.items.push(material[0]);
  }
  const days = Math.min(need - done, upTo === null ? need - done : Math.max(1, Math.floor(upTo / DAY)));
  const minutes = days * DAY;
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `修补${chronicle.spanText(minutes)}${overrun}` };
  const mended = done + days >= need;
  const how = material ? `用${rowName(material[1])}修补` : '接着修补';
  return {
    minutes,
    receipt: { kind: 'repair', ok: true, source: 'verb', repair: { itemId: id, name: piece.name, ...(material ? { material: rowName(material[1]) } : {}), days, done: done + days, need, mended },
      commands: commands.join('\n'), owns, summary: '' },
    line: ['repair', { 物: piece.name, 法: `${how}${chronicle.spanText(minutes)}${mended ? '，修好了' : ''}` }],
    preview: { ok: true, minutes, ends: clock.dateOf(now.minutes + minutes), lines: [`${how}「${piece.name}」${chronicle.spanText(minutes)}${mended ? '，修好' : ''}。`], formula: [] },
    finish: receipt => {
      const record = mark(env, id);
      if (mended) {
        delete record.damaged;
        delete record.fixedOn;
        delete record.mending;
      } else record.mending = done + days;
      receipt.summary = `${how}「${piece.name}」${chronicle.spanText(minutes)}${mended ? '，修好了' : `，还差${chronicle.numeral(need - done - days)}日`}；时间 ${receipt.time.before}→${receipt.time.after}`;
    },
  };
}

// ---------------------------------------------------------------- the view

function marksOf(piece) {
  return { name: piece.name, slot: piece.slot, tier: piece.tier, ...(piece.quality ? { quality: piece.quality } : {}),
    attune: piece.attune, condition: piece.condition, ...(piece.damaged ? { damaged: true } : {}), ...(piece.stolen ? { stolen: { owner: piece.stolen.name, faction: piece.stolen.faction } } : {}),
    traits: piece.traits, ...(piece.above ? { above: piece.above } : {}),
    ...(piece.unusable ? { unusable: piece.unusable } : {}) };
}

function view(env) {
  const { active, inactive } = allGear(env);
  const pieces = {};
  for (const [id, row] of Object.entries(env.state['1'] || {})) {
    const slot = row ? TYPES[plain(row['2'])] : null;
    if (slot && bagRow(env, id)) pieces[id] = marksOf(pieceOf(env, { ...row, id }, slot));
  }
  for (const piece of [...active, ...inactive]) pieces[piece.id] = marksOf(piece);
  const belt = beltItems(env);
  return {
    active: active.map(piece => ({ id: piece.id, slot: piece.slot, ...(piece.role ? { role: piece.role } : {}),
      bonus: Object.fromEntries(Object.entries(piece.bonus).map(([stat, value]) => [stat, Math.round(value)])) })),
    inactive: inactive.map(piece => ({ id: piece.id, slot: piece.slot, reason: piece.reason })),
    belt: Array.from({ length: GEAR.belt.size }, (_, i) => belt[i] || null),
    pieces,
    totals: totals(env, 'B1', mechanics.readStats(env, 'B1')),
  };
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.refine = refine;
  verbs.VERBS.repair = repair;
}

module.exports = {
  GEAR, TRAITS, tierOfItem, pieceOf, allGear, activeGear, totals, panelOf, traitNames, traitsOf, drive, damage, damageItem,
  beltIds, beltItems, talisman, spend, stolenUse, markStolen, bag, valueOf, grantBag, canEquip, view, install,
  equip: equipOp, unequip: unequipOp, belt: beltOp, gift: giftOp, handover: handoverOp,
};
