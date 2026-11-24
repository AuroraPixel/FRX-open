'use strict';
/* Secret realms (秘境, 玩法设计第六节「秘境」; plan item 32): a node map entered while the realm is
 * open, walked one layer at a time, with a deadline. The realms and the numbers are
 * content/life/realms.json; what a 宝 gives is the rewards table's 秘境 (rewards.roll).
 *
 * frxPlay.realm, null outside one:
 *   { id, name, place, opening, until, entered, depth, layers: [[{ id: "2-1", kind }]], at, path,
 *     others: [{ id, name, side: mate | rival, picks: [node id], takes: [node id], waits }],
 *     taken: [{ id, name, class, count }], guard: null | { node, foe }, cleared, met: [id] }
 *   opening the day this opening began and until the day it is closed again ("0003-05-10"); at how
 *   many layers are behind the player (the next is layers[at]); path the nodes taken; taken what
 *   the 宝 gave; guard the 守's fight while its outcome is still to be read; cleared the 守 beaten;
 *   met the rivals who waited at the exit and were faced.
 * frxPlay.realmsDone { <realm id>: <opening> }: an opening entered once is not entered again.
 *
 * generate(id, opening) → { depth, layers }: the map of one opening, seeded by the realm's id and
 *   the opening's date only, so everyone in that opening sees the same map: depth layers (layers
 *   in realms.json), width nodes each, the deepest a single 守, rests 歇 in the layers between the
 *   first and the deepest (in different layers where it can), the rest drawn by weights.
 * The op "realm", args { action, realm?, node? } → { realm: view | null, fight?: view }:
 *   enter  { realm }: the realm must be open today (its fixed calendar event, calendar.openNow),
 *          the player at its place, of its realm (requires.major) and identity (a word of
 *          requires.identity in the identity column), and not yet in this opening. Makes the map,
 *          picks the others, puts its closing day on the calendar (an own entry "realm").
 *   node   { node }: a node of the next layer. The way there takes move.hours; past the closing day
 *          the player is sent out instead (below). Then by its kind:
 *            战  a fight (fight.open) with a foe drawn from the realm's fights
 *            险  a check priced as a card of nodes.险.kind; failing takes 气血 as that check's harm
 *            宝  what rewards.roll gives for 秘境 there, behind a check of nodes.宝.kind on the
 *                guarded ones; empty when someone inside took it first
 *            歇  one rest of nodes.歇.hours (mechanics.rest, as the rest verb)
 *            秘  a scene opens (scene.open, origin realm)
 *            守  a fight with the guardian; beaten, it leaves a second roll of 秘境 (read at the next
 *                op, once the fight is over)
 *          Refused while a fight, a scene or an encounter is on.
 *   leave  past the deepest layer: a rival waiting at the exit is faced first (a fight, its
 *          ambush); then the player is out (below).
 *   view   no args: the view.
 * Out (left, or sent out at the closing day): the herbs (herbs.class) still in the bag that the
 *   realm gave are sold at the catalogue's base price into the purse (until plan item 46 hands them
 *   to the sect), the chronicle gets its line, the calendar entry goes and frxPlay.realm is null.
 *   Receipts are of kind "realm" (action enter, node, check, loot, leave, shut).
 * Inside, the standing verbs wait (install: verbs.hooks.hold): 气血 and 法力 come back only at 歇.
 * The others: each walks a layer a day from the opening day, picks a node of each layer by the
 *   seed and takes a 宝 it picked with others.takes percent; reaching a layer after one of them
 *   took its 宝, the player finds it empty. A rival with waits stands at the exit once through.
 * view(env) → null | { id, name, until: date, daysLeft, depth, at, exit, layers: [[{ id, kind?,
 *   glyph?, state }]], others: [{ id, name, side, layer }], taken: [{ name, count }] }: state is
 *   walked (on the path), open (in the next layer: its kind shows), passed (a layer behind, not
 *   taken), hidden (deeper: its kind does not show, but for the deepest 守).
 */
const mechanics = require('../mechanics.cjs');
const rules = require('../turn-rules.cjs');
const { plain } = require('../item-use.cjs');
const { create } = require('../core/random.cjs');
const actions = require('./actions.cjs');
const calendar = require('./calendar.cjs');
const chronicle = require('./chronicle.cjs');
const clock = require('./clock.cjs');
const encounter = require('./encounter.cjs');
const fight = require('./fight.cjs');
const goods = require('./goods.cjs');
const places = require('./places.cjs');
const rewards = require('./rewards.cjs');
const scene = require('./scene.cjs');
const { data } = require('./data.cjs');
const { list, ownsNothing } = require('./play.cjs');

const REALMS = data('realms');
const FOES = data('foes');
const ENCOUNTERS = FOES.encounters;
const DAY = clock.DAY_MINUTES;
const SUCCESS = ['大成功', '成功'];
const J = JSON.stringify;

const rowName = row => plain(row?.['1']).split('|')[0];
const identityOf = row => plain(row?.['2']).split('|').slice(1).join('|');
const between = (random, [low, high]) => low + Math.floor(random.random() * (high - low + 1));

function weighted(random, weights) {
  const entries = Object.entries(weights);
  let left = random.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of entries) if ((left -= weight) < 0) return name;
  return entries.at(-1)[0];
}

// ---------------------------------------------------------------- the map

function generate(id, opening) {
  const spec = REALMS.realms[id];
  const random = create(`realm:${id}:${opening}`);
  const depth = between(random, spec.layers);
  const layers = [];
  for (let n = 1; n < depth; n += 1) {
    const width = between(random, spec.width);
    layers.push(Array.from({ length: width }, (_, i) => ({ id: `${n}-${i + 1}`, kind: weighted(random, spec.weights) })));
  }
  layers.push([{ id: `${depth}-1`, kind: '守' }]);
  // The rests: in the layers between the first and the deepest, each in a layer of its own while
  // there are layers enough.
  const middle = layers.slice(1, -1);
  const rests = Math.min(between(random, spec.rests), middle.reduce((sum, layer) => sum + layer.length, 0));
  const order = middle.map((_, i) => i).sort(() => random.random() - 0.5);
  for (let n = 0; n < rests; n += 1) {
    const layer = middle[order[n % order.length]];
    const free = layer.filter(node => node.kind !== '歇');
    free[Math.floor(random.random() * free.length)].kind = '歇';
  }
  return { depth, layers };
}

// ---------------------------------------------------------------- who else is inside

const sectNames = Object.entries(places.mapFacts().reduce((all, poi) => (poi.kind === '宗门' ? { ...all, [poi.name]: true } : all), {})).map(([name]) => name);
const sectOf = row => sectNames.find(name => identityOf(row).includes(name)) || null;
function admission(env, row, spec, player = false) {
  const { major, minMajor, identity } = spec.requires;
  const rank = mechanics.parseRealm(row?.['2']).major;
  const order = mechanics.COMBAT.realms.order;
  if (minMajor != null && rank < minMajor) return `${spec.name}只许${order[minMajor]}期及以上的修士进`;
  if (major != null && rank !== major) return `${spec.name}只许${order[major]}期的人进`;
  if (identity?.length && !identity.some(word => identityOf(row).includes(word))
      && !(player && require('./sect.cjs').disciple(env))) return `${spec.name}只许宗门弟子进`;
  return null;
}

const fits = (env, row, spec) => !admission(env, row, spec) && !mechanics.isFallen(env.ctx, row);

function othersOf(env, realm, spec) {
  const mine = sectOf(env.state['0']?.B1);
  const seen = new Map();
  for (const [id, row] of Object.entries(env.state['0'] || {})) if (/^[CG]/.test(id) && row) seen.set(id, row);
  for (const [id, row] of Object.entries(env.biographies || {})) if (!seen.has(id) && row) seen.set(id, row);
  const ties = env.play.ties && typeof env.play.ties === 'object' ? env.play.ties : {};
  const others = [];
  for (const [id, row] of seen) {
    if (others.length >= spec.others.most || !fits(env, row, spec)) continue;
    const random = create(`realm:${realm.id}:${realm.opening}:${id}`);
    const hostile = ['对头', '仇家'].includes(ties[id]?.kind);
    const side = !hostile && mine && sectOf(row) === mine ? 'mate' : 'rival';
    const picks = realm.layers.map(layer => layer[Math.floor(random.random() * layer.length)].id);
    const takes = picks.filter(node => kindAt(realm, node) === '宝' && random.random() * 100 < spec.others.takes);
    others.push({ id, name: rowName(row), side, picks, takes, waits: side === 'rival' && random.random() * 100 < spec.others.waits });
  }
  return others;
}

const kindAt = (realm, node) => realm.layers.flat().find(each => each.id === node)?.kind ?? null;
const layerOf = node => Number(String(node).split('-')[0]);
const minuteOf = key => clock.dayOfDate(key) * DAY;
// The moment someone inside reaches a layer (1-based): a layer a day from the opening day.
const reaches = (realm, layer) => minuteOf(realm.opening) + (layer - 1) * DAY;

// ---------------------------------------------------------------- the view

function view(env) {
  const realm = env.play?.realm;
  if (!realm) return null;
  const now = env.clock?.()?.minutes ?? mechanics.readClock(env.state)?.minutes ?? 0;
  const until = clock.dayOfDate(realm.until);
  const layers = realm.layers.map((layer, i) => layer.map(node => {
    const state = realm.path.includes(node.id) ? 'walked' : i < realm.at ? 'passed' : i === realm.at ? 'open' : 'hidden';
    const shown = state !== 'hidden' || node.kind === '守';
    return { id: node.id, ...(shown ? { kind: node.kind, glyph: REALMS.nodes[node.kind].glyph } : {}), state };
  }));
  const reached = Math.floor((now - minuteOf(realm.opening)) / DAY) + 1;
  return {
    id: realm.id, name: realm.name, until: clock.dateOf(until * DAY), daysLeft: Math.max(0, until - Math.floor(now / DAY)),
    depth: realm.depth, at: realm.at, exit: Boolean(REALMS.realms[realm.id].earlyExit || realm.at >= realm.depth), layers,
    others: realm.others.map(other => ({ id: other.id, name: other.name, side: other.side, layer: Math.max(0, Math.min(realm.depth, reached)) })),
    taken: realm.taken.map(item => ({ name: item.name, count: item.count })),
  };
}

// ---------------------------------------------------------------- out

// The herbs the realm gave that are still in the bag: handed to the player's sect for contribution
// and 筑基丹 (sect.handIn, plan item 46); with no sect, sold at the catalogue's base price.
function herbsOut(env, realm, commands, owns) {
  const herbs = realm.taken.filter(item => item.class === REALMS.herbs.class);
  if (!herbs.length) return 0;
  const stored = env.ctx.storedItemIds(env.state);
  const member = !!require('./sect.cjs').sectOf(env);
  const handed = [];
  let stones = 0;
  for (const herb of herbs) {
    const found = Object.entries(env.state['1'] || {}).find(([id, row]) => row && !stored.has(id) && rowName(row) === herb.name);
    if (!found) continue;
    const [id, row] = found;
    const have = env.ctx.itemStackCount(row['5']);
    const sold = Math.min(herb.count, Number.isSafeInteger(have) ? have : 0);
    if (!sold) continue;
    commands.push(have > sold ? `add(${J(id)},{"5":"${have - sold}"})` : `de(${J(id)})`);
    owns.items.push(id);
    if (member) handed.push({ name: herb.name, count: sold });
    else stones += sold * (goods.byId(herb.id)?.price ?? 0);
  }
  if (member) {
    realm.handed = require('./sect.cjs').handIn(env, handed, commands, owns);
    return 0;
  }
  if (stones) {
    commands.push(`add("B1",{"26":"${(mechanics.stonesOf(env.state['0']?.B1) ?? 0) + stones}"})`);
    owns.currency = true;
  }
  return stones;
}

async function out(env, how) {
  const realm = env.play.realm;
  const commands = [], owns = ownsNothing();
  const stones = REALMS.realms[realm.id].keepHerbs ? 0 : herbsOut(env, realm, commands, owns);
  const handed = realm.handed;
  const brought = stones ? `灵草折成灵石${chronicle.count(stones)}块`
    : handed ? `灵草${chronicle.count(handed.herbs)}株交给宗门，得贡献${chronicle.count(handed.contribution)}` + (handed.pills ? `、筑基丹${chronicle.count(handed.pills)}枚` : '') : '';
  chronicle.write(env, how === 'shut' ? 'realmShut' : 'realmLeave', { 名: realm.name, 带出: brought });
  const entry = list(env.play.calendar).find(each => each.kind === 'own' && each.type === 'realm');
  if (entry) calendar.remove(env, entry.id);
  env.play.realmsDone = { ...(env.play.realmsDone && typeof env.play.realmsDone === 'object' ? env.play.realmsDone : {}), [realm.id]: realm.opening };
  env.play.realm = null;
  await env.settle({ kind: 'realm', ok: true, source: 'engine', action: how, realm: { id: realm.id, name: realm.name, at: realm.at, depth: realm.depth },
    ...(stones ? { stones } : {}), ...(handed ? { handed } : {}), commands: commands.join('\n'), owns,
    summary: `${how === 'shut' ? `${realm.name}关闭，被送了出来` : `出${realm.name}`}` + (brought ? `；${brought}` : '') });
  return { realm: null, out: how };
}

// The closing day passed: sent out at its first moment (the clock moves there when it is behind).
async function shut(env) {
  const realm = env.play.realm;
  const now = env.clock().minutes, closing = minuteOf(realm.until);
  if (now < closing) {
    const moved = { kind: 'realm', ok: true, source: 'engine', action: 'close', realm: { id: realm.id }, commands: '', owns: ownsNothing(), summary: '' };
    await clock.advance(env, closing - now, moved);
    moved.summary = `${realm.name}到了关闭的时候：时间 ${moved.time.before}→${moved.time.after}`;
  }
  return out(env, 'shut');
}

// ---------------------------------------------------------------- the nodes

// A check of the realm, priced as a card of `kind` (deeper layers a tier harder) and rolled on the
// timeline seed of the node.
function check(env, realm, node, kind) {
  const deep = layerOf(node.id) > realm.depth / 2;
  const card = actions.price(actions.contextOf(env, { target: '' }), { kind, title: `${REALMS.nodes[node.kind].glyph}·${node.id}`, tier: deep ? '难' : '中' });
  const roll = Math.floor(env.random({ kind: 'check', type: `秘境·${node.kind}`, target: `${realm.id}:${node.id}` }).random() * rules.RULES.die) + 1;
  const total = roll + card.modifier;
  const outcome = rules.checkOutcome(roll, total, card.dc);
  return { card, rolled: { kind: card.kind, rule: card.check, tier: card.tier, dc: card.dc, die: rules.RULES.die, roll, attribute: card.attribute,
    value: card.value, modifier: card.modifier, total, outcome, consequence: actions.CHECKS[card.check].results[outcome].text, effects: [],
    target: null, reason: card.title, rulesVersion: rules.RULES.version } };
}

function hurt(env, card, outcome, commands, owns) {
  const percent = actions.CHECKS[card.check]?.results?.[outcome]?.damagePercent?.[card.tier];
  if (!percent) return null;
  const stats = mechanics.readStats(env, 'B1');
  const before = mechanics.statValue(stats['血量']), max = mechanics.statValue(stats['血量'], 'max');
  if (max <= 0) return null;
  const damage = Math.min(before, Math.ceil(max * percent / 100));
  commands.push(`updateAttribute("B1","血量",{"current":${before - damage},"max":${max}})`);
  owns.stats.push('血量');
  return { stat: '血量', before, after: before - damage, max, damage };
}

async function loot(env, realm, target, nth = 1) {
  const spec = REALMS.realms[realm.id];
  const items = rewards.roll(env, '秘境', { tier: spec.tier, place: spec.place, danger: spec.danger, target: `${realm.id}:${target}`, nth }).items;
  if (nth === 2) {
    items.push(...list(spec.guardian.goods).map(id => rewards.itemOf(goods.byId(id), 1)));
  }
  const made = rewards.grant(env, items);
  for (const item of items) realm.taken.push({ id: item.id, name: item.name, class: item.class, count: item.count });
  return { items, made };
}

// The foe of a 战 or the 守: drawn by the seed of the opening and the node, named uniquely here.
function foeOf(env, realm, node, entry) {
  const spec = REALMS.realms[realm.id];
  const random = create(`realm:${realm.id}:${realm.opening}:${node.id}`);
  const row = entry || (() => {
    let left = random.random() * spec.fights.reduce((sum, each) => sum + each.weight, 0);
    return spec.fights.find(each => (left -= each.weight) < 0) || spec.fights.at(-1);
  })();
  const who = ENCOUNTERS.who[row.who];
  return { name: encounter.nameFor(env, who.names, random), realm: fight.realmOfTier(row.tier, who.people), class: who.class };
}

// What the 守's fight came to, once it is over: beaten, a second roll of 秘境.
async function guardOver(env, realm) {
  if (!realm.guard || env.play.fight) return;
  const row = env.state['0']?.[realm.guard.foe];
  const beaten = !row || mechanics.isFallen(env.ctx, row);
  const node = realm.guard.node;
  realm.guard = null;
  realm.cleared = beaten;
  if (!beaten) return;
  const { items, made } = await loot(env, realm, node, 2);
  await env.settle({ kind: 'realm', ok: true, source: 'engine', action: 'loot', node: { id: node, kind: '守' }, items,
    commands: made.commands.join('\n'), owns: made.owns, summary: `击败「守」，得${goods.listed(items) || '一无所获'}` });
}

async function step(env, realm, picked) {
  const spec = REALMS.realms[realm.id];
  const node = { id: picked.id, kind: picked.kind };
  const shown = { id: node.id, kind: node.kind };
  if (node.kind === '战' || node.kind === '守') {
    const foe = foeOf(env, realm, node, node.kind === '守' ? spec.guardian : null);
    const opened = await fight.open(env, { foes: [foe] });
    if (opened.refused) return { said: opened.refused };
    if (node.kind === '守' && env.play.fight) realm.guard = { node: node.id, foe: env.play.fight.foes[0].id };
    else if (node.kind === '守') realm.cleared = false;
    return { said: `${node.kind === '守' ? '最深处的看守' : '遇敌'}：${foe.name}（${foe.realm}）` };
  }
  if (node.kind === '歇') {
    const hours = REALMS.nodes['歇'].hours;
    const rested = mechanics.rest(env, { kind: data('verbs').rest.kind, hours }, 'engine');
    if (!rested.ok) return { said: rested.reason };
    rested.node = shown;
    await clock.advance(env, hours * 60, rested);
    return { said: `歇了${chronicle.spanText(hours * 60)}` };
  }
  if (node.kind === '秘') {
    const opened = await scene.open(env, { origin: 'realm', title: `${realm.name}·${node.id}` });
    return { said: opened.error ? opened.reason : '撞见一桩秘事' };
  }
  const commands = [], owns = ownsNothing();
  if (node.kind === '险') {
    const { card, rolled } = check(env, realm, node, REALMS.nodes['险'].kind);
    const harm = SUCCESS.includes(rolled.outcome) ? null : hurt(env, card, rolled.outcome, commands, owns);
    if (harm) rolled.effects.push(harm);
    await env.settle({ kind: 'realm', ok: true, source: 'engine', action: 'check', node: shown, check: rolled, commands: commands.join('\n'), owns,
      summary: `闯「险」：${rolled.kind}检定1d${rolled.die}=${rolled.roll}，总值${rolled.total}（难度${rolled.dc}）→${rolled.outcome}` + (harm ? `；气血 ${harm.before}→${harm.after}` : '') });
    return { said: rolled.outcome };
  }
  // 宝: empty when someone inside got there first and took it.
  const by = realm.others.find(other => other.takes.includes(node.id) && reaches(realm, layerOf(node.id)) < env.clock().minutes);
  if (by) {
    await env.settle({ kind: 'realm', ok: true, source: 'engine', action: 'loot', node: shown, empty: { id: by.id, name: by.name }, items: [],
      commands: '', owns, summary: `「宝」已被${by.name}先一步取走` });
    return { said: `已被${by.name}取走` };
  }
  const guarded = create(`realm:${realm.id}:${realm.opening}:${node.id}:guard`).random() * 100 < REALMS.nodes['宝'].guarded;
  let rolled = null;
  if (guarded) {
    rolled = check(env, realm, node, REALMS.nodes['宝'].kind).rolled;
    if (!SUCCESS.includes(rolled.outcome)) {
      await env.settle({ kind: 'realm', ok: true, source: 'engine', action: 'loot', node: shown, check: rolled, items: [], commands: '', owns,
        summary: `「宝」有禁制守着：${rolled.kind}检定→${rolled.outcome}，没能拿到` });
      return { said: rolled.outcome };
    }
  }
  const { items, made } = await loot(env, realm, node.id);
  await env.settle({ kind: 'realm', ok: true, source: 'engine', action: 'loot', node: shown, ...(rolled ? { check: rolled } : {}), items,
    commands: made.commands.join('\n'), owns: made.owns, summary: `取「宝」：${goods.listed(items) || '一无所获'}` });
  return { said: goods.listed(items) };
}

// ---------------------------------------------------------------- the op

const busy = env => (env.play.fight ? '先打完眼前这一场' : env.play.scene ? '这场戏还没收场' : env.play.encounter ? '眼前撞上的事还没了' : null);

async function enter(env, args) {
  if (env.play.realm) return env.refuse('已经在秘境里了');
  const id = plain(args.realm);
  const spec = REALMS.realms[id];
  if (!spec) return env.refuse('没有这处秘境');
  const why = busy(env);
  if (why) return env.refuse(why);
  const open = calendar.openNow(env, spec.calendar);
  if (!open) return env.refuse(`${spec.name}眼下没有开启`);
  const opening = clock.dateKey(open.day);
  if (env.play.realmsDone?.[id] === opening) return env.refuse(`这一次的${spec.name}已经进过了`);
  if (places.placeFacts(env).place !== spec.place) return env.refuse(`要先到${spec.place}`);
  const reason = admission(env, env.state['0']?.B1, spec, true);
  if (reason) return env.refuse(reason);
  require('./saga.cjs').enteredRealm(env, spec.calendar, opening);
  const map = generate(id, opening);
  const realm = { id, name: spec.name, place: spec.place, opening, until: clock.dateKey(open.until), entered: clock.dateKey(clock.today(env)),
    depth: map.depth, layers: map.layers, at: 0, path: [], others: [], taken: [], guard: null, cleared: false, met: [] };
  realm.others = othersOf(env, realm, spec);
  env.play.realm = realm;
  calendar.register(env, 'realm', { date: realm.until, title: `${spec.name}关闭`, place: spec.place });
  chronicle.write(env, 'realmEnter', { 名: spec.name, 层: chronicle.count(realm.depth) });
  await env.settle({ kind: 'realm', ok: true, source: 'engine', action: 'enter', realm: { id, name: spec.name, depth: realm.depth, until: realm.until },
    commands: '', owns: ownsNothing(), summary: `入${spec.name}：${chronicle.count(realm.depth)}层，${clock.dateOf(open.until * DAY).text}关闭` });
  return { realm: view(env) };
}

async function nodeOp(env, args) {
  const realm = env.play.realm;
  if (!realm) return env.refuse('不在秘境里');
  const why = busy(env);
  if (why) return env.refuse(why);
  await guardOver(env, realm);
  if (realm.at >= realm.depth) return env.refuse('已到最深处，可以出去了');
  const picked = realm.layers[realm.at].find(each => each.id === plain(args.node));
  if (!picked) return env.refuse('只能选下一层的节点');
  const minutes = REALMS.move.hours * 60;
  if (env.clock().minutes + minutes >= minuteOf(realm.until)) return shut(env);
  const moved = { kind: 'realm', ok: true, source: 'engine', action: 'node', node: { id: picked.id, kind: picked.kind }, commands: '', owns: ownsNothing(), summary: '' };
  await clock.advance(env, minutes, moved);
  realm.at += 1;
  realm.path.push(picked.id);
  const done = await step(env, realm, picked);
  moved.summary = `${realm.name}第${chronicle.numeral(realm.at)}层「${picked.kind}」：${done.said}；时间 ${moved.time.before}→${moved.time.after}`;
  return { realm: view(env), ...(env.play.fight ? { fight: fight.view(env) } : {}) };
}

async function leave(env) {
  const realm = env.play.realm;
  if (!realm) return env.refuse('不在秘境里');
  const why = busy(env);
  if (why) return env.refuse(why);
  await guardOver(env, realm);
  if (env.clock().minutes >= minuteOf(realm.until)) return shut(env);
  if (realm.at < realm.depth) {
    return REALMS.realms[realm.id].earlyExit ? out(env, 'leave') : env.refuse('出口在最深处，还没走到');
  }
  const now = env.clock().minutes;
  const waiting = realm.others.find(other => other.waits && !realm.met.includes(other.id) && reaches(realm, realm.depth + 1) <= now);
  if (waiting) {
    realm.met.push(waiting.id);
    const opened = await fight.open(env, { foes: [waiting.id], ambush: 'foes' });
    if (!opened.refused) return { realm: view(env), ...(env.play.fight ? { fight: fight.view(env) } : {}) };
  }
  return out(env, 'leave');
}

const ACTIONS = { enter, node: nodeOp, leave, view: async env => ({ realm: view(env) }) };

async function op(env, args) {
  const action = String(args.action ?? '');
  if (!Object.hasOwn(ACTIONS, action)) return env.refuse('秘境里没有这一步');
  return ACTIONS[action](env, args);
}

let installed = false;
function install(verbs) {
  if (installed) return;
  installed = true;
  const before = verbs.hooks.hold;
  verbs.hooks.hold = (env, kind) => before(env, kind) || (env.play?.realm ? `身在${env.play.realm.name}，只能往深处走或出去` : null);
}

// ---------------------------------------------------------------- the entrance where the player is

// The secret realm whose entrance is the player's map place, for the place view (play.place.realm):
// { id, name, open, until?, next?, off?, note? }: open while its calendar event is (until: the day
// it closes, in words and numbers), else the day it next opens (next); off with the reason enter
// would give when it cannot be entered now (closed, already entered this opening, the realm or the
// identity it asks for, inside one already). Null where no realm's entrance is.
function entrance(env) {
  const here = places.placeFacts(env).place;
  const found = here ? Object.entries(REALMS.realms).find(([, spec]) => spec.place === here) : null;
  if (!found) return null;
  const [id, spec] = found;
  const open = calendar.openNow(env, spec.calendar);
  const fixed = calendar.CALENDAR.fixed.find(each => each.id === spec.calendar);
  const coming = !open && fixed ? calendar.nextOpen(env, fixed, clock.today(env)) : null;
  const note = env.play.realm ? '已经在秘境里了'
    : !open ? `${spec.name}眼下没有开启`
    : env.play.realmsDone?.[id] === clock.dateKey(open.day) ? `这一次的${spec.name}已经进过了`
    : admission(env, env.state['0']?.B1, spec, true);
  return { id, name: spec.name, open: !!open,
    ...(open ? { until: clock.dateOf(open.until * DAY) } : {}),
    ...(coming ? { next: clock.dateOf(coming.day * DAY) } : {}),
    ...(note ? { off: true, note } : {}) };
}

module.exports = { REALMS, generate, view, op, install, entrance };
