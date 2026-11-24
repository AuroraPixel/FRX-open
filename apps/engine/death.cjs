/* Extreme mode's death, with the page's own functions (see host.cjs): after every turn the old
 * page checks whether the protagonist died (checkPlayerDeath, called in applyVariableAndUiUpdates,
 * app.js 16605) and, when he did, starts the save over from its opening (handlePlayerDeath).
 *
 *   node apps/engine/death.cjs < input.json > output.json
 *
 * Input:  { archive, settings, seed, now, locale, timeZone }: the save as its turn committed it
 * Output: { dead, archive, deaths, said, errors }
 *
 * The page loads the save (selectAndLoadArchive → loadState, which fills the variables the check
 * reads: currentPlayerData, currentState), then runs checkPlayerDeath. On a death it calls
 * handlePlayerDeath without waiting for it; that shows its alert, and once the player has pressed
 * 确定 it reads the save, puts the opening back and saves it, then loads the save again. Here the
 * 确定 comes at once.
 *   dead     the check found the protagonist dead (the alert was shown)
 *   archive  the save handlePlayerDeath put back; null when the protagonist lives, or when the
 *            page could not start over (no opening with a snapshot: its second alert says so)
 *   deaths   the protagonist's deaths in the save as the page loads it again
 *   said     the page's alerts, in order
 */
'use strict';

const host = require('./host.cjs');

const STATE = [
  'currentState', 'currentPlayerData', 'inventoryItems', 'surroundingCharacters', 'characterDatabase',
  'bondedCharacters', 'currentArchiveName', 'WORLD_MAP_DATA', 'latestWorldEvolutionResponse',
  'allBiographyEntries', 'dailyPaperContextForNextMessage', 'lastDailyPaperContent', 'lastAiStoryText',
  'lastUnoptimizedAiStoryText',
];

const CONSTANTS = ['DEFAULT_WORLD_MAP_DATA', 'TIME_LOCATION_ROW_ID'];

const FUNCTIONS = [
  'loadState', 'syncStateFromTables', 'parseRemarksString', 'parseRemarkFields', 'serializeRemarksObject',
  'parseNestedJsonString', 'storedItemIds', 'itemStackCount', 'equippedItemRows', 'getInitialTableState',
  'getTableIndexFromId', 'checkPlayerDeath', 'handlePlayerDeath',
];

// ---------------------------------------------------------------- glue, run in the page's scope

// The page's alert, answered with 确定 at once; what it said is kept.
function showCustomAlert(message) {
  __said.push(String(message));
  return Promise.resolve(true);
}

// selectAndLoadArchive, without drawing: the variables loadState leaves.
async function frxLoadArchive(archiveName) {
  const saved = await db.archives.get(archiveName);
  currentArchiveName = archiveName;
  await loadState(saved.data.state || {}, saved.data);
}

// handlePlayerDeath ends by showing the save again.
async function selectAndLoadArchive(archiveName) {
  await frxLoadArchive(archiveName);
}

// What handlePlayerDeath started is done once the page's promises have run.
async function frxSettle() {
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

function frxDeaths() {
  return currentPlayerData.deathCount;
}

// ---------------------------------------------------------------- running

async function death(input, { discover = false } = {}) {
  const page = host.take({
    functions: FUNCTIONS,
    constants: [...CONSTANTS, ...STATE],
    glue: [showCustomAlert, frxLoadArchive, selectAndLoadArchive, frxSettle, frxDeaths],
  });
  const run = host.open(page, {
    settings: input.settings || {},
    archive: input.archive,
    seed: input.seed, now: input.now, locale: input.locale, timeZone: input.timeZone,
    frx: { captureScope: async () => null, assertScope: async () => {} },
    discover,
  });
  run.set('__said', []);
  const step = async (name, ...args) => {
    let result;
    try { result = await run.call(name, ...args); } catch (error) {
      if (discover) error.message += ` (missing so far: ${run.missing.join(', ') || 'none'})`;
      throw error;
    }
    if (!result.done) throw new Error(`${name} waited for something that never came`);
    return result.value;
  };
  // checkPlayerDeath does not wait for handlePlayerDeath: what goes wrong in it (an opening
  // snapshot without the tables, say) is a promise nobody handles, as on the page.
  const unhandled = [];
  const keep = error => unhandled.push(String(error?.message || error).slice(0, 500));
  process.on('unhandledRejection', keep);
  try {
    await step('frxLoadArchive', input.archive.name);
    await step('checkPlayerDeath');
    await step('frxSettle');
  } finally {
    process.off('unhandledRejection', keep);
  }
  const said = run.get('__said');
  const archive = run.writes.archives.at(-1) || null;
  return {
    dead: said.length > 0,
    archive,
    ...(archive ? { deaths: await step('frxDeaths') } : {}),
    said,
    errors: [...run.errors, ...unhandled],
    ...(discover ? { missing: run.missing } : {}),
  };
}

module.exports = { death };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buffer += chunk; });
  process.stdin.on('end', async () => {
    try {
      const input = JSON.parse(buffer);
      process.env.TZ = input.timeZone || 'Asia/Shanghai';
      process.stdout.write(JSON.stringify(await death(input, { discover: process.argv.includes('--discover') })));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errors: [error.message] }));
      process.exitCode = 1;
    }
  });
}
