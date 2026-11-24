'use strict';
/* The chronicle (年谱): one line for each thing that happened, written by the engine from the
 * templates of content/life/chronicle.json, never by the model (玩法设计第二、四节).
 *
 * line(env, kind, values, at?, key?) → { kind, date, text, line }
 *   kind    a key of the file's templates; `values` fills its {名}. A [bracketed] part is left out
 *           when a value in it is empty; any other empty value is a mistake and throws (fill).
 *   date    dateOf(at): the day it happened, { text: "正月初四", year, month, day }; `at` is a
 *           moment in minutes on the clock, by default the clock now
 *   text    the template filled: "神手谷。静候五日。"
 *   line    the whole line, the file's `line` with the date: "正月初四　神手谷。静候五日。"
 *   key     what repeats: lines with the same key are one thing happening again (a fixed event of
 *           the calendar opening, a clock moving the same way), merged when an op writes too many
 *           lines (cap); none for a line that never repeats. A keyed line keeps its values
 * write(env, kind, values, at?, key?) → the same line, appended to env.chronicle, which the op
 *   returns after cap. A line about a pressure clock also carries `clock`: { name, size, value },
 *   the clock as that move left it (clocks.cjs; play_models.ClockMark); a merged line carries the
 *   last one's.
 * cap(lines) → an op's lines as it returns them: in date order (stable), and at most the file's
 *   limits.linesPerOp: past that, the lines of each repeating thing become one (the file's
 *   `repeats`: 其间春汀集开了九次。, dated on the last of them), and what is still too much
 *   becomes one line of `rest` (余事若干。).
 * spanText(minutes) → a stretch of time as the chronicle writes it: 一日, 四十五日, 一年一个月又十日,
 *   三个时辰 (the file's spans).
 * placeName(state) → where the player is, as the status bar reads the time row
 *   (play_state.Location): the spot (神手谷), else the area, else the region; "" when none.
 * numeral(n) → a whole number in Chinese: 四十五, 一百零一; count(n) the same with 两 for two.
 * fill(template, values) fills any template by the same rule (a clock's note, a rule's why).
 */
const mechanics = require('../mechanics.cjs');
const { data } = require('./data.cjs');
const { dateOf } = require('./clock.cjs');

const CHRONICLE = data('chronicle');
const SPANS = CHRONICLE.spans;
const CALENDAR = mechanics.CULTIVATION.calendar;
const DIGITS = '零一二三四五六七八九';
const PLACES = ['千', '百', '十', ''];

// 1 to 9999 written out in full: 一千零一十, 一十五.
function group(n) {
  let text = '', gap = false;
  String(n).padStart(4, '0').split('').forEach((digit, place) => {
    if (digit === '0') { gap = text !== ''; return; }
    text += (gap ? '零' : '') + DIGITS[digit] + PLACES[place];
    gap = false;
  });
  return text;
}

function numeral(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`写不成中文数字：${n}`);
  if (n < 10) return DIGITS[n];
  if (n < 20) return '十' + (n % 10 ? DIGITS[n % 10] : '');
  if (n < 10000) return group(n);
  const rest = n % 10000;
  return numeral(Math.floor(n / 10000)) + '万' + (rest ? (rest < 1000 ? '零' : '') + group(rest) : '');
}

// A count of something: 两 for two (两日, 两个月), the numeral otherwise.
const count = n => (n === 2 ? SPANS.two : numeral(n));

// Hours as 时辰, two hours each: 三个时辰, 半个时辰, 一个半时辰.
function hoursText(hours) {
  if (hours === 1) return SPANS.half + SPANS.measure + SPANS.shichen;
  const whole = count(Math.floor(hours / 2)) + SPANS.measure;
  return whole + (hours % 2 ? SPANS.half : '') + SPANS.shichen;
}

function spanText(minutes) {
  const dayMinutes = CALENDAR.hoursPerDay * 60;
  const days = Math.floor(minutes / dayMinutes), hours = Math.floor((minutes - days * dayMinutes) / 60);
  const yearDays = CALENDAR.daysPerMonth * CALENDAR.monthsPerYear;
  const units = days >= SPANS.daysAlone
    ? [[Math.floor(days / yearDays), SPANS.year], [Math.floor((days % yearDays) / CALENDAR.daysPerMonth), SPANS.month],
      [days % CALENDAR.daysPerMonth, SPANS.day]]
    : [[days, SPANS.day]];
  const parts = units.filter(([n]) => n).map(([n, unit]) => count(n) + unit);
  if (hours) parts.push(hoursText(hours));
  if (!parts.length) return SPANS.moment;
  return parts.length > 1 ? parts.slice(0, -1).join('') + SPANS.and + parts.at(-1) : parts[0];
}

function placeName(state) {
  const text = String(mechanics.clockRow(state)?.['0'] ?? '');
  const slash = text.indexOf('/');
  if (slash < 0) return '';
  const parts = text.slice(slash + 1).replace(/\|/g, ' ').split('/').map(part => part.trim());
  const clean = part => part.split(/\s+-?\d/)[0].split(/[（(]/)[0].trim();
  const spot = /[（(]\s*([^（）()]*?)\s*[）)]/.exec(parts[1] || '');
  return (spot ? spot[1] : clean(parts[2] || '')) || clean(parts[1] || '') || clean(parts[0]);
}

function fill(template, values) {
  const value = name => (values[name] === undefined || values[name] === null ? '' : String(values[name]));
  const names = part => [...part.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
  return template
    .replace(/\[([^[\]]*)\]/g, (_, part) => (names(part).every(value) ? part : ''))
    .replace(/\{([^{}]+)\}/g, (_, name) => {
      if (!value(name)) throw new Error(`模板「${template}」缺少「${name}」`);
      return value(name);
    });
}

const whole = (date, text) => fill(CHRONICLE.line, { 日期: date.text, 事: text });

function line(env, kind, values = {}, at = mechanics.readClock(env.state)?.minutes, key = null) {
  if (!Object.hasOwn(CHRONICLE.templates, kind)) throw new Error(`没有「${kind}」这种年谱行`);
  if (!Number.isFinite(at)) throw new Error('年谱行要有日期：时间行里没有可识别的日期');
  const date = dateOf(at);
  const text = fill(CHRONICLE.templates[kind], values);
  return { kind, date, text, line: whole(date, text), ...(key ? { key, values } : {}) };
}

function write(env, kind, values, at, key) {
  const written = line(env, kind, values, at, key);
  env.chronicle.push(written);
  return written;
}

const dayOrder = line => (line.date.year * 100 + line.date.month) * 100 + line.date.day;

// One line for the lines of a repeating thing, dated on the last of them: {次} is how many there
// were, {共} the sum of their values' 数 (the steps a clock moved).
function merged(group) {
  const last = group.at(-1);
  const total = group.reduce((sum, each) => sum + (Number(each.values?.数) || 0), 0);
  const text = fill(CHRONICLE.repeats[last.kind], { ...last.values, 次: count(group.length), 共: count(total) });
  return { kind: last.kind, date: last.date, text, line: whole(last.date, text), count: group.length, ...(last.clock ? { clock: last.clock } : {}) };
}

function cap(lines) {
  const limit = CHRONICLE.limits.linesPerOp;
  let kept = [...lines].sort((a, b) => dayOrder(a) - dayOrder(b));
  if (kept.length > limit) {
    const groups = new Map();
    for (const each of kept) if (each.key && Object.hasOwn(CHRONICLE.repeats, each.kind)) groups.set(each.key, [...(groups.get(each.key) || []), each]);
    kept = kept.flatMap(each => {
      const group = each.key ? groups.get(each.key) : null;
      if (!group || group.length < 2) return [each];
      return each === group.at(-1) ? [merged(group)] : [];
    });
  }
  if (kept.length > limit) {
    const last = kept.at(-1);
    kept = [...kept.slice(0, limit - 1), { kind: 'rest', date: last.date, text: CHRONICLE.rest, line: whole(last.date, CHRONICLE.rest) }];
  }
  return kept.map(({ key: _key, values: _values, ...shown }) => shown);
}

module.exports = { line, write, cap, fill, spanText, placeName, numeral, count };
