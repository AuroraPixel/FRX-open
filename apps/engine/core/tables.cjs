/* The state tables and the commands a reply writes to them: the remarks column, nested JSON,
 * table ids, the command parser and applyChanges.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 4948
        const TIME_LOCATION_ROW_ID = 'TIME_LOCATION_ROW';

// app.js 8481
        function recursivelyParseJsonStrings(data) {
// 1. 基础类型直接返回，减少栈调用
if (typeof data !== 'string' && typeof data !== 'object') return data;
if (data === null) return null;

if (typeof data === 'string') {

const trimmed = data.trim();
const firstChar = trimmed.charAt(0);
const lastChar = trimmed.charAt(trimmed.length - 1);

if (!((firstChar === '{' && lastChar === '}') || (firstChar === '[' && lastChar === ']'))) {
return data;
}

try {
const parsedData = JSON.parse(trimmed);
return recursivelyParseJsonStrings(parsedData);
} catch (e) {

try {
if (trimmed.includes("'")) {
const fixedString = trimmed.replace(/'/g, '"');
const parsedData = JSON.parse(fixedString);
return recursivelyParseJsonStrings(parsedData);
}
} catch (e2) {
return data;
}
return data;
}
} else if (Array.isArray(data)) {

const len = data.length;
const newArr = new Array(len);
for (let i = 0; i < len; i++) {
newArr[i] = recursivelyParseJsonStrings(data[i]);
}
return newArr;
} else if (typeof data === 'object') {

const newObj = {};
for (const key in data) {
if (Object.prototype.hasOwnProperty.call(data, key)) {
newObj[key] = recursivelyParseJsonStrings(data[key]);
}
}
return newObj;
}
return data;
}

// app.js 9895
        function parseRemarksString(str) {
          if (typeof str === 'object' && str !== null) {
            return { ...str };
          }
          const text = str || '';
          // FRX: an older merge spread a remarks string into one key per character
          // ("0:灵|1:根|2::|…"). Rebuild that string, then apply later named keys.
          if (/^0:[\s\S]\|1:/.test(text)) {
            const chars = [];
            let cursor = 0;
            while (cursor < text.length) {
              const head = text.slice(cursor).match(/^(\d+):/);
              if (!head || Number(head[1]) !== chars.length || cursor + head[0].length >= text.length) break;
              chars.push(text[cursor + head[0].length]);
              cursor += head[0].length + 1;
              if (text[cursor] === '|') cursor += 1;
            }
            if (chars.length >= 3) {
              return { ...parseRemarkFields(chars.join('')), ...parseRemarkFields(text.slice(cursor)) };
            }
          }
          return parseRemarkFields(text);
        }

// app.js 9919
        function parseRemarkFields(text) {
          return text.split('|').reduce((acc, part) => {
            const firstColonIndex = part.indexOf(':');
            if (firstColonIndex > -1) {
              const key = part.substring(0, firstColonIndex).trim();
              const value = part.substring(firstColonIndex + 1).trim();
              if (key) acc[key] = value;
            }
            return acc;
          }, {});
        }

// app.js 9931
        function serializeRemarksObject(remarksObj) {
          return Object.entries(remarksObj)
            .filter(([key, value]) => value !== undefined && value !== null)
            .map(([key, value]) => {
              if (typeof value === 'object' && value !== null) {
                value = JSON.stringify(value);
              }
              return `${key}:${value}`;
            })
            .join('|');
        }

// app.js 10006
        function getTableIndexFromId(id) {
          if (!id) return null;
          if (id === 'SCENE_MAP') return '10';
          const prefix = id.charAt(0);
          switch (prefix) {
            case 'B':
            case 'C':
            case 'G':
              return '0';
            case 'I':
              return '1';
            case 'E':
              return '9';
            case 'T':
              return '6';
            case 'S':
              return '8';
            case 'W':
              return '5';
            case 'P':
              return '7';
            default:
              return null;
          }
        }

// app.js 10033
async function applyChanges(baseState, delta, options = {}) {
console.log('【步骤2: 进入 applyChanges】开始应用变量变更...');
if (!delta) {
console.log('applyChanges: 收到的 delta 为空，无需应用任何变量变更。');
return baseState;
}

let newState;
try {
newState = structuredClone(baseState);
} catch (e) {
newState = JSON.parse(JSON.stringify(baseState));
}
const characterNameChanges = {};
const updatedCharacterIds = new Set();
const settingsWrites = [];
// An explicit attribute edit takes precedence over a duplicate remark anywhere in the batch.
// Key by the row itself because set/de can replace a character under the same ID.
const healthWrites = new Map();

function reconcileRemarkHealth(row, { preferDetailed, discardInvalid = false }) {
  const remarks = parseRemarksString(recursivelyParseJsonStrings(row['9']));
  if (!Object.hasOwn(remarks, 'hp')) return;
  const attributes = parseNestedJsonString(row['11'], {});
  const detailed = attributes['血量'];
  if (!preferDetailed || !Number.isFinite(detailed?.current) || !Number.isFinite(detailed?.max)) {
    const value = recursivelyParseJsonStrings(remarks.hp);
    const pair = typeof value === 'string' && value.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    const current = pair ? Number(pair[1]) : value?.current;
    const max = pair ? Number(pair[2]) : value?.max;
    if (Number.isFinite(current) && Number.isFinite(max) && current >= 0 && max >= 0) {
      attributes['血量'] = { current: Math.min(current, max), max };
      row['11'] = JSON.stringify(attributes);
    } else if (!discardInvalid) {
      console.error(`角色 ${row['0']} 的备注 hp 无效，请用 updateAttribute 写入血量的 current 和 max`);
      return;
    }
  }
  delete remarks.hp;
  row['9'] = serializeRemarksObject(remarks);
}

function trackHealthWrite(row, writesDetailedHealth) {
  if (!healthWrites.has(row)) {
    // Older saves may only have a remark. Seed the baseline before applying relative damage.
    reconcileRemarkHealth(row, { preferDetailed: true, discardInvalid: true });
  }
  healthWrites.set(row, writesDetailedHealth || healthWrites.get(row) === true);
}

const persistEffects = options.persistEffects !== false;
const archive = await db.archives.get(currentArchiveName);
let npcAvatarsNeedsUpdate = false;
if (archive && !archive.data.state.npcAvatars) {
archive.data.state.npcAvatars = {};
}

let bioSnapshot = null;
let lastLogWithBioIndex = -1;
if (archive && archive.data.logs) {
lastLogWithBioIndex = archive.data.logs.findLastIndex(log => log.biographySnapshot);
if (lastLogWithBioIndex !== -1) {
bioSnapshot = archive.data.logs[lastLogWithBioIndex].biographySnapshot;
}
}
const bioMap = new Map((bioSnapshot || []).map(bio => [bio.key, bio]));
let bioHasChanged = false;

for (const op of delta) {
console.log('--- 【步骤2.1】正在应用指令:', JSON.stringify(op), '---');
try {
const { command, id, data, eventData, attribute, value, slot, item, locationId, regionData } = op;

const idToProcess = command === 'set' && data ? data['0'] : id;
if (idToProcess && (idToProcess.startsWith('C') || idToProcess.startsWith('G') || idToProcess === 'B1')) {
updatedCharacterIds.add(idToProcess);
if (command === 'add' && idToProcess !== 'B1' && data?.['1'] && archive?.data.state.npcAvatars) {
const oldName = (newState['0'][idToProcess]?.['1'] || '').split('|')[0];
const newName = data['1'].split('|')[0];
const oldKey = `${idToProcess}_${oldName}`;
if (oldName && oldName !== newName && archive.data.state.npcAvatars[oldKey]) {
archive.data.state.npcAvatars[`${idToProcess}_${newName}`] = archive.data.state.npcAvatars[oldKey];
delete archive.data.state.npcAvatars[oldKey];
npcAvatarsNeedsUpdate = true;
}
}
if (data && data['19'] && typeof data['19'] === 'string') {
const imgTagMatch = data['19'].match(/<img>(.*?)<\/img>/);
if (imgTagMatch && imgTagMatch[1]) {
const imageName = imgTagMatch[1];
const imageUrl = getImageUrl('Full', imageName);
const charRow = command === 'set' ? data : newState['0'][idToProcess];
const charName = (data['1'] || charRow['1'] || '|').split('|')[0];
data['19'] = imageUrl;
if (idToProcess === 'B1') {
const avatarKey = `${CUSTOM_AVATAR_KEY}_${currentArchiveName}`;
settingsWrites.push({key: avatarKey, value: imageUrl});
if (persistEffects) await dbSet(avatarKey, imageUrl);
} else if (charName && archive && archive.data.state.npcAvatars) {
const uniqueImageKey = `${idToProcess}_${charName}`;
archive.data.state.npcAvatars[uniqueImageKey] = imageUrl;
npcAvatarsNeedsUpdate = true;
}
const remarks = parseRemarksString(charRow['9'] || '{}');
if (remarks.visual) {
delete remarks.visual;
charRow['9'] = serializeRemarksObject(remarks);
}
}
}
}

if (command === 'add' && id === TIME_LOCATION_ROW_ID) {
const timeRow =
(newState['4'] || []).find(row => row.id === TIME_LOCATION_ROW_ID) || newState['4']?.[0];
if (timeRow) {
Object.assign(timeRow, { id: TIME_LOCATION_ROW_ID, ...data });
} else if (newState['4']) {
newState['4'][0] = { id: TIME_LOCATION_ROW_ID, ...data };
}
} else if (op.command === 'createLocation' && op.locationData) {
if (op.locationData.type === 'poi') WORLD_MAP_DATA.points_of_interest.push(op.locationData.data);
else if (op.locationData.type === 'sub_region') WORLD_MAP_DATA.sub_regions.push(op.locationData.data);
else if (op.locationData.type === 'main_region') WORLD_MAP_DATA.main_regions.push(op.locationData.data);
} else if (op.command === 'updateRegion' && op.regionData) {
const regionToUpdate =
WORLD_MAP_DATA.main_regions.find(r => r.name === op.regionData.name) ||
WORLD_MAP_DATA.sub_regions.find(r => r.name === op.regionData.name);
if (regionToUpdate) regionToUpdate.points = op.regionData.points;
} else if (op.command === 'deleteLocation' && op.locationId) {
WORLD_MAP_DATA.points_of_interest = WORLD_MAP_DATA.points_of_interest.filter(
p => p.name !== op.locationId,
);
} else {
const tableIndex = getTableIndexFromId(id || (data ? data['0'] : null));

// 特殊指令不需要 tableIndex
if (['addWorldEvent', 'updateWorldEvent', 'deleteWorldEvent'].includes(command)) {
// pass
} else if (tableIndex === null) {
console.error('无法从ID确定表格索引，跳过此指令:', op);
continue;
}

if (tableIndex && !newState[tableIndex]) newState[tableIndex] = {};

switch (command) {
case 'set': {
if (!data || typeof data !== 'object') continue;
const processedData = recursivelyParseJsonStrings(data);
let idToSet = processedData['0'] || id;
if (!idToSet) continue;
if (tableIndex === '0' && newState['0']) {
const existingChar = newState['0'][idToSet];
if (existingChar) {
const newName = (processedData['1'] || '').split('|')[0];
const existingName = (existingChar['1'] || '').split('|')[0];
if (newName !== existingName) {
let newId = idToSet;
let counter = 1;
while (newState['0'][newId]) {
newId = `${idToSet}_${counter}`;
counter++;
}
idToSet = newId;
processedData['0'] = newId;
}
}
}
if (tableIndex === '0') reconcileRemarkHealth(processedData, { preferDetailed: true });
if (idToSet !== 'SCENE_MAP' && processedData['9'] && typeof processedData['9'] === 'object') {
processedData['9'] = serializeRemarksObject(processedData['9']);
}
if (idToSet !== 'SCENE_MAP' && processedData['11'] && typeof processedData['11'] === 'object') {
processedData['11'] = JSON.stringify(processedData['11']);
}
if (newState[tableIndex]) {
newState[tableIndex][idToSet] = processedData;
}
break;
}
case 'add': {
if (!data || typeof data !== 'object') continue;
const targetRow = newState[tableIndex]?.[id];
if (!targetRow) continue;
const isCharacter = id.startsWith('B') || id.startsWith('C') || id.startsWith('G');
const newAttributesPartial = isCharacter && recursivelyParseJsonStrings(data['11']);
const rawRemarks = isCharacter && data['9'] ? recursivelyParseJsonStrings(data['9']) : null;
const newRemarksData = typeof rawRemarks === 'string' ? parseRemarksString(rawRemarks) : rawRemarks;
const writesDetailedHealth = Object.hasOwn(newAttributesPartial || {}, '血量')
  || Object.hasOwn(newAttributesPartial || {}, 'hp');
if (writesDetailedHealth || Object.hasOwn(newRemarksData || {}, 'hp')) {
  trackHealthWrite(targetRow, writesDetailedHealth);
}

if (newAttributesPartial) {
const oldAttributes = parseNestedJsonString(targetRow['11'], {});
Object.keys(newAttributesPartial).forEach(key => {
const attributeKey = key === 'hp' ? '血量' : key;
const change = newAttributesPartial[key];
if (change && typeof change === 'object' && ('current' in change || 'max' in change)) {
if (!oldAttributes[attributeKey]) oldAttributes[attributeKey] = { current: 0, max: 0 };
if (typeof change.current === 'number') oldAttributes[attributeKey].current = change.current;
if (typeof change.max === 'number') oldAttributes[attributeKey].max = change.max;
} else if (typeof change === 'number') {
if (!oldAttributes[attributeKey]) oldAttributes[attributeKey] = { current: 0, max: 0 };
oldAttributes[attributeKey].current += change;
}
if (oldAttributes[attributeKey]) {
oldAttributes[attributeKey].current = Math.min(
oldAttributes[attributeKey].current,
oldAttributes[attributeKey].max,
);
}
});
targetRow['11'] = JSON.stringify(oldAttributes);
}

if (newRemarksData) {
const originalRemarks = parseRemarksString(targetRow['9'] || '');
const arrayKeys = ['traits', 'skills', 'inventory'];
for (const key in newRemarksData) {
if (arrayKeys.includes(key)) {
const newItems = parseNestedJsonString(newRemarksData[key], []);
let currentItems = parseNestedJsonString(originalRemarks[key], []);
const combinedMap = new Map();
currentItems.forEach(item => { if (item) { const k = item['0'] || item.id || item.name; if (k) combinedMap.set(k, item); } });
newItems.forEach(item => { if (item) { const k = item['0'] || item.id || item.name; if (k) { const existing = combinedMap.get(k); combinedMap.set(k, existing ? { ...existing, ...item } : item); } } });
originalRemarks[key] = JSON.stringify(Array.from(combinedMap.values()));
} else {
originalRemarks[key] = newRemarksData[key];
}
}
targetRow['9'] = serializeRemarksObject(originalRemarks);
}

for (const key in data) {
let skip = false;
if (isCharacter && (key === '9' || key === '11')) skip = true;
if (!skip) targetRow[key] = data[key];
}
break;
}
case 'updateAttribute':
if (newState[tableIndex] && newState[tableIndex][id]) {
const charRow = newState[tableIndex][id];
const attributeKey = attribute === 'hp' ? '血量' : attribute;
if (tableIndex === '0' && attributeKey === '血量') trackHealthWrite(charRow, true);
let attributes = parseNestedJsonString(charRow['11'], {});
if (!attributes[attributeKey]) attributes[attributeKey] = { current: 0, max: 0 };
if (typeof value.current === 'number') attributes[attributeKey].current = value.current;
if (typeof value.max === 'number') attributes[attributeKey].max = value.max;
attributes[attributeKey].current = Math.min(attributes[attributeKey].current, attributes[attributeKey].max);
charRow['11'] = JSON.stringify(attributes);
}
break;
case 'de':
if (op.subCategory && op.subId && newState['0'][id]) {
const charRow = newState['0'][id];
const remarks = parseRemarksString(charRow['9'] || '');
const category = op.subCategory;
let items = parseNestedJsonString(remarks[category], []);
if (Array.isArray(items)) {
const initialLength = items.length;
items = items.filter(item => { const itemId = item['0'] || item.id || item.name; return itemId !== op.subId; });
if (items.length !== initialLength) {
remarks[category] = JSON.stringify(items);
charRow['9'] = serializeRemarksObject(remarks);
if (id.startsWith('C') || id.startsWith('G')) updatedCharacterIds.add(id);
}
}
} else if (newState[tableIndex] && newState[tableIndex][id]) {
const item = newState[tableIndex][id];
if (item && item['1']) characterNameChanges[id] = item['1'].split('|')[0];
delete newState[tableIndex][id];
}
break;
case 'equipItem':
if (newState['0'][id]) {
const charRow = newState['0'][id];
const remarks = parseRemarksString(charRow['9'] || '');
let equipment = parseNestedJsonString(remarks.equipment, {});
let newItemData = item.data;
let equipIndex = item.index;
if (id === 'B1') {
  const itemId = newItemData?.['0'];
  const slotTypes = { weapon: '武器', armor: '护甲', technique: '功法', treasure: '法宝' };
  const index = itemStackCount(item.index);
  if (!Object.hasOwn(slotTypes, slot) || item.index == null || !Number.isInteger(index) || index >= 6) {
    throw new Error('装备槽位无效');
  }
  equipIndex = index;
  const previous = equipment[slot]?.[index];
  if (itemId && previous && (previous.id || previous['0']) === itemId) break;
  newItemData = newState['1']?.[itemId];
  if (!newItemData || storedItemIds(newState).has(itemId) || !(itemStackCount(newItemData['5']) > 0)) {
    throw new Error('储物袋中没有可装备的物品 ' + itemId);
  }
  if (newItemData['2'] !== slotTypes[slot]) throw new Error('物品类型不符合装备槽位 ' + itemId);
  if (previous) restoreEquipmentRow(newState, previous);
}
let processedItem = '功法' === newItemData['2']
? { id: newItemData['0'], name: newItemData['1'], type: newItemData['2'], description: newItemData['3'], quantity: parseInt(newItemData['5'] || '1'), grade: newItemData['6'], maxRealm: newItemData['7'], realmEffects: newItemData['8'], currentEffect: newItemData['9'], effect: newItemData['9'] }
: { id: newItemData['0'], name: newItemData['1'], type: newItemData['2'], description: newItemData['3'], effect: newItemData['4'], quantity: parseInt(newItemData['5'] || '1') };
if (!equipment[slot]) equipment[slot] = Array(6).fill(null);
equipment[slot][equipIndex] = processedItem;
remarks.equipment = JSON.stringify(equipment);
charRow['9'] = serializeRemarksObject(remarks);
}
break;
case 'unequipItem':
if (newState['0'][id]) {
const charRow = newState['0'][id];
const remarks = parseRemarksString(charRow['9'] || '');
let equipment = parseNestedJsonString(remarks.equipment, {});
if (equipment[slot] && equipment[slot][item.index]) {
if (id === 'B1') restoreEquipmentRow(newState, equipment[slot][item.index]);
equipment[slot][item.index] = null;
remarks.equipment = JSON.stringify(equipment);
charRow['9'] = serializeRemarksObject(remarks);
}
}
break;
case 'addWorldEvent':
if (!newState['5']) newState['5'] = [];
// 确保有ID
if (!eventData.id) eventData.id = crypto.randomUUID();
newState['5'].push(eventData);
break;
case 'updateWorldEvent':
if (newState['5']) {
const evtIndex = newState['5'].findIndex(e => e.id === id);
if (evtIndex !== -1) {
newState['5'][evtIndex] = { ...newState['5'][evtIndex], ...data };
console.log(`[applyChanges] 更新世界大事 ${id}`);
}
}
break;
case 'deleteWorldEvent':
if (newState['5']) {
newState['5'] = newState['5'].filter(e => e.id !== id);
console.log(`[applyChanges] 删除世界大事 ${id}`);
}
break;
case 'addItem':
if (newState['0'][id]) {
const charRow = newState['0'][id];
const remarks = parseRemarksString(charRow['9'] || '');
let currentItems = parseNestedJsonString(remarks['inventory'], []);
const newItem = op.itemData;
const itemKey = newItem['0'] || newItem.id;
const existingIndex = currentItems.findIndex(item => (item['0'] || item.id) === itemKey);
if (existingIndex !== -1) currentItems[existingIndex] = { ...currentItems[existingIndex], ...newItem };
else currentItems.push(newItem);
remarks['inventory'] = JSON.stringify(currentItems);
charRow['9'] = serializeRemarksObject(remarks);
updatedCharacterIds.add(id);
}
break;
case 'addSkill':
if (newState['0'][id]) {
const charRow = newState['0'][id];
const remarks = parseRemarksString(charRow['9'] || '');
let currentSkills = parseNestedJsonString(remarks['skills'], []);
const newSkill = op.skillData;
const skillKey = newSkill['0'] || newSkill.id;
const existingSkillIndex = currentSkills.findIndex(skill => (skill['0'] || skill.id) === skillKey);
if (existingSkillIndex !== -1) currentSkills[existingSkillIndex] = { ...currentSkills[existingSkillIndex], ...newSkill };
else currentSkills.push(newSkill);
remarks['skills'] = JSON.stringify(currentSkills);
charRow['9'] = serializeRemarksObject(remarks);
updatedCharacterIds.add(id);
}
break;
case 'addTrait':
if (newState['0'][id]) {
const charRow = newState['0'][id];
const remarks = parseRemarksString(charRow['9'] || '');
let currentTraits = parseNestedJsonString(remarks['traits'], []);
const newTrait = op.traitData;
const traitKey = newTrait.name || newTrait['name'];
const existingTraitIndex = currentTraits.findIndex(trait => (trait.name || trait['name']) === traitKey);
if (existingTraitIndex !== -1) currentTraits[existingTraitIndex] = { ...currentTraits[existingTraitIndex], ...newTrait };
else currentTraits.push(newTrait);
remarks['traits'] = JSON.stringify(currentTraits);
charRow['9'] = serializeRemarksObject(remarks);
updatedCharacterIds.add(id);
}
break;
}
}
} catch (e) {
console.error('应用更改时出错:', op, e);
}
}

for (const [row, writesDetailedHealth] of healthWrites) {
  reconcileRemarkHealth(row, { preferDetailed: writesDetailedHealth });
}
if (bioHasChanged && lastLogWithBioIndex !== -1) {
archive.data.logs[lastLogWithBioIndex].biographySnapshot = Array.from(bioMap.values());
if (persistEffects) await db.archives.put(archive);
}

if (npcAvatarsNeedsUpdate) {
if (persistEffects) await db.archives.put(archive);
}
return { newState, characterNameChanges, updatedCharacterIds, settingsWrites };
}

// app.js 10694
        function parseNestedJsonString(str, fallback = []) {
          if (typeof str !== 'string' || !str) {
            if (typeof str === 'object' && str !== null) return str;
            return Array.isArray(fallback) ? [...fallback] : fallback;
          }
          let current = str;
          for (let i = 0; i < 3; i++) {
            if (typeof current !== 'string') return current;
            let tempStr = current.trim();
            try {
              const parsed = JSON.parse(tempStr);
              current = parsed;
              continue;
            } catch (e) {}
            if (
              (tempStr.startsWith('"') && tempStr.endsWith('"')) ||
              (tempStr.startsWith("'") && tempStr.endsWith("'"))
            ) {
              tempStr = tempStr.substring(1, tempStr.length - 1);
            }
            try {
              const fixedSingleQuote = tempStr.replace(/'/g, '"');
              const parsed = JSON.parse(fixedSingleQuote);
              current = parsed;
              continue;
            } catch (e) {}
            break;
          }
          if (typeof current === 'object' && current !== null) {
            return current;
          }
          return Array.isArray(fallback) ? [...fallback] : fallback;
        }

// app.js 10781
function parseTableEditCommands(commandsString, errorMessages = []) {
console.log('【步骤1: 进入 parseTableEditCommands】开始解析指令字符串...');
const delta = [];
let smallSummary = null;
let largeSummary = null;

if (typeof commandsString !== 'string') {
errorMessages.push({ title: '指令格式错误', details: '传入的指令不是一个有效的字符串。' });
return { delta, smallSummary, largeSummary };
}

let processedCommandsString = commandsString.replace(/([+-]?)RANDOM\((\d+)-(\d+)\)/g, (match, sign, minStr, maxStr) => {
const min = parseInt(minStr, 10);
const max = parseInt(maxStr, 10);
const randomValue = Math.floor(FRX.random() * (max - min + 1)) + min;
return sign ? (sign + randomValue.toString()) : randomValue.toString();
});

// FRX: consume every command, respecting JSON strings and escaped quotes.
const allowedCommands = new Set(['add','set','de','addWorldEvent','updateWorldEvent',
'deleteWorldEvent','addSmallSummary','addLargeSummary','updateAttribute','equipItem',
'unequipItem','createLocation','updateRegion','deleteLocation','addItem','addSkill','addTrait']);
const commands = [];
let cursor = 0;
while (cursor < processedCommandsString.length) {
  const rest = processedCommandsString.slice(cursor);
  const space = rest.match(/^[\s;]+|^\/\/[^\n]*(?:\n|$)|^\/\*[\s\S]*?\*\//);
  if (space) { cursor += space[0].length; continue; }
  const opening = rest.match(/^([A-Za-z_]\w*)\s*\(/);
  if (!opening || !allowedCommands.has(opening[1])) {
    errorMessages.push({title: '无法识别的状态指令', details: rest.slice(0, 120)});
    break;
  }
  let depth = 1, inString = false, escaped = false, endIndex = -1;
  for (let i = cursor + opening[0].length; i < processedCommandsString.length; i++) {
    const char = processedCommandsString[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) { endIndex = i; break; }
  }
  if (endIndex < 0) {
    errorMessages.push({title: '状态指令未结束', details: opening[1]});
    break;
  }
  commands.push(processedCommandsString.slice(cursor, endIndex + 1));
  cursor = endIndex + 1;
}

commands.forEach(commandStr => {
const match = commandStr.match(/^(\w+)\s*\(([\s\S]*)\)$/);
if (!match) return;
let command = match[1];
const argsString = match[2].trim();
try {
const args = JSON.parse('[' + argsString + ']', (key, value) => {
  if (['__proto__','constructor','prototype'].includes(key)) throw new Error('无效的对象字段');
  return value;
});
const arity = {set:[1,2], add:[2,2], de:[1,3], addWorldEvent:[2,3],
updateWorldEvent:[2,2], deleteWorldEvent:[1,1], addSmallSummary:[1,1], addLargeSummary:[1,1],
updateAttribute:[3,3], equipItem:[3,3], unequipItem:[3,3], createLocation:[1,1],
updateRegion:[1,1], deleteLocation:[1,1], addItem:[2,2], addSkill:[2,2], addTrait:[2,2]};
if (args.length < arity[command][0] || args.length > arity[command][1]) throw new Error('指令参数数量不正确');
if (command === 'set' && args.length === 2 && typeof args[0] === 'string') command = 'add';

let data, id, attribute, value, slot, item;
switch (command) {
case 'set':
data = recursivelyParseJsonStrings(args[0]);
delta.push({ command, data });
break;
case 'add':
id = args[0];
data = recursivelyParseJsonStrings(args[1]);
delta.push({ command, id, data });
break;
case 'addSmallSummary':
smallSummary = args[0];
break;
case 'addLargeSummary':
largeSummary = args[0];
break;
case 'de':
id = args[0];
delta.push({ command, id, subCategory: args[1], subId: args[2] });
break;
case 'addWorldEvent':
delta.push({
command: 'addWorldEvent',
eventData: { 0: args[0], 1: args[1], 2: args.length > 2 ? args.slice(2).join(', ') : '', id: FRX.uuid() },
});
break;
case 'updateWorldEvent':
delta.push({ command: 'updateWorldEvent', id: args[0], data: args[1] });
break;
case 'deleteWorldEvent':
delta.push({ command: 'deleteWorldEvent', id: args[0] });
break;
case 'updateAttribute':
delta.push({ command, id: args[0], attribute: args[1], value: args[2] });
break;
case 'equipItem':
case 'unequipItem':
delta.push({ command, id: args[0], slot: args[1], item: args[2] });
break;
case 'createLocation':
delta.push({ command: 'createLocation', locationData: args[0] });
break;
case 'updateRegion':
delta.push({ command: 'updateRegion', regionData: args[0] });
break;
case 'deleteLocation':
delta.push({ command: 'deleteLocation', locationId: args[0] });
break;
case 'addItem':
delta.push({ command: 'addItem', id: args[0], itemData: recursivelyParseJsonStrings(args[1]) });
break;
case 'addSkill':
delta.push({ command: 'addSkill', id: args[0], skillData: recursivelyParseJsonStrings(args[1]) });
break;
case 'addTrait':
delta.push({ command: 'addTrait', id: args[0], traitData: recursivelyParseJsonStrings(args[1]) });
break;
}
} catch (e) {
errorMessages.push({ title: `指令 "${command}" 解析失败`, details: e.message });
}
});

return { delta, smallSummary, largeSummary };
}

// app.js 29953
        function getInitialTableState() {
          const initialState = {
            0: {},
            1: {},
            2: {},
            3: {},
            4: [{ id: TIME_LOCATION_ROW_ID, 0: '' }],
            5: [],
            6: {},
            7: {},
            8: {},
            9: {},
            10: {},
          };
          initialState['10'] = { SCENE_MAP: {} };
          return initialState;
        }

module.exports = {
  TIME_LOCATION_ROW_ID,
  recursivelyParseJsonStrings,
  parseRemarksString,
  parseRemarkFields,
  serializeRemarksObject,
  getTableIndexFromId,
  applyChanges,
  parseNestedJsonString,
  parseTableEditCommands,
  getInitialTableState,
};
