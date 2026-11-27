'use strict';
/* Story threads (线头, batch 9): what a scene left open for the player to take up: an appointment
 * at a place and time, someone waiting on an answer, a thing promised. The rules and words are
 * content/life/threads.json. No model is called here.
 *
 * frxPlay.threads, at most `most` active matters:
 *   [{ id: "T1", text, who?: { id, name }, place, spot?, when?: { from, to }, item?, since, expires,
 *      from, pending?, followUp?, completed?, taken?: { scene }, attended? }]
 *   when, since and expires are minutes on the clock (mechanics.readClock), when to the hour; from
 *   the title of the scene it came from; pending the id of the event of frxPlay.pending it is
 *   (trigger { kind: thread, value: its id }, from thread, person: who's id); followUp true for
 *   one the server leaves for someone still on the scene when it closed (life_turns).
 * The lifecycle (the owner's save d7db1fea, 孙老道's escort): a thread is open until it is taken
 *   up (follow, its hour, a stretch stopped there: take), then under way in the scene it opens
 *   (taken.scene, that scene's number; no event, not in the view, not a next step) until the story
 *   settles it (a 了结 line of <threads>: settle) or that scene closes without settling it: open
 *   again (reopen, called by scene.cjs as any scene closes), its automatic meeting consumed, to go on
 *   with what the scene left. Generic follow-ups close once visited (completed); their record
 *   prevents the same automatic invitation until its original expiry, without occupying an
 *   active slot. A concrete new promise can replace it. attended: the player saw to it (its scene
 *   ran, or its person was on the scene with the player at its place inside its time: attend);
 *   a lapse of one is no miss.
 * add(env, candidates, { from, followUp }) → { added: [thread], dropped: [{ text, why }] }: each
 *   candidate { text, who?, place?, spot?, when?, item? } as the model wrote it (<threads>,
 *   life_cards.threads_of), checked against the save and kept or dropped with the reason, never
 *   sent back: the text at most words.text characters; who someone on the scene (table 0), in the
 *   people's book or with a biography the card keeps, by id or name; place a map place, or a text
 *   holding one (泊灯城西坊), empty or a word for here (此地) for where the player is, so is a name the
 *   story gives the spot the player is at (kept as the spot), and a land (云汀湾) is the map place the
 *   thread's words name, else here when it is the land around (placeOf); when "起~止",
 *   two moments as the time row writes them (0001年 03月 15日 23:00) or as the view does
 *   (0001-03-15 23:00), the start to the hour before, the end to the hour after; one moment alone
 *   is a 时辰 from it, a day without an hour the whole day; the end after now and within
 *   windowDays; item a thing in the bag, by name or id. One that says what a thread already there
 *   says, open or under way (twinOf: the same person at the same spot, or words alike), is dropped,
 *   a follow-up giving way to the story's own thread about the same person; so is any past
 *   `perBeat`; with `most` there, the oldest follow-up makes room, and without one it is dropped.
 *   followUp: true when a scene closed in the turn (the server's), for people staying here, or
 *   their names or ids. Only without concrete unfinished business, each gets optional `followUp`
 *   ("接着和齐管事说话", here, no time, for followUpDays), unless named by an existing live or
 *   completed follow-up, just settled this beat, or active slots are full. expires: when's end,
 *   else since + defaultDays.
 * staying(env) → the ids of the people who stay on the scene at this place: in the character
 *   table, alive, no foe (敌对), their whereabouts (column 16's third part) here or unwritten.
 * holds(env, id) → whether the thread goes off by itself now (pending.cjs, trigger thread): one
 *   with a time, the player at its place inside it, with its item. One without a time never does:
 *   follow takes it up.
 * timed(env, minutes) → the stop a stretch spent here meets when a thread's time begins inside it
 *   (interrupt.forced): { minutes, day, origin: thread, cause, event: { kind: pending, id, from:
 *   thread, trigger: thread, thread, person? } }, or null.
 * take(env, id) → the thread, under way now (pending.consume and fire, follow); drop(env, id) one
 *   gone for good with its event; settle(env, ids) removes real matters the story saw to and marks
 *   generic invitations completed; reopen(env) the
 *   ones whose scene closed, open again for real business or completed for generic follow-ups;
 *   attend(env) marks the ones the player sees to now.
 * fired(env, id) → what the scene it opens has: { cause, thread: { id, text, spot? }, person? };
 *   causeFor(env, id) its cause alone (pending.causeOf).
 * sweep(env) → the threads past their expires, gone with their events, a line each (threadLapse,
 *   or threadLetGo for a follow-up: 错过了…), dated when they ran out; none for one attended.
 * view(env) → the contract's PlayThread rows of the open threads not yet past their time, nearest
 *   to run out first: times in game time to the minute ("0001-03-15 23:00"), the window also in
 *   the calendar's words. One past its time stays in frxPlay until the next sweep says it.
 * The op "thread" { action: "add", threads, settle?, from, followUp } → { threads: { added,
 *   dropped, settled } }: reopen, settle (the beat's 了结 lines), attend, add; a hidden receipt
 *   (kind thread) says what was settled, added and why each other was dropped.
 * The verb follow { id } (verbs.VERBS.follow): refused, with the reason, when it names no open
 *   thread, the player is not at its place, it is too early (from when) or too late, or its item is
 *   not in the bag; else followMinutes pass, an annals line is written, the thread is taken up and
 *   its event goes, and the receipt carries interruption { origin: thread, cause, day: 1, date, minutes, thread:
 *   { id, text, spot? }, visit?: who }: the server opens the scene from it as from a stretch broken
 *   off (item 16), with who in it. Cut short by a real interruption on the way, nothing is taken up.
 */
const mechanics = require('../mechanics.cjs');
const clocks = require('./clocks.cjs');
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('threads');
const DAY = clock.DAY_MINUTES;
const HOUR = 60;
const pad = value => String(value).padStart(2, '0');
const cut = (value, most) => [...plain(value ?? '').trim()].slice(0, most).join('');
const fill = (text, values) => chronicle.fill(text, values);
const rowName = row => plain(row?.['1']).split('|')[0].trim();
const isTime = value => Number.isSafeInteger(value) && value >= 0;
// Every thread of frxPlay.threads; the open ones (waiting to be taken up); the live ones (open and
// not past their time); a thread under way in a scene (taken) is neither open nor live.
const deadline = thread => thread.expires === null ? Infinity : thread.expires;
const listed = env => list(env.play?.threads).filter(each => each?.id && (each.expires === null || isTime(each.expires)));
const open = env => listed(env).filter(each => !each.taken && !each.completed);
const live = (env, now) => open(env).filter(each => deadline(each) >= now && !(windowOf(each) && now >= each.when.to));
const nowOf = env => mechanics.readClock(env.state)?.minutes ?? null;
// A moment as the time row writes it (mechanics.cjs reads the clock by the same words).
const WRITTEN = /(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{1,2}))?/;
// A thread's time, when it has a readable one.
const windowOf = thread => (thread?.when && isTime(thread.when.from) && isTime(thread.when.to) ? thread.when : null);

// ---------------------------------------------------------------- times

// A moment on the clock in game time to the minute: 0001-03-15 23:00.
function timeOf(minutes) {
  const day = Math.floor(minutes / DAY), within = minutes - day * DAY;
  return `${clock.dateKey(day)} ${pad(Math.floor(within / 60))}:${pad(within % 60)}`;
}

// The same in the calendar's words: 三月十五子时 (the 时辰 the hour falls in, 子 from 23:00).
function hourText(minutes) {
  const within = ((minutes % DAY) + DAY) % DAY;
  const index = Math.floor(((Math.floor(within / 60) + 1) % 24) / 2);
  return fill(RULES.hour, { 日: clock.dateOf(minutes).text, 时: RULES.hours[index] });
}

const windowText = when => fill(RULES.window, { 起: hourText(when.from), 止: hourText(when.to) });

// A moment as the time row writes it (0001年 03月 15日 23:00) or as the view does (0001-03-15
// 23:00): { minutes, timed } on the clock (timed: an hour was written), or null.
function minutesOf(text) {
  const source = plain(text ?? '').trim();
  const dashed = /^(\d{1,6})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})[:：](\d{1,2}))?$/.exec(source);
  const match = dashed || WRITTEN.exec(source);
  if (!match) return null;
  const day = clock.dayOfDate(`${Number(match[1])}-${Number(match[2])}-${Number(match[3])}`);
  if (day === null) return null;
  const timed = match[4] !== undefined;
  const hour = timed ? Number(match[4]) : 0, minute = timed ? Number(match[5]) : 0;
  if (hour > 23 || minute > 59) return null;
  return { minutes: day * DAY + hour * 60 + minute, timed };
}

// A candidate's time ("起~止", one moment, or { from, to }) as minutes to the hour: { when } (null
// for none) or { bad: the text as written }.
function readWhen(raw) {
  if (raw === undefined || raw === null) return { when: null };
  if (typeof raw !== 'object' && !plain(raw).trim()) return { when: null };
  const shown = typeof raw === 'object' ? `${plain(raw.from ?? '')}~${plain(raw.to ?? '')}` : plain(raw).trim();
  const parts = typeof raw === 'object' ? [raw.from, raw.to] : shown.split(/\s*[~～]\s*|\s+至\s+/);
  const bad = { bad: cut(shown, 40) || '空' };
  if (parts.length > 2) return bad;
  const [start, end] = parts.map(minutesOf);
  const second = parts.length > 1 && plain(parts[1] ?? '').trim();
  if (!start || (second && !end)) return bad;
  const from = Math.floor(start.minutes / HOUR) * HOUR;
  // the end: what was written, else a 时辰 from a moment, the whole day from a day
  const last = end ? (end.timed ? end.minutes : end.minutes + DAY) : start.timed ? start.minutes + 2 * HOUR : start.minutes + DAY;
  const to = Math.ceil(last / HOUR) * HOUR;
  if (!(to > from)) return bad;
  return { when: { from, to }, shown: cut(shown, 40) };
}

// ---------------------------------------------------------------- whom, where, what

// Someone on the scene (table 0), in the people's book or with a biography the card keeps, by id
// or name: { id, name }, or null.
function personOf(env, key) {
  const value = plain(key ?? '').trim();
  if (!value || value === 'B1') return null;
  const rows = env.state['0'] || {};
  const people = /^[CG]/;
  if (people.test(value) && rows[value]) return { id: value, name: rowName(rows[value]) || value };
  const onScene = Object.entries(rows).find(([id, row]) => people.test(id) && row && rowName(row) === value);
  if (onScene) return { id: onScene[0], name: value };
  const book = env.play?.people?.by && typeof env.play.people.by === 'object' ? env.play.people.by : {};
  if (book[value]) return { id: value, name: plain(book[value].name) || value };
  const known = Object.entries(book).find(([, each]) => plain(each?.name) === value);
  if (known) return { id: known[0], name: value };
  const kept = env.biographies && typeof env.biographies === 'object' ? env.biographies : {};
  if (kept[value]) return { id: value, name: rowName(kept[value]) || value };
  const left = Object.entries(kept).find(([, row]) => rowName(row) === value);
  return left ? { id: left[0], name: value } : null;
}

// The map place a text names: the place itself or one inside it (泊灯城西坊); where the player is
// for an empty text, a word for here, or a name the story gives the spot the player is at (太南谷
// at 太南谷散市: the time row's bracketed spot holds it, or it holds the spot). A region or a land
// (云汀湾, 潮岚道) is no place: the map place the thread's own words name (前往含沫岭采药), else where
// the player is when it is the land they are in. Null when it is none of these.
function placeOf(env, text, words = '') {
  const value = plain(text ?? '').trim();
  const here = places.placeFacts(env).place || null;
  if (!value || RULES.here.includes(value)) return here;
  if (here && value === here) return here;
  const named = places.factsOf(value, env.worldMap).place;
  if (named) return named;
  const where = places.readWhere(mechanics.placeOf(env.state) || '');
  const spot = where.spot || '';
  if ([...value].length >= 2 && spot && (spot.includes(value) || value.includes(spot))) return here;
  if (!isLand(env, value)) return null;
  const told = plain(words).trim() ? places.factsOf(plain(words), env.worldMap) : null;
  if (told?.place && told.via === 'name') return told.place;
  return [where.region, where.area].includes(value) ? here : null;
}

// A region or a land the time row names (潮岚道, 云汀湾), or a name that reads as one (溪国).
function isLand(env, value) {
  const where = places.readWhere(mechanics.placeOf(env.state) || '');
  return [where.region, where.area].includes(value) || /[国域州]$/.test(value);
}

// The bag's thing of that name or id: its name, or null.
function bagHas(env, key) {
  const value = plain(key ?? '').trim();
  if (!value) return null;
  const rows = env.state['1'] || {};
  if (rows[value]) return rowName(rows[value]) || value;
  return Object.values(rows).some(row => row && rowName(row) === value) ? value : null;
}

const atPlace = (env, place) => {
  const here = places.placeFacts(env).place;
  return Boolean(place && here && here === place);
};

// ---------------------------------------------------------------- adding

function check(env, raw, now) {
  const text = cut(raw?.text, RULES.words.text);
  if (!text) return { why: RULES.dropped.text };
  if (/^(?:接着|继续|再)(?:和|与|跟).{1,16}(?:说话|聊聊|交谈|攀谈|谈谈)$/.test(text)) {
    return { text, why: RULES.dropped.generic };
  }
  const whoKey = plain(raw.who?.id ?? raw.who?.name ?? raw.who ?? '').trim();
  const who = whoKey ? personOf(env, whoKey) : null;
  if (whoKey && !who) return { text, why: fill(RULES.dropped.who, { 人: cut(whoKey, 20) }) };
  const place = placeOf(env, raw.place, text);
  if (!place) return { text, why: fill(RULES.dropped.place, { 地: cut(raw.place, 20) || '此地' }) };
  const read = readWhen(raw.when);
  if (read.bad) return { text, why: fill(RULES.dropped.when, { 时: read.bad }) };
  const when = read.when;
  if (when && when.to <= now) return { text, why: fill(RULES.dropped.past, { 时: read.shown }) };
  if (when && when.to > now + RULES.windowDays * DAY) {
    return { text, why: fill(RULES.dropped.far, { 时: read.shown, 日: chronicle.numeral(RULES.windowDays) }) };
  }
  const itemKey = plain(raw.item?.name ?? raw.item ?? '').trim();
  const item = itemKey ? bagHas(env, itemKey) : null;
  if (itemKey && !item) return { text, why: fill(RULES.dropped.item, { 物: cut(itemKey, 20) }) };
  // a place written as a name of the spot, not the map's: the spot it names
  const written = plain(raw.place ?? '').trim();
  const named = written && written !== place && !RULES.here.includes(written) && !isLand(env, written)
    && !places.factsOf(written, env.worldMap).place ? written : '';
  const promise = cut(raw.promise, RULES.words.fact);
  const thread = { text, who, place, spot: cut(raw.spot || named, RULES.words.spot), when, item, promise };
  // one there already, open or under way in this scene, is not left twice; a follow-up gives way to
  // the story's own words about the same person
  // A retired opportunity may be followed by a new dated occurrence. Re-emitting the
  // identical undated task, with no new terms, would bring the old one back to life.
  const retired = list(env.play.threadHistory).some(old => old.text === text && old.place === place
    && plain(old.who?.name) === plain(who?.name) && plain(old.spot) === plain(thread.spot)
    && plain(old.item) === plain(item) && (!when || when.from <= old.endedAt));
  if (retired) return { text, why: RULES.dropped.ended };
  const twin = twinOf(env, thread);
  if (twin && !twin.followUp) return { text, why: fill(RULES.dropped.again, { 事: text }) };
  return { thread, twin };
}

// Two explicit promises can share the same person and place. Merge only the same business
// with compatible details. A generic invitation still yields to concrete business with its person.
function twinOf(env, made) {
  return listed(env).find(each => {
    if (made.who && each.who && !names(each, made.who)) return false;
    if (made.place !== each.place) return false;
    if (each.followUp) return Boolean(made.who && names(each, made.who));
    if (made.item && each.item && made.item !== each.item) return false;
    if (made.spot && each.spot && !made.spot.includes(each.spot) && !each.spot.includes(made.spot)) return false;
    if (made.when && each.when && (made.when.to <= each.when.from || each.when.to <= made.when.from)) return false;
    return alike(plain(each.text), made.text);
  }) || null;
}

function pairs(text) {
  const chars = [...plain(text).replace(/[\s，。、；：！？,.;:!?「」『』（）()…—-]/g, '')];
  return chars.slice(1).map((char, index) => chars[index] + char);
}

function alike(one, other) {
  if (one === other) return true;
  const a = pairs(one), b = pairs(other);
  if (!a.length || !b.length) return false;
  const left = new Map();
  for (const pair of a) left.set(pair, (left.get(pair) || 0) + 1);
  let common = 0;
  for (const pair of b) {
    if (!left.get(pair)) continue;
    common += 1;
    left.set(pair, left.get(pair) - 1);
  }
  return (2 * common) / (a.length + b.length) >= RULES.similar;
}

// Room for one more thread: with `most` open the oldest follow-up goes (a thread the story left
// says more than 「接着和某人说话」); false when every open one is the story's.
function room(env) {
  if (listed(env).filter(each => !each.completed).length < RULES.most) return true;
  const spare = open(env).filter(each => each.followUp).sort((a, b) => a.since - b.since)[0];
  if (!spare) return false;
  drop(env, spare.id);
  return true;
}

const DEAD = /身亡|死亡|已死|毙命|气绝|殒命|伏诛|坐化|陨落/;
const identityOf = row => plain(row?.['2']).split('|').slice(1).join('|');

function staying(env) {
  const here = places.placeFacts(env).place;
  if (!here) return [];
  const away = row => {
    const text = plain(row?.['16']).split('|')[2]?.trim();
    const there = text ? places.factsOf(text, env.worldMap).place : null;
    return Boolean(there && there !== here);
  };
  return Object.entries(env.state['0'] || {}).filter(([id, row]) => /^[CG]/.test(id) && row && rowName(row)
    && !DEAD.test(plain(row['4'])) && !identityOf(row).split('|').includes('敌对') && !mechanics.isFallen(env.ctx, row)
    && !away(row)).map(([id]) => id);
}

function store(env, { text, who, place, spot, when, item, followUp, promise }, now, from, days) {
  const id = nextId(env, 'thread', 'T');
  const expires = when?.to ?? (promise ? null : now + days * DAY);
  const hook = { id: nextId(env, 'pending', 'P'), trigger: { kind: 'thread', value: id }, seed: text, from: 'thread',
    ...(who ? { person: who.id } : {}), since: clock.dateKey(Math.floor(now / DAY)) };
  const thread = { id, text, ...(who ? { who } : {}), place, ...(spot ? { spot } : {}), ...(when ? { when } : {}),
    ...(item ? { item } : {}), since: now, expires, from: cut(from, RULES.words.from), pending: hook.id,
    ...(followUp ? { followUp: true } : {}), ...(promise ? { progress: [promise] } : {}) };
  env.play.threads = [...list(env.play.threads), thread];
  env.play.pending = [...list(env.play.pending), hook];
  return thread;
}

function add(env, candidates, { from = '', followUp = [], settledPeople = [] } = {}) {
  const now = nowOf(env);
  const added = [], dropped = [];
  const given = list(candidates).filter(each => each && typeof each === 'object');
  if (now === null) {
    return { added, dropped: given.map(each => ({ text: cut(each.text, RULES.words.text), why: RULES.dropped.clock })) };
  }
  given.forEach((raw, index) => {
    if (index >= RULES.perBeat) {
      dropped.push({ text: cut(raw.text, RULES.words.text), why: fill(RULES.dropped.perBeat, { 条: chronicle.count(RULES.perBeat) }) });
      return;
    }
    const checked = check(env, raw, now);
    if (!checked.thread) { dropped.push({ text: checked.text || cut(raw.text, RULES.words.text), why: checked.why }); return; }
    if (checked.twin) drop(env, checked.twin.id);
    if (!room(env)) {
      dropped.push({ text: checked.thread.text, why: fill(RULES.dropped.most, { 满: chronicle.numeral(RULES.most) }) });
      return;
    }
    added.push(store(env, checked.thread, now, from, RULES.defaultDays));
  });
  // Concrete unfinished business already provides the next decision. Do not add unrelated
  // generic conversations beside it, or reopen a person whose business was just settled.
  const continuation = live(env, now).some(each => !each.followUp);
  for (const key of continuation ? [] : followUp === true ? staying(env) : list(followUp)) {
    const who = personOf(env, key);
    if (!who || settledPeople.some(person => names({ who: person }, who))
        || live(env, now).some(each => names(each, who))) continue;
    const text = cut(fill(RULES.followUp, { 名: who.name }), RULES.words.text);
    const place = placeOf(env, '');
    if (!place || listed(env).some(each => plain(each.text) === text) || !room(env)) continue;
    added.push(store(env, { text, who, place, followUp: true }, now, from, RULES.followUpDays));
  }
  return { added, dropped };
}

// ---------------------------------------------------------------- holding, going off, lapsing

const threadOf = (env, id) => open(env).find(each => each.id === id) || null;

// Why the thread cannot be taken up now ('' when it can).
function blocked(env, thread) {
  const now = nowOf(env);
  if (now === null) return RULES.refused.clock;
  const when = windowOf(thread);
  if (!atPlace(env, thread.place)) return fill(RULES.refused.place, { 地: plain(thread.place) + (thread.spot ? `（${plain(thread.spot)}）` : '') });
  if (when && now < when.from) return fill(RULES.refused.early, { 起: hourText(when.from) });
  if (when && now >= when.to) return fill(RULES.refused.late, { 止: hourText(when.to) });
  if (!when && now > deadline(thread)) return fill(RULES.refused.late, { 止: hourText(thread.expires) });
  if (thread.item && !bagHas(env, thread.item)) return fill(RULES.refused.item, { 物: plain(thread.item) });
  return '';
}

function holds(env, id) {
  const thread = threadOf(env, id);
  return Boolean(thread && !thread.attended && windowOf(thread) && !blocked(env, thread));
}

// The person a thread is with while they can still be in a scene ({ id, name }), or null: on the
// scene, else in the people's book and not dead, else with a biography the card keeps.
function presentOf(env, thread) {
  const id = thread?.who?.id, name = plain(thread?.who?.name);
  if (!id) return null;
  // the id the story gave someone else since: the one of the thread's name, wherever they are
  const found = env.state['0']?.[id] && name && rowName(env.state['0'][id]) !== name ? personOf(env, name) : null;
  const key = found ? found.id : id;
  const row = env.state['0']?.[key];
  if (row && (!name || rowName(row) === name)) return DEAD.test(plain(row['4'])) ? null : { id: key, name: rowName(row) || name || key };
  const kept = env.play?.people?.by?.[key];
  if (kept && (kept.alive === false || kept.died)) return null;
  const left = env.biographies?.[key];
  if ((kept && (!name || plain(kept.name) === name)) || (left && (!name || rowName(left) === name))) {
    return { id: key, name: name || plain(kept?.name) || rowName(left) || key };
  }
  return null;
}

// Whether a thread is with that person: by name, since the story gives an id to someone else
// now and then.
const names = (thread, who) => Boolean(thread?.who && (plain(thread.who.name) ? plain(thread.who.name) === who.name
  : thread.who.id === who.id));

const causeOf = thread => fill(RULES.cause, { 事: plain(thread.text), 处: plain(thread.spot) });
const dueOf = thread => fill(RULES.due, { 事: plain(thread.text), 处: plain(thread.spot) });
// The words of a thread's event that goes off by itself (pending.causeOf), or null.
const causeFor = (env, id) => {
  const thread = threadOf(env, id);
  return thread ? dueOf(thread) : null;
};

const unhook = (env, id) => {
  env.play.pending = list(env.play.pending).filter(each => !(each?.trigger?.kind === 'thread' && each.trigger.value === id));
};

// A thread taken up: it stays, under way in the scene it opens (the next scene's number), until the
// story settles it or that scene closes (reopen); its event goes.
function take(env, id) {
  const thread = threadOf(env, id);
  if (!thread) return null;
  thread.taken = { scene: (Number(env.play?.counters?.scene) || 0) + 1 };
  delete thread.pending;
  unhook(env, id);
  return thread;
}

// A thread gone for good, with its event.
function drop(env, id) {
  const thread = listed(env).find(each => each.id === id) || null;
  env.play.threads = list(env.play.threads).filter(each => each?.id !== id);
  unhook(env, id);
  return thread;
}

// Keep a fulfilled generic invitation until its original expiry so a later close cannot recreate
// it. Both the scene's close and an explicit 了结 can finish it; repeated completion is a no-op.
function finishFollowUp(env, thread) {
  const changed = !thread.completed;
  thread.completed = true;
  thread.attended = true;
  delete thread.taken;
  delete thread.when;
  delete thread.pending;
  unhook(env, thread.id);
  return changed;
}

// Only facts that happened to a concrete matter belong to its history. Expiration records
// when the window actually closed, even if the next engine operation is years later.
function archiveMatter(env, thread, status, result = '', at = nowOf(env)) {
  const endedAt = at ?? thread.since;
  const date = clock.dateKey(Math.floor(endedAt / DAY));
  const { id, text, place, spot, who, item, progress } = thread;
  const entry = { id, text, status, date, endedAt, place, ...(item ? { item } : {}), ...(spot ? { spot } : {}), ...(who ? { who } : {}),
    ...(result ? { result } : {}), ...(progress?.length ? { progress } : {}) };
  (env.play.threadHistory ||= []).push(entry);
}

function updateMatters(env, updates) {
  const finished = [];
  for (const change of list(updates)) {
    const thread = listed(env).find(each => each.id === change?.id && !each.completed);
    if (!thread) continue;
    const result = cut(change.result, RULES.words.fact);
    if (change.status === 'progress') {
      if (result && !list(thread.progress).includes(result)) {
        (thread.progress ||= []).push(result);
        if (!thread.followUp && !thread.when) thread.expires = null;
      }
      continue;
    }
    if (!['completed', 'failed', 'abandoned'].includes(change.status)) continue;
    if (thread.followUp) {
      finishFollowUp(env, thread);
    } else {
      archiveMatter(env, thread, change.status, result);
      drop(env, thread.id);
    }
    finished.push({ thread, status: change.status });
  }
  return finished;
}

// The threads taken up by a scene that has opened and is on no more (scene.cjs calls this as a scene
// closes, whatever closes it), open again for what that scene left of them: the player went to it,
// so the appointment stops no more stretches. Its explicit deadline remains in effect.
function reopen(env) {
  const counted = Number(env.play?.counters?.scene) || 0;
  const on = env.play?.scene ? Number(String(env.play.scene.id).slice(1)) : null;
  for (const thread of listed(env)) {
    const number = Number(thread.taken?.scene);
    if (!thread.taken || counted < number || on === number) continue;
    if (thread.followUp) {
      finishFollowUp(env, thread);
      continue;
    }
    delete thread.taken;
    // Attendance consumes the automatic meeting. A real deadline still applies to unfinished work.
    thread.attended = true;
    const hook = { id: nextId(env, 'pending', 'P'), trigger: { kind: 'thread', value: thread.id }, seed: thread.text, from: 'thread',
      ...(thread.who?.id ? { person: thread.who.id } : {}), since: clock.dateKey(Math.floor((nowOf(env) ?? thread.since) / DAY)) };
    thread.pending = hook.id;
    env.play.pending = [...list(env.play.pending), hook];
  }
}

// Whether someone of that name (or that id, with that name) is on the scene.
function onScene(env, who) {
  const rows = env.state['0'] || {};
  const row = rows[who.id];
  if (row && (!who.name || rowName(row) === who.name)) return true;
  return Boolean(who.name) && Object.values(rows).some(each => each && rowName(each) === who.name);
}

// Pay a story commission when its existing matter actually closes. The check sets the pay,
// using the same range as posted work. A repeated completion cannot produce a second payment.
function bountyOf(env, finished, claim) {
  if (!['成功', '大成功'].includes(claim?.outcome)) return null;
  const matches = finished.filter(({ thread, status }) => status === 'completed' && !thread.followUp
    && /差事|交差|悬赏|赏金|赏格|酬劳|报酬/.test(plain(thread.text)) && atPlace(env, thread.place)
    && (!thread.who || (onScene(env, thread.who) && (!claim.target || claim.target === thread.who.id))));
  if (matches.length !== 1) return null;
  const [{ thread }] = matches;
  const player = env.state['0']?.B1;
  const before = player ? mechanics.stonesOf(player) : null;
  const pay = data('jobs').pay;
  const tier = require('./goods.cjs').tierOf(mechanics.parseRealm(plain(player?.['2'])).major);
  const [low, high] = pay[tier] || pay.default;
  const amount = claim.outcome === '大成功' ? high : low;
  if (before === null || !Number.isSafeInteger(before + amount)) return null;
  return { thread: thread.id, before, after: before + amount, amount };
}

// The open threads the player sees to in this beat, inside their time (or with none): their person
// on the scene with the player at their place, or, with no person, the player at their spot. The
// lapse of one of them is no miss.
function attend(env) {
  const now = nowOf(env);
  if (now === null) return;
  const spot = places.readWhere(mechanics.placeOf(env.state) || '').spot || '';
  for (const thread of open(env)) {
    const when = windowOf(thread);
    if (thread.attended || !atPlace(env, thread.place) || (when && (now < when.from || now > when.to))) continue;
    const met = thread.who ? onScene(env, thread.who)
      : Boolean(plain(thread.spot) && spot && (spot.includes(plain(thread.spot)) || plain(thread.spot).includes(spot)));
    if (met) thread.attended = true;
  }
}

function fired(env, id) {
  const thread = threadOf(env, id);
  if (!thread) return null;
  const person = presentOf(env, thread);
  take(env, id);
  return { cause: dueOf(thread), thread: { id, text: thread.text, ...(thread.spot ? { spot: thread.spot } : {}) },
    ...(person ? { person } : {}) };
}

// The first thread with a time at this place whose time begins inside a stretch of `minutes` from
// now, its item in the bag (the stretch stops there), or null.
function timed(env, minutes) {
  const now = nowOf(env);
  if (now === null) return null;
  const found = open(env).filter(thread => !thread.attended && windowOf(thread) && atPlace(env, thread.place) && thread.when.from > now
    && thread.when.from - now <= minutes && (!thread.item || bagHas(env, thread.item)))
    .sort((a, b) => a.when.from - b.when.from)[0];
  if (!found) return null;
  const at = found.when.from - now;
  const person = presentOf(env, found);
  return { minutes: at, day: Math.max(1, Math.ceil(at / DAY)), origin: 'thread', cause: dueOf(found),
    event: { kind: 'pending', id: found.pending, from: 'thread', trigger: 'thread',
      thread: { id: found.id, text: found.text, ...(found.spot ? { spot: found.spot } : {}) }, ...(person ? { person } : {}) } };
}

function past(thread, now) {
  return now > deadline(thread) || Boolean(windowOf(thread) && now >= thread.when.to);
}

function sweep(env) {
  const now = nowOf(env);
  if (now === null) return [];
  reopen(env);
  const gone = listed(env).filter(thread => !thread.taken && past(thread, now));
  for (const thread of gone) {
    if (!thread.followUp) archiveMatter(env, thread, 'expired', '', thread.expires);
    drop(env, thread.id);
    // one the player saw to is no miss: it goes without a word
    if (thread.attended || thread.completed) continue;
    chronicle.write(env, thread.followUp ? 'threadLetGo' : 'threadLapse',
      { 事: plain(thread.text), 名: plain(thread.who?.name) || RULES.someone }, thread.expires);
  }
  return gone;
}

// Whether the player's words carry on a live or under-way thread: they name its person, or its
// spot (three characters of it running, 落雁坡 of 城西二十里落雁坡破庙). pending.cjs holds a `now`
// event back for the scene such words open.
function carries(env, words) {
  const said = plain(words ?? '').replace(/\s/g, '');
  if (!said) return false;
  const now = nowOf(env);
  const threes = text => new Set([...text].slice(2).map((char, index) => [...text].slice(index, index + 3).join('')));
  const told = threes(said);
  return listed(env).filter(each => each.taken || now === null || live(env, now).includes(each)).some(each => {
    const name = plain(each.who?.name);
    if (name && said.includes(name)) return true;
    const spot = plain(each.spot).replace(/\s/g, '');
    return [...threes(spot)].some(three => told.has(three));
  });
}

// ---------------------------------------------------------------- the view

function rowOf(thread) {
  const when = windowOf(thread);
  return {
    id: thread.id, text: plain(thread.text),
    ...(thread.who?.id ? { who: { id: String(thread.who.id), name: plain(thread.who.name) || String(thread.who.id) } } : {}),
    place: plain(thread.place), ...(plain(thread.spot) ? { spot: plain(thread.spot) } : {}),
    ...(when ? { when: { from: timeOf(when.from), to: timeOf(when.to), text: windowText(when) } } : {}),
    ...(plain(thread.item) ? { item: plain(thread.item) } : {}),
    since: timeOf(thread.since), ...(isTime(thread.expires) ? { expires: timeOf(thread.expires) } : {}), from: plain(thread.from),
  };
}

function view(env) {
  const now = nowOf(env);
  return open(env).filter(each => plain(each.text) && isTime(each.since) && (now === null || !past(each, now)))
    .sort((a, b) => deadline(a) - deadline(b)).map(rowOf);
}

// ---------------------------------------------------------------- the op and the verb

async function op(env, args) {
  if (String(args?.action ?? '') !== 'add') return env.refuse(RULES.refused.op);
  const before = JSON.stringify(env.play.threads ?? null);
  reopen(env);
  const old = list(args.settle).map(id => ({ id, status: 'completed' }));
  const completed = updateMatters(env, [...list(args.updates), ...old]);
  const bounty = bountyOf(env, completed, args.bounty);
  const namedTasks = new Set(completed.filter(({ thread, status }) => !thread.followUp
    && status === 'completed').map(({ thread }) => plain(thread.text)));
  const moves = [...namedTasks].flatMap(task => clocks.react(env, { kind: 'task', task }));
  const seen = new Set();
  for (const change of list(args.clockTasks)) {
    const { id, task } = change || {};
    const key = JSON.stringify([id, task]);
    if (seen.has(key) || namedTasks.has(task) || typeof id !== 'string' || !/^K\d+$/.test(id)) continue;
    seen.add(key);
    moves.push(...clocks.react(env, { kind: 'task', task, clock: id }));
  }
  const settled = completed.map(({ thread, status }) => ({ id: thread.id, text: plain(thread.text),
    ...(status !== 'completed' ? { status } : {}) }));
  attend(env);
  const { added, dropped } = add(env, args.threads, { from: args.from, followUp: args.followUp,
    settledPeople: completed.map(({ thread }) => thread.who).filter(Boolean) });
  const shown = added.map(rowOf);
  const result = { threads: { added: shown, dropped, settled } };
  const fulfilled = require('./karma.cjs').reconcile(env);
  if (JSON.stringify(env.play.threads ?? null) === before && !dropped.length && !moves.length && !fulfilled.length) return result;
  await env.settle({ kind: 'thread', ok: true, hidden: !moves.length && !fulfilled.length, source: 'engine',
    commands: bounty ? `add("B1",{"26":"${bounty.after}"})` : '',
    owns: { ...ownsNothing(), currency: !!bounty }, ...(bounty ? { bounty } : {}),
    thread: { added: shown, dropped, settled },
    ...(moves.length ? { clocks: moves } : {}),
    summary: [...settled.map(each => fill(RULES[each.status] || RULES.settled, { 事: each.text })),
      ...fulfilled.map(entry => `已履行对${entry.who.name}的承诺「${entry.what}」`),
      ...added.map(each => fill(RULES.noted, { 事: each.text })),
      ...moves.map(each => each.gone ? `「${each.name}」平息` : `「${each.name}」退至${each.after}格`),
      ...dropped.map(each => fill(RULES.notNoted, { 事: each.text || '（空）', 因: each.why }))].join('；') || RULES.seen });
  return result;
}

function follow(env, verb, upTo = null) {
  const id = plain(verb.id ?? '');
  if (!id) return { refused: RULES.refused.id };
  const thread = threadOf(env, id);
  if (!thread) return { refused: RULES.refused.none };
  const why = blocked(env, thread) || require('./rewards.cjs').blockedFor(env, RULES.label);
  if (why) return { refused: why };
  const now = nowOf(env);
  const minutes = RULES.followMinutes;
  // a real interruption on the way cuts it short: nothing is taken up
  const short = upTo !== null && upTo < minutes;
  const spot = plain(thread.spot) || plain(thread.place);
  const person = presentOf(env, thread);
  const receipt = { kind: 'follow', ok: true, source: 'verb', thread: { id, text: thread.text, pending: thread.pending },
    commands: '', owns: ownsNothing(), summary: '' };
  return {
    minutes: short ? upTo : minutes, receipt,
    preview: { ok: true, minutes, ends: clock.dateOf(now + minutes), formula: [],
      lines: [fill(RULES.preview, { 处: spot, 事: plain(thread.text), 时长: chronicle.spanText(minutes) })] },
    line: ['follow', { 地点: plain(thread.place), 事: plain(thread.text) }],
    finish: settled => {
      if (short) {
        settled.summary = `${fill(RULES.short, { 事: plain(thread.text) })}；时间 ${settled.time.before}→${settled.time.after}`;
        return;
      }
      take(env, id);
      settled.interruption = { origin: 'thread', cause: causeOf(thread), day: 1, date: clock.dateOf(nowOf(env)), minutes,
        thread: { id, text: thread.text, ...(thread.spot ? { spot: thread.spot } : {}) }, ...(person ? { visit: person } : {}) };
      settled.summary = `${fill(RULES.summary, { 事: plain(thread.text) })}；时间 ${settled.time.before}→${settled.time.after}`;
    },
  };
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  verbs.VERBS.follow = follow;
  // a scene that closes, whatever closes it, gives back the threads it took up
  const scene = require('./scene.cjs');
  const closed = scene.hooks.closed;
  scene.hooks.closed = env => { closed(env); reopen(env); };
}

module.exports = { RULES, deadline, add, staying, holds, take, drop, reopen, attend, carries, fired, causeFor, timed, sweep, view, op,
  install, timeOf, hourText, minutesOf, readWhen };
