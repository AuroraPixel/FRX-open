/* The page's variables: the state its functions share, with the values the page starts with.
 * A page context gives every run its own copy (host.cjs).
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 5086: the default world map, as JSON (content/map.json, shared with the server).
const DEFAULT_WORLD_MAP_DATA = require('../../../content/map.json');

// app.js 14
      let playerDisplaySettings = {};

// app.js 16
      let isMainApiGenerating = false;

// app.js 18
      let aiNotificationQueue = [];

// app.js 22
      let lastDailyPaperContent = '';

// app.js 25
      let dailyPaperContextForNextMessage = '';

// app.js 27
      let npcDisplaySettings = {};

// app.js 1116
      let lastAiStoryText = '';

// app.js 1117
      let lastUnoptimizedAiStoryText = '';

// app.js 1120
      let cloudStorageConfig = {
        enabled: false,
        apiUrl: '',
      };

// app.js 1451
      let thinkingApiConfig = {};

// app.js 8688
        let currentState = {};

// app.js 8691
        let latestThinkingContent = '';

// app.js 8692
        let latestWorldEvolutionResponse = '';

// app.js 8695
        let currentPlayerData = {};

// app.js 8696
        let inventoryItems = [];

// app.js 8697
        let surroundingCharacters = [];

// app.js 8698
        let characterDatabase = {};

// app.js 8699
        let bondedCharacters = {};

// app.js 8702
        let currentArchiveName = null;

// app.js 8703
        let allBiographyEntries = [];

// app.js 8709
        let actionQueue = [];

// app.js 8713
        let summaryConfig = {};

// app.js 8714
        let regexConfig = {};

// app.js 8739
        let WORLD_MAP_DATA = {};

// app.js 8742
        let currentDefaultMapArchiveName = null;

// app.js 8743
        let currentMapSendStrategy = 'moderate';

// app.js 16955
        let activeTheaterHTML = null;

// app.js 17586
        let knowledgeSearchGlobalConfig = {};

// app.js 17589
        let cachedVectorContext = '';

// app.js 17590
        let latestVectorInjectionLogs = '';

// app.js 17602
        let currentArchiveId = null;

module.exports = {
  playerDisplaySettings,
  isMainApiGenerating,
  aiNotificationQueue,
  lastDailyPaperContent,
  dailyPaperContextForNextMessage,
  npcDisplaySettings,
  lastAiStoryText,
  lastUnoptimizedAiStoryText,
  cloudStorageConfig,
  thinkingApiConfig,
  currentState,
  latestThinkingContent,
  latestWorldEvolutionResponse,
  currentPlayerData,
  inventoryItems,
  surroundingCharacters,
  characterDatabase,
  bondedCharacters,
  currentArchiveName,
  allBiographyEntries,
  actionQueue,
  summaryConfig,
  regexConfig,
  WORLD_MAP_DATA,
  currentDefaultMapArchiveName,
  currentMapSendStrategy,
  activeTheaterHTML,
  knowledgeSearchGlobalConfig,
  cachedVectorContext,
  latestVectorInjectionLogs,
  currentArchiveId,
  DEFAULT_WORLD_MAP_DATA,
};
