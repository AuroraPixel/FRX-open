/* The work after a turn: archiving the turn into memories, the automatic summary update, the
 * daily paper and world evolution (after.cjs runs them).
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 15
      let isTheaterGenerating = false;

// app.js 853
      function renderAirpTemplate(template, llmOutput) {
        // 1. 解析数据 (Parse)
        const dataMap = parseAirpDataBlocks(llmOutput);

        // 2. 使用 DOMParser 处理条件显隐 (Conditional Display)
        const wrappedTemplate = `<!DOCTYPE html><html><head></head><body>${template}</body></html>`;
        const parser = new DOMParser();
        const doc = parser.parseFromString(wrappedTemplate, 'text/html');

        // 查找所有带有 data-show-if 属性的元素
        const conditionalElements = doc.querySelectorAll('[data-show-if]');
        conditionalElements.forEach(el => {
          const rawAttr = el.getAttribute('data-show-if');
          const keyMatch = rawAttr.match(/\{\{([a-zA-Z0-9_]+)\}\}/);
          if (keyMatch) {
            const key = keyMatch[1];
            const val = dataMap[key];
            if (!val || val.trim() === '') {
              el.style.display = 'none';
            }
          }
        });

        // 获取处理后的 HTML
        let rendered = doc.body.innerHTML;

        // 3. 替换模具占位符 (Replace)
        AIRP_PLACEHOLDER_REGEX.lastIndex = 0;
        rendered = rendered.replace(AIRP_PLACEHOLDER_REGEX, (match, key) => {
          return dataMap.hasOwnProperty(key) ? dataMap[key] : '';
        });

        return rendered;
      }

// app.js 888
      const DEFAULT_DAILY_PAPER_PROMPT = `你现在是修仙界的一名资深主编，任务是根据提供的素材，排版并撰写一份精美的日报。

【当前时空信息】
- 当前玩家：{{user}}
- 当前地区（坐标之间相聚1:10km）：\${currentLocation}
- 当前日期：\${currentDate}

【历史参考】
- 上一份日报内容：\${previousDailyPaper}

【参考新闻】
- 本次重点参考内容：\${newsReference}

【剧情原文】
---
\${storyText}
---

【输出格式与技术栈】
1.  输出格式: 你的回答必须且只能包含一个包裹在 \`\`\`html 和 \`\`\` 之间的HTML代码块。不要有任何代码块之外的解释。
2.  内容: HTML内容必须是独立、完整的，可以直接在 <iframe srcdoc="..."> 中运行。
3.  技术栈: 使用HTML、CSS和JavaScript。不要引入任何外部库。

【核心规则】
1. 新闻内容准则
- 隐私保护: 严禁将玩家的私密行动作为新闻内容，除非该行动已被第三方公开或其影响已达到众所周知的程度。
- 信息来源: 新闻来源限定为“天下皆知”的传闻、宗门公告或官方公开消息。
- 报道焦点: 报纸内容不应围绕玩家，而应报道当前地区的重大事件、市场动态、各方势力消息等公共新闻。
- 数值真实性: 报道中涉及的所有具体数值（如数量、价格、人数等），必须严格来源于【剧情原文】或【参考新闻】。如果未提供相关数值，则不允许自行编撰或估算，应采用“一批”、“众多”、“些许”等模糊性描述替代。

2. 内容与布局指令
- 特大号外 (可选): 仅当参考新闻为足以震动世界的特大事件时创建。
- 头条头条 (必须): 创作一个头条版块，可来源于参考新闻或当前地区最重要新闻。
- 坐标专栏 (必须): 若新闻事件发生在具体的地点，必须创建一个<p><strong>坐标:</strong> [x,y]</p>坐标专栏。根据事件内容，从地图上估算一个大致的[x,y]坐标并输出。
- 快讯专栏 (必须): 创作 2-3 个专栏，标题与内容原创，如市场动态、宗门轶闻、奇珍异宝等。
- 八卦专栏 (必须): 创作轻松娱乐的小道消息，如村落灵狐化人报恩、仙子传闻怀孕、情妇偷情等。避免泄露玩家个人隐私及核心剧情机密。
- 投稿专栏(可选): 模拟NPC投稿内容，可包含小黄文、宗门广告、重金求子、招聘双修道侣等创意内容。内容可自由发挥，但不涉及玩家隐私或核心剧情泄露。
- 图标: 每个版块标题前从以下列表选择最合适的Emoji：🚨, 🍉, ✨, 📜, 💰, ⚔️, 🌿, 🐉, 🦊, 💌, 📝, 🗺️。

3. 悬赏板块规则
- **【强制】积分来源铁则**: 玩家积分的任何【增加】或【减少】都【必须】直接来源于【剧情原文】中明确描述的事件（例如“你完成了xx悬赏，获得xx积分”）。如果【剧情原文】没有提及任何与积分变动相关的内容，则玩家积分【必须】保持与【历史参考】中的上一份日报一致。
- 积分榜必须包含玩家: “赏金积分榜”中必须包含当前玩家 {{user}}。你【必须】根据【历史参考】中的上一份日报来决定玩家的初始积分。如果【历史参考】为空或找不到玩家积分，则玩家初始积分为0。然后，根据【剧情原文】中玩家是否完成悬赏任务，计算并更新积分。最终，在HTML中输出一个具体的【数字】，而不是占位符。
- 悬赏令积分必须精确: “悬赏令”中的积分数值必须明确来源于【剧情原文】或【参考新闻】。如果没有提供具体数值，则不允许显示积分。

4. 日期与更新判断
- 若剧情时间进入新的一天，创作全新日报。
- 若剧情仍在同一天，但无新的新闻事件，直接输出上一份日报的完整HTML。
- 若剧情仍在同一天，但出现新的参考新闻，根据新信息创作全新日报。
- 若剧情进入新的一天，但无参考新闻，自行创作符合云汀修行录世界观的日报。

5. 输出格式与风格
- 参考以下美化代码进行输出，包含三个核心按钮（日报/悬赏/夜间模式）。点击对应按钮可切换视图或模式。每个有具体地点的事件都必须包含坐标栏“<p><strong>坐标:</strong> [x,y]</p>”。

\`\`\`html
<div class="daily-paper-container">
    <div class="header">
        <h1 class="title">[地区]日报</h1>
        <p class="date">[日期]</p>
        <div class="view-toggle">
            <button class="toggle-btn active" data-view="daily-paper">日报</button>
            <button class="toggle-btn" data-view="bounty-view">悬赏</button>
        </div>
        <div class="theme-toggle">
            <button id="theme-toggle-btn" title="切换模式">🌙</button>
        </div>
    </div>
    <div class="main-content">
        <div id="daily-paper-view" class="view-content">
            <div class="news-item news-extra">
                <h2 class="section-title">🚨 号外！[号外标题]</h2>
                <p><strong>号外内容:</strong> [内容]</p>
                <p><strong>坐标:</strong> [x,y]</p>
            </div>
            <div class="news-item news-headline">
                <h2 class="section-title">✨ 头条：[头条标题]</h2>
                <p><strong>头条内容:</strong> [内容]</p>
                <p><strong>坐标:</strong> [x,y]</p>
            </div>
            <div class="columns-container">
                <div class="news-column">
                    <h3 class="section-title">📜 [专栏标题1]</h3>
                    <div class="column-item">
                        <h4>[子标题1.1]</h4>
                        <p><strong>子内容1.1:</strong> [内容]</p>
                        <p><strong>坐标:</strong> [x,y]</p>
                    </div>
                </div>
                <div class="news-column">
                    <h3 class="section-title">💰 [专栏标题2]</h3>
                    <div class="column-item">
                        <h4>[子标题2.1]</h4>
                        <p><strong>子内容2.1:</strong> [内容]</p>
                        <p><strong>坐标:</strong> [x,y]</p>
                    </div>
                </div>
                <div class="news-column">
                    <h3 class="section-title">🦊 八卦传闻</h3>
                    <div class="column-item">
                        <h4>[八卦标题1]</h4>
                        <p><strong>八卦内容1:</strong> [内容]</p>
                        <p><strong>坐标:</strong> [x,y]</p>
                    </div>
                </div>
                <div class="news-column">
                    <h3 class="section-title">📝 NPC投稿</h3>
                    <div class="column-item">
                        <h4>[投稿标题1]</h4>
                        <p><strong>投稿内容1:</strong> [内容]</p>
                        <p><strong>坐标:</strong> [x,y]</p>
                    </div>
                </div>
            </div>
        </div>
        <div id="bounty-view" class="view-content" style="display: none;">
            <div class="bounty-wrapper">
                <div class="bounty-column">
                    <h2 class="column-title">悬赏令</h2>
                    <div class="bounty-list">
                        <div class="bounty-item high-threat">
                            <h3>[姓名/称号] <span class="bounty-level">[境界]</span><span class="bounty-points">积分: [数值]</span></h3>
                            <p><strong>发布方:</strong> [宗门/势力]</p>
                            <p><strong>罪状:</strong> [详细描述罪行]</p>
                            <p><strong>悬赏:</strong> <span class="bounty-reward">[悬赏内容]</span></p>
                            <p><strong>坐标:</strong> [x,y]</p>
                        </div>
                    </div>
                </div>
                <div class="scoreboard-column">
                    <h2 class="column-title">赏金积分榜</h2>
                    <ol class="scoreboard-list">
                        <li><span class="rank-name">{{user}}</span><span class="rank-score">0</span></li>
                        <li><span class="rank-name">[代号2]</span><span class="rank-score">[总积分2]</span></li>
                    </ol>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
:root {
    --bg-color: #fdfcfa; --border-color: #e0ddc6; --text-color: #333;
    --header-border-color: #c9c3a5; --secondary-text-color: #666;
    --item-bg-color: #fff; --item-border-color: #eee; --dashed-border-color: #e0e0e0;
    --extra-title-color: #d9534f; --headline-title-color: #337ab7;
    --btn-bg-color: #f0f0f0; --btn-border-color: #ccc;
    --btn-active-bg-color: #007bff; --btn-active-color: white;
}
.dark-mode {
    --bg-color: #1a1a1a; --border-color: #444; --text-color: #e0e0e0;
    --header-border-color: #555; --secondary-text-color: #aaa;
    --item-bg-color: #2b2b2b; --item-border-color: #444; --dashed-border-color: #555;
    --btn-bg-color: #333; --btn-border-color: #555; --btn-active-bg-color: #0056b3;
}
* { box-sizing: border-box; }
.daily-paper-container {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.6; background: var(--bg-color); color: var(--text-color);
    border: 1px solid var(--border-color); padding: 20px; width: 100%; max-width: 100%;
    margin: 0; box-shadow: none; border-radius: 0;
    overflow: hidden; transition: background-color 0.3s, color 0.3s;
}
.header { text-align: center; border-bottom: 2px solid var(--header-border-color); padding-bottom: 15px; margin-bottom: 20px; position: relative; }
.title { margin: 0; font-size: 2.5em; }
.date { margin: 0; font-size: 1em; color: var(--secondary-text-color); }
.section-title { border-bottom: 1px solid var(--item-border-color); padding-bottom: 5px; margin-top: 0; }
.news-item, .news-column { background: var(--item-bg-color); border: 1px solid var(--item-border-color); padding: 15px; margin-bottom: 20px; border-radius: 4px; transition: background-color 0.3s, border-color 0.3s; }
.column-item:not(:last-child) { border-bottom: 1px dashed var(--dashed-border-color); margin-bottom: 10px; padding-bottom: 10px; }
h2.section-title, h3.section-title, h4 { font-weight: bold; }
p { margin: 0 0 10px 0; }
.news-extra h2.section-title { color: var(--extra-title-color); }
.news-headline h2.section-title { color: var(--headline-title-color); }
.view-toggle { position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; background: var(--bg-color); padding: 0 10px; transition: background-color 0.3s; }
.toggle-btn { padding: 5px 15px; border: 1px solid var(--btn-border-color); background-color: var(--btn-bg-color); color: var(--text-color); cursor: pointer; border-radius: 4px; font-size: 0.9em; transition: all 0.3s; }
.toggle-btn.active { background-color: var(--btn-active-bg-color); color: var(--btn-active-color); border-color: var(--btn-active-bg-color); }
.theme-toggle { position: absolute; top: 0px; right: 0px; }
#theme-toggle-btn { background: none; border: 1px solid var(--btn-border-color); border-radius: 50%; width: 36px; height: 36px; cursor: pointer; font-size: 1.3em; display: flex; align-items: center; justify-content: center; color: var(--text-color); transition: all 0.3s; }
#theme-toggle-btn:hover { background-color: var(--item-bg-color); }
.bounty-wrapper { display: flex; flex-wrap: wrap; gap: 20px; }
.bounty-column, .scoreboard-column { flex: 1; min-width: 300px; background: var(--item-bg-color); border: 1px solid var(--item-border-color); padding: 15px; border-radius: 8px; }
.column-title { text-align: center; border-bottom: 1px solid var(--item-border-color); padding-bottom: 10px; margin-bottom: 15px; }
.bounty-list, .scoreboard-list { list-style: none; padding: 0; margin: 0; }
.bounty-item { border: 1px solid var(--item-border-color); padding: 10px; margin-bottom: 10px; border-radius: 5px; background-color: var(--bg-color); }
.bounty-item h3 { margin-top: 0; margin-bottom: 5px; color: #d9534f; display: flex; justify-content: space-between; align-items: center; }
.bounty-level { font-size: 0.8em; background-color: #5bc0de; color: white; padding: 2px 8px; border-radius: 3px; }
.bounty-points { font-size: 0.9em; color: #5cb85c; }
.bounty-reward { font-weight: bold; color: #f0ad4e; }
.scoreboard-list li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed var(--dashed-border-color); }
.scoreboard-list li:last-child { border-bottom: none; }
.rank-name { font-weight: bold; }
.rank-score { color: #007bff; }
.columns-container { display: flex; flex-direction: column; gap: 20px; }
@media (min-width: 768px) {
    .columns-container { flex-direction: row; flex-wrap: wrap; align-items: flex-start; }
    .news-column { flex: 1 1 280px; margin-bottom: 0; }
}
</style>

<script>
document.addEventListener('DOMContentLoaded', function() {
    const container = document.querySelector('.daily-paper-container');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const viewToggleBtns = document.querySelectorAll('.toggle-btn');
    const dailyPaperView = document.getElementById('daily-paper-view');
    const bountyView = document.getElementById('bounty-view');
    themeToggleBtn.addEventListener('click', () => {
        container.classList.toggle('dark-mode');
        if (container.classList.contains('dark-mode')) {
            themeToggleBtn.textContent = '☀️';
        } else {
            themeToggleBtn.textContent = '🌙';
        }
    });

    viewToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            viewToggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const view = btn.getAttribute('data-view');
            dailyPaperView.style.display = view === 'daily-paper' ? 'block' : 'none';
            bountyView.style.display = view === 'bounty-view' ? 'block' : 'none';
        });
    });
});
<\/script>
\`\`\``;

// app.js 1670
        let theaterApiController = null;

// app.js 1678
        async function getPreviousDailyPapers(archiveName, count = 1) {
          if (!archiveName) return '这是本世界的第一份日报。';

          const archive = await db.archives.get(archiveName);
          if (!archive || !archive.data.logs) return '这是本世界的第一份日报。';

          // 筛选出所有含有日报 HTML 的日志
          const paperLogs = archive.data.logs.filter(log => log.dailyPaperHtml).reverse(); // 倒序，最新的在前

          if (paperLogs.length === 0) return '这是本世界的第一份日报。';

          // 获取前 count 个
          const targetLogs = paperLogs.slice(0, count);

          // 拼接内容，按时间顺序（旧 -> 新）拼接给 AI 更好理解
          const combinedContent = targetLogs
            .reverse()
            .map((log, index) => {
              // 清洗 markdown 标记
              const htmlMatch = log.dailyPaperHtml.match(/```html([\s\S]*?)```/);
              const cleanHtml = htmlMatch ? htmlMatch[1].trim() : log.dailyPaperHtml;

              return `【历史日报 ${index + 1}/${targetLogs.length} (时间: ${new Date(
                log.timestamp,
              ).toLocaleString()})】\n${cleanHtml}`;
            })
            .join('\n\n--------------------------------------------------\n\n');

          return combinedContent;
        }

// app.js 1709
        async function callAutomatedAITheater(
          storyText,
          newsReferenceContent,
          targetLogId,
          bypassGlobalLock = false,
          skipSave = false,
        ) {
          const frxScope = await FRX.captureScope();

          if (!bypassGlobalLock && isTheaterGenerating) return null;
          const isAutoGenEnabled = localStorage.getItem('theater_autoGenEnabled') === 'true';
          if (!bypassGlobalLock && (!isAutoGenEnabled || !currentArchiveName)) return null;

          // ---【核心修复】日期判定逻辑 ---
          // 1. 优先从 currentState (内存数据库) 获取时间，比 DOM 更稳定
          let rawTimeStr = '';
          if (currentState && currentState['4'] && currentState['4'][0]) {
            rawTimeStr = currentState['4'][0]['0'] || '';
          } else {
            // 兜底：如果内存未就绪，才读取 DOM
            rawTimeStr = document.getElementById('time-location-display')?.textContent || '';
          }

          // 2. 正则提取纯日期部分 (忽略时分秒)，并去除所有空格以防止格式误差
          // 匹配格式如：xxxx年xx月xx日
          const dateMatch = rawTimeStr.match(/(\d+年\s*\d+月\s*\d+日)/);
          const currentGameDate = dateMatch ? dateMatch[1].replace(/\s+/g, '') : 'UNKNOWN_DATE';
          const locationStart = rawTimeStr.indexOf('/');
          const currentLocation = locationStart >= 0 ? rawTimeStr.slice(locationStart + 1).trim() : '修仙界';

          // 3. 执行频率判定
          const autoGenFrequency = localStorage.getItem('theater_autoGenFrequency') || 'always';

          if (!bypassGlobalLock && autoGenFrequency === 'daily') {
            const lastGenDate = (localStorage.getItem('theater_lastGeneratedDate') || '').replace(/\s+/g, '');

            // 如果日期完全相同，且不是未知日期，则跳过
            if (lastGenDate === currentGameDate && currentGameDate !== 'UNKNOWN_DATE') {
              console.log(
                `[日报] 检测到周期设置为"每天"，当前日期 (${currentGameDate}) 与上次生成日期一致，本轮跳过。`,
              );
              return null;
            }
          }

          // 4. 执行每隔N轮的判定
          if (!bypassGlobalLock && autoGenFrequency === 'rounds') {
            const roundsInterval = parseInt(
              localStorage.getItem('theater_roundsInterval') || localStorage.getItem('theater_autoGenRounds'),
            ) || 3;
            const currentRoundCount = parseInt(localStorage.getItem('theater_roundsSinceLastGen')) || 0;

            if (currentRoundCount < roundsInterval - 1) {
              // 还没到间隔轮数，更新计数器并跳过
              localStorage.setItem('theater_roundsSinceLastGen', currentRoundCount + 1);
              console.log(
                `[日报] 检测到周期设置为"每隔${roundsInterval}轮"，当前已过 ${
                  currentRoundCount + 1
                } 轮，未到间隔，本轮跳过。`,
              );
              return null;
            } else {
              // 到达间隔轮数，重置计数器，继续执行
              localStorage.setItem('theater_roundsSinceLastGen', '0');
              console.log(`[日报] 检测到周期设置为"每隔${roundsInterval}轮"，已到达间隔，本轮生成日报。`);
            }
          }
          // ---------------------------

          const apiUrl = localStorage.getItem('theater_apiEndpoint');
          const apiKey = localStorage.getItem('theater_apiKey');
          const model = localStorage.getItem('theater_apiModel');
          if (!apiUrl || !apiKey || !model) return null;

          let statusDanmaku = null;
          let localController = new AbortController();
          const signal = localController.signal;

          try {
            if (!bypassGlobalLock) {
              isTheaterGenerating = true;
              theaterApiController = localController;
            }
            statusDanmaku = showDanmaku('AI正在撰写日报...', 'status', localController, true);

            const stateSnapshotString = generatePrettySnapshotForAI();
            const geographyContext = generateGeographyString();
            const historyCount = parseInt(localStorage.getItem('theater_historyCount')) || 1;
            const previousDailyPapersContent = await getPreviousDailyPapers(currentArchiveName, historyCount);

            let worldFactorsContext = '无';
            if (typeof getWorldFactorsContext === 'function') worldFactorsContext = await getWorldFactorsContext();

            const textForKeywordSearch = storyText + ' ' + (newsReferenceContent || '');
            const globalAddons =
              typeof getGlobalWbContextAddons === 'function'
                ? await getGlobalWbContextAddons('daily_paper', textForKeywordSearch)
                : {};

            let theaterWorldBookContext = '';
            if (typeof getTheaterWorldBookContext === 'function')
              theaterWorldBookContext = await getTheaterWorldBookContext(textForKeywordSearch);

            let lastUserInput = '无';
            if (globalAddons.user_input_after) lastUserInput = globalAddons.user_input_after;

            let previousStateContext = '无上一轮交互记录';
            try {
              const arc = await FRX.getArchive(frxScope);
              if (arc && arc.data.logs && arc.data.logs.length > 0) {
                const lastLogWithState = [...arc.data.logs]
                  .reverse()
                  .find(l => l.dailyPaperState && Object.keys(l.dailyPaperState).length > 0 && l.id !== targetLogId);

                if (lastLogWithState) {
                  previousStateContext = JSON.stringify(lastLogWithState.dailyPaperState, null, 2);
                  console.log('【日报状态传递】成功提取上一轮状态:', previousStateContext);
                }
              }
            } catch (e) {
              console.warn('提取上一轮日报状态失败:', e);
            }

            const presetsData = await dbGet('CULTIVATION_DAILY_PAPER_PRESETS_V1');
            const activePreset = presetsData?.presets?.find(p => p.id === presetsData.activePresetId);
            if (!activePreset) throw new Error('未找到预设配置');

            let messages = [];
            const activeRules = activePreset.rules.filter(r => r.enabled !== false);

            activeRules.forEach(rule => {
              // 绿灯关键词检测
              let isTriggered = false;
              if (rule.triggerMode === 'blue' || !rule.triggerMode) {
                isTriggered = true;
              } else if (rule.triggerMode === 'green') {
                const keywords = rule.keywords || [];
                const foundKeyword = keywords.find(kw => textForKeywordSearch.includes(kw));
                if (foundKeyword) {
                  isTriggered = true;
                  console.log(`[日报] 绿灯规则 "${rule.name}" 被关键词 "${foundKeyword}" 触发`);
                }
              }

              if (!isTriggered) return; // 未触发则跳过

              let content = rule.content
                .replace(/\$\{storyText\}/g, storyText)
                .replace(/\$\{newsReference\}/g, newsReferenceContent || '无')
                .replace(/\$\{previousDailyPaper\}/g, previousDailyPapersContent)
                .replace(/\$\{lastDailyPaperState\}/g, previousStateContext)
                .replace(/\$\{previousDailyPaperState\}/g, previousStateContext)
                .replace(/\$\{currentDate\}/g, currentGameDate)
                .replace(/\$\{currentLocation\}/g, currentLocation)
                .replace(/\$\{worldGeography\}/g, geographyContext)
                .replace(/\$\{world_factors\}/g, worldFactorsContext)
                .replace(/\$\{world_book_context\}/g, theaterWorldBookContext)
                .replace(/\$\{state_snapshot\}/g, stateSnapshotString)
                .replace(/\$\{playerSnapshot\}/g, stateSnapshotString)
                .replace(/\$\{user_input\}/g, lastUserInput);

              for (const [key, value] of Object.entries(globalAddons)) {
                content = content.split(key).join(value);
              }
              messages.push({
                role: rule.role || 'system',
                content,
              });
            });

            const aiResponse = await genericApiCallStream(apiUrl, apiKey, model, messages, signal, false, null);
await FRX.assertScope(frxScope);
            latestDailyPaperResponse = aiResponse;

            let cleanResponse = aiResponse
              .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .trim();

            let matchedTemplate = findBestMatchingTemplate(activePreset, cleanResponse);
            let finalHtml = '';

            if (matchedTemplate && matchedTemplate.content) {
              try {
                if (typeof renderAirpTemplate === 'function') {
                  finalHtml = renderAirpTemplate(matchedTemplate.content, cleanResponse);
                } else {
                  finalHtml = extractHtmlFromAiResponse(cleanResponse);
                }
              } catch (e) {
                finalHtml = extractHtmlFromAiResponse(cleanResponse);
              }
            } else {
              finalHtml = extractHtmlFromAiResponse(cleanResponse);
            }

            if (!finalHtml || finalHtml.trim().length === 0) {
              finalHtml = `<div style="padding:20px; color:#ddd; white-space:pre-wrap;">${cleanResponse}</div>`;
            }

            lastDailyPaperContent = finalHtml;
            const htmlCodeForStorage = '```html\n' + finalHtml + '\n```';

            // --- 【修复】生成成功后，更新缓存的日期 ---
            if (localStorage.getItem('theater_autoGenFrequency') === 'daily') {
              localStorage.setItem('theater_lastGeneratedDate', currentGameDate);
              console.log(`[日报] 日期已更新缓存: ${currentGameDate}`);
            }

            let mapEvents = [];
            try {
              if (typeof extractMapEventsFromHtml === 'function') {
                mapEvents = extractMapEventsFromHtml(finalHtml);
              }
            } catch (e) {}

            if (!skipSave && targetLogId && currentArchiveName) {
              try {
                const archive = await FRX.getArchive(frxScope);
                if (archive && archive.data.logs) {
                  const previousPaperLog = [...archive.data.logs]
                    .reverse()
                    .find(l => l.dailyPaperHtml && l.id !== targetLogId);
                  if (previousPaperLog) {
                    previousPaperLog.dailyPaperHtml = cleanDailyPaperImages(previousPaperLog.dailyPaperHtml);
                    if (archive.data.state && archive.data.state.latestDailyPaper === previousPaperLog.dailyPaperHtml) {
                      archive.data.state.latestDailyPaper = previousPaperLog.dailyPaperHtml;
                    }
                  }
                  const log = archive.data.logs.find(l => l.id === targetLogId);
                  if (log) {
                    log.dailyPaperHtml = htmlCodeForStorage;
                    log.mapEvents = mapEvents;
                    if (!archive.data.state) archive.data.state = {};
                    archive.data.state.latestDailyPaper = htmlCodeForStorage;
                    archive.data.state.activeTheaterHTML = finalHtml;
                    await db.archives.put(archive, {scope: frxScope});
                    console.log('✅ [自动日报] 内容已单独同步到数据库，并清理了旧图');
                  }
                }
              } catch (e) {
                console.error('❌ [自动日报] 保存失败:', e);
              }
            } else if (skipSave) {
              console.log('🚀 [并行模式] 日报生成完毕，跳过单独保存，等待主线程合并。');
            }

            if (statusDanmaku) statusDanmaku.remove();
            showDanmaku('日报生成完成！', 'success');

            return {
              dailyPaperHtml: htmlCodeForStorage,
              mapEvents: mapEvents,
              activeTheaterHTML: finalHtml,
            };
          } catch (error) {
            if (error.name !== 'AbortError') {
              console.error('自动日报失败:', error);
              showDanmaku(`日报失败: ${error.message}`, 'error');
            }
            return null;
          } finally {
            if (statusDanmaku && statusDanmaku.parentNode) statusDanmaku.remove();
            if (!bypassGlobalLock) {
              isTheaterGenerating = false;
              theaterApiController = null;
            }
          }
        }

// app.js 1997
        function findBestMatchingTemplate(preset, cleanedText) {
          if (!preset || !preset.templates) return null;

          console.group(`%c[模具匹配调试] 开始匹配...`, 'color: #4fc3f7');

          // 1. 尝试从文本中解析 <<<TEMPLATE>>> 的值 (AI指定)
          const templateMatch = cleanedText.match(/<<<TEMPLATE>>>\s*(.+?)(?=\s*(?:<<<|$))/i);
          let targetKeyword = null;

          if (templateMatch && templateMatch[1]) {
            targetKeyword = templateMatch[1].trim();
            console.log(`[模具匹配] AI显式指定关键词: "${targetKeyword}"`);
          }

          // 2. 如果AI显式指定了模具，优先且仅通过AI指定的关键词匹配
          if (targetKeyword) {
            for (const t of preset.templates) {
              if (t.keywords && t.keywords.trim()) {
                const configKeys = t.keywords
                  .split(/[,，]/)
                  .map(k => k.trim())
                  .filter(k => k);
                const matchByTag = configKeys.some(k => targetKeyword.includes(k));

                if (matchByTag) {
                  console.log(`%c[模具匹配] ✅ AI指定关键词命中!`, 'color: #66bb6a; font-weight: bold');
                  console.log(`- 模具名: ${t.name}`);
                  console.log(`- 自动弹出: ${t.autoPopup}`);
                  console.groupEnd();
                  return t;
                }
              }
            }
            console.warn(`[模具匹配] AI指定了关键词 "${targetKeyword}"，但未找到匹配的模具`);
          }

          // 3. 如果AI没有指定模具，则通过正文内容匹配触发词
          if (!targetKeyword) {
            for (const t of preset.templates) {
              if (t.keywords && t.keywords.trim()) {
                const configKeys = t.keywords
                  .split(/[,，]/)
                  .map(k => k.trim())
                  .filter(k => k);
                const matchByContent = configKeys.some(k => cleanedText.includes(k));

                if (matchByContent) {
                  console.log(`%c[模具匹配] ✅ 正文内容命中关键词!`, 'color: #66bb6a; font-weight: bold');
                  console.log(`- 模具名: ${t.name}`);
                  console.log(`- 自动弹出: ${t.autoPopup}`);
                  console.groupEnd();
                  return t;
                }
              }
            }
          }

          // 4. 兜底：使用用户手动选中的激活模具
          if (preset.activeTemplateId) {
            const activeItem = preset.templates.find(t => t.id === preset.activeTemplateId);
            if (activeItem) {
              console.log(`%c[模具匹配] ⚠️ 无关键词，使用默认选中模具`, 'color: #ffd700');
              console.log(`- 模具名: ${activeItem.name}`);
              console.log(`- 自动弹出: ${activeItem.autoPopup}`);
              console.groupEnd();
              return activeItem;
            } else {
              console.warn(`[模具匹配] ID为 ${preset.activeTemplateId} 的默认模具在列表中找不到！`);
            }
          } else {
            console.log(`[模具匹配] 未设置默认模具 (activeTemplateId 为空)`);
          }

          console.log(`%c[模具匹配] ❌ 未匹配到任何模具`, 'color: #e57373');
          console.groupEnd();
          return null;
        }

// app.js 2188
        async function getWorldFactorsContext() {
          if (!currentArchiveName) return '无世界因子';
          const archive = await db.archives.get(currentArchiveName);
          const firstLog = archive?.data?.logs?.[0];
          let worldFactorsContext = '无世界因子';

          if (firstLog && firstLog.content) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = firstLog.content;
            const summaries = tempDiv.querySelectorAll('details summary');
            let factorList = null;

            for (const summary of summaries) {
              if (summary.textContent.includes('世界规则变动')) {
                const parentDetails = summary.parentElement;
                if (parentDetails) {
                  factorList = parentDetails.querySelector('ul');
                }
                break;
              }
            }

            if (factorList) {
              const listItems = factorList.querySelectorAll('li');
              if (listItems.length > 0) {
                worldFactorsContext = Array.from(listItems)
                  .map(li => li.textContent.replace(/\s+/g, ' ').trim())
                  .join('\n');
              }
            }
          }
          return worldFactorsContext;
        }

// app.js 2543
        function extractMapEventsFromHtml(htmlString) {
          if (!htmlString) return [];

          const events = [];
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = htmlString;

          const newsTypeConfig = {
            'news-extra': { icon: '🚨', color: '#d9534f' },
            'news-headline': { icon: '✨', color: '#337ab7' },
            'news-coordinate': { icon: '🗺️', color: '#5cb85c' },
            'news-column': { icon: '📜', color: '#5bc0de' },
            'bounty-item': { icon: '💰', color: '#f0ad4e' },
            default: { icon: '📍', color: '#888' },
          };

          const coordinateElements = tempDiv.querySelectorAll('p, .bounty-item');

          coordinateElements.forEach(el => {
            const elHtml = el.innerHTML;
            const coordsMatch = elHtml.match(/坐标:<\/strong>\s*(\d+),\s*(\d+)/);

            if (coordsMatch) {
              try {
                const x = parseInt(coordsMatch[1], 10);
                const y = parseInt(coordsMatch[2], 10);

                if (isNaN(x) || isNaN(y)) return;

                let icon = newsTypeConfig.default.icon;
                let color = newsTypeConfig.default.color;
                let eventTitle = `事件 [${x},${y}]`;
                let eventContent = el.innerHTML;

                const newsItemContainer = el.closest('.news-item, .column-item, .bounty-item');

                if (newsItemContainer) {
                  for (const key in newsTypeConfig) {
                    if (newsItemContainer.classList.contains(key)) {
                      icon = newsTypeConfig[key].icon;
                      color = newsTypeConfig[key].color;
                      break;
                    }
                  }

                  const sectionTitleEl = newsItemContainer.querySelector('h2.section-title, h3.section-title, h3, h4');
                  if (sectionTitleEl) {
                    const titleText = sectionTitleEl.textContent.trim();
                    const iconMatch = titleText.match(/(\p{Emoji})/u);
                    if (iconMatch) {
                      icon = iconMatch[1];
                    }
                    eventTitle = titleText.replace(/(\p{Emoji})\s*/u, '');
                  }

                  const clonedContainer = newsItemContainer.cloneNode(true);
                  const coordsParagraphs = clonedContainer.querySelectorAll('p');
                  coordsParagraphs.forEach(p => {
                    if (p.textContent.includes('坐标:')) {
                      p.remove();
                    }
                  });
                  eventContent = clonedContainer.innerHTML;
                } else {
                  const strongTag = el.querySelector('strong');
                  if (strongTag) {
                    eventTitle = strongTag.textContent.trim().replace(':', '');
                  }
                }

                const existingEvent = events.find(e => e.coords[0] === x && e.coords[1] === y);
                if (!existingEvent) {
                  events.push({
                    icon: icon,
                    color: color,
                    coords: [x, y],
                    title: eventTitle,
                    text: eventContent,
                  });
                }
              } catch (e) {
                console.warn('解析日报坐标时出错:', e);
              }
            }
          });

          return events;
        }

// app.js 8693
        let latestDailyPaperResponse = '';

// app.js 13831
        async function getTheaterWorldBookContext(textToSearchIn = '') {
          const worldBooks = (await dbGet(THEATER_WORLDBOOKS_KEY)) || [];
          
          // 获取来自酒馆应用的世界书条目
          const presetsData = (await dbGet(DAILY_PAPER_PRESETS_KEY)) || {};
          const stWorldBooks = presetsData.theaterWorldBooks || [];

          const allEntries = [...worldBooks, ...stWorldBooks];
          const activeEntries = allEntries.filter(wb => wb.enabled !== false);

          if (activeEntries.length === 0) {
            return '';
          }

          let triggeredContent = [];
          activeEntries.forEach(entry => {
            if (!entry || !entry.content) return;

            let isTriggered = false;
            if (entry.triggerMode === 'blue') {
              isTriggered = true;
            } else if (entry.triggerMode === 'green') {
              if ((entry.keywords || []).some(kw => textToSearchIn.includes(kw))) {
                isTriggered = true;
              }
            }

            if (isTriggered) {
              triggeredContent.push(`### 世界书: ${entry.name}\n${entry.content}`);
            }
          });

          if (triggeredContent.length > 0) {
            return `### 世界书参考资料 ###\n${triggeredContent.join('\n\n---\n\n')}\n---`;
          }
          return '';
        }

// app.js 14111
        async function _internalRunWorldEvolution(
          force = false,
          storyTextForReroll = null,
          biographiesForReroll = null,
        ) {
          const frxScope = await FRX.captureScope();

          console.log('开始执行世界演化检查...');

          const worldEvolutionConfig = (await dbGet(WORLD_EVOLUTION_API_CONFIG_KEY)) || {};
          if (!force && !worldEvolutionConfig.enabled) {
            console.log('世界演化未启用，跳过。');
            return null;
          }

          const apiConfigToUse = {
            apiUrl: worldEvolutionConfig.apiUrl,
            apiKey: worldEvolutionConfig.apiKey,
            apiModel: worldEvolutionConfig.apiModel,
          };
          if (
            worldEvolutionConfig.enabled &&
            (!apiConfigToUse.apiUrl || !apiConfigToUse.apiKey || !apiConfigToUse.apiModel)
          ) {
            if (force) await showCustomAlert('API配置不完整，请在世界演化设置中检查。');
            return null;
          }

          if (!currentArchiveName) {
            if (force) await showCustomAlert('世界演化失败：需要先加载一个存档。');
            return null;
          }

          const presetsData = await dbGet(WORLD_EVOLUTION_PRESETS_KEY);
          const activePreset = presetsData?.presets?.find(p => p.id === presetsData.activePresetId);
          if (!activePreset || !activePreset.rules || activePreset.rules.length === 0) {
            if (force) await showCustomAlert('未配置有效的演化规则。');
            return null;
          }

          const archive = await FRX.getArchive(frxScope);
          if (!archive) return null;

          let allKnownBios;
          if (biographiesForReroll) {
            allKnownBios = biographiesForReroll;
            console.log('使用重roll传入的传记数据进行演化。');
          } else {
            const lastLogWithBio = [...archive.data.logs]
              .reverse()
              .find(
                log =>
                  log.biographySnapshot && Array.isArray(log.biographySnapshot) && log.biographySnapshot.length > 0,
              );

            if (!lastLogWithBio && !archive.data.state.worldBookEntries) {
              if (force) await showCustomAlert('找不到人物传记数据，无法确定演化对象。');
              return null;
            }
            allKnownBios = lastLogWithBio
              ? lastLogWithBio.biographySnapshot
              : archive.data.state.worldBookEntries || [];
          }

          const onScreenIds = new Set();
          if (typeof currentState !== 'undefined' && currentState['0']) {
            Object.keys(currentState['0']).forEach(key => {
              if (key !== 'B1') {
                onScreenIds.add(key);
              }
            });
          }

          const focusList = (currentState.state && currentState.state.worldEvolutionFocusList) || [];
          const forceList = (currentState.state && currentState.state.worldEvolutionForceList) || [];
          let evolutionTargets;

          if (focusList.length > 0) {
            evolutionTargets = allKnownBios.filter(bio => {
              const isChar = bio.type === '人物' || !bio.type;
              const isFocused = focusList.includes(bio.key);
              const isForced = forceList.includes(bio.key);
              const isOnScreen = onScreenIds.has(bio.key);

              // 逻辑：
              // 1. 如果在强制单独演化列表中 (isForced)，无论是否在场都加入
              // 2. 如果在关注列表中 (isFocused)，且不在场 (!isOnScreen)，加入
              // 3. 必须是人物类型
              if (!isChar) return false;
              if (isForced) return true;
              if (isFocused && !isOnScreen) return true;
              return false;
            });

            if (evolutionTargets.length > 0) {
              showDanmaku(
                `检测到关注/单独演化列表，本次演化 ${evolutionTargets.length} 个目标 (含 ${
                  evolutionTargets.filter(b => forceList.includes(b.key)).length
                } 个强制演化)。`,
                'info',
              );
            }
          }

          if (!evolutionTargets || evolutionTargets.length === 0) {
            evolutionTargets = allKnownBios.filter(bio => {
              const isChar = bio.type === '人物' || !bio.type;
              const isForced = forceList.includes(bio.key);
              const isOnScreen = onScreenIds.has(bio.key);

              // 逻辑：
              // 1. 如果在强制单独演化列表中 (isForced)，无论是否在场都加入
              // 2. 否则，必须不在场 (!isOnScreen)
              if (!isChar) return false;
              if (isForced) return true;
              return !isOnScreen;
            });
          }

          if (evolutionTargets.length === 0) {
            if (force) await showCustomAlert('没有需要后台演化的目标。已取消演化。');
            console.log('无演化目标，演化终止。');
            return null;
          }

          const controller = new AbortController();
          let statusDanmaku = showDanmaku(
            `后台世界演化中... [${evolutionTargets.length}人]`,
            'status',
            controller,
            true,
          );

          const firstLog = archive.data.logs?.[0];
          let worldFactorsContext = '无世界因子';
          if (firstLog && firstLog.content && firstLog.content.includes('世界规则变动')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = firstLog.content;
            const factorList = tempDiv.querySelector('details[open] > ul, details > ul');
            if (factorList) {
              const listItems = factorList.querySelectorAll('li');
              if (listItems.length > 0) {
                worldFactorsContext = Array.from(listItems)
                  .map(li => li.textContent.replace(/\s+/g, ' ').trim())
                  .join('\n');
              }
            }
          }

          try {
            let currentTimeString = '未知时间';
            if (currentState['4'] && currentState['4'][0]) {
              currentTimeString = (currentState['4'][0]['0'] || '').split('/')[0];
            }

            const playerSnapshot = getSingleCharacterSnapshot('B1', currentState) || '玩家数据缺失';

            const worldEventsLogs = (archive.data.logs || [])
              .filter(log => log.content.startsWith('[世界大事]'))
              .slice(-5)
              .map(log => log.content)
              .join('\n');
            const latestDailyPaper = lastDailyPaperContent ? extractMainContent(lastDailyPaperContent) : '暂无';
            const worldGeography = generateGeographyString();
            const storyText = storyTextForReroll || lastAiStoryText || '（本次无新剧情文本，仅进行后台演化）';

            const onScreenNpcListString =
              Object.values(currentState['0'])
                .filter(c => c['0'] !== 'B1')
                .map(c => c['1']?.split('|')[0] || c['0'])
                .join(', ') || '无';

            const getBaseMessages = snapshotContext => {
              const presetRules = activePreset.rules.filter(r => r.enabled !== false);
              const configRules = worldEvolutionConfig.worldBookEntries || [];
              const evolutionRules = [...presetRules, ...configRules];

              const messages = [];
              const sectDataContext = '无宗门数据';
              evolutionRules.forEach(rule => {
                const processedContent = rule.content
                  .replace(/\$\{characterSnapshots\}/g, snapshotContext)
                  .replace(/\$\{characterBiography\}/g, snapshotContext)
                  .replace(/\$\{playerSnapshot\}/g, playerSnapshot)
                  .replace(/\$\{onScreenNpcList\}/g, onScreenNpcListString)
                  .replace(/\$\{storyText\}/g, storyText)
                  .replace(/\$\{latestDailyPaper\}/g, latestDailyPaper)
                  .replace(/\$\{worldEvents\}/g, worldEventsLogs || '近期无大事发生')
                  .replace(/\$\{currentTime\}/g, currentTimeString)
                  .replace(/\$\{timeSinceLastEvolution\}/g, `上次演化游戏时间：${archive.data.state.evolutionRuns?.at(-1)?.gameTime || '首次演化，无已知间隔'}；本次游戏时间：${currentTimeString}。仅推演与主线相同的时间段，没有依据时只描写短时进展。`)
                  .replace(/\$\{worldGeography\}/g, worldGeography)
                  .replace(/\$\{world_factors\}/g, worldFactorsContext)
                  .replace(/\$\{sectData\}/g, sectDataContext);

                const lastMessage = messages.length > 0 ? messages.length - 1 : null;
                const currentRole = rule.role || 'system';

                if (lastMessage && messages[lastMessage].role === currentRole) {
                  messages[lastMessage].content += `\n${processedContent}`;
                } else {
                  messages.push({ role: currentRole, content: processedContent });
                }
              });
              return messages;
            };

            let allApiResponses = [];

            if (worldEvolutionConfig.useBatchProcessing && worldEvolutionConfig.batchSize > 0) {
              const chunks = [];
              for (let i = 0; i < evolutionTargets.length; i += worldEvolutionConfig.batchSize) {
                chunks.push(evolutionTargets.slice(i, i + worldEvolutionConfig.batchSize));
              }

              if (statusDanmaku) statusDanmaku.remove();
              statusDanmaku = showDanmaku(`世界演化中... 分批处理 [${chunks.length}批]`, 'status', controller, true);

              const apiPromises = chunks.map((chunk, index) => {
                const snapshotContext = chunk.map(bio => bio.content).join('\n\n---\n\n');
                const messages = getBaseMessages(snapshotContext);

                console.groupCollapsed(`[演化日志] Batch ${index + 1}/${chunks.length}`);
                console.log(`Processing NPCs: ${chunk.map(c => c.title).join(', ')}`);
                console.log('Sent Messages:', JSON.parse(JSON.stringify(messages)));
                console.groupEnd();

                return genericApiCall(
                  apiConfigToUse.apiUrl,
                  apiConfigToUse.apiKey,
                  apiConfigToUse.apiModel,
                  messages,
                  controller.signal,
                );
              });

              allApiResponses = await Promise.all(apiPromises);
            } else {
              const snapshotContexts = evolutionTargets.map(bio => bio.content).join('\n\n---\n\n');
              const messages = getBaseMessages(snapshotContexts);

              console.groupCollapsed('[演化日志] Single Batch Request');
              console.log(`Processing NPCs: ${evolutionTargets.map(c => c.title).join(', ')}`);
              console.log('Sent Messages:', JSON.parse(JSON.stringify(messages)));
              console.groupEnd();

              const fullResponse = await genericApiCall(
                apiConfigToUse.apiUrl,
                apiConfigToUse.apiKey,
                apiConfigToUse.apiModel,
                messages,
                controller.signal,
              );
await FRX.assertScope(frxScope);
              allApiResponses = [fullResponse];
            }

            latestWorldEvolutionResponse = allApiResponses
              .map((resp, i) => `--- Batch ${i + 1} Response ---\n${resp || '此批次无响应'}`)
              .join('\n\n');

            if (statusDanmaku) statusDanmaku.remove();
            statusDanmaku = showDanmaku('演化完成，正在整合数据...', 'status', null, true);

            const committed = await FRXRequest('/evolution/commit', 'POST', {
              scope: frxScope,
              raw: allApiResponses.join('\n\n'),
              targets: evolutionTargets.map(bio => bio.key),
              expected_biographies: archive.data.state.worldBookEntries || [],
              source_biographies: allKnownBios,
              origin_state: archive.data.state.currentState,
            });
            await FRX.receiveArchive(committed.value);
            showDanmaku('世界演化与人物履历已保存', 'success');
            return committed.value.data.state.worldBookEntries;
          } catch (e) {
            if (e.name === 'AbortError') {
              console.log('世界演化被用户取消。');
            } else {
              const errorMsg = e.message || '未知错误';
              if (force) await showCustomAlert(`世界演化失败: ${errorMsg}`);
              showDanmaku(`世界演化失败: ${errorMsg}`, 'error');
            }
            return null;
          } finally {
            if (statusDanmaku) statusDanmaku.remove();
          }
        }

// app.js 15046
              const defaultRule = {
                id: 'default-evolution-rule',
                name: '默认演化规则',
                enabled: true,
                role: 'user',
                triggerMode: 'blue',
                keywords: [],
                content: `# 角色：世界意志 - 后台演化模块\n\n## 核心使命\n你的任务是模拟所有不在玩家当前场景中的NPC（即离场NPC）的后台活动。你需要决定他们在玩家看不见的时候经历了什么，并以两种形式反馈你的演化结果：**数据指令**和**剧情摘要**。\n\n1.  **数据变更 (\`<upstore>\`指令块)**：你必须像“变量思考”模块一样，生成精确的指令来更新这些NPC的属性、物品、状态等。这是演化的核心。\n2.  **剧情摘要 (JSON数组)**：你还需要为每个发生变化的NPC生成一段简洁的“人生履历”作为文本记录。\n\n**【至高指令】** 你的输出必须严格包含\`<upstore>\`指令块**和**剧情摘要的JSON数组。两者缺一不可，且指令必须与剧情摘要内容完全对应。\n\n---\n## 参考资料\n### 1. 世界背景\n- 玩家快照: \${playerSnapshot}\n- 本次剧情原文: \${storyText}\n- 世界地理: \${worldGeography}\n- 最新日报: \${latestDailyPaper}\n- 近期大事: \${worldEvents}\n- 当前时间: \${currentTime}\n\n### 2. 待处理的NPC数据快照\n\${characterSnapshots}\n\n---\n## 你的任务与思考流程\n\n### 1. 扫描与确认\n对于每一个NPC，首先扫描其快照数据，确认其当前的境界、资产（尤其是灵石）、状态和人际关系。\n\n### 2. 构建逻辑链并演化行为\n为每个NPC构建一个**【长期目标 → 短期动机 → 当前行动】**的逻辑链条，并基于此推演其行动。\n\n- **逻辑性**: NPC的行为必须符合其性格、身份和当前动机。一个谨慎的散修不会无故挑衅大宗门弟子；一个被魔头追杀的角色，其首要行动是逃亡或寻求庇护，而不是逛坊市。\n- **动态性**: 不是所有NPC都在闭关修炼。他们可能会进行交易、社交、探险、炼丹炼器、或是卷入地方冲突。\n- **时间跨度**: 根据当前时间与上次演化时间的间隔，决定演化的粒度。\n  - **短时间（数日/数月）**: 推演一到两个具体事件。\n  - **长时间（数年/数十年）**: 生成一段包含多个关键转折点的“阶段性人生履历”。履历需要丰富多彩，包含修炼、战斗、情感、探索、经营等多维度事件。\n\n### 3. 输出格式（必须严格遵守）\n\n你的回复必须分成泾渭分明的两部分。\n\n**第一部分：\`<upstore>\` 指令块**\n此部分包含所有的数据修改指令，用空格分隔。你必须使用与“变量思考”完全相同的指令集（如 \`add\`, \`set\`, \`de\`, \`updateAttribute\` 等）来反映NPC的变化。\n\n**第二部分：剧情摘要JSON数组**\n此部分是一个标准的JSON数组，每个对象代表一个NPC的新经历。\n\n---\n## 输出格式示例\n\n<upstore>\nadd("C2", {"2":"结丹中期|银栖阁长老", "10":"在一次闭关后，她成功突破至结丹中期，宗门地位也随之提升。"}) updateAttribute("C2", "法力", {"max": 9500})\nadd("C5", {"4":"身负重伤", "15":"-5"}) de("I7")\n</upstore>\n\n\`\`\`json\n[\n  {\n    "title": "闻青岑",\n    "new_entry": "闭关一月，在消耗了数瓶丹药后，闻青岑成功突破瓶颈，修为从结丹初期稳步迈入中期。出关后，宗门因其修为精进而将其擢升为内门长老。（当前动机：稳固境界，处理宗门事务。收支：消耗养元丹x3）(\${currentTime})"\n  },\n  {\n    "title": "贾天龙",\n    "new_entry": "在野外寻宝时不幸遭遇一头三级顶阶妖兽，虽拼死逃脱，但本命法宝“金砖”被毁，自身也身负重伤，对偶遇却未出手相助的玩家心生怨恨。（当前动机：寻找安全之地疗伤。收支：损失法宝-金砖）(\${currentTime})"\n  }\n]\n\`\`\``,
              };

// app.js 17664
        function chunkText(text, maxLength, mode = 'normal') {
          text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
          const chunks = [];

          // 内部切分逻辑
          const subSplit = (longText, limit, prefix = '') => {
            const subResult = [];
            let current = '';
            const paragraphs = longText.split('\n');

            for (const para of paragraphs) {
              const cleanPara = para.trim();
              if (!cleanPara) continue;

              if (current.length + cleanPara.length > limit) {
                if (current) {
                  subResult.push(prefix + current.trim());
                  current = '';
                }
                if (cleanPara.length > limit) {
                  let tempPara = cleanPara;
                  while (tempPara.length > 0) {
                    let cutIndex = Math.min(limit, tempPara.length);
                    const lastPunc = tempPara.substring(0, cutIndex).matchLast(/[。！？]/);
                    if (lastPunc && lastPunc.index > limit * 0.7) {
                      cutIndex = lastPunc.index + 1;
                    }
                    subResult.push(prefix + tempPara.substring(0, cutIndex));
                    tempPara = tempPara.substring(cutIndex);
                  }
                } else {
                  current = cleanPara;
                }
              } else {
                current += (current ? '\n' : '') + cleanPara;
              }
            }
            if (current) subResult.push(prefix + current.trim());
            return subResult;
          };

          // === 小说模式 ===
          if (mode === 'novel') {
            console.log(`[Chunk] 小说模式。限制长度: ${maxLength}`);
            const chapterRegex =
              /(?:^|\n)\s*(第\s*[0-9０１２３４５６７８９一二三四五六七八九十百千万零]+\s*[章回节卷][^\n]*)/g;
            const parts = text.split(chapterRegex);

            if (parts[0].trim()) {
              chunks.push({ title: '【序章/简介】', text: parts[0].trim() });
            }

            for (let i = 1; i < parts.length; i += 2) {
              const title = parts[i].trim();
              const content = parts[i + 1] || '';
              const fullChapterText = `【${title}】\n${content.trim()}`;

              const SAFE_LIMIT = Math.floor(maxLength * 1.5);

              if (fullChapterText.length <= SAFE_LIMIT) {
                chunks.push({ title: title, text: fullChapterText });
              } else {
                const subChunks = subSplit(content, maxLength, `【${title}】\n`);
                subChunks.forEach((subTxt, idx) => {
                  chunks.push({
                    title: `${title} (${idx + 1})`,
                    text: subTxt,
                  });
                });
              }
            }

            if (chunks.length === 0 && text.trim().length > 0) {
              return subSplit(text, maxLength);
            }
            return chunks;
          }

          // === 普通模式 ===
          return subSplit(text, maxLength);
        }

// app.js 21439
        async function commitVectorArchiveEntry(entry, embedConfig, frxScope, timestamp) {
          await FRX.assertScope(frxScope);
          if (!entry.prepared) {
            const embeddings = await fetchEmbedding(entry.textsToEmbed, embedConfig);
            if (!embeddings || embeddings.length !== entry.contentChunks.length) {
              throw new Error('嵌入数量不完整，原记忆已保留');
            }
            entry.prepared = {
              scope: frxScope,
              batch_id: crypto.randomUUID(),
              timestamp,
              retirements: entry.retirements || [],
              additions: entry.contentChunks.map((content, index) => ({
                source: entry.folderName,
                uuid: crypto.randomUUID(),
                baseTitle: entry.title,
                title: `${entry.title}${entry.contentChunks.length > 1 ? ` (${index + 1}/${entry.contentChunks.length})` : ''}`,
                content,
                vector: embeddings[index],
                timestamp,
                metadata: entry.metadata,
                scope: 'archive',
                archiveId: frxScope.archive_id,
                frxSource: {
                  archiveId: frxScope.archive_id,
                  logIds: [...new Set([
                    ...(entry.retirements || []).flatMap(old => old.frxSource?.logIds || []),
                    ...(frxScope.log_id ? [frxScope.log_id] : []),
                  ])],
                  speaker: entry.metadata?.speaker || '旁白',
                },
              })),
            };
          }
          await FRX.assertScope(frxScope);
          const result = await FRXRequest('/vectors/commit', 'POST', entry.prepared);
          return result.records.map(record => db.vectors.receive(record));
        }

// app.js 21499
        const backfillAttempts = new Map();

// app.js 21500
        async function archiveMissedTurns(latestLogId) {
          try {
            const freshConfig = await dbGet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2');
            const config = freshConfig ? { ...knowledgeSearchGlobalConfig, ...freshConfig } : knowledgeSearchGlobalConfig;
            if (!config?.vectorAutoSave || Math.max(1, parseInt(config.vectorAutoSaveFrequency, 10) || 1) !== 1) return;
            const current = await FRX.captureScope();
            if (!current) return;
            const scope = { ...current, log_id: latestLogId };
            const archive = await FRX.getArchive(scope);
            const aiLogs = (archive?.data?.logs || []).filter(l =>
              l.type === 'ai' && l.frxRequestId && !l.isGhost && !l.isDeepSummary && !l.isUndoSnapshot && !l.frxPending);
            const upTo = aiLogs.findIndex(l => l.id === latestLogId);
            if (upTo < 0) return;
            const sourced = new Set((await db.vectors.toArray())
              .filter(v => v.archiveId === scope.archive_id).flatMap(v => v.frxSource?.logIds || []));
            const missed = aiLogs.slice(Math.max(0, upTo - 6), upTo).filter(l => !sourced.has(l.id) && (backfillAttempts.get(l.id) || 0) < 2);
            for (const log of missed.slice(-3)) {
              backfillAttempts.set(log.id, (backfillAttempts.get(log.id) || 0) + 1);
              const story = String(log.unoptimizedContent || log.content || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
              if (story.length <= 10) continue;
              console.log('⚡ [自动归档] 补归档较早的回合', log.id);
              await autoSaveToVectorDb(story, { ...scope, log_id: log.id });
            }
          } catch (e) {
            console.warn('[自动归档] 补归档未完成:', e.message);
          }
        }

// app.js 21532
        const archivedTurnLogs = new Set();

// app.js 21548
        async function archiveLatestTurn(logId) {
          try {
            const freshConfig = await dbGet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2');
            const config = freshConfig ? { ...knowledgeSearchGlobalConfig, ...freshConfig } : knowledgeSearchGlobalConfig;
            if (!config?.vectorAutoSave) { archivedTurnLogs.delete(logId); return; }
            const freq = Math.max(1, parseInt(config.vectorAutoSaveFrequency, 10) || 1);
            const current = await FRX.captureScope();
            if (!current) return;
            // Bound to this turn: the player may already have sent the next action.
            const scope = { ...current, log_id: logId };
            const archive = await FRX.getArchive(scope);
            const aiLogs = (archive?.data?.logs || []).filter(l =>
              l.type === 'ai' && !l.isGhost && !l.isDeepSummary && !l.isUndoSnapshot && !l.frxPending);
            const upTo = aiLogs.findIndex(l => l.id === logId);
            if (upTo < 0 || (upTo + 1) % freq !== 0) return;
            const archived = (await db.vectors.toArray()).some(v =>
              v.archiveId === scope.archive_id && (v.frxSource?.logIds || []).includes(logId));
            if (archived) return;
            const story = aiLogs.slice(upTo + 1 - freq, upTo + 1)
              .map(l => String(l.unoptimizedContent || l.content || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim())
              .filter(Boolean).join('\n\n==========\n\n');
            if (story.length <= 10) return;
            console.log('⚡ [自动归档] 回合已提交，开始归档');
            await autoSaveToVectorDb(story, scope);
          } catch (e) {
            archivedTurnLogs.delete(logId);
            console.warn('[自动归档] 未完成:', e);
          }
        }

// app.js 21579
        async function autoSaveToVectorDb(storyText, originScope = null) {
          const frxScope = originScope || await FRX.captureScope();
          await FRX.assertScope(frxScope);

          console.group('⚡ [自动归档调试] Start');

          if (!storyText || storyText.length < 10) {
            console.warn('[自动归档] ❌ 跳过：输入文本过短 (<10字符)');
            console.groupEnd();
            return;
          }

          const freshConfig = await dbGet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2');
          const bgConfig = freshConfig
            ? { ...knowledgeSearchGlobalConfig, ...freshConfig }
            : knowledgeSearchGlobalConfig;

          if (!bgConfig || !bgConfig.vectorAutoSave) {
            console.warn('[自动归档] ❌ 跳过：功能开关未开启 (vectorAutoSave=false)');
            console.groupEnd();
            return;
          }

          const saveController = new AbortController();
          let statusDanmaku = showDanmaku('正在后台自动归档...', 'status', saveController, true);
          const shouldMerge = bgConfig.vectorAutoMerge !== false;

          try {
            let summaryPromptTemplate = bgConfig.vectorSavePrompt;
            if (!summaryPromptTemplate) {
              summaryPromptTemplate = DEFAULT_VECTOR_SAVE_PROMPT || '';
            }

            const rawStoryText = storyText || '';
            const stateSnapshot =
              typeof generatePrettySnapshotForAI === 'function' ? generatePrettySnapshotForAI() : '';

            let lastUserInput = '无';
            // FRX: a turn archived after later turns is described as it was: its own player
            // input, and the time and place from its own state snapshot.
            let turnTimeRow = '';
            if (currentArchiveName) {
              const archive = await FRX.getArchive(frxScope);
              if (archive && archive.data.logs) {
                const logs = archive.data.logs;
                const at = frxScope?.log_id ? logs.findIndex(log => log.id === frxScope.log_id) : -1;
                for (let i = (at >= 0 ? at : logs.length) - 1; i >= 0; i--) {
                  if (logs[i].type === 'user') {
                    lastUserInput = logs[i].content;
                    break;
                  }
                }
                try {
                  const snapshot = at >= 0 ? logs[at].stateSnapshot : null;
                  const turnState = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
                  turnTimeRow = String(turnState?.['4']?.[0]?.['0'] || '');
                } catch { turnTimeRow = ''; }
              }
            }

            const thinkingContent = latestThinkingContent || '无';
            const geography = typeof generateGeographyString === 'function' ? generateGeographyString() : '';
            let sceneMapData = '无场景地图';
            if (currentState['10'] && currentState['10']['SCENE_MAP']) {
              const mapCfg = currentState['10']['SCENE_MAP']['1'];
              if (mapCfg) sceneMapData = typeof mapCfg === 'string' ? mapCfg : JSON.stringify(mapCfg);
            }

            let worldFactors = '无世界因子';
            try {
              if (typeof getWorldFactorsContext === 'function') {
                worldFactors = await getWorldFactorsContext();
              }
            } catch (e) {}

            let charBios = '';
            try {
              const textToSearch = rawStoryText + (lastUserInput !== '无' ? lastUserInput : '');
              if (typeof getTheaterWorldBookContext === 'function') {
                charBios = await getTheaterWorldBookContext(textToSearch);
              }
              if (!charBios) charBios = '无相关人物传记';
            } catch (e) {
              charBios = '检索传记时出错';
            }

            const playerName = currentPlayerData.name || '玩家';
            const currentTime = turnTimeRow ? turnTimeRow.split('/')[0]
              : currentState['4'] && currentState['4'][0] ? (currentState['4'][0]['0'] || '').split('/')[0] : '未知时间';
            const turnPlace = turnTimeRow.split('/').slice(1).join('/').replace(/\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*$/, '');
            const currentLocation = turnPlace || currentPlayerData.location || '未知地点';

            let finalPrompt = summaryPromptTemplate
              .replace(/\$\{text\}/g, rawStoryText)
              .replace(/\$\{story_text\}/g, rawStoryText)
              .replace(/\$\{state_snapshot\}/g, stateSnapshot)
              .replace(/\$\{user_input\}/g, lastUserInput)
              .replace(/\$\{thinking_content\}/g, thinkingContent)
              .replace(/\$\{table_thinking_content}/g, thinkingContent)
              .replace(/\$\{character_biographies\}/g, charBios)
              .replace(/\$\{worldGeography\}/g, geography)
              .replace(/\$\{sceneMapData\}/g, sceneMapData)
              .replace(/\$\{world_factors\}/g, worldFactors)
              .replace(/\$\{playerName\}/g, playerName)
              .replace(/\$\{currentTime\}/g, currentTime)
              .replace(/\$\{currentLocation\}/g, currentLocation);

            if (typeof getGlobalWbContextAddons === 'function') {
              const globalAddons = await getGlobalWbContextAddons('vector_archive', rawStoryText);
              for (const [key, value] of Object.entries(globalAddons)) {
                finalPrompt = finalPrompt.split(key).join(value);
              }
            }

            let apiUrl = bgConfig.vectorSaveApiUrl || bgConfig.apiUrl;
            let apiKey = bgConfig.vectorSaveApiKey || bgConfig.apiKey;
            let apiModel = bgConfig.vectorSaveApiModel || bgConfig.apiModel;

            if (!apiUrl || !apiKey || !apiModel) {
              console.error('[自动归档] ❌ API配置缺失');
              showDanmaku('剧情归档失败: API配置缺失', 'error');
              if (statusDanmaku) statusDanmaku.remove();
              return;
            }

            if (statusDanmaku) statusDanmaku.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在分析剧情...';

            let summaryRes = await genericApiCall(
              apiUrl,
              apiKey,
              apiModel,
              [
                {
                  role: 'user',
                  content: finalPrompt,
                },
              ],
              saveController.signal,
            );
await FRX.assertScope(frxScope);

            if (!summaryRes || !summaryRes.trim()) throw new Error('API返回为空');
            summaryRes = summaryRes.replace(/<(thinking|think)>[\s\S]*?<\/\1>/gi, '').trim();
            if (/<\/?(?:thinking|think)\b/i.test(summaryRes)) throw new Error('归档回复未完整结束，原记忆已保留');

            let entriesToSave = [];
            try {
              const jsonMatch = summaryRes.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (Array.isArray(parsed)) entriesToSave = parsed;
              } else {
                const objMatch = summaryRes.match(/\{[\s\S]*\}/);
                if (objMatch) entriesToSave = [JSON.parse(objMatch[0])];
              }
            } catch (e) {
              console.warn('[自动归档] ⚠️ JSON解析异常，回退纯文本');
              entriesToSave = [
                {
                  title: '剧情片段',
                  content: summaryRes,
                  folder: '剧情自动归档',
                },
              ];
            }

            if (entriesToSave.length === 0) return;
            if (entriesToSave.some(entry => !entry || typeof entry.content !== 'string' ||
                (entry.title !== undefined && typeof entry.title !== 'string'))) {
              throw new Error('归档条目格式无效，原记忆已保留');
            }

            let embedUrl = bgConfig.embeddingUrl;
            if (!embedUrl && bgConfig.apiUrl) {
              embedUrl =
                bgConfig.apiUrl.replace('/chat/completions', '/embeddings').replace(/\/v1\/?$/, '') + '/v1/embeddings';
            }
            let embedKey = bgConfig.embeddingKey || bgConfig.apiKey;
            let embedModel = bgConfig.embeddingModel || 'text-embedding-3-small';

            const embedConfig = {
              apiUrl: embedUrl,
              apiKey: embedKey,
              apiModel: embedModel,
            };

            const CHUNK_SIZE = bgConfig.vectorChunkSize || 500;
            let allDbEntries = [];
            let newFoldersDetected = false;
            let currentTimestamp = Date.now();

            let affectedFolders = new Set();
            let failedEntries = [];

            if (statusDanmaku) statusDanmaku.innerHTML = '<i class="fas fa-atom fa-spin"></i> 正在生成向量...';

            for (const entry of entriesToSave) {
              const title = entry.title || '未知片段';
              const content = entry.content || '';
              let folderName =
                entry.folder && typeof entry.folder === 'string' && entry.folder.trim()
                  ? entry.folder.trim()
                  : '剧情自动归档';

              const entryMetadata = entry.metadata || {
                category: '',
                tags: [],
                keywords: [],
                characters: [],
                locations: [],
                timeRange: '',
              };

              if (content.trim().length === 0) continue;

              if (!knowledgeSearchGlobalConfig.vectorFolders) knowledgeSearchGlobalConfig.vectorFolders = [];
              if (!knowledgeSearchGlobalConfig.vectorFolders.includes(folderName)) {
                knowledgeSearchGlobalConfig.vectorFolders.push(folderName);
                if (!Object.keys(getFolderConfig(folderName)).length) {
                  setFolderConfig(folderName, {
                    scope: 'archive',
                    boundArchive: frxScope.archive,
                    maxResults: 0,
                    template: '',
                  }, frxScope.archive_id);
                }
                newFoldersDetected = true;
              }

              affectedFolders.add(folderName);

              let finalContent = content;
              let retirements = [];

              if (shouldMerge) {
                try {
                  const existingItems = await db.vectors
                    .where('source')
                    .equals(folderName)
                    .filter(item => item.scope === 'archive' && item.archiveId === frxScope.archive_id &&
                      !item.frxTimelineHidden && !item.outdatedTimestamp &&
                      (item.baseTitle || item.title.replace(/ \(\d+\/\d+\)$/, '')) === title)
                    .toArray();

                  if (existingItems.length > 0) {
                    const sortedItems = existingItems.sort((a, b) => a.timestamp - b.timestamp);
                    const oldContents = sortedItems.map(i => i.content).join('\n\n');
                    finalContent = `${oldContents}\n\n[updated: ${currentTime}]\n${content}`;

                    retirements = existingItems;
                  }
                } catch (err) {
                  console.error('[自动归档] 合并检查出错:', err);
                  throw err;
                }
              }

              const contentChunks = chunkText(finalContent, CHUNK_SIZE);

              const textsToEmbed = contentChunks.map(c => {
                const metaBlock = [
                  `标题: ${title}`,
                  `分类: ${entryMetadata.category || '未分类'}`,
                  `标签: ${Array.isArray(entryMetadata.tags) ? entryMetadata.tags.join(', ') : ''}`,
                  `关键词: ${Array.isArray(entryMetadata.keywords) ? entryMetadata.keywords.join(', ') : ''}`,
                  `角色: ${Array.isArray(entryMetadata.characters) ? entryMetadata.characters.join(', ') : ''}`,
                  `地点: ${Array.isArray(entryMetadata.locations) ? entryMetadata.locations.join(', ') : ''}`,
                  entryMetadata.timeRange ? `时间: ${entryMetadata.timeRange}` : '',
                ]
                  .filter(Boolean)
                  .join('\n');

                return `${metaBlock}\n\n【正文内容】\n${c}`;
              });

              const work = {title, content: finalContent, folderName, metadata: entryMetadata,
                contentChunks, textsToEmbed, retirements};
              try {
                allDbEntries.push(...await commitVectorArchiveEntry(work, embedConfig, frxScope, currentTimestamp));
              } catch (embedError) {
                console.error(`[自动归档] Embedding 失败 (${title}):`, embedError);
                showDanmaku(`向量化失败 (条目: ${title}): ${embedError.message}`, 'error');
                failedEntries.push({...work, errorMessage: embedError.message});
              }
            }

            if (allDbEntries.length > 0) {
              window.lastWorldEvoVectorIds = allDbEntries.map(e => e.uuid);

              if (newFoldersDetected) {
                await FRX.assertScope(frxScope);
                await dbSet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2', knowledgeSearchGlobalConfig);
              }

              console.log(`[自动归档] 成功写入 ${allDbEntries.length} 条数据。`);
              if (statusDanmaku) statusDanmaku.remove();
              showDanmaku(`剧情归档完成，已保存 ${allDbEntries.length} 条记忆。`, 'success');

              setTimeout(() => cleanupOutdatedVectors(frxScope), 5000);

              setTimeout(async () => {
                try {
                  await FRX.assertScope(frxScope);
                  for (const folder of affectedFolders) {
                    if (typeof triggerVectorFolderCondensation === 'function') await triggerVectorFolderCondensation(folder, frxScope);
                  }
                } catch (error) { console.warn('[自动归档] 凝练已跳过:', error.message); }
              }, 3000);
            } else {
              if (statusDanmaku) statusDanmaku.remove();
            }

            window._vectorArchiveFailedEntries = failedEntries;
            window._vectorArchiveEmbedConfig = embedConfig;
            window._vectorArchiveCurrentTimestamp = currentTimestamp;
            window._vectorArchiveScope = frxScope;
          } catch (e) {
            console.error('[自动归档] 异常:', e);
            showDanmaku(`剧情归档失败: ${e.message}`, 'error');
            if (statusDanmaku) statusDanmaku.remove();
          } finally {
            console.groupEnd();
          }
        }

// app.js 21992
        async function cleanupOutdatedVectors(originScope = null) {
          const frxScope = originScope || await FRX.captureScope();
          const retentionRounds = parseInt(knowledgeSearchGlobalConfig.vectorOutdatedRetention) || 0;

          if (retentionRounds <= 0 || !currentArchiveName) {
            return;
          }

          try {
            const archive = await FRX.getArchive(frxScope);
            if (!archive || !archive.data.logs || archive.data.logs.length === 0) return;

            const logs = archive.data.logs.filter(log => log.type === 'ai' && !log.isDeepSummary &&
              !log.isSnapshot && !log.isGhost);
            const cutoffIndex = logs.length - retentionRounds - 1;

            if (cutoffIndex < 0) return;

            const cutoffLog = logs[cutoffIndex];
            const cutoffTimestamp = new Date(cutoffLog.timestamp).getTime();

            if (isNaN(cutoffTimestamp)) {
              console.warn('[过期清理] 时间戳解析错误，跳过清理');
              return;
            }

            const expired = await db.vectors.filter(record => record.scope === 'archive' &&
              record.archiveId === frxScope.archive_id && record.outdatedTimestamp &&
              record.outdatedTimestamp < cutoffTimestamp).toArray();
            if (expired.length > 0) {
              await FRX.assertScope(frxScope);
              await FRXRequest('/vectors/prune', 'POST', {scope: frxScope, records: expired});
              console.log(`[过期清理] 已自动清理 ${expired.length} 条已超出回溯范围的过期记忆。`);
            }
          } catch (err) {
            console.error('[过期清理] 执行失败:', err);
          }
        }

// app.js 45580
        async function callSummaryApiDirect(prompt, signal = null) {
const { apiUrl, apiKey, apiModel } = summaryConfig;
if (!apiUrl || !apiModel) {
throw new Error('自定义API配置不完整。');
}

// 修复 URL 构建逻辑
let fetchUrl = apiUrl.replace(/\/$/, '');
if (!fetchUrl.includes('/v1/chat/completions')) {
if (!fetchUrl.includes('/v1')) {
fetchUrl += '/v1';
}
if (!fetchUrl.endsWith('/chat/completions')) {
fetchUrl += '/chat/completions';
}
}

const headers = { 'Content-Type': 'application/json' };
if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

const body = {
model: apiModel,
messages: [
{ role: 'system', content: 'You are a helpful assistant that summarizes text concisely.' },
{ role: 'user', content: prompt }
],
temperature: 0.5,
max_tokens: 25000,
};

console.log('[分段记忆] API 请求 URL:', fetchUrl);

const response = await fetch(fetchUrl, {
method: 'POST',
headers,
body: JSON.stringify(body),
signal: signal // 传入 signal 以支持取消
});

if (!response.ok) {
const errorText = await response.text();
throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
}

const data = await response.json();
return data.choices?.[0]?.message?.content || '';
}

// app.js 45628
        async function autoApiUpdateSummaryForLog(logEntry) {
          const frxScope = await FRX.captureScope();

if (!summaryConfig.autoApiUpdateEnabled) return;
if (!summaryConfig.apiUrl || !summaryConfig.apiModel) return;
if (!logEntry || logEntry.type !== 'ai') return;

const content = logEntry.unoptimizedContent || logEntry.content || '';
if (!content.trim()) return;

console.log('[分段记忆] 自动 API 更新开始...');

const maxRetries = summaryConfig.autoUpdateRetryEnabled ? 3 : 1;
let statusDanmaku = null;
let controller = new AbortController();


const callWithRetry = async (prompt, typeName) => {
for (let attempt = 1; attempt <= maxRetries; attempt++) {
try {
const result = await callSummaryApiDirect(prompt);
await FRX.assertScope(frxScope);
if (result) {
return result.trim();
}
throw new Error('API 返回为空');
} catch (error) {
console.warn(`[分段记忆] ${typeName}更新失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
if (attempt < maxRetries && summaryConfig.autoUpdateRetryEnabled) {
// 等待 1 秒后重试
await new Promise(resolve => setTimeout(resolve, 1000));
} else {
throw error;
}
}
}
};


const parseSummaryResult = (text) => {
if (!text) return '';
const match = text.match(/<summary>([\s\S]*?)<\/summary>/i);
return match ? match[1].trim() : text.trim();
};

try {

const taskList = [];
if (summaryConfig.autoUpdateSmallSummary) taskList.push('小总结');
if (summaryConfig.autoUpdateLargeSummary) taskList.push('大总结');

if (taskList.length > 0) {
statusDanmaku = showDanmaku(
`正在自动更新${taskList.join('和')}...`,
'status',
controller,
true
);
}


if (summaryConfig.autoUpdateSmallSummary && summaryConfig.smallSummaryPrompt) {
const prompt = summaryConfig.smallSummaryPrompt.replace(
/\{\{content\}\}/g,
content.replace(/<[^>]+>/g, '').trim()
);
const result = await callWithRetry(prompt, '小总结');
if (result) {
logEntry.smallSummary = parseSummaryResult(result);
console.log('[分段记忆] 小总结已更新');
}
}


if (summaryConfig.autoUpdateLargeSummary && summaryConfig.largeSummaryPrompt) {
const prompt = summaryConfig.largeSummaryPrompt.replace(
/\{\{content\}\}/g,
content.replace(/<[^>]+>/g, '').trim()
);
const result = await callWithRetry(prompt, '大总结');
if (result) {
logEntry.largeSummary = parseSummaryResult(result);
console.log('[分段记忆] 大总结已更新');
}
}


const archive = await FRX.getArchive(frxScope);
if (archive) {
const logIndex = archive.data.logs.findIndex(l => l.id === logEntry.id);
if (logIndex !== -1) {
if (logEntry.smallSummary) archive.data.logs[logIndex].smallSummary = logEntry.smallSummary;
if (logEntry.largeSummary) archive.data.logs[logIndex].largeSummary = logEntry.largeSummary;
await db.archives.put(archive, {scope: frxScope});
}
}
} catch (error) {
console.error('[分段记忆] 自动 API 更新失败:', error);
showDanmaku(`分段记忆更新失败: ${error.message}`, 'error');
} finally {
if (statusDanmaku) statusDanmaku.remove();
}
}

module.exports = {
  isTheaterGenerating,
  renderAirpTemplate,
  DEFAULT_DAILY_PAPER_PROMPT,
  theaterApiController,
  getPreviousDailyPapers,
  callAutomatedAITheater,
  findBestMatchingTemplate,
  getWorldFactorsContext,
  extractMapEventsFromHtml,
  latestDailyPaperResponse,
  getTheaterWorldBookContext,
  _internalRunWorldEvolution,
  defaultRule,
  chunkText,
  commitVectorArchiveEntry,
  backfillAttempts,
  archiveMissedTurns,
  archivedTurnLogs,
  archiveLatestTurn,
  autoSaveToVectorDb,
  callSummaryApiDirect,
  autoApiUpdateSummaryForLog,
  cleanupOutdatedVectors,
};
