/* The save and the page's view of it: loading a save into the page's variables
 * (selectAndLoadArchive, loadState, syncStateFromTables), saving them back, the player's log, and
 * the characters' snapshots and biographies.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 12425
        function syncStateFromTables(stateToSync = currentState, targetObject = null) {
          const targetPlayerData = targetObject ? {} : currentPlayerData;
          const targetInventoryItems = targetObject ? [] : inventoryItems;

          let authoritativeLocation = '未知';
          let authoritativeDetailedLocation = '未知';
          let authoritativeFullLocationString = '时间未知/未知';
          const timeRow =
            (stateToSync['4'] || []).find(row => row.id === TIME_LOCATION_ROW_ID) || (stateToSync['4'] || [])[0];

          if (timeRow && timeRow['0']) {
            authoritativeFullLocationString = timeRow['0'];
            const firstSlashIndex = authoritativeFullLocationString.indexOf('/');

            if (firstSlashIndex !== -1) {
              const locationPart = authoritativeFullLocationString.substring(firstSlashIndex + 1).trim();

              authoritativeLocation = locationPart;
              authoritativeDetailedLocation = locationPart;
            } else {
              authoritativeLocation = authoritativeFullLocationString;
              authoritativeDetailedLocation = authoritativeFullLocationString;
            }
          }

          const allItemsInTable = Object.values(stateToSync['1'] || {});
          const possessedItemIds = storedItemIds(stateToSync);

          const currentSceneChars = {};
          const allCharsInTable = Object.values(stateToSync['0'] || {});

          allCharsInTable.forEach(row => {
            const [name, gender] = (row['1'] || '|').split('|');
            const [realm, identity] = (row['2'] || '|').split('|');
            const remarks = parseRemarksString(row['9']);
            const actionParts = (row['16'] || '||||').split('|');
            const detailedAttributes = parseNestedJsonString(row['11'], {});

            if (!detailedAttributes['血量'] || typeof detailedAttributes['血量'] !== 'object') {
              if (remarks.hp && typeof remarks.hp === 'string' && remarks.hp.includes('/')) {
                const hpParts = remarks.hp.split('/');
                detailedAttributes['血量'] = {
                  current: parseInt(hpParts[0], 10) || 0,
                  max: parseInt(hpParts[1], 10) || 100,
                };
              }
            }

            let equipment = {
              weapon: Array(6).fill(null),
              armor: Array(6).fill(null),
              technique: Array(6).fill(null),
              treasure: Array(6).fill(null),
            };

            const storedEquipment = parseNestedJsonString(remarks.equipment, {});
            for (const key in equipment) {
              if (storedEquipment[key]) {
                const equipData = storedEquipment[key];
                equipment[key] = Array.isArray(equipData) ? equipData : equipData ? [equipData] : [];
              }
            }

            let npcInventory = [];
            const parsedInventory = parseNestedJsonString(remarks['inventory'], []);
            npcInventory = parsedInventory.map(itemRow => {
              const itemId = itemRow.id || itemRow['0'];
              const isTechnique = (itemRow.type || itemRow['2']) === '功法';
              return {
                id: itemId,
                name: itemRow.name || itemRow['1'],
                type: itemRow.type || itemRow['2'],
                description: itemRow.description || itemRow['3'],
                effect: isTechnique ? itemRow.currentEffect || itemRow['9'] : itemRow.effect || itemRow['4'],
                quantity: parseInt(itemRow.quantity || itemRow['5'] || '1'),
                grade: itemRow.grade || itemRow['6'],
                maxRealm: itemRow.maxRealm || itemRow['7'],
                realmEffects: itemRow.realmEffects || itemRow['8'],
                currentEffect: itemRow.currentEffect || itemRow['9'],
              };
            });

            const npcSkills = parseNestedJsonString(remarks.skills, []);
            const npcTraits = parseNestedJsonString(remarks.traits, []);

            const fullLocation = actionParts[2] || '未知';
            let coordinates = null;
            const coordMatch = fullLocation.match(/(-?\d+),(-?\d+)/);
            if (coordMatch) {
              coordinates = coordMatch.slice(1).map(Number);
            }

            const charData = {
              id: row['0'],
              name: name,
              gender: gender,
              realm: (realm || '').trim(),
              identity: (identity || '').trim(),
              personality: row['3'],
              status: row['4'],
              linggen: row['5'] || '无',
              specialConstitution: row['6'] || '无',
              appellation: row['7'] || '道友',
              sexExperience: row['8'] || '0次(纯洁)',
              background: row['10'],
              detailedAttributes: detailedAttributes,
              motive: row['12'],
              rawRelations: row['13'],
              favorability: row['15'] || '0',
              action: actionParts[0] || '无',
              attire: actionParts[1] || '无',
              location: fullLocation,
              coordinates: coordinates,
              figure: actionParts[3] || '未知',
              appearance: actionParts[4] || '未知',
              publicKink: row['17'] || '待发现',
              privateKink: row['18'] || '待发现',
              imageGenPrompt: row['19'],
              age: remarks['年龄'] || '未知',
              shouyuan: remarks['寿元'] || '未知',
              sensitiveParts: row['20'] || '未知',
              genitalStatus: row['21'] || '未知',
              eroticValue: row['22'] || '0',
              pleasureValue: row['23'] || '0',
              sexualConception: row['24'] || '未知',
              spiritStones: row['26'],
              27: row['27'],
              28: row['28'],
              29: row['29'],
              35: row['35'],
              isBonded: remarks['isBonded'] === 'true',
              deeds: remarks['deeds'] || '',
              visualData: parseNestedJsonString(remarks['visual'], null),
              31: row['31'],
              32: row['32'],
              weapon: equipment.weapon,
              armor: equipment.armor,
              technique: equipment.technique,
              treasure: equipment.treasure,
              inventoryItems: npcInventory,
              skills: npcSkills,
              npcTraits: npcTraits,
            };

            if (charData.id === 'B1') {
              let warehouse = [];
              try {
                warehouse = parseNestedJsonString(remarks['warehouse'], []);
              } catch (e) {}

              const finalPlayerData = {
                ...charData,
                linggen: remarks['灵根'] || '无',
                shanE: remarks['善恶值'] || '0',
                progress: (remarks['修为进度'] || '0%').replace('%', ''),
                hp: charData.detailedAttributes['血量'],
                playerTraits: parseNestedJsonString(remarks['traits'], []),
                avatarAppearance: remarks['avatar'] || 'auto',
                isExtreme: remarks['isExtreme'] === 'true',
                warehouse: warehouse,
                deathCount: parseInt(remarks['deathCount'] || '0'),
              };

              if (targetObject) {
                targetObject.playerData = finalPlayerData;
              } else {
                Object.assign(currentPlayerData, finalPlayerData);
              }
            } else {
              currentSceneChars[charData.id] = charData;
            }
          });

          const playerInventory = allItemsInTable
            .filter(row => row && !possessedItemIds.has(row['0']) && itemStackCount(row['5']) > 0)
            .map(row => {
              const baseItem = {
                id: row['0'],
                name: row['1'],
                type: row['2'],
                description: row['3'],
                quantity: itemStackCount(row['5']),
              };
              if (row['2'] === '功法') {
                baseItem.grade = row['6'] || '未知品阶';
                baseItem.maxRealm = row['7'] || '未知上限';
                baseItem.realmEffects = row['8'] || '无';
                baseItem.currentEffect = row['9'] || '';
                baseItem.effect = row['9'] || '暂无加成';
              } else {
                baseItem.effect = row['4'];
              }
              return baseItem;
            });

          if (targetObject) {
            targetObject.inventoryItems = playerInventory;
          } else {
            inventoryItems = playerInventory;
          }

          if (targetObject) {
            targetObject.playerData.location = authoritativeLocation;
            targetObject.playerData.detailedLocation = authoritativeDetailedLocation;
            targetObject.playerData.fullLocationString = authoritativeFullLocationString;
          } else {
            currentPlayerData.location = authoritativeLocation;
            currentPlayerData.detailedLocation = authoritativeDetailedLocation;
            currentPlayerData.fullLocationString = authoritativeFullLocationString;
          }

          const currentBonded = targetObject ? {} : bondedCharacters;
          Object.keys(currentBonded).forEach(id => {
            if (currentSceneChars[id]) {
              currentBonded[id] = { ...currentBonded[id], ...currentSceneChars[id] };
            }
          });

          const finalCharDB = { ...currentSceneChars, ...currentBonded };
          const finalSurroundingChars = Object.values(finalCharDB);

          if (targetObject) {
            targetObject.characterDatabase = finalCharDB;
            targetObject.surroundingCharacters = finalSurroundingChars;
          } else {
            characterDatabase = finalCharDB;
            surroundingCharacters = finalSurroundingChars;
          }
        }

// app.js 13395
        async function saveToLog(archiveName, newEntry) {
          // FRX: appending a log is safe to repeat on a fresh copy when another write landed first.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const archive = await db.archives.get(archiveName);
              if (!archive) return;
              if (!archive.data.logs.some(log => log.id === newEntry.id)) archive.data.logs.push(newEntry);
              await db.archives.put(archive);
              return;
            } catch (e) {
              if (attempt < 2 && /其他操作中变化/.test(e.message)) continue;
              console.error('保存日志到数据库失败:', e);
              return;
            }
          }
        }

// app.js 14489
        function parseSnapshotToRowObject(snapshotText) {
          const row = { 9: '{}', 11: '{}' };
          if (!snapshotText) return row;

          const lines = snapshotText.split('\n');
          const remarks = {};
          const detailedAttributes = {};

          const idMatch = snapshotText.match(/\[角色ID: (C\d+|G\d+)\]/);
          if (idMatch) row['0'] = idMatch[1];

          for (const line of lines) {
            const parts = line.split(':');
            if (parts.length < 2) continue;

            const key = parts[0].replace('-', '').trim();
            const value = parts.slice(1).join(':').trim();

            if (key === '名称/性别') row['1'] = value;
            else if (key === '境界/身份') row['2'] = value;
            else if (key === '性格') row['3'] = value;
            else if (key === 'Buffs/状态') row['4'] = value;
            else if (key === '灵根') row['5'] = value;
            else if (key === '特殊体质') row['6'] = value;
            else if (key === '对玩家的称呼') row['7'] = value;
            else if (key === '性经验') row['8'] = value;
            else if (key === '背景/简介') row['10'] = value;
            else if (key === '内心想法/动机') row['12'] = value;
            else if (key === '人际关系') row['13'] = value;
            else if (key === '好感度') row['15'] = value;
            else if (key === '视觉细节(动作/穿着/位置/身段/样貌)') row['16'] = value;
            else if (key === '表性癖') row['17'] = value;
            else if (key === '里性癖') row['18'] = value;
            else if (key === '当前灵石') row['26'] = value;
            else if (key === '生平经历') row['35'] = value;
            else if (['年龄', '寿元', '善恶值', 'isBonded'].includes(key)) {
              remarks[key] = value;
            } else if (value.includes('/')) {
              const valParts = value.split('/');
              if (valParts.length === 2 && !isNaN(parseInt(valParts[0])) && !isNaN(parseInt(valParts[1]))) {
                detailedAttributes[key] = { current: parseInt(valParts[0]), max: parseInt(valParts[1]) };
              }
            }
          }

          if (Object.keys(remarks).length > 0) row['9'] = JSON.stringify(remarks);
          if (Object.keys(detailedAttributes).length > 0) row['11'] = JSON.stringify(detailedAttributes);

          return row;
        }

// app.js 15273
        async function autoGenerateCharacterWorldBooks(updatedCharacterIds, logEntry, finalState) {
          if (
            !knowledgeSearchGlobalConfig.knowledgeBaseEnabled ||
            !knowledgeSearchGlobalConfig.attachBiographyToSnapshot
          ) {
            return;
          }
          if (!updatedCharacterIds || updatedCharacterIds.size === 0) {
            return;
          }
          const archive = await db.archives.get(currentArchiveName);
          let previousBiographies = archive?.data?.state?.worldBookEntries;
          if (!Array.isArray(previousBiographies)) {
            const lastLogWithBio = [...(archive?.data?.logs || [])]
              .reverse()
              .find(log => Array.isArray(log.biographySnapshot) && log.id !== logEntry.id
                && !log.isGhost && !log.isDeepSummary && !log.isUndoSnapshot);
            previousBiographies = lastLogWithBio?.biographySnapshot || [];
          }
          let biographiesToUpdate = JSON.parse(JSON.stringify(previousBiographies));
          let changesMade = false;
          for (const charId of updatedCharacterIds) {
            if (!charId.startsWith('C') && !charId.startsWith('G')) {
              continue;
            }
            const charData = finalState['0'][charId];
            if (!charData) continue;
            const characterSnapshotContent = getSingleCharacterSnapshot(charId, finalState);
            const charName = charData['1']?.split('|')[0] || charId;
            // 1. 尝试通过 ID 匹配
            let existingEntryIndex = biographiesToUpdate.findIndex(bio => bio.key === charId);
            // 2. 如果 ID 没匹配上，尝试通过 名字 匹配 (处理复活换ID但名字相同的情况)
            // FRX: a fallen character's biography stays theirs; a newcomer of the same plain
            // name (another 山贼) is someone else and gets a biography of their own.
            const fallenBiography = bio => {
              let row = null, stats = null;
              try { row = JSON.parse(bio.content || '{}'); } catch { return false; }
              try { stats = typeof row?.['11'] === 'string' ? JSON.parse(row['11']) : row?.['11']; } catch { stats = null; }
              const hp = stats?.['血量'];
              return Boolean(hp && Number(hp.max) > 0 && Number(hp.current) <= 0)
                || /重伤倒地|倒地不起|身亡|死亡|已死|毙命|气绝|殒命|伏诛|尸体|尸首|尸身|焦尸|遗体/.test(String(row?.['4'] || ''));
            };
            if (existingEntryIndex === -1) {
              existingEntryIndex = biographiesToUpdate.findIndex(
                bio => bio.title === charName && (bio.type === '人物' || !bio.type) && !fallenBiography(bio),
              );
            }
            if (existingEntryIndex !== -1) {
              const entry = biographiesToUpdate[existingEntryIndex];

              const isIdChanged = entry.key !== charId;
              const isRenamed = entry.title !== charName;
              const isContentChanged = entry.content !== characterSnapshotContent;
              if (isRenamed || isContentChanged || isIdChanged) {
                entry.content = characterSnapshotContent;

                // 关键修复：如果是同名不同ID，更新 key 为新 ID
                if (isIdChanged) {
                  console.log(
                    `[自动传记] 检测到同名角色 '${charName}' ID变更: ${entry.key} -> ${charId}，已合并档案。`,
                  );
                  entry.key = charId;
                }

                if (isRenamed) {
                  entry.title = charName;
                  entry.keywords = [charName];
                }

                changesMade = true;
              }
            } else {
              const newEntry = {
                id: crypto.randomUUID(),
                key: charId,
                title: charName,
                type: '人物',
                content: characterSnapshotContent,
                enabled: true,
                triggerMode: 'green',
                keywords: [charName],
                depth: knowledgeSearchGlobalConfig.worldBookSearchDepth || 5,
              };
              biographiesToUpdate.push(newEntry);
              changesMade = true;
            }
          }
          if (changesMade) {
            logEntry.biographySnapshot = biographiesToUpdate;
            console.log(`[世界档案-快照模式] 成功更新/创建了 ${updatedCharacterIds.size} 位人物的传记快照。`);
          } else {
            logEntry.biographySnapshot = previousBiographies;
          }
        }

// app.js 15367
        function getSingleCharacterSnapshot(characterId, fullState) {
          if (!characterId || !fullState || !fullState['0']) {
            return null;
          }

          const targetCharData = fullState['0'][characterId];

          if (!targetCharData) {
            return null;
          }

          return JSON.stringify(targetCharData, null, 2);
        }

// app.js 29144
        async function selectAndLoadArchive(archiveName) {
          if (isMainApiGenerating && currentArchiveName && currentArchiveName !== archiveName) {
            await showCustomAlert('当前回合尚在生成，请先停止或等待完成后切换存档。');
            return;
          }
          let archiveData;
          let loadedFromCloud = false;
          let finalArchiveName = archiveName;

          if (cloudStorageConfig.enabled && cloudStorageConfig.apiUrl) {
            try {
              const response = await fetch(
                `${cloudStorageConfig.apiUrl}/api/load?archiveName=${encodeURIComponent(archiveName)}`,
              );
              if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                  archiveData = result.data;
                  finalArchiveName = archiveData._internalName || archiveName;
                  loadedFromCloud = true;
                }
              }
              if (!loadedFromCloud) {
                console.log(`云端未找到存档 "${archiveName}"，将尝试从本地加载。`);
              }
            } catch (error) {
              console.warn(`连接云服务器失败，将尝试从本地加载。错误: ${error.message}`);
            }
          }

          if (!archiveData) {
            try {
              const recovery = await FRXRequest('/recover/' + encodeURIComponent(archiveName), 'POST');
              FRX.recoveryConflict = null;
              // FRX: a turn committed during load is archived once the save is shown.
              if (recovery?.recovered) FRX.archiveAfterLoad = archiveName;
            } catch (error) {
              if (!error.requestId) throw error;
              FRX.recoveryConflict = {archive:archiveName,requestId:error.requestId,message:error.message};
            }
            const localArchive = await db.archives.get(archiveName);
            if (!localArchive || !localArchive.data) {
              await showCustomAlert(`加载存档 "${archiveName}" 失败: 在云端和本地均未找到该存档。`);
              return;
            }
            archiveData = localArchive.data;
            finalArchiveName = archiveName;
            loadedFromCloud = false;
          }

          try {
            if (loadedFromCloud) await db.archives.put({ name: finalArchiveName, data: archiveData });
          } catch (error) {
            await showCustomAlert(`将存档数据写入本地时失败: ${error.message}`);
            return;
          }

          currentArchiveName = finalArchiveName;
          await dbSet(ACTIVE_ARCHIVE_KEY, currentArchiveName);

          // 【修复】加载或迁移 archiveId，解决向量数据归属为"未知存档"的问题
          if (archiveData.archiveId) {
            currentArchiveId = archiveData.archiveId;
          } else {
            // 旧存档迁移：生成新的 archiveId 并保存
            currentArchiveId = crypto.randomUUID();
            archiveData.archiveId = currentArchiveId;
            await db.archives.put({ name: finalArchiveName, data: archiveData });
            console.log(`[存档迁移] 为旧存档 "${finalArchiveName}" 生成了 archiveId: ${currentArchiveId}`);
          }

          const state = archiveData.state || {};
          activeTheaterHTML = state.activeTheaterHTML || null;

          await loadState(state, archiveData);
          if (FRX.archiveAfterLoad === finalArchiveName) {
            FRX.archiveAfterLoad = null;
            FRX.archiveCommitted(archiveData);
          }
        }

// app.js 29859
        async function loadState(state, fullArchiveData = null) {
          const deepCopy = obj => JSON.parse(JSON.stringify(obj));
          latestWorldEvolutionResponse = state.evolutionRuns?.at(-1)?.raw || '';

          WORLD_MAP_DATA = deepCopy(state.worldMap || DEFAULT_WORLD_MAP_DATA);

          currentState = state.currentState;
          bondedCharacters = state.bondedCharacters || {};

          syncStateFromTables();

          dailyPaperContextForNextMessage = '';
          lastDailyPaperContent = '';
          lastAiStoryText = '';
          lastUnoptimizedAiStoryText = '';

          if (fullArchiveData && Array.isArray(fullArchiveData.logs)) {
            let foundEmpty = false;
            let lastLogWithBio = [...fullArchiveData.logs].reverse().find(log => {
              if (log.biographySnapshot && Array.isArray(log.biographySnapshot)) {
                if (log.biographySnapshot.length > 0) {
                  return true;
                }
                foundEmpty = true;
              }
              return false;
            });
            if (!lastLogWithBio && foundEmpty) {
              lastLogWithBio = { biographySnapshot: [] };
            }

            if (lastLogWithBio) {
              allBiographyEntries = lastLogWithBio.biographySnapshot;
            } else {
              allBiographyEntries = fullArchiveData.state?.worldBookEntries || [];
            }
          }
        }

// app.js 29920
        async function _internalSaveCurrentState(frxScope = null) {
 frxScope ||= await FRX.captureScope();
 await FRX.assertScope(frxScope);
          if (!currentArchiveName) return;

          try {
            const archive = (await db.archives.get(frxScope?.archive || currentArchiveName)) || { name: currentArchiveName, data: {} };
            if (!archive.data.state) {
              archive.data.state = {};
            }

            archive.data.state.currentState = currentState;
            archive.data.state.bondedCharacters = bondedCharacters;
            archive.data.state.rpgMaps ||= {};
            archive.data.state.worldMap = WORLD_MAP_DATA;
            if (!archive.data.state.npcAvatars) archive.data.state.npcAvatars = {};

            await db.archives.put(archive, {scope: frxScope});

            // 自动同步到云端
            if (cloudStorageConfig && cloudStorageConfig.enabled && cloudStorageConfig.autoSync) {
              // 异步执行，不阻塞
              uploadArchiveToCloud(currentArchiveName, true).catch(err => {
                console.error('[自动同步] 失败:', err);
              });
            }
          } catch (e) {
            console.error('保存当前状态到数据库时出错: ', e);
            await showCustomAlert(`保存存档失败：${e.message}`);
            throw e;
          }
        }

// app.js 30682
        async function saveCurrentState(frxScope = null) {
          await _internalSaveCurrentState(frxScope);
        }

module.exports = {
  syncStateFromTables,
  saveToLog,
  parseSnapshotToRowObject,
  autoGenerateCharacterWorldBooks,
  getSingleCharacterSnapshot,
  selectAndLoadArchive,
  loadState,
  _internalSaveCurrentState,
  saveCurrentState,
};
