'use strict';
/* The gates (冲关, 玩法设计第七节「冲关」; plan item 22): each major realm is a gate, and from the day
 * a realm is entered its preparation sheet (准备单) shows what the next gate asks, what can be
 * prepared, the chance now and the foundation (根基) an attempt now would leave. The gates, the
 * three new odds terms and the foundation are content/life/gates.json; the attempt itself is the
 * old rule, mechanics.breakthrough, given the new terms as options.
 *
 * sheet(env, { aids? }) → the next gate's sheet:
 *   gate       the realm it opens (筑基); name what the gate is called (引气入体, 筑基); to the step
 *              it leads into (筑基初期); beyond: true past 化神 (gates.json beyond, nothing else)
 *   requires   [{ key, label, met, text }]: the hard requirements one by one (full, root, technique,
 *              cap, mind, chance); 心境 (mind.cjs, item 36) is met at the gate's threshold, and its
 *              text says how much is missing (「12/30，差18」); the method's cap is the one written
 *              on it (column 7; maxRealm once worn), else the realm of its tier (gear.tierOfItem:
 *              一阶 炼气, 二阶 筑基 …; 「按一阶算，只到炼气，够不着筑基」)
 *   prepares   [{ key, label, state, text, odds?, points? }]: what can be prepared, state have | can |
 *              miss (有, 可, 缺): aids (the gate's pills, as many as count), protector (护法: someone
 *              on the scene with 信赖 favour and a realm not below the player's), aura (灵地: 浓
 *              here, or at home the home's: a 坊市's 洞府 has a vein), polish (压境), knots (心结:
 *              none is have)
 *   tier, dc   the gate's difficulty by the root (cultivation.json) plus the gate's harder (gates.json,
 *              odds.cjs dcOf); terms [{ label, value }] what is added to the die: 气运 by its band,
 *              神识 against the realm (odds.cjs senseModifier), the pills (odds.pill each, two at
 *              most), the new terms and 瓶颈 (bottleneckOf); odds 0 to 100 and faces { 大成功, 成功,
 *              失败, 大失败 } by the die's ten faces through turn-rules' checkOutcome, the rule
 *              breakthrough rolls with; formula the terms in words: 骰加气运1、神识1、丹药4、护法1，对难度13
 *   extra      what the new terms add (the odds option breakthrough is given): 灵地, 护法, 心结
 *              (less as a talent's knotCap bears them) and the gateOdds of talents and perks
 *   foundation { points, grade, growth, speed, next? }: the points an attempt now earns (one each:
 *              the pills used to the most, 灵地, 护法, 心境 over the threshold by half, no 心结, and
 *              压境 up to two; plus the gate's own foundation: 引气入体 is 稳固 with nothing done),
 *              its grade and what it governs; next { grade, need } the grade above
 *   cooldown   null or { date: "0001-03-03", text: "三月初三" }: no attempt before it
 *   days       what an attempt takes; ready whether one can be made now; missing what is still
 *              missing, a few words each
 *   `aids` (bag ids, one a pill, as the breakthrough verb takes them) prices those pills; without it
 *   the sheet counts the gate's pills in the bag, as many as count.
 * summary(env) → the view's gate { name, odds, foundation, missing }, or null past 化神.
 * oddsWith(env, more) → the odds the sheet would show with `more` added to the die (a preparation not
 *   yet made: 接下来's guide says what each adds in percent).
 * polishing(env) → whether cultivating is 打磨 now: progress full at the gate (压境).
 * spent(env) → why cultivating can add nothing now, or null: progress full at the gate, 压境 at its
 *   most, and the gate waiting for more than its cooldown (which 打磨 sits out): 「压境已满，再打磨也
 *   不添根基；冲关还差：…」, or 「…；冲关的条件都齐了，该冲关了」. The cultivate row is off with it as
 *   its note (verbs.hooks.spent) and every length of it is refused with it (plan item 50's fixes: the
 *   turns lane's real-model run pressed a 修炼 that showed as open nineteen times, refused each time).
 * lacking(env) → 「冲关还差：心境 30（现有 12）、没有功法」, what the gate still lacks (the sheet's
 *   missing), or null when nothing is: the 打磨 row's note and a line of its preview.
 * The verbs (verbs.cjs plans, installed by install):
 *   breakthrough { aids }  mechanics.breakthrough on the gate's timeline seed (seedOf { kind: gate,
 *                          gate }), with { odds: extra, growth: the foundation's third, foundation,
 *                          moveClock: false } and this play's terms (modifiers, dc, aidBonus, its
 *                          step days); the clock moves through advance. Success records
 *                          frxPlay.foundation[gate] and offers three 悟得 (perks.offer); failure
 *                          puts the cooldown on the calendar (calendar.register "cooldown"), costs
 *                          years (the realm's lifespan × gates.json failure.lifespan, written to 寿元;
 *                          receipt.gate.lifespanLost) and counts at the gate (frxPlay.gates[gate].failed,
 *                          the bottleneck; started again at one when the pill was taken). At
 *                          结丹 and 元婴 each heart knot is a 心魔 first (karma.demons, item 40): a
 *                          神识 check each, every failure one more off this attempt's odds; the
 *                          receipt carries them as demons [{ knot, check }]. 丹毒
 *                          (poison.breakthrough): success clears it, a failure keeps what the aids
 *                          added; at the cap no aid can be taken.
 *   polish (cultivate at a full gate) { days | until | full }: the lengths cultivating takes; time
 *                          passes and the days go into frxPlay.gates[gate].extra (a point every
 *                          perPoint of this play's step days, speed.stepDaysOf; full: until the
 *                          most 压境 counts; once it does, until the cooldown's day when that is
 *                          all the gate waits for); refused at any length when spent
 * chanceWanted(env) → the gate ahead when it asks for a 机缘 (requires chance: 化神) and has none
 *   yet, else null: what a 奇遇 may bring (rewards.cjs).
 * grantChance(env, { from, scene?, reason? }) → { gate, name } | { refused }: a 机缘 for the gate
 *   ahead, recorded on frxPlay.gates[gate].chance { from: story | fortune, date, scene?, reason? }:
 *   it meets a gate that asks for one and clears the gate's bottleneck (bottleneckOf), as the
 *   design has it. Refused past the last gate, or when the gate has one already.
 * chanceOp: the op chance { reason } (plan item 50's fixes: nothing ever wrote the 机缘, so 化神
 *   could not be reached): a scene of the story gives the gate ahead its 机缘, the reason in a few
 *   words (the turns lane's tool calls it when the story clearly gives one). Refused outside a
 *   scene and as grantChance refuses. A chronicle line, receipt { kind: "chance", chance: { gate,
 *   name, from, reason } }.
 * pool(env) → the bonus pool's term of the foundation of the realm the player is in (its speed).
 * install(verbs, speed) puts the verbs, the hooks and the pool's source in place, once.
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const calendar = require('./calendar.cjs');
const places = require('./places.cjs');
const perks = require('./perks.cjs');
const mind = require('./mind.cjs');
const poison = require('./poison.cjs');
const karma = require('./karma.cjs');
const book = require('./book.cjs');
const { favourTier } = require('./actions.cjs');
const gear = require('./gear.cjs');
const speed = require('./speed.cjs');
const odds = require('./odds.cjs');
const { ownsNothing } = require('./play.cjs');

const GATES = data('gates');
const CULTIVATION = mechanics.CULTIVATION;
const CHECKS = rules.RULES;
const ORDER = mechanics.COMBAT.realms.order;
const DAY = clock.DAY_MINUTES;
const TIERS = data('actions').favour.tiers.map(tier => tier.name);
const OUTCOMES = ['大成功', '成功', '失败', '大失败'];

const label = key => GATES.labels[key] ?? key;
const rowName = row => plain(row?.['1']).split('|')[0];
const atLeast = (have, need) => have.major > need.major || (have.major === need.major && (!need.minor || (have.minor || 0) >= need.minor));
// 压境 counts by the play's own step days of the realm (speed.cjs: the rule table's over its pace).
const stepDaysOf = major => speed.stepDaysOf(major);
const TIER_REALMS = data('goods').tiers;
const given = value => value !== undefined && value !== null && value !== '';
const DESCRIBED_CAP = new RegExp(
  `(?:可修(?:炼)?[至到]|(?:修炼|修行)上限[：:])\\s*((?:${ORDER.slice(1).join('|')})(?:[一二三四五六七八九十\\d]+层|初期|中期|后期|大圆满|圆满|巅峰)?)`,
);

// ---------------------------------------------------------------- what the sheet reads

// The method's cultivation cap by its name: its item row, worn or in the bag. The cap written on it
// (物品表第 7 列; a worn method keeps it as maxRealm), an explicit cap in the item's own text,
// or the realm of its tier (gear.tierOfItem:
// 一阶 炼气, 二阶 筑基 …; the numeric balance after plan item 50: a cap not written no longer reaches
// every realm). { ...realm, written } or null when there is no method.
function capOf(env, name) {
  if (!name) return null;
  const rows = [...env.ctx.equippedItemRows(env.state['0']?.B1), ...Object.values(env.state['1'] || {})];
  const row = rows.find(each => each && (each.type ?? each['2']) === '功法' && plain(each.name ?? each['1']).split('|')[0] === name);
  return row ? capOfItem(env, row) : null;
}

function capOfItem(env, row) {
  const text = plain(row['7'] ?? row.cap ?? row.maxRealm);
  const written = text ? mechanics.parseRealm(text) : null;
  if (written && !written.unknown) return { ...written, written: true };
  for (const field of [row.effect ?? row['4'], row.currentEffect ?? row['9'], row.description ?? row['3']]) {
    const described = plain(field).match(DESCRIBED_CAP);
    if (described) return { ...mechanics.parseRealm(described[1]), written: true };
  }
  const tier = gear.tierOfItem(env, row);
  const realm = TIER_REALMS[tier] ? mechanics.parseRealm(TIER_REALMS[tier]) : null;
  return realm && !realm.unknown ? { ...realm, written: false, tier } : null;
}

function methodAdvice(env, target) {
  const stored = env.ctx.storedItemIds(env.state);
  const needed = ORDER[target];
  const fitting = Object.entries(env.state['1'] || {}).filter(([id, row]) =>
    row?.['2'] === '功法' && !stored.has(id) && (capOfItem(env, row)?.major ?? 0) >= target);
  const ready = fitting.find(([id]) => !gear.canEquip(env, id));
  if (ready) return `可在角色面板装备行囊里的「${rowName(ready[1])}」`;
  const search = `可去坊市或宗门藏经阁找一部能修至${needed}的功法`;
  if (!fitting.length) return search;
  const [, row] = fitting[0];
  return `行囊里的「${rowName(row)}」暂因境界不足无法修习；${search}`;
}

// Someone on the scene who will stand guard: 信赖 favour or more, a realm not below the player's.
function protectorOf(env, c) {
  const trust = TIERS.indexOf(GATES.odds.protector.favour);
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    if (!/^[CG]/.test(id) || !row || mechanics.isFallen(env.ctx, row)) continue;
    const realm = mechanics.parseRealm(row['2']);
    if (realm.unknown || !atLeast(realm, c.realm)) continue;
    if (TIERS.indexOf(favourTier(plain(row['15']))) >= trust) return { id, name: rowName(row) };
  }
  return null;
}

// The gate's pills in the bag, as many as count, or the ones `aids` names (one id a pill).
function pillsOf(env, gate, aids) {
  const stored = env.ctx.storedItemIds(env.state);
  const stacks = Object.entries(env.state['1'] || {})
    .filter(([id, row]) => row && !stored.has(id) && gate.aids.some(name => rowName(row).includes(name)))
    .map(([id, row]) => ({ id, name: rowName(row), count: Number(env.ctx.itemStackCount(row['5'])) || 0 }));
  const have = stacks.reduce((sum, stack) => sum + stack.count, 0);
  const named = Array.isArray(aids) ? aids.map(plain).filter(id => stacks.some(stack => stack.id === id || stack.name === id)).length : null;
  return { stacks, have, used: Math.min(named ?? have, CULTIVATION.breakthrough.aidMax) };
}

const polishedDays = (env, gate) => Number(env.play?.gates?.[gate]?.extra) || 0;

function polishPoints(env, gate, c) {
  const rule = GATES.foundation.polish;
  return Math.min(rule.most, Math.floor(polishedDays(env, gate) / (stepDaysOf(c.major) * rule.perPoint)));
}

// The bottleneck of the failures at this gate (gates.json failure.bottleneck; frxPlay.gates[gate].failed):
// each failure since the gate was last cleared takes `each` off the roll, at most `most`. The gate's
// own pill taken now, or a 机缘 recorded for the gate (frxPlay.gates[gate].chance), clears it; passing
// the gate drops the whole record. { failed, cleared, penalty }.
function bottleneckOf(env, key, pillsUsed) {
  const rule = GATES.failure.bottleneck;
  const record = env.play?.gates?.[key];
  const failed = Number(record?.failed) || 0;
  const cleared = failed > 0 && (pillsUsed > 0 || !!record?.chance);
  return { failed, cleared, penalty: failed && !cleared ? Math.max(rule.most, failed * rule.each) : 0 };
}

function gradeOf(points) {
  const grades = GATES.foundation.grades;
  const index = grades.reduce((at, grade, i) => (points >= grade.from ? i : at), 0);
  return { ...grades[index], next: grades[index + 1] ? { grade: grades[index + 1].name, need: grades[index + 1].from - points } : null };
}

function cooldownOf(env) {
  const day = env.progress?.breakthroughCooldownDay;
  const today = clock.today(env);
  return Number.isInteger(day) && today !== null && today < day ? { date: clock.dateKey(day), text: clock.dateOf(day * DAY).text } : null;
}

// ---------------------------------------------------------------- the sheet

function requirement(env, key, c, gate, rule) {
  if (key === 'full') {
    // the rule table's day at an ordinary place, at the play's own pace (speed.stepDaysOf)
    const perDay = mechanics.cultivationView(env).perDay * (CULTIVATION.stepDays[ORDER[c.major]] ?? CULTIVATION.stepDays.higher) / stepDaysOf(c.major);
    const gap = c.top && c.progress < 100 && perDay > 0 ? (100 - c.progress) / perDay : null;
    const topUp = gap !== null && gap <= (CULTIVATION.breakthrough.topUpDays ?? 1);
    const met = c.top && (c.progress >= 100 || topUp);
    return { met, text: !c.top ? `${c.realm.text}，还没到瓶颈` : `${c.progress}/100${topUp ? '，冲关前运功补足' : ''}`,
      short: c.top ? '修为未满' : '还没到瓶颈' };
  }
  if (key === 'root') return { met: c.root.factor > 0, text: c.root.assumed ? '未注明，按真灵根' : c.root.label, short: '没有灵根' };
  if (key === 'technique') {
    const text = c.technique.name ? `「${c.technique.name}」` : `尚未装备功法；${methodAdvice(env, gate.target)}`;
    return { met: !!c.technique.name, text, short: '没有功法' };
  }
  if (key === 'cap') {
    const equipped = gear.methods(env).map(row => ({ cap: capOfItem(env, row), name: plain(row.name ?? row['1']).split('|')[0] }));
    const best = equipped.filter(each => each.cap).sort((a, b) => b.cap.major - a.cap.major || (b.cap.minor || 0) - (a.cap.minor || 0))[0];
    const cap = best?.cap || (!equipped.length && capOf(env, c.technique.name));
    if (!cap) return { met: true, text: c.technique.name ? '上限未注明' : '尚无功法', short: '' };
    const reach = cap.major >= gate.target;
    const how = (best?.name && best.name !== c.technique.name ? `「${best.name}」` : '') + (cap.written ? '' : `按${cap.tier}算，`);
    return { met: reach, text: reach ? `${how}可至${cap.text}` : `${how}只到${cap.text}，够不着${ORDER[gate.target]}；${methodAdvice(env, gate.target)}`, short: `功法只到${cap.text}` };
  }
  if (key === 'mind') {
    if (!GATES.mind.open) return { met: true, text: GATES.mind.label, short: '' };
    const have = mind.value(env), asked = rule.mind;
    return { met: have >= asked, text: have >= asked ? `${have}/${asked}` : `${have}/${asked}，差${asked - have}`, short: `心境 ${asked}（现有 ${have}）` };
  }
  const met = !!env.play?.gates?.[ORDER[gate.target]]?.chance;
  return { met, text: met ? '已有' : '要主线给路', short: '缺一桩大机缘' };
}

// The sheet as the attempt reads it: the view's sheet, with the 神识 and 气运 terms the attempt is
// given (modifiers) and the gate's bottleneck (bottleneckOf), which the view does not carry.
function judge(env, { aids, more = 0 } = {}) {
  const c = mechanics.cultivator(env);
  const gate = mechanics.gateOf(c);
  const key = gate ? ORDER[gate.target] : null;
  const rule = key ? GATES.gates[key] : null;
  if (!rule) {
    return { gate: key, name: key || GATES.beyond, beyond: true, text: GATES.beyond, requires: [], prepares: [], odds: 0, ready: false, missing: [GATES.beyond] };
  }
  const judged = rule.requires.map(each => ({ key: each, label: label(each), ...requirement(env, each, c, gate, rule) }));
  const requires = judged.map(({ short: _short, ...each }) => each);
  const pills = pillsOf(env, gate, aids);
  const facts = places.placeFacts(env);
  // at home, the home's aura (a 坊市's 洞府 has a vein: home.cjs), as cultivating there counts it
  const home = env.play?.home && typeof env.play.home === 'object' ? env.play.home : null;
  const aura = home && home.place && home.place === facts.place ? home.aura : facts.aura;
  const rich = aura === GATES.odds.aura.tier;
  const protector = protectorOf(env, c);
  const knots = Array.isArray(env.play?.knots) ? env.play.knots.length : 0;
  // A talent may bear knots better (knotCap: the most they take off is that much less).
  const knotCap = perks.effectsOf(env, 'knotCap').reduce((sum, effect) => sum + (Number(effect.value) || 0), 0);
  const knotOdds = Math.min(0, Math.max(GATES.odds.knots.most + knotCap, knots * GATES.odds.knots.each));
  // Talents and perks that change a breakthrough's odds (gateOdds, plan item 48).
  const gifts = perks.effectsOf(env, 'gateOdds').filter(effect => Number(effect.value));
  const prepares = [];
  const breakthroughRule = CULTIVATION.breakthrough;
  const pillBonus = GATES.odds.pill.bonus;
  if (rule.prepares.includes('aids')) {
    prepares.push({ key: 'aids', label: gate.aids.join('、') || label('aids'), state: pills.have ? 'have' : 'miss',
      text: pills.have ? `${pills.have} 枚，最多计 ${breakthroughRule.aidMax} 枚` : `没有${gate.aids.join('、')}`, odds: pills.used * pillBonus });
  }
  if (rule.prepares.includes('protector')) {
    prepares.push({ key: 'protector', label: label('protector'), state: protector ? 'have' : 'miss',
      text: protector ? `${protector.name}在场护法` : `没有好感到「${GATES.odds.protector.favour}」、境界不低于你的人在场`, odds: GATES.odds.protector.bonus });
  }
  if (rule.prepares.includes('aura')) {
    prepares.push({ key: 'aura', label: label('aura'), state: rich ? 'have' : 'miss',
      text: rich ? '此地灵气浓郁' : `此地灵气${aura}`, odds: GATES.odds.aura.bonus });
  }
  const polished = polishPoints(env, key, c);
  if (rule.prepares.includes('polish')) {
    const most = GATES.foundation.polish.most;
    const per = stepDaysOf(c.major) * GATES.foundation.polish.perPoint;
    const days = polishedDays(env, key);
    const more = Math.ceil((polished + 1) * per - days);
    const total = Math.ceil(most * per);
    const record = `累计打磨${chronicle.numeral(days)}日（压境 ${polished}/${most} 分）`;
    prepares.push({ key: 'polish', label: label('polish'), state: polished >= most ? 'have' : 'can', points: polished,
      text: polished >= most ? record : `${record}，再打磨${chronicle.numeral(more)}日得 1 分，打磨满需${chronicle.numeral(total)}日` });
  }
  const demonGate = karma.RULES.demons.gates.includes(key);
  prepares.push({ key: 'knots', label: label('knots'), state: knots ? 'miss' : 'have',
    text: knots ? `${chronicle.numeral(knots)}桩，成算${knotOdds}${demonGate ? '，冲关时化作心魔' : ''}` : '没有，冲关时不起心魔' });
  // The odds: the old rule's die and terms, and the new ones. 气运 by the old bands, 神识 against
  // the realm (odds.senseModifier), the gate as hard as this play has it (odds.dcOf), the pills at
  // this play's bonus, and the bottleneck of the failures at this gate (bottleneckOf).
  // The totals with the active gear (gear.cjs, plan item 33), as the attempt counts them.
  const totals = gear.totals(env, 'B1', c.stats);
  const attributes = breakthroughRule.attributes.map(stat => ({ stat, value: totals[stat],
    modifier: stat === GATES.sense.stat ? odds.senseModifier(c.major, totals[stat]) : rules.modifierFor(totals[stat]) }));
  const dc = odds.dcOf(gate.target, gate.dc);
  const stuck = bottleneckOf(env, key, pills.used);
  const extra = (rich ? GATES.odds.aura.bonus : 0) + (protector ? GATES.odds.protector.bonus : 0) + knotOdds + stuck.penalty
    + gifts.reduce((sum, effect) => sum + Number(effect.value), 0);
  const base = attributes.reduce((sum, each) => sum + each.modifier, 0) + pills.used * pillBonus + extra + (Number(more) || 0);
  const faces = Object.fromEntries(OUTCOMES.map(outcome => [outcome, 0]));
  for (let roll = 1; roll <= CHECKS.die; roll += 1) faces[rules.checkOutcome(roll, roll + base, dc)] += 1;
  const chance = Math.round(100 * (faces['大成功'] + faces['成功']) / CHECKS.die);
  const terms = [
    ...attributes.map(each => ({ label: each.stat, value: each.modifier })),
    ...(pills.used ? [{ label: '丹药', value: pills.used * pillBonus }] : []),
    ...(protector ? [{ label: label('protector'), value: GATES.odds.protector.bonus }] : []),
    ...(rich ? [{ label: label('aura'), value: GATES.odds.aura.bonus }] : []),
    ...(knotOdds ? [{ label: label('knots'), value: knotOdds }] : []),
    ...(stuck.penalty ? [{ label: label('bottleneck'), value: stuck.penalty }] : []),
    ...gifts.map(effect => ({ label: perks.labelOf(effect.name), value: Number(effect.value) })),
  ];
  // The foundation an attempt now would leave.
  const met = {
    aids: gate.aids.length > 0 && pills.used >= breakthroughRule.aidMax,
    aura: rich, protector: !!protector, noKnots: knots === 0,
    mind: !GATES.mind.open || mind.value(env) >= rule.mind * (1 + GATES.foundation.mindAbove),
  };
  const points = Object.values(met).filter(Boolean).length + polished + (Number(rule.foundation) || 0);
  const grade = gradeOf(points);
  const cooldown = cooldownOf(env);
  const missing = [...judged.filter(each => !each.met).map(each => each.short || `${each.label}：${each.text}`),
    ...(cooldown ? [`${cooldown.text}前不能冲关`] : [])];
  return {
    gate: key, name: rule.name, to: gate.to, requires, prepares, tier: gate.tier, dc, terms, extra, odds: chance, faces,
    modifiers: Object.fromEntries(attributes.map(each => [each.stat, each.modifier])), bottleneck: stuck,
    formula: `骰加${terms.map(term => `${term.label}${term.value}`).join('、')}，对难度${dc}`,
    foundation: { points, grade: grade.name, growth: grade.growth, speed: grade.speed, ...(grade.next ? { next: grade.next } : {}) },
    cooldown, days: gate.days, ready: missing.length === 0, missing,
  };
}

function sheet(env, args) {
  const { modifiers: _modifiers, bottleneck: _bottleneck, ...shown } = judge(env, args);
  return shown;
}

// The odds the gate would show with `more` added to the die (what a preparation not yet made would
// add: 接下来's guide says it in percent).
const oddsWith = (env, more) => judge(env, { more }).odds;

function summary(env) {
  const found = sheet(env);
  return found.beyond ? null : { name: found.name, odds: found.odds, foundation: found.foundation.grade, missing: found.missing };
}

function lacking(env) {
  const found = sheet(env);
  return !found.beyond && found.missing.length ? `${GATES.lacking}${found.missing.join('、')}` : null;
}

function polishing(env) {
  const c = mechanics.cultivator(env);
  const gate = mechanics.gateOf(c);
  return !!gate && !!GATES.gates[ORDER[gate.target]] && c.top && c.progress >= 100;
}

// ---------------------------------------------------------------- the verbs

const today = env => Math.floor(mechanics.readClock(env.state).minutes / DAY);

// The day the gate may be tried when its cooldown is all it waits for and that day is ahead, else null.
function cooldownOnly(env) {
  const found = sheet(env);
  const until = found.cooldown && found.missing.length === 1 ? clock.dayOfDate(found.cooldown.date) : null;
  return until !== null && until > today(env) ? until : null;
}

function spent(env) {
  if (!polishing(env)) return null;
  const c = mechanics.cultivator(env);
  if (polishPoints(env, ORDER[mechanics.gateOf(c).target], c) < GATES.foundation.polish.most || cooldownOnly(env) !== null) return null;
  return `压境已满，再打磨也不添根基；${lacking(env) || GATES.spentReady}`;
}
const shown = (env, minutes, lines) => ({ ok: true, minutes, ends: clock.dateOf(mechanics.readClock(env.state).minutes + minutes), lines, formula: [] });

// 压境 (打磨): cultivating at a full gate. Time passes, progress stays, the days count toward the gate.
function polish(env, verb, upTo = null) {
  if (!polishing(env)) return null;
  const c = mechanics.cultivator(env);
  const key = ORDER[mechanics.gateOf(c).target];
  const rule = GATES.foundation.polish;
  const per = stepDaysOf(c.major) * rule.perPoint;
  const before = polishedDays(env, key);
  const ways = [given(verb.days), given(verb.until), verb.full === true].filter(Boolean).length;
  if (ways > 1) return { refused: '打磨的时长只写一样：日数、到哪一天，或打磨到压境满为止' };
  // 压境 at its most and the gate waiting for more than its cooldown: nothing to add, at any length
  const out = spent(env);
  if (out) return { refused: out };
  const missing = lacking(env);
  let days;
  if (verb.full === true) {
    days = Math.ceil(rule.most * per - before);
    // 压境 already counts its most: more days add nothing to the foundation. When all the gate still
    // waits for is its cooldown, 修满为止 sits it out (the long playtest's button-presser was refused
    // here over and over until that day).
    if (days < 1) days = cooldownOnly(env) - today(env);
  }
  else if (given(verb.days)) days = /^\d{1,9}$/.test(String(verb.days).trim()) ? Number(verb.days) : 0;
  else {
    const target = clock.dayOfDate(verb.until);
    days = target === null ? 0 : target - today(env);
  }
  if (!(days >= 1)) return { refused: '打磨要写日数、到哪一天，或打磨到压境满为止' };
  const minutes = upTo === null ? days * DAY : Math.max(DAY, Math.min(days * DAY, Math.floor(upTo / DAY) * DAY));
  days = minutes / DAY;
  const overrun = clock.overrun(env, minutes);
  if (overrun) return { refused: `打磨${chronicle.spanText(minutes)}${overrun}` };
  const pointsBefore = polishPoints(env, key, c);
  const pointsAfter = Math.min(rule.most, Math.floor((before + days) / per));
  const lines = [`修为已满，压境打磨${chronicle.spanText(minutes)}。`, pointsAfter > pointsBefore ? `压境的根基 ${pointsBefore}→${pointsAfter} 分。` : `压境的根基仍是 ${pointsAfter} 分。`,
    ...(missing ? [`${missing}。`] : [])];
  return {
    minutes,
    receipt: { kind: 'polish', ok: true, source: 'verb', polish: { gate: key, days, before, after: before + days, points: { before: pointsBefore, after: pointsAfter } },
      commands: '', owns: ownsNothing(), summary: '' },
    line: ['polish', { 地点: chronicle.placeName(env.state), 时长: chronicle.spanText(minutes) }],
    preview: shown(env, minutes, lines),
    finish: receipt => {
      env.play.gates = { ...(env.play.gates && typeof env.play.gates === 'object' ? env.play.gates : {}) };
      env.play.gates[key] = { ...(env.play.gates[key] || {}), extra: before + days };
      receipt.summary = `压境打磨${days}日：${key}的压境 ${before}→${before + days}日，根基 ${pointsBefore}→${pointsAfter} 分；时间 ${receipt.time.before}→${receipt.time.after}`;
    },
  };
}

function breakthrough(env, verb) {
  const aids = Array.isArray(verb.aids) ? verb.aids : [];
  const found = judge(env, { aids });
  if (found.beyond) return { refused: GATES.beyond };
  // The old rule judges progress, root, method, cooldown and lifespan; the gate adds its own.
  const own = found.requires.filter(each => !each.met && ['cap', 'mind', 'chance'].includes(each.key));
  if (own.length) return { refused: own.map(each => `${each.label}：${each.text}`).join('；') };
  if (aids.length && poison.full(env)) return { refused: `丹毒已到${chronicle.numeral(poison.capOf(env))}，服不下辅助丹药了` };
  const grade = gradeOf(found.foundation.points);
  const demons = karma.demons(env, found.gate);
  const seeded = { ...env, seed: env.seedOf({ kind: 'gate', gate: found.gate }) };
  const major = mechanics.cultivator(env).major;
  // the terms beyond the die's attributes and the pills, by name (护法, 灵地, 心结, 瓶颈, the perks', the heart
  // demons'): the card and the summary say each (the second long run: 灵地 +1 was in the total, on no line)
  const named = found.terms.filter(term => !(term.label in found.modifiers) && term.label !== '丹药')
    .concat(demons.penalty ? [{ label: '心魔', value: demons.penalty }] : []);
  const receipt = mechanics.breakthrough(seeded, { aid_item_ids: aids }, 'verb', 0,
    { odds: found.extra + demons.penalty, terms: named, growth: grade.growth, foundation: grade.name, moveClock: false, totals: gear.totals,
      modifiers: found.modifiers, dc: found.dc, aidBonus: GATES.odds.pill.bonus, stepDays: stepDaysOf(major) });
  if (!receipt.ok) return { refused: receipt.reason };
  // The attempt is over before the lifespan's last day or not made (plan item 49: every stretch
  // stops on that day; an attempt is not cut short).
  const end = clock.lifespanEnd(env);
  if (end !== null && receipt.time.minutes > (end - today(env)) * DAY) {
    const last = clock.dateOf(end * DAY);
    return { refused: `冲关要${chronicle.spanText(receipt.time.minutes)}，撑不到出关：寿元到${chronicle.numeral(last.year)}年${last.text}用尽` };
  }
  const check = receipt.breakthrough;
  const succeeded = check.realm.after !== check.realm.before;
  // A failure costs years too: the realm's lifespan (cultivation.json) times gates.json failure.lifespan.
  let lost = 0;
  if (!succeeded) {
    const before = mechanics.numberIn(env.ctx.parseRemarksString(env.state['0']?.B1?.['9'])['寿元']);
    lost = before === null ? 0 : Math.round((CULTIVATION.lifespan[ORDER[major]] ?? 0) * (GATES.failure.lifespan[check.outcome] ?? 0));
    if (lost > 0) {
      check.lifespan = { before, after: before - lost };
      receipt.commands = [receipt.commands, `add("B1",${JSON.stringify({ 9: { 寿元: String(before - lost) } })})`].filter(Boolean).join('\n');
      receipt.summary += `；折寿${chronicle.numeral(lost)}年，寿元 ${before}→${before - lost}`;
    }
  }
  // 延年 and its like keep their years when a new realm sets the lifespan to its floor.
  const years = perks.effectsOf(env, 'lifespan').reduce((sum, effect) => sum + effect.value, 0);
  if (succeeded && check.lifespan && years) {
    check.lifespan = { ...check.lifespan, after: check.lifespan.after + years };
    receipt.commands = [receipt.commands, `add("B1",${JSON.stringify({ 9: { 寿元: String(check.lifespan.after) } })})`].filter(Boolean).join('\n');
  }
  receipt.gate = { gate: found.gate, name: found.name, odds: found.odds, extra: found.extra, foundation: grade.name,
    ...(found.bottleneck.penalty ? { penalty: found.bottleneck.penalty } : {}), ...(lost ? { lifespanLost: lost } : {}) };
  if (demons.rolls.length) {
    receipt.demons = demons.rolls;
    receipt.summary = demons.rolls.map(each => `心魔（${each.knot.kind}：${each.knot.what}）：${each.check.rule}检定1d${each.check.die}=${each.check.roll}，`
      + `修正${each.check.modifier >= 0 ? '+' : ''}${each.check.modifier}，总值${each.check.total}（难度${each.check.dc}）→${each.check.outcome}，${each.check.consequence}`)
      .join('；') + `；${receipt.summary}`;
  }
  const minutes = receipt.time.minutes;
  const rule = karma.RULES.demons;
  const lines = [`冲击${found.name}，成算${found.odds}%，耗时${chronicle.spanText(minutes)}。`, `此时冲关，根基${grade.name}。`,
    ...(demons.rolls.length ? [`${chronicle.count(demons.rolls.length)}桩心结化作心魔：每一拍一次${rule.attribute}的检定（${rule.tier}），败一拍，这次冲关再减${chronicle.numeral(-rule.fail)}。`] : [])];
  return {
    minutes, receipt,
    line: ['breakthrough', { 关: found.name, 成败: succeeded ? '成' : '未成', 境界: succeeded ? check.to : '', 根基: succeeded ? grade.name : '' }],
    // The preview gives the chance, never the roll.
    preview: { ...shown(env, minutes, lines), formula: found.terms.map(term => ({ label: term.label, value: `${term.value >= 0 ? '+' : ''}${term.value}` })) },
    finish: async settled => {
      if (succeeded) {
        // a major gate passed closes the book's volume (book.cjs, item 38): its page's words are the model's
        settled.volume = book.shown(book.turn(env, { kind: 'gate', name: found.name }));
        env.play.foundation = { ...(env.play.foundation && typeof env.play.foundation === 'object' ? env.play.foundation : {}), [found.gate]: grade.name };
        if (env.play.gates?.[found.gate]) {
          const { [found.gate]: _done, ...rest } = env.play.gates;
          env.play.gates = rest;
        }
        const band = rules.modifierFor(gear.totals(env, 'B1', mechanics.readStats(env, 'B1'))['气运']);
        // A clock that rises with every major realm broken (clocks.json rises realm: 残魂夺舍).
        const risen = require('./clocks.cjs').react(env, { kind: 'realm' });
        if (risen.length) settled.clocks = risen;
        const offered = perks.offer(env, { gate: found.gate, foundation: grade.name, band });
        settled.summary += offered?.length ? `；悟得三选一：${offered.map(each => each.name).join('、')}` : '';
      } else {
        const day = settled.frxProgress?.breakthroughCooldownDay;
        if (Number.isInteger(day)) calendar.register(env, 'cooldown', { date: clock.dateKey(day) });
        // one more failure at this gate (a pill taken or a 机缘 had cleared those before)
        const record = env.play.gates?.[found.gate] || {};
        const failed = (found.bottleneck.cleared ? 0 : found.bottleneck.failed) + 1;
        env.play.gates = { ...(env.play.gates && typeof env.play.gates === 'object' ? env.play.gates : {}), [found.gate]: { ...record, failed } };
      }
      await poison.breakthrough(env, { succeeded, aids: check.aids });
    },
  };
}

// ---------------------------------------------------------------- the 机缘

// The gate ahead: { key, rule } (gates.json), or null past the last gate.
function ahead(env) {
  const gate = mechanics.gateOf(mechanics.cultivator(env));
  const key = gate ? ORDER[gate.target] : null;
  return key && GATES.gates[key] ? { key, rule: GATES.gates[key] } : null;
}

function chanceWanted(env) {
  const found = ahead(env);
  return found && found.rule.requires.includes('chance') && !env.play?.gates?.[found.key]?.chance ? found.key : null;
}

function grantChance(env, { from, scene = null, reason = '' } = {}) {
  const found = ahead(env);
  if (!found) return { refused: GATES.chance.beyond };
  if (env.play?.gates?.[found.key]?.chance) return { refused: chronicle.fill(GATES.chance.had, { 关: found.rule.name }) };
  const gates = env.play.gates && typeof env.play.gates === 'object' ? env.play.gates : {};
  const chance = { from, date: clock.dateKey(clock.today(env)), ...(scene ? { scene } : {}), ...(reason ? { reason } : {}) };
  env.play.gates = { ...gates, [found.key]: { ...(gates[found.key] || {}), chance } };
  return { gate: found.key, name: found.rule.name };
}

async function chanceOp(env, args = {}) {
  const scene = env.play?.scene;
  if (!scene) return env.refuse(GATES.chance.outside);
  const reason = [...plain(String(args.reason ?? '')).trim()].slice(0, GATES.chance.reasonMax).join('');
  if (!reason) return env.refuse(GATES.chance.unsaid);
  const granted = grantChance(env, { from: 'story', scene: scene.id, reason });
  if (granted.refused) return env.refuse(granted.refused);
  chronicle.write(env, 'gateChance', { 关: granted.name, 缘由: reason });
  await env.settle({ kind: 'chance', ok: true, source: 'engine', chance: { gate: granted.gate, name: granted.name, from: 'story', reason },
    commands: '', owns: ownsNothing(), summary: `得了一桩冲击${granted.name}的机缘：${reason}` });
  return { chance: { gate: granted.gate, name: granted.name } };
}

// ---------------------------------------------------------------- the pool and the wiring

function pool(env) {
  const c = mechanics.cultivator(env);
  const grade = env.play?.foundation?.[ORDER[c.major]];
  const found = GATES.foundation.grades.find(each => each.name === grade);
  return found?.speed ? [{ label: `根基${found.name}`, value: found.speed }] : [];
}

let installed = false;
function install(verbs, speed) {
  if (installed) return;
  installed = true;
  verbs.VERBS.breakthrough = breakthrough;
  verbs.hooks.polishing = polishing;
  verbs.hooks.polish = polish;
  verbs.hooks.spent = spent;
  verbs.hooks.polishLabel = GATES.polishLabel;
  verbs.hooks.polishNote = lacking;
  speed.POOL.push(pool);
}

module.exports = { GATES, sheet, summary, lacking, polishing, spent, polish, breakthrough, pool, install, gradeOf, oddsWith, bottleneckOf,
  chanceWanted, grantChance, chanceOp };
