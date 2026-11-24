/* Character creation as the old page does it, with the page's own functions (see host.cjs).
 *
 *   node apps/engine/creation.cjs < input.json > output.json
 *
 * Every mode takes `settings` (key → value, as dbGet reads them: the custom traits, races,
 * births and world factors, the default map), `seed`, `now`, `locale`, `timeZone` and, when the
 * default map is another save's, `mapArchive` (that save).
 *
 *   mode 'draw'    { kind: 'traits' | 'root', seed, round }
 *     One draw of the creation steps, as the page's 逆天改命 (handleRandomizeTraits →
 *     generateRandomTraits) or 随机灵根 (handleRandomizeLinggen) button makes it, with Math.random
 *     seeded by `<seed>:<kind>:<round>`. Output: { traits: [6 trait objects] } or { root }.
 *
 *   mode 'create'  { creation: CreationInput (docs/play-contracts.md), seed }
 *     The seven steps with the given choices, then handleStartGame and the selectAndLoadArchive
 *     it ends in. Draws are those of mode 'draw' with the creation's own seed: a claimed trait
 *     must be among the options of a trait draw (the rounds drawn are the fewest that offer the
 *     claimed traits in the claimed order) or is picked from the whole list (自选词条); the claimed
 *     root is the result of a root draw or a root picked from LINGGEN, whichever costs less. The
 *     input's `seed` is the page's other randomness (the save's and the log's ids): a new one for
 *     every save. Output: { archive, refused?, spent: {traitRounds, rootRounds, picked}, errors };
 *     `refused` is what the page would have said instead (not enough points, no such choice).
 *
 * What the page does in inline click handlers rather than in functions of its own is written out
 * here in the same words: choosing a difficulty, an attribute value, a birth, a gender, the age
 * and the 人称, a race, a custom birth or race (openCustomDataSelection), a picked root
 * (createLinggenOrb), a world factor (renderStep6_WorldFactors, openCustomWorldFactorSelection)
 * and the birthplace string (MapRenderer.onClick). The gender is the creation's `gender`, else 男性
 * or 女性 by its `sex`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const host = require('./host.cjs');
const { create } = require('./core/random.cjs');

const CONTENT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../content/creation.json'), 'utf8'));

const STATE = [
  'creationState', 'currentState', 'currentPlayerData', 'inventoryItems', 'surroundingCharacters', 'characterDatabase',
  'bondedCharacters', 'currentArchiveName', 'currentArchiveId', 'WORLD_MAP_DATA', 'latestWorldEvolutionResponse',
  'allBiographyEntries', 'dailyPaperContextForNextMessage', 'lastDailyPaperContent', 'lastAiStoryText',
  'lastUnoptimizedAiStoryText', 'cloudStorageConfig', 'isMainApiGenerating', 'activeTheaterHTML',
  'currentDefaultMapArchiveName', 'currentMapSendStrategy',
];

const CONSTANTS = [
  'TIME_LOCATION_ROW_ID', 'ACTIVE_ARCHIVE_KEY', 'CUSTOM_TRAITS_KEY', 'CUSTOM_BIRTHS_KEY', 'CUSTOM_RACES_KEY',
  'CUSTOM_WORLD_FACTORS_KEY', 'DEFAULT_MAP_KEY', 'MAP_SEND_STRATEGY_KEY', 'DEFAULT_WORLD_MAP_DATA',
];

const FUNCTIONS = [
  'dbGet', 'dbSet', 'startCharacterCreation', 'calculateRemainingPoints', 'handleRandomizeTraits',
  'generateRandomTraits', 'getCustomTraits', 'handleTraitSelect', 'handleRandomizeLinggen',
  'sanitizeCustomTraitForGameState', 'handleStartGame', 'getInitialTableState', 'selectAndLoadArchive', 'loadState',
  'syncStateFromTables', 'parseRemarksString', 'parseRemarkFields', 'parseNestedJsonString', 'storedItemIds',
  'itemStackCount', 'equippedItemRows', 'loadDefaultMapSetting', 'loadMapSendStrategySetting',
];

const SEX = { m: '男性', f: '女性' };

// ---------------------------------------------------------------- glue, run in the page's scope

// The page's dialogs: alerts are kept (they say why a step was refused), the name prompt
// answers with the name the player chose.
function showCustomAlert(message) {
  __alerts.push(String(message));
  return Promise.resolve(true);
}

function showCustomPrompt() {
  return Promise.resolve(__archiveName);
}

// The server answers the page's recovery call on load: nothing to recover in a new save.
async function FRXRequest() {
  return { recovered: false };
}

function frxReseed(seed) {
  Math.random = FRX.stream(seed).random;
}

// One draw with a stream of its own, as the recorder's page has it: the page's own buttons.
async function frxDrawTraits(seed) {
  frxReseed(seed);
  await handleRandomizeTraits();
  return creationState.currentTraitOptions;
}

async function frxDrawRoot(seed) {
  frxReseed(seed);
  await handleRandomizeLinggen();
  return creationState.selectedLinggen;
}

// The options a trait draw would offer and the root a root draw would give, without spending.
async function frxPeekTraits(seed) {
  frxReseed(seed);
  return generateRandomTraits();
}

async function frxPeekRoot(seed) {
  const kept = { totalPoints: creationState.totalPoints, selectedLinggen: creationState.selectedLinggen };
  creationState.totalPoints = Number.MAX_SAFE_INTEGER;
  creationState.selectedLinggen = null;
  frxReseed(seed);
  await handleRandomizeLinggen();
  const root = creationState.selectedLinggen;
  Object.assign(creationState, kept);
  return root;
}

// renderStep1_Difficulty's card.
function frxChooseDifficulty(name) {
  if (!Object.hasOwn(CREATION_CONFIG.DIFFICULTIES, name)) return '没有这个难度';
  const data = CREATION_CONFIG.DIFFICULTIES[name];
  creationState.selectedDifficulty = name;
  creationState.totalPoints = data.points;
  creationState.isExtreme = data.extreme;
  return null;
}

// renderStep2_AttributesAndBirth's sliders (0 to the slider's max, never past the points left).
function frxChooseAttributes(values, limit) {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(CREATION_CONFIG.ATTRIBUTES, key)) return `没有「${key}」这项属性`;
  }
  for (const key of Object.keys(CREATION_CONFIG.ATTRIBUTES)) {
    const newValue = values[key] ?? 0;
    if (!Number.isInteger(newValue) || newValue < 0 || newValue > limit) return `「${key}」只能在 0 到 ${limit} 之间`;
    const diff = newValue - creationState.attributes[key].max;
    if (diff > 0 && calculateRemainingPoints() < diff) return '剩余点数不够分配这些属性';
    creationState.attributes[key].max = newValue;
    creationState.attributes[key].current = newValue;
  }
  return null;
}

// A birth or race card, or a custom one picked in openCustomDataSelection (named by its id).
async function frxChooseOrigin(type, choice) {
  const table = type === 'birth' ? 'BIRTHS' : 'RACES';
  const selected = type === 'birth' ? 'selectedBirth' : 'selectedRace';
  const custom = type === 'birth' ? 'customBirth' : 'customRace';
  const currentRemaining = calculateRemainingPoints();
  if (choice !== '自定义' && Object.hasOwn(CREATION_CONFIG[table], choice)) {
    const oldCost = creationState[selected] ? CREATION_CONFIG[table][creationState[selected]].cost : 0;
    if (currentRemaining + oldCost < CREATION_CONFIG[table][choice].cost) return '剩余点数不够选择这个' + (type === 'birth' ? '出身' : '种族');
    creationState[selected] = choice;
    creationState[custom] = null;
    return null;
  }
  const items = (await dbGet(type === 'birth' ? CUSTOM_BIRTHS_KEY : CUSTOM_RACES_KEY)) || [];
  const item = items.find(entry => entry && entry.id === choice);
  if (!item) return '没有这个' + (type === 'birth' ? '出身' : '种族');
  const oldCost = creationState[selected] ? CREATION_CONFIG[table]['自定义'].cost : 0;
  if (currentRemaining + oldCost < CREATION_CONFIG[table]['自定义'].cost) return '剩余点数不够选择这一项';
  creationState[selected] = '自定义';
  creationState[custom] = item;
  return null;
}

// renderStep3_GenderAndRace's gender card.
function frxChooseGender(name) {
  if (!Object.hasOwn(CREATION_CONFIG.GENDERS, name)) return '没有这个性别';
  creationState.selectedGender = name;
  return null;
}

// renderStep3_GenderAndRace's 初始年龄 input (its change handler: parseInt(value) || 16) and its
// 人称选择 radios; either left alone keeps what startCharacterCreation set (16, 第二人称).
function frxChooseAgeAndPronoun(age, pronoun) {
  if (age !== undefined && age !== null) {
    if (!Number.isInteger(age) || age < 1 || age > 999) return '初始年龄只能在 1 到 999 之间';
    creationState.initialAge = parseInt(String(age)) || 16;
  }
  if (pronoun !== undefined && pronoun !== null) {
    if (!['第一人称', '第二人称', '第三人称'].includes(pronoun)) return '没有这个人称';
    creationState.selectedPronoun = pronoun;
  }
  return null;
}

// openSelfSelectTraitModal's card: the points, then handleTraitSelect(name, true).
async function frxPickTrait(name) {
  const cost = __rules.traitPick.cost;
  if (calculateRemainingPoints() < cost) return '剩余点数不够自选词条';
  creationState.totalPoints -= cost;
  await handleTraitSelect(name, true);
  return null;
}

// createLinggenOrb's click in the root picker.
function frxPickRoot(name) {
  const data = CREATION_CONFIG.LINGGEN[name];
  const oldCost = creationState.selectedLinggen ? CREATION_CONFIG.LINGGEN[creationState.selectedLinggen]?.cost || 0 : 0;
  if (calculateRemainingPoints() + oldCost < data.cost) return '剩余点数不够选择这个灵根';
  creationState.selectedLinggen = name;
  return null;
}

// A world factor card, or a custom factor picked in openCustomWorldFactorSelection (by id).
async function frxChooseFactor(choice) {
  if (Object.hasOwn(CREATION_CONFIG.WORLD_FACTORS, choice)) {
    if (creationState.selectedWorldFactors.some(f => f.name === choice && !f.isCustom)) return `「${choice}」选了两次`;
    const factorData = CREATION_CONFIG.WORLD_FACTORS[choice];
    creationState.selectedWorldFactors.push({ name: choice, desc: factorData.desc, effect: factorData.effect, isCustom: false });
    return null;
  }
  const items = (await dbGet(CUSTOM_WORLD_FACTORS_KEY)) || [];
  const item = items.find(entry => entry && entry.id === choice);
  if (!item) return '没有这个世界因子';
  if (creationState.selectedWorldFactors.some(f => f.name === item.name && f.isCustom)) return `「${item.name}」选了两次`;
  creationState.selectedWorldFactors.push({ name: item.name, desc: item.description, effect: item.effect || '无特殊效果', isCustom: true });
  return null;
}

// MapRenderer.onClick's location string for a click right on a place, or inside an area.
function frxBirthplace(place) {
  const mapData = WORLD_MAP_DATA;
  const poi = place.poiId ? (mapData.points_of_interest || []).find(p => p.name === place.poiId) : null;
  if (place.poiId && !poi) return { refused: '地图上没有这个地点' };
  let mainRegion = null, subRegion = null, pos;
  if (poi) {
    if ((poi.main_region || '') !== place.regionId || ((poi.sub_region || poi.main_region || '') !== place.areaId)) {
      return { refused: '这个地点不在所选的区域里' };
    }
    pos = { x: poi.x, y: poi.y };
    mainRegion = mapData.main_regions.find(r => r.name === poi.main_region);
    subRegion = mapData.sub_regions.find(r => r.name === poi.sub_region);
  } else {
    subRegion = mapData.sub_regions.find(r => r.name === place.areaId && r.main_region === place.regionId) || null;
    mainRegion = mapData.main_regions.find(r => r.name === place.regionId) || null;
    const region = subRegion || (place.areaId === place.regionId ? mainRegion : null);
    if (!region) return { refused: '地图上没有这个区域' };
    pos = frxInside(region.points);
  }
  let locationString = '未知之地';
  if (mainRegion) {
    locationString = subRegion ? `${mainRegion.name}/${subRegion.name}` : mainRegion.name;
    if (poi) locationString += `|(${poi.name}) `;
  }
  return { location: `${locationString}|${Math.round(pos.x)},${Math.round(pos.y)}` };
}

// A point inside a region's outline: its centroid, else the first grid point inside, nearest it.
function frxInside(points) {
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const cx = Math.round(points.reduce((sum, p) => sum + p[0], 0) / points.length);
  const cy = Math.round(points.reduce((sum, p) => sum + p[1], 0) / points.length);
  if (inside(cx, cy)) return { x: cx, y: cy };
  let best = null;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 5) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 5) {
      const distance = (x - cx) ** 2 + (y - cy) ** 2;
      if (inside(x, y) && (!best || distance < best.distance)) best = { x, y, distance };
    }
  }
  return best ? { x: best.x, y: best.y } : { x: cx, y: cy };
}

// ---------------------------------------------------------------- running

function page(input) {
  const run = host.open(host.take({
    functions: FUNCTIONS,
    constants: [...CONSTANTS, ...STATE],
    glue: [
      showCustomAlert, showCustomPrompt, FRXRequest, frxReseed, frxDrawTraits, frxDrawRoot, frxPeekTraits, frxPeekRoot,
      frxChooseDifficulty, frxChooseAttributes, frxChooseOrigin, frxChooseGender, frxChooseAgeAndPronoun,
      frxPickTrait, frxPickRoot,
      frxChooseFactor, frxBirthplace, frxInside,
    ],
  }), {
    settings: input.settings || {},
    archive: input.mapArchive || undefined,
    seed: input.seed, now: input.now, locale: input.locale, timeZone: input.timeZone,
    frx: { stream: seed => create(String(seed)), archiveCommitted() {} },
  });
  // database.js's add: a new record, refused when one of the name exists.
  run.context.db.archives.add = async function add(value) {
    if (await this.get(value.name)) throw new Error('同名记录已经存在');
    return this.put(value);
  };
  run.set('CREATION_CONFIG', CONTENT.config);
  run.set('__rules', CONTENT.rules);
  run.set('__alerts', []);
  const step = async (name, ...args) => {
    const result = await run.call(name, ...args);
    if (!result.done) throw new Error(`${name} waited for something that never came`);
    return result.value;
  };
  return { run, step };
}

function drawSeed(seed, kind, round) {
  return `${seed}:${kind}:${round}`;
}

async function draw(input) {
  const { run, step } = page(input);
  await step('startCharacterCreation');
  run.evaluate('creationState.totalPoints = Number.MAX_SAFE_INTEGER');
  const seed = drawSeed(input.seed, input.kind, input.round);
  if (input.kind === 'traits') return { traits: await step('frxDrawTraits', seed), errors: run.errors };
  if (input.kind === 'root') return { root: await step('frxDrawRoot', seed), errors: run.errors };
  throw new Error('未知的抽取 ' + input.kind);
}

// The rounds of trait draws that offer the claimed traits in the claimed order (each from the
// same round as the one before it or a later one), within `limit` rounds; picked traits are the
// ones no round offers. Draws are only looked at here; nothing is spent.
async function traitPlan(step, seed, names, limit) {
  const rounds = [];
  const options = async round => {
    while (rounds.length < round) rounds.push(await step('frxPeekTraits', drawSeed(seed, 'traits', rounds.length + 1)));
    return rounds[round - 1];
  };
  const plan = [];
  let round = 1;
  for (const name of names) {
    let found = null;
    for (let r = round; r <= limit && found === null; r += 1) {
      if ((await options(r)).some(trait => trait.name === name)) found = r;
    }
    if (found === null) plan.push({ name, picked: true });
    else { plan.push({ name, round: found }); round = found; }
  }
  return plan;
}

async function rootRound(step, seed, root, limit) {
  for (let round = 1; round <= limit; round += 1) {
    if ((await step('frxPeekRoot', drawSeed(seed, 'root', round))) === root) return round;
  }
  return null;
}

async function createSave(input) {
  const { run, step } = page(input);
  const choice = input.creation;
  const rules = CONTENT.rules;
  const config = CONTENT.config;
  const refuse = message => ({ archive: null, refused: message, errors: run.errors });
  // What the page alerted while one step ran, or undefined when it said nothing.
  const quietly = async (name, ...args) => {
    const before = run.get('__alerts').length;
    await step(name, ...args);
    return run.get('__alerts').slice(before)[0];
  };
  await step('loadDefaultMapSetting');
  await step('startCharacterCreation');
  for (const [name, ...args] of [
    ['frxChooseDifficulty', choice.difficulty],
    ['frxChooseAttributes', choice.attributes || {}, rules.attributeMax],
    ['frxChooseOrigin', 'birth', choice.birth],
    ['frxChooseGender', choice.gender ?? SEX[choice.sex]],
    ['frxChooseAgeAndPronoun', choice.initialAge, choice.pronoun],
    ['frxChooseOrigin', 'race', choice.race],
  ]) {
    const problem = await step(name, ...args);
    if (problem) return refuse(problem);
  }

  // 天赋词条: the draws that offer the claimed traits, then each claimed trait in turn.
  const names = choice.traits || [];
  if (new Set(names).size !== names.length) return refuse('同一个词条选了两次');
  if (names.length > rules.maxTraits) return refuse(`最多只能选择 ${rules.maxTraits} 个词条`);
  const limit = Math.min(Math.floor(config.DIFFICULTIES[choice.difficulty].points / rules.traitDraw.cost), 2000);
  const plan = await traitPlan(step, choice.seed, names, limit);
  let drawn = 0;
  for (const entry of plan) {
    let said;
    if (entry.picked) {
      const problem = await step('frxPickTrait', entry.name);
      if (problem) return refuse(problem);
    } else {
      while (drawn < entry.round) {
        drawn += 1;
        if (await quietly('frxDrawTraits', drawSeed(choice.seed, 'traits', drawn))) return refuse('剩余点数不够抽取词条');
      }
      said = await quietly('handleTraitSelect', entry.name);
    }
    const selected = run.get('creationState').selectedTraits.map(t => t.name);
    if (!selected.includes(entry.name)) return refuse(said || `没有「${entry.name}」这个词条`);
  }

  // 灵根: drawn or picked, whichever costs less.
  const pickCost = Object.hasOwn(config.LINGGEN, choice.root) ? config.LINGGEN[choice.root].cost : null;
  const drawLimit = Math.min(Math.floor((pickCost ?? config.DIFFICULTIES[choice.difficulty].points) / rules.rootDraw.cost), 2000);
  const rounds = await rootRound(step, choice.seed, choice.root, drawLimit);
  let rootRounds = 0;
  if (rounds !== null && (pickCost === null || rounds * rules.rootDraw.cost <= pickCost)) {
    while (rootRounds < rounds) {
      rootRounds += 1;
      if (await quietly('frxDrawRoot', drawSeed(choice.seed, 'root', rootRounds))) return refuse('剩余点数不够测定灵根');
    }
  } else if (pickCost !== null) {
    const problem = await step('frxPickRoot', choice.root);
    if (problem) return refuse(problem);
  } else {
    return refuse('没有这个灵根');
  }

  for (const factor of choice.worldFactors || []) {
    const problem = await step('frxChooseFactor', factor);
    if (problem) return refuse(problem);
  }
  const place = await step('frxBirthplace', choice.birthplace || {});
  if (place.refused) return refuse(place.refused);
  run.evaluate(`creationState.birthLocation = ${JSON.stringify(place.location)}`);
  if (await step('calculateRemainingPoints') < 0) return refuse('剩余点数不够');

  run.set('__archiveName', choice.name);
  const alerts = run.get('__alerts').length;
  await step('handleStartGame');
  const said = run.get('__alerts').slice(alerts).filter(text => !text.startsWith('存档创建成功'));
  if (said.length || !run.archive?.data?.archiveId) return refuse(said[0] || '存档没有建成');
  return {
    archive: run.archive,
    spent: { traitRounds: drawn, rootRounds, picked: plan.filter(entry => entry.picked).map(entry => entry.name) },
    errors: run.errors,
  };
}

const MODES = { draw, create: createSave };

async function creation(input) {
  const mode = MODES[input.mode];
  if (!mode) throw new Error('未知的建角步骤 ' + input.mode);
  return mode(input);
}

module.exports = { creation };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(buffer);
      process.env.TZ = input.timeZone || 'Asia/Shanghai';
      process.stdout.write(JSON.stringify(await creation(input)));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errors: [error.message] }));
      process.exitCode = 1;
    }
  });
}
