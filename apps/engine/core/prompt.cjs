/* A turn's prompt: the action queue, the geography, the fog of war, the history and summaries,
 * the state snapshot for the model and the biographies the turn mentions (sendMessageUnguarded's
 * steps, put together by assemble.cjs).
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 13013
        function addAction(type, data, context = {}, isSilent = false) {
          // 【修改点1：去重逻辑】针对灵兽进阶，同一ID只能保留最后一条指令，防止刷屏
          if (type === 'beast_evolve') {
            actionQueue = actionQueue.filter(a => !(a.type === 'beast_evolve' && a.data.beastId === data.beastId));
          }

          let actionText = '';
          const silentTag = isSilent ? ' (隐秘)' : '';
          switch (type) {
            case 'use': {
              const owned = inventoryItems.find(item => item.id === data.id);
              const existing = actionQueue.find(a => a.type === 'use' && a.data.id === data.id);
              const quantity = (existing?.quantity || 0) + 1;
              if (!owned || owned.type !== '消耗品' || !(quantity <= owned.quantity)) {
                showDanmaku('储物袋中可用数量不足', 'error');
                return;
              }
              actionText = `使用 ${owned.name.replace(/<[^>]*>/g, '')} ×${quantity}（${owned.id}）${silentTag}`;
              if (existing) Object.assign(existing, { quantity, text: actionText });
              else actionQueue.push({ type, text: actionText, data: owned, quantity, isSilent });
              break;
            }
            case 'discard':
              actionText = `你从储物袋中丢弃了[${data.name}]${silentTag}`;
              actionQueue.push({ type: 'discard', text: actionText, data: data, isSilent });
              break;
            case 'equip':
              actionText = `装备 ${data.name}${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'unequip':
              actionText = `卸下 ${data.name}${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'toggle_bond':
              actionText = data.isBonded ? `已将 ${data.charName} 标记为羁绊人物` : `已取消与 ${data.charName} 的羁绊`;
              actionText += silentTag;
              actionQueue.push({ type: 'toggle_bond', text: actionText, data: data, isSilent });
              break;
            case 'travel':
              actionText = `玩家 前往 ${data.location}，相距${data.distance}公里${silentTag}`;
              actionQueue = actionQueue.filter(a => a.type !== 'travel');
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'communicate':
              actionText = `对${context.charName}说：“${data}”${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'gift':
              actionText = `将[${data.name}]赠送给${context.charName}${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'spar':
              actionText = `向${context.charName}发起切磋请求${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'accompany':
              actionText = `邀请${context.charName}与你同行${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'cultivate':
              actionText = `邀请${context.charName}进行双修${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'publish_sect_task':
              actionText = `${data.fullText}${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            case 'submit_sect_task':
              actionText = `${data.fullText}${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;

            case 'accept_task':
              // 优先使用 fullText (携带详情)，否则回退到简单文本
              if (data.fullText) {
                actionText = data.fullText + silentTag;
              } else {
                actionText = `我决定接取宗门任务：“${data.title}”${silentTag}`;
              }
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;

            case 'abandon_task':
              actionText = `我决定放弃宗门任务：“${data.title}”${silentTag}`;
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              break;
            // 【修改点2：灵兽进阶指令增强】包含完整面板数据和清晰的突破描述
            case 'beast_evolve':
              const beastStats = `[当前面板] 等级:${data.level}, 血量:${data.hp}, 法力:${data.mp}, 好感:${data.favor}, 性格:${data.personality}`;
              actionText = `(系统通知) 灵兽[${data.beastName}](ID:${data.beastId}) 发生血脉返祖！\n${beastStats}\n【资质突破】: 从 [${data.oldTier}] ➔ 晋升为 [${data.newTier}]！\n请在剧情中详细描述其外观发生的奇异蜕变、散发的威压变化以及觉醒的新特征。`;
              // isSilent: true 确保它是隐式的
              actionQueue.push({ type, text: actionText, data: data, context: context, isSilent: true });
              break;
            default:
              if (actionText !== '') {
                actionQueue.push({ type, text: actionText, data: data, context: context, isSilent });
              }
          }

        }

// app.js 13412
        function getLogsForContext(allLogs, archive) {
          // FRX: an action followed directly by another action never got a reply (a failed send).
          // It is not part of the story, so later prompts leave it out.
          const turns = allLogs.filter(log => log.type === 'user' || log.type === 'ai');
          const unanswered = new Set(turns.filter((log, i) => log.type === 'user' && turns[i + 1]?.type === 'user').map(log => log.id));
          allLogs = allLogs.filter(log => !unanswered.has(log.id));
          const openingLog = allLogs.find(log => log.content.includes('<h4>天道初启</h4>'));

          const finalLogsForPrompt = [];
          // 【修改】收集所有过往记忆内容，最后统一包裹
          const pastMemoriesContent = [];

          if (openingLog && !openingLog.isGhost) {
            const cleanOpening = openingLog.content.replace(/<[^>]+>/g, '').trim();
            finalLogsForPrompt.push({
              type: 'system',
              content: `[世界背景设定]:\n${cleanOpening}`,
            });
          }

          const validLogs = allLogs
            .filter(log => !log.isSnapshot && !log.isUndoSnapshot && (!openingLog || log.id !== openingLog.id))
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

          // 预计算分段记忆配置
          const segmentedEnabled = summaryConfig.segmentedMemoryEnabled;
          const chatLayers = segmentedEnabled ? (parseInt(summaryConfig.segmentedChatLayers, 10) || 20) : 0;
          const largeSummaryStart = segmentedEnabled ? (parseInt(summaryConfig.segmentedLargeSummaryStart, 10) || 50) : 0;

          validLogs.forEach((log, index) => {
            // 计算当前日志的倒序索引（从最新开始计数）
            const reverseIndex = validLogs.length - 1 - index;

            if (log.isDeepSummary === true) {
              // 深度总结日志：直接发送摘要
              const summaryText = `[历史记忆档案 (Time: ${new Date(log.timestamp).toLocaleString()})]:\n<overview>${
                log.largeSummary
              }</overview>\n<details>${log.smallSummary}</details>`;

              finalLogsForPrompt.push({
                type: 'system',
                content: summaryText,
              });
            } else if (segmentedEnabled) {
              // === 分段记忆启用时的处理逻辑 ===
              
              if (reverseIndex < chatLayers) {
                // 最新的 X 层：发送完整聊天记录（包括玩家输入和 AI 回复）
                let clean = log.content;
                if (log.type === 'ai') {
                  clean = clean
                    .replace(/<image>[\s\S]*?<\/image>/g, '')
                    .replace(/image###[\s\S]*?###/g, '')
                    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
                } else if (log.type === 'user') {
                  clean = clean.replace(/^> /, '');
                }
                clean = clean.replace(/<[^>]+>/g, '').trim();
                if (clean) {
                  finalLogsForPrompt.push({ type: log.type, content: clean });
                }
              } else {
                // 超过 chatLayers 的层：只发送 AI 回复的总结，跳过玩家输入
                if (log.type === 'ai') {
                  // 判断使用小总结还是大总结
                  const useLargeSummary = reverseIndex >= largeSummaryStart && log.largeSummary;
                  const contentToUse = useLargeSummary ? log.largeSummary : (log.smallSummary || log.largeSummary);

                  if (contentToUse) {
                    // 【修改】收集过往记忆内容，不再单独添加
                    pastMemoriesContent.push(contentToUse);
                  }
                  // 如果 AI 回复没有总结，则不发送任何内容（跳过）
                  // 这避免了发送完整的旧 AI 回复内容
                }
                // 玩家输入（type: 'user'）在此处被完全跳过
                // 因为 AI 的总结已经包含了对话的关键信息
              }
            } else {
              // === 分段记忆未启用时的处理逻辑（保持原有行为）===
              let cleanContent = log.content;
              if (log.type === 'ai') {
                cleanContent = log.content
                  .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
                  .replace(/<image>[\s\S]*?<\/image>/g, '')
                  .replace(/image###[\s\S]*?###/g, '')
                  .replace(/<[^>]+>/g, '')
                  .trim();
              } else if (log.type === 'user') {
                cleanContent = log.content.replace(/^> /, '').trim();
              }

              if (cleanContent) {
                finalLogsForPrompt.push({
                  type: log.type || 'system',
                  content: cleanContent,
                });
              }
            }
          });

          // 【修改】如果有过往记忆，用 <过往记忆> 标签统一包裹后添加
          if (pastMemoriesContent.length > 0) {
            // 将所有过往记忆用换行分隔，首尾用标签包裹
            const wrappedMemories = `<过往记忆>\n${pastMemoriesContent.join('\n\n')}\n</过往记忆>`;
            // 插入到 finalLogsForPrompt 的适当位置（在世界背景之后、最新聊天记录之前）
            // 找到第一个非 system 类型的日志位置
            let insertIndex = finalLogsForPrompt.findIndex(l => l.type !== 'system');
            if (insertIndex === -1) insertIndex = finalLogsForPrompt.length;
            
            finalLogsForPrompt.splice(insertIndex, 0, {
              type: 'system',
              content: wrappedMemories,
            });
          }

          return {
            openingLog,
            summaryLogs: [],
            hiddenChatLogs: [],
            visibleChatLogs: validLogs.filter(l => !l.isDeepSummary),
            logsForPrompt: finalLogsForPrompt,
          };
        }

// app.js 26030
        async function getWorldBookContext(userInput, allLogs, snapshotContentForPrompt) {
          if (!currentArchiveName) return '';

          const archive = await db.archives.get(currentArchiveName);
          if (!archive) return '';

          let entries = [];

          const lastLogWithBio = [...(archive?.data?.logs || [])].reverse().find(log => log.biographySnapshot);
          if (lastLogWithBio) {
            entries = lastLogWithBio.biographySnapshot;
          }

          if (entries.length === 0) {
            return '';
          }

          let contextString = '';
          const addedEntries = new Set();
          const userLogs = allLogs.filter(log => log.type === 'user');
          const aiLogs = allLogs.filter(log => log.type === 'ai');

          // 获取当前场景中所有NPC的名字集合
          const currentNpcNames = new Set(
            Object.values(currentState['0'] || {})
              .filter(char => char['0'] !== 'B1' && char['1'])
              .map(char => char['1'].split('|')[0]),
          );

          // 获取玩家名字用于匹配
          const playerRow = currentState && currentState['0'] ? currentState['0']['B1'] : null;
          const playerName = playerRow ? (playerRow['1'] || '').split('|')[0] : '';

          entries.forEach(entry => {
            if (!entry || !entry.title || !entry.content || addedEntries.has(entry.id)) return;

            // 如果快照中已经包含了该人物的详细信息，且没有特殊状态，通常跳过
            let existingSnapshotContent = snapshotContentForPrompt || '';
            const isAlreadyInSnapshot = existingSnapshotContent.includes(`- 名称/性别: ${entry.title}`);

            const depth = entry.depth || 0;
            let logsToSearch = [...userLogs];

            if (depth === 0) {
              logsToSearch.push(...aiLogs);
            } else {
              logsToSearch.push(...aiLogs.slice(-depth));
            }

            const combinedTextForSearch =
              logsToSearch.map(log => log.content.replace(/<[^>]*>/g, '')).join('\n') + `\n${userInput || ''}`;

            let isTriggered = false;
            let triggerReason = '';

            // 1. 蓝灯模式：时刻触发
            if (entry.triggerMode === 'blue') {
              isTriggered = true;
              triggerReason = '蓝灯模式(时刻触发)';
            }
            // 2. 绿灯模式：关键词触发
            else if (entry.triggerMode === 'green' && entry.keywords && entry.keywords.length > 0) {
              const foundKeyword = entry.keywords.find(kw => combinedTextForSearch.includes(kw));
              if (foundKeyword) {
                isTriggered = true;
                triggerReason = `绿灯模式(关键词: "${foundKeyword}")`;
              }
            }

            // 3. 【新增逻辑】检测“正在寻找玩家”的特殊状态
            // 只有当条目未被触发，且该NPC不在当前场景时才进行检测
            if (!isTriggered && !currentNpcNames.has(entry.title) && (entry.type === '人物' || !entry.type)) {
              try {
                const parsedContent = JSON.parse(entry.content);
                const status = parsedContent['28'] || '';
                // 简单的关键词匹配
                if (
                  status &&
                  (status.includes('正在前往') || status.includes('正在赶往') || status.includes('正在寻找'))
                ) {
                  // 匹配是否指向玩家
                  if (
                    status.includes(playerName) ||
                    status.includes('你') ||
                    status.includes('我') ||
                    status.includes('玩家') ||
                    status.includes('B1')
                  ) {
                    isTriggered = true;
                    triggerReason = '【自动追踪】NPC正在赶来，始终发送直到相遇';
                    // 即使在快照里（极少情况），这种状态也值得再次强调
                  }
                }
              } catch (e) {}
            }

            if (isTriggered) {
              // 如果是绿灯关键词触发，且NPC人已经在现场了，通常不需要再发世界书（因为快照里有实时的）
              if (triggerReason.startsWith('绿灯') && currentNpcNames.has(entry.title)) {
                return;
              }

              // 如果是因为“正在寻找”触发，但人已经在现场了（逻辑上不应发生，因为上面已判断 !has），双重保险
              if (triggerReason.startsWith('【自动追踪】') && currentNpcNames.has(entry.title)) {
                return;
              }

              contextString += `\n\n### 世界书: ${entry.title}\n${entry.content}`;
              addedEntries.add(entry.id);
            }
          });

          if (contextString) {
            return `### 世界书参考资料 ###${contextString}\n\n`;
          }

          return '';
        }

// app.js 26149
        function generateGeographyString() {
          // 使用全局变量获取地图发送策略设置
          const strategy = currentMapSendStrategy || 'moderate';
          
          const getBoundingBox = points => {
            if (!points || points.length === 0) return '未知';
            let minX = Infinity,
              maxX = -Infinity,
              minY = Infinity,
              maxY = -Infinity;
            points.forEach(([x, y]) => {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            });
            return `X[${minX}, ${maxX}], Y[${minY}, ${maxY}]`;
          };

          // 获取玩家当前坐标
          const getPlayerCoords = () => {
            if (currentPlayerData && currentPlayerData.fullLocationString) {
              const coordMatch = currentPlayerData.fullLocationString.match(/(-?\d+),(-?\d+)/);
              if (coordMatch) {
                return { x: parseInt(coordMatch[1], 10), y: parseInt(coordMatch[2], 10) };
              }
            }
            return null;
          };

          // 计算两点之间的距离（公里，比例尺 1:10km）
          const calcDistance = (x1, y1, x2, y2) => {
            return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2)) * 10;
          };

          // 获取玩家当前所在的主疆域和下辖区域
          const getCurrentRegions = () => {
            if (!currentPlayerData || !currentPlayerData.fullLocationString) return { mainRegion: null, subRegion: null };
            const fullStr = currentPlayerData.fullLocationString.split('|')[0]; // 去除视觉部分
const parts = fullStr.split('/');
const cleanName = (str) => {
if (!str) return null;
let name = str.split(/\s+-?\d/)[0].trim();
name = name.split('（')[0].split('(')[0];
return name.trim();
};

const mainRegionName = parts.length > 1 ? cleanName(parts[1]) : null;
const subRegionName = parts.length > 2 ? cleanName(parts[2]) : null;
            return {
              mainRegion: WORLD_MAP_DATA.main_regions?.find(r => r.name === mainRegionName),
              subRegion: WORLD_MAP_DATA.sub_regions?.find(r => r.name === subRegionName),
              mainRegionName,
              subRegionName
            };
          };

          const data = WORLD_MAP_DATA;
          const playerCoords = getPlayerCoords();
          const currentRegions = getCurrentRegions();
          
          let geoString = '### 【世界地理信息：比例尺1:10km';
          
          // 根据策略添加不同的说明
          if (strategy === 'minimal') {
            geoString += '（极省模式：仅显示附近1000公里内地点）';
          } else if (strategy === 'moderate') {
            geoString += '（较省模式：当前疆域详细信息）';
          } else {
            geoString += '（完整模式）';
          }
          geoString += '】\n';

          // 添加玩家当前位置信息
          if (playerCoords) {
            geoString += `当前坐标: (${playerCoords.x}, ${playerCoords.y})`;
            if (currentRegions.mainRegionName) {
              geoString += ` | 所在区域: ${currentRegions.mainRegionName}`;
              if (currentRegions.subRegionName) {
                geoString += `/${currentRegions.subRegionName}`;
              }
            }
            geoString += '\n\n';
          }

          if (strategy === 'minimal') {
            // 极省模式：只发送1000公里内的兴趣点和当前所在区域
            if (currentRegions.mainRegion) {
              geoString += `【当前主疆域】${currentRegions.mainRegion.name}\n`;
              if (currentRegions.subRegion) {
                geoString += `【当前下辖区域】${currentRegions.subRegion.name}\n`;
              }
              geoString += '\n';
            }

            if (playerCoords) {
              const nearbyPois = (data.points_of_interest || []).filter(poi => {
                const dist = calcDistance(playerCoords.x, playerCoords.y, poi.x, poi.y);
                return dist <= 1000; // 1000公里内
              });

              if (nearbyPois.length > 0) {
                geoString += '【附近兴趣点（1000公里内）】\n';
                nearbyPois.sort((a, b) => {
                  const distA = calcDistance(playerCoords.x, playerCoords.y, a.x, a.y);
                  const distB = calcDistance(playerCoords.x, playerCoords.y, b.x, b.y);
                  return distA - distB;
                }).forEach(poi => {
                  const dist = Math.round(calcDistance(playerCoords.x, playerCoords.y, poi.x, poi.y));
                  geoString += ` - ${poi.name} (${poi.x},${poi.y}) \n`;
                });
              } else {
                geoString += '【附近无兴趣点】\n';
              }
            }
          } else if (strategy === 'moderate') {
            // 较省模式：只发送当前主疆域、下辖区域及其兴趣点
            if (currentRegions.mainRegion) {
              const main = currentRegions.mainRegion;
              geoString += `【当前主疆域】${main.name} (坐标范围: ${getBoundingBox(main.points)})\n`;

              const subRegions = (data.sub_regions || []).filter(sub => sub.main_region === main.name);
              if (subRegions.length > 0) {
                geoString += '下辖区域:\n';
                subRegions.forEach(sub => {
                  const isCurrent = sub.name === currentRegions.subRegionName;
                  geoString += ` ${isCurrent ? '★' : '-'} ${sub.name} (坐标范围: ${getBoundingBox(sub.points)})${isCurrent ? ' [当前所在]' : ''}\n`;
                });
              }

              const pois = (data.points_of_interest || []).filter(poi => poi.main_region === main.name);
              if (pois.length > 0) {
                geoString += '兴趣点:\n';
                pois.forEach(poi => {
                  let distInfo = '';
                  if (playerCoords) {
                    const dist = Math.round(calcDistance(playerCoords.x, playerCoords.y, poi.x, poi.y));
                  }
                  geoString += ` - ${poi.name} (${poi.x},${poi.y})${distInfo}\n`;
                });
              }
              geoString += '\n';

              // 显示其他主疆域名称（不含详细信息）
              const otherMainRegions = (data.main_regions || []).filter(r => r.name !== main.name);
              if (otherMainRegions.length > 0) {
                geoString += '【其他主疆域】' + otherMainRegions.map(r => r.name).join('、') + '\n';
              }
            } else {
              // 如果无法确定当前位置，回退到完整模式
              geoString += '（无法确定当前位置，显示完整地图）\n\n';
              return generateFullGeographyString(data, getBoundingBox);
            }
          } else {
            // 完整模式：发送所有地图数据
            (data.main_regions || []).forEach(main => {
              const isCurrent = main.name === currentRegions.mainRegionName;
              geoString += `${isCurrent ? '★ ' : ''}主疆域: ${main.name} (坐标范围: ${getBoundingBox(main.points)})${isCurrent ? ' [当前所在]' : ''}\n`;

              const subRegions = (data.sub_regions || []).filter(sub => sub.main_region === main.name);
              if (subRegions.length > 0) {
                geoString += '下辖区域:\n';
                subRegions.forEach(sub => {
                  const isCurrentSub = sub.name === currentRegions.subRegionName;
                  geoString += ` ${isCurrentSub ? '★' : '-'} ${sub.name} (坐标范围: ${getBoundingBox(sub.points)})${isCurrentSub ? ' [当前所在]' : ''}\n`;
                });
              }

              const pois = (data.points_of_interest || []).filter(poi => poi.main_region === main.name);
              if (pois.length > 0) {
                geoString += '兴趣点:\n';
                pois.forEach(poi => {
                  geoString += ` - ${poi.name} (坐标: ${poi.x},${poi.y})\n`;
                });
              }
              geoString += '\n';
            });
          }

          return geoString;
        }

// app.js 26332
        function generateFullGeographyString(data, getBoundingBox) {
          let geoString = '### 【世界地理信息：比例尺1:10km】\n';
          (data.main_regions || []).forEach(main => {
            geoString += `主疆域: ${main.name} (坐标范围: ${getBoundingBox(main.points)})\n`;

            const subRegions = (data.sub_regions || []).filter(sub => sub.main_region === main.name);
            if (subRegions.length > 0) {
              geoString += '下辖区域:\n';
              subRegions.forEach(sub => {
                geoString += ` - ${sub.name} (坐标范围: ${getBoundingBox(sub.points)})\n`;
              });
            }

            const pois = (data.points_of_interest || []).filter(poi => poi.main_region === main.name);
            if (pois.length > 0) {
              geoString += '兴趣点:\n';
              pois.forEach(poi => {
                geoString += ` - ${poi.name} (坐标: ${poi.x},${poi.y})\n`;
              });
            }
            geoString += '\n';
          });
          return geoString;
        }

// app.js 27411
        function generatePrettySnapshotForAI() {
// 1. 强制同步内存状态
syncStateFromTables();

let snapshotString = '';

// --- 辅助函数：动态提取未处理字段 ---
// 自动扫描对象中除了已知字段外的所有其他字段，并格式化为 [Key: Value]
const getExtraFields = (obj, excludeKeys) => {
let extras = [];
if (!obj || typeof obj !== 'object') return '';
for (const [key, value] of Object.entries(obj)) {
if (!excludeKeys.includes(key) && value !== undefined && value !== null && value !== '') {
let valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
// 简单清理换行符，避免破坏单行格式
valStr = valStr.replace(/[\r\n]+/g, ' ');
extras.push(`${key}:${valStr}`);
}
}
return extras.length > 0 ? ` [${extras.join(', ')}]` : '';
};

// --- 时间地点 ---
const timeRow = currentState['4'] && currentState['4'][0] ? currentState['4'][0] : null;
if (timeRow && timeRow['0']) {
snapshotString += `> 时间地点: ${timeRow['0']}\n`;
}

snapshotString += `> 格式说明: 以下数据采用TOON格式: 空格分隔键值, 换行分隔对象, 缩进表示层级。\n`;
snapshotString += `> 注意: [属性]栏显示的是角色的基础面板数值(不含临时Buff加成)。\n`;

// --- 1. 人物 (玩家 & NPC) ---
const chars = Object.values(currentState['0'] || {});
if (chars.length > 0) {
chars.forEach(charRow => {
const charId = charRow['0'];
if (!charId) return;

// --- 基础信息解析 ---
const nameGender = (charRow['1'] || '|').split('|');
const name = nameGender[0] || '未知';
const gender = nameGender[1] || '未知';

const realmIdentity = (charRow['2'] || '|').split('|');
const realm = realmIdentity[0] || '凡人';
const identity = realmIdentity[1] || '无';

// --- 备注解析 (Column 9) ---
let remarks = {};
try {
remarks = parseRemarksString(charRow['9']);
} catch (e) {}

const progress = remarks['修为进度'] || '0%';

// --- 原始属性解析 (Column 11) ---
let rawStats = {};
try {
if (typeof charRow['11'] === 'string') {
rawStats = JSON.parse(charRow['11']);
if (typeof rawStats === 'string') rawStats = JSON.parse(rawStats);
} else {
rawStats = charRow['11'] || {};
}
} catch (e) { rawStats = {}; }

// 获取当前血量/蓝量/神识
let hpCurrent = 0, hpMax = 100;
let mpCurrent = 0, mpMax = 100;
let shenshiCurrent = 0, shenshiMax = 10;

if (rawStats['血量']) {
hpCurrent = rawStats['血量'].current;
hpMax = rawStats['血量'].max;
} else if (remarks.hp) {
const parts = remarks.hp.split('/');
hpCurrent = parts[0];
hpMax = parts[1];
}

if (rawStats['法力']) {
mpCurrent = rawStats['法力'].current;
mpMax = rawStats['法力'].max;
}

if (rawStats['神识']) {
shenshiCurrent = rawStats['神识'].current;
shenshiMax = rawStats['神识'].max;
}

// --- 构建输出 ---
snapshotString += `> 人物: [${charId === 'B1' ? '你' : 'NPC'}] ${name} | ${gender} | ${realm} | ${progress} | ${identity}\n`;
snapshotString += `> 状态: HP:${hpCurrent}/${hpMax}, MP:${mpCurrent}/${mpMax}, 神识:${shenshiCurrent}/${shenshiMax}\n`;

// --- 档案信息 ---
const age = remarks['年龄'] || '未知';
const shouyuan = remarks['寿元'] || '未知';
const linggen = charRow['5'] && charRow['5'] !== '待定' ? charRow['5'] : (remarks['灵根'] || '无');
const constitution = charRow['6'] && charRow['6'] !== '待定' ? charRow['6'] : '无';
const spiritStones = charRow['26'] && charRow['26'] !== '待定' ? charRow['26'] : (remarks['spiritStones'] || '0');
const shanE = remarks['善恶值'] || '0';

let archiveLine = `> 档案: 年龄:${age}, 寿元:${shouyuan}, 灵根:${linggen}, 体质:${constitution}, 灵石:${spiritStones}, 善恶:${shanE}`;

// --- 处理自定义变量 ---
let displaySettings = charId === 'B1' ? playerDisplaySettings : npcDisplaySettings;

if (displaySettings && Array.isArray(displaySettings.customFields)) {
let customVars = [];
displaySettings.customFields.forEach(field => {
if (field.isEnabled && field.variableName) {
let val = undefined;
if (remarks.hasOwnProperty(field.variableName)) {
val = remarks[field.variableName];
} else if (field.column !== undefined && field.column !== 9) {
val = charRow[field.column];
}
if (val !== undefined && val !== null && val !== '') {
customVars.push(`${field.label}:${val}`);
}
}
});
if (customVars.length > 0) {
archiveLine += `, ${customVars.join(', ')}`;
}
}
snapshotString += archiveLine + '\n';

// --- Buff ---
const buffStr = charRow['4'] || '一切正常';
if (buffStr !== '一切正常' && buffStr !== '无') {
snapshotString += `> BUFF: ${buffStr}\n`;
}

// --- 属性 (原始值) ---
const propLabels = ['物攻', '物防', '脚力', '法攻', '法防', '物理穿透', '法术穿透', '气运', '魅力'];
const propsLine = '> 属性: ' + propLabels.map(label => {
const val = rawStats[label] ? rawStats[label].current : 0;
return `${label}:${val}`;
}).join(', ') + '\n';
snapshotString += propsLine;

// --- 技能 ---
let skillList = [];
if (charId === 'B1') {
const playerSkills = Object.values(currentState['8'] || {});
playerSkills.forEach(s => {
if (s && s['1']) {
const name = s['1'];
const level = s['2'] || '未知';
const desc = s['4'] || '';
const effect = s['6'] || s['9'] || ''; // 优先取已解锁效果，没有则取全部效果

// 提取额外字段 (排除已知字段)
const extra = getExtraFields(s, ['0','1','2','3','4','5','6','7','8','9']);

let skillStr = `${name}(${level})`;
if (desc) skillStr += ` 描述:${desc}`;
if (effect) skillStr += ` 效果:${effect}`;
skillStr += extra;

skillList.push(skillStr);
}
});
} else {
if (remarks['skills']) {
try {
let npcSkills = remarks['skills'];
if (typeof npcSkills === 'string') npcSkills = JSON.parse(npcSkills);
if (Array.isArray(npcSkills)) {
npcSkills.forEach(s => {
const sName = s.name || s['1'];
const sLevel = s.level || s['2'] || '未知';
const sDesc = s.desc || s.description || s['4'] || '';
const sEffect = s.effect || s.currentEffect || s['6'] || s['9'] || '';

if (sName) {
// 提取额外字段
const extra = getExtraFields(s, ['id','name','level','grade','desc','description','effect','effects','currentEffect','realmEffects','0','1','2','3','4','5','6','7','8','9']);

let skillStr = `${sName}(${sLevel})`;
if (sDesc) skillStr += ` 描述:${sDesc}`;
if (sEffect) skillStr += ` 效果:${sEffect}`;
skillStr += extra;

skillList.push(skillStr);
}
});
}
} catch (e) {}
}
}
if (skillList.length > 0) {
snapshotString += `> 技能: ${skillList.join(' | ')}\n`;
}

// --- 装备 ---
if (remarks['equipment']) {
try {
let equipObj = remarks['equipment'];
if (typeof equipObj === 'string') equipObj = JSON.parse(equipObj);

const equipList = [];
['weapon', 'armor', 'technique', 'treasure'].forEach(slot => {
if (equipObj[slot] && Array.isArray(equipObj[slot])) {
equipObj[slot].forEach(item => {
if (item && item.name) {
let itemStr = item.name;
if (item.grade) itemStr += `(${item.grade})`;

// 装备效果
let effectContent = item.effect || item.currentEffect || '';
if (effectContent && effectContent !== '无') {
let effectShort = effectContent;
if(effectShort.length > 30) effectShort = effectShort.substring(0, 30) + '...';
itemStr += ` [${effectShort}]`;
}

// 提取额外字段
const extra = getExtraFields(item, ['id','name','type','description','desc','effect','currentEffect','grade','quantity','maxRealm','realmEffects','0','1','2','3','4','5','6','7','8','9']);
equipList.push(itemStr + extra);
}
});
}
});
if (equipList.length > 0) {
snapshotString += `> 装备: ${equipList.join(', ')}\n`;
}
} catch (e) {}
}

// --- NPC 储物袋 ---
if (charId !== 'B1' && remarks['inventory']) {
try {
let npcInventory = remarks['inventory'];
if (typeof npcInventory === 'string') npcInventory = JSON.parse(npcInventory);

if (Array.isArray(npcInventory) && npcInventory.length > 0) {
const invList = npcInventory.map(item => {
const iName = item.name || item['1'] || '未知物品';
const iQty = item.quantity || item['5'] || '1';
const iDesc = item.description || item.desc || item['3'] || '';
const iEffect = item.effect || item['4'] || '';

// 提取额外字段
const extra = getExtraFields(item, ['id','name','type','description','desc','effect','quantity','grade','0','1','2','3','4','5','6','7','8','9']);

let str = `${iName} x${iQty}`;
if (iDesc) str += ` [${iDesc}]`;
if (iEffect && iEffect !== '无') str += ` 效果:${iEffect}`;
str += extra;
return str;
});
snapshotString += `> 储物袋: ${invList.join(' | ')}\n`;
}
} catch (e) {}
}

// --- 气运 (修复：全面兼容 effect/effects/bonus 及其他字段) ---
if (remarks['traits']) {
try {
let traits = remarks['traits'];
if (typeof traits === 'string') {
try { traits = JSON.parse(traits); } catch(e) {}
}

if (Array.isArray(traits) && traits.length > 0) {
const traitList = traits.map(t => {
let bonusStr = '';
// 1. 处理 bonus 对象
let bonusObj = t.bonus || t.attributes;
if (typeof bonusObj === 'string') {
try { bonusObj = JSON.parse(bonusObj); } catch(e) {}
}

if (bonusObj && typeof bonusObj === 'object') {
const bonuses = [];
for (const [k, v] of Object.entries(bonusObj)) {
const val = parseInt(v);
if (!isNaN(val) && val !== 0) {
bonuses.push(`${k}${val > 0 ? '+' : ''}${val}`);
}
}
if (bonuses.length > 0) bonusStr = ` (${bonuses.join(', ')})`;
}

// 2. 处理 effect/effects 字符串
let effectContent = t.effect || t.effects || '';
if (effectContent === '无') effectContent = '';

const effectStr = effectContent ? ` [特效: ${effectContent}]` : '';

// 3. 处理其他未识别字段
const extra = getExtraFields(t, ['id','name','desc','rarity','effect','effects','bonus','attributes']);

return `[${t.rarity||'未知'}] ${t.name}: ${t.desc||''}${effectStr}${bonusStr}${extra}`;
}).join(' | ');
snapshotString += `> 气运: ${traitList}\n`;
}
} catch(e) {
console.warn('气运解析失败:', e);
}
}

// --- 背景与关系 ---
const background = charRow['10'] && charRow['10'] !== '待定' ? charRow['10'] : '';
const relations = charRow['13'] || '';
if (background || relations) {
let settingStr = '';
if (background) settingStr += `背景:${background} `;
if (relations) settingStr += `关系:${relations}`;
snapshotString += `> 设定: ${settingStr}\n`;
}

// --- 生平事迹 ---
const deeds = remarks['deeds'] || charRow['35'] || '';
if (deeds) {
snapshotString += `> 经历: ${deeds}\n`;
}

// --- NPC 秘闻 ---
if (charId !== 'B1') {
if (charRow['12']) snapshotString += `> 动机: ${charRow['12']}\n`;
if (charRow['15']) snapshotString += `> 好感: ${charRow['15']}\n`;
if (charRow['16']) {
const visuals = charRow['16'].split('|');
if (visuals[1]) snapshotString += `> 穿着: ${visuals[1]}\n`;
if (visuals[4]) snapshotString += `> 样貌: ${visuals[4]}\n`;
}

// 目标/动机
const goals = [];
if (charRow['27']) goals.push(`当前动机:${charRow['27']}`);
if (charRow['28']) goals.push(`短期目标:${charRow['28']}`);
if (charRow['29']) goals.push(`长期目标:${charRow['29']}`);
if (goals.length > 0) {
snapshotString += `> 目标: ${goals.join(', ')}\n`;
}

// 秘闻列表
const secrets = [];
if (charRow['8']) secrets.push(`性经验:${charRow['8']}`);
if (charRow['17']) secrets.push(`表性癖:${charRow['17']}`);
if (charRow['18']) secrets.push(`里性癖:${charRow['18']}`);
if (charRow['20']) secrets.push(`敏感点:${charRow['20']}`);
if (charRow['21']) secrets.push(`性器:${charRow['21']}`);
if (charRow['22']) secrets.push(`情欲:${charRow['22']}`);
if (charRow['23']) secrets.push(`快感:${charRow['23']}`);
if (charRow['24']) secrets.push(`性观念:${charRow['24']}`);

if (secrets.length > 0) {
snapshotString += `> 秘闻: ${secrets.join(', ')}\n`;
}
}

snapshotString += '\n';
});
}

// --- 2. 物品 (玩家) ---
const items = Object.values(currentState['1'] || {});
if (items.length > 0) {
snapshotString += `> 物品[${items.length}]:\n`;
items.forEach(item => {
// 提取额外字段
const extra = getExtraFields(item, ['0','1','2','3','4','5','6','7','8','9','id','name','type','description','effect','quantity']);
snapshotString += `- ${item['1'] || '未知物品'} x${item['5'] || '1'} | ${item['3'] || '无描述'}${extra}\n`;
});
}

// --- 3. 灵兽 ---
const beasts = Object.values(currentState['7'] || {});
if (beasts.length > 0) {
snapshotString += `\n### 我的灵兽[${beasts.length}只]\n`;
beasts.forEach(beast => {
const name = beast['1'] || '未知灵兽';
const level = beast['2'] || '未知等级';
const aptitude = (beast['7'] || '').split('|')[0] || '凡品';
const desc = beast['3'] || '无描述';
const skill = beast['5'] || '无技能';
// 提取额外字段
const extra = getExtraFields(beast, ['0','1','2','3','4','5','6','7','8','9','10']);
snapshotString += `- [${name}] ${level} (${aptitude}) | ${desc} | 神通: ${skill}${extra}\n`;
});
}

// --- 4. 任务 ---
const tasks = Object.values(currentState['6'] || {});
if (tasks.length > 0) {
snapshotString += `\n### 当前任务[${tasks.length}个]\n`;
tasks.forEach(task => {
// 提取额外字段
const extra = getExtraFields(task, ['0','1','2','3','4','5','id','title','desc','description','reward','punishment','status']);
snapshotString += `- [${task['1'] || '未知任务'}](${task['5'] || '未知'}) ${task['2'] || ''}${extra}\n`;
});
}

// --- 5. 世界大事 (最近5条) ---
const worldEvents = Object.values(currentState['5'] || []);
if (worldEvents.length > 0) {
snapshotString += `\n### 世界大事记 (最近5条)\n`;
worldEvents.slice(-5).forEach(event => {
snapshotString += `- [${event['0']}] ${event['1']} ${event['2']}\n`;
});
}

return snapshotString.replace(/<[^>]+>/g, '').trim();
}

// app.js 37124
        async function getFogOfWarPrompt(targetNpcs = [], allyNpcs = []) {
          const baseRoll = Math.floor(Math.random() * 20) + 1;
          let finalResultPoint = baseRoll;
          let bossName = '';

          // --- 修正值计算变量 ---
          let powerCorrection = 0;
          let luckCorrection = 0;
          let charmCorrection = 0;

          const REALM_SUPPRESSION_BASE = (regexConfig.fogConfig && regexConfig.fogConfig.realmSuppressionBase) || 5;
          // 【新增】读取自定义的气运和魅力系数
          const LUCK_MULTIPLIER = (regexConfig.fogConfig && regexConfig.fogConfig.luckMultiplier) || 0.1;
          const CHARM_MULTIPLIER = (regexConfig.fogConfig && regexConfig.fogConfig.charmMultiplier) || 0.1;

          const playerAttrs = calculateTotalAttributes('B1');
          const myLuck = playerAttrs['气运'] ? playerAttrs['气运'].current : 0;
          const myCharm = playerAttrs['魅力'] ? playerAttrs['魅力'].current : 0;

          // 【逻辑修改】气运始终生效
          luckCorrection = Math.floor(myLuck * LUCK_MULTIPLIER);

          const isCombat = targetNpcs && targetNpcs.length > 0;

          // 【逻辑修改】魅力仅在非战斗时生效
          if (!isCombat) {
            charmCorrection = Math.floor(myCharm * CHARM_MULTIPLIER);
          }

          let msgParts = [];
          if (luckCorrection !== 0)
            msgParts.push(`<span style="color:#ffd700">气运${luckCorrection > 0 ? '+' : ''}${luckCorrection}</span>`);
          if (charmCorrection !== 0)
            msgParts.push(`<span style="color:#ff69b4">魅力${charmCorrection > 0 ? '+' : ''}${charmCorrection}</span>`);

          if (isCombat) {
            const multipliers =
              regexConfig.fogConfig && regexConfig.fogConfig.multipliers
                ? regexConfig.fogConfig.multipliers
                : {
                    hp: 0.1,
                    mp: 0.1,
                    atkPhy: 1.5,
                    atkMag: 1.5,
                    defPhy: 1.0,
                    defMag: 1.0,
                    shenshi: 2.0,
                    speed: 1.0,
                  };

            const getRealmTier = str => {
              const m = {
                凡人: 0,
                炼气: 1,
                筑基: 2,
                结丹: 3,
                金丹: 3,
                元婴: 4,
                化神: 5,
                炼虚: 6,
                合体: 7,
                大乘: 8,
                渡劫: 9,
              };
              for (let k in m) {
                if (str && str.includes(k)) return m[k];
              }
              return 0;
            };

            const getAttrVal = (attrs, key) => (attrs[key] ? attrs[key].max : 0);
            const calcCharPower = (charId, realmStr) => {
              const attrs = calculateTotalAttributes(charId);
              const rawPower =
                getAttrVal(attrs, '血量') * multipliers.hp +
                getAttrVal(attrs, '法力') * multipliers.mp +
                getAttrVal(attrs, '物攻') * multipliers.atkPhy +
                getAttrVal(attrs, '法攻') * multipliers.atkMag +
                getAttrVal(attrs, '物防') * multipliers.defPhy +
                getAttrVal(attrs, '法防') * multipliers.defMag +
                getAttrVal(attrs, '神识') * multipliers.shenshi +
                getAttrVal(attrs, '脚力') * multipliers.speed;
              const tier = getRealmTier(realmStr);
              return Math.max(1, rawPower) * Math.pow(REALM_SUPPRESSION_BASE, tier);
            };

            const calcBeastPower = beast => {
              const levelStr = beast['2'] || '一阶下品';
              const tierMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
              let tier = 1;
              for (let k in tierMap) {
                if (levelStr.includes(k)) tier = tierMap[k];
              }
              let subTierMult = 1;
              if (levelStr.includes('中')) subTierMult = 1.3;
              if (levelStr.includes('后') || levelStr.includes('上')) subTierMult = 1.6;
              if (levelStr.includes('圆满') || levelStr.includes('顶')) subTierMult = 2.0;
              const rawBeastPower = tier * 300 * subTierMult;
              return rawBeastPower * Math.pow(REALM_SUPPRESSION_BASE, tier);
            };

            const b1Realm =
              currentState['0'] && currentState['0']['B1'] ? currentState['0']['B1']['2'].split('|')[0] : '凡人';
            let myTotalPower = calcCharPower('B1', b1Realm);
            let allyCount = 0;
            allyNpcs.forEach(npc => {
              myTotalPower += calcCharPower(npc.id, npc.realm);
              allyCount++;
            });

            const myBeasts = Object.values(currentState['7'] || {});
            let beastCount = 0;
            myBeasts.forEach(beast => {
              myTotalPower += calcBeastPower(beast);
              beastCount++;
            });

            let enemyTotalPower = 0;
            let maxEnemyPower = -1;
            targetNpcs.forEach(npc => {
              const p = calcCharPower(npc.id, npc.realm);
              enemyTotalPower += p;
              if (p > maxEnemyPower) {
                maxEnemyPower = p;
                bossName = npc.name;
              }
            });

            if (enemyTotalPower === 0) enemyTotalPower = 1;
            const powerRatio = myTotalPower / enemyTotalPower;

            if (powerRatio >= 3.0) powerCorrection = 15;
            else if (powerRatio >= 2.0) powerCorrection = 10;
            else if (powerRatio >= 1.5) powerCorrection = 6;
            else if (powerRatio >= 1.2) powerCorrection = 3;
            else if (powerRatio <= 0.3) powerCorrection = -15;
            else if (powerRatio <= 0.5) powerCorrection = -10;
            else if (powerRatio <= 0.7) powerCorrection = -6;
            else if (powerRatio <= 0.9) powerCorrection = -3;

            if (powerCorrection !== 0) {
              const color = powerCorrection > 0 ? '#66bb6a' : '#ef5350';
              const sign = powerCorrection > 0 ? '+' : '';
              msgParts.unshift(`<span style="color:${color}">战力${sign}${powerCorrection}</span>`);
            }

            const enemyNameDisplay = targetNpcs.length > 1 ? `${bossName}等` : bossName;
            let mySideDisplay = '我方';
            if (allyCount > 0 || beastCount > 0) {
              const parts = ['1人'];
              if (allyCount > 0) parts.push(`${allyCount}友`);
              if (beastCount > 0) parts.push(`${beastCount}兽`);
              mySideDisplay = parts.join('+');
            }
            console.log(
              `[战力对比] Ratio: ${powerRatio.toFixed(2)} (Player:${Math.round(myTotalPower)} vs Enemy:${Math.round(
                enemyTotalPower,
              )})`,
            );
          }

          // 汇总所有修正
          let totalCorrection = powerCorrection + luckCorrection + charmCorrection;

          if (baseRoll >= 19) {
            finalResultPoint = totalCorrection < 0 ? baseRoll : Math.min(20, baseRoll + totalCorrection);
          } else {
            finalResultPoint = Math.max(1, Math.min(20, baseRoll + totalCorrection));
          }

          const totalSign = totalCorrection >= 0 ? '+' : '';

          const detailStr = msgParts.length > 0 ? `(${msgParts.join(', ')})` : '';

          let result, prompt, trigramSymbol, trigramName;
          const trigramMap = {
            1: { result: '大凶', symbol: '☷', name: '坤为地' },
            2: { result: '凶', symbol: '☶', name: '艮为山' },
            3: { result: '凶', symbol: '☵', name: '坎为水' },
            4: { result: '凶', symbol: '☴', name: '巽为风' },
            5: { result: '凶', symbol: '☳', name: '震为雷' },
            16: { result: '吉', symbol: '☱', name: '兑为泽' },
            17: { result: '吉', symbol: '☲', name: '离为火' },
            18: { result: '吉', symbol: '☳', name: '震为雷' },
            19: { result: '吉', symbol: '☴', name: '巽为风' },
            20: { result: '大吉', symbol: '☰', name: '乾为天' },
          };
          let mappingKey;
          if (finalResultPoint === 1) mappingKey = 1;
          else if (finalResultPoint <= 5) mappingKey = finalResultPoint;
          else if (finalResultPoint <= 15) {
            result = '中平';
            const midResultMap = {
              6: '☳',
              7: '☲',
              8: '☱',
              9: '☰',
              10: '☷',
              11: '☶',
              12: '☵',
              13: '☴',
              14: '☳',
              15: '☲',
            };
            trigramSymbol = midResultMap[finalResultPoint] || '☳';
            const entry = Object.values(trigramMap).find(t => t.symbol === trigramSymbol);
            trigramName = entry ? entry.name : '震为雷';
            let targetDesc = bossName;
            if (targetNpcs && targetNpcs.length > 1) targetDesc = `${bossName}等${targetNpcs.length}名敌人`;
            prompt = `【天机演算：中平 (战斗判定)】双方交手，${
              targetDesc ? `面对${targetDesc}，` : ''
            }局势胶着，互有攻守，暂无明显的胜负倾向，请客观描述战斗过程。`;
          } else if (finalResultPoint <= 19) mappingKey = finalResultPoint;
          else mappingKey = 20;

          if (mappingKey) {
            const data = trigramMap[mappingKey];
            result = data.result;
            trigramSymbol = data.symbol;
            trigramName = data.name;
            if (targetNpcs && targetNpcs.length > 0) {
              let targetDesc = bossName;
              let contextDesc = '敌人手段频出';
              if (targetNpcs.length > 1) {
                targetDesc = `${bossName}率领的${targetNpcs.length}人`;
                contextDesc = '面对多人的围攻';
              }
              const customPrompts = regexConfig.fogConfig?.combat || {};
              let template = '';
              if (result === '大凶') template = customPrompts.bigOminous;
              else if (result === '凶') template = customPrompts.ominous;
              else if (result === '吉') template = customPrompts.auspicious;
              else if (result === '大吉') template = customPrompts.bigAuspicious;
              if (template) {
                prompt = template.replace(/\${targetDesc}/g, targetDesc).replace(/\${contextDesc}/g, contextDesc);
              } else {
                prompt = `【天机演算：${result} (战斗判定)】`;
              }
            } else {
              const customPrompts = regexConfig.fogConfig?.nonCombat || {};
              if (result === '大凶') prompt = customPrompts.bigOminous;
              else if (result === '凶') prompt = customPrompts.ominous;
              else if (result === '吉') prompt = customPrompts.auspicious;
              else if (result === '大吉') prompt = customPrompts.bigAuspicious;
              else prompt = `【天机演算：${result}】`;
            }
          }

          const resultColors = { 大凶: '#000000', 凶: '#00e676', 中平: '#e0e0e0', 吉: '#ff5252', 大吉: '#ffd700' };
          let simpleText = result === '大吉' ? '吉' : result === '大凶' ? '凶' : result === '中平' ? '平' : result;

          let displayMessage = `
        <div style="text-align:center; padding: 5px; border: 1px dashed ${resultColors[result]}; background: rgba(0,0,0,0.2); border-radius: 4px; font-size: 0.9em; color: #ccc;">
            <i class="fas fa-yin-yang" style="color: #f0e6d2;"></i> 天机演算: <strong style="color:${resultColors[result]}; font-size: 1.1em;">${simpleText}</strong> (<span style="font-family: 'ZCOOL KuaiLe', cursive;">${trigramSymbol} ${trigramName}</span> | 点数: ${finalResultPoint})
        </div>
    `;
          if (totalCorrection !== 0) {
            const reasonStr = detailStr ? ` ${detailStr}` : '';
            displayMessage += `<div style="text-align:center; font-size:0.8em; color:#aaa; margin-top:2px;">(修正: ${totalSign}${totalCorrection}${reasonStr})</div>`;
          }
          return {
            prompt,
            displayMessage,
          };
        }

module.exports = {
  addAction,
  getLogsForContext,
  getWorldBookContext,
  generateGeographyString,
  generateFullGeographyString,
  generatePrettySnapshotForAI,
  getFogOfWarPrompt,
};
