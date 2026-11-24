/* Engine rules for pilot turns: pre-settlement, tool calls and story checks.
 * Each result is a receipt that carries the original card's commands, so the
 * server settlement and the client preview apply exactly the same change.
 * `env` supplies the card helpers loaded by settle.cjs and the current draft.
 */
const fs = require('node:fs');
const path = require('node:path');
const { create } = require('./core/random.cjs');
const { itemEvents, trackStock, checkLimits, plain } = require('./item-use.cjs');
const mechanics = require('./mechanics.cjs');

const RULES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../content/checks.json'), 'utf8'));
const EXPENDABLE = ['消耗品', '丹药', '药品', '药水', '食物'];
const STAT_ALIASES = { 法力: '法力', 灵力: '法力', 血量: '血量', 气血: '血量', 生命值: '血量', 生命: '血量' };
// Asking around (打听) is ordinary talk; a check is offered when the other side may refuse.
// The words by what the player is doing (the life mode sorts sentences into action kinds with
// them); CHECK_WORDS is all of them, in this order.
const CHECK_GROUPS = {
  talk: '求教|请教|传授|指点|教我|收我为徒|借我|借给我|说服|劝说|恳求|哀求|讨价|还价|砍价|套话|威胁|交涉|拜师|求情|赊',
  dare: '攀|爬上|跳下|跳过|闯|硬接|硬抗|格挡',
  dodge: '躲|闪避|闪开|逃|脱身',
  sneak: '潜入',
  fall: '涉水|渡河|坠|摔',
};
const CHECK_WORDS = new RegExp(Object.values(CHECK_GROUPS).join('|'));
const TRADE_WORDS = /买|购|卖|售|兑换|交换|典当|收购|以物易物|换(?:取|得|来|成|回|些|点|个|一|两|几)|(?:用|拿|以)[^，。；,;]{1,12}?换/;
const COMBAT_WORDS = /切磋|比试|过招|较量|攻击|偷袭|袭击|突袭|对战|迎战|应战|战斗|交手|搏杀|厮杀|搏斗|出手|斗法|反击|还击|围攻|劈|砍|刺向|斩|拍向|打向|击向|拍散|拍死|打死|击退|击杀|杀了|杀死|宰了|一剑|一刀|一掌|一拳|挥(?:剑|刀|棍|拳|掌)|抡起|飞剑|火球|火弹|冰锥|雷击/;
const SKILL_WORDS = /施展|施法|使出|发动|掐诀|念咒|法术|神通|术法/;
const QUEST_WORDS = /禀报|复命|交差|交付|任务|领赏|报酬|酬劳|工钱|赏钱|谢礼|赏金|放弃/;
const ITEM_TOOLS = ['lookup_inventory', 'claim_item', 'use_item'];
const REST_WORDS = /打坐|调息|休息|歇息|歇一|小憩|睡|躺下|闭目养神|运功疗伤|疗伤|休养|修养|养伤/;
// Cultivating and breaking through are settled by the engine. 打坐 offers both cultivating and
// resting; only a plain cultivation or breakthrough attempt forces a tool round.
const CULTIVATE_WORDS = /修炼|修行|吐纳|运功|运转功法|炼化|闭关|参悟|感应灵气|引气|打坐/;
// Used as a modifier (修炼功法, 闭关之地, 突破的契机) the word names a thing, not the act.
const MODIFIER = '(?!之|的|用|所|室|场|功法|法门|资源|心得|经验|秘籍|典籍|材料|方法|速度|进度|契机|机缘)';
const CULTIVATE_NOW = new RegExp(`(?:修炼|闭关|吐纳|运转功法|感应灵气|参悟(?:功法|心法|法诀|经文|口诀))${MODIFIER}`);
const BREAKTHROUGH_WORDS = /突破(?!重围|包围|封锁|防线|阵法|禁制|结界|围困|口)|冲关|冲击瓶颈|冲击[^，,。；;！!？?]{0,8}境界|冲击(?:炼气|练气|筑基|结丹|金丹|元婴|化神|炼虚|合体|大乘|渡劫)|引气入体/;
const BREAKTHROUGH_NOW = new RegExp(`(?:${BREAKTHROUGH_WORDS.source})${MODIFIER}`);
// A question, a plan that may not happen, a refusal or asking someone about it is not doing it.
const NOT_DOING = /[？?]|能否|可否|要不要|是否|如果|假如|倘若|若是|万一/;
const REFUSING = /(?:不想|不要|别|不必|不用|暂不|不再|没有|没|未|并未)(?:再|先|去|急着)?(?:修炼|修行|闭关|吐纳|突破|冲关|冲击|参悟)/;
const ASKING = /请教|求教|讨教|询问|打听|问问|心得|之法|经验|秘诀|门道|怎么|如何|怎样/;
// Wearing, wielding and putting away gear; wielding verbs apply to weapons, 祭出 to treasures.
const WEAR = '装备|穿上|佩戴|戴上|披上|换上|系上|佩上';
const WIELD = '拔出|抽出|亮出|拿起|握住|握紧|抡起|挥起|挥动|举起|抄起|提起|手持|持着';
const UNWEAR = '卸下|脱下|摘下|解下|取下|收起';
// Taking up a method is equipping it: 研读《长春功》, 改修…, 纳为主修功法.
const LEARN = '修习|修炼|研读|研习|参悟|参习|习练|练习|运转|主修|改修|纳为|转修|学习|领悟';
const GEAR_NAME = /(?:剑|刀|枪|棍|鞭|弓|斧|锤|戟|矛|匕|甲|袍|衣|靴|盾|冠|带|环|戒|镯|佩|符|箓|镜|珠|印|鼎|钟|塔|葫芦|幡|旗|扇|针|梭|尺|轮|伞|铃|功|经|诀|典|录|卷|简)$/;

function expendable(type, consumed) {
  return !type || EXPENDABLE.includes(type) || (type === '材料' && consumed);
}

function parseEffects(text) {
  const source = plain(text);
  const found = new Map();
  const add = (stat, amount) => {
    const key = stat === '修为' ? stat : STAT_ALIASES[stat];
    if (key && amount > 0 && !found.has(key)) found.set(key, amount);
  };
  for (const m of source.matchAll(/(?:恢复|回复|补充|增加|提升)(?:了)?\s*(\d+)\s*点?\s*(法力|灵力|血量|气血|生命值|生命)/g)) add(m[2], Number(m[1]));
  for (const m of source.matchAll(/(法力|灵力|血量|气血|生命值|生命)\s*(?:恢复|回复|回升|增加|提升|\+|＋)\s*(\d+)/g)) add(m[1], Number(m[2]));
  // Cultivation progress: 修为+5, 修为进度+5, 增加5点修为. The engine settles it like a windfall.
  for (const m of source.matchAll(/修为(?:进度)?\s*(?:\+|＋|增加|提升|提高|增长|精进)(?:了)?\s*(\d+)/g)) add('修为', Number(m[1]));
  for (const m of source.matchAll(/(?:增加|提升|提高|增长|精进)(?:了)?\s*(\d+)\s*点?\s*修为/g)) add('修为', Number(m[1]));
  return [...found].map(([stat, amount]) => ({ stat, amount }));
}

function rowName(row) { return plain(row?.['1']).split('|')[0]; }

function playerStats(env) {
  const stats = env.ctx.parseNestedJsonString(env.state['0']?.B1?.['11'], {});
  return stats && typeof stats === 'object' ? stats : {};
}

function bagStacks(env) {
  const locked = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {})
    .filter(([id, row]) => row && !locked.has(id))
    .map(([id, row]) => ({ id, row, name: rowName(row), type: row['2'], count: env.ctx.itemStackCount(row['5']) }));
}

function refusal(kind, item, quantity, reason, source) {
  return { kind, ok: false, source, item, quantity, reason, commands: '', owns: { items: [], stats: [], forbid: [] },
           summary: `未能${kind === 'claim_item' ? '取得' : '使用'}${item?.name ? '「' + item.name + '」' : '道具'}：${reason}` };
}

// What the cultivation life adds to taking a pill (life/poison.cjs, plan item 44: 丹毒 and 耐药), set
// when that play's engine loads. useItem asks it only for a save in the play (env.play), so the
// novel's saves use things exactly as before.
//   check(env, { name, quantity, effects }) → null, { refused }, or { pill, daily, helps, spent,
//     eases }: daily false lets a cultivation pill's own daily limit go; helps how many of
//     `quantity` still raise progress; spent what to say when none does; eases when it takes 丹毒
//     down, so it is not wasted however full the rest is
//   after(env, { pill, quantity, helped, applied }) → { commands, stats, parts, fields }: what
//     taking it did besides its effects, and the receipt's extra fields (toxin, pill, frxPlay)
const lifePills = { check: null, after: null };

function useItem(env, { id, quantity, consumed = true }, source) {
  const row = env.state['1']?.[id];
  const name = row ? rowName(row) : '';
  const item = { id, name };
  if (!row) return refusal('use_item', item, quantity, `储物袋中没有编号为 ${id} 的道具`, source);
  if (env.ctx.storedItemIds(env.state).has(id)) return refusal('use_item', item, quantity, `「${name}」不在储物袋中`, source);
  if (!expendable(row['2'], consumed)) return refusal('use_item', item, quantity, `「${name}」不是可服用的消耗品`, source);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return refusal('use_item', item, quantity, '使用数量必须是正整数', source);
  const count = env.ctx.itemStackCount(row['5']);
  if (!Number.isSafeInteger(count)) return refusal('use_item', item, quantity, `「${name}」的库存数量无法识别`, source);
  if (count < quantity) return refusal('use_item', item, quantity, `「${name}」库存不足，需要 ${quantity} 份，现有 ${count} 份`, source);
  const effects = parseEffects(row['4']).length ? parseEffects(row['4']) : parseEffects(row['3']);
  const life = env.play && lifePills.check ? lifePills.check(env, { name, quantity, effects }) : null;
  if (life?.refused) return refusal('use_item', item, quantity, life.refused, source);
  let dailyUses;
  try {
    dailyUses = checkLimits({ name, rules: plain(row['3']) + ' ' + plain(row['4']) }, quantity, env.state, env.dailyUses, life?.daily !== false);
  } catch (error) {
    return refusal('use_item', item, quantity, error.message, source);
  }
  // A breakthrough aid with no effect of its own does its work only in a breakthrough.
  if (!effects.length && mechanics.isAid(name)) {
    return refusal('use_item', item, quantity, `「${name}」是冲关的辅助丹药，冲击境界时由breakthrough服用（填在aid_item_ids里），平时服下只会白白浪费`, source);
  }
  const stats = playerStats(env);
  // Progress from a pill climbs the steps like any gain; at the bottleneck it would be wasted.
  const progress = effects.find(effect => effect.stat === '修为');
  // How many of the pills taken raise progress: all, but in the cultivation life no more than 耐药 leaves.
  const helps = life && progress ? life.helps : quantity;
  const spent = !!progress && helps < 1;
  const atBottleneck = progress && (spent || mechanics.itemProgress(env, progress.amount * helps, stats) === null);
  // A recovery pill whose every effect would be wasted is not taken (one that eases 丹毒 is not wasted).
  const full = !life?.eases && effects.length && effects.every(effect => {
    if (effect.stat === '修为') return atBottleneck;
    const max = Number(stats[effect.stat]?.max);
    return Number.isFinite(max) && max > 0 && Number(stats[effect.stat]?.current) >= max;
  });
  if (full && spent && effects.length === 1) return refusal('use_item', item, quantity, life.spent, source);
  if (full) {
    const reason = effects.map(e => (e.stat === '修为' ? (spent ? life.spent : '修为已到瓶颈') : `${e.stat}已满`));
    return refusal('use_item', item, quantity, effects.every(e => e.stat !== '修为')
      ? `${effects.map(e => e.stat).join('、')}已满，不必服用「${name}」` : `${reason.join('，')}，不必服用「${name}」`, source);
  }
  const remaining = count - quantity;
  const commands = [remaining ? `add(${JSON.stringify(id)},{"5":"${remaining}"})` : `de(${JSON.stringify(id)})`];
  const applied = [], narrative = [];
  for (const effect of effects) {
    if (effect.stat === '修为') continue;
    const stat = stats[effect.stat];
    const before = Number(stat?.current), max = Number(stat?.max);
    if (!Number.isFinite(before) || !Number.isFinite(max) || max <= 0) {
      narrative.push(`${effect.stat}+${effect.amount * quantity}（角色没有该项数值，仅作叙事）`);
      continue;
    }
    const after = Math.min(max, before + effect.amount * quantity);
    commands.push(`updateAttribute("B1",${JSON.stringify(effect.stat)},{"current":${after},"max":${max}})`);
    applied.push({ stat: effect.stat, before, after, max });
  }
  if (!effects.length && plain(row['4']) && plain(row['4']) !== '无') narrative.push(plain(row['4']));
  const revived = mechanics.revivedStatus(env, 'B1', applied);
  if (revived !== null) commands.push(`add("B1",{"4":${JSON.stringify(revived)}})`);
  const parts = [`储物袋「${name}」${count}→${remaining}`];
  for (const a of applied) parts.push(a.after === a.before ? `${a.stat}已满（${a.after}/${a.max}）` : `${a.stat} ${a.before}→${a.after}/${a.max}`);
  const owned = applied.map(a => a.stat);
  let cultivation;
  if (progress) {
    const after = { ...stats };
    for (const a of applied) after[a.stat] = { current: a.after, max: a.max };
    const gained = atBottleneck ? null : mechanics.itemProgress(env, progress.amount * helps, after);
    if (gained) {
      commands.push(...gained.commands);
      owned.push(...gained.owns.stats.filter(stat => !owned.includes(stat)));
      cultivation = gained.cultivation;
      parts.push(gained.text);
    } else parts.push(spent ? life.spent : '修为已到瓶颈，药力未能增进修为');
  }
  const extra = life ? lifePills.after(env, { pill: life.pill, quantity, helped: cultivation ? helps : 0, applied }) : null;
  if (extra) {
    commands.push(...extra.commands);
    owned.push(...extra.stats.filter(stat => !owned.includes(stat)));
    parts.push(...extra.parts);
  }
  if (narrative.length) parts.push('其余效果由剧情描述：' + narrative.join('；'));
  return {
    kind: 'use_item', ok: true, source, item, quantity, stock: { before: count, after: remaining },
    effects: applied, narrative, ...(cultivation ? { cultivation } : {}), commands: commands.join('\n'), dailyUses,
    owns: { items: [id], stats: owned, forbid: [], ...(cultivation ? { charStats: owned.map(stat => `B1:${stat}`) } : {}) },
    summary: `使用「${name}」×${quantity}：` + parts.join('；'),
    ...(extra ? extra.fields : {}),
  };
}

function nextItemId(state) {
  const used = new Set(Object.keys(state['1'] || {}));
  for (const row of Object.values(state['0'] || {})) {
    for (const key of ['inventory', 'warehouse']) {
      const remarks = row && typeof row === 'object' ? row['9'] : null;
      const text = typeof remarks === 'string' ? remarks : JSON.stringify(remarks || '');
      for (const m of text.matchAll(/"0"\s*:\s*"(I\d+)"/g)) used.add(m[1]);
      void key;
    }
  }
  let n = 1;
  while (used.has('I' + n)) n += 1;
  return 'I' + n;
}

function claimItem(env, { source_id: sourceId, item_id: itemId, quantity = 1 }, source) {
  const fail = reason => refusal('claim_item', { id: itemId, name: '' }, quantity, reason, source);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return fail('领取数量必须是正整数');
  const npc = env.state['0']?.[sourceId];
  let name, type, description, effect, commands = [], owns = { items: [], stats: [], forbid: [], npcItems: [] };
  if (npc && /^[CG]/.test(sourceId)) {
    const remarks = env.ctx.parseRemarksString(npc['9']);
    const inventory = env.ctx.parseNestedJsonString(remarks.inventory, []);
    const entry = Array.isArray(inventory) ? inventory.find(i => i && (i['0'] === itemId || i.id === itemId || plain(i['1'] || i.name) === itemId)) : null;
    if (!entry) return fail(`${rowName(npc) || sourceId}身上没有这件道具`);
    const held = env.ctx.itemStackCount(entry['5'] ?? entry.quantity);
    if (!Number.isSafeInteger(held) || held < quantity) return fail(`${rowName(npc)}只有 ${Number.isSafeInteger(held) ? held : 0} 份`);
    name = plain(entry['1'] || entry.name); type = entry['2'] || entry.type || '消耗品';
    description = entry['3'] || entry.description || ''; effect = entry['4'] || entry.effect || '无';
    const edit = mechanics.inventoryEdit(sourceId, inventory, entry, held - quantity);
    commands.push(...edit.commands);
    owns.npcItems.push(`${sourceId}:${edit.key}`);
  } else if (env.state['6']?.[sourceId]) {
    const quest = env.state['6'][sourceId];
    const status = plain(quest['5']);
    const reward = plain(quest['3']);
    if (!/完成/.test(status) || /未完成/.test(status)) return fail(`任务「${rowName(quest)}」尚未完成`);
    if (/已领取/.test(reward)) return fail(`任务「${rowName(quest)}」的奖励已经领取`);
    if (!reward.includes(itemId)) return fail(`任务「${rowName(quest)}」的奖励中没有「${itemId}」`);
    name = itemId; type = '消耗品'; description = `任务「${rowName(quest)}」的奖励`; effect = '无';
    const counted = reward.match(new RegExp(itemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[×xX*]\\s*(\\d+)'));
    const available = counted ? Number(counted[1]) : 1;
    if (available < quantity) return fail(`任务奖励只有 ${available} 份`);
    commands.push(`add(${JSON.stringify(sourceId)},{"3":${JSON.stringify(quest['3'] + '（奖励已领取）')}})`);
  } else {
    return fail('只能领取在场人物实际持有的道具，或已完成任务登记的奖励');
  }
  const existing = bagStacks(env).find(s => s.name === name && (s.type || '') === (type || ''));
  let targetId;
  if (existing && Number.isSafeInteger(existing.count)) {
    targetId = existing.id;
    commands.push(`add(${JSON.stringify(targetId)},{"5":"${existing.count + quantity}"})`);
  } else {
    targetId = env.state['1']?.[itemId] || !/^I\d+$/.test(itemId) ? nextItemId(env.state) : itemId;
    commands.push(`set(${JSON.stringify({ 0: targetId, 1: name, 2: type, 3: description, 4: effect, 5: String(quantity) })})`);
  }
  owns.items.push(targetId);
  owns.grants = [name];
  return {
    kind: 'claim_item', ok: true, source, item: { id: targetId, name }, quantity, from: sourceId,
    commands: commands.join('\n'), owns,
    summary: `取得「${name}」×${quantity}（来自 ${npc ? rowName(npc) : '任务奖励'}），放入储物袋 ${targetId}`,
  };
}

function modifierFor(value) {
  let modifier = 0;
  for (const [floor, bonus] of RULES.modifierBands) if (value >= floor) modifier = bonus;
  return modifier;
}

// The four outcomes (checks.json `outcomes`) of a roll, its total and the difficulty.
function checkOutcome(roll, total, dc) {
  return roll === RULES.die || total >= dc + 5 ? '大成功'
    : total >= dc ? '成功'
    : roll === 1 || total <= dc - 5 ? '大失败' : '失败';
}

function resolveCheck(env, { kind, tier, target_id: targetId = '', reason = '' }, source, ordinal) {
  const rule = RULES.kinds[kind];
  const dc = RULES.tiers[tier];
  const fail = message => ({ kind: 'resolve_check', ok: false, source, reason: message, commands: '',
    owns: { items: [], stats: [], forbid: [] }, summary: `检定未进行：${message}` });
  // A kind settled by its own tool (突破 by breakthrough) is not a free-standing check.
  if (rule?.tool) return fail(`「${kind}」由${rule.tool}工具结算，不用resolve_check`);
  if (!rule) return fail(`没有「${kind}」这种检定，可用：${Object.keys(RULES.kinds).filter(name => !RULES.kinds[name].tool).join('、')}`);
  if (!dc) return fail(`难度只能是：${Object.keys(RULES.tiers).join('、')}`);
  const stats = playerStats(env);
  const value = Number(stats[rule.attribute]?.current ?? stats[rule.attribute] ?? 0) || 0;
  const modifier = modifierFor(value);
  const roll = Math.floor(create(`${env.seed}:check:${ordinal}`).random() * RULES.die) + 1;
  const total = roll + modifier;
  const outcome = checkOutcome(roll, total, dc);
  const result = rule.results[outcome];
  const commands = [], effects = [];
  const owns = { items: [], stats: [], forbid: [...(result.forbid || [])] };
  if (result.damagePercent) {
    const hp = stats['血量'];
    const before = Number(hp?.current), max = Number(hp?.max);
    if (Number.isFinite(before) && Number.isFinite(max) && max > 0) {
      const damage = Math.ceil(max * result.damagePercent[tier] / 100);
      const after = Math.max(0, before - damage);
      commands.push(`updateAttribute("B1","血量",{"current":${after},"max":${max}})`);
      effects.push({ stat: '血量', before, after, max, damage });
      owns.stats.push('血量');
    }
  }
  // Getting away ends the fight: the combat marks on everyone are cleared.
  if (result.endsCombat && String(env.state['0']?.B1?.['31']).trim() === 'true') {
    for (const [id, row] of Object.entries(env.state['0'] || {})) {
      const marks = { ...(String(row?.['31']).trim() === 'true' ? { 31: 'false' } : {}), ...(String(row?.['32']).trim() === 'true' ? { 32: 'false' } : {}) };
      if (Object.keys(marks).length) commands.push(`add(${JSON.stringify(id)},${JSON.stringify(marks)})`);
    }
    effects.push({ endsCombat: true });
  }
  const target = env.state['0']?.[targetId];
  const check = { kind, tier, dc, die: RULES.die, roll, attribute: rule.attribute, value, modifier, total, outcome,
    consequence: result.text, effects, target: target ? { id: targetId, name: rowName(target) } : null,
    reason: plain(reason).slice(0, 80), rulesVersion: RULES.version };
  const effectText = effects.map(e => (e.endsCombat ? '战斗结束，战斗标记已清除' : `${e.stat} ${e.before}→${e.after}/${e.max}`)).join('；');
  return {
    kind: 'resolve_check', ok: true, source, check, commands: commands.join('\n'), owns,
    summary: `${kind}检定（${tier}，难度${dc}）：1d${RULES.die}=${roll}，${rule.attribute}修正${modifier >= 0 ? '+' : ''}${modifier}，总值${total} → ${outcome}：${result.text}` + (effectText ? `；${effectText}` : ''),
  };
}

function lookupInventory(env, { name = '' } = {}) {
  const wanted = plain(name);
  const items = bagStacks(env)
    .filter(s => !wanted || s.name.includes(wanted))
    .map(s => ({ id: s.id, name: s.name, type: s.type || '', quantity: s.count, description: plain(s.row['3']).slice(0, 80), effect: plain(s.row['4']).slice(0, 80) }));
  return { kind: 'lookup_inventory', ok: true, readOnly: true, items, commands: '', owns: { items: [], stats: [], forbid: [] },
           summary: items.length ? `储物袋中${wanted ? '名称含「' + wanted + '」的' : ''}道具：` + items.map(i => `${i.id} ${i.name}×${i.quantity}`).join('，') : `储物袋中没有${wanted ? '「' + wanted + '」' : '道具'}` };
}

const escapeText = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Equip, wield or put away gear named in the action. Questions and intentions settle nothing.
function gearIntents(env, text) {
  const intents = [];
  // Each clause keeps its own closing mark, so a question before a comma-less statement
  // (「何时？我立刻装备…」) does not turn the statement into a question.
  const clauses = (plain(text).match(/[^，,；;。！!？?\n]+[，,；;。！!？?\n]?/g) || [])
    .filter(c => c && !/[？?]|能否|可否|要不要|是否|如果|假如/.test(c) && !/^(?:我|你)?(?:想|打算|准备|考虑)/.test(c.trim()));
  const bag = mechanics.bagGear(env).sort((a, b) => b.name.length - a.name.length);
  const { worn } = mechanics.wornGear(env);
  for (const clause of clauses) {
    for (const gear of bag) {
      const verbs = gear.type === '武器' ? `${WEAR}|${WIELD}` : gear.type === '法宝' ? `${WEAR}|祭出|催动` : gear.type === '功法' ? `${WEAR}|${LEARN}` : WEAR;
      // 「将《长春功》纳为主修功法」 names the method before the verb.
      const after = gear.type === '功法' && new RegExp(`(?:将|把)[《「]?${escapeText(gear.name)}[》」]?[^，,。；;]{0,4}?(?:纳为|作为|当作|定为|立为|改为)`).test(clause);
      if ((after || new RegExp(`(?:${verbs})(?:了|起|上)?[^，,。；;]{0,6}?${escapeText(gear.name)}`).test(clause)) && !intents.some(i => i.id === gear.id)) {
        intents.push({ kind: 'equip', id: gear.id, name: gear.name, source: 'text' });
      }
    }
    for (const item of worn) {
      if (item.name && new RegExp(`(?:${UNWEAR})(?:了)?[^，,。；;]{0,6}?${escapeText(item.name)}`).test(clause) && !intents.some(i => i.id === item.id)) {
        intents.push({ kind: 'unequip', id: item.id, name: item.name, source: 'text' });
      }
    }
  }
  return intents;
}

function inCombat(state) {
  return Object.values(state['0'] || {}).some(row => row && String(row['31']).trim() === 'true');
}

// The action really does it: some clause names it without asking, supposing or refusing.
function doing(text, pattern) {
  return plain(text).split(/[，,；;。！!\n]/).some(clause => pattern.test(clause) && !NOT_DOING.test(clause)
    && !REFUSING.test(clause) && !ASKING.test(clause));
}

function freeCharacterId(prefix, taken) {
  let n = 1;
  while (taken.has(prefix + n)) n += 1;
  return prefix + n;
}

// Characters off the scene keep their IDs in the card's biographies, and in a life save in the
// people's book (frxPlay.people.by: someone who left with no biography). Showing them keeps a new
// character from taking one and lets a returning character come back under their own.
function castOf(env) {
  const scene = env.state['0'] || {};
  // The fallen are not coming back, but their IDs stay taken.
  const away = Object.entries(env.biographies || {}).filter(([id, row]) => !scene[id] && !mechanics.isFallen(env.ctx, row))
    .map(([id, row]) => [id, rowName(row)]).filter(([, name]) => name);
  for (const [id, person] of Object.entries(env.people || {})) {
    if (person?.alive && person.name && !scene[id] && !env.biographies?.[id]) away.push([id, person.name]);
  }
  const taken = new Set([...Object.keys(scene), ...(env.knownIds || [])]);
  return { away: away.slice(-40), next: freeCharacterId('C', taken) };
}

// The spot in the place's closing brackets, if any: 白苇集（药圃·东垄） → 药圃东垄.
function spotOf(place) {
  const row = (place?.['4'] || []).find(r => r?.id === 'TIME_LOCATION_ROW') || place?.['4']?.[0];
  const text = plain(row?.['0']).split('/').at(-1).replace(/\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*$/, '');
  const bracket = text.match(/[（(]([^（）()]+)[）)]\s*$/);
  const bare = value => value.replace(/[^\p{L}\p{N}]/gu, '');
  return { place: bare(text), spot: bracket ? bare(bracket[1]) : '' };
}

// Two names for the same spot: one inside the other, or most of their character pairs shared
// (镜州城·东市 and 镜州东市 are one market; 镜州东市 and 镜州西市 are two).
function sameSpot(a, b) {
  if (a.includes(b) || b.includes(a)) return true;
  const pairs = text => new Set([...text].slice(1).map((char, i) => text[i] + char));
  const left = pairs(a), right = pairs(b);
  if (!left.size || !right.size) return false;
  const shared = [...left].filter(pair => right.has(pair)).length;
  return 2 * shared >= left.size + right.size - 2 * shared;
}

// Whether the player left the place: the spots in brackets decide when both rows have one, so
// rewording the place around them (白苇集 → 白苇集北麓) is not moving on.
function movedOn(before, after) {
  const from = spotOf(before), to = spotOf(after);
  if (!from.place || !to.place) return false;
  return from.spot && to.spot ? !sameSpot(from.spot, to.spot) : !sameSpot(from.place, to.place);
}

const CARRIED_OFF = /(?:尸首|尸体|尸身|焦尸|遗体|残躯|首级)[^。！？!?\n]{0,24}?(?:抬走|拖走|带走|运走|搬走|收走|掩埋|埋了|埋葬|焚化|烧了|处置)/;
// A question, a refusal or a plan does not carry anyone off.
const NOT_DONE = /[？?]|没有|没|未|不曾|不必|不要|别|要不要|是否|如何|怎么|打算|准备|想要|若|如果|倘若/;

// A fallen character does not follow the player. Once the player moves on, whoever lies fallen
// and is not written about this turn stays behind. When the story has a body carried off, the
// fallen character it names goes with it, or the only one there is. The card keeps biographies
// only with its knowledge base on, so the caller does this only then. Companions (isBonded),
// anyone still marked in the fight and anyone the turn's commands touch stay.
function fallenLeftBehind(ctx, before, after, story, { touched = new Set(), fellNow = new Set() } = {}) {
  const moved = movedOn(before, after);
  const carried = moved ? [] : plain(story).split(/(?<=[。！？!?\n])/).filter(s => CARRIED_OFF.test(s) && !NOT_DONE.test(s));
  if (!moved && !carried.length) return [];
  const fallen = [];
  for (const [id, row] of Object.entries(after?.['0'] || {})) {
    if (!/^[CG]/.test(id) || !row || String(row['31']).trim() === 'true') continue;
    if (String(ctx.parseRemarksString(row['9'])?.isBonded) === 'true') continue;
    if (!mechanics.isFallen(ctx, row) || touched.has(id) || (!moved && fellNow.has(id))) continue;
    fallen.push({ id, name: rowName(row), moved });
  }
  if (moved) return fallen;
  const named = fallen.filter(f => f.name && carried.some(s => s.includes(f.name)));
  return named.length ? named : fallen.length === 1 ? fallen : [];
}

// Classify the player's action before the first model call.
function presettle(env, action) {
  const plan = { route: 'pilot', reasons: [], receipts: [], tools: [], mustTool: false };
  if (!action || action.legacy) return { ...plan, route: 'original', reasons: ['旧版页面没有提交结构化行动'] };
  const equipped = env.ctx.equippedItemRows(env.state['0']?.B1);
  const tracks = trackStock(env.state, equipped, [], env.ctx.itemStackCount);
  const names = new Set([...tracks.values()].map(s => s.name).filter(Boolean));
  const player = rowName(env.state['0']?.B1);
  const text = action.text || '';
  const events = itemEvents(text, names, false, player);
  const selected = action.items || [];
  const selectedNames = new Set(selected.map(i => plain(i.name)));
  const stacks = bagStacks(env);
  // A storyline chapter finished since the last turn pays its reward first, once.
  const queue = mechanics.pendingChapterRewards(env, env.plot);
  // On a breakthrough attempt the aid pills named or picked are taken by the breakthrough itself.
  const attempting = BREAKTHROUGH_WORDS.test(text);
  const aid = name => attempting && mechanics.isAid(name);
  for (const item of selected) {
    if (aid(rowName(env.state['1']?.[item.id]) || item.name)) { plan.reasons.push('辅助丹药在冲关时由breakthrough服用'); continue; }
    queue.push({ id: item.id, quantity: item.quantity, source: 'button' });
  }
  const acquired = new Set(events.filter(e => e.acquired).map(e => e.name));
  const bought = new Set(events.filter(e => e.acquired && e.bought).map(e => e.name));
  const usedAfterGain = events.some(e => !e.acquired && e.afterGain);
  // Something handed over is checked against who holds it before the story; something bought
  // is settled by the trade tool when the deal is struck, and is forced only when the same
  // action also uses it.
  if ([...acquired].some(name => !bought.has(name))) {
    plan.mustTool = true; plan.tools.push(...ITEM_TOOLS);
    plan.reasons.push(usedAfterGain ? '本回合先取得道具再使用，需要核对来源' : '本回合取得道具，需要核对来源');
  } else if (bought.size && usedAfterGain) {
    plan.mustTool = true; plan.tools.push('trade_item', 'use_item');
    plan.reasons.push('本回合先买下道具再使用，需要先结算买卖');
  }
  if (bought.size || TRADE_WORDS.test(text)) { plan.tools.push('trade_item'); plan.reasons.push('行动可能是买卖'); }
  const ending = mechanics.combatOver(env);
  if (ending) queue.push({ kind: 'end_combat', source: 'engine' });
  // A fight goes on until its foes fall or the player gets away, and standing foes act every
  // turn: a turn in the middle of a fight is settled by an exchange or a check, whatever the
  // player does (drinking a pill, looking around, simply walking off).
  const fight = ending ? [] : mechanics.standingFoes(env);
  if (fight.length) {
    plan.mustTool = true;
    plan.tools.push('resolve_attack', 'resolve_check');
    plan.reasons.push('战斗仍在进行，在场的敌人本回合也会出手');
    plan.fight = fight;
  }
  const gear = gearIntents(env, text);
  // Cultivating with no method at hand but one in the bag: it is taken up before the session.
  if (CULTIVATE_WORDS.test(text) && doing(text, CULTIVATE_NOW) && !gear.some(g => g.kind === 'equip')) {
    const method = mechanics.shelvedMethod(env);
    if (method) gear.push({ kind: 'equip', id: method.id, name: method.name, source: 'engine' });
  }
  const gearNames = new Set(gear.map(g => g.name));
  queue.push(...gear);
  for (const event of events.filter(e => !e.acquired)) {
    if (selectedNames.has(event.name) || acquired.has(event.name) || gearNames.has(event.name)) continue;
    if (aid(event.name)) { plan.reasons.push('辅助丹药在冲关时由breakthrough服用'); continue; }
    // A phrase that only wraps a bag item's name (「并仔细研读《金炎吐纳抄本》」) is that item.
    const wrapped = stacks.filter(s => s.name && event.name !== s.name && event.name.includes(s.name));
    if (wrapped.length && (wrapped.some(s => gearNames.has(s.name)) || wrapped.every(s => !expendable(s.type, event.consumed)))) continue;
    const named = stacks.filter(s => s.name === event.name);
    if (named.length > 1) {
      plan.mustTool = true; plan.tools.push(...ITEM_TOOLS);
      plan.reasons.push(`储物袋中有多件「${event.name}」，需要先确认是哪一件`);
      continue;
    }
    // Gear goes through equipping; a reusable tool such as an abacus is simply used in the story.
    if (named.length === 1 && !expendable(named[0].type, event.consumed)) continue;
    if (!named.length) {
      if (mechanics.wornGear(env).worn.some(w => w.name === event.name)) continue;
      // Wearing something the player does not own reads as a failed equip, not a failed use;
      // only a name that is a piece of gear (催动真元施展身法 is not one).
      if (GEAR_NAME.test(event.name) && new RegExp(`(?:${WEAR}|${WIELD}|祭出|催动)(?:了|起|上)?[^，,。；;]{0,6}?${escapeText(event.name)}`).test(plain(text))) {
        plan.receipts.push({ kind: 'equip_item', ok: false, source: 'text', item: { id: '', name: event.name },
          reason: `储物袋中没有可装备的「${event.name}」`, commands: '', owns: { items: [], stats: [], forbid: [] },
          summary: `未能装备「${event.name}」：储物袋中没有可装备的「${event.name}」` });
        continue;
      }
      plan.receipts.push(refusal('use_item', { id: '', name: event.name }, event.quantity, `储物袋中没有可用的「${event.name}」`, 'text'));
      continue;
    }
    queue.push({ id: named[0].id, quantity: event.quantity, source: 'text', consumed: event.consumed });
  }
  if (CHECK_WORDS.test(text)) { plan.tools.push('resolve_check'); plan.reasons.push('行动可能需要检定'); }
  // A fight can start from either side, so the exchange tool is always on offer.
  plan.tools.push('resolve_attack');
  if (COMBAT_WORDS.test(text) || (inCombat(env.state) && !ending)) plan.reasons.push('行动可能是战斗交锋');
  const skills = Object.values(env.state['8'] || {}).filter(Boolean).map(rowName).filter(Boolean);
  if (skills.length && (SKILL_WORDS.test(text) || skills.some(name => text.includes(name)))) { plan.tools.push('use_skill'); plan.reasons.push('行动可能施展技能'); }
  if (REST_WORDS.test(text)) { plan.tools.push('rest'); plan.reasons.push('行动可能是休整恢复'); }
  if (CULTIVATE_WORDS.test(text)) {
    plan.tools.push('cultivate');
    plan.reasons.push('行动可能是修炼');
    if (doing(text, CULTIVATE_NOW)) { plan.mustTool = true; plan.reasons.push('行动是修炼，修为由引擎结算'); }
  }
  if (BREAKTHROUGH_WORDS.test(text)) {
    plan.tools.push('breakthrough');
    plan.reasons.push('行动可能是冲击境界');
    if (doing(text, BREAKTHROUGH_NOW)) { plan.mustTool = true; plan.reasons.push('行动是冲关突破，成败由引擎结算'); }
  }
  // A quest can end without the player naming it (an escort arrives, an escape succeeds, the
  // herb is picked), so the quest tool is on offer whenever one is under way.
  const quests = mechanics.activeQuests(env.state);
  if (quests.length) plan.tools.push('update_quest');
  if (quests.length && (QUEST_WORDS.test(text) || quests.some(q => q.title && text.includes(q.title)))) plan.reasons.push('行动可能结束一项任务');
  plan.tools = [...new Set(plan.tools)];
  plan.reasons = [...new Set(plan.reasons)];
  plan.cast = castOf(env);
  plan.queue = queue;
  return plan;
}

function statKeys(value) {
  let stats = value;
  if (typeof stats === 'string') { try { stats = JSON.parse(stats); } catch { stats = {}; } }
  return Object.keys(stats && typeof stats === 'object' ? stats : {}).map(key => (key === 'hp' ? '血量' : key));
}

// A save in the cultivation-life play (gameplay plan item 8): favour (column 15 of the cast) and
// frxPlay are the engine's, and the time row may be written only as add("TIME_LOCATION_ROW",
// {"0": …}), whose time settle.cjs holds to a beat's limits (life/scene.cjs beatTime). settle.cjs
// adds lifeOwns(where) to such a save's receipts, and only there; the functions below read it
// from them as they read any receipt's owns. Saves outside the play never carry it.
// `where` (plan item 28) is the map place the receipts leave the player at, { place, of }:
// of(text) reads which map place a time row's place text belongs to (life/places.cjs, on the
// save's map). Moving within it is the story's; a command that writes another map place there is
// refused, a journey being the engine's (move_place, the verb travel). Without `where`, as before.
const lifeOwns = (where = null) => ({ kind: 'life', ok: true, source: 'engine', commands: '', summary: '',
  owns: { life: true, ...(where ? { where } : {}) } });
const MOVED = '指令把主角挪到了另一个地图地点：换地图地点要用move_place，由引擎按路程推进时间';

// The map place a time row's text puts the player at, by `where`'s reading.
function placeOfRow(where, text) {
  const slash = String(text).indexOf('/');
  return slash < 0 ? undefined : where.of(String(text).slice(slash + 1));
}

function lifeViolations(op, id, where) {
  const found = [];
  if (id === 'frxPlay') found.push('指令改动了引擎掌管的frxPlay');
  if (id === 'TIME_LOCATION_ROW' && !(op.command === 'add' && op.data && Object.keys(op.data).every(column => column === '0' || column === 'id'))) {
    found.push('指令改动了引擎结算的时间行，时间行只能用add写第0列');
  }
  if (where && id === 'TIME_LOCATION_ROW' && op.command === 'add' && typeof op.data?.['0'] === 'string') {
    const written = placeOfRow(where, op.data['0']);
    if (written !== undefined && written !== where.place) found.push(MOVED);
  }
  if (id && /^[CG]/.test(id) && ['add', 'set'].includes(op.command) && op.data && Object.hasOwn(op.data, '15')) found.push(`指令改动了引擎结算的${id}好感`);
  return found;
}

function checkOwnership(delta, receipts) {
  const items = new Set(), stats = new Set(), npcItems = new Set(), forbid = new Set();
  const charStats = new Set(), skills = new Set(), quests = new Set(), grants = new Set();
  let currency = false, life = false, where = null;
  for (const r of receipts) {
    if (!r.ok) continue;
    (r.owns?.items || []).forEach(i => items.add(i));
    (r.owns?.stats || []).forEach(s => stats.add(s));
    (r.owns?.npcItems || []).forEach(s => npcItems.add(s));
    (r.owns?.forbid || []).forEach(s => forbid.add(s));
    (r.owns?.charStats || []).forEach(s => charStats.add(s));
    (r.owns?.skills || []).forEach(s => skills.add(s));
    (r.owns?.quests || []).forEach(s => quests.add(s));
    (r.owns?.grants || []).forEach(s => grants.add(s));
    currency ||= !!r.owns?.currency;
    life ||= !!r.owns?.life;
    where = r.owns?.where || where;
  }
  const violations = [];
  for (const op of delta) {
    const id = op.command === 'set' ? op.data?.['0'] : op.id;
    if (life) violations.push(...lifeViolations(op, id, where));
    if (items.has(id)) violations.push(`指令改动了引擎已结算的道具 ${id}`);
    if (op.command === 'equipItem' && id === 'B1' && items.has(op.item?.data?.['0'])) violations.push(`指令改动了引擎已结算的装备 ${op.item.data['0']}`);
    if (op.command === 'set' && /^I/.test(id || '') && !items.has(id) && grants.has(rowName(op.data))) violations.push(`指令重复发放了引擎已结算的「${rowName(op.data)}」`);
    if (id && id !== 'B1' && /^[CG]/.test(id)) {
      const touched = op.command === 'updateAttribute' ? [op.attribute === 'hp' ? '血量' : op.attribute]
        : ['add', 'set'].includes(op.command) && op.data?.['11'] ? statKeys(op.data['11']) : [];
      for (const stat of touched) if (charStats.has(`${id}:${stat}`)) violations.push(`指令改动了引擎已结算的${id}${stat}`);
    }
    if (currency && id === 'B1' && op.command === 'add' && op.data && Object.hasOwn(op.data, '26')) violations.push('指令改动了引擎已结算的灵石');
    if (skills.has(id) && ['add', 'set'].includes(op.command) && op.data && (Object.hasOwn(op.data, '6') || Object.hasOwn(op.data, '7'))) {
      violations.push(`指令改动了引擎已结算的技能熟练度 ${id}`);
    }
    if (quests.has(id) && (op.command === 'de' || (['add', 'set'].includes(op.command) && op.data && (Object.hasOwn(op.data, '3') || Object.hasOwn(op.data, '5'))))) {
      violations.push(`指令改动了引擎已结算的任务 ${id}`);
    }
    if (op.command === 'de' && op.subCategory && npcItems.has(`${op.id}:${op.subId}`)) violations.push(`指令改动了引擎已结算的人物道具 ${op.subId}`);
    if (op.command === 'add' && op.data?.['9'] && typeof op.data['9'] === 'object') {
      for (const entry of [].concat(op.data['9'].inventory || [])) {
        if (entry && npcItems.has(`${op.id}:${entry['0'] || entry.id}`)) violations.push(`指令改动了引擎已结算的人物道具 ${entry['0'] || entry.id}`);
      }
    }
    if (id === 'B1') {
      if (op.command === 'updateAttribute' && stats.has(op.attribute === 'hp' ? '血量' : op.attribute)) violations.push(`指令改动了引擎已结算的${op.attribute}`);
      if (op.command === 'add' && op.data?.['11']) {
        let value = op.data['11'];
        if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = {}; } }
        for (const key of Object.keys(value || {})) if (stats.has(key)) violations.push(`指令改动了引擎已结算的${key}`);
      }
      if (op.command === 'add' && stats.has('血量') && op.data?.['9']) {
        const remarks = typeof op.data['9'] === 'string' ? op.data['9'] : JSON.stringify(op.data['9']);
        if (/\bhp\b/.test(remarks)) violations.push('指令改动了引擎已结算的血量');
      }
    }
    if (forbid.has('skill_gain') && ((op.command === 'set' && /^S/.test(id || '')) || (op.command === 'addSkill' && op.id === 'B1')
        || (op.command === 'add' && /^S/.test(id || '')))) {
      violations.push('检定未成功，本回合不能习得或改动技能');
    }
  }
  return [...new Set(violations)];
}

// The story is checked against receipts: no use without a receipt and no
// contradiction of a receipt.
// The story saying the player reached a named realm (突破到炼气一层, 如今已是筑基初期) above the one
// they hold, in a sentence about the player that is not a plan, a wish, a doubt or a failure.
const REALM_CLAIM = /(?:突破|晋升|晋入|踏入|迈入|跨入|进阶|跻身|步入|成就|成为|已是|已经是|达到|臻至)(?:了|到|至|进|入)?\s*(?:一名|一位)?((?:炼气|练气|筑基|结丹|金丹|元婴|化神|炼虚|合体|大乘)(?:期)?(?:[一二三四五六七八九十]+层|初期|中期|后期|大圆满|圆满)?)/;
const CLAIM_EXCEPT = /若能|若可|要是|但愿|只盼|希望|盼着|便好|尚未|还未|未能|没能|没有|并未|不曾|未曾|想要|要想|准备|打算|若是|如果|倘若|只差|还差|距离|一旦|即将|将要|差点|险些|功亏一篑|失败|受挫|无法|不能|难以|渴望|希冀|期盼|何时|才能|方能|便能|就能|可以|有望|错觉|幻觉|以为|梦/;

// Breakthrough talk in a statement about it having happened, named realm or not (踏入仙途,
// 冲破瓶颈); used together with commands that wrote a higher realm.
const RISE_WORDS = /突破|踏入|迈入|跨入|晋升|晋入|仙途|成为(?:了)?(?:一名)?修士|修士真元|真正属于修士|引灵入体|成功引气入体|引气入体成功|破境|破关|冲破(?:了)?(?:瓶颈|关隘|桎梏|屏障)|脱胎换骨|仙凡之隔/;

function claimsBreakthrough(story) {
  return plain(story).split(/[。！!？?\n]/).some(sentence => RISE_WORDS.test(sentence) && !CLAIM_EXCEPT.test(sentence));
}

// `realm`, when given, is the realm column the claims are read against instead of the player's row
// before the receipts (a save of the cultivation life passes the one its receipts leave: layers a
// stretch of 修炼 climbed are no breakthrough claimed).
function realmClaims(env, story, receipts, realm = null) {
  if (receipts.some(r => r.ok && (r.kind === 'breakthrough' || r.kind === 'world_rule'))) return [];
  const row = realm === null ? env.state['0']?.B1 : { 2: realm };
  const current = mechanics.parseRealm(row?.['2']);
  if (current.unknown) return [];
  for (const sentence of plain(story).split(/[。！!？?\n]/)) {
    if (!sentence.includes('你') || CLAIM_EXCEPT.test(sentence)) continue;
    const match = sentence.match(REALM_CLAIM);
    if (!match) continue;
    const claimed = mechanics.parseRealm(match[1]);
    if (claimed.unknown) continue;
    if (claimed.major > current.major || (claimed.major === current.major && (claimed.minor || 0) > (current.minor || 0))) {
      return [`正文写了你已突破到${match[1]}，但本回合没有成功的突破回执，境界仍是${plain(row?.['2']).split('|')[0]}`];
    }
  }
  return [];
}

function checkStory(env, story, receipts, options = {}) {
  const names = new Set(bagStacks(env).map(s => s.name));
  for (const r of receipts) {
    if (r.item?.name) names.add(r.item.name);
    for (const aid of r.breakthrough?.aids || []) names.add(aid.name);
  }
  const player = rowName(env.state['0']?.B1);
  const events = itemEvents(story || '', names, true, player, { inheritSubject: true });
  const mismatches = [];
  const used = new Map(), refused = new Map();
  for (const r of receipts) {
    // The aid pills a breakthrough took are used too, as many as it took.
    if (r.kind === 'breakthrough' && r.ok) {
      for (const aid of r.breakthrough?.aids || []) used.set(aid.name, { ...r, item: { id: aid.id, name: aid.name }, quantity: aid.count });
    }
    if (r.kind !== 'use_item' || !r.item?.name) continue;
    (r.ok ? used : refused).set(r.item.name, r);
  }
  for (const event of events) {
    if (event.acquired) continue;
    const name = event.name;
    if (event.denied) {
      if (used.has(name)) mismatches.push(`回执显示已使用「${name}」，正文却写成没有使用`);
      continue;
    }
    if (!event.consumed && !used.has(name) && !refused.has(name)) continue;
    if (refused.has(name)) mismatches.push(`回执显示没能使用「${name}」（${refused.get(name).reason}），正文却写了使用`);
    else if (!used.has(name)) mismatches.push(`正文写了使用「${name}」，但本回合没有对应的道具结算`);
    else if (event.counted && event.quantity > used.get(name).quantity) mismatches.push(`正文写的「${name}」数量多于回执的 ${used.get(name).quantity} 份`);
  }
  mismatches.push(...realmClaims(env, story, receipts, options?.realm ?? null));
  return [...new Set(mismatches)];
}

const CONSUME = /[吃吞咽嚼服喝饮咬]/;
const DENY_BEFORE = /没有|并未|未能|不曾|无法|没能|找不到|哪里有|不见|空空|无需|无须|不必|不用|何必|不要|不想|不愿|不肯|本欲|本想|正欲|正要|打算|准备|舍不得|不忍/;
const DENY_BETWEEN = /没有|并未|未能|不曾|无法|没能|没舍得|舍不得|留着|收好|收起|收回|放回|纳回|塞回|装回|原样|揣|藏起|不敢|不必|无需|不用/;
// "无需服丹疗伤，不妨先饮两口清茶": the verb in a later clause has an object of its own.
const TURN_AWAY = /不妨|而是|只是|转而|反倒|反而|倒是|改为|另|却/;
// Reasoning about what eating would do is not eating: "倘若贸然服下，不仅……".
const SUPPOSE = /倘若|如果|若是|假如|要是|一旦|万一|即便|即使|就算|既然|与其|何必|岂能|岂可|不宜|不该|免得|以免|生怕|唯恐|宁可/;
const OTHER_FOOD = /[饼丸散膏露液酒茶果粮肉汤粥水奶浆羹]/;
const FOOD_TAIL = /[饼丹丸散膏露液酒茶果药符粮肉汤粥]$/;
const ITEM_LIKE = /(?:饼|丹|丸|散|膏|露|液|酒|茶|果|药|符|箓|粮|肉|汤|剑|刀|枪|棍|鞭|弓|斧|锤|戟|戈|甲|袍|衣|靴|盾|石|砂|晶|玉|珠|镜|瓶|壶|鼎|钟|塔|葫芦|袋|囊|牌|令|押|印|佩|簪|镯|环|钱|银|锭|卷|简|册|书|经|诀|图|录|信|笺|绢|帛|纸|帖|柬|函|札|契|丹方|药方|秘方|种子|草|根|骨|皮|毛|羽|角|牙|鳞|丝|布|绳|线|香|末|精|针|网|匣|盒|箱|盘|片|旗|幡|馒头|包子|干粮)$/;

function clauseStart(sentence, index) {
  return Math.max(...['，', ',', '；', ';', '：', ':'].map(mark => sentence.lastIndexOf(mark, index))) + 1;
}

// The parser above reads exact item names. A refused item is often written under a
// shorter name ("硬饼" for 杂粮饼), so look for its tail near an eating verb as well.
function refusedConsumption(story, receipts, npcNames) {
  const text = plain(story);
  const mismatches = [];
  for (const r of receipts) {
    if (r.kind !== 'use_item' || r.ok || !r.item?.name) continue;
    const name = plain(r.item.name);
    const variants = new Set([name]);
    if (name.length >= 3) variants.add(name.slice(-2));
    if (FOOD_TAIL.test(name)) variants.add(name.slice(-1));
    found: for (const sentence of text.split(/(?<=[。！？!?\n])/)) {
      for (const variant of variants) {
        for (let index = sentence.indexOf(variant); index >= 0; index = sentence.indexOf(variant, index + 1)) {
          const after = sentence.slice(index + variant.length, index + variant.length + 30);
          const verb = after.match(CONSUME);
          if (!verb) continue;
          const between = after.slice(0, verb.index);
          const before = sentence.slice(Math.max(0, index - 6), index), clause = sentence.slice(clauseStart(sentence, index), index);
          if (DENY_BEFORE.test(before) || DENY_BEFORE.test(clause) || DENY_BETWEEN.test(between)) continue;
          if (SUPPOSE.test(sentence.slice(0, index + variant.length + verb.index))) continue;
          if (/[，,；;：:]/.test(between)) {
            // Across a clause break the verb may belong to something else.
            const object = after.slice(verb.index + 1).split(/[，,。；;！？!?]/)[0];
            if (TURN_AWAY.test(between) || OTHER_FOOD.test(object.replace(variant, ''))) continue;
          }
          const head = sentence.slice(clauseStart(sentence, index), index);
          if (npcNames.some(npc => npc && head.includes(npc))) continue;
          mismatches.push(`回执显示没能使用「${name}」（${r.reason}），正文却写了吃下或服下`);
          break found;
        }
      }
    }
  }
  return mismatches;
}

function itemNameFrom(phrase) {
  let text = plain(phrase).replace(/[“”"「」『』【】]/g, '');
  text = text.split('的').at(-1);
  text = text.replace(/^(?:那|这|其中|另|余下|剩下)?(?:[一二两三四五六七八九十几半数\d]+)?(?:个|块|枚|颗|粒|张|瓶|包|只|把|件|株|根|支|截|面|道|片|袋|锭|串|壶|碗|份|卷|本|册|对|双|捆|匹)?/, '');
  text = text.replace(/^(?:那|这)/, '').trim();
  const end = text.search(/[和与及并而，。！？；、\s]|之后|以后|连同|连带/);
  return end > 0 ? text.slice(0, end) : text;
}

// A phrase can hand over more than one thing: 「一枚带血的黑铁信牌与一截灰扑扑的药线」 is two, and
// 「墨铁匣连同那卷兽皮丹方与青铜残片」 three. A join that leaves a part with no name is inside a name
// (一枚和田玉佩). The names in the order written, the one itemNameFrom reads included.
const JOINS = /以及|连同|连带|还有|[与和及并、]/;
function itemNamesFrom(phrase) {
  const whole = itemNameFrom(phrase);
  const names = plain(phrase).split(JOINS).map(itemNameFrom);
  if (names.length < 2 || names.some(name => !name.trim())) return [whole];
  return names.includes(whole) ? names : [...names, whole];
}

const sameItemName = (left, right) => left.endsWith(right) || right.endsWith(left);

// An unlisted purchase's price is settled by the action card, but its physical delivery
// comes from the story. Require the card's named object and an explicit delivery to the player.
function storyPurchaseGaps(story, gained, receipts, playerNames, npcNames) {
  const players = [...new Set(playerNames.filter(Boolean))]
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!players) return [];
  const carried = /(?:将|把)([^，,。！？；]{2,36}?)(?:收|放|揣|摄|纳)(?:进|入)(?:了)?(?:自己(?:的)?)?(?:袖|怀|行囊|储物袋|囊)(?:中|里)?/g;
  const accepted = /(?:接过|收下|拿到|领到)(?:了)?([^，,。！？；]{2,24})/g;
  const subject = new RegExp(`^(?:${players})`);
  const otherActors = [...OTHERS.split('|'), '小贩', ...npcNames.filter(Boolean)];
  const deliveries = plain(story).replace(/[“『"][^”』"]*[”』"]/g, '。').split(/[。！？!?；;\n]/)
    .map(s => s.trim()).filter(s => subject.test(s) && !DENY_BEFORE.test(s) && !SUPPOSE.test(s));
  const missing = new Set();
  for (const r of receipts) {
    if (!r.ok || r.kind !== 'act' || r.trade?.direction !== 'buy' || r.trade.fee || r.trade.settled
      || !r.paid?.some(payment => payment.stat === '灵石' && payment.after < payment.before)) continue;
    const title = plain(r.card?.title).match(/^(?:买下|买入|购下|购入|购得)([^，,。！？；]{2,24})$/);
    if (!title) continue;
    const name = itemNameFrom(title[1]);
    if (name.length < 2 || name.length > 10 || (!ITEM_LIKE.test(name) && !/(?:残件|构件|部件|零件)$/.test(name))
      || /灵石$/.test(name) || npcNames.includes(name) || gained.some(item => sameItemName(item, name))) continue;
    const delivered = deliveries.some(sentence => [...sentence.matchAll(carried), ...sentence.matchAll(accepted)]
      .some(match => {
        const head = sentence.slice(0, match.index);
        const clause = head.split(/[，,：:]/).at(-1).replace(subject, '').trim();
        return itemNameFrom(match[1]) === name && !/[没未不别莫勿想欲]$/.test(clause)
          && !/看着|看见|瞧见|目睹|递给/.test(clause)
          && !otherActors.some(actor => clause.startsWith(actor));
      }));
    if (delivered) missing.add(`「${name}」已经扣款，正文也写了你收货，但本回合没有对应的新入囊物品。用正文名称登记；已用别名登记的，沿用原编号并统一名称，勿再加一件`);
  }
  return [...missing];
}

// Read a definite pickup whose objects were named in the previous sentence. Keep this stricter
// than the free-text hints: the protagonist, the drop and the number of distinct items must agree.
function collectiveLootGaps(story, gained, playerNames, npcNames) {
  const players = [...new Set(playerNames.filter(Boolean))]
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!players) return [];
  const inHand = `(?:落入|飞入|滚入|滑入)(?:了)?(?:(?:${players})的?)?(?:掌[中心]|手[中里])`;
  const putAway = '收下|收起|收妥|收入(?:囊中|储物袋|袖中)|揣入袖中';
  const pickup = new RegExp(`^(?:${players})([^。！？；]{0,28}?)([两二三四])(?:件(?:东西|物品)?|物)(?:轻巧|稳稳|同时|一齐|应声|尽数|一并|都)?(?:${inHand}|${putAway})$`);
  const counts = { 两: 2, 二: 2, 三: 3, 四: 4 };
  const told = plain(story).replace(/[“「『"][^”」』"]*[”」』"]/g, '。');
  const sentences = told.split(/[。！？!?；;\n]/).map(s => s.trim()).filter(Boolean);
  const missing = new Set();
  for (let index = 1; index < sentences.length; index += 1) {
    const current = sentences[index], previous = sentences[index - 1];
    const caught = current.match(pickup);
    if (!caught || DENY_BEFORE.test(current) || SUPPOSE.test(current)
      || /看[到见着]|望见|见到|目睹|[，,]\s*(?:他|她|对方|那人)/.test(caught[1])) continue;
    if (DENY_BEFORE.test(previous) || SUPPOSE.test(previous)) continue;
    const dropped = previous.match(/(?:遗落下|遗落|遗下|掉落下|掉落|掉下|散落着|散落)([^。！？；]{2,90})$/);
    if (!dropped) continue;
    const names = [...new Set(itemNamesFrom(dropped[1]))];
    if (names.length !== counts[caught[2]] || names.some(name => !name || name.length > 10
      || !ITEM_LIKE.test(name) || npcNames.includes(name))) continue;
    const candidates = new Set(gained);
    for (const name of names) {
      if (/灵石$/.test(name)) continue;
      const actual = candidates.has(name) ? name
        : [...candidates].find(item => sameItemName(item, name));
      if (actual) candidates.delete(actual);
      else missing.add(`正文写了你拾得「${name}」，本回合却没有对应的新入囊物品。用正文名称逐件登记；已用别名登记的，沿用原编号并统一名称，勿再加一件`);
    }
  }
  return [...missing];
}

// A story that hands the player a thing which never reaches the bag leaves the two
// apart: the next turn the player cannot use it.
function storyAcquisitions(story, bagNames, playerNames, npcNames) {
  const text = plain(story);
  const players = [...new Set(playerNames.filter(Boolean))].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!players) return [];
  const patterns = [
    new RegExp(`(?:把|将)([^，。；！？!?]{1,24}?)(?:塞|递|放|交|送|扔|抛|丢|分|赏|揣)(?:到|进|给|入|在)(?:${players})(?:的)?(?:手|怀|掌|袖)?`, 'g'),
    new RegExp(`(?:递给|交给|送给|赠予|赠给|塞给|分给|赏给|拿给|丢给|抛给|塞进)(?:${players})(?:的)?(?:手[里中上]?|怀[里中])?(?:了)?([^，。；！？!?]{1,16})`, 'g'),
    new RegExp(`(?:${players})(?:伸手|连忙|赶紧|顺手)?(?:接过|收下|收进|拿到|领到|得到|获得)(?:了)?([^，。；！？!?]{1,16})`, 'g'),
  ];
  // Loot the player finds: "你蹲下身，从他怀里搜出一包碎灵砂". When someone else becomes the
  // subject in between ("他从药篓里翻出"), it is their own find.
  const finds = new RegExp(`(?:${players})([^。；！？!?]{0,16}?)(?:搜出|搜到|翻出|翻到|找到|找出|捡到|捡起|拾起|拾得|起出)(?:了)?([^，。；！？!?]{1,16})`, 'g');
  const found = [...text.matchAll(finds)]
    .filter(match => {
      const between = match[1], clause = between.split(/[，,]/).at(-1);
      return !/[看见望瞧听]/.test(between) && !npcNames.some(npc => npc && between.includes(npc))
        && !/^(?:他|她|它|对方|那人|此人|其|众人)/.test(clause)
        && !DENY_BEFORE.test(clause) && !SUPPOSE.test(clause) && !/[没未不]$/.test(clause);
    })
    .map(match => match[2]);
  // The ways a thing changes hands in the owner's fourth playtest, none of which the patterns above
  // read (sixty-six turns, a dozen things handed over, no doubt raised): someone takes it out and
  // hands it toward the player (「摸出一枚带血的黑铁信牌…，颤巍巍递了过来」「摸出一枚测灵简，塞入你手中」;
  // 递上前去 and 递了过去 go away from the player), presses it on them (「塞来一面通关木押」), or the
  // player takes it (「伸手将那支黄精与薄绢图录顺势接过」「翻手将墨铁匣连同…一并收妥」); the turns
  // after the fix showed two more: handed with 递来 (「摸出一枚泛黄的薄绢递来」), and a thing that
  // lands in the player's palm (「那截微光闪烁的残盘翻落掌中」; not one the player took out in that
  // sentence, nor one coming 从 or 自 somewhere, which is most often their own bag). Read outside
  // the speech in “”, which offers and promises; a denied or supposed one is none.
  const told = text.replace(/[“"『][^”"』]*[”"』]/g, '，');
  const toward = `(?:过来|来(?=[，。；！？!?、\\s]|$)|(?:到|入|进)(?:${players})(?:的)?(?:手|怀|掌|面前|跟前)|给(?:${players}))`;
  const handed = [
    new RegExp(`(?:摸出|掏出|取出|拿出|解下|翻出)(?:了)?([^，。；！？!?]{1,24}?)(?:[，,][^，。；！？!?]{0,8})?(?:递|奉|塞|交|送|推|放)(?:了)?${toward}`, 'g'),
    new RegExp(`(?:塞来|递来|送来|扔来|抛来|丢来|递过来|扔过来|抛过来|丢过来|塞过来|送过来)(?:了)?([^，。；！？!?]{1,16})`, 'g'),
    new RegExp(`(?:${players})[^。；！？!?]{0,12}?(?:将|把)([^，。；！？!?]{1,24}?)(?:一并|顺势|顺手|随手|小心翼翼地|小心地|郑重地|稳稳地|轻轻)?(?:接过|收下|收入|收进|收妥|收好|揣入|揣进|纳入)`, 'g'),
  ].flatMap(pattern => [...told.matchAll(pattern)])
    .filter(match => !DENY_BEFORE.test(match[0]) && !SUPPOSE.test(match[0]) && !/[没未不别莫勿]$/.test(match[0].slice(0, match[0].indexOf(match[1]))))
    .map(match => match[1]);
  const lands = new RegExp(`([^，。；！？!?]{1,16}?)(?:翻落|跌落|滚落|掉落|滑落|落入|落进|落到|落在|飞入|飞落|弹入|滑入|跃入)(?:了)?(?:${players})?(?:的)?(?:掌|手)(?:中|心|里|上)`, 'g');
  const takesOut = new RegExp(`(?:${players})[^。；！？!?]{0,16}?(?:取出|倒出|摸出|掏出|拿出|翻出)`);
  const landed = [...told.matchAll(lands)]
    .filter(match => {
      const sentence = told.slice(0, match.index).split(/[。！？!?\n]/).at(-1);
      return !DENY_BEFORE.test(match[0]) && !SUPPOSE.test(match[0]) && !/从|自/.test(match[1])
        && !new RegExp(players).test(match[1]) && !takesOut.test(sentence);
    })
    .map(match => match[1]);
  const owned = [...bagNames].filter(Boolean);
  const mismatches = new Set();
  const phrases = [...patterns.flatMap(pattern => [...told.matchAll(pattern)].map(match => match[1])), ...found, ...handed, ...landed];
  for (const name of phrases.flatMap(itemNamesFrom)) {
    if (!name || name.length > 10 || !ITEM_LIKE.test(name) || npcNames.includes(name)) continue;
    // Spirit stones are counted in the player's 当前灵石 column, not kept in the bag.
    if (/灵石$/.test(name)) continue;
    const known = owned.some(item => item === name || item.endsWith(name) || name.endsWith(item));
    if (!known) mismatches.add(`正文写了你得到「${name}」，但储物袋里没有登记；用set登记进储物袋，或改写正文`);
  }
  return [...mismatches];
}

// Spirit stones the story moves into or out of the player's purse (当前灵石, column 26), read from
// each mention of stones: who acts on them and how. Speech is left out, since offers, prices and
// promises are not payments, and so are negated, supposed and asked clauses and other people's
// purses. Returns the first phrase of each direction, or null.
const STONE_MENTION = /(?:(?:[一二两三四五六七八九十百千万几数\d]+|不少|许多|一些|大把|若干|几十|数十|上百)(?:块|枚|颗|粒|袋|包|锭|串|堆|把|小袋|些)?)?(?:下品|中品|上品|极品)?灵石(?![矿脉碎粉屑髓液乳精袋阵])/g;
const OWN_PURSES = '自己|储物袋|怀|袖|囊|口袋|钱袋|腰包|包裹|兜|袋|掌心|手心';
// Putting stones away (收好、收进、揣起、攒下) is not getting new ones.
const RECEIVE = '接过|收下|拿到|领到|得到|获得|得了|赚了|赚到|挣了|挣到|分到|捡到|捡起|拾起|拾得|搜出|搜到|翻出|翻到|找到|找出|起出|赢了|赢得|换得|换来|换了|卖得|卖了|收了';
const PAY = '付了|付出|支付|付给|花了|花去|花费|花掉|交了|交出|赔了|赔给|输了|输掉|押上|押了|抵上|买下|买了';
const HAND_OVER = '递|交|塞|付|赔|还|送|扔|抛|丢|推|放';
// Someone other than the player who may be the subject of a clause.
const OTHERS = '他们|她们|他|她|它|对方|那人|此人|其人|众人|旁人|掌柜|店家|小二|伙计|老板|执事|管事|弟子|师兄|师姐|师弟|师妹|老者|老汉|老妇|妇人|少女|少年|大汉|汉子|和尚|道士|老道|修士|散修|商人|摊主|船夫|车夫|守卫|护卫|山贼|劫匪|贼人|对手|敌人';
function stoneFlow(story, playerNames, npcNames) {
  // Dialogue in “” is speech; 「」 only marks a name here.
  const text = plain(story).replace(/[“"『][^”"』]*[”"』]/g, '，').replace(/[「」]/g, '');
  const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const players = [...new Set(playerNames.filter(Boolean))].map(escape).join('|');
  const flow = { gained: null, paid: null };
  if (!players) return flow;
  const others = [...new Set(npcNames.filter(name => name && !playerNames.includes(name)))].map(escape).concat(OTHERS).join('|');
  const subject = new RegExp(`(${players})|(${others})`, 'g');
  const fine = clause => !DENY_BEFORE.test(clause) && !SUPPOSE.test(clause) && !/[？?]/.test(clause)
    && !/[没未不别莫勿]$/.test(clause.trim()) && !/[想盼]要?$/.test(clause.trim());
  // The player acts when the nearest subject before `at` in the sentence is the player, or when
  // the sentence names nobody (second-person narration leaves 你 out of later clauses).
  // A name after a preposition (从山贼怀里, 向掌柜) is not the one acting.
  const playerActs = (sentence, at) => {
    const named = [...sentence.slice(0, at).matchAll(subject)]
      .filter(match => !/(?:从|向|对|朝|跟|与|和|同|给|替|为|把|将|往|自|冲|问|找|求|随)$/.test(sentence.slice(Math.max(0, match.index - 2), match.index)))
      .at(-1);
    return !named || !!named[1];
  };
  const giveTo = new RegExp(`(?:递给|交给|送给|赠予|赠给|塞给|分给|赏给|拿给|丢给|抛给|付给|赔给|还给|给了|给|赏了|赏|塞进|塞到)(?:${players})(?:的)?(?:手[里中上]?|怀[里中]|掌心)?(?:了)?[^，,。]{0,4}$`);
  const putTo = new RegExp(`^[^，,。]{0,6}?(?:${HAND_OVER}|拍|分)(?:了)?(?:到|进|给|入|在)(?:${players})`);
  const received = new RegExp(`(?:${RECEIVE})(?:了)?[^，,。]{0,8}$`);
  const payVerb = new RegExp(`(?:${PAY})(?:了)?[^，,。]{0,8}$`);
  const handOff = new RegExp(`^[^，,。]{0,6}?(?:${HAND_OVER})(?:了)?(?:过去|给|到|进|入|在)(?!(?:${players}|${OWN_PURSES}))`);
  const takeOut = /(?:掏出|摸出|取出|拿出|数出|抓出|抓起)(?:了)?[^，,。]{0,8}$/;
  // Taken from the player: 山贼从你怀里搜走, 你被劫走了, 抢走了你的.
  const takeAway = /(?:搜走|抢走|夺走|偷走|拿走|摸走|顺走|骗走|讹走|劫走|收走|抢去|夺去|骗去)(?:了)?[^，,。]{0,8}$/;
  const takenFrom = new RegExp(`从(?:${players})|(?:${players})被|(?:${players})的`);
  for (const sentence of text.split(/(?<=[。！？!?\n；;])/)) {
    for (const mention of sentence.matchAll(STONE_MENTION)) {
      const at = mention.index, phrase = mention[0];
      const head = sentence.slice(0, at);
      const clause = head.slice(Math.max(...[...'，,：:'].map(mark => head.lastIndexOf(mark))) + 1);
      const tail = sentence.slice(at + phrase.length);
      if (!fine(clause)) continue;
      const verb = (pattern) => { const found = clause.match(pattern); return found ? head.length - clause.length + found.index : -1; };
      if (!flow.gained) {
        if (giveTo.test(clause) || (/(?:把|将)[^，,。]{0,4}$/.test(clause) && putTo.test(tail))) flow.gained = phrase;
        else if (verb(received) >= 0 && playerActs(sentence, verb(received))) flow.gained = phrase;
      }
      if (!flow.paid) {
        const pay = verb(payVerb);
        const handed = /(?:把|将)[^，,。]{0,4}$/.test(clause) || takeOut.test(clause);
        if (pay >= 0 && playerActs(sentence, pay)) flow.paid = phrase;
        else if (takeAway.test(clause) && takenFrom.test(clause)) flow.paid = phrase;
        else if (handed && handOff.test(tail)) {
          const by = verb(/(?:把|将|掏出|摸出|取出|拿出|数出|抓出|抓起)[^，,。]{0,8}$/);
          if (playerActs(sentence, by)) flow.paid = phrase;
        }
      }
    }
  }
  return flow;
}

// The purse the story's commands leave against the one the receipts left. Only for a turn whose
// receipts did not settle the purse: then the model's commands may not touch it anyway.
function purseBookkeeping(story, purse, playerNames, npcNames) {
  if (!purse || purse.base === null) return [];
  const flow = stoneFlow(story, playerNames, npcNames);
  const book = 'upstore里用add("B1",{"26":"新的总数"})记上（单位下品灵石，中品灵石按100块折算）';
  if (flow.gained && flow.paid) {
    return purse.final === purse.base ? [`正文写了灵石的进出（得到「${flow.gained}」、付出「${flow.paid}」），当前灵石却没有变化（仍为${purse.base}块）；${book}`] : [];
  }
  if (flow.gained && purse.final <= purse.base) return [`正文写了你得到「${flow.gained}」，当前灵石却没有增加（仍为${purse.base}块）；${book}`];
  if (flow.paid && purse.final >= purse.base) return [`正文写了你付出「${flow.paid}」，当前灵石却没有减少（仍为${purse.base}块）；${book}`];
  return [];
}

// Split a command block the way the card's own scanner does (double-quoted
// strings, nested parentheses). Returns null when the block cannot be split,
// leaving the error to the normal parse.
function splitCommands(text) {
  const spans = [];
  let cursor = 0;
  while (cursor < text.length) {
    const rest = text.slice(cursor);
    const space = rest.match(/^[\s;]+|^\/\/[^\n]*(?:\n|$)|^\/\*[\s\S]*?\*\//);
    if (space) { cursor += space[0].length; continue; }
    const opening = rest.match(/^([A-Za-z_]\w*)\s*\(/);
    if (!opening) return null;
    let depth = 1, inString = false, escaped = false, end = -1;
    for (let i = cursor + opening[0].length; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) { end = i; break; }
    }
    if (end < 0) return null;
    spans.push(text.slice(cursor, end + 1));
    cursor = end + 1;
  }
  return spans;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  }
  return value;
}

// A model command that exactly repeats a receipt operation changes nothing;
// drop it so the receipt is applied once. Any other edit stays and is judged.
function dropReceiptRepeats(parseOne, text, receipts) {
  const keys = new Set();
  for (const r of receipts) {
    if (!r.ok || !r.commands) continue;
    for (const op of parseOne(r.commands) || []) keys.add(JSON.stringify(canonical(op)));
  }
  const spans = keys.size ? splitCommands(text || '') : null;
  if (!spans) return { text: text || '', dropped: [] };
  const kept = [], dropped = [];
  for (const span of spans) {
    const ops = parseOne(span);
    if (ops && ops.length === 1 && keys.has(JSON.stringify(canonical(ops[0])))) dropped.push(span);
    else kept.push(span);
  }
  return { text: kept.join('\n'), dropped };
}

function ownedSets(receipts) {
  const sets = { items: new Set(), stats: new Set(), npcItems: new Set(), charStats: new Set(), skills: new Set(), quests: new Set(), grants: new Set(), currency: false, life: false, where: null };
  for (const r of receipts) {
    if (!r.ok) continue;
    (r.owns?.items || []).forEach(i => sets.items.add(i));
    (r.owns?.stats || []).forEach(s => sets.stats.add(s));
    (r.owns?.npcItems || []).forEach(s => sets.npcItems.add(s));
    (r.owns?.charStats || []).forEach(s => sets.charStats.add(s));
    (r.owns?.skills || []).forEach(s => sets.skills.add(s));
    (r.owns?.quests || []).forEach(s => sets.quests.add(s));
    (r.owns?.grants || []).forEach(s => sets.grants.add(s));
    sets.currency ||= !!r.owns?.currency;
    sets.life ||= !!r.owns?.life;
    sets.where = r.owns?.where || sets.where;
  }
  return sets;
}

function hasOwned(sets) {
  return sets.items.size || sets.stats.size || sets.npcItems.size || sets.charStats.size || sets.skills.size || sets.quests.size || sets.grants.size || sets.currency || sets.life;
}

// The values the receipts settled, read from a table state. A character row
// missing from `scope` (a foe that fled or died and left the scene) is skipped.
function ownedValues(ctx, state, sets, scope = null) {
  const stats = ctx.parseNestedJsonString(state['0']?.B1?.['11'], {}) || {};
  const npc = {};
  for (const key of sets.npcItems) {
    const [id, item] = key.split(':');
    const inventory = ctx.parseNestedJsonString(ctx.parseRemarksString(state['0']?.[id]?.['9']).inventory, []);
    const entry = Array.isArray(inventory) ? inventory.find(i => (i?.['0'] || i?.id) === item) : null;
    npc[key] = entry ? String(entry['5'] ?? entry.quantity ?? 1) : null;
  }
  const characters = [...sets.charStats].filter(key => !scope || key.startsWith('B1:') || scope['0']?.[key.split(':')[0]]).map(key => {
    const [id, stat] = key.split(':');
    const values = ctx.parseNestedJsonString(state['0']?.[id]?.['11'], {}) || {};
    return [key, values[stat]?.current ?? null, values[stat]?.max ?? null];
  });
  return JSON.stringify({
    items: [...sets.items].map(id => state['1']?.[id] ? [id, state['1'][id]['1'], String(state['1'][id]['5'] ?? 1)] : [id, null]),
    stats: [...sets.stats].map(s => [s, stats[s]?.current ?? null, stats[s]?.max ?? null]),
    npc,
    characters,
    skills: [...sets.skills].map(id => [id, state['8']?.[id]?.['6'] ?? null, state['8']?.[id]?.['7'] ?? null]),
    quests: [...sets.quests].map(id => [id, state['6']?.[id]?.['3'] ?? null, state['6']?.[id]?.['5'] ?? null]),
    currency: sets.currency ? state['0']?.B1?.['26'] ?? null : null,
    // A granted item may sit in one stack only as many times as the receipt gave it.
    grants: [...sets.grants].map(name => [name, Object.values(state['1'] || {}).filter(row => row && rowName(row) === name)
      .reduce((sum, row) => sum + (Number(ctx.itemStackCount(row['5'])) || 0), 0)]),
    // In a life save, the favour of everyone on the scene (`scope`, as above).
    ...(sets.life ? { favour: Object.keys((scope || state)['0'] || {}).filter(id => /^[CG]/.test(id))
      .map(id => [id, String(state['0']?.[id]?.['15'] ?? '').trim()]) } : {}),
    // and the map place the player is at, when the receipts say where that is (lifeOwns)
    ...(sets.life && sets.where ? { place: placeOfRow(sets.where, mechanics.clockRow(state)?.['0'] ?? '') ?? null } : {}),
  });
}

// Does this operation touch nothing but engine-owned values?
function ownedOnly(op, sets) {
  const id = op.command === 'set' ? op.data?.['0'] : op.id;
  if (sets.items.has(id)) return true;
  if (sets.life && id === 'frxPlay') return true;
  if (op.command === 'de' && op.subCategory && sets.npcItems.has(`${op.id}:${op.subId}`)) return true;
  if (op.command === 'equipItem' && id === 'B1') return sets.items.has(op.item?.data?.['0']);
  if (sets.skills.has(id) && op.command === 'add' && op.data) return Object.keys(op.data).every(column => column === '6' || column === '7');
  if (sets.quests.has(id) && op.command === 'add' && op.data) return Object.keys(op.data).every(column => column === '3' || column === '5');
  if (id && id !== 'B1' && /^[CG]/.test(id)) {
    if (op.command === 'updateAttribute') return sets.charStats.has(`${id}:${op.attribute === 'hp' ? '血量' : op.attribute}`);
    if (op.command !== 'add' || !op.data) return false;
    return Object.entries(op.data).every(([column, value]) => (column === '11' && statKeys(value).every(key => sets.charStats.has(`${id}:${key}`)))
      || (sets.life && column === '15'));
  }
  if (id !== 'B1') return false;
  if (op.command === 'updateAttribute') return sets.stats.has(op.attribute === 'hp' ? '血量' : op.attribute);
  if (op.command !== 'add' || !op.data) return false;
  return Object.entries(op.data).every(([column, value]) => {
    if (column === '11') return statKeys(value).every(key => sets.stats.has(key));
    if (column === '26') return sets.currency;
    if (column === '9' && value && typeof value === 'object') {
      return Object.keys(value).every(key => key === 'hp' && sets.stats.has('血量'));
    }
    return false;
  });
}

module.exports = { RULES, lifePills, CHECK_GROUPS, CHECK_WORDS, TRADE_WORDS, COMBAT_WORDS, SKILL_WORDS, modifierFor, checkOutcome, lifeOwns, claimsBreakthrough, refusedConsumption, storyAcquisitions, collectiveLootGaps, storyPurchaseGaps, stoneFlow, purseBookkeeping, itemNameFrom, parseEffects, presettle, useItem, claimItem, resolveCheck, lookupInventory, checkOwnership, checkStory, expendable, splitCommands, dropReceiptRepeats, ownedSets, ownedValues, ownedOnly, hasOwned, freeCharacterId, castOf, movedOn, fallenLeftBehind, mechanics };
