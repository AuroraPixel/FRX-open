/* What the old page does with a turn's reply once the model has finished, with the page's own
 * functions (see host.cjs).
 *
 *   node apps/engine/after.cjs < input.json > output.json
 *
 * Input: { mode, ... }; every mode takes `settings` (key → value, as dbGet reads them),
 * `preferences` (the page's localStorage mirror), `seed` and `now`.
 *
 *   mode 'log'   { reply }
 *     The AI log entry sendMessageUnguarded saves for a reply (the reply as TavernHelper.generate
 *     returns it: for engine-settled turns the server's synthesized final reply), before the
 *     server applies its settlement: {log: {content, unoptimizedContent, branchContent,
 *     newsReference, type, smallSummary?, largeSummary?}, parsed}. `parsed` is false when the
 *     page's own reading of the state block fails; the page then saves the log without summaries.
 *
 *   mode 'archive' | 'summary' | 'paper' | 'evolution'   { archive, vectors, logId, scope, models, answers }
 *     One of the page's jobs after a committed turn (logId: the turn's AI log), run on the save
 *     as the server holds it: memory archiving (archiveCommittedTurn), the automatic summary
 *     update (autoApiUpdateSummaryForLog), the daily paper (callAutomatedAITheater) and world
 *     evolution (_internalRunWorldEvolution); for the last two, also the merge
 *     applyVariableAndUiUpdates does with their results. Network requests go out in passes, as in
 *     recall.cjs: {done: false, needs} until every answer is given, then
 *     {done: true, value, archive, received, writes, preferences, errors}: the save as the job left
 *     it (null when it wrote nothing), the save as the server last returned it to the job (world
 *     evolution's commit; null otherwise), the settings it wrote and the page's preferences.
 */
'use strict';

const host = require('./host.cjs');
const { openSession } = require('./assemble.cjs');

const STATE = ['regexConfig', 'summaryConfig'];
const CONSTANTS = ['PLACEMENT_MAP', 'REGEX_CONFIG_KEY', 'SUMMARY_CONFIG_KEY'];

const LOG_FUNCTIONS = [
  'dbGet', 'loadRegexConfig', 'loadSummaryConfig',
  'parseAIResponse', 'parseBranchOptions', 'extractStoryForOptimization', 'processTextWithRules', 'parseRegexString',
  'processWorldBookEntries', 'convertSimpleMarkdown',
  // The page reads the state block again for the log's summaries.
  'parseTableEditCommands', 'recursivelyParseJsonStrings', 'parseNestedJsonString', 'parseRemarksString',
  'serializeRemarksObject', 'getTableIndexFromId',
];

// ---------------------------------------------------------------- glue, run in the page's scope

// sendMessageUnguarded from makeApiCall's answer to the log entry it saves, and the summaries
// applyVariableAndUiUpdates adds to it. Statements that draw the page, time the turn or start
// other work (image tagging, the concurrent daily paper) are left out; they are off by default
// and the new interface does not run them.
async function frxReplyLog(reply) {
  await loadRegexConfig();
  await loadSummaryConfig();
  const mainApiResponse = String(reply || '').trim();
  if (!mainApiResponse) return null;
  let correctedApiResponse = mainApiResponse;
  if (
    correctedApiResponse &&
    correctedApiResponse.includes('</thinking>') &&
    !correctedApiResponse.includes('<thinking>')
  ) {
    correctedApiResponse = '<thinking>' + correctedApiResponse;
  }
  if (
    correctedApiResponse &&
    correctedApiResponse.includes('<thinking>') &&
    !correctedApiResponse.includes('</thinking>')
  ) {
    const lastContentIndex = correctedApiResponse.lastIndexOf('<content>');
    if (lastContentIndex !== -1) {
      const part1 = correctedApiResponse.substring(0, lastContentIndex);
      const part2 = correctedApiResponse.substring(lastContentIndex);
      correctedApiResponse = part1 + '</thinking>' + part2;
    }
  }
  const processedResponse = processTextWithRules(correctedApiResponse, PLACEMENT_MAP.AI_OUTPUT, 'chain');
  const { tableEditCommands, branchContent, newsReferenceContent, hasStoreTag } = parseAIResponse(processedResponse);
  const storyContentForOptimization = extractStoryForOptimization(processedResponse);
  let contentToProcess = storyContentForOptimization;
  contentToProcess = processWorldBookEntries(contentToProcess);
  contentToProcess = convertSimpleMarkdown(contentToProcess);
  const processedHtmlContent = processTextWithRules(contentToProcess, PLACEMENT_MAP.AI_OUTPUT, 'regular');
  const logEntry = {
    content: processedHtmlContent,
    unoptimizedContent: storyContentForOptimization,
    type: 'ai',
    branchContent: branchContent,
    newsReference: newsReferenceContent || '无',
  };
  // The variables step without a thinking model: the reply's own state block.
  const errorMessages = [];
  if (!hasStoreTag) {
    errorMessages.push({ title: '未找到 <upstore> 标签', details: 'AI回复中缺少必须的 <upstore>...</upstore> 指令块。' });
  }
  const { smallSummary, largeSummary } = parseTableEditCommands(tableEditCommands, errorMessages);
  if (errorMessages.length) return { log: logEntry, parsed: false };
  if (summaryConfig.segmentedMemoryEnabled) {
    logEntry.smallSummary = smallSummary || '';
    logEntry.largeSummary = largeSummary || '';
  }
  return { log: logEntry, parsed: true };
}

// ---------------------------------------------------------------- the jobs after a turn

const JOB_FUNCTIONS = [
  // Memory archiving, and the clean-up of outdated memories after it.
  'archiveLatestTurn', 'archiveMissedTurns', 'autoSaveToVectorDb', 'commitVectorArchiveEntry', 'fetchEmbedding',
  'cleanupOutdatedVectors',
  'genericApiCall', 'chunkText', 'getFolderConfig', 'setFolderConfig', 'getTheaterWorldBookContext',
  'getWorldFactorsContext',
  // The automatic summary update.
  'autoApiUpdateSummaryForLog', 'callSummaryApiDirect',
  // The daily paper.
  'callAutomatedAITheater', 'genericApiCallStream', 'getPreviousDailyPapers', 'findBestMatchingTemplate',
  'renderAirpTemplate', 'extractHtmlFromAiResponse', 'extractMapEventsFromHtml', 'saveCurrentState',
  '_internalSaveCurrentState',
  // World evolution.
  '_internalRunWorldEvolution', 'getSingleCharacterSnapshot', 'extractMainContent',
];
const JOB_CONSTANTS = [
  'isTheaterGenerating', 'theaterApiController', 'latestDailyPaperResponse', 'DAILY_PAPER_PRESETS_KEY',
  'WORLD_EVOLUTION_API_CONFIG_KEY', 'WORLD_EVOLUTION_PRESETS_KEY', 'THEATER_WORLDBOOKS_KEY', 'cloudStorageConfig',
  'archivedTurnLogs', 'backfillAttempts', 'DEFAULT_DAILY_PAPER_PROMPT',
  // manageEvolutionPresets' default rule.
  'defaultRule',
];
// The page's messages to the player, which the jobs do not show, and the folder condensation
// the archiving schedules, which is off by default (its threshold is 0) and not run.
const JOB_STUBS = ['showDanmaku', 'showCustomAlert', 'triggerVectorFolderCondensation'];

// host.js's window.FRX for a job: the job's own scope, checked against the save in hand, and the
// host's stream reader for a model reply.
function frxJobHost(scope) {
  FRX.captureScope = async () => ({ ...scope });
  FRX.assertScope = async check => {
    if (!check) return;
    const archive = await db.archives.get(check.archive);
    const data = archive?.data;
    if (!data || (data.archiveId ?? null) !== check.archive_id || (data.frxTimelineEpoch || '') !== check.epoch
      || (check.log_id && !data.logs.some(log => log.id === check.log_id))) {
      throw new Error('任务所属回合已回溯，后台结果未应用');
    }
  };
  FRX.getArchive = async check => {
    await FRX.assertScope(check);
    return db.archives.get(check?.archive || currentArchiveName);
  };
  // The save as the server wrote it (world evolution's commit): what the job changes after it
  // is measured from here.
  FRX.receiveArchive = async value => {
    globalThis.__frxReceived = value;
    await db.archives.put(value);
    currentState = value.data.state.currentState;
  };
  FRX.readSSE = async (response, onDelta = () => {}) => {
    if (!response.ok) throw new Error('模型请求失败');
    let full = '';
    for (const line of (await response.text()).split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      const data = JSON.parse(raw);
      if (data.error) throw new Error(data.error.message || '生成失败');
      const text = data.choices?.[0]?.delta?.content || '';
      full += text;
      await onDelta(text);
    }
    return full;
  };
  // host.js's FRXRequest, through the page's fetch to the engine's host (/host/…): the server
  // answers it in process (frx.play_jobs).
  globalThis.FRXRequest = async (path, method = 'GET', body) => {
    const response = await fetch('/host' + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail?.message || data.detail || '请求失败');
    return data;
  };
  // database.js's vectors table: the filters the archiving uses, over the memories given.
  const rows = () => db.vectors.toArray();
  const query = keep => ({ filter: more => query(row => keep(row) && more(row)), toArray: async () => (await rows()).filter(keep) });
  db.vectors.filter = keep => query(keep);
  db.vectors.where = field => ({ equals: value => query(row => row[field] === value) });
  db.vectors.receive = record => record.value;
}

// archiveCommittedTurn without its queue: the turn's memory, then the earlier turns it missed,
// then the clean-up the page runs a few seconds after it saved memories (autoSaveToVectorDb
// schedules it on a timer the job does not wait for, and marks a save in
// lastWorldEvoVectorIds): memories retired more than vectorOutdatedRetention rounds ago (50 by
// default) are pruned. Recall skips retired memories already.
async function frxArchiveJob(logId) {
  window.lastWorldEvoVectorIds = null;
  await archiveLatestTurn(logId);
  await archiveMissedTurns(logId);
  if (window.lastWorldEvoVectorIds?.length) await cleanupOutdatedVectors();
}

async function frxSummaryJob(logId) {
  const archive = await db.archives.get(currentArchiveName);
  const logEntry = archive.data.logs.find(log => log.id === logId);
  await autoApiUpdateSummaryForLog(logEntry);
}

// What applyVariableAndUiUpdates does with the background results of a turn: the paper on the
// turn's log, the evolved biographies on the log and in the state, then the page's state saved.
async function frxMergeBackground(logId, theaterResult, worldEvoUpdates) {
  const frxScope = await FRX.captureScope();
  const archive = await FRX.getArchive(frxScope);
  const logEntry = { ...archive.data.logs.find(log => log.id === logId) };
  if (theaterResult) {
    if (theaterResult.dailyPaperHtml) logEntry.dailyPaperHtml = theaterResult.dailyPaperHtml;
    if (theaterResult.mapEvents) logEntry.mapEvents = theaterResult.mapEvents;
    if (theaterResult.activeTheaterHTML) {
      if (!currentState.state) currentState.state = {};
      currentState.state.activeTheaterHTML = theaterResult.activeTheaterHTML;
    }
  }
  if (!theaterResult && !worldEvoUpdates) return;
  const mostRecentBiographies = archive.data.state.worldBookEntries || logEntry.biographySnapshot || [];
  const masterMap = new Map(mostRecentBiographies.map(e => [e.key || e.title, e]));
  if (worldEvoUpdates) worldEvoUpdates.forEach(entry => masterMap.set(entry.key || entry.title, entry));
  const finalBiographies = Array.from(masterMap.values());
  archive.data.state.worldBookEntries = finalBiographies;
  const canonical = archive.data.logs.find(log => log.id === logId);
  if (!canonical) throw new Error('回合已回溯，后台结果未应用');
  canonical.biographySnapshot = finalBiographies;
  for (const key of ['dailyPaperHtml', 'mapEvents']) if (logEntry[key]) canonical[key] = logEntry[key];
  archive.data.state.currentState = currentState;
  await db.archives.put(archive, { scope: frxScope });
  await saveCurrentState(frxScope);
}

// The default presets the page saves the first time it needs them: the daily paper's on every
// load (manageDailyPaperPresets), world evolution's when its settings are opened, which is how
// evolution gets switched on (manageEvolutionPresets).
async function frxDailyPaperPreset() {
  let presetsData = await dbGet(DAILY_PAPER_PRESETS_KEY);
  if (!presetsData || !presetsData.presets || presetsData.presets.length === 0) {
    presetsData = {
      activePresetId: 'default-daily-paper',
      presets: [
        {
          id: 'default-daily-paper',
          name: '默认日报配置',
          rules: [
            {
              id: 'default-daily-paper-rule',
              name: '默认日报生成规则',
              enabled: true,
              role: 'user',
              triggerMode: 'blue',
              keywords: [],
              content: DEFAULT_DAILY_PAPER_PROMPT,
            },
          ],
          templates: [],
          activeTemplateId: null,
        },
      ],
    };
    await dbSet(DAILY_PAPER_PRESETS_KEY, presetsData);
  }
}

async function frxEvolutionPreset() {
  const data = await dbGet(WORLD_EVOLUTION_PRESETS_KEY);
  if (!data || !data.presets || !Array.isArray(data.presets) || data.presets.length === 0) {
    await dbSet(WORLD_EVOLUTION_PRESETS_KEY, {
      activePresetId: 'default-evolution',
      presets: [{ id: 'default-evolution', name: '默认演化配置', rules: [defaultRule] }],
    });
  }
}

async function frxPaperJob(logId) {
  await frxDailyPaperPreset();
  const archive = await db.archives.get(currentArchiveName);
  const log = archive.data.logs.find(entry => entry.id === logId);
  const news = log.newsReference && log.newsReference !== '无' ? log.newsReference : '';
  const result = await callAutomatedAITheater(log.unoptimizedContent || log.content || '', news, logId);
  await frxMergeBackground(logId, result, null);
  return !!result;
}

// World evolution on the page's own trigger: every `frequency` rounds, with the stories of those
// rounds when the frequency is above one.
async function frxEvolutionJob(logId) {
  const config = (await dbGet('CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1')) || {};
  if (!config.enabled || !lastAiStoryText) return false;
  await frxEvolutionPreset();
  const archive = await db.archives.get(currentArchiveName);
  const aiLogs = archive?.data?.logs?.filter(l => l.type === 'ai' && !l.isUndoSnapshot) || [];
  const frequency = config.frequency || 1;
  if (aiLogs.length % frequency !== 0) return false;
  let contextStoryText = lastAiStoryText;
  if (frequency > 1) {
    const combinedText = aiLogs.slice(-frequency)
      .map(log => log.unoptimizedContent || log.content.replace(/<[^>]*>/g, '').trim())
      .join('\n\n=== 接上文 ===\n\n');
    if (combinedText) contextStoryText = combinedText;
  }
  const updates = await _internalRunWorldEvolution(false, contextStoryText);
  await frxMergeBackground(logId, null, updates);
  return !!updates;
}

const JOBS = { archive: 'frxArchiveJob', summary: 'frxSummaryJob', paper: 'frxPaperJob', evolution: 'frxEvolutionJob' };

// What host.js wrote on every load of the old page: each model setting points at the server's
// profile for it (at the engine's host, /host/profiles/…), and the daily paper's connection sits in
// the browser's storage. The page's jobs do nothing without them. `models` names each profile's
// model.
function hostDefaults(input) {
  const origin = 'http://127.0.0.1';
  const models = input.models || {};
  const settings = { ...(input.settings || {}) };
  for (const [key, role] of [
    ['CULTIVATION_THINKING_API_CONFIG_V1', 'variables'], ['CULTIVATION_SUMMARY_CONFIG_V1', 'summary'],
    ['CULTIVATION_IMAGE_TAGGING_API_CONFIG_V1', 'optimization'], ['CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1', 'evolution'],
    ['CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2', 'archive'],
  ]) {
    const defaults = { apiUrl: origin + '/host/profiles/' + role, apiKey: 'server-managed', apiModel: models[role] || models.default };
    if (role === 'archive') {
      Object.assign(defaults, {
        embeddingModel: models.embedding, rerankModel: models.rerank,
        vectorSaveApiModel: models.archive, vectorSearchApiModel: models.archive,
      });
    }
    settings[key] = { ...(settings[key] || {}), ...defaults };
  }
  const preferences = {
    ...(input.preferences || {}),
    theater_apiEndpoint: origin + '/host/profiles/theater', theater_apiKey: 'server-managed', theater_apiModel: models.default,
  };
  return { ...input, settings, preferences };
}

async function job(input, { discover = false } = {}) {
  input = hostDefaults(input);
  const { run } = await openSession(input, {
    discover,
    functions: JOB_FUNCTIONS, constants: JOB_CONSTANTS,
    glue: [frxJobHost, frxArchiveJob, frxSummaryJob, frxMergeBackground, frxDailyPaperPreset, frxEvolutionPreset,
      frxPaperJob, frxEvolutionJob],
    stubs: JOB_STUBS,
  });
  await run.call('frxJobHost', input.scope);
  // Loading the save writes a few settings of its own; only the job's writes count.
  const booted = run.writes.settings.length;
  const before = JSON.stringify(input.archive);
  const result = await run.call(JOBS[input.mode], input.logId);
  if (!result.done) {
    return {
      done: false, needs: run.needs.map(({ key, method, url, body }) => ({ key, method, url, body })),
      ...(discover ? { missing: run.missing } : {}),
    };
  }
  const archive = run.archive;
  return {
    done: true, value: result.value ?? null,
    archive: JSON.stringify(archive) === before ? null : archive,
    received: run.get('globalThis.__frxReceived') ?? null,
    writes: run.writes.settings.slice(booted), errors: run.errors,
    // The page's own storage, without the connection hostDefaults put there.
    preferences: Object.fromEntries(Object.entries(run.localStorage.entries()).filter(([key]) => !/^theater_api(?:Endpoint|Key|Model)$/.test(key))),
    ...(discover ? { missing: run.missing } : {}),
  };
}

// ---------------------------------------------------------------- running

function page(input, functions, glue) {
  return host.open(host.take({ functions, constants: [...CONSTANTS, ...STATE], glue }), {
    settings: input.settings || {},
    preferences: input.preferences || {},
    seed: input.seed, now: input.now, locale: input.locale, timeZone: input.timeZone,
  });
}

async function replyLog(input) {
  const run = page(input, LOG_FUNCTIONS, [frxReplyLog]);
  const result = await run.call('frxReplyLog', input.reply);
  if (!result.done) throw new Error('回复日志未能生成');
  return { ...(result.value || { log: null, parsed: false }), errors: run.errors };
}

const MODES = { log: replyLog, archive: job, summary: job, paper: job, evolution: job };

async function after(input) {
  const mode = MODES[input.mode];
  if (!mode) throw new Error('未知的回合后步骤 ' + input.mode);
  return mode(input);
}

module.exports = { after, job };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(buffer);
      process.env.TZ = input.timeZone || 'Asia/Shanghai';
      process.stdout.write(JSON.stringify(await after(input)));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errors: [error.message] }));
      process.exitCode = 1;
    }
  });
}
