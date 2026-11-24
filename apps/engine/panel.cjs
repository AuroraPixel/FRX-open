/* The old page's panel actions, with the page's own functions (see host.cjs): putting on and
 * taking off gear, tidying the bag, marking a character as bonded or not, and feeding a spirit
 * beast.
 *
 *   node apps/engine/panel.cjs < input.json > output.json
 *
 * Input:  { archive, settings, seed, now, locale, timeZone,
 *           action: {action: 'equip' | 'unequip' | 'tidy' | 'bond' | 'unbond' | 'feed', itemId?, slot?,
 *                    charId?, beastId?, seed?} }
 * Output: { archive, said, slot, log, queue, errors }
 *
 * The page loads the save (selectAndLoadArchive → loadState), then does what its controls do:
 *   equip    the equipment picker (openEquipmentPicker) offers the bag's items of the slot's kind
 *            whose name is not worn yet; picking one calls equipItem(item, kind, index), which
 *            calls _updateEquipmentSlot. The 更换 button opens the same picker on a full slot.
 *   unequip  the worn item's 卸下 button: unequipItem(slotKey, index).
 *   tidy     the bag's title: sortInventory().
 *   bond     the 标记为羁绊 button of a character's detail panel (showCharacterDetailPanel, opened
 *   unbond   from the 周围人物 list), or its 取消羁绊: the click handler of app.js 38175–38203, written
 *            out in frxBond in the same words (it is not a function of its own). The character is
 *            the list's entry of `charId`; asking for what it already is is refused.
 *   feed     the 喂食/培养 window of a beast's detail (openBeastFeedingModal) lists the bag's
 *            消耗品; clicking one calls handlePersistentFeed(beastId, itemId). Its two draws come
 *            from the action's own `seed`; `log` is its 培养日志 ({text, kind} per line) and
 *            `queue` the page's action queue after it ({type, text, silent}): the hidden
 *            beast_evolve line when the beast's aptitude broke through.
 * Each ends in saveCurrentState, which puts the whole save back; `archive` is that save, or null
 * when the page refused (its message is in `said`). `slot` is the cell the action used.
 *
 * A slot is named 「kind:index」: weapon, armor, technique or treasure and 0 to 5. Equipping
 * without a slot takes the first free cell of the item's kind, and the first cell when all six
 * are full, as the engine's equipItem does (mechanics.cjs); unequipping without a slot finds the
 * cell that holds the item.
 */
'use strict';

const host = require('./host.cjs');
const { create } = require('./core/random.cjs');

const STATE = [
  'currentState', 'currentPlayerData', 'inventoryItems', 'surroundingCharacters', 'characterDatabase',
  'bondedCharacters', 'currentArchiveName', 'WORLD_MAP_DATA', 'latestWorldEvolutionResponse',
  'allBiographyEntries', 'dailyPaperContextForNextMessage', 'lastDailyPaperContent', 'lastAiStoryText',
  'lastUnoptimizedAiStoryText', 'cloudStorageConfig', 'actionQueue',
];

const CONSTANTS = ['DEFAULT_WORLD_MAP_DATA', 'TIME_LOCATION_ROW_ID', 'BEAST_APTITUDE_CONFIG'];

const FUNCTIONS = [
  'loadState', 'syncStateFromTables', 'parseRemarksString', 'parseRemarkFields', 'serializeRemarksObject',
  'parseNestedJsonString', 'storedItemIds', 'itemStackCount', 'equippedItemRows', 'restoreEquipmentRow',
  '_updateEquipmentSlot', 'equipItem', 'unequipItem', 'sortInventory', 'saveCurrentState',
  '_internalSaveCurrentState', 'parseBeastAptitude', 'handlePersistentFeed', 'addAction',
];

const KINDS = { weapon: '武器', armor: '护甲', technique: '功法', treasure: '法宝' };

// ---------------------------------------------------------------- glue, run in the page's scope

// What the page's danmaku said: the refusals of _updateEquipmentSlot land here.
function showDanmaku(text, kind) {
  __said.push({ text: String(text), kind: String(kind || '') });
}

// selectAndLoadArchive, without drawing: the variables loadState leaves for the panel.
async function frxLoadArchive(archiveName) {
  const saved = await db.archives.get(archiveName);
  currentArchiveName = archiveName;
  await loadState(saved.data.state || {}, saved.data);
}

// The bag's items openEquipmentPicker lists for a slot of this kind (its own filter).
function frxPickable(slotType) {
  const equipmentSlots = ['weapon', 'armor', 'technique', 'treasure'];
  const equippedItemNames = new Set(
    equipmentSlots.flatMap(key => (currentPlayerData[key] || []).filter(item => item).map(item => item.name)),
  );
  return inventoryItems.filter(item => item.type === slotType && !equippedItemNames.has(item.name));
}

// The worn items as renderDetailGrid shows them: kind → six cells.
function frxWorn() {
  const worn = {};
  for (const key of ['weapon', 'armor', 'technique', 'treasure']) worn[key] = currentPlayerData[key] || Array(6).fill(null);
  return worn;
}

// Pick an item in the picker opened on cell `index` of the kind `slotType`.
function frxEquip(itemId, slotType, index) {
  const item = frxPickable(slotType).find(entry => entry.id === itemId);
  if (!item) return false;
  equipItem(item, slotType, index);
  return true;
}

// The 标记为羁绊 / 取消羁绊 button's click handler (app.js 38175–38203) on the character the
// 周围人物 list shows as `charId`, when it is not already what the player asks for.
async function frxBond(charId, wanted) {
  const char = surroundingCharacters.find(c => c.id === charId);
  if (!char) return '找不到这个人物';
  if (Boolean(char.isBonded) === wanted) return wanted ? `「${char.name}」已是羁绊人物` : `「${char.name}」不是羁绊人物`;

  char.isBonded = !char.isBonded;

  if (currentState['0'] && currentState['0'][char.id]) {
    const charRow = currentState['0'][char.id];
    const remarks = parseRemarksString(charRow['9'] || '');
    remarks['isBonded'] = char.isBonded.toString();
    charRow['9'] = serializeRemarksObject(remarks);
  }

  if (char.isBonded) {
    bondedCharacters[char.id] = char;
    if (!currentState.bondedCharacters) currentState.bondedCharacters = {};
    currentState.bondedCharacters[char.id] = char;
  } else {
    if (bondedCharacters[char.id]) delete bondedCharacters[char.id];
    if (currentState.bondedCharacters) delete currentState.bondedCharacters[char.id];
  }

  await saveCurrentState();
  syncStateFromTables();

  showDanmaku(char.isBonded ? `已将 ${char.name} 标记为羁绊` : `已取消 ${char.name} 的羁绊`, 'success');
  return null;
}

// The 喂食/培养 window of the beast `beastId` (openBeastFeedingModal): it offers the bag's
// 消耗品, and clicking one feeds it with handlePersistentFeed, without the window's redraws. The
// two draws come from the feed's own seed; the 培养日志 lands in the window's log.
async function frxFeed(beastId, itemId, seed) {
  if (!(currentState['7'] || {})[beastId]) return { refused: '没有这只灵兽' };
  if (!inventoryItems.some(item => item.type === '消耗品' && item.id === itemId)) {
    return { refused: '储物袋里没有这件消耗品' };
  }
  const logs = document.createElement('div');
  logs.id = 'feed-logs';
  document.body.appendChild(logs);
  Math.random = FRX.stream(seed).random;
  await handlePersistentFeed(beastId, itemId);
  return { log: [...logs.children].map(line => ({ text: line.textContent, kind: line.className.split(' ').pop() })) };
}

// The action queue, as the page lists it in 行为指令集.
function frxQueued() {
  return actionQueue.map(entry => ({ type: entry.type, text: entry.text, silent: !!entry.isSilent }));
}

// The save that saveCurrentState started is written once the page's promises have run.
async function frxSettle() {
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------- running

function parseSlot(slot) {
  const match = /^(weapon|armor|technique|treasure):([0-5])$/.exec(String(slot ?? ''));
  return match ? { key: match[1], index: Number(match[2]) } : null;
}

function refusal(text) {
  return { archive: null, said: [{ text, kind: 'error' }] };
}

async function equip(run, step, action) {
  const bag = run.get('inventoryItems') || [];
  const item = bag.find(entry => entry.id === action.itemId);
  const key = item && Object.keys(KINDS).find(k => KINDS[k] === item.type);
  if (!key) return refusal('储物袋里没有这件能装备的东西');
  let target = parseSlot(action.slot);
  if (action.slot !== undefined && action.slot !== null && (!target || target.key !== key)) {
    return refusal(`「${item.name}」只能装在${KINDS[key]}栏`);
  }
  if (!target) {
    const cells = (await step('frxWorn'))[key];
    const free = [0, 1, 2, 3, 4, 5].find(i => !cells[i]);
    target = { key, index: free === undefined ? 0 : free };
  }
  if (!(await step('frxEquip', action.itemId, KINDS[key], target.index))) {
    return refusal(`已经装备着同名的「${item.name}」`);
  }
  return { slot: `${target.key}:${target.index}` };
}

async function unequip(run, step, action) {
  const worn = await step('frxWorn');
  let target = parseSlot(action.slot);
  if (!target && action.itemId) {
    for (const key of Object.keys(KINDS)) {
      const index = worn[key].findIndex(item => item && (item.id || item['0']) === action.itemId);
      if (index >= 0) { target = { key, index }; break; }
    }
  }
  const held = target && worn[target.key][target.index];
  if (!held || (action.itemId && (held.id || held['0']) !== action.itemId)) return refusal('身上没有这件装备');
  await step('unequipItem', target.key, target.index);
  return { slot: `${target.key}:${target.index}` };
}

async function tidy(run, step) {
  await step('sortInventory');
  return {};
}

async function feed(run, step, action) {
  const fed = await step('frxFeed', String(action.beastId ?? ''), String(action.itemId ?? ''), String(action.seed ?? ''));
  if (fed.refused) return refusal(fed.refused);
  return { log: fed.log, queue: await step('frxQueued') };
}

const bonding = wanted => async (run, step, action) => {
  const problem = await step('frxBond', String(action.charId ?? ''), wanted);
  return problem ? refusal(problem) : {};
};

// One entry per action the panels can ask for: (run, step, action) → {} or a refusal.
const ACTIONS = { equip, unequip, tidy, bond: bonding(true), unbond: bonding(false), feed };

async function panel(input, { discover = false } = {}) {
  const act = ACTIONS[input.action?.action];
  if (!act) throw new Error('未知的面板动作 ' + input.action?.action);
  const page = host.take({
    functions: FUNCTIONS,
    constants: [...CONSTANTS, ...STATE],
    glue: [showDanmaku, frxLoadArchive, frxPickable, frxWorn, frxEquip, frxBond, frxFeed, frxQueued, frxSettle],
  });
  const run = host.open(page, {
    settings: input.settings || {},
    archive: input.archive,
    seed: input.seed, now: input.now, locale: input.locale, timeZone: input.timeZone,
    frx: { captureScope: async () => null, assertScope: async () => {}, stream: seed => create(String(seed)) },
    discover,
  });
  run.set('__said', []);
  const step = async (name, ...args) => {
    let result;
    try { result = await run.call(name, ...args); } catch (error) {
      if (discover) error.message += ` (missing so far: ${run.missing.join(', ') || 'none'})`;
      throw error;
    }
    if (!result.done) throw new Error(`${name} waited for something that never came`);
    return result.value;
  };
  await step('frxLoadArchive', input.archive.name);
  const outcome = await act(run, step, input.action);
  await step('frxSettle');
  const said = [...(outcome.said || []), ...run.get('__said')];
  const saved = outcome.said ? null : run.writes.archives.at(-1) || null;
  return {
    archive: saved,
    said,
    ...(outcome.slot ? { slot: outcome.slot } : {}),
    ...(outcome.log ? { log: outcome.log, queue: outcome.queue } : {}),
    errors: run.errors,
    ...(discover ? { missing: run.missing } : {}),
  };
}

module.exports = { panel };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(buffer);
      process.env.TZ = input.timeZone || 'Asia/Shanghai';
      process.stdout.write(JSON.stringify(await panel(input, { discover: process.argv.includes('--discover') })));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errors: [error.message] }));
      process.exitCode = 1;
    }
  });
}
