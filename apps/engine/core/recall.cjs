/* Memory recall before a turn: the search over the saved memories, its queries, embeddings,
 * rerank and the memory folders' settings.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on. The requests the page made
 * of its server for embeddings and rerank go to the engine's host (/host/…), which the server
 * answers in process (frx.play_prompt.answerer).
 */

// app.js 17649
        function cosineSimilarity(vecA, vecB) {
          if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
          let dotProduct = 0;
          let normA = 0;
          let normB = 0;
          for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
          }
          if (normA === 0 || normB === 0) return 0;
          return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        }

// app.js 17990
        async function fetchEmbedding(inputData, config, signal = undefined) {
          const response = await fetch('/host/embeddings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: inputData }), signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || '向量生成失败');
          const vectors = data.data.sort((a,b) => a.index - b.index).map(item => item.embedding);
          return typeof inputData === 'string' ? vectors[0] : vectors;
        }

// app.js 18002
        async function fetchRerank(query, documents, config, signal = undefined) {
          const fetchUrl = '/host/rerank';
          const response = await fetch(fetchUrl, {
            signal,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.rerankModel,
              query: query,
              documents: documents,
              top_n: documents.length,
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Rerank API Error ${response.status}: ${errText}`);
          }
          const data = await response.json();
          return data.results;
        }

// app.js 18027
        function getFolderConfig(folderName) {
          const local = knowledgeSearchGlobalConfig.archiveFolderSettings?.find(item => item.archiveId === currentArchiveId)?.folders;
          if (local && Object.prototype.hasOwnProperty.call(local, folderName)) return local[folderName];
          const config = knowledgeSearchGlobalConfig.folderSettings?.[folderName] || {};
          if (config.scope === 'archive' && config.boundArchive &&
              !['current', currentArchiveName].includes(config.boundArchive)) return {};
          return config;
        }

// app.js 18036
        function setFolderConfig(folderName, config, archiveId = currentArchiveId) {
          if (config.scope === 'global') {
            (knowledgeSearchGlobalConfig.folderSettings ||= {})[folderName] = config;
          } else {
            const buckets = knowledgeSearchGlobalConfig.archiveFolderSettings ||= [];
            let bucket = buckets.find(item => item.archiveId === archiveId);
            if (!bucket) { bucket = {archiveId, folders: {}}; buckets.push(bucket); }
            bucket.folders[folderName] = config;
          }
        }

// app.js 19123
        function frxLocalSearchQueries(inputText, storyText, state, biographies, playerName) {
          const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          const label = value => clean(value).split('|')[0].trim();
          const action = clean(inputText);
          const tail = clean(storyText).slice(-200);
          const queries = [action];
          if (tail) queries.push(`前情:${tail}\n当前:${action}`);
          const timeRow = (state?.['4'] || []).find(row => row?.id === 'TIME_LOCATION_ROW') || state?.['4']?.[0];
          const place = clean(timeRow?.['0']).match(/[（(]([^）)]+)[）)]/)?.[1];
          const player = label(playerName || state?.['0']?.B1?.['1']);
          const names = [
            ...Object.values(state?.['0'] || {}).map(row => label(row?.['1'])),
            ...(Array.isArray(biographies) ? biographies : []).map(entry => label(entry?.title)),
            ...Object.values(state?.['6'] || {}).map(row => label(row?.['1'])),
            ...Object.values(state?.['1'] || {}).map(row => label(row?.['1'])),
            label(place),
          ];
          const text = action + ' ' + tail;
          const mentioned = [...new Set(names)].filter(name => name && name.length >= 2 && name !== player && text.includes(name));
          // Names in the action first, then the longer ones.
          mentioned.sort((a, b) => Number(action.includes(b)) - Number(action.includes(a)) || b.length - a.length);
          return [...new Set([...queries, ...mentioned.slice(0, 4)].filter(Boolean))];
        }

// app.js 19148
        async function getVectorContext(inputText) {
          FRX.clearVariables();
          const updateLogUI = msg => {
            latestVectorInjectionLogs = msg;
          };

          if (!knowledgeSearchGlobalConfig || !knowledgeSearchGlobalConfig.vectorAutoInject) {
            updateLogUI('⏸️ 向量检索自动注入已关闭');
            return '';
          }
          if (!inputText) {
            updateLogUI('⚠️ 输入内容为空，跳过检索');
            return '';
          }

          const controller = new AbortController();
          const signal = controller.signal;

          let statusDanmaku = null;

          updateLogUI('⏳ 正在加载向量库并分析...');

          let fallbackReasonStr = '';

          const folderSetFunc = typeof getFolderConfig === 'function' ? getFolderConfig : () => ({});
          const sessionOwnedIds = knowledgeSearchGlobalConfig.sessionOwnedIds || [];
          const hasIdBinding = sessionOwnedIds.length > 0;

          const isVisible = record => {
            if (record.scope === 'global') return true;
            if (record.scope === 'archive' && record.archiveId) {
              return record.archiveId === currentArchiveId;
            }
            const fName = record.source || '未分类';
            const fConfig = folderSetFunc(fName);
            if (fConfig && fConfig.scope === 'global') return true;
            if (hasIdBinding) {
              return sessionOwnedIds.includes(record.id);
            }
            if (fConfig && fConfig.scope === 'archive') {
              return fConfig.boundArchive === currentArchiveName;
            }
            if (!currentArchiveName) return true;
            return false;
          };

          try {
            const method = knowledgeSearchGlobalConfig.vectorSearchMethod || 'local';

            const embedApiUrl =
              knowledgeSearchGlobalConfig.embeddingUrl ||
              (knowledgeSearchGlobalConfig.apiUrl?.includes('/chat/completions')
                ? knowledgeSearchGlobalConfig.apiUrl.replace('/chat/completions', '/embeddings')
                : null);
            const embedApiKey = knowledgeSearchGlobalConfig.embeddingKey || knowledgeSearchGlobalConfig.apiKey;

            if (!embedApiUrl || !embedApiKey) {
              const errorMsg = '⚠️ 向量检索未配置 (URL/Key 缺失)，请在设置中配置Embedding API';
              updateLogUI(errorMsg);
              return '';
            }

            // 时间过滤辅助函数
            const filterMode = knowledgeSearchGlobalConfig.vectorTimeFilterMode || 'year';

            const parseGameTimeToInt = str => {
              if (!str || typeof str !== 'string') return -1;
              const cleanStr = str.replace(/\s+/g, '');
              let yearMatch = cleanStr.match(/(\d+)(?:年|[-–—])/);
              if (!yearMatch) {
                yearMatch = cleanStr.match(/^(\d{3,})/);
              }
              if (!yearMatch) return -1;

              const year = parseInt(yearMatch[1], 10);

              if (filterMode === 'year') {
                return year;
              }

              const monthMatch = cleanStr.match(/(\d{1,2})月/);
              const month = monthMatch ? parseInt(monthMatch[1], 10) : 1;

              if (filterMode === 'month') {
                return year * 100 + month;
              }

              const dayMatch = cleanStr.match(/(\d{1,2})日/);
              const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;

              return year * 10000 + month * 100 + day;
            };

            let currentGameTimeVal = Infinity;
            if (knowledgeSearchGlobalConfig.vectorTimeFilter) {
              const rawTimeStr = currentState['4'] ? currentState['4'][0]['0'] || '' : '';
              const val = parseGameTimeToInt(rawTimeStr);
              if (val > 0) currentGameTimeVal = val;

              const modeText =
                filterMode === 'year' ? '仅年份' : filterMode === 'month' ? '年份+月份' : '精确日期';

              console.log(`[向量检索] 时间过滤开启 (精度: ${modeText})，当前时间值: ${currentGameTimeVal}`);
            }

            let allRecordsRaw = await db.vectors.toArray();
            const liveLogIds = new Set(
              (((currentArchiveName && (await db.archives.get(currentArchiveName))) || {}).data?.logs || []).map(l => l.id));
            const allRecords = allRecordsRaw.filter(r => {
              if (!isVisible(r)) return false;
              if (r.outdatedTimestamp) return false;
              // FRX: a memory follows its source turns; undone or branched-away turns hide it.
              if (r.scope === 'archive' && r.frxSource?.logIds?.length
                  && !r.frxSource.logIds.every(id => liveLogIds.has(id))) return false;

              if (knowledgeSearchGlobalConfig.vectorTimeFilter && r.metadata && r.metadata.timeRange) {
                const recordTimeVal = parseGameTimeToInt(r.metadata.timeRange);
                if (recordTimeVal > 0) {
                  if (recordTimeVal > currentGameTimeVal) {
                    return false;
                  }
                }
              }
              return true;
            });

            if (allRecords.length === 0) {
              if (statusDanmaku) statusDanmaku.remove();
              updateLogUI('📭 向量库为空 (或无当前存档可见/符合时间的数据)，跳过。');
              return '';
            }

            let searchQueries = [];
            let specificIds = [];

            if (method === 'local') {
              const saved = currentArchiveName ? await db.archives.get(currentArchiveName) : null;
              searchQueries = frxLocalSearchQueries(inputText, lastUnoptimizedAiStoryText, currentState,
                saved?.data?.state?.worldBookEntries, currentPlayerData?.name);
            }

            if (method !== 'direct' && method !== 'local') {
              const useApiUrl = knowledgeSearchGlobalConfig.vectorSearchApiUrl || knowledgeSearchGlobalConfig.apiUrl;
              const useApiKey = knowledgeSearchGlobalConfig.vectorSearchApiKey || knowledgeSearchGlobalConfig.apiKey;
              const useApiModel =
                knowledgeSearchGlobalConfig.vectorSearchApiModel || knowledgeSearchGlobalConfig.apiModel;

              const canCallApi = useApiUrl && useApiKey && (method === 'semantic' || method === 'llm_index' || method === 'hybrid');

              if (canCallApi) {
                statusDanmaku = showDanmaku('正在分析剧情生成检索条件...', 'status', controller);

                let promptTemplate = '';
                if (method === 'hybrid') {
                  promptTemplate = knowledgeSearchGlobalConfig.hybridKeywordPrompt || DEFAULT_HYBRID_SEARCH_PROMPT;
                } else if (method === 'llm_index') {
                  promptTemplate = knowledgeSearchGlobalConfig.vectorIndexPrompt || DEFAULT_VECTOR_INDEX_PROMPT;
                } else {
                  promptTemplate = knowledgeSearchGlobalConfig.vectorSummaryPrompt || DEFAULT_VECTOR_SEARCH_PROMPT;
                }

                const playerName = currentPlayerData ? currentPlayerData.name || '玩家' : '玩家';
                const timeRow = currentState['4'] ? currentState['4'][0] : null;
                const currentTime = timeRow ? (timeRow['0'] || '').split('/')[0] : '未知时间';
                const currentLocation = currentPlayerData ? currentPlayerData.location || '未知' : '未知';

                let indexListStr = '';
                if (method === 'llm_index') {
                  indexListStr = allRecords.map(r => `ID: ${r.uuid} | 标题: ${r.title}`).join('\n');
                  if (indexListStr.length > 50000) {
                    indexListStr = indexListStr.substring(0, 50000) + '\n(索引过长已截断...)';
                  }
                }

                // 构建世界书上下文 (用于向量检索)
                let vectorWorldBookContext = '';
                if (knowledgeSearchGlobalConfig.vectorSearchWorldBooks && knowledgeSearchGlobalConfig.vectorSearchWorldBooks.length > 0) {
                  const activeWbEntries = knowledgeSearchGlobalConfig.vectorSearchWorldBooks.filter(e => e.enabled !== false);
                  const wbContextParts = [];
                  activeWbEntries.forEach(entry => {
                    let isTriggered = false;
                    if (entry.triggerMode === 'blue') {
                      isTriggered = true;
                    } else if (entry.triggerMode === 'green') {
                      const textToSearch = (lastAiStoryText || '') + ' ' + (inputText || '');
                      if ((entry.keywords || []).some(kw => textToSearch.includes(kw))) {
                        isTriggered = true;
                      }
                    }
                    if (isTriggered) {
                      wbContextParts.push(`[世界设定: ${entry.name}]\n${entry.content}`);
                    }
                  });
                  if (wbContextParts.length > 0) {
                    vectorWorldBookContext = '\n\n【相关世界设定参考】\n' + wbContextParts.join('\n\n');
                  }
                }

                let finalPrompt = promptTemplate
                  .replace(/\${text}/g, inputText)
                  .replace(/\${user_input}/g, inputText)
                  .replace(/\${playerName}/g, playerName)
                  .replace(/\${currentTime}/g, currentTime)
                  .replace(/\${currentLocation}/g, currentLocation)
                  .replace(/\${story_text}/g, lastAiStoryText || '（暂无前情）')
                  .replace(/\${thinking_content}/g, latestThinkingContent || '（无思考）')
                  .replace(/\${state_snapshot}/g, '（快照数据略）')
                  .replace(/\${character_biographies}/g, '')
                    .replace(/\${playerName}/g, playerName)
                    .replace(/\${currentTime}/g, currentTime)
                    .replace(/\${currentLocation}/g, currentLocation)
                    .replace(/\${story_text}/g, lastAiStoryText || '（暂无前情）')
                    .replace(/\${thinking_content}/g, latestThinkingContent || '（无思考）')
                    .replace(/\${state_snapshot}/g, '（快照数据略）')
                    .replace(/\${character_biographies}/g, '')
                    .replace(/\${worldGeography}/g, '')
                    .replace(/\${sceneMapData}/g, '')
                    .replace(/\${world_factors}/g, vectorWorldBookContext) // 借用 world_factors 占位符注入世界书
                    .replace(/\${index_list}/g, indexListStr);

                try {
                  // FRX: the keyword analysis is optional. A slow or failing provider falls back
                  // to the raw text search after 12 seconds instead of holding the turn.
                  const analysisSignal = AbortSignal.any([signal, AbortSignal.timeout(12000)].filter(Boolean));
                  const summaryResponse = await genericApiCall(
                    useApiUrl,
                    useApiKey,
                    useApiModel,
                    [
                      {
                        role: 'user',
                        content: finalPrompt,
                      },
                    ],
                    analysisSignal,
                  );

                  let cleanRes = summaryResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                  const jsonMatch = cleanRes.match(/\{[\s\S]*\}/);

                  if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.keywords && Array.isArray(parsed.keywords)) {
                      searchQueries = parsed.keywords;
                    }
                    if (parsed.ids && Array.isArray(parsed.ids)) {
                      specificIds = parsed.ids;
                    }
                  } else {
                    searchQueries = cleanRes
                      .split('\n')
                      .filter(line => line.trim().length > 0 && line.trim().length < 20);
                  }
                  console.log(`[向量检索] LLM分析结果 (${method}):`, { keywords: searchQueries, ids: specificIds });
                } catch (e) {
                  console.warn('提取检索条件失败，回退到原文搜索', e);
                  if (statusDanmaku)
                    statusDanmaku.innerHTML = '<span style="color:orange">检索分析API调用失败...</span>';
                }
              }
            }

            if (searchQueries.length === 0 && specificIds.length === 0) {
              let fallbackQuery = inputText;
              if (typeof lastUnoptimizedAiStoryText !== 'undefined' && lastUnoptimizedAiStoryText) {
                let storyTail = lastUnoptimizedAiStoryText;
                if (storyTail.length > 200) storyTail = storyTail.substring(storyTail.length - 200);
                fallbackQuery = `前情:${storyTail}\n当前:${inputText}`;
              }
              searchQueries = [fallbackQuery];
              fallbackReasonStr = method === 'direct' ? '' : '原文模式 (API未触发或无结果)';
            }

            const embedConfig = {
              apiUrl: embedApiUrl,
              apiKey: embedApiKey,
              apiModel: knowledgeSearchGlobalConfig.embeddingModel || 'text-embedding-3-small',
            };

            const uniqueItemsMap = new Map();
            const keywordLogs = {};

            const minScoreConfig =
              knowledgeSearchGlobalConfig.vectorMinScore !== undefined
                ? knowledgeSearchGlobalConfig.vectorMinScore
                : 0.4;
            const enableRerank = knowledgeSearchGlobalConfig.enableRerank && knowledgeSearchGlobalConfig.rerankUrl;
            const recallTopK = enableRerank
              ? parseInt(knowledgeSearchGlobalConfig.rerankTopK) || 20
              : (parseInt(knowledgeSearchGlobalConfig.vectorMaxResults) || 3) * 2;

            if (specificIds.length > 0) {
              if (!keywordLogs['[索引指定]']) keywordLogs['[索引指定]'] = [];

              specificIds.forEach(rawId => {
                const targetId = String(rawId)
                  .replace(/^(ID:|id:|ID|id)\s*/, '')
                  .trim();
                const record = allRecords.find(r => r.uuid === targetId);

                if (record) {
                  uniqueItemsMap.set(record.uuid, { ...record, score: 999.0, isForcedPlot: true, isIndexHit: true });
                  keywordLogs['[索引指定]'].push(`🎯 [ID:${targetId}] ${record.title}`);
                } else {
                  keywordLogs['[索引指定]'].push(`⚠️ 未找到ID: ${targetId}`);
                }
              });
            }

            if (searchQueries.length > 0) {
              if (statusDanmaku)
                statusDanmaku.innerHTML = `<i class=\"fas fa-spinner fa-spin\"></i> 检索 ${searchQueries.length} 个维度...`;

              // FRX: one embedding request for all queries. A batch the gateway rejects falls back to
              // one request each; a batch that timed out does not, since those would wait as long.
              let batchVectors = null, batchTimedOut = false;
              if (searchQueries.length > 1) {
                try {
                  const vectors = await fetchEmbedding(searchQueries, embedConfig, AbortSignal.any([signal, AbortSignal.timeout(15000)].filter(Boolean)));
                  if (Array.isArray(vectors) && vectors.length === searchQueries.length) batchVectors = vectors;
                } catch (err) {
                  batchTimedOut = signal.aborted || err?.name === 'TimeoutError' || err?.name === 'AbortError';
                }
              }

              await Promise.all(
                searchQueries.map(async (query, queryIndex) => {
                  if (signal.aborted) return;
                  keywordLogs[query] = [];
                  if (batchTimedOut) {
                    keywordLogs[query].push('❌ 检索异常: 向量生成超时');
                    return;
                  }

                  try {
                    // FRX: the player is waiting; a slow embedding skips this query instead of holding the turn.
                    const queryVector = batchVectors?.[queryIndex]
                      || await fetchEmbedding(query, embedConfig, AbortSignal.any([signal, AbortSignal.timeout(15000)].filter(Boolean)));
                    if (signal.aborted) return;

                    let scores = [];
                    const BATCH_SIZE_CALC = 500;
                    const queryLower = query.toLowerCase().trim();

                    for (let i = 0; i < allRecords.length; i += BATCH_SIZE_CALC) {
                      if (i > 0) await new Promise(r => setTimeout(r, 0));
                      const end = Math.min(i + BATCH_SIZE_CALC, allRecords.length);

                      for (let j = i; j < end; j++) {
                        const rec = allRecords[j];
                        if (rec.outdatedTimestamp) continue;

                        let vectorScore = cosineSimilarity(queryVector, rec.vector);
                        let metaScore = 0;
                        if (rec.title && rec.title.toLowerCase().includes(queryLower)) {
                          metaScore = 0.95;
                        }
                        let finalScore = Math.max(vectorScore, metaScore);
                        scores.push({ index: j, score: finalScore });
                      }
                    }

                    scores.sort((a, b) => b.score - a.score);
                    let candidates = scores.slice(0, recallTopK).map(s => {
                      const rec = allRecords[s.index];
                      return { ...rec, score: s.score, matchQuery: query, isReranked: false };
                    });

                    if (enableRerank && candidates.length > 0) {
                      try {
                        const texts = candidates.map(c => `标题: ${c.title}\n${c.content}`);
                        const rrConfig = {
                          apiKey: knowledgeSearchGlobalConfig.rerankKey || knowledgeSearchGlobalConfig.apiKey,
                          rerankUrl: knowledgeSearchGlobalConfig.rerankUrl,
                          rerankModel: knowledgeSearchGlobalConfig.rerankModel,
                        };
                        const rrRes = await fetchRerank(query, texts, rrConfig, AbortSignal.any([signal, AbortSignal.timeout(15000)].filter(Boolean)));
                        if (!signal.aborted) {
                          candidates = rrRes
                            .map(rItem => ({
                              ...candidates[rItem.index],
                              score: rItem.relevance_score,
                              isReranked: true,
                            }))
                            .sort((a, b) => b.score - a.score);
                        }
                      } catch (err) {
                        keywordLogs[query].push(`⚠️ Rerank失败: ${err.message}`);
                      }
                    }

                    const topCandidatesForLog = candidates.slice(0, 10);
                    if (topCandidatesForLog.length > 0) {
                      topCandidatesForLog.forEach(item => {
                        if (uniqueItemsMap.has(item.uuid)) {
                          return;
                        }

                        const isPass = item.score >= minScoreConfig;
                        const statusIcon = isPass ? '✅' : '⚪';
                        const scoreLabel = item.isReranked
                          ? `Score:${item.score.toFixed(4)}`
                          : `Sim:${(item.score * 100).toFixed(1)}%`;
                        keywordLogs[query].push(
                          `${statusIcon} [${scoreLabel}] [${item.source || '未分类'}] ${item.title}`,
                        );

                        if (isPass) {
                          uniqueItemsMap.set(item.uuid, item);
                        }
                      });
                    } else {
                      keywordLogs[query].push(`(无匹配结果 > ${minScoreConfig})`);
                    }
                  } catch (err) {
                    console.error(err);
                    keywordLogs[query].push(`❌ 检索异常: ${err.message}`);
                  }
                }),
              );
            }

            if (method === 'hybrid') {
                const plotLimit = parseInt(knowledgeSearchGlobalConfig.hybridRecentLimit) || 50;
                const marker = knowledgeSearchGlobalConfig.hybridProtagonistMarker || '【主角剧情线】';
                const forcedScore = 999.0;

                const visibleRecords = allRecordsRaw.filter(r => isVisible(r));
                
                const markerMatches = visibleRecords
                    .filter(r => !r.outdatedTimestamp)
                    .filter(r => {
                        const title = r.title || '';
                        const content = r.content || '';
                        return title.includes(marker) || content.includes(marker);
                    });

                const mainPlotRecords = markerMatches
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .slice(0, plotLimit);

                if (!keywordLogs['[强制剧情线]']) keywordLogs['[强制剧情线]'] = [];
                
                if (markerMatches.length === 0) {
                    keywordLogs['[强制剧情线]'].push('⚠️ 未命中：未找到剧情线标记条目。');
                } else {
                    mainPlotRecords.forEach(rec => {
                        const key = rec.uuid;
                        if (!uniqueItemsMap.has(key)) {
                            const forcedRec = { ...rec, score: forcedScore, isForcedPlot: true };
                            uniqueItemsMap.set(key, forcedRec);
                            keywordLogs['[强制剧情线]'].push(`✅ [注入] ${rec.title}`);
                        } else {
                            const existing = uniqueItemsMap.get(key);
                            existing.isForcedPlot = true;
                            existing.score = Math.max(existing.score || 0, forcedScore);
                        }
                    });
                }
            }

            if (signal.aborted) return '';

            const mergedList = Array.from(uniqueItemsMap.values()).sort((a, b) => b.score - a.score);
            const finalSelectedItems = [];
            const processedTitles = new Set();
            const folderCounts = {};

            const targetLimitN = (method === 'hybrid' || method === 'llm_index') ?
                                 (mergedList.length) :
                                 (parseInt(knowledgeSearchGlobalConfig.vectorMaxResults) || 3);

            for (const item of mergedList) {
              const isForced = !!item.isForcedPlot || !!item.isIndexHit;
              const cleanTitle = (item.title || '').trim();
              if (!isForced && cleanTitle && processedTitles.has(cleanTitle)) continue;
              processedTitles.add(cleanTitle);

              const folderName = item.source || '未分类';
              const fConfig = folderSetFunc(folderName);
              const folderLimit = fConfig.maxResults || 0;

              if (!folderCounts[folderName]) folderCounts[folderName] = 0;
              if (!isForced && folderLimit > 0 && folderCounts[folderName] >= folderLimit) continue;

              folderCounts[folderName]++;
              finalSelectedItems.push(item);

              if (method === 'semantic' || method === 'direct' || method === 'local') {
                if (finalSelectedItems.length >= targetLimitN) break;
              }
            }

            let logStr = `🎯 [策略: ${method} | Rerank:${enableRerank ? '开' : '关'}]\n`;
            if (fallbackReasonStr) logStr += `⚠️ [降级: ${fallbackReasonStr}]\n`;

            if (keywordLogs['[索引指定]']) {
              logStr += `\n📌 [索引指定 (LLM Index)]\n`;
              keywordLogs['[索引指定]'].forEach(l => (logStr += `   └─ ${l}\n`));
            }

            for (const query of searchQueries) {
              logStr += `🔍 "${query}"\n`;
              const logs = keywordLogs[query] || [];
              if (logs.length === 0) logStr += `   └─ (无记录)\n`;
              else logs.forEach(l => (logStr += `   └─ ${l}\n`));
            }

            if (finalSelectedItems.length > 0) {
              logStr += `\n📊 最终注入 (${finalSelectedItems.length}条):\n`;
              finalSelectedItems.forEach(item => {
                logStr += `   ⭐ [${item.source}] ${item.title}\n`;
              });
            } else {
              logStr += `\n📊 最终注入: 无\n`;
            }

            updateLogUI(logStr);

            if (finalSelectedItems.length === 0) {
              if (statusDanmaku) statusDanmaku.remove();
              return '';
            }

            const finalGroups = {};
            finalSelectedItems.forEach(item => {
              const folder = item.source || '未分类';
              if (!finalGroups[folder]) finalGroups[folder] = [];
              finalGroups[folder].push(item);
            });

            const allBlocks = [];
            const variableGroups = {};

            for (const folderName in finalGroups) {
              const items = finalGroups[folderName];
              const fConfig = folderSetFunc(folderName);
              let blockOutput = '';

              if (fConfig && fConfig.template && fConfig.template.trim()) {
                const mergedText = items.map(item => `### 标题: ${item.title}\n${item.content}`).join('\n\n');
                blockOutput = fConfig.template.replace(/\{\{text\}\}/g, mergedText);
              } else {
                const defaultList = items
                  .map(item => {
                    let scoreLabel = item.isReranked
                      ? `Score:${item.score.toFixed(4)}`
                      : `Sim:${(item.score * 100).toFixed(1)}%`;
                    if (item.isForcedPlot) scoreLabel = 'ForcedPlot';
                    if (item.isIndexHit) scoreLabel = 'IndexHit';
                    return `### 标题: ${item.title}\n[参考资料 | 来源: ${item.source} | ${scoreLabel}]\n${item.content}`;
                  })
                  .join('\n\n');
                blockOutput = `### 来源目录：${folderName}\n${defaultList}`;
              }
              allBlocks.push(blockOutput);

              const varName = (fConfig?.variableName || 'vector').trim() || 'vector';
              if (!variableGroups[varName]) variableGroups[varName] = [];
              variableGroups[varName].push(blockOutput);
            }

            if (statusDanmaku) statusDanmaku.remove();
            showDanmaku(`RAG：注入 ${finalSelectedItems.length} 条记忆`, 'success');

            const vectorResult = allBlocks.join('\n\n');
            cachedVectorContext = vectorResult;

            for (const varName in variableGroups) {
              const content = variableGroups[varName].join('\n\n');
              try {
                if (typeof insertOrAssignVariables === 'function') {
                  await insertOrAssignVariables({ [varName]: content }, { type: 'chat' });
                }
              } catch (e) {}
            }

            return `\n\n${vectorResult}\n`;
          } catch (e) {
            if (e.name === 'AbortError') return '';
            console.error('[向量检索] 错误:', e);

            const errorMsg = `❌ 检索中断: ${e.message}`;
            updateLogUI(errorMsg);

            if (statusDanmaku) statusDanmaku.remove();
            return '';
          }
        }

// app.js 22141
        async function prepareVectorContext(cleanMessageText, archive) {
          if (!cleanMessageText) return '';
          try {
            const freshKnowledgeConfig = await dbGet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2');
            if (freshKnowledgeConfig) {
              knowledgeSearchGlobalConfig = {
                ...knowledgeSearchGlobalConfig,
                ...freshKnowledgeConfig,
              };
            }
          } catch (e) {}
          let textForVectorSearch = cleanMessageText;
          if (archive && archive.data && archive.data.logs) {
            const depth =
              typeof knowledgeSearchGlobalConfig.vectorSearchContextDepth !== 'undefined'
                ? parseInt(knowledgeSearchGlobalConfig.vectorSearchContextDepth)
                : 1;
            if (depth > 0) {
              const candidateLogs = archive.data.logs
                .filter(l => (l.type === 'ai' || l.type === 'user') && !l.isGhost && !l.isDeepSummary)
                .reverse()
                .slice(0, depth * 2);
              if (candidateLogs.length > 0) {
                const historyText = candidateLogs
                  .reverse()
                  .map(l => {
                    const txt = l.unoptimizedContent || l.content.replace(/<[^>]+>/g, '').trim();
                    return l.type === 'user' ? `(玩家): ${txt}` : `(剧情): ${txt}`;
                  })
                  .join('\n\n');
                textForVectorSearch = `【前情提要】\n${historyText}\n\n【当前玩家行动】\n${cleanMessageText}`;
              }
            }
          }
          const vectorPrompt = await getVectorContext(textForVectorSearch);
          return vectorPrompt || '';
        }

module.exports = {
  cosineSimilarity,
  fetchEmbedding,
  fetchRerank,
  getFolderConfig,
  setFolderConfig,
  frxLocalSearchQueries,
  getVectorContext,
  prepareVectorContext,
};
