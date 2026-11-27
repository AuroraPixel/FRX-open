'use strict';
/* 坐化与传承 (plan item 49): the lifespan's end and the heir who goes on in the same save. The
 * numbers and the words are content/life/legacy.json. No model is asked anything here: the server
 * asks for the eulogies after the dying turn and draws a new heir's root (play_legacy.py).
 *
 * Twilight: once the years left (寿元 less 年龄 of the player's remarks) are twilight.years or fewer,
 *   the player's status column carries twilight.status (大限将至), the calendar has the own entry
 *   lifespan on the day the lifespan runs out (the new year on which the age reaches it; it stops
 *   no stretch: a stretch runs on through it) and frxPlay.twilight is { since, ends }. A longer
 *   lifespan (a gate broken) takes all three off again. Each new year inside it the chronicle says
 *   how many years are left (month, a month step).
 * The end: every stretch stops on the lifespan's last day (clock.lifespanEnd; the verbs' own stop,
 *   verbs.cjs, which opens no scene; a gate's attempt that would run past it is refused, gate.cjs).
 *   After an op (after), when the age has reached the lifespan, the player dies of old age (坐化),
 *   dated today. Not while a fight or a scene is on, and not on a move: the move that ends
 *   a fight is followed by its battle report's scene in the same turn (play_turns), so the death
 *   comes with the op that closes that scene. A stretch broken off on the way opens no scene: the
 *   op's receipts lose their interruption, and the dying turn ends there.
 *   - Extreme mode (the remarks' isExtreme): the receipt writes 寿元 0, and the server's check after
 *     the turn (play_death, core/death.cjs) starts the save over, as it always has.
 *   - Else frxPlay.legacy { state: choosing, died, name, gender, realm, age, lifespan, place,
 *     mourners: [{ id, name, kind, identity }] } and the status column says `status` (坐化): the
 *     verbs are held (hold) and every op but those of `open` is refused (holds) until the heir is
 *     chosen. After the dying turn the server adds legacy.root (a new heir's root, drawn as creation
 *     draws one, on the save's seed) and legacy.eulogies ([{ id, name, kind, text }], the mourners'
 *     words, one model call; [] when it failed).
 * The op "legacy" { action: view | choose, heir: <id> | new, name?, gender?, root?, words? }:
 *   view → { legacy: view }; choose → { legacy: the receipt's legacy }. The heir is one of heirs
 *   (a tie of heirs.kinds whose person lives), or new (newHeir: the name the player gives, the root
 *   the server drew, the age and realm of the file). Receipt { kind: legacy, legacy: { action:
 *   inherit, heir: { id, name, kind, realm, root? }, dead: { id, name }, words, left: { home,
 *   vault, bag, stones }, clocks }, biography: { key, title, row }, took?, … }:
 *   - the predecessor becomes the row `biography.row` (a new C id; status `dead`, the gates passed
 *     as deeds, column 35 the biography): the server keeps it as a biography (worldBookEntries),
 *     as the card keeps those who left the scene
 *   - the heir becomes B1: a tie's own row (its age, lifespan and realm as the people book has
 *     them; it leaves table 0, and the server drops its biography and moves its portrait: `took`),
 *     or a new row; with the predecessor's vault (warehouse), worn gear (衣钵), purse and bag; the
 *     skills of table 8 go with the predecessor
 *   - relations to B1 now name the predecessor, relations to the heir name B1 (table 0 here, the
 *     biographies on the server: `relations`)
 *   - frxPlay: reset and drop (the predecessor's own parts), the own calendar entries of
 *     `calendar`, the people's pending events of `pending`, the clocks scoped self (a chronicle line
 *     each), the heir out of the people book; the life so far goes to frxPlay.lives. The jobs
 *     taken close 已失败 (jobs.orphanAll: a receipt each, their entries gone); the craft work paid
 *     for and not yet fetched (crafts.jobs) goes to the heir with its calendar entries, the
 *     crafts' mastery with the one before (plan item 50's fixes)
 *   - the people, the calendar, the world line and every other clock go on as they were.
 * The record: after every op that settled something, its chronicle lines of record.kinds go to
 *   frxPlay.record [{ year, date, kind, text }] (at most record.perYear a year, record.always
 *   aside), and a gate broken to frxPlay.passed [{ date, age, gate, name, to, foundation? }].
 *   choose moves both into frxPlay.lives (oldest first): [{ id, name, gender, realm, age, lifespan,
 *   died, place, heir, words, left, record, passed, eulogies }].
 * view(env) → null, { state: twilight, age, lifespan, left, ends } or { state: choosing, name,
 *   realm, age, lifespan, died, place, heirs: [{ id, name, kind, realm, age, gender }], root?,
 *   words, eulogies? } (PlayView.legacy).
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const calendar = require('./calendar.cjs');
const people = require('./people.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');

const LEGACY = data('legacy');
const CULTIVATION = mechanics.CULTIVATION;
const ORDER = mechanics.COMBAT.realms.order;
const YEAR_DAYS = clock.CALENDAR.daysPerMonth * clock.CALENDAR.monthsPerYear;
const NORMAL = '一切正常';
const TYPE = 'lifespan';
const DEAD = /身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落|已故/;
const GENDERS = ['男性', '女性'];
const J = JSON.stringify;
const RECORDED = new Set(LEGACY.record.kinds);
const ALWAYS = new Set(LEGACY.record.always);
const OPEN = new Set(LEGACY.open);
const READS = new Set(LEGACY.reads);
// The player's row as creation writes one: every column 待定, the relations and the favour empty;
// what a tie's heir brings of their own row (who they are: looks, nature, root, constitution,
// background, the intimate columns and their 生平经历). The rest is the player's.
const PLAYER = Object.fromEntries(Array.from({ length: 36 }, (_, n) => [String(n), [13, 14, 15].includes(n) ? '' : '待定']));
const OWN = ['3', '5', '6', '8', '10', '17', '18', '20', '21', '22', '23', '24', '27', '28', '29', '35'];

const rowName = row => plain(row?.['1']).split('|')[0].trim();
const genderOf = row => plain(row?.['1']).split('|')[1]?.trim() || '';
const realmOf = row => plain(row?.['2']).split('|')[0].trim();
const identityOf = row => plain(row?.['2']).split('|').slice(1).join('|').trim();
// A tie's person who left the scene with no biography kept is still the people book's: the story
// takes someone who goes away off the scene (de, as the prompt tells it), and without world
// evolution no biography keeps their row. A row from the book, then, so a 道侣 or a 弟子 away from
// the scene is still an heir and a mourner (the mock model's long run, plan item 50).
function bookRow(env, id) {
  const person = env.play.people?.by?.[id];
  const tie = tiesOf(env)[id];
  const today = clock.today(env);
  if (!person?.alive || !tie || today === null) return null;
  const { step, progress } = people.standing(person, today);
  return { 0: id, 1: [person.name, person.gender].filter(Boolean).join('|'), 2: mechanics.stepName(person.major, step),
    4: NORMAL, 9: `年龄:${Math.floor((today - person.born) / YEAR_DAYS)}|寿元:${person.lifespan}|修为进度:${progress}%`,
    13: `B1:${tie.kind}`, 16: `||${person.place || ''}||` };
}

const rowOf = (env, id) => env.state['0']?.[id] || env.biographies?.[id] || bookRow(env, id);
const choosing = env => env.play?.legacy?.state === 'choosing';
const wordsIn = text => plain(text).split('，').map(part => part.trim()).filter(Boolean);
const count = value => (/^\d{1,12}$/.test(plain(value)) ? Number(plain(value)) : 0);

function withWord(text, word) {
  const now = plain(text);
  if (!now || now === NORMAL) return word;
  return wordsIn(now).includes(word) ? now : `${now}，${word}`;
}

function withoutWord(text, word) {
  const kept = wordsIn(text).filter(part => part !== word);
  return kept.length ? kept.join('，') : NORMAL;
}

// The lifespan and the age as the player's remarks write them, and the years left.
function years(env) {
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const lifespan = mechanics.numberIn(remarks['寿元']), age = mechanics.numberIn(remarks['年龄']);
  return lifespan === null || age === null ? null : { lifespan, age, left: lifespan - age, remarks };
}

// The new year on which the age reaches the lifespan: the age goes up at every new year.
const endsOn = env => clock.lifespanEnd(env);
const lifespanEntry = env => list(env.play.calendar).find(entry => entry?.kind === 'own' && entry.type === TYPE) || null;

// ---------------------------------------------------------------- holding the rest while choosing

const hold = env => (choosing(env) ? LEGACY.held : null);
const holds = (env, op) => (choosing(env) && !OPEN.has(op) ? LEGACY.held : null);

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  const before = verbs.hooks.hold;
  verbs.hooks.hold = (env, kind) => hold(env) || before(env, kind);
}

// ---------------------------------------------------------------- the people around the end

// Alive and no foe: someone who could go on, or speak of the dead.
function alive(env, id) {
  const person = env.play.people?.by?.[id];
  if (person && !person.alive) return false;
  const row = rowOf(env, id);
  return Boolean(row) && !DEAD.test(plain(row['4'])) && !mechanics.isFallen(env.ctx, row) && !identityOf(row).includes('敌对');
}

const tiesOf = env => (env.play.ties && typeof env.play.ties === 'object' ? env.play.ties : {});

// A person as the people book has them today, else as their row writes it.
function standingOf(env, id) {
  const row = rowOf(env, id);
  const remarks = env.ctx.parseRemarksString(row?.['9']);
  const person = env.play.people?.by?.[id];
  const today = clock.today(env);
  if (person) {
    const { step, progress } = people.standing(person, today);
    return { realm: mechanics.stepName(person.major, step), age: Math.floor((today - person.born) / YEAR_DAYS), lifespan: person.lifespan, progress };
  }
  const age = mechanics.numberIn(remarks['年龄']) ?? people.PEOPLE.age;
  const written = mechanics.numberIn(remarks['寿元']);
  const realm = mechanics.parseRealm(row?.['2']);
  const floor = realm.unknown || realm.major <= 0 ? people.PEOPLE.mortalLifespan : CULTIVATION.lifespan[ORDER[realm.major]] ?? people.PEOPLE.mortalLifespan;
  return { realm: realmOf(row) || null, age, lifespan: written === null ? floor : written < age ? age + written : written,
    progress: mechanics.progressValue(remarks['修为进度']) };
}

// Who may go on: a tie of heirs.kinds whose person lives.
function heirs(env) {
  return Object.entries(tiesOf(env)).filter(([id, tie]) => LEGACY.heirs.kinds.includes(tie?.kind) && alive(env, id)).map(([id, tie]) => {
    const row = rowOf(env, id);
    const now = standingOf(env, id);
    return { id, name: rowName(row) || id, kind: tie.kind, realm: now.realm, age: now.age, gender: genderOf(row) || null };
  });
}

// Who speaks of the dead: the ties first, then the people on the scene.
function mourners(env) {
  const ties = tiesOf(env);
  const ids = [...Object.keys(ties).filter(id => alive(env, id)),
    ...Object.keys(env.state['0'] || {}).filter(id => /^[CG]/.test(id) && !ties[id] && alive(env, id))];
  return ids.slice(0, LEGACY.mourners).map(id => {
    const row = rowOf(env, id);
    return { id, name: rowName(row) || id, kind: ties[id]?.kind || '', identity: identityOf(row) };
  });
}

// ---------------------------------------------------------------- the record of a life

function note(env) {
  if (!env.receipts.some(receipt => receipt.ok)) return;
  const record = list(env.play.record);
  const passed = list(env.play.passed);
  let changed = false;
  for (const line of env.chronicle) {
    if (!RECORDED.has(line.kind)) continue;
    const year = line.date.year;
    if (!ALWAYS.has(line.kind) && record.filter(each => each.year === year).length >= LEGACY.record.perYear) continue;
    record.push({ year, date: line.date.text, kind: line.kind, text: line.text });
    changed = true;
  }
  for (const receipt of env.receipts) {
    const check = receipt.ok && receipt.kind === 'breakthrough' ? receipt.breakthrough : null;
    if (!check || check.realm?.after === check.realm?.before) continue;
    passed.push({ date: clock.dateKey(clock.today(env)), age: years(env)?.age ?? null, gate: plain(receipt.gate?.gate) || null,
      name: plain(receipt.gate?.name) || null, to: plain(check.to), ...(receipt.gate?.foundation ? { foundation: plain(receipt.gate.foundation) } : {}) });
    changed = true;
  }
  if (!changed) return;
  env.play.record = record;
  env.play.passed = passed;
}

// ---------------------------------------------------------------- twilight

async function twilight(env, now) {
  const row = env.state['0'].B1;
  const word = LEGACY.twilight.status;
  const near = now.left <= LEGACY.twilight.years;
  const entering = near && !env.play.twilight;
  const before = J([lifespanEntry(env), env.play.twilight ?? null]);
  const commands = [];
  const shown = wordsIn(row['4']).includes(word);
  if (near && !shown) commands.push(`add("B1",${J({ 4: withWord(row['4'], word) })})`);
  if (!near && shown) commands.push(`add("B1",${J({ 4: withoutWord(row['4'], word) })})`);
  const ends = clock.dateKey(endsOn(env));
  const entry = lifespanEntry(env);
  if (near) {
    if (!entry || entry.date !== ends) calendar.register(env, TYPE, { date: ends });
    env.play.twilight = { since: env.play.twilight?.since ?? clock.dateKey(clock.today(env)), ends };
  } else {
    if (entry) calendar.remove(env, entry.id);
    delete env.play.twilight;
  }
  if (!commands.length && J([lifespanEntry(env), env.play.twilight ?? null]) === before) return;
  // The new year's line says it when the twilight came with the year (month); else it is said now.
  if (entering && !env.twilightSaid) chronicle.write(env, 'twilight', { 年: chronicle.numeral(now.left) });
  await env.settle({ kind: 'legacy', ok: true, source: 'engine', ...(entering ? {} : { hidden: true }),
    legacy: { action: near ? 'twilight' : 'renewed', age: now.age, lifespan: now.lifespan, left: now.left, ...(near ? { ends } : {}) },
    commands: commands.join('\n'), owns: ownsNothing(),
    summary: near ? `寿元${now.lifespan}，年龄${now.age}，只剩${now.left}年：大限将至，寿元到${ends}用尽` : `寿元${now.lifespan}，年龄${now.age}：大限已解` });
}

// The month step: a new year inside the twilight says how many years are left.
async function month(env, entered) {
  if (entered.month !== 1 || choosing(env)) return;
  const now = years(env);
  const end = mechanics.readClock(env.state);
  if (!now || !end) return;
  // The age written is the stretch's end's; it went up by one at every new year on the way.
  const left = now.lifespan - (now.age - (clock.dateOf(end).year - entered.year));
  if (left < 1 || left > LEGACY.twilight.years) return;
  chronicle.write(env, 'twilight', { 年: chronicle.numeral(left) }, entered.minutes);
  env.twilightSaid = true;
}

// ---------------------------------------------------------------- the end

async function die(env, now) {
  const row = env.state['0'].B1;
  const name = rowName(row) || '你';
  const place = chronicle.placeName(env.state);
  const extreme = String(now.remarks.isExtreme).trim() === 'true';
  // The dying turn ends here: a stretch broken off on the way opens no scene.
  for (const receipt of env.receipts) delete receipt.interruption;
  chronicle.write(env, 'died', { 名: name, 地: place, 岁: chronicle.numeral(Math.max(0, now.age)) });
  const entry = lifespanEntry(env);
  if (entry) calendar.remove(env, entry.id);
  delete env.play.twilight;
  const died = { died: clock.dateKey(clock.today(env)), name, gender: genderOf(row) || null, realm: realmOf(row) || null, age: now.age, lifespan: now.lifespan, place: place || null };
  if (extreme) {
    // Today's death flow: the check after the turn finds the lifespan used up and starts over.
    await env.settle({ kind: 'legacy', ok: true, source: 'engine', legacy: { action: 'died', extreme: true, ...died },
      commands: `add("B1",${J({ 9: { 寿元: '0' } })})`, owns: ownsNothing(), summary: `${name}寿元耗尽，坐化：极限模式，回合之后照旧判死` });
    return;
  }
  env.play.legacy = { state: 'choosing', ...died, mourners: mourners(env) };
  if (env.play.encounter) env.play.encounter = null;
  if (env.play.cards) env.play.cards = null;
  const chosen = heirs(env);
  await env.settle({ kind: 'legacy', ok: true, source: 'engine', legacy: { action: 'died', ...died, heirs: chosen.map(({ id, name: who, kind }) => ({ id, name: who, kind })) },
    commands: `add("B1",${J({ 4: LEGACY.status })})`, owns: ownsNothing(),
    summary: `${name}寿元耗尽，坐化，享年${now.age}；等定下传人（${chosen.length ? chosen.map(each => `${each.kind}${each.name}`).join('、') : '没有道侣、弟子'}，或另立后人）` });
}

// After an op: the record, then the end or the twilight. Ops that settle nothing are left alone,
// and so is plot evolution's (director): the end comes with something the player did.
async function after(env, op) {
  if (READS.has(op) || op === 'legacy' || op === 'director') return;
  if (!choosing(env)) {
    const now = years(env);
    if (now && now.left <= 0 && !env.play.fight && !env.play.scene && op !== 'move') await die(env, now);
    else if (now && now.left > 0) await twilight(env, now);
  }
  note(env);
}

// ---------------------------------------------------------------- choosing the heir

// The card's relations column with some ids pointing at others (B1 → the predecessor, the heir → B1);
// null when nothing in it changes.
function repoint(text, map) {
  const before = String(text ?? '');
  const after = before.replace(/(^|[;；])(\s*)([BCG][\w-]*)(\s*[:：])/g, (whole, lead, space, id, colon) => (map[id] ? `${lead}${space}${map[id]}${colon}` : whole));
  return after === before ? null : after;
}

// An id for the predecessor's row no row and no biography has (as the engine's new foes are numbered).
function freeId(env) {
  const used = new Set([...Object.keys(env.state['0'] || {}), ...(env.knownIds || []), ...Object.keys(env.biographies || {})]);
  let n = mechanics.COMBAT.foes?.firstId || 501;
  while (used.has(`C${n}`)) n += 1;
  return `C${n}`;
}

// What the predecessor leaves: the home, the vault (the warehouse), the bag and the purse.
function leftOf(env, old) {
  const remarks = env.ctx.parseRemarksString(old['9']);
  const vault = env.ctx.parseNestedJsonString(remarks.warehouse, []);
  const stored = env.ctx.storedItemIds(env.state);
  const named = item => plain(item?.name || item?.['1'] || env.state['1']?.[item?.id || item?.['0']]?.['1']).split('|')[0];
  return { home: plain(env.play.home?.name) || null, vault: (Array.isArray(vault) ? vault : []).map(named).filter(Boolean),
    bag: Object.entries(env.state['1'] || {}).filter(([id, item]) => item && !stored.has(id)).map(([, item]) => rowName(item)).filter(Boolean),
    stones: count(old['26']) };
}

function heirRow(env, heir, old, dead, deadId) {
  const oldRemarks = env.ctx.parseRemarksString(old['9']);
  const passed = {};
  for (const key of ['warehouse', 'equipment', 'isExtreme', 'deathCount']) if (oldRemarks[key] !== undefined) passed[key] = oldRemarks[key];
  if (heir.id) {
    const row = rowOf(env, heir.id);
    const remarks = env.ctx.parseRemarksString(row['9']);
    const now = standingOf(env, heir.id);
    const realm = mechanics.parseRealm(now.realm);
    const panel = env.ctx.parseNestedJsonString(row['11'], {});
    const stats = panel && typeof panel === 'object' && Object.keys(panel).length ? panel : mechanics.baselineStats(realm, `${env.archiveId || ''}:${heir.id}`);
    const own = Object.fromEntries(OWN.filter(key => row[key] !== undefined && row[key] !== null && row[key] !== '').map(key => [key, row[key]]));
    return { ...PLAYER, ...own, 0: 'B1', 1: plain(row['1']) || heir.name, 2: [now.realm || realmOf(row), identityOf(row)].filter(Boolean).join('|'),
      4: NORMAL,
      9: { 灵根: remarks['灵根'] ?? (plain(row['5']) || '待定'), 善恶值: remarks['善恶值'] ?? '0', 年龄: String(now.age), 寿元: String(now.lifespan),
        修为进度: `${now.progress}%`, traits: remarks.traits ?? '[]', ...passed },
      11: J(stats), 13: repoint(row['13'], { B1: deadId }) ?? (row['13'] ?? ''), 26: String(count(old['26']) + count(row['26'])) };
  }
  const spec = LEGACY.newHeir;
  const realm = mechanics.parseRealm(spec.realm);
  const lifespan = CULTIVATION.lifespan[ORDER[realm.major]] ?? people.PEOPLE.mortalLifespan;
  return { ...PLAYER, 0: 'B1', 1: `${heir.name}|${heir.gender}`, 2: `${spec.realm}|${chronicle.fill(spec.identity, { 前: dead.name })}`, 4: NORMAL,
    5: heir.root, 9: { 灵根: heir.root, 善恶值: '0', 年龄: String(spec.age), 寿元: String(lifespan), 修为进度: '0%', traits: '[]', ...passed },
    10: chronicle.fill(spec.background, { 前: dead.name }), 11: J(mechanics.baselineStats(realm, `${env.archiveId || ''}:heir:${dead.died}`)), 13: '',
    26: String(count(old['26'])) };
}

function deadRowOf(env, old, dead, deadId, passed, heirName) {
  const remarks = env.ctx.parseRemarksString(old['9']);
  for (const key of ['warehouse', 'equipment', 'inventory', 'isExtreme', 'deathCount', 'avatar', 'hp']) delete remarks[key];
  if (passed.length) remarks.deeds = passed.map(each => `${each.date}:${each.to}`).join(';');
  const gates = passed.map(each => each.name || each.to).filter(Boolean).join('、');
  const biography = chronicle.fill(LEGACY.biography, { 名: dead.name, 境界: dead.realm || '', 岁: chronicle.numeral(Math.max(0, dead.age)),
    地: dead.place || '洞府', 关: gates, 传人: heirName });
  const lived = plain(old['35']);
  return { ...old, 0: deadId, 4: LEGACY.dead, 9: env.ctx.serializeRemarksObject(remarks), 13: '',
    35: lived && lived !== '待定' ? `${lived}\n${biography}` : biography };
}

async function choose(env, args) {
  if (!choosing(env)) return env.refuse(LEGACY.alive);
  const dead = env.play.legacy;
  const old = env.state['0']?.B1;
  const wanted = plain(args.heir).trim();
  let heir;
  if (wanted === 'new') {
    const name = plain(args.name).trim();
    if (!name || [...name].length > LEGACY.newHeir.nameMax || /[|｜\s]/.test(name)) return env.refuse(LEGACY.badName);
    const root = plain(args.root).trim() || plain(dead.root).trim();
    if (!root) return env.refuse(LEGACY.noRoot);
    const gender = GENDERS.includes(plain(args.gender)) ? plain(args.gender) : GENDERS.includes(dead.gender) ? dead.gender : GENDERS[0];
    heir = { id: null, name, kind: LEGACY.newHeir.kind, gender, root };
  } else {
    heir = heirs(env).find(each => each.id === wanted);
    if (!heir) return env.refuse(LEGACY.notHeir);
  }
  const said = [...plain(args.words).trim()].slice(0, LEGACY.wordsMax).join('') || LEGACY.words;
  const deadId = freeId(env);
  const passed = list(env.play.passed);
  const left = leftOf(env, old);
  const b1 = heirRow(env, heir, old, dead, deadId);
  const deadRow = deadRowOf(env, old, dead, deadId, passed, heir.name);
  const commands = [`de("B1")`, `set(${J(b1)})`];
  if (heir.id && env.state['0']?.[heir.id]) commands.push(`de(${J(heir.id)})`);
  const map = { B1: deadId, ...(heir.id ? { [heir.id]: 'B1' } : {}) };
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    if (id === 'B1' || id === heir.id || !row) continue;
    const rewritten = repoint(row['13'], map);
    if (rewritten !== null) commands.push(`add(${J(id)},${J({ 13: rewritten })})`);
  }
  for (const id of Object.keys(env.state['8'] || {})) commands.push(`de(${J(id)})`);
  // The jobs taken die with their taker: each closes 已失败 (jobs.cjs orphanAll), its entry gone.
  await require('./jobs.cjs').orphanAll(env);
  // frxPlay: what was the predecessor's alone goes; the world goes on.
  const play = env.play;
  // the work paid for and not yet fetched (crafts.jobs, its calendar entries) goes to the heir; the
  // mastery does not
  const hired = list(play.crafts?.jobs);
  const ended = list(play.clocks).filter(found => found?.scope?.kind === 'self');
  play.clocks = list(play.clocks).filter(found => found?.scope?.kind !== 'self');
  for (const found of ended) chronicle.write(env, 'clockGone', { 缘由: LEGACY.clockReason, 钟: plain(found.name) });
  play.calendar = list(play.calendar).filter(entry => !(entry?.kind === 'own' && LEGACY.calendar.includes(entry.type)));
  play.pending = list(play.pending).filter(each => each?.from !== 'humanJourney'
    && !(each?.from === 'people' && (LEGACY.pending.includes(each.event) || each.person === heir.id)));
  if (heir.id && play.people?.by?.[heir.id]) {
    delete play.people.by[heir.id];
    play.people.next = Object.values(play.people.by).filter(person => person.alive)
      .reduce((low, person) => (low === null || person.next < low ? person.next : low), null);
  }
  for (const [key, value] of Object.entries(LEGACY.reset)) play[key] = structuredClone(value);
  for (const key of LEGACY.drop) delete play[key];
  if (hired.length) play.crafts = { jobs: hired };
  const heirShown = { id: heir.id, name: heir.name, kind: heir.kind, realm: plain(b1['2']).split('|')[0], ...(heir.root ? { root: heir.root } : {}) };
  play.lives = [...list(play.lives), { id: deadId, name: dead.name, gender: dead.gender ?? null, realm: dead.realm ?? null, age: dead.age, lifespan: dead.lifespan,
    died: dead.died, place: dead.place ?? null, heir: heirShown, words: said, left, record: list(play.record), passed,
    eulogies: list(dead.eulogies) }];
  delete play.legacy;
  const line = chronicle.write(env, 'inherit', { 名: heir.name, 前: dead.name, 言: said });
  play.record = [{ year: line.date.year, date: line.date.text, kind: line.kind, text: line.text }];
  play.passed = [];
  const legacy = { action: 'inherit', heir: heirShown, dead: { id: deadId, name: dead.name }, words: said, left, clocks: ended.map(found => plain(found.name)) };
  await env.settle({ kind: 'legacy', ok: true, source: 'engine', legacy,
    biography: { key: deadId, title: dead.name, row: deadRow }, relations: map, ...(heir.id ? { took: heir.id } : {}),
    commands: commands.join('\n'), owns: ownsNothing(),
    summary: `${heir.kind}${heir.name}承了${dead.name}的衣钵：洞府${left.home ? `「${left.home}」` : '无'}，仓库${left.vault.length}件，灵石${left.stones}；${dead.name}成了人物表里已故的${deadId}` });
  return { legacy };
}

async function op(env, args) {
  const action = String(args.action ?? 'view');
  if (action === 'view') return { legacy: view(env) };
  if (action === 'choose') return choose(env, args);
  return env.refuse('传承只有：view、choose');
}

// ---------------------------------------------------------------- the view

function view(env) {
  if (choosing(env)) {
    const dead = env.play.legacy;
    return { state: 'choosing', name: dead.name, realm: dead.realm ?? null, age: dead.age, lifespan: dead.lifespan, died: dead.died, place: dead.place ?? null,
      heirs: heirs(env), ...(dead.root ? { root: dead.root } : {}), words: LEGACY.words, ...(Array.isArray(dead.eulogies) ? { eulogies: dead.eulogies } : {}) };
  }
  const now = env.play?.twilight ? years(env) : null;
  return now ? { state: 'twilight', age: now.age, lifespan: now.lifespan, left: now.left, ends: env.play.twilight.ends } : null;
}

module.exports = { LEGACY, after, month, hold, holds, install, op, view, heirs, choosing };
