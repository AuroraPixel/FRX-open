/* Character creation: the seven steps' rules, the draws of traits and spirit roots, and the
 * new save handleStartGame builds. The options themselves (CREATION_CONFIG) are content/creation.json.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 39935
        let creationState = {};

// app.js 41690
        function startCharacterCreation() {
          const defaultAttributes = {};
          Object.keys(CREATION_CONFIG.ATTRIBUTES).forEach(key => {
            defaultAttributes[key] = { current: 0, max: 0 };
          });

          creationState = {
            currentStep: 1,
            totalPoints: 0,
            selectedDifficulty: null,
            isExtreme: false,
            attributes: defaultAttributes,
            selectedBirth: null,
            selectedGender: null,
            avatarAppearance: 'auto',
            selectedPronoun: '第二人称',
            customAvatar: null,
            initialAge: 16,
            selectedRace: null,
            customBirth: null,
            customRace: null,
            currentTraitOptions: [],
            selectedTraits: [],
            selectedLinggen: null,
            bondedCharacters: [],
            birthLocation: null,
            deathCount: 0,
            selectedWorldFactors: [],
          };
        }

// app.js 41722
        function calculateRemainingPoints() {
          let points = creationState.totalPoints || 0;
          const allocatedPoints = Object.values(creationState.attributes).reduce((sum, val) => sum + (val.max || 0), 0);

          let birthCost = 0;
          if (creationState.selectedBirth) {
            if (creationState.selectedBirth === '自定义') {
              birthCost = CREATION_CONFIG.BIRTHS['自定义'].cost;
            } else {
              birthCost = CREATION_CONFIG.BIRTHS[creationState.selectedBirth].cost;
            }
          }

          let raceCost = 0;
          if (creationState.selectedRace) {
            if (creationState.selectedRace === '自定义') {
              raceCost = CREATION_CONFIG.RACES['自定义'].cost;
            } else {
              raceCost = CREATION_CONFIG.RACES[creationState.selectedRace].cost;
            }
          }

          const linggenCost = creationState.selectedLinggen
            ? CREATION_CONFIG.LINGGEN[creationState.selectedLinggen]?.cost || 0
            : 0;

          const traitCost = 0; // 直接将词条消耗的点数设置为0

          return points - allocatedPoints - birthCost - raceCost - linggenCost - traitCost;
        }

// app.js 42377
        async function handleRandomizeTraits() {
          const cost = 10;
          if (calculateRemainingPoints() < cost) {
            await showCustomAlert('属性点不足，无法刷新词条！');
            return;
          }

          creationState.totalPoints -= cost;

          const handleAnimationEnd = async () => {
            creationState.currentTraitOptions = await generateRandomTraits();
          };

          await handleAnimationEnd();
        }

// app.js 42403
        async function generateRandomTraits() {
          const allTraits = [];
          for (const rarity in CREATION_CONFIG.TRAITS) {
            CREATION_CONFIG.TRAITS[rarity].forEach(trait => {
              allTraits.push({ ...trait, rarity });
            });
          }

          const customTraits = await getCustomTraits();
          const activeCustomTraits = customTraits.filter(t => t.inPool);
          allTraits.push(...activeCustomTraits);

          const traits = [];
          const rarityPool = [
            ...Array(40).fill('平庸'),
            ...Array(30).fill('普通'),
            ...Array(15).fill('稀有'),
            ...Array(10).fill('史诗'),
            ...Array(4).fill('传说'),
            ...Array(1).fill('神迹'),
          ];

          while (traits.length < 6) {
            const randRarity = rarityPool[Math.floor(Math.random() * rarityPool.length)];
            const traitPool = allTraits.filter(t => t.rarity === randRarity);
            if (traitPool.length === 0) continue;

            const randTrait = traitPool[Math.floor(Math.random() * traitPool.length)];
            if (!traits.some(t => t.name === randTrait.name)) {
              traits.push(randTrait);
            }
          }
          return traits;
        }

// app.js 42438
        async function handleTraitSelect(traitName, isSelfSelected = false) {
          const MAX_TRAITS = 5;

          const traitIndex = creationState.selectedTraits.findIndex(t => t.name === traitName);

          if (traitIndex > -1) {
            creationState.selectedTraits.splice(traitIndex, 1);
          } else {
            if (creationState.selectedTraits.length >= MAX_TRAITS) {
              await showCustomAlert(`最多只能选择 ${MAX_TRAITS} 个词条！`);
              return;
            }

            let trait;
            if (isSelfSelected) {
              const allTraits = [];
              for (const rarity in CREATION_CONFIG.TRAITS) {
                CREATION_CONFIG.TRAITS[rarity].forEach(t =>
                  allTraits.push({
                    ...t,
                    rarity,
                  }),
                );
              }
              allTraits.push(...(await getCustomTraits()));
              trait = allTraits.find(t => t.name === traitName);
            } else {
              trait = creationState.currentTraitOptions.find(t => t.name === traitName);
            }

            if (trait) {
              creationState.selectedTraits.push(trait);
            }
          }
        }

// app.js 42862
        async function handleRandomizeLinggen() {
          const cost = 2;
          const oldCost = creationState.selectedLinggen
            ? CREATION_CONFIG.LINGGEN[creationState.selectedLinggen]?.cost || 0
            : 0;
          if (calculateRemainingPoints() + oldCost < cost) {
            await showCustomAlert('属性点不足，无法测定灵根！');
            return;
          }

          creationState.totalPoints -= cost;

          const roll = Math.random() * 100;
          let numAttributes;
          let type;
          let forceSpecial = false;

          if (roll < 2) {
            numAttributes = 1;
            type = '天灵根';
          } else if (roll < 4) {
            numAttributes = 1;
            type = '异灵根';
            forceSpecial = true;
          } else if (roll < 22) {
            numAttributes = Math.random() < 0.7 ? 2 : 3;
            type = '真灵根';
          } else if (roll < 23) {
            creationState.selectedLinggen = '无灵根';
            return;
          } else {
            numAttributes = Math.random() < 0.8 ? 4 : 5;
            type = '伪灵根';
          }

          const baseStandardAttributes = ['金', '木', '水', '火', '土'];
          const baseSpecialAttributes = ['冰', '风', '雷', '暗'];

          let attributesPool;
          if (forceSpecial) {
            attributesPool = baseSpecialAttributes;
          } else {
            attributesPool = baseStandardAttributes;
          }

          const selectedAttributes = [];
          let candidatePool = [...new Set(attributesPool)];

          while (selectedAttributes.length < numAttributes && candidatePool.length > 0) {
            const randomIndex = Math.floor(Math.random() * candidatePool.length);
            const attribute = candidatePool.splice(randomIndex, 1)[0];
            selectedAttributes.push(attribute);
          }

          let linggenName = type;
          if (selectedAttributes.length > 0) {
            linggenName += ' ' + selectedAttributes.join(',');
          }

          creationState.selectedLinggen = linggenName;
        }

// app.js 43098
        function sanitizeCustomTraitForGameState(trait) {
          return {
            name: trait.name,
            desc: trait.desc,
            effects: trait.effects,
            bonus: trait.bonus,
            rarity: trait.rarity,
          };
        }

// app.js 43151
        async function handleStartGame() {
          try {
            const archiveName = await showCustomPrompt('为你的新人生命名:', '我的修仙路');
            if (!archiveName) {
              console.log('用户取消了创建。');
              return;
            }

            const existing = await db.archives.get(archiveName);
            if (existing) {
              await showCustomAlert('该名称的存档已存在，请换个名字！');
              return;
            }

            let pronoun = '你';
            let finalPlayerName = '你';
            switch (creationState.selectedPronoun) {
              case '第一人称':
                pronoun = '我';
                finalPlayerName = '我';
                break;
              case '第三人称':
                pronoun = '{{user}}';
                finalPlayerName = '{{user}}';
                break;
            }

            const finalAttributes = {};
            Object.keys(CREATION_CONFIG.ATTRIBUTES).forEach(key => {
              const maxVal = creationState.attributes[key].max || 0;
              finalAttributes[key] = { current: maxVal, max: maxVal };
            });

            if (!finalAttributes['血量']) {
              finalAttributes['血量'] = { current: 100, max: 100 };
            }

            let birthName, birthDesc, birthBonus;
            if (creationState.selectedBirth === '自定义') {
              birthName = creationState.customBirth.name;
              birthDesc = creationState.customBirth.description;
              birthBonus = creationState.customBirth.attributes;
            } else {
              const birthData = CREATION_CONFIG.BIRTHS[creationState.selectedBirth];
              birthName = creationState.selectedBirth;
              birthDesc = birthData.desc;
              birthBonus = birthData.bonus;
            }
            if (birthBonus) {
              Object.entries(birthBonus).forEach(([key, val]) => {
                if (finalAttributes[key]) {
                  finalAttributes[key].max += val;
                  finalAttributes[key].current += val;
                }
              });
            }

            let raceName, raceDesc, raceBonus;
            if (creationState.selectedRace === '自定义') {
              raceName = creationState.customRace.name;
              raceDesc = creationState.customRace.description;
              raceBonus = creationState.customRace.attributes;
            } else {
              const raceData = CREATION_CONFIG.RACES[creationState.selectedRace];
              raceName = creationState.selectedRace;
              raceDesc = raceData.desc;
              raceBonus = raceData.bonus;
            }
            if (raceBonus) {
              Object.entries(raceBonus).forEach(([key, val]) => {
                if (finalAttributes[key]) {
                  finalAttributes[key].max += val;
                  finalAttributes[key].current += val;
                }
              });
            }
            const startingInventory = [];
            const sanitizedTraits = [];
            creationState.selectedTraits.forEach(trait => {
              const cleanTrait = sanitizeCustomTraitForGameState(trait);
              sanitizedTraits.push(cleanTrait);

              if (trait.item && trait.item !== '无') {
                const itemMatch = trait.item.match(/【(.*?)】/);
                if (itemMatch) {
                  const parts = itemMatch[1].split('|');
                  startingInventory.push({
                    name: parts[0] || '未知物品',
                    description: parts[1] || '先天气运带来的物品',
                    type: parts[2] || '重要物品',
                    effect: parts[3] || '未知',
                    quantity: parseInt(parts[4] || '1'),
                  });
                }
              }
            });

            const [mainLoc, subLoc] = creationState.birthLocation.split('|')[0].split('/');

            let worldFactorsHtml = '';
            if (creationState.selectedWorldFactors && creationState.selectedWorldFactors.length > 0) {
              worldFactorsHtml = `
<details open><summary><strong>世界规则变动 (世界因子)</strong></summary>
<ul>
${creationState.selectedWorldFactors
  .map(
    f => `
<li><strong style="color:#e0e0e0;">[${f.name}]</strong>: ${f.desc} <br><span style="font-size:0.9em; color:#aaa;">(效果: ${f.effect})</span></li>
`,
  )
  .join('')}
</ul>
</details>`;
            }

            let openingMonologue = `
<div class="log-entry summary">
<h4>天道初启</h4>
${worldFactorsHtml} 
<p>${pronoun}以 <strong>${birthName}</strong> 的身份出身。${birthDesc}</p>
<p>${pronoun}的种族为 <strong>${raceName}</strong>。${raceDesc}</p>
<p>${pronoun}的灵根为: <strong>${creationState.selectedLinggen}</strong></p>
<details><summary><strong>${pronoun}的先天气运</strong></summary><ul>${
              sanitizedTraits
                .map(trait => `<li><strong>[${trait.rarity}] ${trait.name}:</strong> ${trait.desc}</li>`)
                .join('') || '<li>无</li>'
            }</ul></details>
<details><summary><strong>${pronoun}的最终属性</strong></summary><ul>${Object.entries(finalAttributes)
              .map(([key, val]) => `<li>${key}: ${val.current}/${val.max}</li>`)
              .join('')}</ul></details>
${
  creationState.bondedCharacters.length > 0
    ? `<details><summary><strong>${pronoun}的羁绊之人</strong></summary><ul>${creationState.bondedCharacters
        .map(c => `<li><strong>${c.name} (${c.identity}):</strong> ${c.background}</li>`)
        .join('')}</ul></details>`
    : ''
}
<p>${pronoun}的故事，将在 <strong>${mainLoc}${subLoc ? `的${subLoc}` : ''}</strong> 开始...</p>
</div>
`;

            const newTableState = getInitialTableState();
            const playerRemarks = `灵根:${creationState.selectedLinggen}|善恶值:0|年龄:${
              creationState.initialAge
            }|寿元:100|修为进度:0%|traits:${JSON.stringify(sanitizedTraits)}|avatar:${
              creationState.avatarAppearance
            }|isExtreme:${creationState.isExtreme}|warehouse:[]|deathCount:0`;
            const playerRow = {
              0: 'B1',
              1: `${finalPlayerName}|${creationState.selectedGender}`,
              2: `凡人|${birthName}`,
              3: '待定',
              4: '一切正常',
              5: '待定',
              6: '待定',
              7: '待定',
              8: '待定',
              9: playerRemarks,
              10: '待定',
              11: JSON.stringify(finalAttributes),
              12: '待定',
              13: '',
              14: '',
              15: '',
              16: '待定',
              17: '待定',
              18: '待定',
              19: '待定',
              20: '待定',
              21: '待定',
              22: '待定',
              23: '待定',
              24: '待定',
              25: '待定',
              26: '待定',
              27: '待定',
              28: '待定',
              29: '待定',
              30: '待定',
              31: '待定',
              32: '待定',
              33: '待定',
              34: '待定',
              35: '待定',
            };
            newTableState['0']['B1'] = playerRow;
            creationState.bondedCharacters.forEach((c, index) => {
              const bondId = `G${index + 1}`;
              const remarks = `年龄:${c.age}|寿元:${c.shouyuan}`;
              newTableState['0'][bondId] = {
                0: bondId,
                1: `${c.name}|${c.gender}`,
                2: `${c.realm}|${c.identity}`,
                3: c.personality,
                4: '一切正常',
                9: remarks,
                10: c.background,
                11: c.attributes,
                12: c.motive,
                15: c.favorability,
                16: `|${c.attire}||${c.figure}|${c.appearance}`,
              };
            });
            startingInventory.forEach((item, index) => {
              const itemId = `I${index + 1}`;
              newTableState['1'][itemId] = {
                0: itemId,
                1: item.name,
                2: item.type,
                3: item.description,
                4: item.effect,
                5: item.quantity.toString(),
              };
            });

            newTableState['4'][0] = {
              id: TIME_LOCATION_ROW_ID,
              0: `0001年 01月 01日 08:00/${creationState.birthLocation}`,
            };

            const newArchive = {
              name: archiveName,
              data: {
                logs: [
                  {
                    id: crypto.randomUUID(),
                    timestamp: new Date().toISOString(),
                    content: openingMonologue.trim(),
                    stateSnapshot: JSON.stringify(newTableState),
                  },
                ],
                state: {
                  currentState: newTableState,
                  bondedCharacters: {},
                  rpgMaps: {},
                  npcAvatars: {},
                  worldMap: JSON.parse(JSON.stringify(WORLD_MAP_DATA)),
                  worldBookEntries: [],
                },
              },
            };

            await db.archives.add(newArchive);
            await selectAndLoadArchive(archiveName);
            await showCustomAlert('存档创建成功，你的人生开始了！');
          } catch (error) {
            console.error('创建存档时发生严重错误:', error);
            await showCustomAlert(`创建存档失败: ${error.message}`);
          }
        }

// app.js 43409
        async function getCustomTraits() {
          return (await dbGet(CUSTOM_TRAITS_KEY)) || [];
        }

module.exports = {
  creationState,
  startCharacterCreation,
  calculateRemainingPoints,
  handleRandomizeTraits,
  generateRandomTraits,
  handleTraitSelect,
  handleRandomizeLinggen,
  sanitizeCustomTraitForGameState,
  handleStartGame,
  getCustomTraits,
};
