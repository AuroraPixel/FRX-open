'use strict';
/* The home (洞府, 玩法设计第八节「洞府」; plan item 45): a place of the player's own. The numbers and
 * words are content/life/home.json. No model is called here. The store is the card's own (仓库);
 * the arrays laid at the home are arrays.cjs' (frxPlay.arrays, by place).
 *
 * frxPlay.home, null without one:
 *   { place, name, aura, rooms: [丹房 | 器室], garden: [bed], how: buy | rent | claim | take, since,
 *     rent?: { yearly, due, entry }, from?: { id, name } }
 *   place    the map place it is at (the player is at home there); aura that place's when it was
 *            had; rent the yearly sum, the day the next is due and its calendar entry (own rent);
 *            from whom it was taken
 *   bed      { id, herb, tier, count, planted, due, entry }: count of the herb planted, ripe on due
 * frxPlay.homeStake { fight, place, aura, from } while a take's fight is on; frxPlay.homeAttack
 *   { fight, clock, person } while an 打上门 fight is: what the fight's end does with the home.
 * The verb home (verbs.VERBS) { action, … }:
 *   buy, rent  at a place of the way's kinds: the price by the home's aura (the place's, raised by
 *              richer for its kind: a 坊市's 洞府 has a vein, homeAura); rent: the first year's, and
 *              the next one on the calendar a year on; no time passes
 *   claim      at a place of the way's kinds the world line has not given an owner (saga.ownerOf):
 *              days pass, one check on the timeline seed ({ kind: check, type: 洞府·占, target: the
 *              place }: d10 + the band of check.attribute against check.tier); a failure claims
 *              nothing (homeClaimFail)
 *   take { person }  someone on the scene: a fight with them opens (fight.open); won, the home there
 *              is the player's, a tie of ways.take.tie with them (people.tieOf), and a clock aimed
 *              at it (clock: its days rise, falling when they are settled) — they will come back
 *   build { room }  at home: a room of rooms for its stones and days
 *   plant { item, count? }  at home: an herb (a catalogue good of garden.class) from the bag into a
 *              bed (garden.plots at most); ripe garden.years[its tier] years later, on the calendar
 *   harvest    at home: every ripe bed gives yield × count of its herb (rewards.grant); refused,
 *              with the first day, while none is
 *   leave      the home given up (its calendar entries go)
 *   A new home gives up the old one. Receipt kind "home", action the verb's, home { … }.
 * month(env, month): the month step: a rent due in the month that ended is paid from the purse
 *   (receipt home action rent, homeRent dated the day, the next due a year on), or, short of it,
 *   the home is lost (receipt action lost, homeLost).
 * At home (the player at the home's place): cultivating counts the home's aura (verbs.hooks.aura,
 *   chained); crafting takes its rooms (crafts.cjs); refining is as anywhere.
 * 打上门: a clock aimed at the home (scope home) filling while the player is at home breaks the
 *   stretch off (interrupt.cjs); when it names whom it waits on (a settle fall's person) and they are
 *   known, a fight with them opens at once (verbs.hooks.broken, chained), with the arrays they bring
 *   (attack.arrays, the foes'), and its pending event goes; won, the clock goes (homeRepel). Else
 *   the pending event stays: the scene.
 * A fight at home (fight.hooks): the 守府 helpers (beasts.helpers: the out beast whose use is 守府)
 *   each strike the first foe standing once a round (attack.helper), as the beast strikes.
 * view(env) → null | { place, name, aura, rooms, garden, how, rent?, here }.
 * install(verbs, { fight, beasts }) puts it all in place, once.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const calendar = require('./calendar.cjs');
const clocks = require('./clocks.cjs');
const places = require('./places.cjs');
const goods = require('./goods.cjs');
const gear = require('./gear.cjs');
const rewards = require('./rewards.cjs');
const people = require('./people.cjs');
const saga = require('./saga.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('home');
const TEXTS = RULES.texts;
const DAY = clock.DAY_MINUTES;
const DIE = rules.RULES.die;
const MONTH_DAYS = clock.CALENDAR.daysPerMonth;
const YEAR_DAYS = MONTH_DAYS * clock.CALENDAR.monthsPerYear;
const SUCCESS = ['大成功', '成功'];
const VERB = '洞府';
const J = JSON.stringify;

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const fill = (template, values) => chronicle.fill(template, values);
const rowName = row => plain(row?.['1']).split('|')[0];
const homeOf = env => (isObject(env.play?.home) && env.play.home.place ? env.play.home : null);
const hereOf = env => places.placeFacts(env);
const atHome = env => { const home = homeOf(env); return !!home && hereOf(env).place === home.place; };
const purseOf = env => mechanics.stonesOf(env.state['0']?.B1) ?? 0;
const shown = (env, minutes, lines) => ({ ok: true, minutes, ends: clock.dateOf(mechanics.readClock(env.state).minutes + minutes), lines, formula: [] });
const paid = (purse, stones) => (stones ? [`add("B1",{"26":"${purse - stones}"})`] : []);

// A home given up: its own calendar entries go with it.
function giveUp(env) {
  const old = homeOf(env);
  if (!old) return;
  for (const id of [old.rent?.entry, ...list(old.garden).map(bed => bed.entry)].filter(Boolean)) calendar.remove(env, id);
  env.play.home = null;
}

function ownNew(env, { place, aura, how, from = null, rent = null }) {
  giveUp(env);
  const name = fill(RULES.names[how], { 地: place, 人: from?.name || '' });
  env.play.home = { place, name, aura, rooms: [], garden: [], how, since: clock.dateKey(clock.today(env)), ...(rent ? { rent } : {}), ...(from ? { from } : {}) };
  return env.play.home;
}

// ---------------------------------------------------------------- the four ways

// The aura of a home bought or rented at a place of these facts: the place's, raised by the file's
// richer for its kind (a 坊市's 洞府 has a vein: one grade above the 坊市), at most the top grade.
const GRADES = Object.keys(mechanics.CULTIVATION.environment.aura);
function homeAura(facts) {
  const at = GRADES.indexOf(facts.aura);
  if (at < 0) return facts.aura;
  return GRADES[Math.min(GRADES.length - 1, at + (Number(RULES.richer?.[facts.kind]) || 0))];
}

function acquire(env, action) {
  const way = RULES.ways[action];
  const facts = hereOf(env);
  if (!facts.place || !way.kinds.includes(facts.kind)) return { refused: fill(TEXTS.where, { 法: way.label }) };
  if (homeOf(env)?.place === facts.place) return { refused: TEXTS.same };
  const aura = homeAura(facts);
  const cost = (action === 'buy' ? way.price : way.yearly)[aura] ?? 0;
  const purse = purseOf(env);
  if (purse < cost) return { refused: fill(TEXTS.purse, { 法: way.label, 数: chronicle.numeral(cost), 有: chronicle.numeral(purse) }) };
  const owns = { ...ownsNothing(), currency: cost > 0 };
  const said = action === 'buy' ? `付灵石${chronicle.numeral(cost)}块` : `头一年租金${chronicle.numeral(cost)}块灵石`;
  return {
    minutes: 0, preview: shown(env, 0, [`${way.label}下${facts.place}的洞府，${said}；灵气${aura}。`,
      ...(action === 'rent' ? ['往后每年这一天交一回，交不起就被收回。'] : [])]),
    receipt: { kind: 'home', ok: true, source: 'verb', action, home: { place: facts.place, aura, stones: cost, purse: { before: purse, after: purse - cost } },
      commands: paid(purse, cost).join('\n'), owns, summary: '' },
    line: ['homeGet', { 法: way.label, 地: facts.place, 费: said }],
    finish: settled => {
      let rent = null;
      if (action === 'rent') {
        const due = clock.dateKey(clock.today(env) + YEAR_DAYS);
        const entry = calendar.register(env, 'rent', { date: due, title: `交${facts.place}洞府的租金`, place: facts.place });
        rent = { yearly: cost, due, entry: entry.id };
      }
      ownNew(env, { place: facts.place, aura, how: action, rent });
      settled.summary = `${way.label}下${facts.place}的洞府：灵石 ${purse}→${purse - cost}`;
    },
  };
}

function claim(env, upTo) {
  const way = RULES.ways.claim;
  const facts = hereOf(env);
  if (!facts.place || !way.kinds.includes(facts.kind)) return { refused: fill(TEXTS.where, { 法: way.label }) };
  const owner = saga.ownerOf(env, facts.place);
  if (owner) return { refused: fill(TEXTS.owned, { 地: facts.place, 主: owner }) };
  if (homeOf(env)?.place === facts.place) return { refused: TEXTS.same };
  const full = way.days * DAY;
  const overrun = clock.overrun(env, full);
  if (overrun) return { refused: `寻地方${chronicle.spanText(full)}${overrun}` };
  const minutes = upTo === null ? full : Math.max(0, Math.min(full, upTo));
  const value = gear.totals(env, 'B1', mechanics.readStats(env, 'B1'))[way.check.attribute];
  const modifier = rules.modifierFor(value), dc = rules.RULES.tiers[way.check.tier];
  const lines = [`在${facts.place}寻一处无主的地方开洞府，花${chronicle.spanText(full)}。`,
    `${way.check.attribute}检定，骰加${modifier}，对难度${dc}；危险照${facts.place}的。`];
  // Broken off, nothing is claimed.
  if (minutes < full) {
    return { minutes, preview: shown(env, minutes, lines),
      receipt: { kind: 'home', ok: true, source: 'verb', action: 'claim', home: { place: facts.place, claimed: false }, commands: '', owns: ownsNothing(), summary: '' },
      line: ['homeClaimFail', { 地: facts.place, 时长: chronicle.spanText(minutes) }],
      finish: settled => { settled.summary = `在${facts.place}寻地方，没寻完就被打断`; } };
  }
  const roll = Math.floor(env.random({ kind: 'check', type: '洞府·占', target: facts.place }).random() * DIE) + 1;
  const outcome = rules.checkOutcome(roll, roll + modifier, dc);
  const won = SUCCESS.includes(outcome);
  const check = { roll, modifier, total: roll + modifier, dc, outcome };
  return {
    minutes, preview: shown(env, minutes, lines),
    receipt: { kind: 'home', ok: true, source: 'verb', action: 'claim', home: { place: facts.place, aura: facts.aura, claimed: won }, check,
      commands: '', owns: ownsNothing(), summary: '' },
    line: won ? ['homeGet', { 法: way.label, 地: facts.place, 费: '' }] : ['homeClaimFail', { 地: facts.place, 时长: chronicle.spanText(minutes) }],
    finish: settled => {
      if (won) ownNew(env, { place: facts.place, aura: facts.aura, how: 'claim' });
      settled.summary = won ? `占下${facts.place}的洞府（${outcome}）` : fill(TEXTS.claimFail, { 地: facts.place, 日: chronicle.numeral(way.days) });
    },
  };
}

function take(env, verb) {
  const facts = hereOf(env);
  const from = plain(verb.person);
  const row = from ? env.state['0']?.[from] : null;
  if (!facts.place || !row || !/^[CG]/.test(from) || mechanics.isFallen(env.ctx, row)) return { refused: TEXTS.noOwner };
  if (homeOf(env)?.place === facts.place) return { refused: TEXTS.same };
  const name = rowName(row);
  return {
    minutes: 0, preview: shown(env, 0, [`和${name}斗一场，赢了${facts.place}的洞府归你，也和${name}结下仇。`]),
    receipt: { kind: 'home', ok: true, source: 'verb', action: 'take', home: { place: facts.place, from: { id: from, name } }, commands: '', owns: ownsNothing(), summary: '' },
    line: ['homeFight', { 地点: chronicle.placeName(env.state), 人: name }],
    finish: async settled => {
      const opened = await require('./fight.cjs').open(env, { foes: [from] });
      if (opened.refused) {
        settled.summary = `要从${name}手里抢洞府，没打起来：${opened.refused}`;
        return;
      }
      env.play.homeStake = { fight: opened.fight.id, place: facts.place, aura: facts.aura, from: { id: from, name } };
      settled.summary = `要从${name}手里抢${facts.place}的洞府，斗法开始`;
    },
  };
}

// ---------------------------------------------------------------- the rooms and the garden

function build(env, verb, upTo) {
  if (!atHome(env)) return { refused: homeOf(env) ? TEXTS.notHome : TEXTS.none };
  const room = plain(verb.room);
  const rule = Object.hasOwn(RULES.rooms, room) ? RULES.rooms[room] : null;
  if (!rule) return { refused: fill(TEXTS.noRoom, { 房: Object.keys(RULES.rooms).join('、') }) };
  const home = homeOf(env);
  if (list(home.rooms).includes(room)) return { refused: fill(TEXTS.room, { 房: room }) };
  const purse = purseOf(env);
  if (purse < rule.stones) return { refused: fill(TEXTS.purse, { 法: `修一间${room}`, 数: chronicle.numeral(rule.stones), 有: chronicle.numeral(purse) }) };
  const full = rule.days * DAY;
  const overrun = clock.overrun(env, full);
  if (overrun) return { refused: `修${room}${chronicle.spanText(full)}${overrun}` };
  const done = upTo === null || upTo >= full;
  const minutes = done ? full : Math.max(0, upTo);
  return {
    minutes, preview: shown(env, minutes, [`在洞府里修一间${room}：灵石${chronicle.numeral(rule.stones)}块，${chronicle.spanText(full)}。`]),
    receipt: { kind: 'home', ok: true, source: 'verb', action: 'build', home: { room, built: done, stones: done ? rule.stones : 0,
      ...(done ? { purse: { before: purse, after: purse - rule.stones } } : {}) },
      commands: done ? paid(purse, rule.stones).join('\n') : '', owns: { ...ownsNothing(), currency: done }, summary: '' },
    line: done ? ['homeBuild', { 房: room }] : ['wait', { 地点: chronicle.placeName(env.state), 时长: chronicle.spanText(minutes) }],
    finish: settled => {
      if (done) env.play.home = { ...homeOf(env), rooms: [...list(homeOf(env).rooms), room] };
      settled.summary = done ? `洞府里修起一间${room}：灵石 ${purse}→${purse - rule.stones}` : `修${room}修到一半被打断`;
    },
  };
}

// An herb in the bag by its id or name: { id, good, count }.
function herbOf(env, value) {
  const text = plain(value);
  const stored = env.ctx.storedItemIds(env.state);
  const found = Object.entries(env.state['1'] || {}).find(([id, row]) => row && !stored.has(id) && (id === text || goods.lookup(row['1'])?.name === text));
  if (!found) return null;
  const [id, row] = found;
  return { id, row, good: goods.lookup(row['1']), count: Number(env.ctx.itemStackCount(row['5'])) || 0 };
}

function plant(env, verb) {
  if (!atHome(env)) return { refused: homeOf(env) ? TEXTS.notHome : TEXTS.none };
  const home = homeOf(env);
  if (list(home.garden).length >= RULES.garden.plots) return { refused: fill(TEXTS.plots, { 数: chronicle.numeral(RULES.garden.plots) }) };
  const herb = herbOf(env, verb.item);
  if (!herb) return { refused: fill(TEXTS.noHerb, { 物: plain(verb.item).slice(0, 20) || '灵草' }) };
  if (herb.good?.class !== RULES.garden.class) return { refused: fill(TEXTS.notHerb, { 物: rowName(herb.row) }) };
  const count = verb.count === undefined || verb.count === null || verb.count === '' ? 1 : (/^\d{1,4}$/.test(String(verb.count).trim()) ? Number(verb.count) : 0);
  if (count < 1 || count > herb.count) return { refused: `袋里的${herb.good.name}只有${chronicle.numeral(herb.count)}${goods.unitOf(herb.good)}` };
  const years = RULES.garden.years[herb.good.tier] ?? RULES.garden.years['一阶'];
  const due = clock.today(env) + years * YEAR_DAYS;
  const ripe = clock.dateOf(due * DAY).text;
  const left = herb.count - count;
  const said = `${herb.good.name}${chronicle.count(count)}${goods.unitOf(herb.good)}`;
  return {
    minutes: 0, preview: shown(env, 0, [`药园里种下${said}，${chronicle.numeral(years)}年后（${ripe}）熟，每${goods.unitOf(herb.good)}收${chronicle.numeral(RULES.garden.yield)}${goods.unitOf(herb.good)}。`]),
    receipt: { kind: 'home', ok: true, source: 'verb', action: 'plant', home: { herb: herb.good.name, count, due: clock.dateKey(due) },
      commands: left > 0 ? `add(${J(herb.id)},{"5":"${left}"})` : `de(${J(herb.id)})`, owns: { ...ownsNothing(), items: [herb.id] }, summary: '' },
    line: ['homePlant', { 物: said, 日: ripe }],
    finish: settled => {
      const entry = calendar.register(env, 'garden', { date: clock.dateKey(due), title: `收${herb.good.name}`, place: home.place });
      const bed = { id: nextId(env, 'bed', 'G'), herb: herb.good.name, tier: herb.good.tier, count, planted: clock.dateKey(clock.today(env)), due: clock.dateKey(due), entry: entry.id };
      env.play.home = { ...homeOf(env), garden: [...list(homeOf(env).garden), bed] };
      settled.summary = `药园里种下${said}，${ripe}熟`;
    },
  };
}

function harvest(env) {
  if (!atHome(env)) return { refused: homeOf(env) ? TEXTS.notHome : TEXTS.none };
  const beds = list(homeOf(env).garden);
  if (!beds.length) return { refused: TEXTS.empty };
  const today = clock.today(env);
  const ripe = beds.filter(bed => (clock.dayOfDate(bed.due) ?? Infinity) <= today);
  if (!ripe.length) {
    const first = Math.min(...beds.map(bed => clock.dayOfDate(bed.due) ?? Infinity));
    return { refused: fill(TEXTS.unripe, { 日: clock.dateOf(first * DAY).text }) };
  }
  const items = ripe.map(bed => {
    const good = goods.lookup(bed.herb);
    return { id: good.id, name: good.name, class: good.class, tier: good.tier, count: bed.count * RULES.garden.yield, unit: goods.unitOf(good), price: good.price, quality: '常' };
  });
  const granted = rewards.grant(env, items);
  const said = goods.listed(items);
  return {
    minutes: 0, preview: shown(env, 0, [`药园里熟了的收下来：${said}。`]),
    receipt: { kind: 'home', ok: true, source: 'verb', action: 'harvest', home: { beds: ripe.map(bed => bed.id), items }, commands: granted.commands.join('\n'), owns: granted.owns, summary: '' },
    line: ['homeHarvest', { 物: said }],
    finish: settled => {
      for (const bed of ripe) calendar.remove(env, bed.entry);
      const gone = new Set(ripe.map(bed => bed.id));
      env.play.home = { ...homeOf(env), garden: list(homeOf(env).garden).filter(bed => !gone.has(bed.id)) };
      settled.summary = `药园收了${said}`;
    },
  };
}

function leave(env) {
  const home = homeOf(env);
  if (!home) return { refused: TEXTS.none };
  return {
    minutes: 0, preview: shown(env, 0, [`弃了${home.place}的洞府${home.rent ? '，不再交租' : ''}。`]),
    receipt: { kind: 'home', ok: true, source: 'verb', action: 'leave', home: { place: home.place }, commands: '', owns: ownsNothing(), summary: '' },
    line: ['homeLeave', { 地: home.place }],
    finish: settled => {
      giveUp(env);
      settled.summary = `弃了${home.place}的洞府`;
    },
  };
}

const ACTIONS = { buy: env => acquire(env, 'buy'), rent: env => acquire(env, 'rent'), claim: (env, verb, upTo) => claim(env, upTo), take,
  build, plant, harvest, leave };

function homePlan(env, verb, upTo = null) {
  const blocked = rewards.blockedFor(env, VERB);
  if (blocked) return { refused: blocked };
  const action = plain(verb.action);
  if (!Object.hasOwn(ACTIONS, action)) return { refused: `洞府要写做哪一样（action）：${Object.keys(ACTIONS).join('、')}` };
  return ACTIONS[action](env, verb, upTo);
}

// ---------------------------------------------------------------- the rent, month by month

async function month(env, entered) {
  const to = Math.floor(entered.minutes / DAY);
  for (let home = homeOf(env); home?.rent && (clock.dayOfDate(home.rent.due) ?? Infinity) < to; home = homeOf(env)) {
    const day = clock.dayOfDate(home.rent.due);
    const purse = purseOf(env);
    calendar.remove(env, home.rent.entry);
    if (purse < home.rent.yearly) {
      chronicle.write(env, 'homeLost', { 地: home.place }, day * DAY);
      giveUp(env);
      await env.settle({ kind: 'home', ok: true, source: 'engine', action: 'lost', home: { place: home.place, yearly: home.rent.yearly, purse },
        commands: '', owns: ownsNothing(), summary: fill(TEXTS.lost, { 地: home.place }) });
      return;
    }
    const due = clock.dateKey(day + YEAR_DAYS);
    const entry = calendar.register(env, 'rent', { date: due, title: `交${home.place}洞府的租金`, place: home.place });
    env.play.home = { ...home, rent: { ...home.rent, due, entry: entry.id } };
    chronicle.write(env, 'homeRent', { 地: home.place, 数: chronicle.numeral(home.rent.yearly) }, day * DAY);
    await env.settle({ kind: 'home', ok: true, source: 'engine', action: 'rent', home: { place: home.place, yearly: home.rent.yearly, paid: clock.dateKey(day), due,
      purse: { before: purse, after: purse - home.rent.yearly } },
      commands: paid(purse, home.rent.yearly).join('\n'), owns: { ...ownsNothing(), currency: true },
      summary: `${fill(TEXTS.rentPaid, { 地: home.place, 数: home.rent.yearly })}：灵石 ${purse}→${purse - home.rent.yearly}` });
  }
}

// ---------------------------------------------------------------- 打上门 and the fight at home

// The clock aimed at the home that filled where the player is: a fight with whom it waits on.
async function attacked(env, stop, receipt) {
  if (stop?.origin !== 'clock' || !atHome(env)) return null;
  const found = list(env.play.clocks).find(each => each.id === stop.clock?.id);
  if (!found || found.scope.kind !== 'home' || found.value < found.size) return null;
  const person = list(found.falls).find(rule => rule.kind === 'settle')?.person;
  if (!person || !(env.state['0']?.[person] || env.biographies?.[person])) return null;
  // whoever comes brings the arrays the file gives them (attack.arrays: the foes')
  const opened = await require('./fight.cjs').open(env, { foes: [person], arrays: list(RULES.attack.arrays) });
  if (opened.refused) return null;
  env.play.pending = list(env.play.pending).filter(each => !(each.from === 'clock' && each.trigger?.value === found.id));
  env.play.homeAttack = { fight: opened.fight.id, clock: found.id, person };
  if (receipt?.interruption) receipt.interruption.attack = { fight: opened.fight.id, person };
  return opened;
}

function opening(env, fight) {
  if (!atHome(env)) return;
  const helpers = beastsOf().helpers(env);
  if (helpers.length) fight.helpers = helpers.map(each => ({ id: each.id, name: each.name }));
}

function helping(env, round, tools) {
  const fight = round.fight;
  list(fight.helpers).forEach((helper, n) => {
    const target = round.foes.find(({ entry, foe }) => !entry.out && mechanics.statValue(foe.stats['血量']) > 0);
    const beast = target ? beastsOf().fighterOf(env, helper.id) : null;
    if (!beast || mechanics.statValue(beast.stats['血量']) <= 0) return;
    const struck = tools.blow(env, round, { command: `helper:${helper.id}`, nth: n + 1 }, beast, target.foe, { style: '物理' });
    tools.landed(env, round, struck, beast, target.foe);
    if (struck.defeated) target.entry.out = 'fallen';
    round.notes = [...(round.notes || []), `「${helper.name}」${RULES.attack.helper.label}助战`];
  });
}

function ended(env, round, how) {
  const fight = round.fight;
  const stake = env.play.homeStake;
  if (stake && stake.fight === fight.id) {
    env.play.homeStake = null;
    if (how === 'win') {
      ownNew(env, { place: stake.place, aura: stake.aura, how: 'take', from: stake.from });
      const ties = isObject(env.play.ties) ? env.play.ties : {};
      ties[stake.from.id] = people.tieOf(RULES.ways.take.tie, clock.today(env), Boolean(env.state['0']?.[stake.from.id]));
      env.play.ties = ties;
      chronicle.write(env, 'homeTake', { 人: stake.from.name, 地: stake.place });
      const rule = RULES.clock;
      const started = clocks.start(env, { name: rule.name, scope: { kind: 'home', value: stake.place }, size: rule.size, value: 0, rises: rule.rises,
        falls: [{ kind: 'settle', person: stake.from.id }], full: fill(rule.full, { 人: stake.from.name }), from: 'engine' }, `${stake.from.name}记着仇`);
      round.extra = { ...(round.extra || {}), home: { taken: stake.place, from: stake.from, ...(started.clock ? { clock: started.clock.id } : {}) } };
    }
  }
  const attack = env.play.homeAttack;
  if (attack && attack.fight === fight.id) {
    env.play.homeAttack = null;
    if (how === 'win') {
      const found = list(env.play.clocks).find(each => each.id === attack.clock);
      const name = rowName(env.state['0']?.[attack.person] || env.biographies?.[attack.person]) || attack.person;
      if (found) clocks.bump(env, found.id, -found.value, `打退了${name}`);
      chronicle.write(env, 'homeRepel', { 人: name });
      round.extra = { ...(round.extra || {}), home: { repelled: attack.person } };
    }
  }
}

// ---------------------------------------------------------------- the view and the wiring

// The bag's herbs the garden takes (catalogue goods of garden.class, not in storage): the panel's 种什么.
function seedsOf(env) {
  const stored = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {}).flatMap(([id, row]) => {
    const good = row && !stored.has(id) ? goods.lookup(row['1']) : null;
    const count = good?.class === RULES.garden.class ? Number(env.ctx.itemStackCount(row['5'])) || 0 : 0;
    return count > 0 ? [{ id, name: good.name, count }] : [];
  });
}

function view(env) {
  const home = homeOf(env);
  if (!home) return null;
  return { place: home.place, name: home.name, aura: home.aura, rooms: list(home.rooms), how: home.how, since: home.since,
    garden: list(home.garden).map(bed => ({ id: bed.id, herb: bed.herb, count: bed.count, due: bed.due, ripe: (clock.dayOfDate(bed.due) ?? Infinity) <= (clock.today(env) ?? -1) })),
    plots: RULES.garden.plots, seeds: seedsOf(env), ...(home.rent ? { rent: { yearly: home.rent.yearly, due: home.rent.due } } : {}), here: atHome(env) };
}

let beastsModule = null;
const beastsOf = () => beastsModule || require('./beasts.cjs');

let installed = false;
function install(verbs, { fight, beasts }) {
  if (installed) return;
  installed = true;
  beastsModule = beasts;
  verbs.VERBS.home = homePlan;
  // At home, cultivating counts the home's aura (before the floors a talent may give it).
  const aura = verbs.hooks.aura;
  verbs.hooks.aura = (env, here) => aura(env, atHome(env) ? homeOf(env).aura : here);
  const broken = verbs.hooks.broken;
  verbs.hooks.broken = async (env, stop, receipt) => (await broken(env, stop, receipt)) ?? (await attacked(env, stop, receipt));
  const open = fight.hooks.opening, round = fight.hooks.round, end = fight.hooks.ended;
  fight.hooks.opening = (env, fought, args, at) => { open(env, fought, args, at); opening(env, fought); };
  fight.hooks.round = (env, at, tools) => { helping(env, at, tools); round(env, at, tools); };
  fight.hooks.ended = (env, at, how) => { end(env, at, how); ended(env, at, how); };
}

module.exports = { RULES, homePlan, month, view, install, atHome, homeOf, homeAura };
