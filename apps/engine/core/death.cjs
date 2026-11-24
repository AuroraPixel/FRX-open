/* Extreme mode's death: the check the page makes after every turn (app.js 16605, in
 * applyVariableAndUiUpdates) and the save starting over from its opening when the protagonist
 * died.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on. Nothing in them draws the
 * page: the alerts are the page's messages to the player, and selectAndLoadArchive is the page
 * loading the save again, which the caller provides (../death.cjs).
 */

// app.js 47105
        function checkPlayerDeath() {
          if (!currentPlayerData.isExtreme) return;

          let currentHp = 100;
          let hpFound = false;

          if (
            currentPlayerData.detailedAttributes &&
            currentPlayerData.detailedAttributes['血量'] &&
            typeof currentPlayerData.detailedAttributes['血量'].current === 'number'
          ) {
            currentHp = currentPlayerData.detailedAttributes['血量'].current;
            hpFound = true;
          }

          if (!hpFound) {
            const playerRow = currentState['0'] ? currentState['0']['B1'] : null;
            if (playerRow && playerRow['9']) {
              const remarks = parseRemarksString(playerRow['9']);
              if (remarks.hp && typeof remarks.hp === 'string' && remarks.hp.includes('/')) {
                currentHp = parseInt(remarks.hp.split('/')[0], 10);
                if (isNaN(currentHp)) {
                  currentHp = 100;
                } else {
                  hpFound = true;
                }
              }
            }
          }

          const currentShouyuan = parseInt(currentPlayerData.shouyuan || '0');

          if (currentHp <= 10 || currentShouyuan <= 0) {
            handlePlayerDeath();
          }
        }

// app.js 47142
        async function handlePlayerDeath() {
          await showCustomAlert('你已死亡，一切归零...');

          const archive = await db.archives.get(currentArchiveName);
          if (!archive) return;

          const firstLog = archive.data.logs.find(log => log.content.includes('<h4>天道初启</h4>'));
          if (!firstLog || !firstLog.stateSnapshot) {
            await showCustomAlert('错误：找不到初始存档快照，无法回溯。请检查存档是否损坏。');
            return;
          }

          const initialTableState = JSON.parse(firstLog.stateSnapshot);
          const initialPlayerRow = JSON.parse(JSON.stringify(initialTableState['0']['B1']));
          const oldRemarks = parseRemarksString(initialPlayerRow['9']);
          oldRemarks.deathCount = (currentPlayerData.deathCount || 0) + 1;
          initialPlayerRow['9'] = serializeRemarksObject(oldRemarks);

          const newTableState = getInitialTableState();

          newTableState['0']['B1'] = initialPlayerRow;

          const warehouseItems = currentPlayerData.warehouse || [];
          warehouseItems.forEach(item => {
            let itemData;
            const tableIndex = getTableIndexFromId(item.id);
            if (tableIndex !== null) {
              itemData = currentState[tableIndex]?.[item.id];
              if (itemData) {
                newTableState[tableIndex][item.id] = itemData;
              }
            }
          });

          firstLog.stateSnapshot = JSON.stringify(newTableState);

          archive.data.logs = [firstLog];
          archive.data.state.currentState = newTableState;
          archive.data.state.bondedCharacters = {};
          archive.data.state.rpgMaps = {};
          archive.data.state.npcAvatars = {};

          await db.archives.put(archive);
          await selectAndLoadArchive(currentArchiveName);
        }

module.exports = {
  checkPlayerDeath,
  handlePlayerDeath,
};
