'use strict';
/* 章回: the book's volumes and chapters (玩法设计第十一节「怎么讲：卷、回、年谱」; plan item 38). A scene
 * is one 回 and an annals turn is none; a volume (卷) closes on a major gate passed or a one-off
 * great event's aftermath, with a closing page; a stretch of years comes out with 出关见闻. The
 * rules and words are content/life/book.json.
 *
 * frxPlay.book { volume, chapter, from, notes: [{ date, text }], volumes: [volume], turned: [ids] }
 *   volume   the volume under way (1 at first); chapter the last 回 opened; from the day it began
 *   notes    the annals lines of the volume under way its closing page will pick (annals.kinds)
 *   volumes  the closed ones: { no, from, to, cause: { kind: gate | event, name }, annals, text? }
 *   turned   the great events (saga.json) whose aftermath has turned a volume
 * opened(env) → { volume, chapter }: a scene opens a new 回 (scene.cjs keeps it on the scene).
 * couplet(text) → { ok, text } | { ok: false, reason }: a 回目 checked: two lines of couplet.lengths
 *   characters (汉字 only), the same length, apart by a space; kept with a full-width one.
 * closed(env, scene, given) → { chapter, couplet, fallback?, given?, reason? }: the close card's 回目:
 *   the model's when it holds, else couplet.fallback ({地点}{戏名}) with why (scene.cjs).
 * turn(env, cause) → the closed volume: the volume under way closes with the notes as its annals
 *   (this op's lines first taken in), and the next opens today.
 * op "book" { no, text } (words): the model's 卷末语 for a closed volume (volume.most characters at
 *   most), settled as a receipt "volume" { volume: { no, from, to, cause, annals, text?, next } }.
 * settle(env, op), after an op that may do it (watches: verb, act, scene, move, travel): the annals
 *   lines of the op taken into the notes; a one-off great event (saga.json: no calendar, not a stub)
 *   whose aftermath was done turns a volume, its page's words the aftermath's line (a receipt
 *   "volume"); a verb whose stretch was emerge.years or more comes out with 出关见闻, a receipt
 *   "emerge" { emerge: { years, from, to, lines: [{ date, text }] } }: the calendar's worth-noting
 *   fixed events that passed in it (one line an event, with how many times), the people's news
 *   (frxPlay.news) and the world line's lines of the stretch, in their order, emerge.most at most.
 * view(env) → { volume, chapter }: the state view's play.book.
 */
const { plain } = require('../item-use.cjs');
const clock = require('./clock.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');

const RULES = data('book');
const ONCE = data('saga').events.filter(event => !event.calendar && !event.stub);
const DAY = clock.DAY_MINUTES;
const MONTH_DAYS = clock.CALENDAR.daysPerMonth;
const YEAR_DAYS = MONTH_DAYS * clock.CALENDAR.monthsPerYear;
const HAN = /^[一-鿿]+$/;

const cut = (value, most) => [...plain(value)].slice(0, most).join('');
const dateOfKey = key => (clock.dayOfDate(key) === null ? null : clock.dateOf(clock.dayOfDate(key) * DAY));
const dayOfLine = date => (date.year - 1) * YEAR_DAYS + (date.month - 1) * MONTH_DAYS + (date.day - 1);

// The book as frxPlay keeps it (a copy, defaults filled); written back only when it changes.
function read(env) {
  const was = env.play?.book && typeof env.play.book === 'object' ? env.play.book : {};
  return {
    volume: Number.isSafeInteger(was.volume) && was.volume > 0 ? was.volume : 1,
    chapter: Number.isSafeInteger(was.chapter) && was.chapter >= 0 ? was.chapter : 0,
    from: typeof was.from === 'string' ? was.from : null,
    notes: list(was.notes), volumes: list(was.volumes), turned: list(was.turned),
  };
}

function opened(env) {
  const book = read(env);
  env.play.book = { ...book, chapter: book.chapter + 1, from: book.from || clock.dateKey(clock.today(env)) };
  return { volume: book.volume, chapter: book.chapter + 1 };
}

function couplet(text) {
  const said = RULES.refused;
  const raw = plain(text);
  if (!raw) return { ok: false, reason: said.none };
  const lines = raw.split(/[\s　]+/u).filter(Boolean);
  if (lines.length !== 2) return { ok: false, reason: lines.length === 1 && !HAN.test(lines[0]) ? said.chars : said.lines };
  if (!lines.every(line => HAN.test(line))) return { ok: false, reason: said.chars };
  const [first, second] = lines.map(line => [...line].length);
  if (!RULES.couplet.lengths.includes(first) || !RULES.couplet.lengths.includes(second)) return { ok: false, reason: said.length };
  if (first !== second) return { ok: false, reason: said.same };
  return { ok: true, text: lines.join(RULES.couplet.separator) };
}

function closed(env, scene, given) {
  const checked = couplet(given);
  if (checked.ok) return { chapter: scene.chapter ?? null, couplet: checked.text };
  const place = places.placeFacts(env).place || chronicle.placeName(env.state) || '';
  return { chapter: scene.chapter ?? null, couplet: chronicle.fill(RULES.couplet.fallback, { 地点: place, 戏名: scene.title }),
    fallback: true, ...(plain(given) ? { given: cut(given, 40) } : {}), reason: checked.reason };
}

// The op's annals lines a closing page picks, into the notes (each once).
function absorb(env) {
  const seen = env.bookSeen || (env.bookSeen = new Set());
  const fresh = list(env.chronicle).filter(line => !seen.has(line) && RULES.annals.kinds.includes(line.kind));
  if (!fresh.length) return;
  for (const line of fresh) seen.add(line);
  const book = read(env);
  env.play.book = { ...book, notes: [...book.notes, ...fresh.map(line => ({ date: line.date, text: line.text }))].slice(-RULES.annals.most) };
}

function turn(env, cause) {
  absorb(env);
  const book = read(env);
  const today = clock.dateKey(clock.today(env));
  const volume = { no: book.volume, from: book.from || today, to: today, cause, annals: book.notes };
  env.play.book = { ...book, volume: book.volume + 1, from: today, notes: [], volumes: [...book.volumes, volume] };
  return volume;
}

const shown = volume => ({ no: volume.no, from: dateOfKey(volume.from), to: dateOfKey(volume.to), cause: volume.cause,
  annals: volume.annals, ...(volume.text ? { text: volume.text } : {}), next: volume.no + 1 });

// A closed volume's page, with its words, as a receipt.
async function page(env, no, text) {
  const book = read(env);
  const at = book.volumes.findIndex(each => each.no === no);
  if (at < 0) return null;
  const volume = { ...book.volumes[at], ...(cut(text, RULES.volume.most) ? { text: cut(text, RULES.volume.most) } : {}) };
  env.play.book = { ...book, volumes: book.volumes.map((each, n) => (n === at ? volume : each)) };
  return env.settle({ kind: 'volume', ok: true, source: 'engine', volume: shown(volume), commands: '', owns: ownsNothing(),
    summary: `第${chronicle.numeral(no)}卷终` + (volume.text ? `：${volume.text}` : '') });
}

async function words(env, args) {
  const no = Number(args.no);
  if (!Number.isSafeInteger(no) || !read(env).volumes.some(each => each.no === no)) return env.refuse(`没有第${String(args.no ?? '').slice(0, 4)}卷`);
  const made = await page(env, no, args.text);
  return { volume: made.volume };
}

// ---------------------------------------------------------------- after an op

const WATCHED = new Set(['verb', 'act', 'scene', 'move', 'travel']);
const watches = op => WATCHED.has(op);

// What the world did while the player was away, `from` (exclusive) to `to` (inclusive), in days.
function emerged(env, from, to) {
  const lines = [];
  for (const event of calendar.CALENDAR.fixed) {
    if (event.worth === false) continue;
    const days = calendar.openings(event, from + 1, to + 1);
    if (!days.length) continue;
    const where = event.place && !event.name.includes(event.place) ? event.place : '';
    const text = `${where}${event.name}${event.opens || ''}`;
    lines.push({ day: days.at(-1), text: days.length > 1 ? chronicle.fill(RULES.emerge.repeat, { 事: text, 次: chronicle.numeral(days.length) }) : text });
  }
  for (const news of list(env.play.news)) {
    const day = clock.dayOfDate(news?.date);
    if (day !== null && day > from && day <= to && news.text) lines.push({ day, text: plain(news.text) });
  }
  for (const line of list(env.chronicle)) if (line.kind === 'saga') lines.push({ day: dayOfLine(line.date), text: line.text });
  return lines.sort((a, b) => a.day - b.day).slice(-RULES.emerge.most).map(({ day, text }) => ({ date: clock.dateOf(day * DAY), text }));
}

async function settle(env, op) {
  const today = clock.today(env);
  if (today === null) return;
  absorb(env);
  for (const event of ONCE) {
    const done = env.play.world?.events?.[event.id]?.stages?.aftermath;
    if (!done || read(env).turned.includes(event.id)) continue;
    const book = read(env);
    env.play.book = { ...book, turned: [...book.turned, event.id] };
    const volume = turn(env, { kind: 'event', name: event.name });
    await page(env, volume.no, event.aftermath?.line || '');
  }
  if (op !== 'verb') return;
  const stretch = Math.max(0, ...env.receipts.filter(receipt => receipt.ok && Number.isFinite(receipt.time?.minutes)).map(receipt => receipt.time.minutes));
  if (stretch < RULES.emerge.years * YEAR_DAYS * DAY) return;
  const from = today - Math.round(stretch / DAY);
  const lines = emerged(env, from, today);
  const years = Math.floor(stretch / (YEAR_DAYS * DAY));
  await env.settle({ kind: 'emerge', ok: true, source: 'engine',
    emerge: { years, from: clock.dateOf(from * DAY), to: clock.dateOf(today * DAY), lines }, commands: '', owns: ownsNothing(),
    summary: `出关见闻（${chronicle.numeral(years)}年）：` + (lines.map(line => line.text).join('；') || '世上没有什么大事') });
}

function view(env) {
  const book = read(env);
  return { volume: book.volume, chapter: book.chapter };
}

module.exports = { RULES, opened, couplet, closed, turn, shown, words, watches, settle, view };
