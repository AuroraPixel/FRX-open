'use strict';
/* Arrays (阵法, 玩法设计第八节「阵法」; plan item 43): laid beforehand for the advantage of the ground.
 * The numbers and words are content/life/arrays.json. No model is called here.
 *
 * frxPlay.arrays { laid: [array], field: [array], stations: { <place>: { job, quest } } }
 *   laid      the standing arrays (home: 聚灵 禁制 隐匿 护府), one of each name a place: at the
 *             player's home (home.cjs, plan item 45), else where the player is (where they
 *             cultivate): { id, name, tier, power, place, since, tool, charge? } (charge: 护府's)
 *   field     the arrays laid before a fight (fight: 困 杀 幻 护), one of each name a place:
 *             { id, name, tier, power, place, ground, person?, charge, since, tool }; the first fight
 *             that opens there on that ground takes them up, and they go with it, but at home, where
 *             what is left of them stays for the next
 *   stations  the repair errand of a broken teleport array taken there: { job, quest }; it works
 *             once that quest's row (table 6) is 已完成
 *   power     1, or check.results' share when the check failed (阵力减半)
 * The verb array (布阵, verbs.VERBS): { name, item?, charge?, person? } or { repair: true }
 *   name      a key of home or fight; item the tool (a bag id or a name among the array's tools),
 *             else the highest tier the player's 布阵 mastery reaches; charge the stones a fight
 *             array or a 护府 holds (burn of its tier × rounds by default), from the purse; person
 *             the one to be lured in (a character on the scene)
 *   A fight array needs a ground the player chose (grounds, else texts.ground): the home, an
 *   encounter where the player spotted a foe meaning harm first (ambush), or a lure; not in a
 *   fight. minutes[home | fight] pass; the tool is used up; one check on the timeline seed { kind:
 *   check, type: 布阵, target: the name }: d10 plus the 神识 band, the 布阵 mastery (crafts.cjs) and
 *   the talents' 布阵 craft effects, against check.tiers[the tool's tier]; success counts once for
 *   the mastery (crafts.practise). A stretch broken off lays nothing. Receipt kind "array", action
 *   lay: array { name, label, kind, tier, power, place, ground?, person?, charge?, purse?: { before,
 *   after }, check, mastery? } (laid: false when broken off).
 *   repair    at a station with a repair: its errand taken as a 差事 (jobs.cjs' frxPlay.jobs, the
 *             quest row and the calendar entry, goal and place the repair's); receipt action repair.
 * auraBonus(env) → { value, label } | null: the 聚灵 here, aura × its tier (most tiers at most) ×
 *   its power: what verbs.cjs adds to the aura cultivating counts.
 * sealed(env) → a 禁制 is laid here: no chance of an interruption (interrupt.hooks.sealed).
 * pace(env, clock) → the pace of a clock aimed here (scope place or home) where a 隐匿 is laid:
 *   1 − (1 − slower) × power (clocks.hooks.pace).
 * The fight's side (fight.hooks): fight.arrays [{ id, name, label, effects, tier, side: player |
 *   foes, power, charge, burn, from: field | home | given, laid? }]
 *   opening   the field arrays here on this fight's ground (home: a fight at the home; ambush: the
 *             player's ambush; lure: the person lured among the foes), the home's 护府 (its fight
 *             effects, its charge) at the home, and the foes' arrays given to the fight
 *             (args.arrays [{ name, tier, charge? }]); 幻 gives its side the first move
 *   blow      困: the held side's 脚力 × (1 − (1 − agility) × power); 幻: the held side's hit +
 *             hit × power; 护: the damage its side takes × (1 − (1 − damage) × power)
 *   stay      困 holds its foes: a foe's 遁 holds (texts.stay), the player's is refused (texts.held)
 *   round     at the round's end each array of 杀 strikes the first fighter standing on the other
 *             side (its tier's realm and 法攻 at strike.attack of the span, damage × power), then
 *             every array burns burn[its tier] of its charge; at 0 it is gone (texts.gone)
 *   break     the player's 破阵 on a foes' array (the strongest), and a foe's (intent 破阵, a
 *             break.foes percent chance a round while the player's array holds it): a check of
 *             break.checks (the player's better one; a foe's 神识 by its realm's baseline) against
 *             break.tiers[the array's tier]; success takes break.rounds rounds of burn off it
 *   ended     a field array is gone with the fight but at home; a home's 护府 keeps its charge
 *   view      the 破阵 command while a foes' array stands, and arrays: [{ id, name, side, tier,
 *             charge, rounds, power }]
 * cross(env, at, dest) → travel.hooks.cross: a station here (teleport.stations) linked to `dest`:
 *   { days, stones, station }, refused while it is broken (the repair errand not done) or the
 *   purse is short; null where there is none.
 * view(env) → { laid, field, station? }: the arrays here and the station, for the life view.
 * install(verbs, { fight, interrupt, clocks, travel }) puts it all in place, once.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const actions = require('./actions.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const calendar = require('./calendar.cjs');
const places = require('./places.cjs');
const goods = require('./goods.cjs');
const gear = require('./gear.cjs');
const perks = require('./perks.cjs');
const crafts = require('./crafts.cjs');
const rewards = require('./rewards.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('arrays');
const TEXTS = RULES.texts;
const GEAR = data('gear');
const DAY = clock.DAY_MINUTES;
const DIE = rules.RULES.die;
const SUCCESS = ['大成功', '成功'];
const J = JSON.stringify;

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const fill = (template, values) => chronicle.fill(template, values);
const tierIndex = tier => goods.TIERS.indexOf(tier);
const round2 = value => Math.round(value * 100) / 100;

function bookOf(env) {
  const book = isObject(env.play.arrays) ? env.play.arrays : {};
  return { laid: list(book.laid), field: list(book.field), stations: isObject(book.stations) ? book.stations : {} };
}

const kindOf = name => (Object.hasOwn(RULES.home, name) ? 'home' : Object.hasOwn(RULES.fight, name) ? 'fight' : null);
const ruleOf = name => RULES.home[name] || RULES.fight[name] || null;
const labelOf = name => ruleOf(name)?.label || name;

// Where an array is laid: the map place the player is at (the home is one), else the spot.
function placeOf(env) {
  const facts = places.placeFacts(env);
  return facts.place || facts.spot || '';
}

const atHome = (env, place = placeOf(env)) => !!place && env.play?.home?.place === place;
const laidAt = (env, name, place = placeOf(env)) => bookOf(env).laid.find(each => each.name === name && each.place === place) || null;

// ---------------------------------------------------------------- the tools and the check

// The array's tools in the bag, the highest tier first: [{ id, name, tier, count }].
function toolsOf(env, rule) {
  const stored = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {})
    .filter(([id, row]) => row && !stored.has(id))
    .map(([id, row]) => ({ id, good: goods.lookup(row['1']), count: Number(env.ctx.itemStackCount(row['5'])) || 0 }))
    .filter(each => each.good && rule.tools.includes(each.good.name) && each.count > 0)
    .map(each => ({ id: each.id, name: each.good.name, tier: each.good.tier, count: each.count, unit: goods.unitOf(each.good) }))
    .sort((a, b) => tierIndex(b.tier) - tierIndex(a.tier) || a.id.localeCompare(b.id));
}

function termsOf(env, tier) {
  const value = gear.totals(env, 'B1', mechanics.readStats(env, 'B1'))[RULES.check.attribute];
  const mastery = crafts.masteryOf(env, RULES.check.craft);
  const gift = perks.effectsOf(env, 'craft').filter(effect => !effect.kinds || effect.kinds.includes(RULES.check.craft))
    .reduce((sum, effect) => sum + (Number(effect.value) || 0), 0);
  const band = rules.modifierFor(value);
  return { modifier: band + mastery.modifier + gift, dc: rules.RULES.tiers[RULES.check.tiers[tier]], mastery,
    terms: [{ label: RULES.check.attribute, value: band }, { label: `${RULES.check.craft}「${mastery.name}」`, value: mastery.modifier },
      ...(gift ? [{ label: '天赋', value: gift }] : [])] };
}

const oddsOf = (modifier, dc) => {
  let won = 0;
  for (let roll = 1; roll <= DIE; roll += 1) if (SUCCESS.includes(rules.checkOutcome(roll, roll + modifier, dc))) won += 1;
  return Math.round(100 * won / DIE);
};

// ---------------------------------------------------------------- the ground of a fight array

function groundOf(env, verb) {
  if (atHome(env)) return { ground: 'home' };
  const met = env.play.encounter;
  if (met && met.spotted === 'player' && met.hostile) return { ground: 'ambush', person: null };
  const lured = plain(verb.person);
  const row = lured ? env.state['0']?.[lured] : null;
  if (row && /^[CG]/.test(lured) && !mechanics.isFallen(env.ctx, row)) return { ground: 'lure', person: lured };
  return null;
}

// ---------------------------------------------------------------- the verb

const shown = (env, minutes, lines, formula = []) => ({ ok: true, minutes, ends: clock.dateOf(mechanics.readClock(env.state).minutes + minutes), lines, formula });

function arrayPlan(env, verb, upTo = null) {
  const blocked = rewards.blockedFor(env, '布阵');
  if (blocked) return { refused: env.play?.fight ? TEXTS.inFight : blocked };
  if (verb.repair === true) return repairPlan(env);
  const name = plain(verb.name);
  const kind = kindOf(name);
  if (!kind) return { refused: name ? `没有「${name.slice(0, 10)}」这种阵` : `布阵要说布哪种阵：${[...Object.keys(RULES.home), ...Object.keys(RULES.fight)].join('、')}` };
  const rule = ruleOf(name);
  const place = placeOf(env);
  if (!place) return { refused: '认不出你在哪里，阵没处布' };
  const ground = kind === 'fight' ? groundOf(env, verb) : null;
  if (kind === 'fight' && !ground) return { refused: TEXTS.ground };
  const mastery = crafts.masteryOf(env, RULES.check.craft);
  const tools = toolsOf(env, rule);
  const asked = plain(verb.item);
  const tool = asked ? tools.find(each => each.id === asked || each.name === asked)
    : tools.find(each => tierIndex(each.tier) <= tierIndex(mastery.top)) || tools[0];
  if (!tool) return { refused: fill(TEXTS.noTool, { 阵: rule.label, 器: asked || rule.tools.join('或') }) };
  if (tierIndex(tool.tier) > tierIndex(mastery.top)) {
    return { refused: fill(TEXTS.mastery, { 档: mastery.name, 顶: mastery.top, 器: tool.name, 阶: tool.tier }) };
  }
  const tier = tool.tier;
  const burn = RULES.burn[tier];
  const charged = kind === 'fight' || name === '护府';
  const given = verb.charge !== undefined && verb.charge !== null && verb.charge !== '';
  const stones = !charged ? 0 : given ? (/^\d{1,9}$/.test(String(verb.charge).trim()) ? Number(verb.charge) : 0) : burn * RULES.rounds;
  if (charged && stones < burn) return { refused: `${rule.label}至少要放${chronicle.numeral(burn)}块灵石，撑得了一回合` };
  const purse = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
  if (stones > purse) return { refused: fill(TEXTS.stones, { 阵: rule.label, 数: chronicle.numeral(stones), 有: chronicle.numeral(purse) }) };
  const full = RULES.minutes[kind];
  const overrun = clock.overrun(env, full);
  if (overrun) return { refused: `布阵${chronicle.spanText(full)}${overrun}` };
  const terms = termsOf(env, tier);
  const odds = oddsOf(terms.modifier, terms.dc);
  const lines = [
    `在${place}布下${tier}${rule.label}，用一${tool.unit}「${tool.name}」，花${chronicle.spanText(full)}。`,
    ...(ground ? [`战场：${RULES.grounds[ground.ground]}${ground.person ? `（${rowName(env.state['0'][ground.person])}）` : ''}。`] : []),
    ...(charged ? [`放进${chronicle.numeral(stones)}块灵石，每回合烧${chronicle.numeral(burn)}块，撑${chronicle.numeral(Math.floor(stones / burn))}回合。`] : []),
    `神识检定，骰加${terms.terms.map(term => `${term.label}${term.value}`).join('、')}，对难度${terms.dc}；成算${chronicle.numeral(Math.round(odds / 10))}成，败了阵力减半。`,
  ];
  const formula = terms.terms.map(term => ({ label: term.label, value: `${term.value >= 0 ? '+' : ''}${term.value}` }));
  // Broken off before it is done, nothing is laid and nothing spent.
  if (upTo !== null && upTo < full) {
    const minutes = Math.max(0, upTo);
    return {
      minutes, preview: shown(env, minutes, lines, formula),
      receipt: { kind: 'array', ok: true, source: 'verb', action: 'lay', array: { name, label: rule.label, kind, tier, place, laid: false }, commands: '', owns: ownsNothing(), summary: '' },
      line: ['arrayCut', { 地点: chronicle.placeName(env.state), 阵: rule.label }],
      finish: settled => { settled.summary = `布${rule.label}布到一半被打断；时间 ${settled.time.before}→${settled.time.after}`; },
    };
  }
  const roll = Math.floor(env.random({ kind: 'check', type: '布阵', target: name }).random() * DIE) + 1;
  const outcome = rules.checkOutcome(roll, roll + terms.modifier, terms.dc);
  const power = RULES.check.results[outcome];
  const check = { roll, modifier: terms.modifier, total: roll + terms.modifier, dc: terms.dc, outcome };
  const left = tool.count - 1;
  const commands = [left > 0 ? `add(${J(tool.id)},{"5":"${left}"})` : `de(${J(tool.id)})`, ...(stones ? [`add("B1",{"26":"${purse - stones}"})`] : [])];
  const owns = { ...ownsNothing(), items: [tool.id], currency: stones > 0 };
  const array = { name, label: rule.label, kind, tier, power, place, ...(ground ? { ground: ground.ground, ...(ground.person ? { person: ground.person } : {}) } : {}),
    ...(charged ? { charge: stones, purse: { before: purse, after: purse - stones } } : {}), check };
  return {
    minutes: full, preview: shown(env, full, lines, formula),
    receipt: { kind: 'array', ok: true, source: 'verb', action: 'lay', array, commands: commands.join('\n'), owns, summary: '' },
    line: ['arrayLay', { 地点: chronicle.placeName(env.state), 阶: tier, 阵: rule.label, 成: power < 1 ? '阵力只有一半' : '' }],
    finish: settled => {
      const book = bookOf(env);
      const made = { id: nextId(env, 'array', 'A'), name, tier, power, place, since: clock.dateKey(clock.today(env)), tool: tool.name,
        ...(ground ? { ground: ground.ground, ...(ground.person ? { person: ground.person } : {}) } : {}), ...(charged ? { charge: stones } : {}) };
      const key = kind === 'home' ? 'laid' : 'field';
      book[key] = [...book[key].filter(each => !(each.name === name && each.place === place)), made];
      env.play.arrays = book;
      settled.array.id = made.id;
      if (SUCCESS.includes(outcome)) settled.array.mastery = crafts.practise(env, RULES.check.craft);
      settled.summary = `布下${tier}${rule.label}（${outcome}${power < 1 ? '，阵力减半' : ''}）${charged ? `，放灵石${stones}块` : ''}；时间 ${settled.time.before}→${settled.time.after}`;
    },
  };
}

const rowName = row => plain(row?.['1']).split('|')[0];

// The repair errand of a broken station, taken as a 差事 (jobs.cjs keeps it and pays it).
function repairPlan(env) {
  const place = places.placeFacts(env).place;
  const station = place ? RULES.teleport.stations[place] : null;
  if (!station) return { refused: TEXTS.station };
  const repair = station.repair;
  if (!repair) return { refused: fill(TEXTS.repairNone, { 地: place }) };
  const taken = bookOf(env).stations[place];
  if (taken && !lapsed(env, taken)) return { refused: fill(TEXTS.repairTaken, { 事: repair.title }) };
  const today = clock.today(env);
  const due = clock.dateKey(today + repair.days);
  const quest = questId(env);
  const realm = mechanics.COMBAT.realms.order[mechanics.cultivator(env).major] ?? mechanics.COMBAT.realms.order[0];
  const text = fill(repair.text, { 期: chronicle.numeral(repair.days) });
  const row = { 0: quest, 1: `差事：${repair.title}`, 2: `${place}的传送阵：${text}`, 3: '修好传送阵', 4: '过了期限作罢', 5: `进行中（${realm}）` };
  const owns = ownsNothing();
  owns.quests.push(quest);
  const job = { id: `修阵·${place}`, kind: '修阵', title: repair.title, place, goal: repair.goal, pay: 0, due, quest };
  return {
    minutes: 0, preview: shown(env, 0, [`接下「${repair.title}」：${text}`]),
    receipt: { kind: 'array', ok: true, source: 'verb', action: 'repair', job, commands: `set(${J(row)})`, owns, summary: '' },
    line: ['job', { 地点: place, 差事: repair.title }],
    finish: settled => {
      const entry = calendar.register(env, 'job', { date: due, title: repair.title, place });
      env.play.jobs = [...list(env.play.jobs).filter(each => each.id !== job.id), { ...job, entry: entry.id, board: place }];
      const book = bookOf(env);
      book.stations = { ...book.stations, [place]: { job: job.id, quest } };
      env.play.arrays = book;
      settled.summary = `接下修传送阵的差事「${repair.title}」，期限${clock.dateOf(clock.dayOfDate(due) * DAY).text}`;
    },
  };
}

function questId(env) {
  const numbers = Object.keys(env.state['6'] || {}).map(id => /^T(\d+)$/.exec(id)?.[1]).filter(Boolean).map(Number);
  return `T${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

const statusOf = (env, taken) => String(env.state['6']?.[taken.quest]?.['5'] ?? '');
const repaired = (env, place) => { const taken = bookOf(env).stations[place]; return !!taken && statusOf(env, taken).startsWith('已完成'); };
const lapsed = (env, taken) => statusOf(env, taken).startsWith('已失败');

// ---------------------------------------------------------------- the standing arrays

function auraBonus(env) {
  const found = laidAt(env, '聚灵');
  if (!found) return null;
  const rule = RULES.home['聚灵'];
  return { value: round2(Math.min(tierIndex(found.tier) + 1, rule.most) * rule.aura * found.power), label: rule.label };
}

const sealed = env => !!laidAt(env, '禁制');

function pace(env, found) {
  if (!['place', 'home'].includes(found?.scope?.kind)) return 1;
  const hidden = laidAt(env, '隐匿', found.scope.value);
  return hidden ? 1 - (1 - RULES.home['隐匿'].slower) * hidden.power : 1;
}

// ---------------------------------------------------------------- the fight's side

const burnOf = tier => RULES.burn[tier] ?? RULES.burn['一阶'];
const standing = array => array.charge > 0;
const effectsOf = name => (RULES.home[name]?.fight ? RULES.home[name].fight : [name]);

function fightArray(spec, side, from) {
  return { id: spec.id || `${side}:${spec.name}`, name: spec.name, label: labelOf(spec.name), effects: effectsOf(spec.name), tier: spec.tier,
    side, power: spec.power ?? 1, charge: spec.charge, burn: burnOf(spec.tier), from, ...(spec.laid ? { laid: spec.laid } : {}) };
}

function opening(env, fight, args, round) {
  const place = placeOf(env);
  const home = atHome(env, place);
  const foes = new Set(fight.foes.map(entry => entry.id));
  const book = bookOf(env);
  const taken = [];
  for (const field of book.field.filter(each => each.place === place && each.charge > 0)) {
    const fits = field.ground === 'home' ? home : field.ground === 'ambush' ? args?.ambush === 'player' : field.ground === 'lure' ? foes.has(field.person) : false;
    if (fits) taken.push(fightArray({ ...field, laid: field.id }, 'player', 'field'));
  }
  const guard = home ? laidAt(env, '护府', place) : null;
  if (guard?.charge > 0) taken.push(fightArray({ ...guard, laid: guard.id }, 'player', 'home'));
  for (const given of list(args?.arrays)) {
    const name = plain(given?.name);
    if (kindOf(name) !== 'fight') continue;
    const tier = goods.TIERS.includes(plain(given.tier)) ? plain(given.tier) : '一阶';
    const charge = Number.isSafeInteger(Number(given.charge)) && Number(given.charge) > 0 ? Number(given.charge) : burnOf(tier) * RULES.rounds;
    taken.push(fightArray({ name, tier, charge, id: `foes:${name}` }, 'foes', 'given'));
  }
  if (!taken.length) return;
  fight.arrays = taken;
  const first = taken.find(array => array.effects.includes('幻'));
  if (first) fight.first = first.side;
  round.notes = [...(round.notes || []), ...taken.map(array => `${array.side === 'player' ? '' : '对手的'}${array.tier}${array.label}起${array.power < 1 ? '（阵力减半）' : ''}`)];
  round.extra = { ...(round.extra || {}), arrays: shownArrays(fight) };
}

const up = (fight, side, effect) => list(fight.arrays).filter(array => array.side === side && standing(array) && array.effects.includes(effect));
const onPlayerSide = (round, id) => id === 'B1' || (round.beast && id === round.beast.id) || !round.fight.foes.some(entry => entry.id === id);
const sideOf = (round, id) => (onPlayerSide(round, id) ? 'player' : 'foes');
const other = side => (side === 'player' ? 'foes' : 'player');

function blow(env, round, attacker, defender) {
  const fight = round.fight;
  if (!list(fight.arrays).length) return {};
  const pace = {};
  for (const fighter of [attacker, defender]) {
    const held = up(fight, other(sideOf(round, fighter.id)), '困');
    if (held.length) pace[fighter.id] = Math.min(...held.map(array => 1 - (1 - RULES.fight['困'].agility) * array.power));
  }
  const dazed = up(fight, other(sideOf(round, attacker.id)), '幻');
  const bonus = dazed.length ? Math.min(...dazed.map(array => Math.trunc(RULES.fight['幻'].hit * array.power))) : 0;
  const shielded = up(fight, sideOf(round, defender.id), '护');
  const factor = shielded.length ? Math.min(...shielded.map(array => 1 - (1 - RULES.fight['护'].damage) * array.power)) : 1;
  return { ...(bonus ? { bonus } : {}), ...(factor !== 1 ? { factor } : {}), ...(Object.keys(pace).length ? { pace } : {}) };
}

function stay(env, round, id) {
  const [held] = up(round.fight, other(sideOf(round, id)), '困');
  if (!held) return null;
  return fill(id === 'B1' ? TEXTS.held : TEXTS.stay, { 阵: held.label });
}

// A foe tries to break the player's array: break.foes percent of the rounds while one holds it.
function intent(env, fight, entry, picked) {
  if (!list(fight.arrays).some(array => array.side === 'player' && standing(array))) return picked;
  const draw = env.random({ kind: 'fight', fight: fight.id, round: fight.round, command: `break:${entry.id}` }).random() * 100;
  return draw < RULES.break.foes ? { name: TEXTS.foeBreak, act: 'break' } : picked;
}

function weaken(round, array, said) {
  array.charge = Math.max(0, array.charge - RULES.break.rounds * array.burn);
  round.notes = [...(round.notes || []), fill(TEXTS.broke, { 阵: said, 数: chronicle.numeral(RULES.break.rounds) })];
  if (!standing(array)) gone(round, array);
}

function gone(round, array) {
  round.notes = [...(round.notes || []), fill(TEXTS.gone, { 阵: `${array.side === 'player' ? '' : '对手的'}${array.label}` })];
}

const strongest = (fight, side) => list(fight.arrays).filter(array => array.side === side && standing(array))
  .sort((a, b) => tierIndex(b.tier) - tierIndex(a.tier) || b.charge - a.charge)[0] || null;

function breakDc(array) {
  return rules.RULES.tiers[RULES.break.tiers[array.tier] || RULES.break.tiers['一阶']];
}

function foeBreaks(env, round, entry, foe) {
  const array = strongest(round.fight, 'player');
  if (!array) return;
  const sense = mechanics.statValue(foe.stats[actions.CHECKS['探查'].attribute]);
  const roll = Math.floor(env.random({ kind: 'fight', fight: round.fight.id, round: round.played, command: `break:${entry.id}`, nth: 2 }).random() * DIE) + 1;
  const outcome = rules.checkOutcome(roll, roll + rules.modifierFor(sense), breakDc(array));
  if (SUCCESS.includes(outcome)) weaken(round, array, `${entry.name}出手破阵，${array.label}`);
  else round.notes = [...(round.notes || []), `${entry.name}${fill(TEXTS.brokeFail, { 阵: array.label })}`];
}

// The player's 破阵: the better of the two checks, against the foes' strongest array.
function breakTerms(env, round) {
  const totals = gear.totals(env, 'B1', round.player.stats);
  return RULES.break.checks.map(kind => {
    const attribute = actions.CHECKS[kind].attribute;
    const bonus = perks.checkBonus(perks.owned(env), kind).value;
    return { kind, attribute, value: totals[attribute], modifier: rules.modifierFor(totals[attribute]) + bonus };
  }).sort((a, b) => b.modifier - a.modifier)[0];
}

const breakMove = {
  check: (env, round) => (strongest(round.fight, 'foes') ? null : TEXTS.noArray),
  run(env, round) {
    const array = strongest(round.fight, 'foes');
    const terms = breakTerms(env, round);
    const dc = breakDc(array);
    const roll = Math.floor(env.random({ kind: 'fight', fight: round.fight.id, round: round.played, command: 'break' }).random() * DIE) + 1;
    const total = roll + terms.modifier;
    const outcome = rules.checkOutcome(roll, total, dc);
    if (SUCCESS.includes(outcome)) weaken(round, array, `对手的${array.label}`);
    else round.notes = [...(round.notes || []), fill(TEXTS.brokeFail, { 阵: `对手的${array.label}` })];
    round.extra = { ...(round.extra || {}), broke: { array: array.id, outcome } };
    return { rolled: { kind: terms.kind, tier: RULES.break.tiers[array.tier], dc, die: DIE, roll, attribute: terms.attribute, value: terms.value,
      modifier: terms.modifier, total, outcome, consequence: SUCCESS.includes(outcome) ? `${array.label}少撑${RULES.break.rounds}回合` : '没破开',
      effects: [], target: { id: array.id, name: array.label }, reason: '', rulesVersion: rules.RULES.version, odds: oddsOf(terms.modifier, dc) } };
  },
};

// The round's end: 杀 strikes, then every array burns its stones.
function roundEnd(env, round, tools) {
  const fight = round.fight;
  if (!list(fight.arrays).length) return;
  for (const array of fight.arrays.filter(each => standing(each) && each.effects.includes('杀'))) {
    const target = array.side === 'player' ? round.foes.find(({ entry, foe }) => !entry.out && mechanics.statValue(foe.stats['血量']) > 0) : null;
    const defender = array.side === 'player' ? target?.foe : round.player;
    if (!defender || mechanics.statValue(defender.stats['血量']) <= 0) continue;
    const owner = array.side === 'player' ? round.player : round.foes[0]?.foe;
    if (!owner) continue;
    const realm = GEAR.tiers[array.tier];
    const [low, high] = mechanics.COMBAT.baselines[realm]['法攻'];
    const attack = Math.round(low + (high - low) * RULES.fight['杀'].strike.attack);
    // the array strikes under its own name (the receipt's lines name the striker by its id)
    const wielder = { ...owner, id: `${array.side === 'player' ? '' : '对手的'}${array.label}`, name: array.label, realm: mechanics.parseRealm(`${realm}初期`),
      stats: { ...owner.stats, 法攻: { current: attack, max: attack } } };
    const seeded = { ...env, seed: env.seedOf({ kind: 'fight', fight: fight.id, round: round.played, command: `array:${array.id}`, nth: 1 }) };
    const struck = mechanics.strike(seeded, wielder, defender, { style: '法术', totals: tools.asIs }, 0, 0);
    if (struck.hit) {
      const shield = up(fight, sideOf(round, defender.id), '护');
      const factor = array.power * (shield.length ? Math.min(...shield.map(each => 1 - (1 - RULES.fight['护'].damage) * each.power)) : 1);
      struck.damage = Math.max(1, Math.floor(struck.damage * factor));
      struck.hp.after = Math.max(0, struck.hp.before - struck.damage);
      struck.defeated = struck.hp.after === 0;
    }
    defender.stats = { ...defender.stats, 血量: { current: struck.hp.after, max: struck.hp.max } };
    tools.landed(env, round, struck, wielder, defender);
    if (struck.defeated && target) target.entry.out = 'fallen';
  }
  for (const array of fight.arrays.filter(standing)) {
    array.charge = Math.max(0, array.charge - array.burn);
    if (!standing(array)) gone(round, array);
  }
  round.extra = { ...(round.extra || {}), arrays: shownArrays(fight) };
}

// Once the fight ends: a field array goes with it (at home what is left stays); 护府 keeps its charge.
function ended(env, round) {
  const fight = round.fight;
  if (!list(fight.arrays).length) return;
  const book = bookOf(env);
  for (const array of fight.arrays.filter(each => each.side === 'player' && each.laid)) {
    if (array.from === 'home') book.laid = book.laid.map(each => (each.id === array.laid ? { ...each, charge: array.charge } : each));
    else {
      const field = book.field.find(each => each.id === array.laid);
      book.field = book.field.filter(each => each.id !== array.laid);
      if (field?.ground === 'home' && array.charge > 0) book.field.push({ ...field, charge: array.charge });
    }
  }
  env.play.arrays = book;
}

function shownArrays(fight) {
  return list(fight.arrays).map(array => ({ id: array.id, name: array.name, label: array.label, side: array.side, tier: array.tier,
    charge: array.charge, rounds: Math.ceil(array.charge / array.burn), power: array.power }));
}

function fightView(env, round) {
  const fight = round.fight;
  if (!list(fight.arrays).length) return {};
  const target = strongest(fight, 'foes');
  const terms = target ? breakTerms(env, round) : null;
  // its note as short as the other commands' (「成算五成」, under the glyph): the check is the better of 探查 and 施术
  return {
    ...(target ? { commands: [{ command: 'break', glyph: RULES.break.glyph, note: `成算${chronicle.numeral(Math.round(oddsOf(terms.modifier, breakDc(target)) / 10))}成` }] } : {}),
    arrays: shownArrays(fight),
  };
}

// ---------------------------------------------------------------- the teleport arrays

function crossing(env, station, destination) {
  const rule = RULES.teleport.stations[station];
  const link = list(rule?.links).find(each => each.to === destination);
  if (!link) return null;
  const taken = bookOf(env).stations[station];
  const repair = rule.repair && !repaired(env, station)
    ? taken && !lapsed(env, taken) ? 'taken' : 'available' : null;
  const conflict = env.play.world?.events?.['star-sea-dispute']?.stages;
  const duty = conflict?.happen && !conflict.aftermath ? (link.warFee || 0) : 0;
  return { stones: link.stones + duty, repair };
}

function cross(env, at, dest) {
  const here = at.facts.place;
  const station = here ? RULES.teleport.stations[here] : null;
  if (!station) return null;
  const link = crossing(env, here, dest.name);
  if (!link) return { refused: fill(TEXTS.noLink, { 到: dest.name }) + `，只通${list(station.links).map(each => each.to).join('、')}` };
  if (link.repair) return { refused: fill(TEXTS.broken, { 地: here, 事: station.repair.title }) };
  const purse = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
  if (purse < link.stones) return { refused: fill(TEXTS.purse, { 数: chronicle.numeral(link.stones), 有: chronicle.numeral(purse) }) };
  return { days: RULES.teleport.days, stones: link.stones, station: here };
}

// ---------------------------------------------------------------- the view and the wiring

function view(env) {
  const place = placeOf(env);
  const book = bookOf(env);
  const here = places.placeFacts(env).place;
  const station = here ? RULES.teleport.stations[here] : null;
  const shownOf = each => ({ id: each.id, name: each.name, label: labelOf(each.name), tier: each.tier, power: each.power,
    ...(each.charge !== undefined ? { charge: each.charge } : {}), ...(each.ground ? { ground: RULES.grounds[each.ground] } : {}) });
  return {
    laid: book.laid.filter(each => each.place === place).map(shownOf),
    field: book.field.filter(each => each.place === place).map(shownOf),
    ...(station ? { station: { links: list(station.links).map(({ to }) => ({ to, stones: crossing(env, here, to).stones })), ...(station.repair ? { broken: !repaired(env, here), repair: station.repair.title } : {}) } } : {}),
  };
}

let installed = false;
function install(verbs, { fight, interrupt, clocks, travel }) {
  if (installed) return;
  installed = true;
  verbs.VERBS.array = arrayPlan;
  verbs.hooks.auraBonus = auraBonus;
  // 布阵 waits for nothing an encounter holds while it is an ambush the player may lay.
  const before = verbs.hooks.hold;
  verbs.hooks.hold = (env, kind) => {
    const why = before(env, kind);
    if (!why || kind !== 'array' || !env.play?.encounter || !groundOf(env, {})) return why;
    return before({ ...env, play: { ...env.play, encounter: null } }, kind);
  };
  interrupt.hooks.sealed = sealed;
  clocks.hooks.pace = pace;
  travel.hooks.cross = cross;
  Object.assign(fight.hooks, { opening, blow, stay, intent, round: roundEnd, ended, view: fightView });
  fight.hooks.acts = { ...fight.hooks.acts, break: foeBreaks };
  fight.hooks.moves = { ...fight.hooks.moves, break: breakMove };
}

module.exports = { crossing, RULES, arrayPlan, auraBonus, sealed, pace, cross, view, install, laidAt };
