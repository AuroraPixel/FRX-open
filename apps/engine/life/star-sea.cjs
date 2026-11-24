'use strict';

const mechanics = require('../mechanics.cjs');
const { plain } = require('../item-use.cjs');
const arrays = require('./arrays.cjs');
const calendar = require('./calendar.cjs');
const clock = require('./clock.cjs');
const goods = require('./goods.cjs');
const places = require('./places.cjs');
const { list, nextId } = require('./play.cjs');
const travel = require('./travel.cjs');
const { data } = require('./data.cjs');

const RULES = data('star-sea');
const SITES = RULES.places;

function crossingHint(env, path) {
  const { station, landing } = path;
  const here = travel.standing(env).facts.place;
  const route = arrays.crossing(env, station, landing);
  if (!route) return null;
  if (here !== station) {
    if (travel.route(env, station).refused) return null;
    return { text: `出海·先去${station}，${route.repair ? '修好古阵' : '从传送阵'}可往${landing}`,
      kind: 'hook', verb: { kind: 'travel', to: station } };
  }
  if (route.repair === 'available') {
    return { text: `出海·接${station}的修阵差事，古阵通${landing}`, kind: 'hook', verb: { kind: 'array', repair: true } };
  }
  if (route.repair === 'taken') {
    return { text: `出海·在${station}狩猎，完成古阵修理`, kind: 'hook', verb: { kind: 'hunt' } };
  }
  if (route.stones > (mechanics.stonesOf(env.state['0']?.B1) ?? 0)) return null;
  return { text: `出海·付${route.stones}块灵石，传送去${landing}`, kind: 'hook', verb: { kind: 'travel', to: landing } };
}

function voyageHints(env, at) {
  const realm = mechanics.cultivator(env);
  if (realm.major < 2 || (realm.major === 2 && !realm.top)) return [];
  // Completed investigations can point to the old array. Everyone can find either station,
  // and choosing the public crossing or repairing the other is a normal, paid journey.
  const evidence = list(env.play.leads).some(lead => lead?.proven && /废矿|阵眼|传送阵|阵纹/.test(`${lead.line} ${lead.where}`))
    || Object.values(env.state['1'] || {}).some(item => /阵图|阵钥|潮纹匣匙/.test(plain(item?.['1'])));
  const purse = mechanics.stonesOf(env.state['0']?.B1) ?? 0;
  const paths = [...RULES.voyages].sort((a, b) => {
    const rank = path => (path.station === at.facts.place ? 4 : 0)
      + (path.repair ? (evidence || purse < arrays.crossing(env, RULES.voyages[0].station, RULES.voyages[0].landing)?.stones ? 2 : 0) : 1);
    return rank(b) - rank(a);
  });
  const hints = paths.map(path => crossingHint(env, path)).filter(Boolean);
  if (evidence && hints[0]?.verb?.to === RULES.voyages.find(path => path.repair)?.station) {
    hints[0].text = `出海·已查的矿脉或阵纹有了去处，先往${hints[0].verb.to}寻古阵`;
  }
  return hints.slice(0, 1);
}

function islandHints(env, at) {
  const here = at.facts.place;
  const realm = mechanics.cultivator(env);
  const visit = (to, text) => travel.route(env, to).refused ? [] : [{ text, kind: 'hook', verb: { kind: 'travel', to } }];
  if (here === SITES.oldArray) return visit(SITES.harbor, `初入海域·先到${SITES.harbor}，找海商和落脚的地方`);
  if (here === SITES.harbor) {
    if (env.play.realmsDone?.xutian) {
      const back = hintTo(env, SITES.return);
      if (back) return [{ ...back, text: back.text.replace('出海', `重返${RULES.mainland}`) }];
    }
    const board = require('./jobs.cjs').board(env);
    const notice = board.notices.find(entry => !entry.taken && entry.kind === '海商护航');
    if (notice) return [{ text: `初入海域·接海商的护航差事，去${SITES.city}打通商路`, kind: 'job', verb: { kind: 'job', id: notice.id } }];
    return visit(SITES.city, `初入海域·往${SITES.city}，访丹房、猎妖告示和公阵`);
  }
  if (here === SITES.hunt && realm.major >= 2) {
    const tier = list(require('./rewards.cjs').listed(env)).find(row => row.kind === 'hunt')?.options?.[0]?.value;
    if (tier) return [{ text: `外海猎妖·在${SITES.hunt}追踪海兽，取妖丹给岛上丹师`, kind: 'hook', verb: { kind: 'hunt', tier } }];
  }
  if (here !== SITES.city || realm.major < 2) {
    if (env.play.realmsDone?.xutian && here === SITES.hall) return visit(SITES.city, `秘境归来·回${SITES.city}，找丹师验看灵参`);
    return [];
  }
  const opened = realm.major >= 3 && calendar.openNow(env, 'xutian');
  if (opened && env.play.realmsDone?.xutian !== clock.dateKey(opened.day)) {
    return visit(SITES.hall, `${SITES.hall}已开·可赴海上遗迹，寻结婴灵参，也可先做准备`);
  }
  const ruins = calendar.openNow(env, 'sea-ruins');
  if (ruins && env.play.realmsDone?.['sea-ruins'] !== clock.dateKey(ruins.day)) {
    return visit(SITES.ruins, `退潮见遗址·可趁潮退入${SITES.ruins}一探`);
  }
  const craft = craftingHint(env, 'recipe-xutian-ginseng') || craftingHint(env, 'recipe-sea-ascension');
  if (craft) return [craft];
  if (env.play.realmsDone?.xutian) {
    const back = hintTo(env, SITES.return);
    if (back) return [{ ...back, text: back.text.replace('出海', `重返${RULES.mainland}`) }];
  }
  const active = list(env.play.jobs).find(entry => entry.kind === '外海猎契');
  if (!active) {
    const notice = require('./jobs.cjs').board(env).notices.find(entry => !entry.taken && entry.kind === '外海猎契');
    if (notice) return [{ text: '落灯海修行·接丹房的外海猎契，猎获换一张海炼丹方', kind: 'job', verb: { kind: 'job', id: notice.id } }];
  }
  return active ? visit(SITES.hunt, `外海猎契·往${SITES.hunt}猎妖，海丹可留下炼药`) : [];
}

function craftingHint(env, id) {
  const recipe = goods.byId(id);
  const stored = env.ctx.storedItemIds(env.state);
  const held = new Map();
  for (const [key, row] of Object.entries(env.state['1'] || {})) {
    const good = goods.lookup(row?.['1']);
    if (good && !stored.has(key)) {
      held.set(good.id, (held.get(good.id) || 0) + (Number(env.ctx.itemStackCount(row['5'])) || 0));
    }
  }
  if (!held.get(id) || list(env.play.crafts?.jobs).some(job => job.recipe === id)) return null;
  const fee = data('crafts').hire.fee[goods.TIERS.indexOf(recipe.tier)];
  if ((mechanics.stonesOf(env.state['0']?.B1) ?? 0) < fee) return null;
  if (!recipe.recipe.materials.every(material => held.get(goods.lookup(material.name).id) >= material.count)) return null;
  return { text: `落灯海修行·请丹师用背囊里的材料炼${recipe.recipe.output.name}（手工费${fee}灵石）`, kind: 'hook',
    verb: { kind: 'craft', recipe: recipe.name, batches: 1, hire: true } };
}

function hintTo(env, goal) {
  const at = travel.standing(env);
  const destination = places.poisOf(env.worldMap).find(poi => poi.name === goal);
  if (!destination || at.main === destination.main_region) return null;
  if (at.main === RULES.mainland && destination.main_region === RULES.overseas) {
    return voyageHints(env, at)[0] || null;
  }
  if (at.main === RULES.overseas && destination.main_region === RULES.mainland) {
    return RULES.voyages.map(({ station, landing }) => crossingHint(env, { station: landing, landing: station })).find(Boolean) || null;
  }
  return null;
}

function hints(env) {
  const at = travel.standing(env);
  if (at.main === RULES.mainland) {
    if (!env.play.starSea?.entered) return voyageHints(env, at);
    if (env.play.starSea.returned && !list(env.play.starSea.visited).includes(SITES.return)
        && !travel.route(env, SITES.return).refused) {
      return [{ text: `重返${RULES.mainland}·可往${SITES.return}，寻灵地和结婴的门路`, kind: 'hook', verb: { kind: 'travel', to: SITES.return } }];
    }
    return [];
  }
  return at.main === RULES.overseas ? islandHints(env, at) : [];
}

function arrived(env, from, to) {
  const seed = RULES.arrivals[to.name];
  const old = env.play.starSea || {};
  if (from.main === RULES.overseas && to.main_region === RULES.mainland && old.entered) {
    env.play.starSea = { ...old, returned: clock.dateKey(clock.today(env)) };
  }
  if (to.main_region !== RULES.overseas && !(to.name === SITES.return && old.entered)) return;
  const visited = list(old.visited);
  if (to.main_region === RULES.overseas && !old.entered) {
    env.play.starSea = { ...old, entered: clock.dateKey(clock.today(env)), visited };
  }
  if (!seed || visited.includes(to.name) || from.facts.place === to.name) return;
  env.play.starSea = { ...env.play.starSea, visited: [...visited, to.name] };
  const hook = { id: nextId(env, 'pending', 'P'), trigger: { kind: 'place', value: to.name }, from: 'starSea', seed };
  env.play.pending = [...list(env.play.pending), hook];
}

module.exports = { hints, arrived, hintTo };
