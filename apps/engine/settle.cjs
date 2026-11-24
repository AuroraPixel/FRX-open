/* Executes the original card's state semantics with explicit, isolated dependencies.
 * The VM evaluates repository code only: the card's own functions, from core/. Model arguments
 * are parsed with JSON.parse. It cannot fetch, access files or write to the live database.
 */
const vm = require("node:vm");
const { create } = require("./core/random.cjs");
const core = require("./core/index.cjs");
const { reconcileItemUse } = require("./item-use.cjs");
const rules = require("./turn-rules.cjs");

// The card's table functions settlement runs (core/tables.cjs, snapshots.cjs, equipment.cjs).
const FUNCTIONS = [
  "recursivelyParseJsonStrings", "parseRemarksString", "serializeRemarksObject",
  "parseNestedJsonString", "getTableIndexFromId", "applyChanges", "parseTableEditCommands",
  "autoGenerateCharacterWorldBooks", "getSingleCharacterSnapshot", "parseSnapshotToRowObject",
  "equippedItemRows", "storedItemIds", "itemStackCount", "restoreEquipmentRow", "parseRemarkFields",
];
const source = FUNCTIONS.map(name => core.functions.get(name).toString()).join("\n");

function makeContext(archive, seed, knowledge, errors, settingsWrites) {
  const random = create(seed);
  const math = Object.create(Math); math.random = random.random;
  const context = vm.createContext({
    structuredClone, Math: math, crypto: { randomUUID: random.uuid }, FRX: random,
    console: { log() {}, warn() {}, error(...args) { errors.push(args.map(String).join(" ").slice(0,500)); } },
    currentArchiveName: archive.name,
    CUSTOM_AVATAR_KEY: core.values.get("CUSTOM_AVATAR_KEY"),
    TIME_LOCATION_ROW_ID: core.values.get("TIME_LOCATION_ROW_ID"),
    WORLD_MAP_DATA: structuredClone(archive.data.state.worldMap || {}),
    // The old page's picture library is gone and no interface shows these pictures: the name the
    // model wrote (or the address the save already had) is kept as it is.
    getImageUrl(type, id) {
      return String(id);
    },
    knowledgeSearchGlobalConfig: knowledge || {},
    dbSet: async (key, value) => { settingsWrites.push({key,value}); },
    db: { archives: { get: async () => archive, put: async () => {} } },
  });
  vm.runInContext(source, context, { timeout: 1500 });
  return context;
}

// Apply trusted engine commands to a draft table state.
async function applyCommands(context, state, commands) {
  if (!commands) return state;
  context.draftCommands = commands;
  context.draftErrors = [];
  vm.runInContext("var draftParsed = parseTableEditCommands(draftCommands, draftErrors);", context, { timeout: 1500 });
  if (context.draftErrors.length) throw new Error("引擎回执指令无效：" + context.draftErrors.map(e => e.title).join("，"));
  context.draftState = structuredClone(state);
  const result = await vm.runInContext("applyChanges(draftState, draftParsed.delta, {persistEffects:false})", context, { timeout: 1500 });
  return result.newState;
}

// The rows of characters who left the scene, from the biographies the card keeps.
function biographiesOf(context, archive) {
  const rows = {};
  for (const entry of archive.data.state.worldBookEntries || []) {
    const key = entry?.key;
    if (!/^[CG][A-Za-z0-9_-]{0,127}$/.test(key || "")) continue;
    let row = null;
    try { row = JSON.parse(entry.content); } catch { try { row = context.parseSnapshotToRowObject(entry.content); } catch { row = null; } }
    if (row && typeof row === "object" && !Array.isArray(row) && row["1"]) rows[key] = { ...row, 0: key };
  }
  return rows;
}

// The people of a life save's book (frxPlay.people.by, life/people.cjs): who left the scene with
// no biography is there, and their IDs stay theirs (a newcomer under one would be taken for them:
// their ties, their age, their realm). None outside the life.
const bookOf = archive => archive.data?.state?.frxPlay?.people?.by || {};
const knownIdsOf = archive => [...(archive.data.state.worldBookEntries || []).map(entry => entry?.key).filter(Boolean),
  ...Object.keys(bookOf(archive))];

function engineEnv(context, archive, seed) {
  return { ctx: context, state: structuredClone(archive.data.state.currentState || {}),
           dailyUses: archive.data.state.dailyItemUses, seed, archiveId: archive.data.archiveId || archive.name,
           progress: rules.mechanics.ledgerOf(archive.data.state.frxProgress),
           worldFactors: rules.mechanics.worldFactorsOf(archive.data.logs),
           worldMap: archive.data.state.worldMap || {},
           knownIds: knownIdsOf(archive), people: bookOf(archive),
           biographies: biographiesOf(context, archive) };
}

const INTIMATE_COLUMNS = ["8", "17", "18", "20", "21", "22", "23", "24"];
const characterName = row => String(row?.["1"] ?? "").replace(/<[^>]*>/g, "").split("|")[0].trim();

// Bring the story's character edits in line with the scene the receipts left:
// - a set of a character already on the scene updates that row (the card would make a
//   second copy under a new ID when the name changes), and a set that repeats a foe the
//   engine registered this turn updates that foe;
// - a set under the ID of someone who left the scene is that person coming back when the
//   name matches (their biography row first, the story's columns on top); under another name
//   it is a new character who took an occupied ID, and is renumbered with the rest of the
//   block following, since the card would overwrite the absent character's biography;
// - an edit of someone who left the scene brings them back from their biography first,
//   or is dropped when no biography exists (it would change nothing);
// - the all-ages pilot does not write the intimacy columns;
// - a new character without a panel gets the realm baseline the engine uses for foes;
// - a foe registered this turn and not yet hurt starts at the engine's HP: a full bar the
//   model wrote while filling in the foe's stats only restates the start and is left out.
const asObject = value => {
  if (typeof value !== "string") return value && typeof value === "object" ? value : null;
  try { return JSON.parse(value); } catch { return null; }
};
const fullBar = value => {
  const bar = asObject(value);
  return !!bar && Number.isFinite(Number(bar.current)) && Number(bar.current) === Number(bar.max);
};
// Only the very same name is the same person: 包掌柜的儿子 is not 包掌柜.
const sameName = (a, b) => !!a && a === b;
// Point a command at another row: its first argument is the row ID.
const retarget = (span, id) => span.replace(/^(\s*[A-Za-z_]\w*\s*\(\s*)"(?:[^"\\]|\\.)*"/, (_, head) => head + JSON.stringify(id));

// The player's cultivation is the engine's in pilot turns. In a story's write to B1, progress is
// left out, the realm before the bar in column 2 stays as the receipts left it (the identity after
// the bar is the story's), a rise in lifespan is left out (a fall stands), and the age is left out
// when a receipt of this turn moved it. Returns whether `data` changed; never asks for a rewrite.
function ownCultivation(data, player, notes) {
  let changed = false;
  if (Object.hasOwn(data, "9")) {
    const written = typeof data["9"] === "string" ? player.parseRemarks(data["9"]) : data["9"];
    if (written && typeof written === "object" && !Array.isArray(written)) {
      const remarks = { ...written };
      let edited = false;
      if (Object.hasOwn(remarks, "修为进度")) {
        const value = rules.mechanics.progressValue(remarks["修为进度"]);
        if (value !== player.progress) notes.push(`未采纳指令写的修为进度（${String(remarks["修为进度"]).slice(0, 12)}），修为由引擎结算，仍为${player.progress}`);
        delete remarks["修为进度"];
        edited = true;
      }
      const life = rules.mechanics.numberIn(remarks["寿元"]), lifeNow = rules.mechanics.numberIn(player.remarks["寿元"]);
      const differs = key => String(remarks[key] ?? "").trim() !== String(player.remarks[key] ?? "").trim();
      // In a save of the cultivation life 寿元 and 年龄 are the engine's both ways (the receipts
      // that moved them already stand in the row): a story write that differs is dropped, as the
      // purse and the panel are (plan item 50's fixes: a story that shortened the lifespan was kept,
      // and the legacy then ended the life at it). In a novel save only a longer life is refused,
      // and the age when a receipt moved it, as before.
      if (Object.hasOwn(remarks, "寿元") && player.life && differs("寿元")) {
        notes.push(`未采纳指令写的寿元（${String(remarks["寿元"]).slice(0, 12)}），寿元由引擎结算，仍为${player.remarks["寿元"] ?? ""}`);
        delete remarks["寿元"];
        edited = true;
      } else if (Object.hasOwn(remarks, "寿元") && !player.life && life !== null && lifeNow !== null && life > lifeNow) {
        notes.push(`未采纳寿元的增加（${lifeNow}→${life}），寿元只在突破时由引擎结算`);
        delete remarks["寿元"];
        edited = true;
      }
      if ((player.ageOwned || player.life) && Object.hasOwn(remarks, "年龄") && differs("年龄")) {
        notes.push(`年龄以引擎结算为准（${player.remarks["年龄"]}）`);
        delete remarks["年龄"];
        edited = true;
      }
      if (edited) {
        changed = true;
        if (Object.keys(remarks).length) data["9"] = typeof data["9"] === "string" ? player.serializeRemarks(remarks) : remarks;
        else delete data["9"];
      }
    }
  }
  if (Object.hasOwn(data, "2")) {
    const written = String(data["2"] ?? "");
    const bar = written.indexOf("|");
    const realm = (bar < 0 ? written : written.slice(0, bar)).trim();
    const identity = bar < 0 ? player.identity : written.slice(bar + 1);
    const parsed = rules.mechanics.parseRealm(realm);
    const same = parsed.unknown || player.realm.unknown
      ? realm.replace(/\s+/g, "") === player.realmText.replace(/\s+/g, "")
      : parsed.major === player.realm.major && parsed.minor === player.realm.minor;
    if (!same) {
      data["2"] = player.realmText + (identity ? "|" + identity : "");
      notes.push(`未采纳指令写的境界「${realm.slice(0, 20)}」，境界由引擎结算，仍为${player.realmText}`);
      changed = true;
      // A story that writes a higher realm believes a breakthrough happened and has said so.
      if (!parsed.unknown && !player.realm.unknown
          && (parsed.major > player.realm.major || (parsed.major === player.realm.major && (parsed.minor || 0) > (player.realm.minor || 0)))) {
        player.claimedRise = realm.slice(0, 20);
      }
    } else if (bar < 0 && player.identity) {
      data["2"] = written + "|" + player.identity;
      changed = true;
    }
  }
  return changed;
}

// A save of the cultivation life (the plan's first principle: 数字归引擎): the purse, the player's
// panel (气血 and the attributes) and the counts of what is in the bag are the engine's whatever
// the turn's receipts did, so the story's commands never move them (the card's old variable
// updates, and what a rewrite was once told to book). Its write to B1 loses 当前灵石 (column 26),
// the panel (column 11) and a status saying the player is down or dead (column 4, when the status
// the turn left does not say so already), with a note each; returns whether `data` changed.
function ownPurseAndPanel(data, base, notes) {
  let changed = false;
  if (Object.hasOwn(data, "26")) {
    const now = rules.mechanics.stonesOf(base["0"]?.B1);
    if (String(data["26"]).trim() !== String(base["0"]?.B1?.["26"] ?? "").trim()) {
      notes.push(`未采纳指令写的灵石（${String(data["26"]).slice(0, 12)}），灵石由引擎结算，仍为${now ?? "未知"}`);
    }
    delete data["26"];
    changed = true;
  }
  if (Object.hasOwn(data, "11")) {
    notes.push("未采纳指令写的属性和气血，由引擎结算");
    delete data["11"];
    changed = true;
  }
  // Down or dead is the engine's to say of the player (a fight's end, the death flow): a status the
  // story writes with those words would keep the player down for good, for nothing ever writes it
  // back (batch 8's real-model run: 「重伤倒地，内伤需养两日」 after a lost fight, then forty rests
  // at full health). A status that already says so stands.
  const status = Object.hasOwn(data, "4") ? String(data["4"] ?? "") : "";
  if (status && rules.mechanics.FALLEN_WORDS.test(status) && !rules.mechanics.FALLEN_WORDS.test(String(base["0"]?.B1?.["4"] ?? ""))) {
    notes.push(`未采纳指令写的主角状态「${status.slice(0, 16)}」：倒地与否由引擎结算`);
    delete data["4"];
    changed = true;
  }
  return changed;
}

const STONE_NAME = /^(?:下品|中品|上品|极品)?灵石$/;
// The types a worn piece has (gear.json's slots, 功法 aside: its texts are the engine's to grow).
const WORN = new Set(["武器", "护甲", "法宝"]);
// A thing of the story's own (one the catalogue does not list) keeps one of these types; any other
// (a pill, a talisman the catalogue does not know) is registered as a 重要物品: a keepsake and a lead
// that nothing in the engine equips, hangs on the belt, takes or prices (玩法设计第十二节: 剧情里独一份的
// 奇物不进图鉴，没有市价，只当线索). A piece of gear (a weapon, a shield, a 法宝: goods.gearTypeOf) is
// the catalogue's piece of its kind and tier under the story's name (goods.likeFor): it is worn, sold
// and counted at that piece's numbers and price (the owner's 玄甲盾, bought for a 百年血参, could not
// be worn as a keepsake); one the story says is broken or spent (残破阵盘, 已无驱用之能) is a keepsake.
// A 功法 of the story's stays one while it names no tier above the player's own (the opening's first
// method); a deeper one is a manual kept for later.
const KEEPSAKE_TYPES = new Set(["重要物品", "其他物品", "材料"]);
// broken or spent, as its name (残破阵盘, 青铜残戈, 断剑) or its words (已无驱用之能) say
const BROKEN_NAME = /^残|^断|[残断破碎](?:剑|刀|枪|戟|戈|矛|鞭|锤|斧|棍|棒|弓|刃|匕|钩|叉|盾|甲|铠|衣|袍|镜|幡|钉|珠|印|鼎|扇|铃|轮|梭)$/;
const BROKEN_WORDS = /残破|破损|破碎|损毁|碎裂|断裂|断折|崩裂|锈蚀|失灵|无驱用|驱使不动|灵性尽失|已废|报废/;
const broken = (name, use) => BROKEN_NAME.test(name) || BROKEN_WORDS.test(`${name} ${use}`);
const KEEPSAKE = "重要物品";
const HANDED_BAG = /储物袋$/;
const TIER_WORD = /([一二三四五六七八九])阶/;
const textOf = value => String(value ?? "").replace(/<[^>]*>/g, "").trim();
// A keepsake's effect says what it is for in words: a bonus it was written with (物攻+80, 法力+10%)
// would read as one it gives, and it gives none.
const BONUS = /[一-龥]{1,4}\s*[+\-＋－]\s*\d+(?:\.\d+)?%?/g;
const wordsOnly = text => text.replace(BONUS, "").replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, "").replace(/([，,、；;])[，,、；;\s]+/g, "$1") || "无";

function inventoryCounts(context, state) {
  const bag = state["1"] || {};
  const counts = new Map();
  for (const row of Object.values(bag)) {
    const name = characterName(row);
    if (name) counts.set(name, (counts.get(name) || 0) + (Number(context.itemStackCount(row["5"])) || 0));
  }
  for (const worn of context.equippedItemRows(state["0"]?.B1)) {
    if (Object.hasOwn(bag, worn.id || worn["0"])) continue;
    const name = characterName(worn) || characterName({ 1: worn.name });
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

// What a life save's story may hand the player in one beat (the owner's fourth playtest: sixty-six
// turns in which a token, a talisman, a recipe, a herb and a whole 储物袋 were handed over and none
// reached the bag, for the preset told the model not to register them). The beat's account:
// { goods, tier, cap, spent, received, refused, bags }: the catalogue's goods count against `cap`
// (a 差事's top pay at the player's tier, content/life/jobs.json pay; content/life/rewards.json
// story says so), the rest do not.
// `taken`: the item ids in use (the bag's, and those the player wears or stores: `locked`), so a
// thing the story registers under one of them (the owner's replay: 古修残戈 under I2, the worn
// method's) gets a free one.
function storyGifts(base, locked = []) {
  const goods = require("./life/goods.cjs");
  const tier = goods.tierOf(rules.mechanics.parseRealm(String(base["0"]?.B1?.["2"] ?? "")).major);
  const pay = require("./life/data.cjs").data("jobs").pay;
  const taken = new Set([...Object.keys(base["1"] || {}), ...locked]);
  return { goods, tier, cap: (pay[tier] ?? pay.default)[1], spent: 0, received: [], refused: [], pieces: [], bags: [], taken };
}

// The id a new row of the story's goes under: its own when free, else the first free I number.
function freeItemId(id, gifts) {
  let free = id;
  for (let n = 1; gifts.taken.has(free); n += 1) free = `I${n}`;
  gifts.taken.add(free);
  return free;
}

// A new thing the story registers in a life save (a set of a row the bag does not hold). A good of
// the catalogue is registered as the catalogue writes it (its type, uses and effect: the numbers are
// the catalogue's), onto a stack of the same good when the bag has one, while the beat's goods stay
// within the cap; past it, it is left out (refused, for the story check to have the story say so).
// A 储物袋 handed over is left out: the engine opens it after the story (gear.cjs bag, through
// life_turns.bags_opened). A thing the bag or this beat already holds by that name is not
// registered twice. Anything else is a thing of the story's own (KEEPSAKE_TYPES). Each one kept is
// in gifts.received (the page's 获得 block shows them: play_blocks.delta_receipts). Returns
// lifeNumbers' answer.
function storyThing(data, id, base, gifts, notes) {
  const name = characterName(data);
  if (!name) return undefined;
  // 「一袋灵石」「十块下品灵石」: stones by another name are the purse's too
  if (/灵石$/.test(name)) {
    notes.push(`未采纳把「${name}」放进储物袋的指令，灵石由引擎结算`);
    return null;
  }
  const count = Math.max(1, Math.min(99, Number.parseInt(textOf(data["5"]) || "1", 10) || 1));
  const bag = base["1"] || {};
  if (gifts.received.some(each => each.name === name)) {
    notes.push(`「${name}」这一拍已经登记过，不再登记一份`);
    return null;
  }
  const good = gifts.goods.lookup(name);
  if (good) {
    const value = good.price * count;
    if (gifts.spent + value > gifts.cap) {
      notes.push(`未采纳登记「${name}」：底价${value}块，剧情里一拍白给的东西合计至多值${gifts.cap}块（主角这一阶），贵重的东西走引擎的来路`);
      gifts.refused.push(name);
      return null;
    }
    gifts.spent += value;
    const row = gifts.goods.row(good, count, gifts.goods.qualityOf(name));
    const stack = Object.entries(bag).find(([, held]) => characterName(held) === row[1] && textOf(held?.["2"]) === row[2]);
    const at = stack ? stack[0] : freeItemId(id, gifts);
    gifts.received.push({ id: at, name: row[1], count, unit: gifts.goods.unitOf(good) });
    if (stack) return `add(${JSON.stringify(at)},${JSON.stringify({ 5: String((Number.parseInt(textOf(stack[1]["5"]), 10) || 0) + count) })})`;
    return `set(${JSON.stringify({ 0: at, ...row })})`;
  }
  if (HANDED_BAG.test(name)) {
    gifts.bags.push({ name, from: textOf(data["3"]) });
    notes.push(`「${name}」里有什么由引擎开出`);
    return null;
  }
  if (Object.values(bag).some(held => characterName(held) === name)) {
    notes.push(`「${name}」已在储物袋里，不再登记一份`);
    return null;
  }
  const type = textOf(data["2"]);
  const piece = gifts.goods.gearTypeOf(name, type);
  if (piece && !broken(name, textOf(data["4"]))) {
    // its tier as its name or use says it (二阶), else the player's; the source's words are often a
    // material's (以二阶墨甲龟背壳为主料)
    const claimed = `${name} ${textOf(data["4"])}`.match(TIER_WORD);
    const tier = claimed ? `${claimed[1]}阶` : gifts.tier;
    const like = gifts.goods.likeFor({ name, type: piece, text: `${textOf(data["3"])} ${textOf(data["4"])}`, tier });
    if (like) {
      const value = like.price * count;
      if (gifts.spent + value > gifts.cap) {
        notes.push(`未采纳登记「${name}」：照${like.name}算底价${value}块，剧情里一拍白给的东西合计至多值${gifts.cap}块（主角这一阶），想要用「买卖」卡买`);
        gifts.refused.push(name);
        gifts.pieces.push(name);
        return null;
      }
      gifts.spent += value;
      const at = freeItemId(id, gifts);
      gifts.received.push({ id: at, name, count, unit: gifts.goods.unitOf(like) });
      notes.push(`「${name}」不在图鉴里，照${like.name}（${like.tier}${like.type}）定数值`);
      return `set(${JSON.stringify({ ...data, 0: at, 1: name, 2: like.type, 4: gifts.goods.pieceEffect(like), 5: String(count) })})`;
    }
  }
  let kept = KEEPSAKE_TYPES.has(type) ? type : KEEPSAKE;
  if (type === "功法") {
    const claimed = `${name} ${textOf(data["3"])} ${textOf(data["4"])}`.match(TIER_WORD);
    const above = !!claimed && gifts.goods.TIERS.indexOf(`${claimed[1]}阶`) > gifts.goods.TIERS.indexOf(gifts.tier);
    kept = above ? KEEPSAKE : type;
    if (above) notes.push(`「${name}」写的是${claimed[1]}阶，高过主角这一阶，记作重要物品，眼下修不了`);
  } else if (kept !== type) {
    notes.push(`「${name}」不在图鉴里，记作重要物品（信物、线索），不当${type || "器物"}用`);
  }
  const at = freeItemId(id, gifts);
  gifts.received.push({ id: at, name, count, unit: kept === "功法" ? "部" : "件" });
  const effect = kept === "功法" ? data["4"] : wordsOnly(textOf(data["4"]));
  return `set(${JSON.stringify({ ...data, 0: at, 2: kept, 4: effect, 5: String(count) })})`;
}

// The rest of a life save's numbers in the story's commands (ownPurseAndPanel's): an
// updateAttribute on the player is left out; a thing in the bag is not taken out and its count not
// changed (using, selling and losing it are the engine's: a card, a verb, a fight); a new thing the
// story registers stands as storyThing has it (`gifts`, the beat's account), unless it is spirit
// stones (the purse's) or the very good the engine handed out this turn. Returns null to leave the
// command out, a command to keep instead, or undefined when it is none of these.
function lifeNumbers(op, id, base, grants, notes, gifts = null) {
  if (id === "B1" && op.command === "updateAttribute") {
    notes.push(`未采纳指令写的${String(op.attribute || "属性").slice(0, 8)}，气血和属性由引擎结算`);
    return null;
  }
  // Another's too (batch 7): in a fight the engine moves them; hurt outside one is the story's
  // words and the status column 4 the engine reads (重伤倒地, 身亡: mechanics.isFallen).
  if (/^[CG]/.test(id) && op.command === "updateAttribute") {
    const who = characterName(base["0"]?.[id]) || id;
    notes.push(`未采纳指令写的${who}的${String(op.attribute || "属性").slice(0, 8)}，气血和属性由引擎结算，伤势写在状态里`);
    return null;
  }
  if (!/^I/.test(id)) return undefined;
  const held = base["1"]?.[id];
  const name = characterName(held || op.data || {});
  if (op.command === "de" && held) {
    notes.push(`未采纳拿走「${name}」的指令，储物袋里的东西由引擎结算`);
    return null;
  }
  if (!["add", "set"].includes(op.command) || !op.data || typeof op.data !== "object") return undefined;
  // A set under the id of a thing in the bag that names another thing is a new one under a taken id
  // (the model's slip): it goes in under a free id, and the thing that was there stays.
  const written = characterName(op.data);
  if (held && op.command === "set" && gifts && written && written !== name) return storyThing(op.data, id, base, gifts, notes);
  if (held) {
    const rest = { ...op.data };
    let changed = false;
    if (Object.hasOwn(rest, "5") && textOf(rest["5"]) !== textOf(held["5"])) {
      notes.push(`未采纳指令写的「${name}」数目，储物袋里的东西由引擎结算`);
      delete rest["5"];
      changed = true;
    }
    // what a thing in the bag is and does are the engine's when it is a piece or a good of the
    // catalogue: the story does not make a keepsake a piece, nor write a piece's numbers (物防+12
    // into 物防+80) or a pill's; a keepsake's words may change, a bonus in them left out
    const was = textOf(held["2"]);
    const fixed = WORN.has(was) || !!require("./life/goods.cjs").lookup(name);
    if (Object.hasOwn(rest, "2") && textOf(rest["2"]) !== was && (fixed || WORN.has(textOf(rest["2"])))) {
      notes.push(`未采纳把「${name}」写成${textOf(rest["2"]) || "别的"}，器物是什么由引擎定`);
      delete rest["2"];
      changed = true;
    }
    if (Object.hasOwn(rest, "4") && textOf(rest["4"]) !== textOf(held["4"])) {
      if (fixed) {
        notes.push(`未采纳改写「${name}」的用处，它的数值由引擎定`);
        delete rest["4"];
        changed = true;
      } else if (KEEPSAKE_TYPES.has(was) && wordsOnly(textOf(rest["4"])) !== textOf(rest["4"])) {
        rest["4"] = wordsOnly(textOf(rest["4"]));
        changed = true;
      }
    }
    if (changed) {
      const { 0: _id, ...kept } = rest;
      return Object.keys(kept).length ? `add(${JSON.stringify(id)},${JSON.stringify(kept)})` : null;
    }
  }
  if (!held && op.command === "set" && STONE_NAME.test(name)) {
    notes.push(`未采纳把「${name}」放进储物袋的指令，灵石由引擎结算`);
    return null;
  }
  // the engine's good under the story's shorter name too: 「狼妖牙」 for 一阶狼妖牙, 「黄精」 for 五十年黄精
  if (!held && op.command === "set" && [...grants].some(good => good === name || (name.length > 1 && (good.endsWith(name) || name.endsWith(good))))) {
    notes.push(`「${name}」已由引擎发放，不再登记一份`);
    return null;
  }
  if (!held && op.command === "set" && gifts) return storyThing(op.data, id, base, gifts, notes);
  return undefined;
}

function normalizeStoryCommands(parseOne, base, receipts, text, biographies, cast = {}) {
  const spans = rules.splitCommands(text || "");
  if (!spans) return { text: text || "", dropped: [], notes: [] };
  // The player row as the receipts left it, when the caller hands over the remark helpers.
  let player = null;
  const row = base["0"]?.B1;
  if (row && cast.parseRemarks) {
    const columnTwo = String(row["2"] ?? "");
    const bar = columnTwo.indexOf("|");
    const remarks = cast.parseRemarks(row["9"]);
    player = {
      remarks, progress: rules.mechanics.progressValue(remarks["修为进度"]),
      realmText: (bar < 0 ? columnTwo : columnTwo.slice(0, bar)).trim(), identity: bar < 0 ? "" : columnTwo.slice(bar + 1),
      realm: rules.mechanics.parseRealm(columnTwo), ageOwned: receipts.some(r => r.ok && r.age), life: !!cast.life,
      parseRemarks: cast.parseRemarks, serializeRemarks: cast.serializeRemarks,
    };
  }
  // In a turn whose receipts moved the clock, the date and time are the engine's; the place the
  // story writes after the first slash stands. A save in the cultivation-life play holds a beat's
  // time to its own limits instead (cast.beatTime, life/scene.cjs).
  const clock = !cast.beatTime && receipts.some(r => r.ok && r.time?.minutes > 0) ? String(rules.mechanics.clockRow(base)?.["0"] ?? "") : null;
  const journey = cast.life && receipts.some(r => r.ok && r.kind === "travel");
  const present = new Set(Object.keys(base["0"] || {}));
  const registered = new Map();
  for (const r of receipts) {
    if (!r.ok || !r.commands) continue;
    for (const op of parseOne(r.commands) || []) if (op.command === "set" && /^[CG]/.test(op.data?.["0"] || "")) registered.set(characterName(op.data), op.data["0"]);
  }
  // Only a foe the receipts left unhurt: writing a full bar over a hit is still judged.
  const registeredIds = new Set([...registered.values()].filter(id => fullBar(asObject(base["0"]?.[id]?.["11"])?.["血量"])));
  const kept = [], dropped = [], notes = [], restored = new Set();
  const startingHp = target => `${target}的血量以引擎登记为准`;
  // IDs held by characters off the scene, and every ID a renumbered character may not take.
  const occupied = new Set([...(cast.knownIds || []), ...Object.keys(biographies)].filter(id => !present.has(id)));
  const taken = new Set([...present, ...occupied]);
  for (const span of spans) for (const op of parseOne(span) || []) if (op.command === "set" && op.data?.["0"]) taken.add(String(op.data["0"]));
  const renumbered = new Map();
  // What the engine handed out this turn (a purchase's good, loot): the story does not hand it again.
  const lifeGrants = new Set(receipts.filter(r => r.ok).flatMap(r => r.owns?.grants || []).map(String));
  // What the story hands the player in this beat (storyThing), in a life save.
  const gifts = cast.life ? storyGifts(base, cast.lockedItems ? [...cast.lockedItems(base)] : []) : null;
  for (const span of spans) {
    const ops = parseOne(span);
    const op = ops && ops.length === 1 ? ops[0] : null;
    const id = op ? (op.command === "set" ? op.data?.["0"] : op.id) : null;
    if (cast.beatTime && op?.command === "add" && id === "TIME_LOCATION_ROW" && op.data && Object.hasOwn(op.data, "0")) {
      const engineRow = String(rules.mechanics.clockRow(base)?.["0"] ?? "");
      if (engineRow && journey && rules.checkOwnership([op], receipts).length) {
        kept.push(`add("TIME_LOCATION_ROW",${JSON.stringify({ ...op.data, 0: engineRow })})`);
        notes.push("地点以本回合的赶路回执为准");
        continue;
      }
      const held = cast.beatTime(engineRow, String(op.data["0"] ?? ""));
      if (held.note) {
        kept.push(`add("TIME_LOCATION_ROW",${JSON.stringify({ ...op.data, 0: held.text })})`);
        notes.push(held.note);
        continue;
      }
    }
    if (clock !== null && op?.command === "add" && id === "TIME_LOCATION_ROW" && op.data && Object.hasOwn(op.data, "0")) {
      const written = String(op.data["0"] ?? "");
      const slash = written.indexOf("/"), engineSlash = clock.indexOf("/");
      const value = slash < 0 || engineSlash < 0 ? clock : clock.slice(0, engineSlash) + written.slice(slash);
      if (value !== written) {
        kept.push(`add("TIME_LOCATION_ROW",${JSON.stringify({ ...op.data, 0: value })})`);
        notes.push(`时间以引擎结算为准（${engineSlash < 0 ? clock : clock.slice(0, engineSlash)}），地点按正文所写`);
        continue;
      }
    }
    if (player && op?.command === "updateAttribute" && id === "B1" && ["修为进度", "修为", "境界"].includes(op.attribute)) {
      notes.push(`未采纳指令写的${op.attribute}，修为与境界由引擎结算`);
      dropped.push(span);
      continue;
    }
    if (cast.life && op) {
      const held = lifeNumbers(op, String(id || ""), base, lifeGrants, notes, gifts);
      if (held === null) { dropped.push(span); continue; }
      if (held !== undefined) { kept.push(held); continue; }
    }
    if (!op || !/^[BCG]/.test(String(id || ""))) {
      for (const each of ops || []) if (each.command === "set" && each.data?.["0"]) present.add(each.data["0"]);
      kept.push(span);
      continue;
    }
    let command = op.command, target = String(id), changed = false;
    if (renumbered.has(target)) { target = renumbered.get(target); changed = true; }
    if (command === "updateAttribute" && registeredIds.has(target) && ["血量", "hp"].includes(op.attribute) && fullBar(op.value)) {
      if (!notes.includes(startingHp(target))) notes.push(startingHp(target));
      continue;
    }
    let data = op.data && typeof op.data === "object" && !Array.isArray(op.data) ? { ...op.data } : null;
    if (data) {
      const removed = INTIMATE_COLUMNS.filter(column => Object.hasOwn(data, column));
      if (removed.length) {
        for (const column of removed) delete data[column];
        changed = true;
        notes.push(`未写入${target}的亲密行为字段`);
      }
      if (cast.life && /^[CG]/.test(target) && Object.hasOwn(data, "15")) {
        delete data["15"];
        changed = true;
        notes.push(`未采纳指令写的${target}好感，好感由引擎结算`);
      }
      // A life save's people have the engine's numbers too (batch 7): no write to an existing
      // one's panel, and a new one's is the engine's baseline by realm (made below).
      if (cast.life && /^[CG]/.test(target) && Object.hasOwn(data, "11")) {
        delete data["11"];
        changed = true;
        const who = characterName(base["0"]?.[target] || biographies[target] || {}) || target;
        if (present.has(target) || command !== "set") notes.push(`未采纳指令写的${who}的属性和气血，由引擎结算，伤势写在状态里`);
      }
      // The novel's protagonist is in rumours only (life/saga.cjs, plan item 39): no row of his.
      if (cast.protagonist && /^[CG]/.test(target) && (command === "set" || command === "add") && cast.protagonist(characterName(data))) {
        notes.push(`原著的主角「${characterName(data)}」只在传闻里，不上场`);
        dropped.push(span);
        continue;
      }
    }
    if (command === "set" && data) {
      const name = characterName(data);
      if (present.has(target)) { command = "add"; changed = true; }
      else if (registered.has(name)) {
        target = registered.get(name); command = "add"; changed = true;
        notes.push(`${String(id)}与本回合登记的${target}是同一人，合并为一行`);
      } else if (occupied.has(target)) {
        const bio = biographies[target];
        // Someone of the life's book away from the scene, with no biography to bring back.
        const known = bio ? null : cast.people?.[target];
        // The fallen do not come back: a new 山贼 under a dead 山贼's ID is another bandit.
        if (known?.alive && sameName(known.name, name)) {
          // back on the scene under their own ID: the book goes on with them
          present.add(target);
        } else if (bio && sameName(characterName(bio), name) && !(cast.fallen && cast.fallen(bio))) {
          kept.push(`set(${JSON.stringify(bio)})`);
          restored.add(target);
          present.add(target);
          notes.push(`${target}（${characterName(bio)}）按传记回到场上`);
          command = "add"; changed = true;
        } else {
          const fresh = rules.freeCharacterId(target[0], taken);
          taken.add(fresh);
          renumbered.set(target, fresh);
          notes.push(`${target}是离场人物「${bio ? characterName(bio) : known?.name || target}」的编号，新人物「${name}」改用${fresh}`);
          target = fresh; changed = true;
        }
      }
      if (command === "set" && /^[CG]/.test(target)) {
        const stats = asObject(data["11"]) || {};
        if (!(Number(stats["血量"]?.max ?? stats["血量"]) > 0 && "物攻" in stats)) {
          const realm = rules.mechanics.parseRealm(data["2"]);
          if (!realm.unknown) {
            data["11"] = { ...rules.mechanics.baselineStats(realm, `${cast.archiveId || ""}:${target}`), ...stats };
            changed = true;
            notes.push(`${target}（${name}）的属性按${realm.name}的常见水平生成`);
          }
        }
      }
    }
    if (data && target === "B1" && player && (command === "add" || command === "set") && ownCultivation(data, player, notes)) changed = true;
    if (data && target === "B1" && cast.life && (command === "add" || command === "set") && ownPurseAndPanel(data, base, notes)) changed = true;
    if (data && registeredIds.has(target) && command !== "set") {
      const stats = asObject(data["11"]);
      if (stats && fullBar(stats["血量"])) {
        const { 血量: _hp, ...rest } = stats;
        if (Object.keys(rest).length) data["11"] = typeof data["11"] === "string" ? JSON.stringify(rest) : rest;
        else delete data["11"];
        changed = true;
        if (!notes.includes(startingHp(target))) notes.push(startingHp(target));
      }
    }
    if (command !== "set" && !present.has(target)) {
      if (command !== "de" && biographies[target] && !restored.has(target)) {
        kept.push(`set(${JSON.stringify(biographies[target])})`);
        restored.add(target);
        present.add(target);
        notes.push(`${target}（${characterName(biographies[target])}）按传记回到场上`);
      } else if (!restored.has(target)) {
        dropped.push(span);
        continue;
      }
    }
    if (data && (command === "set" || command === "add") && !Object.keys(data).some(column => column !== "0")) {
      dropped.push(span);
      continue;
    }
    if (command === "set") present.add(target);
    if (!changed) { kept.push(span); continue; }
    if (command === "set") kept.push(`set(${JSON.stringify({ ...data, 0: target })})`);
    else if (command === "add" && data) {
      const { 0: _ignored, ...columns } = data;
      kept.push(`add(${JSON.stringify(target)},${JSON.stringify(columns)})`);
    } else kept.push(retarget(span, target));
  }
  return { text: kept.join("\n"), dropped, notes, claimedRise: player?.claimedRise || null,
    refusedGifts: gifts?.refused || [], refusedPieces: gifts?.pieces || [], bags: gifts?.bags || [] };
}

// A settled receipt's effect on the draft: its commands, the daily counts, the progress ledger and,
// in the cultivation-life play, the whole frxPlay.
async function applyReceipt(context, env, receipt) {
  if (!receipt.ok) return;
  if (receipt.commands) env.state = await applyCommands(context, env.state, receipt.commands);
  if (receipt.dailyUses !== undefined) env.dailyUses = receipt.dailyUses;
  if (receipt.frxProgress !== undefined) env.progress = receipt.frxProgress;
  if (receipt.frxPlay !== undefined) env.play = structuredClone(receipt.frxPlay);
}

async function replayReceipts(context, env, receipts) {
  for (const receipt of receipts || []) await applyReceipt(context, env, receipt);
  // A skill with a cooldown is cast once per turn, across tool rounds too.
  env.castThisTurn = new Set((receipts || []).filter(r => r.ok).flatMap(r =>
    r.kind === "use_skill" ? ["B1:" + r.skill.id] : r.attack?.skill ? [r.attack.attacker.id + ":" + r.attack.skill.id] : []));
}

async function presettleMode(input) {
  const archive = structuredClone(input.archive), errors = [];
  const context = makeContext(archive, input.seed, input.knowledge, errors, []);
  const env = engineEnv(context, archive, input.seed);
  env.plot = input.plot || null;
  const plan = rules.presettle(env, input.action);
  // A save of the cultivation life: a beat may take the player to another map place (move_place,
  // life/travel.cjs; plan item 28), prove a lead (prove_lead, item 26), note a karma entry or a heart
  // knot (note_karma, note_knot, item 40), or give the next gate its 机缘 (grant_chance, item 50's
  // fixes).
  if (Object.hasOwn(archive.data.state || {}, "frxPlay") && require("./life/index.cjs").lifeOf(archive)) {
    plan.tools = [...new Set([...(plan.tools || []), "move_place", ...Object.keys(LIFE_TOOLS)])];
  }
  if (plan.route !== "pilot") return plan;
  // A world factor that rules out mortals (全民修仙) lifts a mortal player before anything else.
  const world = rules.mechanics.worldRealm(env);
  if (world) {
    plan.receipts.unshift(world);
    await applyReceipt(context, env, world);
  }
  // A purse the character creator left as 待定 is booked once, at the realm's opening savings.
  const purse = rules.mechanics.openingPurse(env);
  if (purse) {
    plan.receipts.splice(world ? 1 : 0, 0, purse);
    await applyReceipt(context, env, purse);
  }
  for (const entry of plan.queue || []) {
    const receipt = entry.kind === "end_combat" ? rules.mechanics.combatOver(env)
      : entry.kind === "chapter_reward" ? rules.mechanics.chapterReward(env, entry)
      : entry.kind === "equip" ? rules.mechanics.equipItem(env, { item_id: entry.id, name: entry.name }, entry.source)
      : entry.kind === "unequip" ? rules.mechanics.unequipItem(env, { item_id: entry.id, name: entry.name }, entry.source)
      : rules.useItem(env, entry, entry.source);
    if (receipt.readOnly) continue;
    plan.receipts.push(receipt);
    await applyReceipt(context, env, receipt);
  }
  delete plan.queue;
  plan.receipts.forEach((receipt, index) => { receipt.id = "R" + (index + 1); });
  // What the story starts from, after the receipts above: 【修行】 and the storyline chapter.
  plan.progressText = rules.mechanics.cultivationPrompt(env);
  if (input.plot) {
    const plot = rules.mechanics.plotView({ ...env, play: archive.data.state.frxPlay }, input.plot);
    const current = plot.currentIndex === null ? null : plot.chapters[plot.currentIndex];
    plan.plotConditions = current ? current.conditions : [];
    plan.plotAllMet = plot.allMet;
    plan.plotChapter = current ? current.id : null;
  }
  return plan;
}

// The player's cultivation and the storyline's conditions for the progress panel. Read only.
async function progressMode(input) {
  const archive = structuredClone(input.archive), errors = [];
  const context = makeContext(archive, input.seed || "progress", input.knowledge, errors, []);
  const env = engineEnv(context, archive, input.seed || "progress");
  // A save in the cultivation-life play also gets what its state view's play shows (the life's
  // view: date, age, lifespan, clocks, calendar); other saves never load that code.
  const life = Object.hasOwn(archive.data.state || {}, "frxPlay") ? require("./life/index.cjs") : null;
  const play = life?.lifeOf(archive);
  if (play) {
    env.play = structuredClone(play);
    // The storyline the server hands progress mode: the life view's 接下来 leads with its chapter.
    env.plot = input.plot || null;
  }
  return {
    cultivation: rules.mechanics.cultivationView(env),
    plot: input.plot ? rules.mechanics.plotView(env, input.plot) : null,
    // The same 【修行】 text a pilot turn's prompt gets, for the plot director's input.
    progressText: rules.mechanics.cultivationPrompt(env),
    ...(play ? { life: life.view(env) } : {}),
  };
}

// The cultivation-life play (apps/engine/life/index.cjs: the input, the output and the ops). A save
// that is not in it is answered not_life before any of that code loads.
async function lifeMode(input) {
  const setup = await lifeSetup(input);
  if (!setup) return { error: "not_life" };
  const result = await setup.life.run(input, setup.env, setup.apply, (input.receipts || []).length);
  // A panel action of the life (the server's play_actions, `keep`): the tables and the frxPlay the
  // op leaves, for the server to write as the save; a turn's ops are settled by the turn instead.
  if (input.keep && !result.error && !result.errors) {
    result.kept = { currentState: setup.env.state, frxPlay: setup.env.play };
  }
  return result;
}

// What lifeMode runs an op on: the life module, the env (the turn's earlier receipts replayed) and
// the receipt applier; null for a save outside the play. Exported for tools and tests that run
// many ops in one process (tests/life_fight_sim.cjs).
async function lifeSetup(input) {
  if (!Object.hasOwn(input.archive?.data?.state || {}, "frxPlay")) return null;
  const life = require("./life/index.cjs");
  if (!life.lifeOf(input.archive)) return null;
  const archive = structuredClone(input.archive), errors = [];
  const context = makeContext(archive, input.seed || "life", input.knowledge, errors, []);
  const env = engineEnv(context, archive, input.seed || "life");
  env.play = structuredClone(life.lifeOf(archive));
  // The storyline the server hands a verb (its chapter's day stops a stretch: calendar.mainDay).
  env.plot = input.plot || null;
  for (const receipt of input.receipts || []) await applyReceipt(context, env, receipt);
  return { life, env, apply: receipt => applyReceipt(context, env, receipt) };
}

// move_place, the model's journey in a save of the cultivation life (life/travel.cjs, plan item 28):
// the life op travel on the save as the turn's receipts so far leave it (`settled`), its receipts
// folded into one: the journey's, with the commands of what the months it crossed settled after it,
// the last frxPlay and the annals lines (`chronicle`). Not yet applied: the caller applies it.
async function movePlace(input, settled, args) {
  const refused = reason => ({ kind: "travel", ok: false, readOnly: true, reason, summary: `没有赶路：${reason}`, commands: "" });
  const setup = await lifeSetup({ ...input, receipts: settled });
  if (!setup) return refused("只有修仙人生的存档这样赶路");
  const done = await setup.life.run({ op: "travel", args }, setup.env, setup.apply, settled.length);
  if (done.error) return refused(done.reason || "这一趟走不了");
  const [journey, ...after] = done.receipts.map(receipt => ({ ...receipt }));
  delete journey.id;
  const carrier = [journey, ...after].findLast(receipt => receipt.frxPlay !== undefined);
  return { ...journey, commands: [journey, ...after].map(receipt => receipt.commands).filter(Boolean).join("\n"),
           ...(carrier ? { frxPlay: carrier.frxPlay } : {}), chronicle: done.chronicle };
}

// The model's other tools in a save of the cultivation life, each a life op (plan items 26, 40 and
// 50's fixes): the op's receipts folded into one, its frxPlay and annals lines with it; a refusal is
// a read-only receipt of the tool's kind.
const LIFE_TOOLS = { prove_lead: { op: "lead", kind: "lead" }, note_karma: { op: "karma", kind: "karma" }, note_knot: { op: "knot", kind: "knot" },
  grant_chance: { op: "chance", kind: "chance" } };

async function lifeTool(input, settled, name, args) {
  const { op, kind } = LIFE_TOOLS[name];
  const refused = reason => ({ kind, ok: false, readOnly: true, reason, summary: `没有结算：${reason}`, commands: "" });
  const setup = await lifeSetup({ ...input, receipts: settled });
  if (!setup) return refused("只有修仙人生的存档用得上");
  const done = await setup.life.run({ op, args }, setup.env, setup.apply, settled.length);
  if (done.error) return refused(done.reason || "这件事核不过");
  if (!done.receipts.length) return refused("没有可结算的");
  const [first, ...after] = done.receipts.map(receipt => ({ ...receipt }));
  delete first.id;
  const carrier = [first, ...after].findLast(receipt => receipt.frxPlay !== undefined);
  return { ...first, source: "tool", commands: [first, ...after].map(receipt => receipt.commands).filter(Boolean).join("\n"),
           ...(carrier ? { frxPlay: carrier.frxPlay } : {}), ...(done.chronicle?.length ? { chronicle: done.chronicle } : {}) };
}

async function toolsMode(input) {
  const archive = structuredClone(input.archive), errors = [];
  const context = makeContext(archive, input.seed, input.knowledge, errors, []);
  const env = engineEnv(context, archive, input.seed);
  await replayReceipts(context, env, input.receipts);
  let ordinal = (input.receipts || []).length;
  const results = [], settled = [...(input.receipts || [])];
  // A use may name the item a claim in this turn just moved (the NPC's own ID), or an item
  // bought this turn by its name.
  const aliases = {};
  for (const receipt of input.receipts || []) {
    if (receipt.kind === "claim_item" && receipt.ok && receipt.claimedId) aliases[receipt.claimedId] = receipt.item.id;
    if (receipt.kind === "trade_item" && receipt.ok && receipt.direction === "buy") aliases[receipt.item.name] = receipt.item.id;
  }
  for (const call of input.calls || []) {
    let args;
    try {
      args = JSON.parse(call.arguments || "{}");
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
    } catch {
      results.push({ id: call.id, name: call.name, receipt: { kind: call.name, ok: false, readOnly: true, reason: "参数不是有效的JSON对象", summary: "工具参数无效，未结算", commands: "" } });
      continue;
    }
    let receipt;
    if (call.name === "lookup_inventory") receipt = rules.lookupInventory(env, args);
    else if (call.name === "use_item") {
      const id = String(args.item_id || "");
      receipt = rules.useItem(env, { id: env.state["1"]?.[id] ? id : aliases[id] || id, quantity: args.quantity ?? 1, consumed: true }, "tool");
    } else if (call.name === "claim_item") {
      receipt = rules.claimItem(env, { ...args, quantity: args.quantity ?? 1 }, "tool");
      if (receipt.ok) { receipt.claimedId = String(args.item_id || ""); aliases[receipt.claimedId] = receipt.item.id; }
    }
    else if (call.name === "resolve_check") receipt = rules.resolveCheck(env, args, "tool", ordinal);
    else if (call.name === "resolve_attack") receipt = rules.mechanics.resolveAttack(env, args, "tool", ordinal);
    else if (call.name === "use_skill") receipt = rules.mechanics.useSkill(env, args, "tool");
    else if (call.name === "update_quest") receipt = rules.mechanics.updateQuest(env, args, "tool");
    else if (call.name === "rest") receipt = rules.mechanics.rest(env, args, "tool");
    else if (call.name === "cultivate") receipt = rules.mechanics.cultivate(env, args, "tool");
    else if (call.name === "breakthrough") receipt = rules.mechanics.breakthrough(env, args, "tool", ordinal);
    else if (call.name === "trade_item") {
      receipt = rules.mechanics.tradeItem(env, args, "tool");
      if (receipt.ok && receipt.direction === "buy") aliases[receipt.item.name] = receipt.item.id;
    }
    else if (call.name === "move_place") receipt = await movePlace(input, settled, args);
    else if (Object.hasOwn(LIFE_TOOLS, call.name)) receipt = await lifeTool(input, settled, call.name, args);
    else receipt = { kind: call.name, ok: false, readOnly: true, reason: "没有这个工具", summary: "未知工具，未结算", commands: "" };
    if (!receipt.readOnly) {
      receipt.id = "R" + (ordinal + 1);
      ordinal += 1;
      await applyReceipt(context, env, receipt);
      settled.push(receipt);
    }
    results.push({ id: call.id, name: call.name, receipt });
  }
  return { results };
}

// Score a finished story against settled receipts (used by the side-by-side harness).
async function storyMode(input) {
  const archive = structuredClone(input.archive), errors = [];
  const context = makeContext(archive, input.seed || "story", input.knowledge, errors, []);
  const env = engineEnv(context, archive, input.seed || "story");
  return { mismatches: rules.checkStory(env, input.story || "", input.receipts || []) };
}

// Report only operations that would change a value the receipts settled.
async function effectiveViolations(context, archive, delta, receipts) {
  const sets = rules.ownedSets(receipts);
  const flagged = delta.filter(op => rules.checkOwnership([op], receipts).length);
  if (!flagged.length) return [];
  const base = await applyCommands(context, structuredClone(archive.data.state.currentState),
    receipts.filter(r => r.ok && r.commands).map(r => r.commands).join("\n"));
  const violations = [];
  for (const op of flagged) {
    const forbidden = rules.checkOwnership([op], receipts).filter(v => v.includes('检定未成功'));
    if (forbidden.length) { violations.push(...forbidden); continue; }
    context.probeState = structuredClone(base);
    context.probeDelta = [op];
    const after = (await vm.runInContext("applyChanges(probeState, probeDelta, {persistEffects:false})", context, { timeout: 1500 })).newState;
    if (rules.ownedValues(context, after, sets, after) !== rules.ownedValues(context, base, sets, after)) violations.push(...rules.checkOwnership([op], receipts));
  }
  return [...new Set(violations)];
}

// Where the receipts leave a player of the cultivation life (turn-rules.cjs lifeOwns' `where`): the
// map place of the last time row they write, else of the save's own, read on the save's map.
function lifeWhere(archive, receipts) {
  const places = require("./life/places.cjs");
  const of = text => places.factsOf(text, archive.data.state.worldMap).place;
  let row = String(rules.mechanics.clockRow(archive.data.state.currentState)?.["0"] ?? "");
  for (const receipt of receipts) {
    if (!receipt.ok || typeof receipt.commands !== "string") continue;
    for (const [, data] of receipt.commands.matchAll(/^add\("TIME_LOCATION_ROW",(\{.*\})\)$/gm)) {
      try { row = String(JSON.parse(data)["0"] ?? row); } catch { /* not a row this reads */ }
    }
  }
  const slash = row.indexOf("/");
  return { place: slash < 0 ? null : of(row.slice(slash + 1)), of };
}

async function settle(input) {
  const errors = [];
  const archive = structuredClone(input.archive);
  const initialArchive = structuredClone(archive), settingsWrites = [];
  // A save in the cultivation-life play: its favour, time row, map place and frxPlay are the
  // engine's (turn-rules.cjs lifeOwns). Other saves never load the life code.
  const life = Object.hasOwn(archive.data?.state || {}, "frxPlay") && !!require("./life/index.cjs").lifeOf(archive);
  const lifeReceipts = receipts => (life ? [...receipts, rules.lifeOwns(lifeWhere(archive, receipts))] : receipts);
  // Receipts that settle after the story (afterStory): what the engine did with something the
  // story's own commands brought, the opening's first method put on (plan item 25). Their commands
  // come after the model's, and nothing reads them before the story; the rest come first.
  const storyFirst = (input.pilot?.receipts || []).filter(receipt => !receipt?.afterStory);
  const storyAfter = (input.pilot?.receipts || []).filter(receipt => receipt?.afterStory);
  const context = makeContext(archive, input.seed, input.knowledge, errors, settingsWrites);
  context.commandText = input.commands;
  let modelCommands, pilotDropped = [], pilotNotes = [], storyScene = null, pilotClaimedRise = null, pilotRealm = null;
  // In a life save, the catalogue's goods past the beat's cap the story's commands were refused
  // (storyThing), and the bags handed over for the engine to open.
  let pilotRefusedGifts = [], pilotRefusedPieces = [], pilotBags = [];
  if (input.pilot) {
    // Parse candidates in a scratch context so the settlement's seeded random
    // sequence is consumed exactly as the client will consume it.
    const scratch = makeContext(structuredClone(archive), "dedupe", input.knowledge, [], []);
    const parseOne = text => {
      scratch.oneText = text; scratch.oneErrors = [];
      vm.runInContext("var oneParsed = parseTableEditCommands(oneText, oneErrors);", scratch, { timeout: 1500 });
      return scratch.oneErrors.length ? null : scratch.oneParsed.delta;
    };
    const receipts = lifeReceipts(storyFirst);
    const cleaned = rules.dropReceiptRepeats(parseOne, input.commands, receipts);
    // Ownership is judged by effect: a command that leaves every engine-owned
    // value as the receipts set it is harmless. One that touches only owned
    // values is dropped; one that also changes other fields is kept as it is.
    const sets = rules.ownedSets(receipts);
    const spans = rules.splitCommands(cleaned.text);
    if (spans && rules.hasOwned(sets)) {
      const base = await applyCommands(scratch, structuredClone(archive.data.state.currentState),
        receipts.filter(r => r.ok && r.commands).map(r => r.commands).join("\n"));
      const kept = [];
      for (const span of spans) {
        const ops = parseOne(span);
        if (!ops || !rules.checkOwnership(ops, receipts).length) { kept.push(span); continue; }
        let after = null;
        try { after = await applyCommands(scratch, base, span); } catch { after = null; }
        const harmless = after && rules.ownedValues(scratch, after, sets, after) === rules.ownedValues(scratch, base, sets, after);
        if (!harmless || !ops.every(op => rules.ownedOnly(op, sets))) kept.push(span);
      }
      cleaned.text = kept.join("\n");
    }
    const afterReceipts = await applyCommands(scratch, structuredClone(archive.data.state.currentState),
      receipts.filter(r => r.ok && r.commands).map(r => r.commands).join("\n"));
    pilotRealm = afterReceipts["0"]?.B1?.["2"] ?? null;
    const normalized = normalizeStoryCommands(parseOne, afterReceipts, receipts, cleaned.text, biographiesOf(scratch, archive), {
      knownIds: knownIdsOf(archive), people: bookOf(archive),
      archiveId: archive.data.archiveId || archive.name,
      fallen: row => rules.mechanics.isFallen(scratch, row),
      parseRemarks: value => scratch.parseRemarksString(value),
      serializeRemarks: value => scratch.serializeRemarksObject(value),
      ...(life ? { life: true, beatTime: require("./life/scene.cjs").beatTime, protagonist: require("./life/saga.cjs").protagonist,
        lockedItems: state => scratch.storedItemIds(state) } : {}),
    });
    cleaned.text = normalized.text;
    pilotClaimedRise = normalized.claimedRise;
    pilotRefusedGifts = normalized.refusedGifts || [];
    pilotRefusedPieces = normalized.refusedPieces || [];
    pilotBags = normalized.bags || [];
    cleaned.dropped.push(...normalized.dropped);
    pilotNotes = normalized.notes;
    // A fallen character the player leaves behind, or whose body the story carries off, leaves
    // the scene. Only while the card keeps biographies: without them the row would be lost.
    const keepsBiographies = input.knowledge?.knowledgeBaseEnabled && input.knowledge?.attachBiographyToSnapshot;
    if (keepsBiographies) try {
      const story = input.pilot.story || input.story || "";
      const after = await applyCommands(scratch, afterReceipts, cleaned.text);
      const touched = new Set();
      for (const span of rules.splitCommands(cleaned.text) || []) {
        for (const op of parseOne(span) || []) touched.add(String(op.command === "set" ? op.data?.["0"] : op.id));
      }
      const fellNow = new Set(receipts.filter(r => r.ok).flatMap(r => (r.attack?.strikes || []).filter(s => s.defeated).map(s => s.at)));
      for (const { id, name, moved } of rules.fallenLeftBehind(scratch, archive.data.state.currentState, after, story, { touched, fellNow })) {
        cleaned.text = [cleaned.text, `de(${JSON.stringify(id)})`].filter(Boolean).join("\n");
        pilotNotes.push(`${id}（${name}）倒地后${moved ? "留在原处" : "已被带离"}，移出在场人物，传记保留`);
      }
    } catch { /* a block that cannot apply is reported by the regular checks below */ }
    // A fight whose foes have all left the scene, or stopped fighting, ends in this turn rather
    // than at the start of the next one.
    try {
      const rows = (await applyCommands(scratch, afterReceipts, cleaned.text))["0"] || {};
      const marked = value => String(value).trim() === "true";
      if (marked(rows.B1?.["31"]) && !Object.entries(rows).some(([id, row]) => id !== "B1" && row && marked(row["31"]))) {
        const clears = Object.entries(rows).filter(([, row]) => row && (marked(row["31"]) || marked(row["32"])))
          .map(([id, row]) => `add(${JSON.stringify(id)},${JSON.stringify({
            ...(marked(row["31"]) ? { 31: "false" } : {}), ...(marked(row["32"]) ? { 32: "false" } : {}) })})`);
        cleaned.text = [cleaned.text, ...clears].filter(Boolean).join("\n");
        pilotNotes.push("敌人都已离场或罢手，战斗结束，战斗标记已清除");
      }
    } catch { /* a block that cannot apply is reported by the regular checks below */ }
    // The scene as the story leaves it, for the story checks below.
    try {
      const after = await applyCommands(scratch, afterReceipts, cleaned.text);
      const worn = scratch.equippedItemRows(after["0"]?.B1).map(item => String(item.name || item["1"] || "").replace(/<[^>]*>/g, "").split("|")[0]);
      const purseText = row => String(row?.["26"] ?? "").trim();
      storyScene = {
        bag: new Set([...Object.values(after["1"] || {}).map(row => characterName(row)), ...worn]),
        npcs: Object.entries(after["0"] || {}).filter(([id]) => id !== "B1").map(([, row]) => characterName(row)).filter(Boolean),
        player: characterName(after["0"]?.B1),
        // 当前灵石 as the receipts left it and as the story's commands leave it.
        purse: {
          base: rules.mechanics.stonesOf(afterReceipts["0"]?.B1), final: rules.mechanics.stonesOf(after["0"]?.B1),
          text: purseText(after["0"]?.B1), changed: purseText(after["0"]?.B1) !== purseText(afterReceipts["0"]?.B1),
        },
        // Stones the commands put in the bag as an item: they belong in 当前灵石.
        stoneItems: Object.entries(after["1"] || {})
          .filter(([id, row]) => row && !afterReceipts["1"]?.[id] && /^(?:下品|中品|上品|极品)?灵石$/.test(characterName(row)))
          .map(([, row]) => characterName(row)),
      };
    } catch { storyScene = null; }
    pilotDropped = cleaned.dropped;
    context.commandText = modelCommands = cleaned.text;
  }

  context.errorMessages = [];

  vm.runInContext("var parsed = parseTableEditCommands(commandText, errorMessages);", context, { timeout: 1500 });
  if (context.errorMessages.length) return { errors: context.errorMessages };
  let { delta, smallSummary, largeSummary } = context.parsed;
  let pilot = null, pilotDailyUses, pilotProgress, pilotPlay;
  if (input.pilot) {
    // Receipt commands come first and are trusted; the model's commands may not
    // touch what a receipt settled, and the story may not contradict a receipt.
    const receipts = lifeReceipts(storyFirst);
    context.receiptText = receipts.filter(r => r.ok && r.commands).map(r => r.commands).join("\n");
    context.receiptErrors = [];
    vm.runInContext("var receiptParsed = parseTableEditCommands(receiptText, receiptErrors);", context, { timeout: 1500 });
    if (context.receiptErrors.length) return { errors: ["引擎回执指令无效"] };
    const env = engineEnv(context, archive, input.seed);
    const story = input.pilot.story || input.story || "";
    // A life save's story is read against the realm the receipts leave (a stretch of 修炼 that
    // climbed layers is no breakthrough claimed); the novel's as before.
    const mismatches = rules.checkStory(env, story, receipts, life && pilotRealm ? { realm: pilotRealm } : undefined);
    // A breakthrough only happens through the breakthrough tool: a story whose commands wrote a
    // higher realm without one has told the player something that did not happen.
    const rose = receipts.some(r => r.ok && (r.kind === "breakthrough" || r.kind === "world_rule"));
    if (pilotClaimedRise && !rose && rules.claimsBreakthrough(story)) {
      mismatches.push(`正文与指令写了突破到${pilotClaimedRise}，但本回合没有成功的突破回执，境界没有改变；正文不要写突破成功、踏入新境界或成为修士`);
    }
    if (storyScene) {
      for (const message of rules.refusedConsumption(story, receipts, storyScene.npcs)) {
        const name = message.match(/「([^」]+)」/)?.[1];
        if (!mismatches.some(m => name && m.includes(`「${name}」`))) mismatches.push(message);
      }
      // A bag handed over is the engine's to open after the story, and a good past the beat's cap
      // was left out on purpose: the story is told so, rather than to register it again.
      const known = new Set([...storyScene.bag, ...pilotBags.map(bag => bag.name), ...pilotRefusedGifts]);
      mismatches.push(...rules.storyAcquisitions(story, known, [storyScene.player, "你", "主角"], storyScene.npcs));
      // a piece is had by paying its price: a promise to hand it over later would be refused again
      for (const name of pilotRefusedGifts) {
        mismatches.push(pilotRefusedPieces.includes(name)
          ? `「${name}」太贵重，不是剧情里白给得起的，储物袋里没有登记；正文改成这一回没有给，主角想要就用「买卖」卡照价买，不许诺日后白给`
          : `「${name}」太贵重，不是剧情里白给得起的，储物袋里没有登记；正文改成对方没有给，或者许诺日后再给`);
      }
    }
    // Stones the story moved but the commands did not book. The story stands; only the state block
    // is redone, so these are kept apart from the mismatches above. Never in a life save: its purse
    // is the engine's, and the story's commands cannot book stones there (ownPurseAndPanel).
    const bookkeeping = [];
    if (storyScene?.purse && !life) {
      const purse = storyScene.purse;
      for (const name of new Set(storyScene.stoneItems)) {
        bookkeeping.push(`灵石记在当前灵石（B1第26列），不进储物袋：去掉把「${name}」登记进储物袋的指令，改用add("B1",{"26":"新的总数"})记上`);
      }
      if (purse.changed && purse.final === null) {
        bookkeeping.push(`当前灵石要写成不小于0的整数（下品灵石的块数，中品灵石按100块折算），指令写成了「${purse.text.slice(0, 20)}」`);
      } else if (!storyScene.stoneItems.length && !receipts.some(r => r.ok && r.owns?.currency)) {
        bookkeeping.push(...rules.purseBookkeeping(story, purse, [storyScene.player, "你", "主角"], storyScene.npcs));
      }
    }
    pilot = { ownership: await effectiveViolations(context, archive, delta, receipts), mismatches: [...new Set(mismatches)], bookkeeping, dropped: pilotDropped, notes: pilotNotes,
      ...(pilotBags.length ? { bags: pilotBags } : {}) };
    delta = [...context.receiptParsed.delta, ...delta];
    if (storyAfter.length) {
      context.lateText = storyAfter.filter(r => r.ok && r.commands).map(r => r.commands).join("\n");
      context.lateErrors = [];
      vm.runInContext("var lateParsed = parseTableEditCommands(lateText, lateErrors);", context, { timeout: 1500 });
      if (context.lateErrors.length) return { errors: ["引擎回执指令无效"] };
      delta = [...delta, ...context.lateParsed.delta];
    }
    context.parsed.delta = delta;
    for (const receipt of [...receipts, ...storyAfter]) if (receipt.ok && receipt.dailyUses !== undefined) pilotDailyUses = receipt.dailyUses;
    // The progress ledger (cooldown, windfalls, storyline rewards), whole, when a receipt moved it.
    for (const receipt of [...receipts, ...storyAfter]) if (receipt.ok && receipt.frxProgress !== undefined) pilotProgress = receipt.frxProgress;
    // The cultivation-life play's frxPlay, whole, from the last receipt that carries it.
    for (const receipt of [...receipts, ...storyAfter]) if (receipt.ok && receipt.frxPlay !== undefined) pilotPlay = receipt.frxPlay;
  }
  if (input.evolution) {
    const byKey = new Map((archive.data.state.worldBookEntries || []).map(b => [b.key, b]));
    const allowed = new Set(input.evolution.targets || []);
    const onScreen = new Set(Object.keys(archive.data.state.currentState['0'] || {}));
    const rows = {};
    for (const id of allowed) {
      const bio = byKey.get(id);
      if (!bio || onScreen.has(id) || !/^[CG][A-Za-z0-9_-]{1,127}$/.test(id)) { errors.push('不能演化在场或未知人物 ' + id); continue; }
      let row;
      try { row = JSON.parse(bio.content); } catch { row = context.parseSnapshotToRowObject(bio.content); }
      if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push('人物快照无效 ' + id); continue; }
      rows[id] = {...row, '0':id, '1':row['1'] || bio.title};
    }
    const permitted = new Set(['add','set','de','updateAttribute','equipItem','unequipItem','addItem','addSkill','addTrait']);
    for (const op of delta) {
      const id = op.id || op.data?.['0'];
      if (!permitted.has(op.command) || !allowed.has(id) || !rows[id] || (op.command === 'de' && !op.subCategory)) errors.push('演化指令超出目标人物范围 ' + (id || op.command));
    }
    const summaries = input.evolution.summaries || [];
    for (const entry of summaries) if (!allowed.has(entry.id) || !rows[entry.id] || typeof entry.text !== 'string') errors.push('履历与演化人物不匹配');
    if (errors.length) return {errors};
    context.evolutionState = {'0':rows,'1':{},'6':{},'7':{},'8':{}};
    const result = await vm.runInContext('applyChanges(evolutionState, parsed.delta, {persistEffects:false})', context, {timeout:1500});
    if (errors.length) return {errors};
    const changed = new Set(result.updatedCharacterIds || []);
    for (const id of changed) {
      const previous = String(rows[id]?.['35'] || '').trim();
      const current = String(result.newState['0'][id]?.['35'] || '').trim();
      if (previous && !current.includes(previous)) result.newState['0'][id]['35'] = [previous,current].filter(Boolean).join('\n');
    }
    for (const entry of summaries) {
      const row = result.newState['0'][entry.id];
      const previous = String(row['35'] || '');
      if (entry.text.trim() && !previous.includes(entry.text.trim())) row['35'] = [previous,entry.text.trim()].filter(Boolean).join('\n');
      changed.add(entry.id);
    }
    return {biographies:[...changed].map(id=>({...byKey.get(id),content:JSON.stringify(result.newState['0'][id])})),
      npcAvatars:archive.data.state.npcAvatars || {}, errors};
  }
  const knownState = structuredClone(archive.data.state.currentState);
  for (const op of delta) {
    const id = op.command === "set" ? op.data?.["0"] : op.id;
    const table = id ? context.getTableIndexFromId(id) : null;
    if (table === '1' && ['add', 'set'].includes(op.command) && Object.hasOwn(op.data, '5')) {
      const count = context.itemStackCount(op.data['5']);
      if (!Number.isSafeInteger(count)) errors.push("物品数量必须是非负整数 " + id);
      if (count === 0) {
        if (!knownState[table]?.[id]) errors.push("新增物品数量必须大于零 " + id);
        op.command = 'de';
        op.id = id;
        delete op.data;
      }
    }
    if (["add","de","updateAttribute","equipItem","unequipItem","addItem","addSkill","addTrait"].includes(op.command)
      && id !== "TIME_LOCATION_ROW") {
      const exists = knownState[table]?.[id];
      if (!exists) errors.push("目标实体不存在 " + id);
    }
    if (op.command === "de" && id === "B1") errors.push("玩家实体不能删除");
    if (op.command === "set" && !context.getTableIndexFromId(id)) errors.push("新增实体ID无效");
    if (op.command === "set" && table) {
      knownState[table] ||= {};
      knownState[table][id] = op.data;
    }
    if (op.command === "de" && !op.subCategory && table) delete knownState[table]?.[id];
  }
  if (errors.length) return { errors };
  context.stateInput = structuredClone(archive.data.state.currentState);
  const wornBefore = structuredClone(archive.data.state.currentState);
  const result = await vm.runInContext("applyChanges(stateInput, parsed.delta, {persistEffects:false})", context, { timeout: 1500 });
  if (errors.length) return { errors };
  // A turn's settlement (it has a story) reports the gear its commands moved; a bare block of
  // commands returns exactly what the card's own settlement returned.
  const gear = "story" in input ? gearReceipts(context, wornBefore, result.newState, input.pilot?.receipts || []) : [];
  if (pilot && life && storyScene) {
    const before = inventoryCounts(context, initialArchive.data.state.currentState);
    const gained = [...inventoryCounts(context, result.newState)]
      .filter(([name, count]) => count > (before.get(name) || 0)).map(([name]) => name);
    const story = input.pilot.story || input.story || "";
    const player = [storyScene.player, "你", "主角"];
    const missing = [
      ...rules.collectiveLootGaps(story, gained, player, storyScene.npcs),
      ...rules.storyPurchaseGaps(story, gained, lifeReceipts(storyFirst), player, storyScene.npcs),
    ];
    if (missing.length) pilot.acquisitions = missing;
  }
  let dailyItemUses = pilotDailyUses;
  if (input.action && !input.pilot) {
    try {
      dailyItemUses = reconcileItemUse({ action: input.action, story: input.story || '', before: context.stateInput,
        after: result.newState, delta, storedItemIds: context.storedItemIds, itemStackCount: context.itemStackCount,
        equipped: context.equippedItemRows(context.stateInput['0']?.B1),
        readStats: context.parseNestedJsonString,
        dailyUses: archive.data.state.dailyItemUses });
    } catch (error) {
      return { errors: [error.message], itemUseError: error.message };
    }
  }
  context.settledState = result.newState;
  context.changedCharacters = result.updatedCharacterIds;
  context.newLog = {id: '__frx_settlement__'};
  await vm.runInContext("autoGenerateCharacterWorldBooks(changedCharacters, newLog, settledState)", context, { timeout: 1500 });
  const biographyPatches = archive.data.logs.flatMap((log, index) =>
    JSON.stringify(log.biographySnapshot) !== JSON.stringify(initialArchive.data.logs[index]?.biographySnapshot)
      ? [{id:log.id, index, value:log.biographySnapshot}] : []);
  return { state: result.newState, worldMap: context.WORLD_MAP_DATA,
           ...(dailyItemUses ? {dailyItemUses} : {}),
           ...(pilotProgress ? { frxProgress: pilotProgress } : {}),
           ...(pilotPlay ? { frxPlay: pilotPlay } : {}),
           npcAvatars: archive.data.state.npcAvatars || {},
           settingsWrites: result.settingsWrites || settingsWrites,
           biographySnapshot: context.newLog.biographySnapshot || null,
           biographyPatches, smallSummary, largeSummary, delta, errors,
           ...(gear.length ? { gearReceipts: gear } : {}),
           ...(pilot ? { pilot, modelCommands } : {}) };
}

// The whole-turn settle; a turn that asks for it (input.afterProgress { plot? }: a verb's turn the
// engine settles alone) also gets the progress of the state it leaves (afterProgress), the state
// view the server builds once the turn is committed, read here rather than in a process of its own.
// The settled save is the input archive with the settlement's tables, frxPlay, ledger, daily uses
// and map; its logs as they were (progress reads only the opening's world rules from them). A
// failure leaves it out: the server reads it again.
async function settleTurn(input) {
  const result = await settle(input);
  if (!input.afterProgress || result.errors?.length) return result;
  try {
    const archive = structuredClone(input.archive);
    const state = archive.data.state;
    state.currentState = result.state;
    if (result.worldMap) state.worldMap = result.worldMap;
    for (const key of ['frxPlay', 'frxProgress', 'dailyItemUses']) if (result[key] !== undefined) state[key] = result[key];
    const plot = input.afterProgress.plot;
    result.afterProgress = await progressMode({ archive, ...(plot ? { plot } : {}) });
  } catch { /* left out */ }
  return result;
}

// Gear the story's own commands put on or took off (equipItem, unequipItem). The engine's equip
// and unequip receipts tell what they settled; for the rest a receipt is made here, as the
// engine's own would read, settling nothing (no commands, owning nothing): the commands already
// did it, and the turn shows it like any other settlement.
function gearReceipts(context, before, after, receipts) {
  const settled = new Set(receipts.filter(r => r.ok && /^(?:un)?equip_item$/.test(r.kind)).map(r => r.item?.id));
  const worn = state => {
    try {
      return new Map(rules.mechanics.wornGear({ ctx: context, state }).worn.filter(w => w.id && !settled.has(w.id)).map(w => [w.id, w]));
    } catch { return new Map(); }
  };
  const was = worn(before), now = worn(after), made = [];
  const owns = () => ({ items: [], stats: [], forbid: [], charStats: [], skills: [], quests: [], grants: [], currency: false });
  for (const [id, item] of now) {
    if (was.has(id)) continue;
    made.push({ kind: 'equip_item', ok: true, source: 'story', item: { id, name: item.name }, slot: item.slot, index: item.index,
      commands: '', owns: owns(), summary: `装备「${item.name}」于${item.type || '装备'}栏第${item.index + 1}格` });
  }
  for (const [id, item] of was) {
    if (now.has(id)) continue;
    made.push({ kind: 'unequip_item', ok: true, source: 'story', item: { id, name: item.name }, slot: item.slot, index: item.index,
      commands: '', owns: owns(), summary: `卸下「${item.name}」` + (after['1']?.[id] ? '，放回储物袋' : '') });
  }
  return made;
}

if (require.main === module) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => buffer += chunk);
  process.stdin.on("end", async () => {
    try {
      const input = JSON.parse(buffer);
      const handler = { presettle: presettleMode, tools: toolsMode, story: storyMode, progress: progressMode, life: lifeMode }[input.mode] || settleTurn;
      process.stdout.write(JSON.stringify(await handler(input)));
    }
    catch (error) { process.stdout.write(JSON.stringify({ errors: [error.message] })); process.exitCode = 1; }
  });
}

module.exports = { lifeSetup };
