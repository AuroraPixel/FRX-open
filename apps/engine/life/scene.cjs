'use strict';
/* A scene (一场戏) of the cultivation-life play (玩法设计第五节「结构」「收场的结算」; plan item 9): a
 * run of beats the model writes, opened by something that happened and closed with a weight. The
 * engine counts the beats, holds the weight to the rules and settles the close card. The numbers are
 * content/life/scene.json.
 *
 * frxPlay.scene, while a scene is on (null otherwise):
 *   { id: "S3", title, named, origin, beats, openedAt, rolled, start, clocks }
 *   named     the title is the model's (<scene>); until then it is the place's
 *   origin    a key of scene.json `origins`: what opened it (free, interrupt, breakthrough ...)
 *   beats     the model's beats so far; openedAt the clock's minutes when it opened, or null
 *   rolled    a card was rolled in it (act); only then may it close above 小
 *   won       a card rolled 成功 or 大成功 in it: a lead may be proven in it (leads.cjs, item 26)
 *   start     what the player held when it opened: { favour: { C2: 0 }, stones, bag: { 聚气散: 2 } },
 *             for the close card's lines
 *   clocks    the clock moves of the acts in it, as clocks.raiseFor and clocks.bump return them:
 *             [{ id, name, before, after, full?, gone?, started? }], for the close card
 *
 *   light     a small matter's scene (batch 8: scene.json light): { cause } from its opening, and
 *             { ready, couplet?, leave? } once the model wrote, on its first beat, a line of what
 *             comes of each card (the cards' said) and its 回目 (couplet) and a line for leaving;
 *             the server then closes it on the card taken without asking the model again
 *
 * op "scene", args { action, ... }; every action settles a receipt (the scene's state rides on it):
 *   open   { origin, title?, present?, cause? }  opens a scene; refused while one is on, or for an unknown
 *          origin. present: the ids of the people in it from its first beat (a 故人 an event brought,
 *          someone visited): one off the scene comes back from the biography the card keeps (a row
 *          set again, as the story's commands bring someone back), the fallen never; the receipt
 *          names who is there (present [{ id, name }]).
 *          Receipt { kind: "scene", action: "open", scene, present? }. Output { scene, next }
 *          A scene whose origin and cause (the interruption's) are scene.json light's, with no one
 *          brought into it and no one met waiting (an encounter's beat is the engine's), is light.
 *   beat   { title?, close?, couplet?, light? }  one beat the model wrote: counts it, and takes its <scene>
 *          title when the scene has none of the model's yet. `close` is the model's <close> weight: the
 *          scene closes with it, its 回目 the model's <title> (couplet) when book.couplet holds it.
 *          Without a close, wait for the player’s next action. light: the light
 *          scene's lines ({ couplet, leave }: ready), or false: it goes on as any scene (free words,
 *          a beat the model wrote again); a scene that is not light ignores it.
 *          Receipt { kind: "scene", action: "beat", scene, hidden: true }: it carries frxPlay and has
 *          no block of its own. Output { scene, next } or a close's
 *   close  { weight? }        closes now, by default as plainWeight (the 离开 card closes this way)
 *   scene  in an output: { id, title, origin, beats }, what the page shows of it
 *   next   { beat, mayClose, mustClose }: the beat the model writes next, and whether its prompt may
 *          or must ask it to close (ordinary scenes may close on any beat)
 * A scene opens a new 回 (book.opened, item 38): scene.chapter, in the scene's brief.
 * A close settles the close card, receipt { kind: "close", scene, weight, asked, by, lines, notes,
 *   chapter, couplet, fallback?: { given, reason } } (couplet the 回目, the engine's line when the
 *   model's did not hold, fallback saying why):
 *   weight    小, 中 or 大 as held: a scene with no roll is plainWeight; 大 only for a big origin
 *             (else the weight below it); an unknown weight is plainWeight. asked is what was asked
 *   by        model (its <close>), leave (the 离开 card), request
 *   lines     one line each, with where it went: [{ kind, label, before?, after?, change, to, text }]
 *             kind favour (a person's favour), stones (当前灵石), item (a thing in or out of the bag),
 *             clock (a pressure clock moved: before and after over the scene), mind (心境 by the
 *             weight, mind.closed: item 36)
 *   and clears frxPlay.scene and frxPlay.cards. Output { closed: the receipt's scene, weight, lines }.
 *
 * beatTime(before, written) → { text, note }: the time row a beat's story may write in a life save
 *   (plan item 8), for settle.cjs. Not before the time the receipts left (`before`), nor later than
 *   beat.maxMinutes after it; else the old time plus beat.clampMinutes, at the place the story
 *   wrote. text is the row to keep, note why it changed ('' when it did not).
 * open(env, args), close(env, weight, by), noteAct(env, { rolled, won, clocks }) for the other modules:
 *   act marks the scene rolled (and won) and keeps its clock moves with noteAct, and closes it on the
 *   离开 card.
 */
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const { data } = require('./data.cjs');
const chronicle = require('./chronicle.cjs');
const mind = require('./mind.cjs');
const book = require('./book.cjs');

const SCENE = data('scene');
const LIGHT = SCENE.light;
// What other modules do as a scene closes, once frxPlay.scene is cleared (threads.cjs: the threads
// the scene took up are open again).
const hooks = { closed: () => {} };
const ownsNothing = () => ({ items: [], stats: [], forbid: [], charStats: [], skills: [], quests: [], grants: [], currency: false });
const rowName = row => plain(row?.['1']).split('|')[0];
const titleOf = text => [...plain(text)].slice(0, SCENE.title.maxLength).join('');
const brief = scene => ({ id: scene.id, title: scene.title, origin: scene.origin, beats: scene.beats,
  ...(scene.chapter ? { chapter: scene.chapter } : {}) });
// Numbers in the card's lines: a minus sign, not a hyphen.
const num = n => (n < 0 ? `−${-n}` : String(n));
const signed = n => (n > 0 ? `+${n}` : num(n));

// A line the model wrote of what comes of a card in a light scene (or of leaving it): one or two
// sentences, light.said.least to light.said.most characters, no tags; '' when it is none.
function saidLine(text) {
  const line = plain(text).replace(/\s+/g, ' ').trim();
  const length = [...line].length;
  if (!line || /[<>]/.test(line) || length < LIGHT.said.least || length > LIGHT.said.most) return '';
  return line;
}

function next(scene) {
  const beat = scene.beats + 1;
  return { beat, mayClose: true, mustClose: false };
}

// What the player holds, for the close card: each person's favour, the stones, the bag by name.
function holdings(env) {
  const favour = {}, names = {}, bag = {};
  for (const [id, row] of Object.entries(env.state['0'] || {})) {
    if (!/^[CG]/.test(id) || !row) continue;
    const value = Number(plain(row['15']));
    favour[id] = Number.isFinite(value) ? value : 0;
    names[id] = rowName(row) || id;
  }
  const stored = env.ctx.storedItemIds(env.state);
  for (const [id, row] of Object.entries(env.state['1'] || {})) {
    if (!row || stored.has(id)) continue;
    const count = env.ctx.itemStackCount(row['5']);
    const name = rowName(row);
    if (name) bag[name] = (bag[name] || 0) + (Number.isSafeInteger(count) ? count : 0);
  }
  return { favour, names, stones: mechanics.stonesOf(env.state['0']?.B1) ?? 0, bag };
}

// The close card's lines: what changed since the scene opened, each with where it went.
function linesOf(env, scene) {
  const now = holdings(env), start = scene.start || { favour: {}, stones: 0, bag: {} };
  const lines = [];
  for (const [id, after] of Object.entries(now.favour)) {
    const before = start.favour?.[id] ?? 0;
    if (after === before) continue;
    const to = `${now.names[id]}的好感`;
    lines.push({ kind: 'favour', id, label: '好感', before, after, change: after - before, to, text: `${to} ${num(before)}→${num(after)}（${signed(after - before)}）` });
  }
  if (now.stones !== start.stones) {
    const change = now.stones - start.stones;
    lines.push({ kind: 'stones', label: '灵石', before: start.stones, after: now.stones, change, to: '当前灵石', text: `灵石 ${num(start.stones)}→${num(now.stones)}（${signed(change)}）` });
  }
  for (const name of new Set([...Object.keys(start.bag || {}), ...Object.keys(now.bag)])) {
    const change = (now.bag[name] || 0) - (start.bag?.[name] || 0);
    if (!change) continue;
    const to = change > 0 ? '进了行囊' : '出了行囊';
    lines.push({ kind: 'item', label: name, change, to, text: `${name}${signed(change)}，${to}` });
  }
  // Each clock from where it stood before the scene's first move to where its last move left it.
  const runs = new Map();
  for (const move of scene.clocks || []) {
    if (!move?.id) continue;
    const run = runs.get(move.id);
    runs.set(move.id, run ? { ...run, after: move.after } : { name: move.name, before: move.before, after: move.after });
  }
  for (const [id, run] of runs) {
    const change = run.after - run.before;
    if (!change) continue;
    lines.push({ kind: 'clock', id, label: run.name, before: run.before, after: run.after, change, to: run.name,
      text: `${run.name}${run.before}→${run.after}格（${signed(change)}）` });
  }
  return lines;
}

// The weight a scene may close with (scene.json weightNote).
function weighed(scene, asked) {
  const notes = [];
  let weight = SCENE.weights.includes(asked) ? asked : SCENE.plainWeight;
  if (asked && weight !== asked) notes.push(`认不出收场的分量「${String(asked).slice(0, 8)}」，按「${weight}」收场`);
  const top = SCENE.weights.at(-1);
  if (!scene.rolled && weight !== SCENE.plainWeight) {
    weight = SCENE.plainWeight;
    notes.push(`这场戏没有掷过骰，只能按「${weight}」收场`);
  } else if (weight === top && !SCENE.origins[scene.origin]?.big) {
    weight = SCENE.weights.at(-2);
    notes.push(`「${top}」只给冲关、分生死的斗法、故人离世或重逢；这场戏因${SCENE.origins[scene.origin]?.name || scene.origin}而起，按「${weight}」收场`);
  }
  return { weight, notes };
}

// The people a scene opens with: each id on the scene already, or back from the card's biography
// (not the fallen); the commands that set the rows of those coming back.
function presentAt(env, ids) {
  const present = [], commands = [];
  for (const id of [...new Set((Array.isArray(ids) ? ids : [ids]).map(each => plain(each)))]) {
    if (!/^[CG]/.test(id)) continue;
    const row = env.state['0']?.[id];
    const back = !row && env.biographies?.[id];
    if (row) present.push({ id, name: rowName(row) || id });
    else if (back && !mechanics.isFallen(env.ctx, back)) {
      commands.push(`set(${JSON.stringify(back)})`);
      present.push({ id, name: rowName(back) || id });
    }
  }
  return { present, commands };
}

async function open(env, args) {
  if (env.play.scene) return env.refuse('上一场戏还没收场');
  const origin = plain(args.origin) || 'free';
  if (!Object.hasOwn(SCENE.origins, origin)) return env.refuse('认不出这场戏的来由');
  const { present, commands } = presentAt(env, args.present ?? []);
  const counters = env.play.counters && typeof env.play.counters === 'object' ? env.play.counters : (env.play.counters = {});
  counters.scene = (Number(counters.scene) || 0) + 1;
  const given = titleOf(args.title);
  const { names: _names, ...start } = holdings(env);
  const cause = plain(args.cause);
  const scene = {
    id: `S${counters.scene}`, title: given || titleOf(chronicle.placeName(env.state)) || SCENE.title.fallback, named: !!given,
    origin, beats: 0, openedAt: env.clock()?.minutes ?? null, rolled: false, start, clocks: [],
    // a scene is one 回 of the book (book.cjs, item 38)
    chapter: book.opened(env).chapter,
    // a small matter (batch 8): one model call opens it, the card taken closes it
    ...(LIGHT.origins.includes(origin) && LIGHT.causes.includes(cause) && !present.length && !env.play.encounter
      ? { light: { cause } } : {}),
  };
  env.play.scene = scene;
  await env.settle({ kind: 'scene', ok: true, source: 'engine', action: 'open', scene: brief(scene), commands: commands.join('\n'), owns: ownsNothing(),
    ...(present.length ? { present } : {}),
    summary: `开场：${scene.title}（${SCENE.origins[origin].name}）` + (present.length ? `，${present.map(each => each.name).join('、')}在场` : '') });
  return { scene: brief(scene), next: next(scene) };
}

async function close(env, asked, by, given = '') {
  const scene = env.play.scene;
  const { weight, notes } = weighed(scene, plain(asked));
  // the 回目 (book.cjs, item 38): the model's couplet when it holds, else the engine's line, noted
  const titled = book.closed(env, scene, given);
  if (titled.fallback && plain(given)) notes.push(`回目「${titled.given}」不合格（${titled.reason}），用了引擎的那一行`);
  const lines = linesOf(env, scene);
  for (const made of mind.closed(env, weight)) lines.push(mind.line(made));
  env.play.scene = null;
  env.play.cards = null;
  hooks.closed(env, scene);
  const receipt = {
    kind: 'close', ok: true, source: 'engine', by, scene: brief(scene), weight, asked: plain(asked) || null, lines, notes,
    chapter: titled.chapter, couplet: titled.couplet, ...(titled.fallback ? { fallback: { given: titled.given || '', reason: titled.reason } } : {}),
    commands: '', owns: ownsNothing(),
    summary: `收场「${scene.title}」（${weight}）：` + (lines.length ? lines.map(line => line.text).join('；') : '没有得失'),
  };
  await env.settle(receipt);
  return { closed: brief(scene), weight, lines };
}

async function beat(env, args) {
  const scene = env.play.scene;
  if (!scene) return env.refuse('不在戏里');
  scene.beats += 1;
  const given = titleOf(args.title);
  if (given && !scene.named) Object.assign(scene, { title: given, named: true });
  if (scene.light && Object.hasOwn(args, 'light')) {
    if (args.light && typeof args.light === 'object') {
      const leave = saidLine(args.light.leave);
      scene.light = { cause: scene.light.cause, ready: true, ...(plain(args.light.couplet) ? { couplet: plain(args.light.couplet).slice(0, 40) } : {}),
        ...(leave ? { leave } : {}) };
    } else delete scene.light;
  }
  if (plain(args.close)) return close(env, args.close, 'model', args.couplet);
  await env.settle({ kind: 'scene', ok: true, hidden: true, source: 'engine', action: 'beat', scene: brief(scene), commands: '', owns: ownsNothing(),
    summary: `${scene.title}：第${scene.beats}拍` });
  return { scene: brief(scene), next: next(scene) };
}

const ACTIONS = {
  open,
  beat,
  close: (env, args) => (env.play.scene ? close(env, args.weight, 'request') : env.refuse('不在戏里，没有可收的场')),
};

async function sceneOp(env, args) {
  const action = String(args.action ?? '');
  if (!Object.hasOwn(ACTIONS, action)) return env.refuse('戏里没有这一步');
  return ACTIONS[action](env, args);
}

// A card was played in the scene on now: whether it rolled, and the clocks it moved.
function noteAct(env, { rolled = false, won = false, clocks = [] } = {}) {
  const scene = env.play.scene;
  if (!scene) return;
  if (rolled) scene.rolled = true;
  if (won) scene.won = true;
  for (const move of clocks) if (move?.id) (scene.clocks ||= []).push(move);
}

// ---------------------------------------------------------------- a beat's time (plan item 8)

const rowState = text => ({ 4: [{ id: 'TIME_LOCATION_ROW', 0: text }] });

function beatTime(before, written) {
  const old = mechanics.readClock(rowState(before));
  if (!old) return { text: written, note: '' };
  const now = mechanics.readClock(rowState(written));
  const moved = now ? now.minutes - old.minutes : null;
  if (moved !== null && moved >= 0 && moved <= SCENE.beat.maxMinutes) return { text: written, note: '' };
  const slash = String(written).indexOf('/');
  const text = mechanics.clockText({ ...old, place: slash < 0 ? old.place : String(written).slice(slash) }, SCENE.beat.clampMinutes);
  const why = moved === null ? '认不出指令写的时间' : moved < 0 ? '指令把时间往回拨了' : `一拍最多过${chronicle.spanText(SCENE.beat.maxMinutes)}`;
  const step = SCENE.beat.clampMinutes % 15 ? `${SCENE.beat.clampMinutes}分钟` : `${chronicle.numeral(SCENE.beat.clampMinutes / 15)}刻`;
  return { text, note: `${why}，时间按原来的加${step}算（${text.split('/')[0].trim()}），地点按正文所写` };
}

module.exports = {
  LIGHT, hooks, saidLine, scene: sceneOp, open, close, noteAct, beatTime, holdings };
