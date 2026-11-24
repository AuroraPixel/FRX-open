'use strict';
/* The people of the world living month by month (故人, 玩法设计第十一节; plan item 37). The numbers
 * and words are content/life/people.json. No model is asked anything here.
 *
 * frxPlay.people { next, by: { <id>: person }, gone? }: the engine's book of everyone in the
 * character table and the biographies but the player (and the foes of a fight), entered the first
 * time a month step sees them:
 *   person { name, gender, born, lifespan, major, step, progress, asOf, rate, root, place, aura, luck,
 *            sense, sect, bonded, cooldown, asking, gate, death, next, alive, died?, met, seen, times }
 *   met, seen, times  the day entered, the day last seen in the character table at a month step, and
 *            how many times seen (again after people.json book.apartDays away); a book from before
 *            them reads asOf for both and once
 *   kin      true when the relation column (13) names them the player's kin (a word of book.kin), as
 *            last read
 *   gone     (of the book) the IDs dropped at the cap, at most book.goneMost (the oldest go): their
 *            biographies are not entered again; back in the character table, they are entered anew.
 * The book holds at most people.json book.most (prune, after the people are entered): past it the
 *   dead go first (the earliest death first), then the strangers, the ones seen once before the
 *   ones seen more and the longest unseen first. Never anyone the play holds to (held): an open
 *   entry of the ledger or a knot with them, a tie, kin, a pending event of theirs, someone in the
 *   character table, seen within book.recentYears, or dead within karma.json knots.recentDays.
 *   born     the day of birth (days as readClock counts them), from the age written (people.json
 *            age when none); lifespan in years: the one written (a 寿元 below the age is the years
 *            left), else the realm's (cultivation.json lifespan) or a mortal's (mortalLifespan)
 *   root     the root written (rootOf); a mortal with none written is rootless (无), and never rises
 *   step, progress at asOf: the realm's step and the progress in it then; rate the progress a day,
 *            mechanics.dayRate of the realm (at the play's own pace: speed.stepDaysOf), the root,
 *            people.json technique, the world factor and the aura where the person is (column 16's
 *            place, places.factsOf)
 *   luck, sense  气运 and 神识 for the gate's odds (the panel's, else the realm's baseline)
 *   sect, bonded  protected at a gate (a word of people.json sect in the identity; isBonded)
 *   cooldown the day a failed gate may be tried again; asking the day a bonded companion who asked
 *            the player to stand guard will try (asked: the realm it asked at, once a gate); gate,
 *            death the days of the next gate and of the end of the lifespan; next the earlier one;
 *            died the date, once dead
 *   next     (of the book) the earliest `next` of anyone alive: a month before it does nothing.
 * month(env, month): the month step (month.cjs, before director.markDue). Everyone whose next
 *   falls before the month entered is brought up to it, event by event, with arithmetic: never a
 *   loop over every person and every month. At a gate the person tries with the player's odds
 *   table (cultivation.json breakthrough: 1d10 plus the 气运 band and 神识 against the realm
 *   (odds.cjs), against the gate's difficulty by the root as this play has it (gates.json harder);
 *   gates.json odds: protected +1, a 浓 place +1; no pills; checkOutcome),
 *   on a seed of the save, the person and the day; success is the next major realm (progress 20
 *   on a 大成功, else 0; the lifespan up to the realm's), failure progress 70 or 40 and the
 *   cooldown. A bonded companion first waits bonded.waitDays and puts a 「请你护法」 pending event
 *   with that day as its trigger. At the end of the lifespan the person dies.
 *   Worth writing (a major realm broken, a death, a feud): a chronicle line (personRise,
 *   personDeath, personFeud), a row of table 5 and an entry of frxPlay.news ([{ date, kind: rise |
 *   death | feud, id, name, text }], the latest news of them). A death also leaves a clue, a
 *   pending event (people.json death, or the tie's 诀别), and calls off the person's waiting events
 *   that needed them there (pending.json present: 来访, 求助 ...). In the advance's last month one receipt
 *   of kind "people" (source engine, hidden) settles it: the rows of table 5, and for the people on
 *   the scene what has moved of what their row states: the realm (column 2) once on another step,
 *   the age and a longer lifespan (remarks, where written as numbers); the dead leave the scene
 *   (status people.json dead, then de).
 * frxPlay.ties { <id>: { kind, since, seen, due: { <event>: day } } }: the player's ties, nine
 *   kinds (people.json ties.kinds), read from the relation column (13: B1:…) the first time, or set
 *   by the op "tie". Every `every` months each event of the tie's kind rolls its chance: a pending
 *   event { id, trigger: { kind, value }, seed, from: "people", person, event, since } (来访 求助 by
 *   date, 相邀 by place, 反目 by person, and 反目 turns the tie into 仇家, a feud). 诀别 comes at the
 *   death, 重逢 when the person is back on the scene after `apart` months away. At most
 *   people.json pending of these wait at once: the oldest goes.
 * The op "tie" { id, kind | null } → { tie }: sets or ends a tie (receipt "tie", hidden).
 * gateOdds(person) → { gate, dc, modifier, bonus }: a person's odds at the next gate (null at the
 *   top); dayRateOf(env, id) → a person's rate.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const speed = require('./speed.cjs');
const odds = require('./odds.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const PEOPLE = data('people');
const GATES = data('gates');
const CULTIVATION = mechanics.CULTIVATION;
const OUTCOMES = CULTIVATION.breakthrough.outcomes;
const ORDER = mechanics.COMBAT.realms.order;
const DAY = clock.DAY_MINUTES;
const MONTH_DAYS = clock.CALENDAR.daysPerMonth;
const YEAR_DAYS = MONTH_DAYS * clock.CALENDAR.monthsPerYear;
const KINDS = Object.keys(PEOPLE.ties.kinds);
const DEAD = /身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落/;
const J = JSON.stringify;

const rowName = row => plain(row?.['1']).split('|')[0];
const genderOf = row => plain(row?.['1']).split('|')[1]?.trim() || '';
const identityOf = row => plain(row?.['2']).split('|').slice(1).join('|');
const placeText = row => plain(row?.['16']).split('|')[2]?.trim() || '';
const isDead = row => DEAD.test(plain(row?.['4']));

// ---------------------------------------------------------------- the book

// The book as frxPlay keeps it; an empty one (not kept) while nobody is in it.
const book = env => (env.play.people && typeof env.play.people === 'object' && env.play.people.by ? env.play.people : { next: null, by: {} });

function statOf(env, row, realm, stat) {
  const panel = env.ctx.parseNestedJsonString(row?.['11'], {});
  const written = mechanics.statValue(panel?.[stat]);
  return written > 0 ? written : mechanics.statValue(mechanics.baselineStats(realm, `${env.archiveId || ''}:${row?.['0']}`)[stat]);
}

function rateOf(env, person) {
  return mechanics.dayRate({ major: person.major, root: mechanics.CULTIVATION.roots.factors[person.root] ?? 0, technique: PEOPLE.technique,
    world: mechanics.worldSpeed(env)?.factor ?? 1, aura: mechanics.placedAura(person.aura).factor, stepDays: speed.stepDaysOf(person.major) });
}

function enter(env, id, row, day) {
  const remarks = env.ctx.parseRemarksString(row['9']);
  const parsed = mechanics.parseRealm(row['2']);
  const realm = parsed.unknown ? { major: 0, minor: 0, name: ORDER[0] } : parsed;
  const age = mechanics.numberIn(remarks['年龄']) ?? PEOPLE.age;
  const written = mechanics.numberIn(remarks['寿元']);
  const floor = realm.major > 0 ? CULTIVATION.lifespan[ORDER[realm.major]] ?? null : PEOPLE.mortalLifespan;
  // A root not written counts as 真 for the player (cultivation.json roots.assumed); a mortal of
  // the story whose root nobody wrote is rootless: a pedlar does not become 筑基 in forty years
  // (the mock model's long run, plan item 50).
  const root = mechanics.rootOf(row, remarks);
  const lifespan = written === null ? floor ?? PEOPLE.mortalLifespan : written < age ? age + written : written;
  const place = placeText(row);
  const person = {
    name: rowName(row) || id, gender: genderOf(row), born: day - Math.round(age * YEAR_DAYS), lifespan, major: realm.major, step: mechanics.stepOf(realm),
    progress: mechanics.progressValue(remarks['修为进度']), asOf: day, rate: 0, root: realm.major === 0 && root.assumed ? '无' : root.tier,
    place, aura: places.factsOf(place, env.worldMap).aura, luck: statOf(env, row, realm, '气运'), sense: statOf(env, row, realm, '神识'),
    sect: PEOPLE.sect.some(word => identityOf(row).includes(word)), bonded: String(remarks.isBonded).trim() === 'true',
    cooldown: null, asking: null, asked: null, gate: null, death: null, next: null, alive: true,
    met: day, seen: day, times: 1, ...(isKin(row) ? { kin: true } : {}),
  };
  person.rate = rateOf(env, person);
  return plan(person);
}

// The person's next events: the gate (reached by arithmetic, after a cooldown, after asking for a
// guard), the end of the lifespan, and the earlier of the two.
function plan(person) {
  person.death = person.born + Math.round(person.lifespan * YEAR_DAYS);
  let gate = null;
  if (person.asking !== null) gate = person.asking;
  else if (person.major < ORDER.length - 1 && person.rate > 0) {
    const need = (mechanics.stepsIn(person.major) - person.step) * 100 + (100 - person.progress);
    gate = Math.max(person.asOf + Math.ceil(need / person.rate - 1e-9), person.cooldown ?? -Infinity);
  }
  person.gate = gate;
  person.next = gate === null ? person.death : Math.min(gate, person.death);
  return person;
}

// Where the person stands on `day`: the step and the progress, the gate's top at most.
function standing(person, day) {
  const top = mechanics.stepsIn(person.major);
  const total = Math.min(top * 100, (person.step - 1) * 100 + person.progress + Math.max(0, day - person.asOf) * person.rate);
  const step = Math.min(top, Math.floor(total / 100) + 1);
  return { step, progress: Math.min(100, Math.round(total - (step - 1) * 100)) };
}

// The foes an encounter brings (mechanics.cjs registers them 敌对): beasts and robbers met in a
// fight, no 故人 (the mock model's long run had every 山狼 it fought living out two hundred years).
const isFoe = row => identityOf(row).split('|').includes('敌对');

// Everyone in the table and the biographies not yet in the book (the player, the dead and the
// foes aside; a biography of someone the cap dropped neither), and who of the book is in the table
// now (seen, times); then the cap (prune).
function enterAll(env, day) {
  const people = book(env);
  const gone = new Set(list(people.gone));
  const rows = new Map();
  for (const [id, row] of Object.entries(env.state['0'] || {})) if (/^[CG]/.test(id) && row) rows.set(id, row);
  for (const [id, row] of Object.entries(env.biographies || {})) if (!rows.has(id) && row && !gone.has(id)) rows.set(id, row);
  let changed = false;
  for (const [id, row] of rows) {
    const person = people.by[id];
    if (person) {
      if (!env.state['0']?.[id]) continue;
      const last = seenOf(person);
      if (day - last >= BOOK.apartDays) person.times = (Number(person.times) || 1) + 1;
      if (day !== last || person.seen === undefined) { person.seen = day; changed = true; }
      if (isKin(row) !== Boolean(person.kin)) {
        if (isKin(row)) person.kin = true;
        else delete person.kin;
        changed = true;
      }
      continue;
    }
    if (isDead(row) || isFoe(row)) continue;
    people.by[id] = enter(env, id, row, day);
    gone.delete(id);
    changed = true;
  }
  seedTies(env, rows, day);
  if (!changed) return;
  if (people.gone) people.gone = list(people.gone).filter(id => gone.has(id));
  prune(env, people, day);
  people.next = earliest(people);
  env.play.people = people;
}

// ---------------------------------------------------------------- the cap

const BOOK = PEOPLE.book;
const seenOf = person => Number(person.seen ?? person.asOf ?? person.met) || 0;
// What the relation column (13) says of the player: B1:<words>.
const toPlayer = row => plain(row?.['13']).split(/[;；]/).map(part => part.split(/[:：]/)).find(([who]) => who?.trim() === 'B1')?.[1] || '';
const isKin = row => { const said = toPlayer(row); return !!said && BOOK.kin.some(word => said.includes(word)); };

// Who the play holds to (never dropped): an open entry of the ledger or a knot with them, a tie, kin,
// a pending event of theirs, someone in the character table, seen within recentYears, or dead within
// karma.json's knots.recentDays (a knot may still be noted with someone just dead).
function held(env, people, day) {
  const ids = new Set(Object.keys(env.state['0'] || {}));
  for (const entry of list(env.play.karma)) if (entry && !entry.done && !entry.broken && entry.who?.id) ids.add(entry.who.id);
  for (const knot of list(env.play.knots)) if (knot?.who?.id) ids.add(knot.who.id);
  for (const id of Object.keys(env.play.ties && typeof env.play.ties === 'object' ? env.play.ties : {})) ids.add(id);
  for (const hook of list(env.play.pending)) {
    if (hook?.person) ids.add(String(hook.person));
    if (hook?.trigger?.kind === 'person' && hook.trigger.value) ids.add(String(hook.trigger.value));
  }
  const recent = day - BOOK.recentYears * YEAR_DAYS;
  const justDead = day - (data('karma').knots?.recentDays ?? 0);
  for (const [id, person] of Object.entries(people.by)) {
    if (seenOf(person) >= recent || person.kin) ids.add(id);
    const died = clock.dayOfDate(person.died);
    if (!person.alive && died !== null && died >= justDead) ids.add(id);
  }
  return ids;
}

// The order the cap drops in: the dead (the earliest death first), then the living strangers, seen
// once before seen more, the longest unseen first.
function dropOrder(a, b) {
  const dead = person => (person.alive ? 1 : 0);
  return dead(a.person) - dead(b.person)
    || (a.person.alive ? 0 : String(a.person.died || '').localeCompare(String(b.person.died || '')))
    || (Number(a.person.times) || 1) - (Number(b.person.times) || 1)
    || seenOf(a.person) - seenOf(b.person)
    || a.id.localeCompare(b.id, 'en', { numeric: true });
}

function prune(env, people, day) {
  const over = Object.keys(people.by).length - BOOK.most;
  if (over <= 0) return;
  const keep = held(env, people, day);
  const dropped = Object.entries(people.by).filter(([id]) => !keep.has(id)).map(([id, person]) => ({ id, person }))
    .sort(dropOrder).slice(0, over).map(each => each.id);
  for (const id of dropped) delete people.by[id];
  people.gone = [...list(people.gone), ...dropped].slice(-BOOK.goneMost);
}

const earliest = people => Object.values(people.by).filter(person => person.alive).reduce((low, person) => (low === null || person.next < low ? person.next : low), null);

// ---------------------------------------------------------------- what is worth writing

function placeName(env, person) {
  const facts = person.place ? places.factsOf(person.place, env.worldMap) : null;
  return facts?.place || facts?.spot || '';
}

function worth(env, kind, id, person, day, template, values) {
  const line = chronicle.write(env, template, values, day * DAY);
  (env.peopleRows ||= []).push(`addWorldEvent(${J(mechanics.formatDay(day))},${J(placeName(env, person))},${J(line.text)})`);
  env.play.news = [...list(env.play.news), { date: clock.dateKey(day), kind, id, name: person.name, text: line.text }].slice(-PEOPLE.news);
}

// A pending event of the people step, the oldest going past the limit.
function hang(env, { trigger, seed, person, event }, day) {
  const mine = list(env.play.pending).filter(each => each.from === 'people');
  let pending = list(env.play.pending);
  if (mine.length >= PEOPLE.pending) pending = pending.filter(each => each !== mine[0]);
  env.play.pending = [...pending, { id: nextId(env, 'pending', 'P'), trigger, seed, from: 'people', person, event, since: clock.dateKey(day) }];
}

function triggerFor(env, kind, id, person, day, random) {
  if (kind === 'date') return { kind, value: clock.dateKey(Math.max(day, clock.today(env)) + 1 + Math.floor(random.random() * MONTH_DAYS)) };
  if (kind === 'place' && placeName(env, person)) return { kind, value: placeName(env, person) };
  return { kind: 'person', value: id };
}

// ---------------------------------------------------------------- gates and deaths

// A person's odds at the gate, as the player's are counted: the gate's difficulty by the root as this
// play has it (odds.dcOf), 气运 by the old bands and 神识 against the realm (odds.senseModifier), and
// the new terms a person can have (protected, a 浓 place); never a pill.
function gateOdds(person) {
  const found = mechanics.gateOf({ major: person.major, root: { tier: person.root } });
  if (!found) return null;
  const gate = { ...found, dc: odds.dcOf(found.target, found.dc) };
  const bonus = (person.sect || person.bonded ? GATES.odds.protector.bonus : 0) + (person.aura === GATES.odds.aura.tier ? GATES.odds.aura.bonus : 0);
  return { gate, dc: gate.dc, modifier: mechanics.modifierFor(person.luck) + odds.senseModifier(person.major, person.sense), bonus };
}

function attempt(env, id, person, day) {
  const { gate, modifier, bonus } = gateOdds(person);
  const random = create(`${env.archiveId || ''}:people:${id}:${day}`);
  const roll = Math.floor(random.random() * rules.RULES.die) + 1;
  const outcome = rules.checkOutcome(roll, roll + modifier + bonus, gate.dc);
  const after = day + gate.days;
  person.asking = null;
  if (outcome === '成功' || outcome === '大成功') {
    person.major = gate.target;
    person.step = 1;
    person.progress = OUTCOMES[outcome].progress;
    person.cooldown = null;
    person.lifespan = Math.max(person.lifespan, CULTIVATION.lifespan[ORDER[gate.target]] ?? person.lifespan);
    const grown = mechanics.baselineStats({ major: gate.target, minor: 1, name: ORDER[gate.target] }, `${env.archiveId || ''}:${id}`);
    person.sense = Math.max(person.sense, mechanics.statValue(grown['神识']));
    person.rate = rateOf(env, person);
    worth(env, 'rise', id, person, day, 'personRise', { 名: person.name, 境界: gate.to });
  } else {
    person.step = mechanics.stepsIn(person.major);
    person.progress = OUTCOMES[outcome].progress;
    person.cooldown = after + OUTCOMES[outcome].cooldownDays;
  }
  person.asOf = after;
}

function die(env, id, person, day) {
  person.alive = false;
  person.died = clock.dateKey(day);
  // a visit, a plea or an invitation of theirs that has not come yet never will
  const present = new Set(data('pending').present || []);
  env.play.pending = list(env.play.pending).filter(each => !(each?.from === 'people' && each.person === id && present.has(each.event)));
  worth(env, 'death', id, person, day, 'personDeath', { 名: person.name, 地: placeName(env, person) });
  const tie = env.play.ties?.[id];
  const farewell = PEOPLE.ties.events['诀别'];
  const rule = tie && farewell.kinds.includes(tie.kind) ? { ...farewell, event: '诀别' } : { ...PEOPLE.death, event: '死讯' };
  const random = create(`${env.archiveId || ''}:people:${id}:death`);
  hang(env, { trigger: triggerFor(env, rule.trigger, id, person, day, random), event: rule.event, person: id,
    seed: chronicle.fill(rule.seed, { 名: person.name, 地: placeName(env, person) || '那里' }) }, day);
}

// Brings one person up to `until` (a day), event by event.
function live(env, id, person, until) {
  for (let guard = 0; person.alive && person.next < until && guard < 64; guard += 1) {
    if (person.death <= (person.gate ?? Infinity)) {
      die(env, id, person, person.death);
      break;
    }
    const day = person.gate;
    if (person.bonded && person.asking === null && person.asked !== person.major) {
      // A bonded companion at the gate first asks the player to stand guard, and waits.
      person.step = mechanics.stepsIn(person.major);
      person.progress = 100;
      person.asOf = day;
      person.asking = day + PEOPLE.bonded.waitDays;
      person.asked = person.major;
      chronicle.write(env, 'personGate', { 名: person.name }, day * DAY);
      hang(env, { trigger: { kind: PEOPLE.gate.trigger, value: clock.dateKey(person.asking) }, event: '护法', person: id,
        seed: chronicle.fill(PEOPLE.gate.seed, { 名: person.name }) }, day);
    } else attempt(env, id, person, day);
    plan(person);
  }
}

// ---------------------------------------------------------------- ties

function seedTies(env, rows, day) {
  const ties = env.play.ties && typeof env.play.ties === 'object' ? env.play.ties : {};
  let changed = false;
  for (const [id, row] of rows) {
    if (ties[id]) continue;
    const said = plain(row['13']).split(/[;；]/).map(part => part.split(/[:：]/)).find(([who]) => who?.trim() === 'B1')?.[1] || '';
    const kind = said && KINDS.find(name => PEOPLE.ties.kinds[name].some(word => said.includes(word)));
    if (!kind) continue;
    ties[id] = tieOf(kind, day, true);
    changed = true;
  }
  if (changed || env.play.ties) env.play.ties = ties;
}

function tieOf(kind, day, seen) {
  const due = {};
  for (const [event, rule] of Object.entries(PEOPLE.ties.events)) if (rule.every && rule.kinds.includes(kind)) due[event] = day + rule.every * MONTH_DAYS;
  return { kind, since: clock.dateKey(day), seen: seen ? day : null, due };
}

function tieMonth(env, start) {
  const ties = env.play.ties;
  if (!ties) return;
  for (const [id, tie] of Object.entries(ties)) {
    const person = env.play.people?.by?.[id];
    if (person && !person.alive) continue;
    for (const [event, day] of Object.entries(tie.due || {})) {
      if (day >= start) continue;
      const rule = PEOPLE.ties.events[event];
      tie.due[event] = day + rule.every * MONTH_DAYS;
      if (!rule.kinds.includes(tie.kind)) continue;
      const random = create(`${env.archiveId || ''}:tie:${id}:${event}:${day}`);
      if (random.random() * 100 >= rule.chance) continue;
      const who = person || { name: rowName(env.state['0']?.[id] || env.biographies?.[id]) || id, place: placeText(env.state['0']?.[id] || env.biographies?.[id]) };
      hang(env, { trigger: triggerFor(env, rule.trigger, id, who, day, random), event, person: id,
        seed: chronicle.fill(rule.seed, { 名: who.name, 地: placeName(env, who) || '那里' }) }, day);
      if (rule.becomes) {
        tie.kind = rule.becomes;
        tie.due = tieOf(rule.becomes, day, false).due;
        worth(env, 'feud', id, who, day, 'personFeud', { 名: who.name });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- the month step and the sync

async function month(env, entered) {
  const start = Math.floor(entered.minutes / DAY);
  if (!env.peopleEntered) {
    env.peopleEntered = true;
    enterAll(env, Math.floor((env.advancing?.from ?? entered.minutes) / DAY));
  }
  const people = book(env);
  if (people.next !== null && people.next < start) {
    for (const [id, person] of Object.entries(people.by)) if (person.alive && person.next < start) live(env, id, person, start);
    people.next = earliest(people);
  }
  tieMonth(env, start);
  // The rows on the scene as the stretch leaves them: the clock already stands at its end.
  if (entered.last) await sync(env, clock.today(env) ?? start);
}

async function sync(env, day) {
  const commands = [...(env.peopleRows || [])];
  env.peopleRows = [];
  const people = book(env);
  const ties = env.play.ties || {};
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    const person = people.by[id];
    if (!person || !row) continue;
    if (!person.alive) {
      commands.push(`add(${J(id)},${J({ 4: PEOPLE.dead })})`, `de(${J(id)})`);
      continue;
    }
    // Only what the row states and what has moved: the realm when the person is on another step, the
    // age and the lifespan when the row writes them as numbers.
    const { step } = standing(person, day);
    const shown = mechanics.parseRealm(row['2']);
    if (shown.major !== person.major || (!shown.unknown && mechanics.stepOf(shown) !== step)) {
      commands.push(`add(${J(id)},${J({ 2: mechanics.withRealm(row, mechanics.stepName(person.major, step)) })})`);
    }
    const remarks = env.ctx.parseRemarksString(row['9']);
    const written = {};
    const age = Math.floor((day - person.born) / YEAR_DAYS);
    const writtenAge = mechanics.numberIn(remarks['年龄']), writtenLife = mechanics.numberIn(remarks['寿元']);
    if (writtenAge !== null && writtenAge !== age) written['年龄'] = String(age);
    if (writtenLife !== null && writtenLife < person.lifespan && person.lifespan >= age) written['寿元'] = String(person.lifespan);
    if (Object.keys(written).length) commands.push(`add(${J(id)},${J({ 9: written })})`);
    // Back on the scene after a long time away: a reunion.
    const tie = ties[id];
    if (tie) {
      const rule = PEOPLE.ties.events['重逢'];
      if (rule.kinds.includes(tie.kind) && tie.seen !== null && day - tie.seen >= rule.apart * MONTH_DAYS) {
        hang(env, { trigger: { kind: 'person', value: id }, event: '重逢', person: id, seed: chronicle.fill(rule.seed, { 名: person.name }) }, day);
      }
      tie.seen = day;
    }
  }
  if (!commands.length) return;
  await env.settle({ kind: 'people', ok: true, hidden: true, source: 'engine', commands: commands.join('\n'), owns: ownsNothing(),
    summary: `人物各过各的日子：${commands.length}处变动` });
}

// ---------------------------------------------------------------- the op and the tests' door

async function tieOp(env, args) {
  const id = plain(args.id);
  const row = env.state['0']?.[id] || env.biographies?.[id];
  if (!/^[CG]/.test(id) || !row) return env.refuse('没有这个人');
  const kind = plain(args.kind);
  const ties = env.play.ties && typeof env.play.ties === 'object' ? env.play.ties : {};
  if (!kind) delete ties[id];
  else if (!KINDS.includes(kind)) return env.refuse(`关系只有：${KINDS.join('、')}`);
  else ties[id] = tieOf(kind, clock.today(env), Boolean(env.state['0']?.[id]));
  env.play.ties = ties;
  await env.settle({ kind: 'tie', ok: true, hidden: true, source: 'engine', commands: '', owns: ownsNothing(),
    summary: kind ? `与${rowName(row)}的关系：${kind}` : `与${rowName(row)}不再有什么关系` });
  return { tie: ties[id] || null };
}

const dayRateOf = (env, id) => env.play.people?.by?.[id]?.rate ?? null;

module.exports = { PEOPLE, month, tie: tieOp, tieOf, dayRateOf, standing, gateOdds };
