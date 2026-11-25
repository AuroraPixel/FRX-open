'use strict';
/* 疑点, the storyline's open questions (玩法设计第十一节「故事」; plan item 26). The director's
 * numbered foreshadowing (data.frxDirector's threads: F1, F2 …) shows in the cultivation life as
 * leads: for each the director writes a line the player may read, never the truth, and where to
 * look (WRITE_PLAN_LIFE leads), and the server hands them to the director op (director.cjs), which
 * keeps them here. The rules and words are content/life/leads.json.
 *
 * frxPlay.leads [{ id: "F3", chapter?, title?, line, where?, since, proven?: { date, by, scene? } }]
 *   chapter, title  the storyline chapter it was written in: its id (c2) and its title
 *   proven  by "check" (prove_lead in a scene that had a successful check, the scene's id) or by
 *           "story" (the director resolved the thread: it came out in the story)
 * frxPlay.revealed [chapter ids]: the chapters whose 揭晓 went into frxPlay.pending.
 *
 * take(env, { leads, chapter, title, resolved }) → { taken: [ids], dropped: [{ kind, name, reason }],
 *   reveals: [pending] }: the director's leads ({ id, line, where }), kept or reworded (a lead keeps
 *   its chapter and its proof), the threads it resolved proven by the story, then the reveals.
 * prove(env, args) → the op "lead" { id, how? }, the model's prove_lead: refused when there is no such
 *   lead, it is proven already, no scene is on, or the scene has had no successful check
 *   (frxPlay.scene.won: a card rolled 成功 or 大成功 in it, scene.cjs). Receipt { kind: "lead",
 *   action: "prove", lead: { id, line, where? }, reveal?: { id, chapter } }.
 * When every lead of a chapter is proven, a 揭晓 goes into frxPlay.pending: { trigger: { kind: now,
 *   value: reveal }, seed (reveal.seed: the chapter and its leads), from: leads, chapter }, once a
 *   chapter.
 * view(env) → the state view's play.leads, [{ id, text, proven, where?, chapter? }], open ones first.
 */
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const places = require('./places.cjs');
const { data } = require('./data.cjs');
const { list, nextId, ownsNothing } = require('./play.cjs');

const RULES = data('leads');
const ID = /^F\d{1,4}$/;

const cut = (value, most) => (typeof value === 'string' ? [...value.trim()].slice(0, most).join('') : '');
const all = env => list(env.play?.leads);
const todayKey = env => clock.dateKey(clock.today(env));

// The 揭晓 of a chapter whose leads are all proven, put into frxPlay.pending once; null otherwise.
function reveal(env, chapter) {
  if (!chapter || list(env.play.revealed).includes(chapter)) return null;
  const mine = all(env).filter(lead => lead.chapter === chapter);
  if (!mine.length || mine.some(lead => !lead.proven)) return null;
  env.play.revealed = [...list(env.play.revealed), chapter];
  const hook = {
    id: nextId(env, 'pending', 'P'), trigger: { kind: 'now', value: 'reveal' },
    seed: chronicle.fill(RULES.reveal.seed, { 章: mine[0].title || chapter, 疑点: mine.map(lead => lead.line).join(RULES.reveal.joiner) }),
    from: 'leads', chapter, since: todayKey(env),
  };
  env.play.pending = [...list(env.play.pending), hook];
  return hook;
}

// At most RULES.most leads: the earliest proven go first, then the earliest.
function trimmed(leads) {
  const kept = [...leads];
  while (kept.length > RULES.most) {
    const proven = kept.findIndex(lead => lead.proven);
    kept.splice(proven >= 0 ? proven : 0, 1);
  }
  return kept;
}

function take(env, { leads, chapter, title, resolved } = {}) {
  const taken = [], dropped = [];
  const kept = [...all(env)];
  const today = todayKey(env);
  for (const item of list(leads)) {
    const id = cut(item?.id, 8), line = cut(item?.line, RULES.lineMost), where = cut(item?.where, RULES.whereMost);
    if (!ID.test(id)) {
      dropped.push({ kind: 'lead', name: id || line.slice(0, 10), reason: '疑点要对着一条伏笔的编号（如F3）' });
      continue;
    }
    if (!line) {
      dropped.push({ kind: 'lead', name: id, reason: '疑点没有写给玩家看的那句话' });
      continue;
    }
    const at = kept.findIndex(lead => lead.id === id);
    if (at >= 0) kept[at] = { ...kept[at], line, ...(where ? { where } : {}) };
    else {
      kept.push({ id, ...(cut(chapter, 20) ? { chapter: cut(chapter, 20) } : {}), ...(cut(title, 20) ? { title: cut(title, 20) } : {}),
        line, ...(where ? { where } : {}), since: today });
    }
    taken.push(id);
  }
  for (const id of list(resolved)) {
    const at = kept.findIndex(lead => lead.id === id && !lead.proven);
    if (at >= 0) kept[at] = { ...kept[at], proven: { date: today, by: 'story' } };
  }
  if (taken.length || list(resolved).length) env.play.leads = trimmed(kept);
  const chapters = [...new Set(all(env).map(lead => lead.chapter).filter(Boolean))];
  return { taken, dropped, reveals: chapters.map(each => reveal(env, each)).filter(Boolean) };
}

const success = outcome => outcome === '成功' || outcome === '大成功';

function guidance(env, lead) {
  const where = plain(lead.where);
  const names = places.poisOf(env.worldMap).map(poi => poi.name).filter(Boolean);
  const exact = names.filter(place => where.includes(place)).sort((a, b) => b.length - a.length)[0];
  const shortened = exact ? [] : names.filter(place => {
    const short = place.replace(/(?:山|城|驿|坊市)$/, '');
    return short !== place && short.length >= 2 && where.includes(short);
  });
  const name = exact || (shortened.length === 1 ? shortened[0] : null);
  const here = places.placeFacts(env);
  if (name && here.place !== name) return { kind: 'travel', place: name };
  const person = Object.entries(env.state['0'] || {}).find(([id, row]) => {
    const known = plain(row?.['1']).split('|')[0].trim();
    return /^[CG]/.test(id) && known.length >= 2 && where.includes(known)
      && !mechanics.isFallen(env.ctx, row);
  });
  const localSpot = here.spot && here.spot.length >= 2 && where.includes(here.spot);
  const stored = env.ctx.storedItemIds(env.state);
  const item = Object.entries(env.state['1'] || {}).some(([id, row]) => {
    const known = plain(row?.['1']).split('|')[0].trim();
    return !stored.has(id) && known.length >= 2 && where.includes(known);
  });
  return { kind: name || person || localSpot || item ? 'investigate' : 'ask',
    ...(person ? { target: person[0] } : {}) };
}

function investigation(env, id) {
  const lead = all(env).find(each => each.id === id);
  if (!lead || lead.proven) return { refused: '这条疑点已查实或已不在任务中' };
  if (!env.play.scene || env.play.opening || env.play.fight || env.play.encounter
      || env.play.realm || list(env.play.offer).length) {
    return { refused: '请先处理眼前的事，再调查疑点' };
  }
  const route = guidance(env, lead);
  if (route.kind === 'travel') return { refused: `请先前往${route.place}再调查这条疑点` };
  const where = plain(lead.where) || plain(lead.line);
  const ask = route.kind === 'ask';
  return { lead, ask, card: { kind: ask || /^(?:向|问|拜访)/.test(where) ? '交涉' : '探查',
    title: ask ? `打听疑点的去处：${where}` : `调查疑点：${where}`, target: route.target || '' } };
}

async function prove(env, args, earlier = []) {
  const said = RULES.refused;
  const id = cut(args.id, 8);
  const lead = all(env).find(each => each.id === id);
  if (!lead) return env.refuse(chronicle.fill(said.none, { 编号: id || '这一' }));
  if (lead.proven) return env.refuse(chronicle.fill(said.proven, { 疑点: lead.line }));
  const scene = env.play.scene;
  if (!scene) return env.refuse(said.scene);
  const attempt = earlier.findLast(receipt => receipt.kind === 'act' && receipt.investigation?.id === id);
  if (!scene.won || (attempt && (!success(attempt.outcome) || attempt.investigation.ask))) {
    return env.refuse(said.check);
  }
  const route = guidance(env, lead);
  if (route.kind === 'travel') return env.refuse(`请先前往${route.place}再查实这条疑点`);
  return confirm(env, lead, cut(args.how, 60), 'tool');
}

async function confirm(env, lead, how, source) {
  const { id } = lead;
  const scene = env.play.scene;
  env.play.leads = all(env).map(each => (each.id === id ? { ...each, proven: { date: todayKey(env), by: 'check', scene: scene.id } } : each));
  const hook = reveal(env, lead.chapter);
  await env.settle({
    kind: 'lead', ok: true, source, action: 'prove',
    lead: { id, line: lead.line, ...(lead.where ? { where: lead.where } : {}) },
    ...(hook ? { reveal: { id: hook.id, chapter: lead.chapter } } : {}),
    commands: '', owns: ownsNothing(),
    summary: `查实疑点${id}「${lead.line}」` + (how ? `：${how}` : '') + (hook ? `；这一章的疑点都查实了，揭晓的戏挂上了（${hook.id}）` : ''),
  });
  return { lead: { id, proven: true } };
}

function view(env) {
  const play = env.play;
  const held = play.opening || play.fight || play.encounter || play.realm || list(play.offer).length
    || play.legacy?.state === 'choosing';
  const shown = all(env).map(lead => {
    const route = !lead.proven && !held ? guidance(env, lead) : null;
    return { id: lead.id, text: lead.line, proven: !!lead.proven,
      ...(lead.where ? { where: lead.where } : {}), ...(lead.title ? { chapter: lead.title } : {}),
      ...(route ? { action: route.kind } : {}), ...(route?.place ? { place: route.place } : {}) };
  });
  return [...shown.filter(lead => !lead.proven), ...shown.filter(lead => lead.proven)];
}

module.exports = { RULES, take, prove, view, investigation, confirm };
