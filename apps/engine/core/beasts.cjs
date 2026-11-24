/* A spirit beast's aptitude and its feeding: the eight grades of aptitude, reading a beast's
 * aptitude column, and feeding it one consumable from the bag (the 喂食/培养 window of the beast's
 * detail, openBeastFeedingModal).
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on. handlePersistentFeed writes
 * its 培养日志 into the window's #feed-logs (its messages to the player) and draws nothing else;
 * the window's own redraws are the callbacks it is given, which a caller may leave out.
 */

// app.js 43806
        const BEAST_APTITUDE_CONFIG = [
          { name: '凡品', max: 100, color: '#b0bec5' }, // 灰/白
          { name: '灵品', max: 300, color: '#66bb6a' }, // 绿
          { name: '玄品', max: 600, color: '#4fc3f7' }, // 蓝
          { name: '地品', max: 1000, color: '#ba68c8' }, // 紫
          { name: '天品', max: 2500, color: '#ffd700' }, // 金
          { name: '仙品', max: 5000, color: '#ff5252' }, // 红
          { name: '神品', max: 10000, color: '#e040fb' }, // 粉
          { name: '圣品', max: 99999, color: '#00e676' }, // 亮绿/炫彩
        ];

// app.js 43827
        function parseBeastAptitude(aptitudeStr) {
          let name = '凡品';
          let current = 0;

          if (aptitudeStr) {
            const parts = aptitudeStr.split('|');
            name = parts[0] || '凡品';
            current = parseInt(parts[1]) || 0;
          }

          let configIndex = BEAST_APTITUDE_CONFIG.findIndex(c => c.name === name);
          if (configIndex === -1) configIndex = 0;

          const config = BEAST_APTITUDE_CONFIG[configIndex];

          const nextConfig =
            configIndex < BEAST_APTITUDE_CONFIG.length - 1 ? BEAST_APTITUDE_CONFIG[configIndex + 1] : null;

          return {
            name: config.name,
            current: current,
            max: config.max,
            color: config.color,
            index: configIndex,
            nextTier: nextConfig,
          };
        }

// app.js 44132
        async function handlePersistentFeed(beastId, itemId, updateHeaderCallback, renderItemsCallback) {
          const logs = document.getElementById('feed-logs');
          const addLog = (msg, type = 'normal') => {
            const p = document.createElement('div');
            p.className = `beast-feed-log-item ${type}`;
            p.innerHTML = msg;
            logs.appendChild(p);
            logs.scrollTop = logs.scrollHeight;
          };

          const itemInDb = currentState['1'][itemId];
          if (!itemInDb) {
            addLog('物品数量不足！', 'fail');
            if (renderItemsCallback) renderItemsCallback();
            return;
          }

          const qty = parseInt(itemInDb['5']);
          const itemName = itemInDb['1'].replace(/<[^>]+>/g, '');

          if (qty > 1) {
            itemInDb['5'] = (qty - 1).toString();
          } else {
            delete currentState['1'][itemId];
          }

          syncStateFromTables();
          if (renderItemsCallback) renderItemsCallback();

          const beast = currentState['7'][beastId];
          const currentAptData = parseBeastAptitude(beast['7']);
          const tierIndex = currentAptData.index || 0;

          const minChange = -5 - tierIndex * 5;
          const maxChange = 25 + tierIndex * 8;
          const range = maxChange - minChange;

          let change = Math.floor(Math.random() * range) + minChange;

          let isCrit = false;
          if (Math.random() < 0.08) {
            change = Math.abs(change) * 2;
            isCrit = true;
          }

          let newCurrent = currentAptData.current + change;
          if (newCurrent < 0) newCurrent = 0;

          let logMsg = `投喂 [${itemName}]: `;
          let logType = 'normal';

          if (newCurrent >= currentAptData.max) {
            if (currentAptData.nextTier) {
              const nextTier = currentAptData.nextTier;
              const overflow = newCurrent - currentAptData.max;
              beast['7'] = `${nextTier.name}|${overflow}`;

              addLog(`✨ 血脉蜕变！晋升为【${nextTier.name}】！`, 'evolve');

              // 发送隐式指令给AI，要求描写进化，传入 beastId 和 完整属性
              addAction(
                'beast_evolve',
                {
                  beastName: beast['1'],
                  beastId: beast['0'],
                  oldTier: currentAptData.name,
                  newTier: nextTier.name,
                  // --- 新增属性透传 ---
                  level: beast['2'] || '未知',
                  hp: beast['8'] || '未知',
                  mp: beast['9'] || '未知',
                  favor: beast['10'] || '0',
                  personality: beast['4'] || '未知',
                },
                {},
                true,
              ); // isSilent: true

              showDanmaku('灵兽发生进化，剧情将在下次对话中体现！', 'success');
            } else {
              newCurrent = currentAptData.max;
              beast['7'] = `${currentAptData.name}|${newCurrent}`;
              addLog(`药力吸收完毕，已达此界巅峰，无法继续精进！`, 'crit');
            }
          } else {
            beast['7'] = `${currentAptData.name}|${newCurrent}`;

            if (change > 0) {
              logMsg += `资质 +${change} ${isCrit ? '🔥(完美吸收!)' : ''}`;
              logType = isCrit ? 'crit' : 'success';
            } else if (change < 0) {
              logMsg += `排斥反应... 资质 ${change}`;
              logType = 'fail';
            } else {
              logMsg += `毫无波澜...`;
            }
            addLog(logMsg, logType);
          }

          const currentFavor = parseInt(beast['10'] || '0');
          currentState['7'][beastId]['10'] = (currentFavor + 1).toString();

          await saveCurrentState();
          if (updateHeaderCallback) updateHeaderCallback();
        }

module.exports = {
  BEAST_APTITUDE_CONFIG,
  parseBeastAptitude,
  handlePersistentFeed,
};
