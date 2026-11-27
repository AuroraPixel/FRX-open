'use strict';

const mechanics = require('../mechanics.cjs');
const { data } = require('./data.cjs');
const clock = require('./clock.cjs');
const chronicle = require('./chronicle.cjs');
const places = require('./places.cjs');
const { list, nextId } = require('./play.cjs');

const RULES = data('human-journey');
const TRAVEL = data('travel');
const STAGES = RULES.stages;
const seaJob = STAGES[0].seaJob;
const SEA_JOB = 'sea-return-charter';

const deeds = env => env.play?.humanJourney?.deeds || {};
const major = env => mechanics.cultivator(env).major;
const done = (env, stage) => stage.rank ? major(env) >= stage.rank
  : stage.id === 'flight' ? !!env.play?.humanJourney?.ascended : !!deeds(env)[stage.id];

function current(env) {
  if (major(env) < RULES.minMajor && !env.play?.humanJourney?.ascended) return null;
  if (!places.poisOf(env.worldMap).some(poi => poi.main_region === RULES.mainland)) return null;
  if (!env.play?.humanJourney?.ascended && TRAVEL.spirit.includes(places.readWhere(mechanics.placeOf(env.state)).region)) return null;
  return STAGES.find(stage => !done(env, stage)) || null;
}

function jobRule(board, kind) {
  if (kind === SEA_JOB && seaJob?.board === board) return seaJob;
  return STAGES.map(stage => stage.jobs?.[kind]).find(job => job?.board === board) || null;
}

function jobsAt(env, board) {
  const stage = current(env);
  if (!stage || major(env) < (stage.major || RULES.minMajor)) return {};
  const open = Object.entries(stage.jobs || {});
  const active = list(env.play.jobs).find(job => Object.hasOwn(stage.jobs || {}, job.kind))?.kind;
  if (stage.id === 'border' && seaJob && !Object.values(env.state['6'] || {}).some(
    row => row?.['1'] === `差事：${seaJob.title}` && String(row['5']).startsWith('已完成')
  )) open.push([SEA_JOB, seaJob]);
  return Object.fromEntries(open.filter(([id, job]) => job.board === board && (!active || active === id || id === SEA_JOB))
    .map(([id, job]) => [id, { ...job, major: stage.major || RULES.minMajor }]));
}

function finish(env, stage, way) {
  if (done(env, stage)) return null;
  const date = clock.dateKey(clock.today(env));
  const journey = (env.play.humanJourney ||= {});
  journey.deeds = { ...deeds(env), [stage.id]: { way, date } };
  if (stage.chance) {
    const gate = (env.play.gates ||= {});
    const record = (gate['化神'] ||= {});
    record.chance ||= { from: 'journey', date, reason: stage.title };
  }
  const gain = require('./mind.cjs').gain(env, stage.mind, stage.title);
  chronicle.write(env, 'humanJourney', { 章: stage.title });
  return { id: stage.id, title: stage.title, ...(gain ? { mind: gain } : {}) };
}

function jobDone(env, entry) {
  const stage = STAGES.find(each => each.jobs?.[entry.kind]?.board === entry.board);
  return stage ? finish(env, stage, entry.kind) : null;
}

function introduce(env, stage, place) {
  const journey = (env.play.humanJourney ||= {});
  if (list(journey.introduced).includes(stage.id)) return;
  journey.introduced = [...list(journey.introduced), stage.id];
  env.play.pending = [...list(env.play.pending), {
    id: nextId(env, 'pending', 'P'), trigger: { kind: 'place', value: place }, from: 'humanJourney',
    seed: `${stage.title}。在${place}开一场短戏。${stage.story} 若玩家已接差事，沿其选择写，不替玩家改走法，也不提前发放报酬。`,
  }];
}

function jobTaken(env, entry) {
  const stage = current(env);
  if (stage?.jobs?.[entry.kind]?.board === entry.board) introduce(env, stage, entry.board);
}

function realmDone(env, id) {
  const stage = STAGES.find(each => each.realms?.includes(id));
  return stage ? finish(env, stage, id) : null;
}

function realmReason(env, id) {
  if (id !== 'human-node') return null;
  const stage = STAGES.find(each => each.id === 'storm');
  return STAGES.slice(0, STAGES.indexOf(stage)).every(each => done(env, each))
    ? null : '要先办完人界道途的化神和测潮筹备';
}

function crossing(env, from, to) {
  const plan = RULES.crossing;
  if (to.name !== plan.to || !TRAVEL.spirit.includes(to.main_region) || TRAVEL.spirit.includes(from.main)) return null;
  if (from.facts.place !== plan.from) return { refused: `须由${plan.from}启程飞升` };
  if (env.play.humanJourney?.ascended) return { refused: '这条飞升之路已经走过' };
  if (current(env)?.id !== 'flight') return { refused: '须先突破化神，并在空间节点通过乱流试炼' };
  const purse = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
  if (purse < plan.stones) return { refused: `护送阵要${plan.stones}块灵石，你只有${purse}块` };
  return { days: plan.days, stones: plan.stones, station: plan.from, ascension: true };
}

function landed(env, from, to, receipt) {
  if (!receipt.travel?.teleport?.ascension || from.facts.place !== RULES.crossing.from || to.name !== RULES.crossing.to) {
    const stage = current(env);
    const realms = require('./realm.cjs').REALMS.realms;
    if (stage?.realms?.some(id => realms[id]?.place === to.name)) introduce(env, stage, to.name);
    return;
  }
  const journey = (env.play.humanJourney ||= {});
  journey.ascended = { date: clock.dateKey(clock.today(env)), to: to.name };
  env.play.pending = [...list(env.play.pending), {
    id: nextId(env, 'pending', 'P'), trigger: { kind: 'place', value: to.name }, from: 'humanJourney', seed: RULES.arrival,
  }];
  chronicle.write(env, 'humanAscended', { 地: to.name });
}

// Find a route through ordinary land borders and real array links. Only offer a legal first leg.
function routeHint(env, goal) {
  const travel = require('./travel.cjs');
  if (!travel.route(env, goal).refused) return { kind: 'travel', to: goal };
  const at = travel.standing(env);
  if (at.facts.place === goal || !at.main) return null;
  const arrays = require('./arrays.cjs');
  const points = new Map(places.poisOf(env.worldMap).map(poi => [poi.name, poi]));
  const destination = points.get(goal);
  if (!destination || destination.main_region === at.main) return null;
  const stations = arrays.RULES.teleport.stations;
  const names = [...new Set([goal, ...RULES.waypoints, ...Object.keys(stations)])].filter(
    name => points.has(name) && name !== at.facts.place,
  );
  const queue = names.filter(name => !travel.route(env, name).refused).map(name => ({ name, first: name }));
  const seen = new Set(queue.map(leg => leg.name));
  for (const leg of queue) {
    if (leg.name === goal) return { kind: 'travel', to: leg.first };
    const region = points.get(leg.name).main_region;
    for (const name of names) {
      if (seen.has(name)) continue;
      const next = points.get(name).main_region;
      if (region === next || TRAVEL.landLinks.some(pair => pair.includes(region) && pair.includes(next))
          || stations[leg.name]?.links?.some(link => link.to === name)) {
        queue.push({ name, first: leg.first });
        seen.add(name);
      }
    }
  }
  return null;
}

function view(env) {
  const stage = current(env);
  if (!stage && !env.play?.humanJourney?.ascended) return null;
  const chapters = STAGES.map(each => ({ id: each.id, title: each.title, done: done(env, each) }));
  if (!stage) return { title: RULES.title, chapters, complete: true, choices: [] };
  const here = places.placeFacts(env).place;
  const choices = [];
  const addTravel = (title, text, goal) => {
    const verb = routeHint(env, goal);
    choices.push({ title, text, ...(verb ? { verb } : {}) });
  };
  if (stage.rank) {
    const sheet = require('./gate.cjs').sheet(env);
    const ready = sheet?.missing?.length === 0;
    const full = sheet?.requires?.find(row => row.key === 'full')?.met;
    choices.push({ title: '查看化神准备单', text: ready ? '硬条件已齐，可以选择丹药冲关。'
      : '按准备单补齐功法、阅历和修为。', gate: true });
    if (!full) choices.push({ title: '安排闭关', text: '选择灵地和闭关时长。', verb: { kind: 'cultivate', full: true } });
  } else if (stage.id === 'flight') {
    addTravel('从空间节点飞升', `护送阵耗${RULES.crossing.stones}块灵石，抵达${RULES.crossing.to}后收束人界卷。`,
      here === RULES.crossing.from ? RULES.crossing.to : RULES.crossing.from);
  } else {
    const active = list(env.play.jobs).find(job => Object.hasOwn(stage.jobs || {}, job.kind) || job.kind === SEA_JOB);
    if (active) {
      const atGoal = active.place === here;
      const tier = atGoal && active.goal === 'hunt' ? require('./rewards.cjs').listed(env)
        .find(row => row.kind === 'hunt')?.options?.at(-1)?.value : null;
      const verb = atGoal && active.goal === 'gather' ? { kind: 'gather', days: 3 }
        : tier ? { kind: 'hunt', tier } : routeHint(env, active.place);
      choices.push({ title: active.title, text: `已经接下，去${active.place}完成差事。`, ...(verb ? { verb } : {}) });
    } else {
      const boardOf = require('./jobs.cjs').board;
      const offers = Object.entries(stage.jobs || {});
      if (stage.id === 'border' && seaJob && places.poisOf(env.worldMap).find(p => p.name === seaJob.board)?.main_region
          === places.readWhere(mechanics.placeOf(env.state)).region
          && !Object.values(env.state['6'] || {}).some(row => row?.['1'] === `差事：${seaJob.title}` && String(row['5']).startsWith('已完成'))) {
        offers.unshift([SEA_JOB, seaJob]);
      }
      for (const [kind, job] of offers) {
        if (here !== job.board) {
          addTravel(job.title, job.text, job.board);
          continue;
        }
        const notice = boardOf(env).notices.find(row => row.kind === kind && !row.taken);
        choices.push({ title: job.title, text: job.text, ...(notice ? { verb: { kind: 'job', id: notice.id } } : {}) });
      }
    }
    if (!active) {
      for (const id of stage.realms || []) {
        const { REALMS, entrance } = require('./realm.cjs');
        const spec = REALMS.realms[id];
        if (here !== spec.place) {
          addTravel(`探${spec.name}`, '秘境有险、宝和守关，到达后可查看开启日期。', spec.place);
          continue;
        }
        const door = entrance(env);
        const calendar = require('./calendar.cjs');
        const fixed = calendar.CALENDAR.fixed.find(each => each.id === spec.calendar);
        const next = (door?.off && fixed) ? calendar.nextOpen(env, fixed, clock.today(env)) : null;
        choices.push({ title: `入${spec.name}`, text: door?.note || '选择一条路线过阵，战胜守关可推进道途。',
          ...(door && !door.off ? { realm: id } : next ? { verb: { kind: 'wait', until: clock.dateKey(next.day) } } : {}) });
      }
    }
  }
  return { title: RULES.title, chapters, stage: { id: stage.id, title: stage.title, goal: stage.goal }, complete: false, choices };
}

function hints(env) {
  const journey = view(env);
  const choice = journey?.choices.find(each => each.verb || each.realm);
  return choice ? [{ text: `${journey.stage.title}·${choice.title}`, kind: 'hook',
    ...(choice.verb ? { verb: choice.verb } : {}) }] : [];
}

module.exports = { view, hints, jobsAt, jobRule, jobTaken, jobDone, realmDone, realmReason, crossing, landed };
