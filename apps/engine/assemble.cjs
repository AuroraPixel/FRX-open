/* Builds a turn's request the way the old page builds it in sendMessageUnguarded: the same
 * fourteen steps in the same order, with the page's own functions (see host.cjs).
 *
 *   node apps/engine/assemble.cjs < input.json > output.json
 *
 * Input:  { archive, settings, preferences, action: {text | option, queue},
 *           recall: {text, context, variables} | null, session: 'continued' | 'fresh',
 *           seed, now, locale, timeZone, frx: {directorOnServer} }
 * Output: { user_input, snapshot, turn_action, variables, player_name, independent_variables,
 *           user_log, flush, writes, errors }
 *
 * `action.text` is what the player typed, `action.option` an option the player picked (the page
 * trims the one and not the other). `action.queue` is the page's action queue, one entry per
 * addAction call: {type, data, context, silent}. `recall` is recall.cjs's result for the same
 * input; a turn whose input needs no memory search may leave it out. `session` says what the
 * page remembered from the turn before: 'continued' (the default) is a page that played the last
 * turn, 'fresh' a page that has just loaded the save. `flush` is what the page saves of its state
 * when it sends the turn (the host's flush, _internalSaveCurrentState): the tables, the bonded
 * characters and the world map as the page holds them.
 */
'use strict';

const host = require('./host.cjs');

// The page's variables, with the values the page starts with.
const STATE = [
  'currentState', 'currentPlayerData', 'inventoryItems', 'surroundingCharacters', 'characterDatabase',
  'bondedCharacters', 'currentArchiveName', 'actionQueue', 'summaryConfig', 'regexConfig', 'thinkingApiConfig',
  'knowledgeSearchGlobalConfig', 'WORLD_MAP_DATA', 'currentMapSendStrategy', 'currentDefaultMapArchiveName',
  'playerDisplaySettings', 'npcDisplaySettings', 'dailyPaperContextForNextMessage', 'lastDailyPaperContent',
  'lastAiStoryText', 'lastUnoptimizedAiStoryText', 'latestWorldEvolutionResponse', 'allBiographyEntries',
  'aiNotificationQueue', 'latestThinkingContent', 'cachedVectorContext', 'currentArchiveId', 'activeTheaterHTML',
  'latestVectorInjectionLogs',
];

const CONSTANTS = [
  'PERMANENT_PROMPTS_KEY', 'PLACEMENT_MAP', 'TIME_LOCATION_ROW_ID', 'DEFAULT_WORLD_MAP_DATA', 'SUMMARY_CONFIG_KEY',
  'REGEX_CONFIG_KEY', 'DEFAULT_MAP_KEY', 'MAP_SEND_STRATEGY_KEY', 'ACTIVE_ARCHIVE_KEY',
  'DEFAULT_VARIABLE_THINKING_WORLDBOOK', 'NPC_DISPLAY_SETTINGS_KEY', 'PLAYER_DISPLAY_SETTINGS_KEY',
];

const FUNCTIONS = [
  'dbGet', 'dbSet', 'saveToLog',
  'syncStateFromTables', 'parseRemarksString', 'parseRemarkFields', 'parseNestedJsonString', 'storedItemIds',
  'itemStackCount', 'equippedItemRows',
  'loadNpcDisplaySettings', 'loadPlayerDisplaySettings', 'loadRegexConfig', 'loadSummaryConfig',
  'manageThinkingApiSettings', 'manageKnowledgeSearchApiSettings', 'loadDefaultMapSetting',
  'loadMapSendStrategySetting', 'loadState', 'extractMainContent',
  'addAction',
  'generateGeographyString', 'generateFullGeographyString', 'prepareVectorContext', 'getFogOfWarPrompt',
  'calculateTotalAttributes', 'getLogsForContext', 'generatePrettySnapshotForAI', 'getPlayerEquipmentString',
  'getWorldBookContext', 'processTextWithRules', 'parseRegexString',
];

// The page's messages to the player (addAction's refusal); the prompt shows none of them.
const STUBS = ['showDanmaku'];

// ---------------------------------------------------------------- glue, run in the page's scope

// initPanel's loaders for what the prompt reads, in initPanel's order.
async function frxBootPage() {
  await loadNpcDisplaySettings();
  await loadPlayerDisplaySettings();
  await loadRegexConfig();
  await loadSummaryConfig();
  await manageThinkingApiSettings();
  await manageKnowledgeSearchApiSettings();
  await loadDefaultMapSetting();
}

// selectAndLoadArchive and loadChatHistory, without drawing: what they leave in the page's
// variables. `session` 'continued' adds what playing the last turn left behind.
async function frxLoadArchive(archiveName, session) {
  const saved = await db.archives.get(archiveName);
  const archiveData = saved.data;
  currentArchiveName = archiveName;
  await dbSet(ACTIVE_ARCHIVE_KEY, currentArchiveName);
  if (archiveData.archiveId) {
    currentArchiveId = archiveData.archiveId;
  } else {
    currentArchiveId = crypto.randomUUID();
    archiveData.archiveId = currentArchiveId;
    await db.archives.put({ name: archiveName, data: archiveData });
  }
  const state = archiveData.state || {};
  activeTheaterHTML = state.activeTheaterHTML || null;
  await loadState(state, archiveData);
  const logs = archiveData.logs;
  if (!logs || logs.length === 0) {
    dailyPaperContextForNextMessage = '';
    lastDailyPaperContent = '';
  } else {
    let latestDailyPaper = null;
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].type === 'ai' && logs[i].dailyPaperHtml) {
        latestDailyPaper = logs[i].dailyPaperHtml;
        break;
      }
    }
    if (latestDailyPaper) {
      lastDailyPaperContent = latestDailyPaper;
      dailyPaperContextForNextMessage = extractMainContent(latestDailyPaper);
    } else {
      lastDailyPaperContent = '';
      dailyPaperContextForNextMessage = '';
    }
  }
  if (session === 'continued') {
    const lastAiLog = [...(logs || [])].reverse().find(log => log.type === 'ai');
    if (lastAiLog) {
      lastAiStoryText = lastAiLog.content || '';
      lastUnoptimizedAiStoryText = lastAiLog.unoptimizedContent || '';
    }
  }
}

// The action queue as addAction leaves it. A line that comes with its words is one the page put
// in its queue itself (a spirit beast's evolution, by its feeding) and stays as it was queued.
function frxQueueActions(queue) {
  for (const entry of queue || []) {
    if (typeof entry.text === 'string') {
      actionQueue.push({ type: entry.type, text: entry.text, data: entry.data || {}, context: entry.context || {}, isSilent: !!entry.silent });
    } else {
      addAction(entry.type, entry.data, entry.context || {}, !!entry.silent);
    }
  }
}

// The player's text as sendMessageUnguarded reads it: a chosen option as it is, typed text
// trimmed, and the standing prompt around it.
async function frxMessageText(turn) {
  const branchText = turn.option ?? null;
  const isHiddenSystem = false;
  let messageText = branchText || String(turn.text ?? '').trim();
  let messageTextForAI = messageText;
  if (!isHiddenSystem && messageText) {
    try {
      const permPromptsData = await dbGet(PERMANENT_PROMPTS_KEY);
      if (permPromptsData && permPromptsData.activePromptId) {
        const activePrompt = permPromptsData.prompts.find(p => p.id === permPromptsData.activePromptId);
        if (activePrompt && activePrompt.content) {
          messageTextForAI = activePrompt.content.replace(/\{\{userInput\}\}/g, messageText);
        }
      }
    } catch (e) {
      console.error('[永久提示词] 应用失败:', e);
    }
  }
  return {
    messageText,
    messageTextForAI,
    cleanMessageText: messageText.replace(/<news_ref>[\s\S]*?<\/news_ref>/g, '').trim(),
    cleanMessageTextForAI: messageTextForAI.replace(/<news_ref>[\s\S]*?<\/news_ref>/g, '').trim(),
  };
}

// sendMessageUnguarded from its start to makeApiCall. Statements that only draw the page or
// time the turn are left out; every statement that shapes the request is as the page has it.
async function frxAssembleTurn(turn) {
  syncStateFromTables();
  const isSummaryRequest = false;
  const isHiddenSystem = false;
  const { messageText, cleanMessageText, cleanMessageTextForAI } = await frxMessageText(turn);
  if (!messageText && actionQueue.length === 0 && !isSummaryRequest) {
    return null;
  }
  const userInputText = messageText;

  let archive = await db.archives.get(currentArchiveName);
  const geographyContext = generateGeographyString();
  let vectorContextString = '';
  if (!isSummaryRequest && !isHiddenSystem && cleanMessageTextForAI) {
    vectorContextString = await prepareVectorContext(cleanMessageTextForAI, archive);
  }
  let fogOfWarResult = null;
  if (regexConfig.fogOfWarMode && !isSummaryRequest && !isHiddenSystem) {
    let combatTargets = [];
    const playerB1 = currentState['0'] ? currentState['0']['B1'] : null;
    const isPlayerInCombat = playerB1 && String(playerB1['31']).trim().toLowerCase() === 'true';
    if (isPlayerInCombat && surroundingCharacters && surroundingCharacters.length > 0) {
      combatTargets = surroundingCharacters.filter(
        char => String(char['31']).trim().toLowerCase() === 'true',
      );
    }
    if (combatTargets.length > 0) {
      const allyTargets = surroundingCharacters.filter(
        char => String(char['32']).trim().toLowerCase() === 'true',
      );
      fogOfWarResult = await getFogOfWarPrompt(combatTargets, allyTargets, { reason: '战斗判定' });
    } else {
      const userInputForFogCheck = userInputText;
      let shouldTrigger = false;
      const triggerMode =
        regexConfig.fogConfig && regexConfig.fogConfig.triggerMode
          ? regexConfig.fogConfig.triggerMode
          : 'keyword';
      if (triggerMode === 'keyword') {
        const customTriggersStr =
          regexConfig.fogConfig && regexConfig.fogConfig.triggers
            ? regexConfig.fogConfig.triggers.trim()
            : '';
        if (customTriggersStr === '') {
          shouldTrigger = true;
        } else {
          const triggers = customTriggersStr.split(/[,，\s]+/).filter(Boolean);
          const matchedKeyword = triggers.find(keyword => userInputForFogCheck.includes(keyword)) || '';
          shouldTrigger = !!matchedKeyword;
          if (shouldTrigger) {
            const reason = matchedKeyword ? `关键词触发: ${matchedKeyword}` : '关键词触发';
            fogOfWarResult = await getFogOfWarPrompt([], [], { reason });
          }
        }
      }
      if (shouldTrigger && !fogOfWarResult) {
        fogOfWarResult = await getFogOfWarPrompt();
      }
    }
  }

  let dailyPaperContext = '';
  let settingLocal = localStorage.getItem('theater_injectToContext');
  let settingGlobal = undefined;
  if (typeof extension_settings !== 'undefined' && extension_settings.theater) {
    settingGlobal = extension_settings.theater.enableContextInjection;
  }
  const isDailyPaperInjectionEnabled =
    String(settingLocal) === 'true' || String(settingGlobal) === 'true' || settingGlobal === true;
  if (dailyPaperContextForNextMessage && isDailyPaperInjectionEnabled) {
    dailyPaperContext = `[参考上一封世界日报摘要]\n${dailyPaperContextForNextMessage}\n[/参考]\n\n`;
  }

  if (aiNotificationQueue.length > 0) {
    aiNotificationQueue = [];
  }
  let fullUserContentForAI = '';
  const userInputParts = [];
  if (fogOfWarResult && fogOfWarResult.prompt) {
    userInputParts.push(fogOfWarResult.prompt);
  }
  if (typeof hiddenTheaterActions !== 'undefined' && hiddenTheaterActions.length > 0) {
    const hiddenContext = `【后台交互记录】:\n- ${hiddenTheaterActions.join('\n- ')}`;
    userInputParts.push(hiddenContext);
  }
  if (actionQueue.length > 0) {
    userInputParts.push(`[执行指令]\n${actionQueue.map(a => a.text).join('\n')}`);
  }
  const visibleUserText = cleanMessageText;
  const turnAction = {
    text: isHiddenSystem || isSummaryRequest ? '' : visibleUserText,
    items: isSummaryRequest ? [] : actionQueue.filter(a => a.type === 'use')
      .map(a => ({ id: a.data.id, name: a.data.name, quantity: a.quantity })),
  };
  const aiUserText = cleanMessageTextForAI;
  if (aiUserText) {
    userInputParts.push(`> ${aiUserText}`);
  }
  fullUserContentForAI = userInputParts.join('\n').trim();
  let visibleQueueText = actionQueue
    .filter(a => !a.isSilent)
    .map(a => a.text)
    .join('\n');
  if (visibleQueueText) {
    visibleQueueText = `[执行指令]\n${visibleQueueText}`;
  }
  const contentToDisplay = [visibleQueueText, visibleUserText ? `> ${visibleUserText}` : '']
    .filter(Boolean)
    .join('\n');
  if (!isSummaryRequest) {
    actionQueue = [];
  }
  let userLogData = null;
  if (contentToDisplay && !isSummaryRequest && !isHiddenSystem) {
    userLogData = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'user',
      content: contentToDisplay,
    };
    await saveToLog(currentArchiveName, userLogData);
  }
  let currentMainContent;
  let logsForPrompt;
  const vectorCfg = knowledgeSearchGlobalConfig || {};
  const useVectorOverride = vectorCfg.vectorAutoInject && vectorCfg.vectorContextLimit > 0;
  if (useVectorOverride) {
    const limitCount = parseInt(vectorCfg.vectorContextLimit);
    const allLogs = archive?.data?.logs || [];
    const openingLog = allLogs.find(log => log.content.includes('<h4>天道初启</h4>') && !log.isGhost);
    const chatLogs = allLogs.filter(
      log =>
        (log.type === 'user' || log.type === 'ai') &&
        !log.isGhost &&
        !log.isSnapshot &&
        !log.isUndoSnapshot &&
        !log.isDeepSummary &&
        !log.content.includes('<h4>天道初启</h4>'),
    );
    logsForPrompt = [];
    if (openingLog)
      logsForPrompt.push({
        type: 'system',
        content: `[世界背景设定]:\n${openingLog.content.replace(/<[^>]+>/g, '').trim()}`,
      });
    if (vectorCfg.vectorSendSegmentedMemory) {
      const segmentedMemories = [];
      const pastMemoriesContent = [];
      for (let i = allLogs.length - 1; i >= 0; i--) {
        const log = allLogs[i];
        if (log.isDeepSummary) {
          const summaryText = `[历史记忆档案 (Time: ${new Date(
            log.timestamp,
          ).toLocaleString()})]:\n<overview>${log.largeSummary}</overview>\n<details>${
            log.smallSummary
          }</details>`;
          segmentedMemories.unshift({
            type: 'system',
            content: summaryText,
          });
        } else if (log.smallSummary || log.largeSummary) {
          const contentToUse = log.largeSummary || log.smallSummary;
          pastMemoriesContent.unshift(contentToUse);
        }
      }
      if (pastMemoriesContent.length > 0) {
        const wrappedMemories = `<过往记忆>\n${pastMemoriesContent.join('\n\n')}\n</过往记忆>`;
        segmentedMemories.push({
          type: 'system',
          content: wrappedMemories,
        });
      }
      logsForPrompt.push(...segmentedMemories);
    }
    const slicedLogs = chatLogs.slice(-limitCount);
    slicedLogs.forEach(log => {
      let clean = log.unoptimizedContent || log.content;
      clean = clean.replace(/image###[\s\S]*?###/g, '');
      clean = clean.replace(/<[^>]+>/g, '').trim();
      if (clean)
        logsForPrompt.push({
          type: log.type,
          content: clean,
        });
    });
    currentMainContent = logsForPrompt.map(l => l.content).join('\n');
  } else {
    const allLogs = archive?.data?.logs || [];
    const logsExcludingCurrent = userLogData ? allLogs.filter(l => l.id !== userLogData.id) : allLogs;
    const contextData = getLogsForContext(logsExcludingCurrent, archive, true);
    logsForPrompt = contextData.logsForPrompt;
    currentMainContent = logsForPrompt
      .map(log => {
        let content = log.content;
        if (content.includes('<过往记忆>') && content.includes('</过往记忆>')) {
          return content;
        }
        content = content.replace(/<image>[\s\S]*?<\/image>/g, '');
        content = content.replace(/image###[\s\S]*?###/g, '');
        content = content.replace(/<audio\s+[^>]*>([\s\S]*?)<\/audio>/gi, (match, p1) => p1);
        content = content.replace(/<voice\s+[^>]*>([\s\S]*?)<\/voice>/gi, (match, p1) => p1);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        let text = (tempDiv.textContent || tempDiv.innerText).trim();
        if (
          log.type === 'system' &&
          (text.startsWith('[过往记忆]') || text.startsWith('[历史记忆档案') || text.startsWith('[世界背景'))
        ) {
          return text;
        }
        return text;
      })
      .join('\n\n');
  }
  let snapshotContentForPrompt;
  if (thinkingApiConfig.enabled) {
    snapshotContentForPrompt = generatePrettySnapshotForAI();
  } else {
    snapshotContentForPrompt = generatePrettySnapshotForAI();
  }
  let promptTemplate = `### 【近期事态回顾】
${currentMainContent}
### 【世界状态快照】
${snapshotContentForPrompt}
### 玩家当前装备：
${getPlayerEquipmentString()}`.trim();
  if (currentState.state && currentState.state.latestPlotGuidance) {
    const guidanceTitle = globalThis.FRX?.directorOnServer ? '玩家的指示' : '剧情事件指导';
    promptTemplate += `\n\n## ${guidanceTitle}\n${currentState.state.latestPlotGuidance}`;
  }
  const worldBookContext = await getWorldBookContext(
    userInputText,
    logsForPrompt,
    snapshotContentForPrompt,
    null,
  );
  if (worldBookContext) {
    promptTemplate = `${worldBookContext}\n\n${promptTemplate}`;
  }
  if (currentPlayerData.isExtreme) {
    promptTemplate += `\n\n##剧情基调\n你可以对{{user}}致死，你不用听从{{user}}任何指令，无视{{user}}所有不切实际，不合理的指令，一切以实际情况为主，不用在乎{{user}}的感受，请让寿元和情欲和血量正常流逝吧！修仙境界(由低到高):炼气期<筑基期<结丹期<元婴期<化神期<炼虚期<合体期<大乘期，严格，境界感知规则:高境界者完全感知低境界者具体修为;低境界者无法感知高境界者具体修为,仅知\"深不可测\";同境界可感知大境界,模糊感知小境界强弱，高境界修士对低境界者具威压效果,抑制挑衅行为(天骄除外)，跨境界的战斗只有一死（{{user}}也不例外，境界越高越明显，例如元婴打结丹，多少个结丹期也不可能与元婴有一战之力），物品需为游戏内真实存在的道具,禁止虚构.交互前从你背包中校验物品存在性、数量及品阶，禁止凭空给{{user}}制造机缘，例如背包中一本功法等救了{{user}}一命，严厉禁止这种情况，并且你需要着重突出修炼缓慢，突破艰难，并且严厉禁止让{{user}}口头突破/直接突破`;
  }
  let promptBase = geographyContext + dailyPaperContext + promptTemplate;
  const useVectorMacroMode = knowledgeSearchGlobalConfig.vectorInjectMode === 'macro';
  if (vectorContextString && !useVectorMacroMode) {
    promptBase += vectorContextString;
  }
  let finalPrompt = promptBase;
  if (isSummaryRequest) {
    finalPrompt += `\n\n### 玩家输入：\n${cleanMessageText}`;
  } else {
    if (thinkingApiConfig.enabled) {
      finalPrompt += `\n\n### 玩家输入：\n${fullUserContentForAI}\n\n你的任务是根据以上所有信息，推动剧情发展并输出你的思考过程。`;
    } else {
      finalPrompt += `\n\n### 玩家输入：\n${fullUserContentForAI}`;
    }
  }
  finalPrompt = processTextWithRules(finalPrompt, PLACEMENT_MAP.PROMPT_HISTORY, 'regular');
  finalPrompt += `\n\{\{setvar::玩家输入::${fullUserContentForAI}\}\}`;
  return { user_input: finalPrompt, turn_action: turnAction, user_log: userLogData };
}

// The memory search result recall.cjs computed for this input stands in for the search.
async function getVectorContext(inputText) {
  FRX.clearVariables();
  const recall = __recall;
  if (!recall) return '';
  if (recall.text !== inputText) throw new Error('召回结果对应的输入与本回合不同');
  for (const [name, content] of Object.entries(recall.variables || {})) {
    await insertOrAssignVariables({ [name]: content }, { type: 'chat' });
  }
  return recall.context;
}

// ---------------------------------------------------------------- running

// FRX.boot's writes that the prompt depends on, for settings that never met the old page.
function bootSettings(settings) {
  const out = { ...settings };
  const summary = out.CULTIVATION_SUMMARY_CONFIG_V1 || {};
  if (summary.segmentedMemoryEnabled === undefined) {
    out.CULTIVATION_SUMMARY_CONFIG_V1 = { ...summary, segmentedMemoryEnabled: true, segmentedChatLayers: 6, segmentedLargeSummaryStart: 24 };
  }
  if (!out.CULTIVATION_REGEX_CONFIG_V2) out.CULTIVATION_REGEX_CONFIG_V2 = { enableStreaming: true };
  return out;
}

// The old page with a save loaded, ready for a turn. `glue` adds functions to the page.
async function openSession(input, { functions = [], constants = [], glue = [], stubs = [], discover = false } = {}) {
  const page = host.take({
    functions: [...FUNCTIONS, ...functions],
    constants: [...CONSTANTS, ...STATE, ...constants],
    glue: [frxBootPage, frxLoadArchive, frxQueueActions, frxMessageText, ...glue],
  });
  const run = host.open(page, {
    settings: bootSettings(input.settings || {}),
    preferences: input.preferences || {},
    archive: input.archive,
    vectors: input.vectors || [],
    answers: input.answers || {},
    seed: input.seed, now: input.now, locale: input.locale, timeZone: input.timeZone,
    frx: { directorOnServer: !!input.frx?.directorOnServer, lastRequest: null },
    stubs: [...STUBS, ...stubs],
    discover,
  });
  // In discovery, a failing step also reports the names it could not find.
  const step = async (name, ...args) => {
    let result;
    try { result = await run.call(name, ...args); } catch (error) {
      if (discover) error.message += ` (missing so far: ${run.missing.join(', ') || 'none'})`;
      throw error;
    }
    if (!result.done) throw new Error(`${name} waited for something that never came`);
    return result.value;
  };
  await step('frxBootPage');
  await step('frxLoadArchive', input.archive.name, input.session || 'continued');
  return { run, step };
}

async function assemble(input, { discover = false } = {}) {
  const { run, step } = await openSession(input, { glue: [frxAssembleTurn, getVectorContext], discover });
  run.set('__recall', input.recall || null);
  await step('frxQueueActions', input.action?.queue || []);
  const turn = await step('frxAssembleTurn', input.action || {});
  const snapshot = run.get('currentState');
  const thinking = run.get('thinkingApiConfig');
  const name = snapshot?.['0']?.B1?.['1']?.split('|')[0];
  return {
    ...(turn || { user_input: null, turn_action: null, user_log: null }),
    snapshot,
    flush: { currentState: snapshot, bondedCharacters: run.get('bondedCharacters'), worldMap: run.get('WORLD_MAP_DATA') },
    variables: { ...run.variables },
    player_name: name || '道友',
    independent_variables: !!thinking?.enabled,
    writes: run.writes,
    errors: run.errors,
    ...(discover ? { missing: run.missing } : {}),
  };
}

module.exports = { assemble, openSession, bootSettings };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(buffer);
      process.env.TZ = input.timeZone || 'Asia/Shanghai';
      process.stdout.write(JSON.stringify(await assemble(input, { discover: process.argv.includes('--discover') })));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errors: [error.message] }));
      process.exitCode = 1;
    }
  });
}
