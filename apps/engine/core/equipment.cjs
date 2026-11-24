/* Gear and the bag: the worn items in the player's remarks, the stored items, putting on and
 * taking off, tidying, and the attribute totals the gear gives.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 12378
        function restoreEquipmentRow(state, item) {
          const id = item.id || item['0'];
          if (!id) return;
          state['1'] ||= {};
          if (state['1'][id]) return;
          if (!item.id) {
            state['1'][id] = { ...item };
            return;
          }
          const row = { '0': id, '1': item.name, '2': item.type, '3': item.description, '5': String(item.quantity ?? 1) };
          if (item.type === '功法') {
            Object.assign(row, { '6': item.grade, '7': item.maxRealm, '8': item.realmEffects, '9': item.currentEffect });
          } else row['4'] = item.effect;
          state['1'][id] = row;
        }

// app.js 12394
        function equippedItemRows(row) {
          const remarks = parseRemarksString(row?.['9']);
          return Object.values(parseNestedJsonString(remarks.equipment, {}) || {}).flat().filter(Boolean);
        }

// app.js 12399
        function storedItemIds(state, includePlayerEquipment = true) {
          const ids = new Set();
          const remember = item => {
            const id = item?.id || item?.['0'];
            if (id) ids.add(id);
          };
          for (const row of Object.values(state['0'] || {})) {
            if (!row) continue;
            const remarks = parseRemarksString(row['9']);
            for (const key of ['inventory', 'warehouse']) {
              const items = parseNestedJsonString(remarks[key], []);
              if (Array.isArray(items)) items.forEach(remember);
            }
            if (row['0'] === 'B1' && !includePlayerEquipment) continue;
            equippedItemRows(row).forEach(remember);
          }
          return ids;
        }

// app.js 12418
        function itemStackCount(value) {
          if (value === undefined) return 1; // Original single items can omit column 5.
          if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return NaN;
          const count = Number(value);
          return Number.isSafeInteger(count) && count >= 0 ? count : NaN;
        }

// app.js 15442
        function getPlayerEquipmentString() {
const equipmentSlots = ['weapon', 'armor', 'technique', 'treasure'];
const equippedItems = [];

equipmentSlots.forEach(slotKey => {
if (currentPlayerData[slotKey]) {
currentPlayerData[slotKey].forEach(item => {
if (item) {

const cleanName = (item.name || '未知').replace(/<[^>]+>/g, '');
equippedItems.push(`${cleanName} (${item.type})`);
}
});
}
});

return equippedItems.length > 0 ? equippedItems.join(', ') : '无';
}

// app.js 39664
        function _updateEquipmentSlot(slotKey, slotIndex, newItem) {
          const playerRow = currentState['0']['B1'];
          if (!playerRow) return;

          const remarks = parseRemarksString(playerRow['9'] || '');
          let equipment = {};
          try {
            equipment = JSON.parse(remarks.equipment || '{}');
          } catch (e) {}

          if (!equipment[slotKey]) {
            equipment[slotKey] = Array(6).fill(null);
          }

          const oldItem = equipment[slotKey][slotIndex];

          // 核心修复：卸载时将数据写回储物袋
          if (newItem && (!currentState['1']?.[newItem.id] || storedItemIds(currentState).has(newItem.id))) {
            showDanmaku('储物袋中没有可装备的物品', 'error');
            return;
          }
          if (oldItem) restoreEquipmentRow(currentState, oldItem);

          equipment[slotKey][slotIndex] = newItem;

          if (newItem && newItem.id) {
            delete currentState['1'][newItem.id];
          }

          remarks.equipment = JSON.stringify(equipment);
          playerRow['9'] = serializeRemarksObject(remarks);

          saveCurrentState();
          syncStateFromTables();
        }

// app.js 39703
        function equipItem(item, slotType, slotIndex) {
          const slotKeyMap = { 武器: 'weapon', 护甲: 'armor', 功法: 'technique', 法宝: 'treasure' };
          const slotKey = slotKeyMap[slotType] || slotType;
          if (!slotKey) return;

          // 立即执行本地更新，不生成指令
          _updateEquipmentSlot(slotKey, slotIndex, item);

          // 这里删除了 addAction 调用
        }

// app.js 39715
        function unequipItem(slotKey, slotIndex) {
          const keyMap = { 武器: 'weapon', 护甲: 'armor', 功法: 'technique', 法宝: 'treasure' };
          const realKey = keyMap[slotKey] || slotKey;

          // 立即执行本地更新，不生成指令
          _updateEquipmentSlot(realKey, slotIndex, null);

          // 这里删除了 addAction 调用
        }

// app.js 46699
        function calculateTotalAttributes(characterId) {
          const character = characterId === 'B1' ? currentPlayerData : characterDatabase[characterId];
          if (!character) return {};

          const baseAttributes = character.detailedAttributes || {};
          let detailedAttributes = {};

          const attributeKeys = [
            '血量',
            '物攻',
            '物防',
            '脚力',
            '法攻',
            '法防',
            '法力',
            '神识',
            '物理穿透',
            '法术穿透',
            '气运',
            '魅力',
          ];

          attributeKeys.forEach(attrKey => {
            const baseAttribute = baseAttributes[attrKey] || { current: 0, max: 0 };
            let sources = {
              base: baseAttribute.max || 0,
              sect: 0,
              equipment: 0,
              buffs: 0,
              traits: 0,
            };

            if (characterId === 'B1') {
              const equipmentSlots = ['weapon', 'armor', 'technique', 'treasure'];
              equipmentSlots.forEach(slotKey => {
                (currentPlayerData[slotKey] || []).forEach(item => {
                  if (!item || !item.effect) return;
                  const effectString = item.type === '功法' ? item.currentEffect || '' : item.effect || '';
                  if (!effectString) return;

                  const parts = effectString.split(/[,，]/);
                  parts.forEach(part => {
                    const match = part.trim().match(/([\u4e00-\u9fa5]+)\s*([+-])\s*(\d+\.?\d*)(\%?)/);
                    if (match) {
                      const attr = match[1].trim();
                      if (attr === attrKey) {
                        const sign = match[2];
                        const value = parseFloat(match[3]);
                        const isPercent = match[4] === '%';
                        const finalValue = sign === '+' ? value : -value;
                        if (isPercent) {
                          sources.equipment += Math.floor(sources.base * (finalValue / 100));
                        } else {
                          sources.equipment += finalValue;
                        }
                      }
                    }
                  });
                });
              });
            }

            const buffsString = character.status || '';
            if (buffsString && buffsString !== '一切正常') {
              const buffMatches = buffsString.matchAll(/[①-⑳][^:(]+:?.*?\(([^)]*)\)/g);
              for (const match of buffMatches) {
                const effectPart = match[1];
                const effectSegments = effectPart.split(/[,，|]/);
                effectSegments.forEach(segment => {
                  const valueMatch = segment.trim().match(new RegExp(`^${attrKey}\\s*([+-])\\s*(\\d+)`));
                  if (valueMatch) {
                    const sign = valueMatch[1];
                    const value = parseInt(valueMatch[2]);
                    sources.buffs += sign === '+' ? value : -value;
                  }
                });
              }
            }

            const traits = character.playerTraits || character.npcTraits || [];
            if (Array.isArray(traits)) {
              traits.forEach(trait => {
                if (trait.bonus && trait.bonus[attrKey]) {
                  sources.traits += trait.bonus[attrKey];
                }
              });
            }

            const totalBonus = sources.sect + sources.equipment + sources.buffs + sources.traits;
            detailedAttributes[attrKey] = {
              current: Math.round((baseAttribute.current || 0) + totalBonus),
              max: Math.round((baseAttribute.max || 0) + totalBonus),
              bonus: Math.round(totalBonus),
              sources: {
                base: Math.round(sources.base),
                traits: Math.round(sources.traits),
                equipment: Math.round(sources.equipment),
                sect: Math.round(sources.sect),
                buffs: Math.round(sources.buffs),
              },
            };
          });

          return detailedAttributes;
        }

// app.js 47900
        function sortInventory() {
          const sortedItems = [...inventoryItems].sort((a, b) => {
            if (a.type < b.type) return -1;
            if (a.type > b.type) return 1;
            return 0;
          });

          const newInventoryState = {};
          sortedItems.forEach(item => {
            newInventoryState[item.id] = currentState['1'][item.id];
          });

          currentState['1'] = newInventoryState;
          saveCurrentState();
          syncStateFromTables();
          showDanmaku('储物袋已整理', 'player');
        }

module.exports = {
  restoreEquipmentRow,
  equippedItemRows,
  storedItemIds,
  itemStackCount,
  getPlayerEquipmentString,
  _updateEquipmentSlot,
  equipItem,
  unequipItem,
  calculateTotalAttributes,
  sortInventory,
};
