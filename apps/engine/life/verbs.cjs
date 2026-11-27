'use strict';
/* The standing verbs (常驻指令, 玩法设计第四节): each settles at once, writes its chronicle line and
 * calls no model.
 *
 *   op "verb"     args: the turn's verb, { kind, ... }. VERBS[kind] plans it; whether and when the
 *                 stretch is broken off is decided then (interrupt.stop, item 16), and a stretch
 *                 broken off is planned again for the time up to the break, so it gains what that
 *                 shorter stretch gains. Then it is done: its chronicle line written (chronicle.write),
 *                 its receipt settled by advance, which moves the clock and settles the months
 *                 entered, and what the break leaves settled (interrupt.after). The receipt of a
 *                 stretch broken off carries `interruption` (interrupt.shown): { origin, cause, day,
 *                 date, minutes, clock?, event?, chance?, encounter? }, the origin and seed of the
 *                 scene the server opens next; encounter when the interruption in the wild became
 *                 one (hooks.broken, encounter.cjs). A steady verb (pending.STEADY: a gate's
 *                 attempt, a 悟得) is never broken off, nor previewed as at risk. Or the verb is
 *                 refused (env.refuse) and nothing is settled.
 *   op "preview"  args: the same verb. The same plan, cut at a forced stop (a clock filling, a
 *                 calendar entry due) as the verb would be, with nothing settled or written:
 *                 { preview } in the shape of play_models.VerbPreview (below).
 *   The lifespan's last day (clock.lifespanEnd, plan item 49) stops every stretch, whatever its
 *   length: a certain stop like a full clock's day, first on its day, and no scene opens from it
 *   (the receipt carries no interruption; the summary and the preview say 寿元用尽, and legacy.cjs
 *   settles the death after the op). It is the verbs' own, so a test's calm world keeps it. A verb
 *   that cannot be cut short there (a gate's attempt) is refused instead.
 *   list(env)     the verbs the view shows here and now (play_models.PlayVerb):
 *                 [{ kind, glyph, label, main?, off?, note? }], `off` with the reason in `note`.
 *                 Reads only env.state, env.ctx and env.play, so progress mode's env serves.
 *                 A verb verbs.json's `where` ties to venues or kinds of place (打探 to a 茶肆, a
 *                 坊市 or a 宗门; plan item 27) is listed only where the place has one of them
 *                 (places.cjs: the venues by its kind), and refused elsewhere.
 *
 * The verbs and their args beside kind:
 *   wait       days (whole, 1 or more) or until (a later day, "0001-03-03"): time passes. While
 *              injured it is 养伤 (injury.cjs, plan item 50's fixes): 气血 and 法力 come back by the
 *              day (injury.recovered) and nothing in the wild finds the player (injury.healing)
 *   cultivate  days, until or full (true: until progress is full, the lifespan ends or the month
 *              limit of one call is reached, whichever comes first; any stretch ends on the
 *              lifespan's last day, clock.lifespanEnd, plan item 49), and stones (true: spirit stones
 *              by the day). mechanics.cultivate settles it with the place's aura
 *              (places.placeFacts), 契合, 心境 (mind.factor: half below the realm's threshold, item
 *              36) and the bonus pool (speed.cjs). As the old rule has it, a
 *              stretch that fills progress ends there, the rest of it unspent. A stretch's gain is
 *              a whole point; the fraction left over waits in frxPlay.leftover and goes into the
 *              next stretch (mechanics.cultivate's carry), so a slow realm's year of under half a
 *              point still counts (the long playtest's 元婴 stood still for eight hundred years). Not at a gate
 *   rest       hours, 1 to 12 (content/life/verbs.json): mechanics.rest of the rest kind there,
 *              then the clock moves by the hours. 气血 back to full takes a lost fight's 重伤 off
 *              the status column, as 静候's 养伤 does (injury.unhurt)
 *
 * A plan: VERBS[kind](env, verb, upTo?) → { refused: reason } or
 *   { minutes, receipt, line, preview, finish? }
 *   minutes   the time it takes; `upTo` (minutes) cuts it shorter, for an interruption (below)
 *   receipt   its receipt with its own commands, not yet settled; advance adds the clock's
 *   line      [template, values] of its chronicle line (chronicle.cjs), dated the day it begins
 *   preview   what op preview gives for it
 *   at        where the stretch is spent, when not at the player's place (interrupt.monthly's
 *             `at`: a journey's road); place, what the time row writes after its date once it
 *             is done (clock.advance's `place`: a journey's end)
 *   finish    (receipt) => void or a promise, run (and awaited) once advance has settled the receipt:
 *             the summary's last words, or what follows the stretch (a hunt's fight, rewards.cjs)
 * Add a verb with one entry in VERBS and its glyph and label in content/life/verbs.json.
 *
 * The preview (play_models.VerbPreview; a key whose value would be null is left out):
 *   ok, and reason when it cannot be done now (then minutes is 0 and lines and formula are empty)
 *   minutes   the time it takes; ends the day it ends, { text, year, month, day } (clock.dateOf)
 *   lines     what happens, in order, in words ready to show
 *   progress  { before, after }: progress within the step (cultivating)
 *   realm     { before, after }: the realm with its layer, when it moves
 *   stones    the spirit stones it spends, when the verb spends them
 *   shortfall how many more stones the stretch would need, when they run short (the lines say
 *             how many days they last)
 *   formula   [{ label, value }]: cultivating's speed term by term; resting's recovery by the hour
 *   risk      the chance in percent that something comes in on the way (interrupt.view): 100 when
 *             a forced stop falls inside the stretch; the last line says it
 */
const mechanics = require('../mechanics.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const injury = require('./injury.cjs');
const interrupt = require('./interrupt.cjs');
const { ownsNothing } = require('./play.cjs');
const places = require('./places.cjs');
const speed = require('./speed.cjs');
const mind = require('./mind.cjs');
const { data } = require('./data.cjs');

const RULES = data('verbs');
const CULTIVATION = mechanics.CULTIVATION;
const ORDER = mechanics.COMBAT.realms.order;
const DAY = clock.DAY_MINUTES;
const TWO = data('chronicle').spans.two;
const LIFESPAN = data('legacy').stop;

const given = value => value !== undefined && value !== null && value !== '';
const round2 = value => Math.round(value * 100) / 100;
// A factor as the formula writes it: ×1.0, ×0.6, ×0.45.
const times = factor => `×${Number.isInteger(round2(factor) * 10) ? round2(factor).toFixed(1) : round2(factor)}`;
// A count of things: 两块, 三块.
const count = n => (n === 2 ? TWO : chronicle.numeral(n));

// Hooks the gate fills in (life/gate.cjs and perks.cjs, items 22 and 23):
// at a full gate cultivating is 打磨 (压境): polishing(env) says when, polish(env, verb, upTo) plans
// it, polishLabel names it in the list and polishNote(env) is the row's note (what the gate still
// lacks; a word on it, the row is not off); spent(env) says why it can add nothing (the row is off); while a 悟得 offer waits, hold(env, kind) gives the
// reason any other verb waits; aura(env, aura) is the aura cultivating counts (吐纳绵长, the home's:
// home.cjs), auraBonus(env) → { value, label } | null what is added to its factor (a 聚灵 array). Unset,
// they change nothing. broken(env, stop, receipt) is what an interruption becomes once the clock
// stands at it (encounter.cjs, item 31: one in the wild may be an encounter).
// more(env) lists verbs another module installs into VERBS (rewards.cjs: 采集 and 狩猎 where the place
// has something to gather or hunt), as rows of the view's list. after(env, receipt) runs once a verb
// is done and its time has passed (crafts.cjs: hired work that has fallen due is fetched).
// Pending events (pending.cjs): start(env, kind, plan) settles an event that goes off instead of a
// verb whose time would pass and says so (true: the verb is not done); landed(env, kind, plan,
// broken) runs last, and breaks a stretch at its end on an event that went off during it; ahead
// (env, kind, plan) is the preview's word on one.
const hooks = { polishing: () => false, polish: null, polishLabel: null, polishNote: () => null, spent: () => null, hold: () => null, aura: (env, aura) => aura,
  auraBonus: () => null, broken: async () => null, more: () => [], after: async () => null, start: async () => false,
  landed: async () => null, ahead: () => null };

// ---------------------------------------------------------------- what stops a verb

const fighting = env => String(env.state['0']?.B1?.['31']).trim() === 'true' || Boolean(env.play?.fight);

function yearsLeft(env) {
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const life = mechanics.numberIn(remarks['寿元']), age = mechanics.numberIn(remarks['年龄']);
  return life === null || age === null ? null : life - age;
}

// Why the verb cannot be done here and now, whatever its args, or null.
function blockedFor(env, kind) {
  const { label } = RULES.verbs[kind];
  if (!mechanics.readClock(env.state)) return `时间行里没有可识别的日期，无法${label}`;
  if (fighting(env)) return `仍在战斗中，不能${label}`;
  const left = yearsLeft(env);
  if (left !== null && left <= 0) return `寿元已尽，无法${label}`;
  if (kind === 'cultivate') {
    const c = mechanics.cultivator(env);
    if (mechanics.isFallen(env.ctx, c.row)) return '你已重伤倒地，无法修炼';
    if (c.root.factor <= 0) return `${c.root.label}，吸纳不了天地灵气，无法修炼`;
    if (c.top && c.progress >= 100 && !hooks.polishing(env)) return '修为已满，该冲关了';
    // 打磨 that can add nothing (压境 full, more than the cooldown lacking: gate.cjs spent)
    const spent = hooks.spent(env);
    if (spent) return spent;
  }
  return null;
}

// ---------------------------------------------------------------- how long

// The days a verb asks for by `days` or `until` (it gives one of them): { days, until? } or
// { refused }.
function daysAsked(verb, today, label) {
  if (given(verb.days)) {
    const days = /^\d{1,9}$/.test(String(verb.days).trim()) ? Number(verb.days) : 0;
    return days >= 1 ? { days } : { refused: `${label}的日数要是正整数` };
  }
  const target = clock.dayOfDate(verb.until);
  if (target === null) return { refused: `认不出日期「${String(verb.until).slice(0, 20)}」，要写成0001-03-03这样` };
  if (target <= today) return { refused: `${clock.dateOf(target * DAY).text}不在今天之后` };
  return { days: target - today, until: String(verb.until).trim() };
}

// Whether the place the player is at lets the verb be done (verbs.json `where`), or why not.
function placed(env, kind) {
  const rule = Object.hasOwn(RULES.where || {}, kind) ? RULES.where[kind] : null;
  if (!rule || typeof rule !== 'object') return null;
  const facts = places.placeFacts(env);
  if ((rule.venues || []).some(venue => facts.venues.includes(venue)) || (rule.kinds || []).includes(facts.kind)) return null;
  const label = RULES.verbs[kind]?.label ?? kind;
  return `这里没有${[...(rule.venues || []), ...(rule.kinds || [])].join('、')}，不能${label}`;
}

const today = env => Math.floor(mechanics.readClock(env.state).minutes / DAY);
// The minutes to the lifespan's last day (the stop there comes at this time of day), or null.
function toEnd(env) {
  const end = clock.lifespanEnd(env);
  return end === null ? null : Math.max(0, end - today(env)) * DAY;
}

// The stop on the lifespan's last day when a stretch of `minutes` reaches it, in interrupt.stop's
// shape (origin "lifespan"), or null.
function lifespanStop(env, minutes) {
  const end = clock.lifespanEnd(env), now = mechanics.readClock(env.state);
  if (end === null || !now || end <= today(env)) return null;
  const at = (end - today(env)) * DAY;
  return at > minutes ? null
    : { minutes: at, day: end - today(env), date: clock.dateOf(now.minutes + at), origin: 'lifespan', cause: LIFESPAN.cause };
}

// The first of the stretch's own stop and the lifespan's: the lifespan's on a tie.
const firstStop = (stop, ending) => (ending && (!stop || ending.minutes <= stop.minutes) ? ending : stop);

// A verb that could not be cut short at the lifespan's last day.
function pastTheEnd(plan, stop) {
  return stop?.origin === 'lifespan' && plan.minutes > stop.minutes
    ? `${chronicle.spanText(plan.minutes)}撑不到头：寿元到${chronicle.numeral(stop.date.year)}年${stop.date.text}用尽` : null;
}
const shorter = (minutes, upTo) => (upTo === null ? minutes : Math.min(minutes, upTo));

const OPTIONAL = ['reason', 'ends', 'progress', 'realm', 'stones', 'shortfall', 'risk'];

// The preview in the contract's order, without the optional keys that have nothing to say.
function shaped(preview) {
  for (const key of OPTIONAL) if (preview[key] === null || preview[key] === undefined) delete preview[key];
  return preview;
}

// A plan's preview, its risk still to come (op preview adds it and shapes it).
function previewOf(env, minutes, fields) {
  const now = mechanics.readClock(env.state);
  return {
    ok: true, reason: null, minutes, ends: clock.dateOf(now.minutes + minutes), lines: [],
    progress: null, realm: null, stones: null, shortfall: null, formula: [], risk: null,
    ...fields,
  };
}

const refusedPreview = reason => ({ ok: false, reason, minutes: 0, lines: [], formula: [] });

// ---------------------------------------------------------------- wait (静候)

// A stat brought back, as the chronicle and the preview say it: 气血尽复, 法力十二至三十.
function restored(change) {
  const label = RULES.rest.labels[change.stat] ?? change.stat;
  return change.after >= change.max ? `${label}尽复` : `${label}${chronicle.numeral(change.before)}至${chronicle.numeral(change.after)}`;
}

// The receipt's commands for what a 静候 or 调息 brought back, with the lost fight's 重伤 taken off
// once 气血 stands full (injury.unhurt): brought back now, or full already.
function healedCommands(env, changes, commands) {
  const stats = mechanics.readStats(env, 'B1');
  const health = changes.find(change => change.stat === '血量')
    || { after: mechanics.statValue(stats['血量']), max: mechanics.statValue(stats['血量'], 'max') };
  const lifted = injury.unhurt(env, health);
  return [...commands, ...(lifted ? [lifted] : [])].filter(Boolean).join('\n');
}

// Time passes, at the same time of day, and nothing else happens; while injured it is 养伤.
function wait(env, verb, upTo = null) {
  const blocked = blockedFor(env, 'wait');
  if (blocked) return { refused: blocked };
  if (given(verb.days) === given(verb.until)) return { refused: given(verb.days) ? '静候写日数或到哪一天，只写一样' : '静候要写日数，或写到哪一天' };
  const asked = daysAsked(verb, today(env), '静候');
  if (asked.refused) return asked;
  env.waitingUntil = clock.dayOfDate(asked.until);
  const minutes = shorter(asked.days * DAY, upTo);
  const span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `静候${span}${overrun}` };
  const preview = previewOf(env, minutes, {});
  // 养伤: what the days bring back while injured, in the order 调息 says them (verbs.json rest)
  const healed = injury.recovered(env, minutes);
  const order = Object.keys(RULES.rest.labels);
  healed.changes.sort((a, b) => order.indexOf(a.stat) - order.indexOf(b.stat));
  const owns = ownsNothing();
  for (const change of healed.changes) {
    owns.stats.push(change.stat);
    owns.charStats.push(`B1:${change.stat}`);
  }
  const healedWords = healed.changes.map(restored).join('，');
  preview.lines = [`静候${span}，到${preview.ends.text}。`, ...(healedWords ? [`养伤：${healedWords}。`] : [])];
  return {
    minutes, preview,
    receipt: { kind: 'wait', ok: true, source: 'verb', wait: asked, commands: healedCommands(env, healed.changes, healed.commands), owns,
      ...(healed.changes.length ? { healed: healed.changes } : {}), summary: '' },
    line: ['wait', { 地点: chronicle.placeName(env.state), 时长: span }],
    finish: receipt => {
      receipt.summary = `静候${span}：时间 ${receipt.time.before}→${receipt.time.after}`
        + (receipt.age ? `；年龄 ${receipt.age.before}→${receipt.age.after}` : '')
        + (healed.changes.length ? `；养伤：${healed.changes.map(change => `${change.stat} ${change.before}→${change.after}/${change.max}`).join('，')}` : '');
    },
  };
}

// ---------------------------------------------------------------- cultivate (修炼)

// The stretch a cultivate verb asks for: { minutes, asked, by? } or { refused }. `by` says what ends
// a full stretch that progress does not fill first: the lifespan, or the month limit of one call
// (the server goes on with another).
function stretchAsked(env, verb) {
  const ways = [given(verb.days), given(verb.until), verb.full === true].filter(Boolean).length;
  if (ways !== 1) return { refused: ways ? '修炼的时长只写一样：日数、到哪一天，或修满为止' : '修炼要写日数、到哪一天，或修满为止' };
  if (verb.full === true) {
    const end = toEnd(env);
    const life = end === null ? Infinity : end;
    const limit = clock.MONTH_LIMIT * CULTIVATION.calendar.daysPerMonth * DAY;
    return life <= limit ? { minutes: life, asked: { full: true }, by: 'lifespan' } : { minutes: limit, asked: { full: true }, by: 'limit' };
  }
  const asked = daysAsked(verb, today(env), '修炼');
  if (asked.refused) return asked;
  const minutes = asked.days * DAY;
  const overrun = clock.overrun(env, minutes);
  return overrun ? { refused: `闭门${chronicle.spanText(minutes)}${overrun}` } : { minutes, asked };
}

const stonesPerDay = major => CULTIVATION.stones.perDay[ORDER[major]] ?? CULTIVATION.stones.perDay.higher;

// The speed term by term, as the preview shows it: the terms that are not ×1 and +0%.
function formulaOf(c, record, affinity, pool, stonesHelp, minded, lifted = null) {
  const stepDays = Math.round(speed.stepDaysOf(c.major));
  const { aura } = record.factors;
  const terms = [
    { label: '境界', value: `${ORDER[c.major] ?? ORDER.at(-1)} 每步${stepDays}日，每日${Number((100 / stepDays).toFixed(4))}` },
    { label: '灵根', value: `${c.root.assumed ? '未注明，按真灵根' : `${c.root.tier}灵根`} ${times(c.root.factor)}` },
    { label: '功法', value: `${c.technique.name ? `「${c.technique.name}」` : '没有功法'} ${times(c.technique.factor)}` },
  ];
  if (affinity.factor !== 1) terms.push({ label: '契合', value: `${times(affinity.factor)}，${affinity.why}` });
  terms.push({ label: '灵气', value: `${aura.used}${aura.bonus && lifted ? `（${lifted.label} +${aura.bonus}）` : ''} ${times(aura.factor)}` });
  if (stonesHelp) terms.push({ label: '灵石', value: times(CULTIVATION.stones.floor) });
  if (c.world) terms.push({ label: '世界因子', value: `${c.world.names.join('、')} ${times(c.world.factor)}` });
  if (minded.factor !== 1) terms.push({ label: '心境', value: `${minded.have}，${minded.realm}要${minded.need} ${times(minded.factor)}` });
  if (pool.value) terms.push({ label: '加成', value: `${pool.value > 0 ? '+' : ''}${round2(pool.value * 100)}%` + (pool.sum === pool.value ? '' : '（封顶）') });
  terms.push({ label: '每日', value: `约${record.perDay}` });
  return terms;
}

function practiceOf(env, c, facts = places.placeFacts(env)) {
  const affinity = speed.affinityOf(env, c);
  const pool = speed.bonusPool(env);
  const minded = mind.factor(env, c);
  const lifted = hooks.auraBonus(env);
  return { affinity, pool, minded, lifted,
    options: { aura: hooks.aura(env, facts.aura), auraBonus: lifted?.value || 0,
      affinity: affinity.factor, bonus: pool.value, mind: minded.factor, stepDays: speed.stepDaysOf(c.major) } };
}

function cultivationView(env) {
  return mechanics.cultivationView(env, practiceOf(env, mechanics.cultivator(env)).options);
}

function cultivate(env, verb, upTo = null) {
  if (hooks.polish && hooks.polishing(env)) return hooks.polish(env, verb, upTo);
  const blocked = blockedFor(env, 'cultivate');
  if (blocked) return { refused: blocked };
  const asked = stretchAsked(env, verb);
  if (asked.refused) return asked;
  // mechanics.cultivate takes whole hours: a cut falls on the hour, and lasts one at least. Nothing
  // goes past the lifespan's last day (the stop there cuts every stretch: interrupt.forced).
  const end = toEnd(env);
  const asking = end === null ? asked.minutes : Math.min(asked.minutes, end);
  const span = upTo === null ? asking : Math.max(60, Math.min(asking, Math.floor(upTo / 60) * 60));
  const c = mechanics.cultivator(env);
  const facts = places.placeFacts(env);
  const { affinity, pool, minded, lifted, options } = practiceOf(env, c, facts);
  const useStones = verb.stones === true;
  // the fraction of a point the stretches before left over (frxPlay.leftover) goes into this one's gain
  const carry = Number.isFinite(env.play.leftover) ? env.play.leftover : 0;
  Object.assign(options, { moveClock: false, carry });
  const args = { mode: '修炼', duration: span / 60, unit: '小时', use_stones: useStones };
  const receipt = mechanics.cultivate(env, args, 'verb', options);
  if (!receipt.ok) return { refused: receipt.reason };
  const record = receipt.cultivation;
  const minutes = receipt.time.minutes;
  const stop = record.bottleneck ? 'full' : end !== null && minutes === end && end < asked.minutes ? 'lifespan'
    : minutes < asked.minutes ? 'cut' : asked.by ?? null;
  receipt.verb = { kind: 'cultivate', asked: { ...asked.asked, ...(useStones ? { stones: true } : {}) }, stop, place: facts.place };
  // Stones lift a thinner aura; the days they pay for, unrounded (the receipt's are to the hundredth).
  const helps = useStones && record.factors.aura.factor + 1e-9 < CULTIVATION.stones.floor;
  const covered = helps ? record.stones.before / stonesPerDay(c.major) : 0;
  let shortfall = null;
  if (helps && covered + 1e-9 < minutes / DAY) {
    // What the stretch would spend with stones enough for all of it (it may end sooner then).
    const row = { ...c.row, 26: String(Number.MAX_SAFE_INTEGER) };
    const rich = { ...env, state: { ...env.state, 0: { ...env.state['0'], B1: row } } };
    shortfall = Math.max(1, mechanics.cultivate(rich, args, 'verb', options).cultivation.stones.cost - record.stones.before);
  }
  const stepped = record.steps.length > 0;
  const preview = previewOf(env, minutes, {
    progress: { before: record.before.progress, after: record.after.progress },
    realm: stepped ? { before: record.before.realm, after: record.after.realm } : null,
    stones: useStones ? record.stones.cost : null, shortfall,
    formula: formulaOf(c, record, affinity, pool, helps && covered > 0, minded, lifted),
  });
  const before = chronicle.numeral(record.before.progress), after = chronicle.numeral(record.after.progress);
  const lines = [`闭门${chronicle.spanText(minutes)}，${preview.ends.text}出关。`];
  lines.push(stepped ? `修为${before}至${after}，晋${record.after.realm}。` : `修为${before}至${after}。`);
  const early = minutes < asked.minutes && verb.full !== true;
  if (stop === 'full') lines.push(`修为满了，到了${ORDER[c.major + 1] ?? '下一境界'}的关口${early ? '，提前出关' : ''}。`);
  if (stop === 'lifespan') lines.push('修到寿元尽时为止。');
  if (stop === 'limit') lines.push(`一次最多闭门${chronicle.spanText(asked.minutes)}，余下的另起一次。`);
  if (useStones && !helps) lines.push(`此地${CULTIVATION.environment.labels[record.factors.aura.used]}，灵石帮不上忙。`);
  else if (record.stones?.cost) lines.push(`耗灵石${count(record.stones.cost)}块。`);
  if (shortfall) {
    lines.push(covered > 0
      ? `灵石只够${chronicle.spanText(Math.round(covered * DAY))}，缺${count(shortfall)}块，其余按灵气计。`
      : `没有灵石可用，缺${count(shortfall)}块，全程按灵气计。`);
  }
  if (record.restored) lines.push('法力、气血回满。');
  if (verb.full === true) lines.push('遇事出关时会保留已修得的进度，零头也计入下次修炼。');
  if (c.technique.unequipped) lines.push(`储物袋中的「${c.technique.unequipped}」尚未装备。`);
  preview.lines = lines;
  return {
    minutes, receipt, preview,
    line: ['cultivate', {
      地点: chronicle.placeName(env.state), 时长: chronicle.spanText(minutes), 原: before, 新: after,
      境界: stepped ? record.after.realm : '',
    }],
    // what is left of a point after rounding waits for the next stretch
    finish: () => { env.play.leftover = record.leftover || 0; },
  };
}

// ---------------------------------------------------------------- rest (调息)

function rest(env, verb, upTo = null) {
  const blocked = blockedFor(env, 'rest');
  if (blocked) return { refused: blocked };
  const rule = RULES.rest;
  const asked = /^\d{1,2}$/.test(String(verb.hours ?? '').trim()) ? Number(verb.hours) : 0;
  if (asked < rule.hours.min || asked > rule.hours.max) return { refused: `调息要写${rule.hours.min}到${rule.hours.max}个小时` };
  const hours = upTo === null ? asked : Math.max(1, Math.min(asked, Math.floor(upTo / 60)));
  const minutes = hours * 60;
  const span = chronicle.spanText(minutes);
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `调息${span}${overrun}` };
  const receipt = mechanics.rest(env, { kind: rule.kind, hours }, 'verb');
  if (!receipt.ok) return { refused: receipt.reason };
  // 气血 back to full: the lost fight's 重伤 comes off the status column
  receipt.commands = healedCommands(env, receipt.rest.changes, [receipt.commands]);
  const order = Object.keys(rule.labels);
  const changes = [...receipt.rest.changes].sort((a, b) => order.indexOf(a.stat) - order.indexOf(b.stat));
  const label = stat => rule.labels[stat] ?? stat;
  const phrase = change => (change.after >= change.max ? `${label(change.stat)}尽复`
    : `${label(change.stat)}${chronicle.numeral(change.before)}至${chronicle.numeral(change.after)}`);
  const rates = mechanics.COMBAT.recovery[rule.kind];
  const preview = previewOf(env, minutes, {
    lines: [`调息${span}。`, ...changes.map(change => `${phrase(change)}。`)],
    formula: order.filter(stat => Object.hasOwn(rates, stat)).map(stat => ({ label: label(stat), value: `每小时回复上限的${rates[stat]}%` })),
  });
  return {
    minutes, receipt, preview,
    line: changes.every(change => change.after >= change.max) ? ['rest', { 时辰: span }]
      : ['restPartly', { 时辰: span, 恢复: changes.map(phrase).join('，') }],
    finish: settled => { settled.summary += `；时间 ${settled.time.before}→${settled.time.after}`; },
  };
}

// ---------------------------------------------------------------- the ops

const VERBS = { wait, cultivate, rest };

const kindOf = args => String(args.kind ?? '');
const unknown = kind => `没有「${kind.slice(0, 20)}」这个指令`;

// The plan again, for the time up to a break inside the stretch.
const cutAt = (env, kind, args, plan, minutes) => (minutes < plan.minutes ? VERBS[kind](env, args, minutes) : plan);

// A steady verb (pending.STEADY: a gate's attempt, a 悟得 taken) is never broken off: an attempt
// is not cut short (gate.cjs), so no dice, fair or clock stops it midway (a 结丹 attempt of a year
// at 泊灯城 was settled whole and still carried 开院会's interruption from its ninety-eighth day,
// whose scene then opened a year late: the real-model checks, plan item 50). Only the lifespan's
// last day counts, and the gate refuses an attempt that would outlast it.
const steady = kind => require('./pending.cjs').STEADY.has(kind);

async function verb(env, args) {
  // A scene is played out before the days go on (plan item 9).
  if (env.play.scene) return env.refuse('这场戏还没收场');
  const kind = kindOf(args);
  if (!Object.hasOwn(VERBS, kind)) return env.refuse(unknown(kind));
  env.verbKind = kind;
  const held = hooks.hold(env, kind) || placed(env, kind);
  if (held) return env.refuse(held);
  let plan = VERBS[kind](env, args);
  if (plan.refused) return env.refuse(plan.refused);
  // An event that goes off now takes the place of a verb whose time would pass (pending.cjs).
  if (await hooks.start(env, kind, plan)) return;
  // Whether and when the stretch is broken off is decided now, once (item 16); the lifespan's last
  // day stops it whatever comes after (item 49).
  const broken = firstStop(steady(kind) ? null : interrupt.stop(env, plan.minutes, plan.at), lifespanStop(env, plan.minutes));
  const ending = broken?.origin === 'lifespan';
  if (broken) {
    plan = cutAt(env, kind, args, plan, broken.minutes);
    if (plan.refused) return env.refuse(plan.refused);
    const past = pastTheEnd(plan, broken);
    if (past) return env.refuse(past);
    if (!ending) plan.receipt.interruption = interrupt.shown(broken);
  }
  chronicle.write(env, ...plan.line);
  await clock.advance(env, plan.minutes, plan.receipt, plan.place);
  if (broken && !ending) {
    interrupt.after(env, broken);
    await hooks.broken(env, broken, plan.receipt);
  }
  await plan.finish?.(plan.receipt);
  if (broken) {
    plan.receipt.summary += ending ? `；${chronicle.fill(LIFESPAN.summary, { 日期: broken.date.text })}`
      : `；${broken.date.text}被打扰：${broken.cause}`;
  }
  await hooks.after(env, plan.receipt);
  await hooks.landed(env, kind, plan, broken);
}

async function preview(env, args) {
  if (env.play?.scene) return { preview: refusedPreview('这场戏还没收场') };
  const kind = kindOf(args);
  if (!Object.hasOwn(VERBS, kind)) return { preview: refusedPreview(unknown(kind)) };
  env.verbKind = kind;
  const held = hooks.hold(env, kind) || placed(env, kind);
  if (held) return { preview: refusedPreview(held) };
  let plan = VERBS[kind](env, args);
  if (plan.refused) return { preview: refusedPreview(plan.refused) };
  // An event that goes off now comes first: the verb would not be done (pending.cjs).
  const first = hooks.ahead(env, kind, plan);
  if (first) {
    plan.preview.risk = 100;
    plan.preview.lines.push(first);
    return { preview: shaped(plan.preview) };
  }
  // A forced stop is certain, so the preview stops there as the verb will; the dice are only a risk.
  // The lifespan's last day is the most certain of them (item 49).
  const sure = firstStop(steady(kind) ? null : interrupt.forced(env, plan.minutes, plan.at), lifespanStop(env, plan.minutes));
  if (sure) {
    plan = cutAt(env, kind, args, plan, sure.minutes);
    if (plan.refused) return { preview: refusedPreview(plan.refused) };
    const past = pastTheEnd(plan, sure);
    if (past) return { preview: refusedPreview(past) };
  }
  // a steady verb's stretch is never broken off: its word is that of no time at risk
  const word = sure?.origin === 'lifespan' ? { risk: 100, line: chronicle.fill(LIFESPAN.preview, { 日期: sure.date.text }) }
    : interrupt.view(env, steady(kind) ? 0 : plan.minutes, plan.at);
  plan.preview.risk = word.risk;
  plan.preview.lines.push(word.line);
  return { preview: shaped(plan.preview) };
}

function list(env) {
  return Object.entries(RULES.verbs).filter(([kind]) => !placed(env, kind)).map(([kind, { glyph, label }]) => {
    const why = blockedFor(env, kind) || hooks.hold(env, kind);
    const polishing = kind === 'cultivate' && hooks.polishing(env);
    if (polishing) label = hooks.polishLabel ?? label;
    const word = polishing && !why ? hooks.polishNote(env) : null;
    return { kind, glyph, label, ...(kind === RULES.main && !why ? { main: true } : {}), ...(why ? { off: true, note: why } : word ? { note: word } : {}) };
  }).concat(hooks.more(env).map(({ word, ...row }) => {
    // a row's note is why it cannot be done now; its word, a word on it when it can (守拙: once a year)
    const why = row.note || hooks.hold(env, row.kind);
    return { ...row, ...(why ? { off: true, note: why } : word ? { note: word } : {}) };
  }));
}

module.exports = { verb, preview, list, hooks, VERBS, cultivationView };
