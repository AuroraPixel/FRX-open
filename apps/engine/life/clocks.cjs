'use strict';
/* Pressure clocks (压力钟, 玩法设计第十节, plan item 15): something closing in, `value` of its `size`
 * steps filled; full, it happens. The vocabulary, the limit and the clocks the engine starts by
 * itself are content/life/clocks.json. A clock in frxPlay.clocks:
 *   { id: "K1", name, scope: { kind: place | region | self, value }, size, value,
 *     rises: [rule], falls: [rule], full: what happens when it fills, since, counted,
 *     count: { days, away }, filled: null | the day it filled, from: engine | director }
 *   rule      { kind, steps, days?, item?, stones?, person?, task?, clear? }, kinds from the file
 *   counted   the day up to which tick has counted days; count the days counted toward the next
 *             step of the `days` rise and of the `away` fall
 *
 * start(env, spec, why?, at?) → { clock } | { refused }: spec { name, scope, size, value?, rises,
 *   falls, full, from? } checked against the vocabulary (check); refused with a reason for the
 *   player when the spec is not one, or when limit clocks already run. Writes a chronicle line.
 * check(spec) → { clock } | { reason }: the spec as a clock would hold it (no id yet), or why not.
 * bump(env, id, n, why?, at?) → the change { id, name, before, after, full?, gone? } or null:
 *   n steps up (n > 0) or down; a full clock goes no further up; down to 0 takes the clock off.
 *   Reaching its size marks it filled and puts an event that happens now in frxPlay.pending
 *   ({ trigger: { kind: "now", value: id }, seed: full, from: "clock" }). Writes a chronicle line
 *   for every move, dated `at` (minutes; the clock now by default), `why` its reason.
 * react(env, event) → [change]: what the rules of every clock make of something the player did:
 *   event { kind: act | fumble | show | director | hand | bribe | settle | task, place?, item?,
 *   stones?, person?, task?, at? }; an inScope kind counts only for a clock whose scope holds at
 *   `place` (here.where; the player's place when omitted).
 * raiseFor(env, { kind, outcome, place, item? }) → [change]: an action card's result (the act op):
 *   a 大失败 is a fumble, an act kind is an act, an item shown is a show; then the clocks of
 *   started whose action, outcome and place kind match are started, one per place, a refusal
 *   coming back as { name, refused }. `place` is what the places module reads the place as.
 * clockStepsFor(env, { targetId, place }) → { clockSteps, clockName, clockId }: the clock a card
 *   bears on (a rule names its target, or its scope holds where it is played; not self), the
 *   fullest; 0, '' and null when none. Spread into the pricing context (actions.cjs ctx).
 * tick(env, month): the month step, before the calendar's: the days since `counted`, in scope or
 *   away at the player's place, turned into steps; the days of a `days` rise at the clock's pace
 *   (paceOf(env, found): hooks.pace, 1 unless something slows it: a 隐匿 array where the clock is
 *   aimed, arrays.cjs, plan item 43), the count kept to the hundredth.
 * view(env) → [{ id, name, size, value, note }]: note is how to turn it back (its falls).
 */
const mechanics = require('../mechanics.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const here = require('./here.cjs');
const { data } = require('./data.cjs');
const { list, nextId } = require('./play.cjs');

const RULES = data('clocks');
const hooks = { pace: () => 1 };
const paceOf = (env, found) => hooks.pace(env, found) ?? 1;
const SIDES = [['rises', RULES.rises], ['falls', RULES.falls]];
const NAMES = { rises: '涨法', falls: '消法' };
const text = (value, most) => (typeof value === 'string' ? value.trim().slice(0, most) : '');
const whole = (value, low, high) => Number.isSafeInteger(Number(value)) && Number(value) >= low && Number(value) <= high;

// ---------------------------------------------------------------- checking a clock

function checkRule(entry, side, size, scope) {
  const vocabulary = side === 'rises' ? RULES.rises : RULES.falls;
  const kind = text(entry?.kind, 20);
  if (!Object.hasOwn(vocabulary, kind)) return { reason: `${NAMES[side]}「${kind}」不在词表里` };
  if (kind === 'away' && scope.kind === 'self') return { reason: '只冲着主角的钟没有「离开范围」这一说' };
  const rule = { kind };
  for (const need of vocabulary[kind].needs || []) {
    const value = entry[need];
    if (need === 'days' ? !whole(value, 1, 360) : need === 'stones' ? !whole(value, 1, 1e9) : !text(value, 30)) {
      return { reason: `${NAMES[side]}「${vocabulary[kind].name}」缺少或写错了${need}` };
    }
    rule[need] = need === 'days' || need === 'stones' ? Number(value) : text(value, 30);
  }
  if (entry.steps !== undefined && !whole(entry.steps, 1, size)) return { reason: `${NAMES[side]}「${vocabulary[kind].name}」的格数不对` };
  rule.steps = entry.steps === undefined ? 1 : Number(entry.steps);
  if (side === 'falls' && (entry.clear ?? (entry.steps === undefined && vocabulary[kind].clear))) rule.clear = true;
  return { rule };
}

function check(spec) {
  const name = text(spec?.name, 12);
  if (!name) return { reason: '钟没有名字' };
  const scope = { kind: text(spec.scope?.kind, 10), value: text(spec.scope?.value, 20) };
  if (!Object.hasOwn(RULES.scopes, scope.kind)) return { reason: `「${name}」的范围只能是：${Object.values(RULES.scopes).join('、')}` };
  if (scope.kind === 'self') scope.value = '';
  else if (!scope.value) return { reason: `「${name}」没有写明范围在哪` };
  const size = Number(spec.size);
  if (!RULES.sizes.includes(size)) return { reason: `「${name}」的格数只能是${RULES.sizes.join('、')}` };
  const value = spec.value === undefined ? 0 : Number(spec.value);
  if (!whole(value, 0, size - 1)) return { reason: `「${name}」起于几格要在0到${size - 1}之间` };
  const full = text(spec.full, 60);
  if (!full) return { reason: `「${name}」没有写满了发生什么` };
  const rules = {};
  for (const [side] of SIDES) {
    if (!list(spec[side]).length) return { reason: `「${name}」没有写${side === 'rises' ? '怎么涨' : '怎么消'}` };
    rules[side] = [];
    for (const entry of list(spec[side])) {
      const checked = checkRule(entry, side, size, scope);
      if (checked.reason) return { reason: `「${name}」的${checked.reason}` };
      rules[side].push(checked.rule);
    }
  }
  return { clock: { name, scope, size, value, rises: rules.rises, falls: rules.falls, full } };
}

// ---------------------------------------------------------------- moving a clock

const dayAt = (env, at) => Math.floor((Number.isFinite(at) ? at : mechanics.readClock(env.state).minutes) / clock.DAY_MINUTES);

// A line about a clock carries the clock as the move left it, { name, size, value }: the annals
// draw its pips beside the line (play_models.ClockMark, plan item 18).
function marked(written, found, value = found.value) {
  written.clock = { name: found.name, size: found.size, value };
  return written;
}

function start(env, spec, why = '', at = undefined) {
  const checked = check(spec);
  if (checked.reason) return { refused: checked.reason };
  const running = list(env.play.clocks);
  if (running.length >= RULES.limit) return { refused: `已有${chronicle.numeral(running.length)}口钟，再起不了「${checked.clock.name}」` };
  const day = clock.dateKey(dayAt(env, at));
  const made = { id: nextId(env, 'clock', 'K'), ...checked.clock, since: day, counted: day, count: { days: 0, away: 0 }, filled: null,
    from: spec.from === 'director' ? 'director' : 'engine' };
  env.play.clocks = [...running, made];
  marked(chronicle.write(env, 'clockStart', { 缘由: why, 钟: made.name }, at), made);
  return { clock: made };
}

function markFull(env, found, at) {
  found.filled = clock.dateKey(dayAt(env, at));
  env.play.pending = [...list(env.play.pending),
    { id: nextId(env, 'pending', 'P'), trigger: { kind: 'now', value: found.id }, seed: found.full, from: 'clock', since: found.filled }];
  // the template puts its own stop after what happens (the director's words often end in one)
  marked(chronicle.write(env, 'clockFull', { 钟: found.name, 满: String(found.full ?? '').trim().replace(/[。！？.!?；;，,\s]+$/, '') }, at), found);
}

function bump(env, id, n, why = '', at = undefined) {
  const found = list(env.play.clocks).find(each => each.id === id);
  if (!found || !Number.isSafeInteger(n) || n === 0 || (n > 0 && found.value >= found.size)) return null;
  const before = found.value, after = Math.max(0, Math.min(found.size, before + n));
  found.value = after;
  if (before === found.size && after < before) {
    // A clock turned back before its consequence fires must not leave that event queued.
    env.play.pending = list(env.play.pending).filter(hook => !(hook?.from === 'clock'
      && hook.trigger?.kind === 'now' && hook.trigger.value === found.id));
  }
  const values = { 缘由: why, 钟: found.name, 格: chronicle.count(Math.abs(after - before)), 数: Math.abs(after - before) };
  // Turned back to nothing (or turned back while at nothing), the clock is off the board.
  if (after === 0) {
    env.play.clocks = list(env.play.clocks).filter(each => each !== found);
    marked(chronicle.write(env, 'clockGone', values, at), found, 0);
    return { id, name: found.name, before, after, gone: true };
  }
  if (after === before) return null;
  const up = after > before;
  marked(chronicle.write(env, up ? 'clockUp' : 'clockDown', values, at, `clock:${id}:${up ? 'up' : 'down'}`), found);
  if (after === found.size) markFull(env, found, at);
  else found.filled = null;
  return { id, name: found.name, before, after, ...(after === found.size ? { full: true } : {}) };
}

// ---------------------------------------------------------------- what the player does

function personName(env, id) {
  const row = env.state['0']?.[id] || env.biographies?.[id];
  const name = String(row?.['1'] ?? '').replace(/<[^>]*>/g, '').split('|')[0].trim();
  return name || id;
}

// What a rule says, for a line's reason and a clock's note.
function say(env, found, rule, side, days) {
  const vocabulary = side === 'rises' ? RULES.rises : RULES.falls;
  return chronicle.fill(vocabulary[rule.kind].say, {
    范围: found.scope.value, 日: chronicle.numeral(days ?? rule.days ?? 0), 物: rule.item,
    灵石: rule.stones ? chronicle.numeral(rule.stones) : '', 人: rule.person ? personName(env, rule.person) : '', 事: rule.task,
  });
}

const sameName = (a, b) => typeof a === 'string' && typeof b === 'string' && !!a && (a === b || a.includes(b));

function answers(env, rule, event) {
  if (rule.kind === 'show' || rule.kind === 'hand') return sameName(event.item, rule.item);
  if (rule.kind === 'bribe') return Number(event.stones) >= rule.stones;
  if (rule.kind === 'settle') return event.person === rule.person || personName(env, event.person) === rule.person;
  if (rule.kind === 'task') return event.task === rule.task;
  return true;
}

function react(env, event = {}) {
  const place = here.where(env, event.place);
  const changes = [];
  for (const found of list(env.play.clocks)) {
    if (event.clock && event.clock !== found.id) continue;
    for (const [side, vocabulary] of SIDES) {
      for (const rule of list(found[side])) {
        if (rule.kind !== event.kind || (vocabulary[rule.kind]?.inScope && !here.within(found.scope, place)) || !answers(env, rule, event)) continue;
        const n = side === 'rises' ? rule.steps : rule.clear ? -found.value : -rule.steps;
        const change = bump(env, found.id, n, say(env, found, rule, side), event.at);
        if (change) changes.push(change);
        if (change?.gone) break;
      }
    }
  }
  return changes;
}

function raiseFor(env, { kind = '', outcome = '', place, item } = {}) {
  const changes = [];
  if (outcome === '大失败') changes.push(...react(env, { kind: 'fumble', place }));
  if (RULES.rises.act.kinds.includes(kind)) changes.push(...react(env, { kind: 'act', place }));
  if (item) changes.push(...react(env, { kind: 'show', place, item }));
  const at = here.where(env, place);
  for (const rule of RULES.started) {
    if (!rule.kinds.includes(kind) || rule.outcome !== outcome || !rule.placeKinds.includes(at.kind) || !at.name) continue;
    if (list(env.play.clocks).some(each => each.name === rule.clock.name && each.scope.value === at.name)) continue;
    const started = start(env, { ...rule.clock, scope: { kind: rule.clock.scope, value: at.name } }, chronicle.fill(rule.say, { 范围: at.name, 行动: kind }));
    changes.push(started.clock
      ? { id: started.clock.id, name: started.clock.name, before: 0, after: started.clock.value, started: true }
      : { name: rule.clock.name, refused: started.refused });
  }
  return changes;
}

function clockStepsFor(env, { targetId = '', place } = {}) {
  const at = here.where(env, place);
  let best = null;
  for (const found of list(env.play.clocks)) {
    const about = !!targetId && [...list(found.rises), ...list(found.falls)]
      .some(rule => rule.person && (rule.person === targetId || rule.person === personName(env, targetId)));
    const there = found.scope.kind !== 'self' && here.within(found.scope, at);
    if ((about || there) && (!best || found.value > best.value)) best = found;
  }
  return best ? { clockSteps: best.value, clockName: best.name, clockId: best.id } : { clockSteps: 0, clockName: '', clockId: null };
}

// ---------------------------------------------------------------- the month and the view

// Days in scope bring the `days` rise closer, days away the `away` fall; a return resets the away count.
function countDays(env, found, side, kind, days, at) {
  const rule = list(found[side]).find(each => each.kind === kind);
  if (!rule) return;
  const key = kind === 'days' ? 'days' : 'away';
  const pace = kind === 'days' ? paceOf(env, found) : 1;
  found.count[key] = Math.round(((Number(found.count[key]) || 0) + days * pace) * 100) / 100;
  const times = Math.floor(found.count[key] / rule.days);
  if (!times) return;
  found.count[key] -= times * rule.days;
  bump(env, found.id, (side === 'rises' ? 1 : -1) * times * rule.steps, say(env, found, rule, side, times * rule.days), at);
}

function tick(env, month) {
  const upto = Math.floor(month.minutes / clock.DAY_MINUTES);
  const place = here.where(env);
  for (const found of list(env.play.clocks)) {
    const from = clock.dayOfDate(found.counted) ?? upto;
    if (upto <= from) continue;
    found.counted = clock.dateKey(upto);
    found.count = found.count && typeof found.count === 'object' ? found.count : { days: 0, away: 0 };
    if (here.within(found.scope, place)) {
      found.count.away = 0;
      countDays(env, found, 'rises', 'days', upto - from, month.minutes);
    } else countDays(env, found, 'falls', 'away', upto - from, month.minutes);
  }
}

function note(env, found) {
  const words = RULES.noteWords;
  return list(found.falls).map(rule => say(env, found, rule, 'falls') + words.join
    + (rule.clear ? words.clear : chronicle.fill(words.back, { 格: chronicle.count(rule.steps) }))).join(words.between);
}

function view(env) {
  return list(env.play.clocks).map(found => ({ id: found.id, name: found.name, size: found.size, value: found.value, note: note(env, found) }));
}

module.exports = { RULES, check, start, bump, react, raiseFor, clockStepsFor, tick, view, hooks, paceOf };
