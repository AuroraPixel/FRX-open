/* Engine mechanics for pilot turns beyond items and checks: realms, total
 * attributes, combat exchanges, skill use, equipment and quest settlement.
 * Each result is a receipt that carries the original card's commands, exactly
 * like turn-rules.cjs, so the server and the client apply the same change.
 * Rule numbers live in content/combat.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const { create } = require('./core/random.cjs');
const { plain, quantity: chineseNumber } = require('./item-use.cjs');

const COMBAT = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../content/combat.json'), 'utf8'));
const STATS = ['血量', '物攻', '物防', '脚力', '法攻', '法防', '法力', '神识', '物理穿透', '法术穿透', '气运', '魅力'];
const SLOT_TYPES = { weapon: '武器', armor: '护甲', technique: '功法', treasure: '法宝' };
const SLOT_OF = Object.fromEntries(Object.entries(SLOT_TYPES).map(([slot, type]) => [type, slot]));
const FINISHED = /已完成|已失败|已放弃|达成|失败|放弃/;
const CURRENCY = { 下品灵石: 1, 灵石: 1, 中品灵石: 100, 上品灵石: 10000, 极品灵石: 1000000 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const rowName = row => plain(row?.['1']).split('|')[0];
// An exchange's stated intent that only draws something out. 试探性出手 is still a strike.
const LURE = /引出|引诱|诱出|诱敌|吸引|惊动|惊出|打草惊蛇|投石问路|引蛇出洞|探路|问路|试探(?!性)/;
const noOwnership = () => ({ items: [], stats: [], forbid: [], charStats: [], skills: [], quests: [], grants: [], currency: false });

function refusal(kind, reason, extra = {}) {
  return { kind, ok: false, reason, commands: '', owns: noOwnership(), summary: `${extra.label || '未结算'}：${reason}`, ...extra };
}

// ---------------------------------------------------------------- realms

function parseRealm(text) {
  let source = plain(text).split('|')[0].trim();
  for (const [from, to] of Object.entries(COMBAT.realms.aliases)) source = source.replaceAll(from, to);
  const order = COMBAT.realms.order;
  // 半步筑基 is the top of the realm below; 假丹 the peak of 筑基.
  const half = source.match(new RegExp(`半步(${order.slice(2).join('|')})`));
  if (half) {
    const below = order.indexOf(half[1]) - 1;
    return { major: below, minor: below === 1 ? 13 : 4, name: order[below], text: source };
  }
  if (source.includes('假丹')) return { major: 2, minor: 4, name: '筑基', text: source };
  const major = order.findIndex((name, index) => index > 0 && source.includes(name));
  if (major > 0) {
    let minor = 0;
    if (major === 1) {
      const layer = source.match(/([一二三四五六七八九十\d]+)层/);
      minor = layer ? clamp(chineseNumber(layer[1]) || 0, 0, 13) : /大圆满|圆满|巅峰/.test(source) ? 13 : 0;
    } else {
      for (const [word, stage] of Object.entries(COMBAT.realms.stages)) if (source.includes(word)) { minor = stage; break; }
    }
    return { major, minor, name: order[major], text: source };
  }
  if (new RegExp(COMBAT.realms.mortal).test(source)) return { major: 0, minor: 0, name: '凡人', text: source };
  const beast = source.match(/([一二三四五六七八九十])(?:阶|级)/);
  if (beast && COMBAT.realms.beasts[beast[1]]) {
    const [beastMajor, beastMinor] = COMBAT.realms.beasts[beast[1]];
    return { major: beastMajor, minor: beastMinor, name: order[beastMajor], text: source, beast: true };
  }
  return { major: 0, minor: 0, name: '凡人', text: source || '凡人', unknown: true };
}

// A row whose realm text names no known realm is placed by its panel instead.
function inferRealm(stats, text) {
  const attack = Math.max(statValue(stats['物攻'], 'max'), statValue(stats['法攻'], 'max'), 1);
  const hp = Math.max(statValue(stats['血量'], 'max'), 1);
  let best = null;
  COMBAT.realms.order.forEach((name, major) => {
    const table = COMBAT.baselines[name];
    if (!table) return;
    const mid = key => Math.max(1, (table[key][0] + table[key][1]) / 2);
    const score = Math.abs(Math.log(attack / mid('物攻'))) + Math.abs(Math.log(hp / mid('血量')));
    if (!best || score < best.score) best = { major, name, score };
  });
  return { major: best.major, minor: 0, name: best.name, text: `${plain(text).split('|')[0] || '境界未注明'}（按属性折算为${best.name}）`, inferred: true };
}

function realmGap(attacker, defender) {
  // A mortal sits just below the first layer of 炼气: that gap counts in layers, not as a major realm.
  if (Math.min(attacker.major, defender.major) === 0 && Math.max(attacker.major, defender.major) === 1) {
    const layer = realm => (realm.major === 0 ? 0 : realm.minor || 5);
    return { major: 0, minor: layer(attacker) - layer(defender) };
  }
  const major = attacker.major - defender.major;
  const minor = major === 0 && attacker.minor && defender.minor ? attacker.minor - defender.minor : 0;
  return { major, minor };
}

function realmPosition(realm) {
  if (realm.major === 0) return 0.5;
  if (realm.major === 1) return realm.minor ? (realm.minor - 1) / 12 : COMBAT.realms.position.unknown;
  return COMBAT.realms.position.stages[realm.minor] ?? COMBAT.realms.position.unknown;
}

// The health a typical character of this realm has; damage is measured against it.
function referenceHp(realm) {
  const [low, high] = (COMBAT.baselines[realm.name] || COMBAT.baselines['凡人'])['血量'];
  return Math.max(1, low + (high - low) * realmPosition(realm));
}

// Stable per character: the same NPC always gets the same baseline.
function baselineStats(realm, key) {
  const table = COMBAT.baselines[realm.name] || COMBAT.baselines['凡人'];
  const random = create('baseline:' + key);
  const position = realmPosition(realm);
  const stats = {};
  for (const [stat, [low, high]] of Object.entries(table)) {
    const jitter = realm.major === 0 && stat === '血量' ? 1 : 0.92 + 0.16 * random.random();
    const value = Math.max(0, Math.round((low + (high - low) * position) * jitter));
    stats[stat] = { current: value, max: value };
  }
  stats['气运'] = { current: 3, max: 3 };
  stats['魅力'] = { current: 3, max: 3 };
  return stats;
}

// ---------------------------------------------------------------- attributes

function statValue(entry, field = 'current') {
  if (entry && typeof entry === 'object') return Number(entry[field] ?? entry.current) || 0;
  return Number(entry) || 0;
}

function readStats(env, id) {
  const row = env.state['0']?.[id];
  const parsed = row ? env.ctx.parseNestedJsonString(row['11'], {}) : {};
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function hasCombatStats(stats) {
  return statValue(stats['血量'], 'max') > 0 && '物攻' in stats;
}

// The same sources the attribute panel adds: worn gear (player), ①buffs(…) and trait bonuses.
function totalStats(env, id, stats) {
  const row = env.state['0']?.[id] || {};
  const bonus = Object.fromEntries(STATS.map(stat => [stat, 0]));
  if (id === 'B1') {
    for (const item of env.ctx.equippedItemRows(row)) {
      const effect = (item.type === '功法' ? item.currentEffect || item.effect : item.effect) || '';
      for (const part of String(effect).split(/[,，]/)) {
        const match = part.trim().match(/([一-龥]+)\s*([+-])\s*(\d+\.?\d*)(%?)/);
        if (!match || !(match[1] in bonus)) continue;
        const value = (match[2] === '+' ? 1 : -1) * parseFloat(match[3]);
        bonus[match[1]] += match[4] ? Math.floor(statValue(stats[match[1]], 'max') * value / 100) : value;
      }
    }
  }
  const status = plain(row['4']);
  if (status && status !== '一切正常') {
    for (const match of status.matchAll(/[①-⑳][^:(]+:?.*?\(([^)]*)\)/g)) {
      for (const segment of match[1].split(/[,，|]/)) {
        const value = segment.trim().match(/^([一-龥]+)\s*([+-])\s*(\d+)/);
        if (value && value[1] in bonus) bonus[value[1]] += (value[2] === '+' ? 1 : -1) * parseInt(value[3], 10);
      }
    }
  }
  const traits = env.ctx.parseNestedJsonString(env.ctx.parseRemarksString(row['9']).traits, []);
  if (Array.isArray(traits)) {
    for (const trait of traits) {
      for (const [stat, value] of Object.entries(trait?.bonus || {})) if (stat in bonus && Number.isFinite(Number(value))) bonus[stat] += Number(value);
    }
  }
  return Object.fromEntries(STATS.map(stat => [stat, Math.max(0, Math.round(statValue(stats[stat]) + bonus[stat]))]));
}

function nextCharacterId(env) {
  const used = new Set([...Object.keys(env.state['0'] || {}), ...(env.knownIds || []), ...(env.reservedIds || [])]);
  let n = COMBAT.foes?.firstId || 501;
  while (used.has('C' + n)) n += 1;
  (env.reservedIds ||= new Set()).add('C' + n);
  return 'C' + n;
}

// The words of the status column that say someone is down or dead. 尸 alone would also catch a
// living status such as 身中尸毒.
const FALLEN_WORDS = /重伤倒地|倒地不起|身亡|死亡|已死|毙命|气绝|殒命|伏诛|尸体|尸首|尸身|焦尸|遗体/;

// Down at 0 health, or written as dead in the status column.
function isFallen(ctx, row) {
  const stats = ctx.parseNestedJsonString(row?.['11'], {}) || {};
  const hp = stats['血量'];
  return Boolean(hp && Number(hp.max) > 0 && Number(hp.current) <= 0)
    || FALLEN_WORDS.test(plain(row?.['4']));
}

// A character who left the scene comes back from the biography the card keeps for them. By
// name, a fallen one is not coming back: a new foe may share a plain name like 山贼.
function biographyRow(env, idOrName) {
  const key = plain(idOrName);
  if (!key || !env.biographies) return null;
  if (env.biographies[key]) return { id: key, row: env.biographies[key] };
  const found = Object.entries(env.biographies).find(([, row]) => rowName(row) === key && !isFallen(env.ctx, row));
  return found ? { id: found[0], row: found[1] } : null;
}

function rowRealm(row, stats) {
  const realm = parseRealm(row['2']);
  return realm.unknown && hasCombatStats(stats) ? inferRealm(stats, row['2']) : realm;
}

// A fighter: an on-scene character, a returning one, or a new foe registered from a name and realm.
function fighter(env, id, name, realmText, label, commands) {
  if (id && !env.state['0']?.[id]) {
    // The model sometimes names a character instead of giving the ID.
    const named = Object.entries(env.state['0'] || {}).find(([, row]) => row && rowName(row) === plain(id));
    if (named) id = named[0];
    else {
      const returning = biographyRow(env, id);
      if (!returning) return { error: `${label}「${id}」不在当前场景中` };
      return restore(env, returning, commands);
    }
  }
  if (id) {
    const row = env.state['0'][id];
    let stats = readStats(env, id);
    if (!hasCombatStats(stats)) {
      // An older NPC without a panel gets the realm baseline written once.
      stats = { ...baselineStats(parseRealm(row['2']), `${env.archiveId || ''}:${id}`), ...stats };
      commands.push(`add(${JSON.stringify(id)},{"11":${JSON.stringify(stats)}})`);
    }
    return { id, name: rowName(row) || id, realm: rowRealm(row, stats), stats, row };
  }
  const foeName = plain(name).slice(0, 20);
  if (!foeName) return { error: `${label}没有给出人物ID，也没有给出新对手的名称` };
  // A character already on the scene, or one who left it, is the same person, not a new foe.
  const known = Object.entries(env.state['0'] || {}).find(([, row]) => row && rowName(row) === foeName);
  if (known) return fighter(env, known[0], '', '', label, commands);
  const returning = biographyRow(env, foeName);
  if (returning) return restore(env, returning, commands);
  if (!plain(realmText)) return { error: `新对手「${foeName}」需要给出境界，例如凡人、炼气三层、一阶妖兽` };
  const realm = parseRealm(realmText);
  if (realm.unknown) return { error: `认不出境界「${plain(realmText)}」，请写成凡人、炼气N层、筑基初期、N阶妖兽这类标准写法` };
  const newId = nextCharacterId(env);
  const stats = baselineStats(realm, `${env.archiveId || ''}:${newId}:${foeName}`);
  const row = { 0: newId, 1: foeName, 2: `${plain(realmText).slice(0, 20)}|敌对`, 3: '待定', 4: '一切正常', 9: '',
                10: '战斗中遭遇的对手', 11: stats, 12: '待定', 31: 'true', 32: 'false' };
  commands.push(`set(${JSON.stringify(row)})`);
  return { id: newId, name: foeName, realm, stats, row: { ...row, 11: JSON.stringify(stats) }, registered: true };
}

function restore(env, returning, commands) {
  const row = { ...returning.row, 0: returning.id };
  commands.push(`set(${JSON.stringify(row)})`);
  let stats = env.ctx.parseNestedJsonString(row['11'], {}) || {};
  if (!hasCombatStats(stats)) {
    stats = { ...baselineStats(parseRealm(row['2']), `${env.archiveId || ''}:${returning.id}`), ...stats };
    commands.push(`add(${JSON.stringify(returning.id)},{"11":${JSON.stringify(stats)}})`);
  }
  return { id: returning.id, name: rowName(row) || returning.id, realm: rowRealm(row, stats), stats, row, restored: true };
}

// ---------------------------------------------------------------- skills

function spellManaCost(max, percent = COMBAT.damage.spellCostPercent) {
  return Math.max(1, Math.ceil(max * percent / 100));
}

function skillCost(skill, stats) {
  const text = plain(skill['8']);
  if (!text || /^(?:无|0|零)/.test(text)) return null;
  const percent = text.match(/(\d+(?:\.\d+)?)\s*%\s*的?\s*(?:最大)?(?:法力|灵力)/)
    || text.match(/(?:法力|灵力)\s*的?\s*(\d+(?:\.\d+)?)\s*%/);
  if (percent) return { stat: '法力', amount: spellManaCost(statValue(stats['法力'], 'max'), Number(percent[1])) };
  const named = text.match(/(?<amount>\d+|[一二两三四五六七八九十百千万零]+)\s*点?\s*(?<stat>法力|灵力|神识|血量|气血|生命)/)
    || text.match(/(?<stat>法力|灵力|神识|血量|气血|生命)\s*(?<amount>\d+|[一二两三四五六七八九十百千万零]+(?=\s*(?:点|$|[，、。；,;])))/);
  if (named) {
    const { amount, stat } = named.groups;
    return { stat: { 灵力: '法力', 气血: '血量', 生命: '血量' }[stat] || stat, amount: chineseNumber(amount) };
  }
  const blood = text.match(/精血\s*([一二三四五六七八九十\d]+)\s*滴/);
  if (blood) {
    const drops = chineseNumber(blood[1]) || 1;
    return { stat: '血量', amount: Math.max(1, Math.ceil(statValue(stats['血量'], 'max') * COMBAT.skills.bloodDropPercent * drops / 100)) };
  }
  const charged = text.replace(/(?:无需(?:消耗|耗费)?|免耗|不(?:用|需要?|消耗|耗费?))\s*(?:法力|灵力)/g, '');
  if (/法力|灵力/.test(charged)) return { stat: '法力', amount: spellManaCost(statValue(stats['法力'], 'max')) };
  return { narrative: text };
}

function skillFactor(skill) {
  const grade = plain(skill['2']);
  let factor = 1;
  const pin = grade.match(/([一二三四五六七八九十\d]+)\s*品/);
  if (pin) factor = 1 + COMBAT.skills.gradeStep * (chineseNumber(pin[1]) || 0);
  else for (const [tier, value] of Object.entries(COMBAT.skills.tiers)) if (grade.includes(tier)) factor = value;
  const layer = plain(skill['7']).match(/第([一二三四五六七八九十\d]+)层/);
  if (layer) factor += COMBAT.skills.layerBonus * Math.max(0, (chineseNumber(layer[1]) || 1) - 1);
  return Math.round(factor * 100) / 100;
}

function layerEffect(skill, layer) {
  const names = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const label = names[layer] || String(layer);
  const match = plain(skill['9']).match(new RegExp(`(?:第)?(?:${label}|${layer})层\\s*[:：]\\s*([^;；\\n]+)`));
  return match ? match[1].trim() : '';
}

// Proficiency grows with use: "第一层 (30%)" advances layers, "30/100" fills up.
function proficiencyAfter(skill) {
  const text = plain(skill['7']);
  const step = COMBAT.skills.proficiencyPerUse;
  const layered = text.match(/第([一二三四五六七八九十\d]+)层\s*[（(]\s*(\d+)\s*%\s*[)）]/);
  if (layered) {
    const layer = chineseNumber(layered[1]) || 1;
    const total = chineseNumber((plain(skill['5']).match(/([一二三四五六七八九十\d]+)/) || [])[1] || '') || layer;
    let percent = Number(layered[2]) + step;
    if (percent >= 100 && layer < total) {
      const names = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
      const next = layer + 1;
      return { text: `第${names[next] || next}层 (0%)`, layerUp: next, effect: layerEffect(skill, next) };
    }
    percent = Math.min(100, percent);
    return { text: `第${layered[1]}层 (${percent}%)` };
  }
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return { text: `${Math.min(Number(fraction[2]), Number(fraction[1]) + step)}/${fraction[2]}` };
  return null;
}

function skillOf(env, attackerId, skillId) {
  if (attackerId === 'B1') {
    const found = env.state['8']?.[skillId] ? [skillId, env.state['8'][skillId]]
      : Object.entries(env.state['8'] || {}).find(([, row]) => row && rowName(row) === plain(skillId));
    return found ? { row: found[1], id: found[0], name: rowName(found[1]), own: true } : null;
  }
  const remarks = env.ctx.parseRemarksString(env.state['0']?.[attackerId]?.['9']);
  const skills = env.ctx.parseNestedJsonString(remarks.skills, []);
  const row = Array.isArray(skills) ? skills.find(s => s && (s['0'] === skillId || s.id === skillId || plain(s['1'] || s.name) === skillId)) : null;
  return row ? { row: { ...row, 1: row['1'] || row.name, 2: row['2'] || row.grade, 7: row['7'] || row.proficiency, 8: row['8'] || row.cost }, id: row['0'] || row.id || skillId, name: plain(row['1'] || row.name), own: false } : null;
}

// Daily limits for skills share the item limit ledger, keyed by the skill name.
function skillDailyLimit(env, skill) {
  const limit = plain(skill.row['3']).match(/(?:每日|每天|一日)(?:最多|限|仅可|可)?(?:施展|使用|用)?\s*([一二三四五六七八九十\d]+)\s*次/);
  if (!limit) return { dailyUses: undefined };
  const clock = (env.state['4'] || []).find(row => row?.id === 'TIME_LOCATION_ROW') || env.state['4']?.[0];
  const date = String(clock?.['0'] || '').match(/(\d+)年\s*(\d+)月\s*(\d+)日/);
  if (!date) return { error: `无法确定游戏日期，不能核对「${skill.name}」的每日次数` };
  const day = date.slice(1).map(Number).join('-');
  const counts = env.dailyUses?.day === day ? env.dailyUses.counts : {};
  const key = '技能·' + skill.name;
  const used = counts[key] || 0;
  if (used + 1 > (chineseNumber(limit[1]) || 1)) return { error: `「${skill.name}」${limit[0]}，今日已施展${used}次` };
  return { dailyUses: { day, counts: { ...counts, [key]: used + 1 } } };
}

// Pay a skill's cost and grow its proficiency; shared by use_skill and resolve_attack.
function castSkill(env, caster, skill, commands, owns, options = {}) {
  if (env.castThisTurn?.has(`${caster.id}:${skill.id}`) && !/^(?:无|无冷却|0)/.test(plain(skill.row['3']) || '无')) {
    return { error: `「${skill.name}」本回合已经施展过，冷却未过（${plain(skill.row['3'])}）` };
  }
  const daily = skillDailyLimit(env, skill);
  if (daily.error) return daily;
  const cost = skillCost(skill.row, caster.stats);
  // A cheaper cast from outside these rules (the life play's fights: a skill of the caster's own
  // root); none by default, and then the cost is exactly as before.
  if (cost?.stat === '法力' && options.costFactor) cost.amount = Math.max(1, Math.ceil(cost.amount * options.costFactor));
  const paid = [];
  if (cost && cost.stat) {
    const before = statValue(caster.stats[cost.stat]);
    const max = statValue(caster.stats[cost.stat], 'max');
    if (before < cost.amount) return { error: `${cost.stat}不足：施展「${skill.name}」需要${cost.amount}点，现有${before}点` };
    const after = before - cost.amount;
    commands.push(`updateAttribute(${JSON.stringify(caster.id)},${JSON.stringify(cost.stat)},{"current":${after},"max":${max}})`);
    caster.stats = { ...caster.stats, [cost.stat]: { current: after, max } };
    owns.charStats.push(`${caster.id}:${cost.stat}`);
    if (caster.id === 'B1') owns.stats.push(cost.stat);
    paid.push({ stat: cost.stat, before, after, max, amount: cost.amount });
  }
  let growth = null;
  if (skill.own) {
    growth = proficiencyAfter(skill.row);
    if (growth) {
      const update = { 7: growth.text, ...(growth.layerUp && growth.effect ? { 6: growth.effect } : {}) };
      commands.push(`add(${JSON.stringify(skill.id)},${JSON.stringify(update)})`);
      owns.skills.push(skill.id);
    }
  }
  (env.castThisTurn ||= new Set()).add(`${caster.id}:${skill.id}`);
  return { paid, growth, narrativeCost: cost?.narrative || '', dailyUses: daily.dailyUses };
}

function useSkill(env, { skill_id: skillId = '', target_id: targetId = '', reason = '' }, source) {
  const fail = message => refusal('use_skill', message, { source, label: '技能未施展' });
  const skill = skillOf(env, 'B1', String(skillId));
  if (!skill) return fail(`没有编号为「${skillId}」的已习得技能`);
  const commands = [], owns = noOwnership();
  const caster = { id: 'B1', name: rowName(env.state['0']?.B1) || '你', stats: readStats(env, 'B1') };
  if ('血量' in caster.stats && statValue(caster.stats['血量']) <= 0) return fail('你已重伤倒地，无法施展');
  const cast = castSkill(env, caster, skill, commands, owns);
  if (cast.error) return fail(cast.error);
  const target = env.state['0']?.[targetId];
  const parts = [];
  for (const p of cast.paid) parts.push(`${p.stat} ${p.before}→${p.after}/${p.max}`);
  if (cast.narrativeCost) parts.push(`代价「${cast.narrativeCost}」由剧情描述`);
  if (cast.growth) parts.push(`熟练度 ${plain(skill.row['7'])}→${cast.growth.text}${cast.growth.layerUp ? `，突破至第${cast.growth.layerUp}层` : ''}`);
  return {
    kind: 'use_skill', ok: true, source, skill: { id: skill.id, name: skill.name }, target: target ? { id: targetId, name: rowName(target) } : null,
    paid: cast.paid, growth: cast.growth, commands: commands.join('\n'), owns, dailyUses: cast.dailyUses,
    reason: plain(reason).slice(0, 80),
    summary: `施展「${skill.name}」${target ? '（对' + rowName(target) + '）' : ''}：` + (parts.join('；') || '无消耗'),
  };
}

// ---------------------------------------------------------------- combat

function strike(env, attacker, defender, options, ordinal, index) {
  const rules = COMBAT.hit, damageRules = COMBAT.damage;
  const random = create(`${env.seed}:attack:${ordinal}:${index}`);
  const roll = Math.floor(random.random() * rules.die) + 1;
  // The totals from outside these rules (the life play's: its active gear, life/gear.cjs); the
  // panel's own by default, and then the strike is exactly as before.
  const totalsOf = options.totals || totalStats;
  const a = totalsOf(env, attacker.id, attacker.stats), d = totalsOf(env, defender.id, defender.stats);
  const gap = realmGap(attacker.realm, defender.realm);
  const agility = clamp(Math.round(rules.agilityScale * Math.log2(Math.max(1, a['脚力']) / Math.max(1, d['脚力']))), -rules.agilityCap, rules.agilityCap);
  const realm = clamp(gap.major * rules.majorRealm, -rules.majorRealmCap, rules.majorRealmCap) + clamp(gap.minor, -rules.minorRealmCap, rules.minorRealmCap);
  const ambush = options.ambush ? rules.ambush : 0;
  // A bonus to hit from outside these rules (the life play's fights: an opening after a guarded
  // miss); none by default, and then the strike is exactly as before.
  const bonus = Number(options.bonus) || 0;
  const total = roll + agility + realm + ambush + bonus;
  const hit = roll === rules.die || (roll !== 1 && total >= rules.dc);
  const critical = hit && (roll === rules.die || total >= rules.dc + rules.criticalMargin);
  const result = { by: attacker.id, at: defender.id, roll, die: rules.die, agility, realm, ambush, ...(bonus ? { bonus } : {}), total, dc: rules.dc, hit, critical, damage: 0, style: options.style };
  const hpBefore = statValue(defender.stats['血量']), hpMax = statValue(defender.stats['血量'], 'max');
  result.hp = { before: hpBefore, after: hpBefore, max: hpMax };
  if (!hit) return result;
  const spell = options.style === '法术';
  const attack = spell ? a['法攻'] : a['物攻'];
  const defense = Math.max(1, (spell ? d['法防'] : d['物防']) - damageRules.penetration * (spell ? a['法术穿透'] : a['物理穿透']));
  // Damage is a share of what a typical fighter of the defender's realm can take, so a fight
  // between equals lasts about as long at every realm. Attack against defense moves it 0 to 2 times.
  const ratio = attack / defense;
  let damage = attack > 0 ? damageRules.share * (2 * ratio / (1 + ratio)) * referenceHp(defender.realm) : 0;
  const [low, high] = damageRules.variance;
  damage *= low + (high - low) * random.random();
  damage *= options.skillFactor || 1;
  if (critical) damage *= damageRules.critical;
  if (options.ambush) damage *= damageRules.ambush;
  let realmFactor = 1;
  if (gap.major > 0) realmFactor = Math.min(damageRules.realmUpCap, 1 + damageRules.realmUp * gap.major);
  else if (gap.major < 0) realmFactor = damageRules.realmDown ** -gap.major;
  else realmFactor = clamp(1 + damageRules.minorStep * gap.minor, ...damageRules.minorRange);
  damage = Math.max(1, Math.round(damage * realmFactor));
  result.attack = attack;
  result.defense = defense;
  result.damage = damage;
  result.realmFactor = Math.round(realmFactor * 1000) / 1000;
  result.hp.after = Math.max(0, hpBefore - damage);
  result.defeated = result.hp.after === 0;
  return result;
}

function defeatStatus(row) {
  const status = plain(row?.['4']);
  if (status.includes(COMBAT.defeat.status)) return null;
  return !status || status === '一切正常' ? COMBAT.defeat.status : `${status}，${COMBAT.defeat.status}`;
}

function describeStrike(s, names) {
  const sign = value => (value >= 0 ? '+' : '') + value;
  const mods = [`身法${sign(s.agility)}`, `境界${sign(s.realm)}`, ...(s.ambush ? [`偷袭${sign(s.ambush)}`] : [])].join('，');
  const head = `${names[s.by]}出手：1d${s.die}=${s.roll}，${mods}，总值${s.total}（需${s.dc}）`;
  if (!s.hit) return `${head}，未命中`;
  return `${head}，${s.critical ? '暴击' : '命中'}，造成${s.damage}点伤害，${names[s.at]}血量 ${s.hp.before}→${s.hp.after}/${s.hp.max}${s.defeated ? '，重伤倒地' : ''}`;
}

function resolveAttack(env, args, source, ordinal) {
  const fail = message => refusal('resolve_attack', message, { source, label: '交锋未结算' });
  const commands = [], owns = noOwnership();
  const attackerId = args.attacker_id ? String(args.attacker_id) : args.attacker_name ? '' : 'B1';
  const attacker = fighter(env, attackerId, args.attacker_name, args.attacker_realm, '出手者', commands);
  if (attacker.error) return fail(attacker.error);
  const defender = fighter(env, String(args.target_id || ''), args.target_name, args.target_realm, '目标', commands);
  if (defender.error) return fail(defender.error);
  // Drawing something out (投石问路, 打草惊蛇) is not striking at it: a creature that shows up is
  // written into the story and added with set, and a fight starts when someone strikes. Only the
  // model is told; nothing is settled or shown.
  if (attacker.id === 'B1' && defender.registered && LURE.test(plain(args.reason))) {
    return { kind: 'resolve_attack', ok: false, readOnly: true, source, commands: '', owns: noOwnership(),
      summary: '未结算：这是引出或试探，不是对敌人出手',
      reason: '因此现身的对手在正文写出，并用set新增到在场人物；等玩家或对手真正出手时再调用resolve_attack' };
  }
  if (attacker.id === defender.id) return fail('出手者和目标不能是同一人');
  if (statValue(attacker.stats['血量']) <= 0) return fail(`${attacker.name}已重伤倒地，无法出手`);
  if (statValue(defender.stats['血量']) <= 0) return fail(`${defender.name}已重伤倒地，无需再判定；是否了结由剧情决定`);
  let style = args.style === '法术' ? '法术' : '物理';
  let skill = null, cast = null;
  if (args.skill_id) {
    skill = skillOf(env, attacker.id, String(args.skill_id));
    if (!skill) return fail(`${attacker.name}没有习得「${args.skill_id}」`);
    if (args.style !== '物理') style = '法术';
    cast = castSkill(env, attacker, skill, commands, owns);
    if (cast.error) return fail(cast.error);
  } else if (style === '法术') {
    const a = totalStats(env, attacker.id, attacker.stats);
    const max = statValue(attacker.stats['法力'], 'max'), before = statValue(attacker.stats['法力']);
    if (a['法攻'] <= 0 || max <= 0) return fail(`${attacker.name}尚未修出法力，施展不了法术`);
    const amount = spellManaCost(max);
    if (before < amount) return fail(`法力不足：催动法术需要${amount}点，现有${before}点`);
    commands.push(`updateAttribute(${JSON.stringify(attacker.id)},"法力",{"current":${before - amount},"max":${max}})`);
    attacker.stats = { ...attacker.stats, 法力: { current: before - amount, max } };
    owns.charStats.push(`${attacker.id}:法力`);
    if (attacker.id === 'B1') owns.stats.push('法力');
    cast = { paid: [{ stat: '法力', before, after: before - amount, max, amount }] };
  }
  const names = { [attacker.id]: attacker.name, [defender.id]: defender.name };
  // Only a foe who is not yet in the fight can be caught unawares.
  const ambush = !!args.ambush && (defender.registered || defender.restored || String(defender.row?.['31']).trim() !== 'true');
  const strikes = [strike(env, attacker, defender, { style, ambush, skillFactor: skill ? skillFactor(skill.row) : 1 }, ordinal, 0)];
  defender.stats = { ...defender.stats, 血量: { current: strikes[0].hp.after, max: strikes[0].hp.max } };
  const counter = !ambush && args.counter !== false && !strikes[0].defeated;
  if (counter) {
    const t = totalStats(env, defender.id, defender.stats);
    const mana = statValue(defender.stats['法力']), manaMax = statValue(defender.stats['法力'], 'max');
    const spellCost = spellManaCost(manaMax);
    const counterStyle = t['法攻'] > t['物攻'] && manaMax > 0 && mana >= spellCost ? '法术' : '物理';
    if (counterStyle === '法术') {
      commands.push(`updateAttribute(${JSON.stringify(defender.id)},"法力",{"current":${mana - spellCost},"max":${manaMax}})`);
      defender.stats = { ...defender.stats, 法力: { current: mana - spellCost, max: manaMax } };
      owns.charStats.push(`${defender.id}:法力`);
      if (defender.id === 'B1') owns.stats.push('法力');
    }
    strikes.push(strike(env, defender, attacker, { style: counterStyle }, ordinal, 1));
    attacker.stats = { ...attacker.stats, 血量: { current: strikes[1].hp.after, max: strikes[1].hp.max } };
  }
  // This exchange settles both fighters' health, hit or miss. The rest of a new foe's
  // panel is a starting point the story may still describe in its own words.
  for (const p of [attacker, defender]) {
    owns.charStats.push(`${p.id}:血量`);
    if (p.id === 'B1') owns.stats.push('血量');
  }
  for (const s of strikes) {
    if (!s.hit) continue;
    commands.push(`updateAttribute(${JSON.stringify(s.at)},"血量",{"current":${s.hp.after},"max":${s.hp.max}})`);
    if (s.defeated) {
      const row = env.state['0'][s.at] || (s.at === defender.id ? defender.row : attacker.row);
      const status = defeatStatus(row);
      if (status) commands.push(`add(${JSON.stringify(s.at)},{"4":${JSON.stringify(status)}})`);
    }
  }
  // The fog-of-war marks: the player in combat, foes in combat, companions as allies.
  const players = [attacker, defender];
  if (players.some(p => p.id === 'B1')) {
    if (String(env.state['0'].B1?.['31']).trim() !== 'true') commands.push('add("B1",{"31":"true"})');
    for (const p of players) {
      if (p.id !== 'B1' && !p.registered && String(p.row?.['31']).trim() !== 'true') commands.push(`add(${JSON.stringify(p.id)},{"31":"true"})`);
    }
  } else if (/^[CG]/.test(attacker.id) && !attacker.registered && String(attacker.row?.['32']).trim() !== 'true' && String(attacker.row?.['31']).trim() !== 'true') {
    commands.push(`add(${JSON.stringify(attacker.id)},{"32":"true"})`);
    if (!defender.registered && String(defender.row?.['31']).trim() !== 'true') commands.push(`add(${JSON.stringify(defender.id)},{"31":"true"})`);
  }
  const lines = [];
  if (defender.registered) lines.push(`登记新对手「${defender.name}」为 ${defender.id}（${defender.realm.text}）`);
  if (attacker.registered) lines.push(`登记新对手「${attacker.name}」为 ${attacker.id}（${attacker.realm.text}）`);
  if (skill) lines.push(`${attacker.name}施展「${skill.name}」` + (cast.paid.length ? `，${cast.paid.map(p => `${p.stat} ${p.before}→${p.after}`).join('，')}` : ''));
  else if (style === '法术') lines.push(`${attacker.name}催动法术，法力 ${cast.paid[0].before}→${cast.paid[0].after}`);
  if (args.ambush && !ambush) lines.push(`${defender.name}早有防备，偷袭不成，按正面交锋结算`);
  if (attacker.restored) lines.push(`${attacker.name}回到场上（${attacker.id}）`);
  if (defender.restored) lines.push(`${defender.name}回到场上（${defender.id}）`);
  lines.push(...strikes.map(s => describeStrike(s, names)));
  if (!counter && !strikes[0].defeated) lines.push(ambush ? `${defender.name}遭偷袭，来不及还手` : `${defender.name}没有还手`);
  return {
    kind: 'resolve_attack', ok: true, source,
    attack: {
      attacker: { id: attacker.id, name: attacker.name, realm: attacker.realm.text, registered: !!attacker.registered },
      target: { id: defender.id, name: defender.name, realm: defender.realm.text, registered: !!defender.registered },
      style, skill: skill ? { id: skill.id, name: skill.name, factor: skillFactor(skill.row) } : null,
      paid: cast?.paid || [], strikes, rulesVersion: COMBAT.version, reason: plain(args.reason).slice(0, 80),
    },
    commands: commands.join('\n'), owns, dailyUses: cast?.dailyUses,
    summary: `交锋（${attacker.name} → ${defender.name}）：` + lines.join('；'),
  };
}

// ---------------------------------------------------------------- equipment

function bagGear(env) {
  const locked = env.ctx.storedItemIds(env.state);
  return Object.entries(env.state['1'] || {})
    .filter(([id, row]) => row && !locked.has(id) && SLOT_OF[row['2']])
    .map(([id, row]) => ({ id, row, name: rowName(row), type: row['2'] }));
}

function wornGear(env) {
  const remarks = env.ctx.parseRemarksString(env.state['0']?.B1?.['9']);
  const equipment = env.ctx.parseNestedJsonString(remarks.equipment, {}) || {};
  const worn = [];
  for (const [slot, items] of Object.entries(equipment)) {
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      if (item) worn.push({ slot, index, id: item.id || item['0'], name: plain(item.name || item['1']).split('|')[0], type: item.type || item['2'] });
    });
  }
  return { equipment, worn };
}

function equipItem(env, { item_id: itemId, name = '' }, source) {
  const fail = message => refusal('equip_item', message, { source, label: '未能装备' });
  const { equipment, worn } = wornGear(env);
  const already = worn.find(w => w.id === itemId || (name && w.name === name));
  if (already) return { kind: 'equip_item', ok: true, readOnly: true, source, item: { id: already.id, name: already.name }, commands: '', owns: noOwnership(), summary: `「${already.name}」已经装备着` };
  const gear = bagGear(env).find(g => g.id === itemId);
  if (!gear) {
    const row = env.state['1']?.[itemId];
    if (row && !SLOT_OF[row['2']]) return fail(`「${rowName(row)}」是${row['2'] || '杂物'}，不能装备`);
    return fail(`储物袋中没有可装备的「${name || itemId}」`);
  }
  if (env.play || env.cultivationLife) {
    const blocked = require('./life/gear.cjs').canEquip(env, gear.id);
    if (blocked) return fail(blocked);
  }
  const slot = SLOT_OF[gear.type];
  const slots = Array.isArray(equipment[slot]) ? equipment[slot] : [];
  let index = [0, 1, 2, 3, 4, 5].find(i => !slots[i]);
  let replaced = null;
  if (index === undefined) { index = 0; replaced = plain(slots[0]?.name || slots[0]?.['1']); }
  const commands = [`equipItem("B1",${JSON.stringify(slot)},{"index":${index},"data":{"0":${JSON.stringify(gear.id)}}})`, `de(${JSON.stringify(gear.id)})`];
  const owns = noOwnership();
  owns.items.push(gear.id);
  return {
    kind: 'equip_item', ok: true, source, item: { id: gear.id, name: gear.name }, slot, index, commands: commands.join('\n'), owns,
    summary: `装备「${gear.name}」于${gear.type}栏第${index + 1}格` + (replaced ? `，换下「${replaced}」放回储物袋` : '') + (plain(gear.row['4']) && plain(gear.row['4']) !== '无' ? `（${plain(gear.row['4'])}）` : ''),
  };
}

function unequipItem(env, { item_id: itemId, name = '' }, source) {
  const { worn } = wornGear(env);
  const item = worn.find(w => w.id === itemId || (name && w.name === name));
  if (!item) return refusal('unequip_item', `身上没有装备「${name || itemId}」`, { source, label: '未能卸下' });
  const owns = noOwnership();
  owns.items.push(item.id);
  return {
    kind: 'unequip_item', ok: true, source, item: { id: item.id, name: item.name }, slot: item.slot, index: item.index,
    commands: `unequipItem("B1",${JSON.stringify(item.slot)},{"index":${item.index}})`, owns,
    summary: `卸下「${item.name}」，放回储物袋`,
  };
}

// ---------------------------------------------------------------- quests

// "下品灵石 x2 或 清心丸 x1" is two groups; within a group, "，、和" separate the entries.
function rewardGroups(text) {
  return plain(text).split(/或者|或是|或/).map(group => group.replace(/\s+/g, '').split(/[，,、；;。]|以及|及|和|与/).filter(Boolean));
}

function rewardLimit(group, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const number = '([一二三四五六七八九十百千万两\\d]+)';
  const unit = '[枚颗粒块株份个张瓶包两斤片根把件]?';
  for (const pattern of [new RegExp(escaped + '[×xX*]\\s*' + number), new RegExp(number + unit + escaped), new RegExp(escaped + number + unit)]) {
    const match = group.match(pattern);
    if (match) return chineseNumber(match[1]) || 1;
  }
  return 1;
}

function itemTypeFor(name) {
  if (require('./life/manual-items.cjs').hasManualTitle(name)) return '功法';
  if (/丹|丸|散|膏|液|露|饼|膳|粮|汤|酒|茶|果/.test(name)) return '消耗品';
  if (/剑|刀|枪|棍|鞭|弓|斧|锤|戟/.test(name)) return '武器';
  if (/甲|袍|衣|靴|盾/.test(name)) return '护甲';
  if (/诀|经|功|法门|心法|秘籍|残篇|残卷/.test(name)) return '功法';
  if (/符|旗|镜|珠|印|鼎|钟|塔|葫芦/.test(name)) return '法宝';
  return '材料';
}

function nextItemIds(env, count) {
  const used = new Set(Object.keys(env.state['1'] || {}));
  for (const id of env.ctx.storedItemIds(env.state)) used.add(id);
  const ids = [];
  let n = 1;
  while (ids.length < count) { if (!used.has('I' + n)) ids.push('I' + n); n += 1; }
  return ids;
}

function updateQuest(env, { quest_id: questId = '', status = '', rewards = [], reason = '' }, source) {
  const fail = message => refusal('update_quest', message, { source, label: '任务未结算' });
  // A call on a quest that is not under way settles nothing and is the model's slip: the model
  // hears the refusal, but it is no receipt for the player (quiet). Shown, its card lands in the
  // story the next prompt's history carries, and the model calls again turn after turn.
  const quiet = message => ({ ...fail(message), quiet: true });
  const quest = env.state['6']?.[questId];
  if (!quest) return quiet(`没有编号为「${questId}」的任务`);
  const title = rowName(quest);
  const previous = plain(quest['5']);
  if (FINISHED.test(previous)) return quiet(`任务「${title}」已经结束（${previous}）`);
  // A status the tool does not take (已完成 for 完成) is the model's slip too: it calls again right.
  if (!['完成', '失败', '放弃'].includes(status)) return quiet('状态只能是：完成、失败、放弃');
  const commands = [], owns = noOwnership(), granted = [];
  owns.quests.push(questId);
  const marker = { 完成: '已完成', 失败: '已失败', 放弃: '已放弃' }[status];
  // "进行中（炼气）" or "可交付（凡人/炼气）" keeps its difficulty, not the old status.
  const difficulty = previous.match(/^(?:进行中|可交付|待交付|待完成|未完成|已接取|已接受|接取中|未开始|追踪中)\s*[（(](.+)[）)]$/)?.[1] ?? previous;
  const update = { 5: `${marker}（${difficulty || '原难度未注明'}）` };
  if (status === '完成' && Array.isArray(rewards) && rewards.length) {
    const groups = rewardGroups(quest['3']);
    let chosen = null;
    for (const reward of rewards) {
      const name = plain(reward?.name).replace(/\s+/g, '').replace(/^[‘'“"「《]|[’'”"」》]$/g, '');
      const amount = Number(reward?.quantity ?? 1);
      if (!name) return fail('奖励缺少名称');
      // A reward is one thing with a count, never the whole reward sentence.
      if (name.length > 12 || /[\d，,、；;。：:！!？?]|[零一二三四五六七八九十百千万两]+[枚颗粒块株份个张瓶包斤片根把件]/.test(name)) {
        return fail(`奖励名称只写物品本身，例如「碎灵砂」，数量填在quantity里（收到的是「${name}」）`);
      }
      if (!Number.isSafeInteger(amount) || amount < 1) return fail(`「${name}」的数量必须是正整数`);
      const group = groups.findIndex(g => g.some(entry => entry.includes(name)));
      if (group < 0) return fail(`任务「${title}」登记的奖励中没有「${name}」（登记：${plain(quest['3'])}）`);
      if (chosen !== null && chosen !== group) return fail(`「${plain(quest['3'])}」只能择一领取`);
      chosen = group;
      const limit = rewardLimit(groups[group].find(entry => entry.includes(name)), name);
      if (amount > limit) return fail(`「${name}」登记为${limit}份，不能领取${amount}份`);
      granted.push({ name, quantity: amount });
    }
    const player = env.state['0']?.B1 || {};
    let stones = Number(plain(player['26'])) || 0;
    const stonesBefore = stones;
    const bag = Object.entries(env.state['1'] || {});
    const newIds = nextItemIds(env, granted.length);
    for (const reward of granted) {
      if (CURRENCY[reward.name]) {
        stones += reward.quantity * CURRENCY[reward.name];
        owns.currency = true;
        reward.currency = true;
        continue;
      }
      owns.grants.push(reward.name);
      const stack = bag.find(([, row]) => rowName(row) === reward.name && Number.isSafeInteger(env.ctx.itemStackCount(row['5'])));
      if (stack) {
        const count = env.ctx.itemStackCount(stack[1]['5']) + reward.quantity;
        commands.push(`add(${JSON.stringify(stack[0])},{"5":"${count}"})`);
        owns.items.push(stack[0]);
        reward.id = stack[0];
      } else {
        const id = newIds.shift();
        commands.push(`set(${JSON.stringify({ 0: id, 1: reward.name, 2: itemTypeFor(reward.name), 3: `任务「${title}」的奖励`, 4: '无', 5: String(reward.quantity) })})`);
        owns.items.push(id);
        reward.id = id;
      }
    }
    if (owns.currency) commands.push(`add("B1",{"26":"${stones}"})`);
    update[3] = `${plain(quest['3'])}（奖励已领取）`;
    granted.stones = owns.currency ? { before: stonesBefore, after: stones } : null;
  }
  commands.unshift(`add(${JSON.stringify(questId)},${JSON.stringify(update)})`);
  const rewardText = granted.map(r => `${r.name}×${r.quantity}${r.id ? `（${r.id}）` : ''}`).join('、');
  return {
    kind: 'update_quest', ok: true, source, quest: { id: questId, title, status: marker }, rewards: granted,
    commands: commands.join('\n'), owns, reason: plain(reason).slice(0, 80),
    summary: `任务「${title}」${marker}` + (rewardText ? `，领取奖励：${rewardText}` : status === '完成' ? '，本次未领取登记奖励' : '')
      + (granted.stones ? `；灵石 ${granted.stones.before}→${granted.stones.after}` : ''),
  };
}

// Coming back from 0 health lifts 重伤倒地 from the status column; null when nothing changes.
function revivedStatus(env, id, applied) {
  const health = applied.find(change => change.stat === '血量');
  const status = plain(env.state['0']?.[id]?.['4']);
  if (!health || health.before > 0 || health.after <= 0 || !status.includes(COMBAT.defeat.status)) return null;
  const rest = status.split(/[，,、；;]/).map(part => part.trim()).filter(part => part && part !== COMBAT.defeat.status);
  return rest.length ? rest.join('，') : '一切正常';
}

// Meditating, resting and sleeping bring mana and health back by the hour.
function rest(env, { kind = '休息', hours = 1, reason = '' }, source) {
  const fail = message => refusal('rest', message, { source, label: '未能休整' });
  const rates = COMBAT.recovery?.[kind];
  if (!rates) return fail(`休整方式只能是：${Object.keys(COMBAT.recovery || {}).join('、')}`);
  const time = Number(hours);
  if (!Number.isFinite(time) || time <= 0) return fail('休整时长必须是正数（小时）');
  const span = Math.min(COMBAT.recoveryMaxHours || 12, time);
  if (String(env.state['0']?.B1?.['31']).trim() === 'true') return fail('仍在战斗中，无法安心休整');
  const stats = readStats(env, 'B1');
  const commands = [], applied = [], owns = noOwnership();
  for (const [stat, percent] of Object.entries(rates)) {
    const before = statValue(stats[stat]), max = statValue(stats[stat], 'max');
    if (max <= 0) continue;
    const after = Math.min(max, before + Math.ceil(max * percent * span / 100));
    if (after === before) { applied.push({ stat, before, after, max }); continue; }
    commands.push(`updateAttribute("B1",${JSON.stringify(stat)},{"current":${after},"max":${max}})`);
    applied.push({ stat, before, after, max });
    owns.stats.push(stat);
    owns.charStats.push(`B1:${stat}`);
  }
  const revived = revivedStatus(env, 'B1', applied);
  if (revived !== null) commands.push(`add("B1",{"4":${JSON.stringify(revived)}})`);
  const parts = applied.map(a => (a.after === a.before ? `${a.stat}已满（${a.after}/${a.max}）` : `${a.stat} ${a.before}→${a.after}/${a.max}`));
  return {
    kind: 'rest', ok: true, source, rest: { kind, hours: span, changes: applied }, commands: commands.join('\n'), owns,
    reason: plain(reason).slice(0, 80),
    summary: `${kind}${span}小时：` + (parts.join('；') || '没有可恢复的数值') + (revived !== null ? '；已能起身，不再重伤倒地' : ''),
  };
}

// ---------------------------------------------------------------- trade

const ITEM_TYPES = ['消耗品', '材料', '重要物品', '其他物品', '武器', '护甲', '功法', '法宝'];

// 当前灵石 counts 下品灵石; an unset purse (blank or 待定) holds none.
function stonesOf(row) {
  const text = plain(row?.['26']);
  if (!text || text === '待定') return 0;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function bagStack(env, key) {
  const wanted = plain(key);
  if (!wanted) return null;
  const locked = env.ctx.storedItemIds(env.state);
  const entries = Object.entries(env.state['1'] || {}).filter(([id, row]) => row && !locked.has(id));
  const found = entries.find(([id]) => id === wanted) || entries.find(([, row]) => rowName(row) === wanted);
  return found ? { id: found[0], row: found[1], name: rowName(found[1]), type: found[1]['2'] || '', count: env.ctx.itemStackCount(found[1]['5']) } : null;
}

// Commands that leave `left` pieces of one entry in an NPC's remark inventory (none: it goes).
// The card merges that inventory by entry key (0, id or name) and drops entries with no key, so
// every entry without one is listed again under a key of its own and nothing else is lost.
function inventoryEdit(npcId, inventory, entry, left) {
  const keyOf = item => item && (item['0'] || item.id || item.name);
  const taken = new Set(inventory.map(keyOf).filter(Boolean));
  let n = 0;
  const fresh = () => { do n += 1; while (taken.has(`${npcId}-${n}`)); taken.add(`${npcId}-${n}`); return `${npcId}-${n}`; };
  const key = keyOf(entry);
  let entryKey = key;
  const listed = [];
  for (const item of inventory) {
    if (!item || keyOf(item) || (item === entry && left < 1)) continue;
    const id = fresh();
    if (item === entry) entryKey = id;
    listed.push({ ...item, 0: id, ...(item === entry ? { 5: String(left) } : {}) });
  }
  if (key && left > 0) listed.push({ 0: key, 5: String(left) });
  const commands = [];
  // An empty list still makes the card drop the keyless entry that was handed over.
  if (listed.length || !key) commands.push(`add(${JSON.stringify(npcId)},${JSON.stringify({ 9: { inventory: listed } })})`);
  if (key && left < 1) commands.push(`de(${JSON.stringify(npcId)},"inventory",${JSON.stringify(key)})`);
  return { commands, key: entryKey || plain(entry['1'] || entry.name) };
}

// Buying and selling. The model gives the agreed price in 下品灵石, or pays with a stack from the
// bag; the engine checks what the player has, moves the stones and the goods, and owns both.
function tradeItem(env, args, source) {
  const fail = message => refusal('trade_item', message, { source, label: '交易未成' });
  const direction = { 买入: 'buy', 卖出: 'sell' }[plain(args.direction)];
  if (!direction) return fail('方向只能是：买入、卖出');
  const quantity = Number(args.quantity ?? 1);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return fail('数量必须是正整数');
  const price = Number(args.price ?? 0);
  if (!Number.isSafeInteger(price) || price < 0) return fail('成交价必须是非负整数，按下品灵石计');
  const player = env.state['0']?.B1;
  const stones = stonesOf(player);
  if (stones === null) return fail(`当前灵石「${plain(player?.['26'])}」无法识别`);
  const counterpartId = plain(args.counterpart_id);
  const counterpart = counterpartId && counterpartId !== 'B1' ? env.state['0']?.[counterpartId] : null;
  if (counterpartId && !counterpart) return fail(`交易对象「${counterpartId}」不在当前场景中`);
  // A seller who is not on the scene (a shop counter, a passing peddler) goes unnamed.
  const who = counterpart ? rowName(counterpart) || counterpartId : '';
  const commands = [], owns = { ...noOwnership(), npcItems: [] }, parts = [];
  let item, summary;
  if (direction === 'buy') {
    const name = plain(args.item_name).replace(/[「」『』“”"《》]/g, '').split('|')[0].trim().slice(0, 30);
    if (!name) return fail('买入要写明物品名称');
    if (/灵石$/.test(name)) return fail('灵石记在当前灵石里，不当作物品买卖');
    let barter = null;
    if (plain(args.pay_item_id)) {
      barter = bagStack(env, args.pay_item_id);
      const pay = Number(args.pay_quantity ?? 1);
      if (!barter) return fail(`储物袋中没有用来抵价的「${plain(args.pay_item_id)}」`);
      if (barter.name === name) return fail('抵价的道具不能是买入的同一种');
      if (!Number.isSafeInteger(pay) || pay < 1) return fail('抵价道具的数量必须是正整数');
      if (!Number.isSafeInteger(barter.count) || barter.count < pay) return fail(`「${barter.name}」只有 ${Number.isSafeInteger(barter.count) ? barter.count : 0} 份，不够抵价 ${pay} 份`);
      barter.pay = pay;
    }
    if (!price && !barter) return fail('买入要写成交价（下品灵石），以物易物时写明抵价的道具');
    if (price > stones) return fail(`灵石不足：需要 ${price} 块下品灵石，现有 ${stones} 块`);
    // The seller's listing fills in what the model left out, and the seller's stock goes down
    // when the listing counts it.
    let listed = null;
    if (counterpart) {
      const inventory = env.ctx.parseNestedJsonString(env.ctx.parseRemarksString(counterpart['9']).inventory, []);
      listed = Array.isArray(inventory) ? inventory.find(i => i && plain(i['1'] || i.name).split('|')[0] === name) || null : null;
      const held = listed ? env.ctx.itemStackCount(listed['5'] ?? listed.quantity) : NaN;
      if (Number.isSafeInteger(held)) {
        if (held < quantity) return fail(`${who}只有 ${held} 份「${name}」`);
        const edit = inventoryEdit(counterpartId, inventory, listed, held - quantity);
        commands.push(...edit.commands);
        owns.npcItems.push(`${counterpartId}:${edit.key}`);
      }
    }
    const description = plain(args.description) || plain(listed?.['3'] ?? listed?.description) || `${who ? `从${who}处` : ''}买来的${name}`;
    const effect = plain(args.effect) || plain(listed?.['4'] ?? listed?.effect) || '无';
    let type = ITEM_TYPES.includes(plain(args.item_type)) ? plain(args.item_type)
      : ITEM_TYPES.includes(plain(listed?.['2'] ?? listed?.type)) ? plain(listed['2'] ?? listed.type) : itemTypeFor(name);
    const corrected = (env.cultivationLife || env.play) && require('./life/manual-items.cjs').isManual(name, type, description, effect);
    if (corrected) type = '功法';
    // Goods go into the bag: a stack locked away in storage is not merged into.
    const locked = env.ctx.storedItemIds(env.state);
    const stack = Object.entries(env.state['1'] || {}).find(([id, row]) => row && !locked.has(id) && rowName(row) === name
      && (row['2'] || '') === type && Number.isSafeInteger(env.ctx.itemStackCount(row['5'])));
    let id;
    if (stack) {
      id = stack[0];
      commands.push(`add(${JSON.stringify(id)},{"5":"${env.ctx.itemStackCount(stack[1]['5']) + quantity}"})`);
    } else {
      id = nextItemIds(env, 1)[0];
      commands.push(`set(${JSON.stringify({ 0: id, 1: name, 2: type, 3: description.slice(0, 200),
        4: effect.slice(0, 200), 5: String(quantity), ...(type === '功法' && effect !== '无' ? { 9: effect.slice(0, 200) } : {}) })})`);
    }
    owns.items.push(id);
    owns.grants.push(name);
    if (barter) {
      const left = barter.count - barter.pay;
      commands.push(left ? `add(${JSON.stringify(barter.id)},{"5":"${left}"})` : `de(${JSON.stringify(barter.id)})`);
      owns.items.push(barter.id);
      parts.push(`储物袋「${barter.name}」${barter.count}→${left}`);
    }
    if (price) {
      commands.push(`add("B1",{"26":"${stones - price}"})`);
      owns.currency = true;
      parts.push(`灵石 ${stones}→${stones - price}`);
    }
    item = { id, name };
    const paid = [price ? `${price}块下品灵石` : '', barter ? `「${barter.name}」×${barter.pay}` : ''].filter(Boolean).join('加');
    summary = `以${paid}${who ? `向${who}` : ''}买下「${name}」×${quantity}，放入储物袋 ${id}；${parts.join('；')}`;
  } else {
    const stack = bagStack(env, args.item_id || args.item_name);
    if (!stack) return fail(`储物袋中没有「${plain(args.item_id || args.item_name)}」`);
    if (!Number.isSafeInteger(stack.count)) return fail(`「${stack.name}」的数量无法识别`);
    if (stack.count < quantity) return fail(`「${stack.name}」只有 ${stack.count} 份`);
    if (!price) return fail('卖出要写成交价（下品灵石）；白送不是买卖');
    const left = stack.count - quantity;
    commands.push(left ? `add(${JSON.stringify(stack.id)},{"5":"${left}"})` : `de(${JSON.stringify(stack.id)})`);
    commands.push(`add("B1",{"26":"${stones + price}"})`);
    owns.items.push(stack.id);
    owns.currency = true;
    item = { id: stack.id, name: stack.name };
    summary = `把「${stack.name}」×${quantity}${who ? `卖给${who}` : '卖出'}，得${price}块下品灵石；储物袋「${stack.name}」${stack.count}→${left}；灵石 ${stones}→${stones + price}`;
  }
  return {
    kind: 'trade_item', ok: true, source, direction, item, quantity, price,
    counterpart: counterpart ? { id: counterpartId, name: who } : null,
    commands: commands.join('\n'), owns, reason: plain(args.reason).slice(0, 80), summary,
  };
}

// Once no enemy on the scene can still fight, the combat marks are cleared before the turn.
function combatOver(env) {
  const rows = env.state['0'] || {};
  const flagged = Object.entries(rows).filter(([, row]) => row && (String(row['31']).trim() === 'true' || String(row['32']).trim() === 'true'));
  if (String(rows.B1?.['31']).trim() !== 'true') return null;
  // The settlement keeps the marks the story did not clear on purpose, so a fight is over
  // once every marked foe has fallen or left the scene.
  const foes = Object.entries(rows).filter(([id, row]) => id !== 'B1' && row && String(row['31']).trim() === 'true');
  if (foes.some(([id]) => statValue(readStats(env, id)['血量']) > 0)) return null;
  const commands = flagged.map(([id, row]) => `add(${JSON.stringify(id)},${JSON.stringify({
    ...(String(row['31']).trim() === 'true' ? { 31: 'false' } : {}), ...(String(row['32']).trim() === 'true' ? { 32: 'false' } : {}) })})`);
  return { kind: 'end_combat', ok: true, source: 'engine', commands: commands.join('\n'), owns: noOwnership(),
           summary: foes.length ? '场上的敌人都已倒地，战斗结束，战斗标记已清除' : '敌人已不在场，战斗结束，战斗标记已清除' };
}

// The foes still standing in the player's fight, as [id, name]: marked in combat, blood left.
// Empty exactly when the player is not fighting or combatOver would end the fight.
function standingFoes(env) {
  const rows = env.state['0'] || {};
  if (String(rows.B1?.['31']).trim() !== 'true') return [];
  return Object.entries(rows)
    .filter(([id, row]) => id !== 'B1' && row && String(row['31']).trim() === 'true' && statValue(readStats(env, id)['血量']) > 0)
    .map(([id, row]) => [id, rowName(row) || id]);
}

function activeQuests(state) {
  return Object.entries(state['6'] || {}).filter(([, row]) => row && !FINISHED.test(plain(row['5']))).map(([id, row]) => ({ id, title: rowName(row) }));
}

// ---------------------------------------------------------------- cultivation
// In pilot turns only the engine moves the player's progress (修为进度) and realm. Progress runs
// 0 to 100 on each step of a major realm; the numbers live in content/cultivation.json and the
// check in content/checks.json. The cooldown, the windfalls and the storyline rewards already
// given are kept in data.state.frxProgress, which receipts carry like dailyUses.

const CULTIVATION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../content/cultivation.json'), 'utf8'));
const CHECKS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../content/checks.json'), 'utf8'));
const CALENDAR = CULTIVATION.calendar;
const DAY_MINUTES = CALENDAR.hoursPerDay * 60;
const YEAR_DAYS = CALENDAR.daysPerMonth * CALENDAR.monthsPerYear;
const ORDER = COMBAT.realms.order;
const LAYERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];
const STAGES = ['', '初期', '中期', '后期'];
const FORTUNES = ['小', '中', '大'];
const TIME_ROW = 'TIME_LOCATION_ROW';
const DATE = /(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{1,2}))?/;
const round2 = value => Math.round(value * 100) / 100;
const roundHalfUp = value => Math.floor(value + 0.5 + 1e-9);

// A number written in a remark or a condition: "24", "149年", "20%", "一百".
function numberIn(value) {
  const text = plain(value);
  const digits = text.match(/-?\d+(?:\.\d+)?/);
  if (digits) return Number(digits[0]);
  const words = text.match(/[零一二两三四五六七八九十百千万]+/);
  const number = words ? chineseNumber(words[0]) : NaN;
  return Number.isFinite(number) ? number : null;
}

const progressValue = value => clamp(Math.round(numberIn(value) ?? 0), 0, 100);
// Written the way the save already writes it ("20" or "20%").
const progressText = (value, previous) => (plain(previous).endsWith('%') ? `${value}%` : String(value));

function emptyLedger() {
  return { breakthroughCooldownDay: null, fortune: {}, chapterRewards: [] };
}

// data.state.frxProgress as stored; anything unreadable starts empty, other keys are kept.
function ledgerOf(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fortune = {};
  for (const tier of FORTUNES) if (Number.isInteger(raw.fortune?.[tier])) fortune[tier] = raw.fortune[tier];
  return {
    ...raw,
    breakthroughCooldownDay: Number.isInteger(raw.breakthroughCooldownDay) ? raw.breakthroughCooldownDay : null,
    fortune,
    chapterRewards: Array.isArray(raw.chapterRewards) ? raw.chapterRewards.filter(id => typeof id === 'string' && id) : [],
  };
}

const ledger = env => (env.progress ||= emptyLedger());

// ------------------------------------------------ calendar

function clockRow(state) {
  return (state?.['4'] || []).find(row => row?.id === TIME_ROW) || state?.['4']?.[0] || null;
}

// The time row's date in minutes from 0001年 01月 01日 00:00. A day 31 or an hour 25 is read as
// written and comes out normalized when the row is written again.
function readClock(state) {
  const text = String(clockRow(state)?.['0'] ?? '');
  const slash = text.indexOf('/');
  const head = slash < 0 ? text : text.slice(0, slash);
  const match = head.match(DATE);
  if (!match) return null;
  const [year, month, day] = [1, 2, 3].map(index => Number(match[index]));
  const timed = match[4] !== undefined;
  const days = (year - 1) * YEAR_DAYS + (month - 1) * CALENDAR.daysPerMonth + (day - 1);
  return { text, head, place: slash < 0 ? '' : text.slice(slash), date: match[0], at: match.index, timed,
           minutes: days * DAY_MINUTES + (timed ? Number(match[4]) * 60 + Number(match[5]) : 0) };
}

const dayOf = minutes => Math.floor(minutes / DAY_MINUTES);
const pad = (value, width = 2) => String(value).padStart(width, '0');

function formatDay(day) {
  const year = Math.floor(day / YEAR_DAYS);
  const within = day - year * YEAR_DAYS;
  const month = Math.floor(within / CALENDAR.daysPerMonth);
  return `${pad(year + 1, 4)}年 ${pad(month + 1)}月 ${pad(within - month * CALENDAR.daysPerMonth + 1)}日`;
}

function formatClock(minutes, timed) {
  const day = dayOf(minutes), within = minutes - day * DAY_MINUTES;
  return formatDay(day) + (timed ? ` ${pad(Math.floor(within / 60))}:${pad(within % 60)}` : '');
}

// The row moved on by `minutes`: only the date and time change, the place stays as written.
function clockText(clock, minutes) {
  return clock.head.slice(0, clock.at) + formatClock(clock.minutes + minutes, clock.timed)
    + clock.head.slice(clock.at + clock.date.length) + clock.place;
}

function describeSpan(minutes) {
  let rest = Math.round(minutes);
  const parts = [];
  for (const [size, unit] of [[YEAR_DAYS * DAY_MINUTES, '年'], [CALENDAR.daysPerMonth * DAY_MINUTES, '个月'], [DAY_MINUTES, '日'], [60, '小时'], [1, '分钟']]) {
    const count = Math.floor(rest / size);
    if (count) { parts.push(`${count}${unit}`); rest -= count * size; }
  }
  return parts.join('') || '片刻';
}

function spanMinutes(duration, unit) {
  const name = plain(unit) || '日';
  const rule = CALENDAR.units[name];
  if (!rule) return { error: `时长单位只能是：${Object.keys(CALENDAR.units).join('、')}` };
  const amount = Number(duration);
  if (duration === undefined || duration === null || duration === '' || !Number.isFinite(amount) || amount <= 0) {
    return { error: '修炼要写明时长：duration填正数，unit填小时、日、月或年' };
  }
  const days = (rule.days || 0) + CALENDAR.daysPerMonth * ((rule.months || 0) + CALENDAR.monthsPerYear * (rule.years || 0));
  return { minutes: Math.max(1, Math.round(amount * ((rule.hours || 0) * 60 + days * DAY_MINUTES))) };
}

// Years left to live (寿元 less 年龄), or null when either is not written as a number.
function yearsLeft(remarks) {
  const life = numberIn(remarks['寿元']), age = numberIn(remarks['年龄']);
  return life === null || age === null ? null : life - age;
}

// The age after the clock moved from `from` to `to`, when it crossed a year and the age is a number.
function agedRemarks(remarks, from, to) {
  const crossed = Math.floor(dayOf(to) / YEAR_DAYS) - Math.floor(dayOf(from) / YEAR_DAYS);
  const age = numberIn(remarks['年龄']);
  return crossed > 0 && age !== null ? { before: age, after: age + crossed } : null;
}

// ------------------------------------------------ the player as a cultivator

const stepsIn = major => (major <= 0 ? 1 : major === 1 ? 13 : 3);
const stepOf = realm => (realm.major <= 0 ? 1 : clamp(realm.minor || 1, 1, stepsIn(realm.major)));
const stepName = (major, step) => (major <= 0 ? '凡人' : major === 1 ? `炼气${LAYERS[step]}层` : `${ORDER[major]}${STAGES[step]}`);
const byMajor = (table, major) => table[ORDER[major]] ?? table.higher;
// Column 2 with a new realm before the bar and the identity after it unchanged.
const withRealm = (row, realm) => {
  const text = String(row?.['2'] ?? '');
  const bar = text.indexOf('|');
  return bar < 0 ? realm : realm + text.slice(bar);
};

// 灵根 from column 5, or the remark when the column is blank or 待定; unnamed roots count as 真.
function rootOf(row, remarks) {
  const column = plain(row?.['5']);
  const raw = column && column !== '待定' ? column : plain(remarks['灵根']);
  const text = raw.replace(/\s+/g, '');
  let tier = null;
  if (!text || /^(?:待定|未知|未定|未测|不详|[?？]+)$/.test(text)) tier = null;
  else if (/无灵根|没有灵根|^无$|^凡胎/.test(text)) tier = '无';
  else if (/天灵根/.test(text)) tier = '天';
  else if (/异灵根|变异/.test(text)) tier = '异';
  else if (/真灵根/.test(text)) tier = '真';
  else if (/伪灵根|杂灵根/.test(text)) tier = '伪';
  else if (/[雷风冰暗光]灵根/.test(text)) tier = '异';
  else if (/[单一]灵根/.test(text)) tier = '天';
  else if (/[双二两三]灵根/.test(text)) tier = '真';
  else if (/[四五]灵根/.test(text)) tier = '伪';
  else {
    const elements = new Set(text.match(/[金木水火土]/g) || []).size;
    tier = elements === 1 ? '天' : elements >= 2 && elements <= 3 ? '真' : elements >= 4 ? '伪' : /[雷风冰暗光]/.test(text) ? '异' : null;
  }
  const assumed = tier === null;
  const name = assumed ? CULTIVATION.roots.assumed : tier;
  const label = assumed ? (text && text !== '待定' ? raw : '未注明')
    : tier === '无' ? '无灵根' : raw.includes(`${tier}灵根`) ? raw : `${tier}灵根（${raw}）`;
  return { tier: name, label, factor: CULTIVATION.roots.factors[name], assumed };
}

// The grade of a technique from its texts in order: 黄/玄/地/天阶, or N品.
function gradeFactor(texts) {
  const rule = CULTIVATION.technique;
  for (const value of texts) {
    const text = plain(value);
    if (!text) continue;
    const grade = text.match(/([天地玄黄])[阶级]/);
    if (grade) return rule.grades[grade[1]];
    const pin = text.match(/([一二三四五六七八九十\d]+)\s*品/);
    const number = pin ? chineseNumber(pin[1]) : NaN;
    if (Number.isFinite(number) && number > 0) return round2(Math.min(rule.max, 1 + rule.pinStep * number));
  }
  return rule.unrated;
}

// A learned skill is a cultivation method when its type or name says 功法 or 心法, or its name
// ends in 功, 经 or 诀 and its type is not a spell, a divine ability or a martial technique.
function isMethod(name, type) {
  if (/功法|心法/.test(type) || /功法|心法/.test(name)) return true;
  return /[功经诀]$/.test(name.replace(/[《》「」『』〈〉【】\s]/g, '')) && !/法术|神通|武技/.test(type);
}

// The best technique: worn in the equipment or learned in the skill table. A better one lying
// unequipped in the bag is named so the player knows to put it on.
function techniqueOf(env) {
  const found = [];
  const life = env.play || env.cultivationLife ? require('./life/gear.cjs') : null;
  const worn = life ? life.methods(env).slice(0, 1) : env.ctx.equippedItemRows(env.state['0']?.B1);
  for (const item of worn) {
    if ((item?.type ?? item?.['2']) !== '功法') continue;
    const name = plain(item.name ?? item['1']).split('|')[0];
    if (!name) continue;
    found.push({ name, factor: gradeFactor([name, item.grade ?? item['6'], item.description ?? item['3'], item.currentEffect ?? item['9'], item.effect ?? item['4']]) });
  }
  for (const skill of life && found.length ? [] : Object.values(env.state['8'] || {})) {
    if (!skill) continue;
    const name = rowName(skill), type = plain(skill['3']);
    if (name && isMethod(name, type)) found.push({ name, factor: gradeFactor([name, skill['2'], type, skill['4'], skill['5']]) });
  }
  const best = found.sort((a, b) => b.factor - a.factor)[0] || null;
  const locked = env.ctx.storedItemIds(env.state);
  const mayUse = life?.canEquip;
  const shelved = Object.entries(env.state['1'] || {})
    .filter(([id, row]) => row && !locked.has(id) && row['2'] === '功法' && rowName(row)
      && (!mayUse || !mayUse(env, id)))
    .map(([, row]) => ({ name: rowName(row), factor: gradeFactor([rowName(row), row['6'], row['3'], row['9'], row['4']]) }))
    .sort((a, b) => b.factor - a.factor)[0];
  return {
    name: best?.name ?? null,
    factor: best ? best.factor : CULTIVATION.technique.none,
    unequipped: shelved && (!best || shelved.factor > best.factor) ? shelved.name : null,
  };
}

// The best 功法 item in the bag when the player cultivates with none taken up; null otherwise.
function shelvedMethod(env) {
  const technique = techniqueOf(env);
  if (technique.name || !technique.unequipped) return null;
  const locked = env.ctx.storedItemIds(env.state);
  const found = Object.entries(env.state['1'] || {})
    .find(([id, row]) => row && !locked.has(id) && row['2'] === '功法' && rowName(row) === technique.unequipped);
  return found ? { id: found[0], name: rowName(found[1]) } : null;
}

// Everything cultivation reads from the player's row. A realm written in words the engine does
// not know is placed by the attribute panel, as in a fight.
function cultivator(env, stats = null) {
  const row = env.state['0']?.B1 || {};
  const remarks = env.ctx.parseRemarksString(row['9']);
  const panel = stats || readStats(env, 'B1');
  let realm = parseRealm(row['2']);
  if (realm.unknown && hasCombatStats(panel)) realm = inferRealm(panel, row['2']);
  const step = stepOf(realm);
  return {
    row, remarks, realm, major: realm.major, step, top: step >= stepsIn(realm.major), progress: progressValue(remarks['修为进度']),
    root: rootOf(row, remarks), technique: techniqueOf(env), stats: panel, world: worldSpeed(env),
  };
}

// The world factors chosen at creation, from the opening log's 世界规则变动 line.
function worldFactorsOf(logs) {
  const opening = (logs || []).find(log => String(log?.content || '').includes('世界规则变动'));
  if (!opening) return [];
  const text = plain(opening.content);
  const at = text.indexOf('世界因子');
  return [...text.slice(at < 0 ? 0 : at).matchAll(/\[([^\]\[]{1,12})\]\s*[:：]/g)].map(match => match[1].trim());
}

function worldRules(env) {
  const table = CULTIVATION.worldFactors || {};
  return (env.worldFactors || []).filter(name => table[name] && typeof table[name] === 'object').map(name => ({ name, ...table[name] }));
}

// 灵气断绝 halves every cultivation; the factor and its name go on the receipt.
function worldSpeed(env) {
  const rules = worldRules(env).filter(rule => Number.isFinite(rule.speed));
  return rules.length ? { factor: rules.reduce((value, rule) => value * rule.speed, 1), names: rules.map(rule => rule.name) } : null;
}

// Progress still to gain before the bottleneck: the rest of this step and every step above it.
const progressToTop = c => (stepsIn(c.major) - c.step) * 100 + (100 - c.progress);
// A day's cultivation by the speed formula (gameplay design 七「修炼速度」): 100 over the realm's
// step days, times the root, the method, the world factor, 契合, the bonus pool and the aura, in
// that order. The player's cultivating and the people of the cultivation-life play
// (life/people.cjs) both count with this one function. `stepDays` is the cultivation-life play's
// own step for the realm (life/speed.cjs); left out, the rule table's.
function dayRate({ major, root, technique, world = 1, affinity = 1, bonus = 0, aura = 1, stepDays = null }) {
  return 100 / (stepDays ?? byMajor(CULTIVATION.stepDays, major)) * root * technique * world * affinity * (1 + bonus) * aura;
}
const rateBase = (c, options) => dayRate({ major: c.major, root: c.root.factor, technique: c.technique.factor,
  world: c.world?.factor ?? 1, affinity: options.affinity, bonus: options.bonus, stepDays: options.stepDays }) * (options.mind ?? 1);
const perDayOf = c => dayRate({ major: c.major, root: c.root.factor, technique: c.technique.factor, world: c.world?.factor ?? 1 });

// 全民修仙: there are no mortals. A player still written as one becomes 炼气一层 the next time a
// turn is settled, the panel growing as on a breakthrough into the realm. Null when nothing to do.
function worldRealm(env) {
  const rule = worldRules(env).find(item => item.minimumRealm);
  if (!rule) return null;
  const c = cultivator(env);
  const target = parseRealm(rule.minimumRealm);
  if (target.unknown || c.major > target.major || (c.major === target.major && c.step >= stepOf(target))) return null;
  const stats = structuredClone(c.stats);
  realmGrowth(env, target.major, stats);
  refill(stats);
  const realm = stepName(target.major, stepOf(target));
  const settled = settleProgress(env, c, { step: stepOf(target), progress: c.progress, passed: [] }, stats, { realm });
  const grown = grownText(settled.changes);
  return {
    kind: 'world_rule', ok: true, source: 'engine', world: { name: rule.name, realm },
    cultivation: cultivationRecord(c, { step: stepOf(target), progress: c.progress, passed: [] }, 0, settled.changes, realm),
    commands: settled.commands.join('\n'), owns: settled.owns,
    summary: `世界因子「${rule.name}」：不再有纯粹的凡人，境界${c.realm.text}→${realm}` + (grown ? `；属性随境界提升：${grown}` : ''),
  };
}

// The character creator leaves 当前灵石 as 待定 and the story never books it, so the purse reads as
// empty. The first pilot turn books the realm's opening savings once; from then on the column is a
// number that receipts and the story's own commands move. The model may still write the column
// this turn (a story that finds stones adds them on top of this).
function openingPurse(env) {
  const row = env.state['0']?.B1;
  if (!row) return null;
  const text = plain(row['26']);
  if (text && text !== '待定') return null;
  const c = cultivator(env);
  const amount = byMajor(CULTIVATION.stones.opening, c.major);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const realm = ORDER[c.major] || '凡人';
  return {
    kind: 'purse', ok: true, source: 'engine', commands: `add("B1",{"26":"${amount}"})`, owns: noOwnership(),
    purse: { before: text || null, after: amount, realm },
    summary: `当前灵石原为「${text || '空白'}」，按${realm}的常见积蓄记为${amount}块下品灵石；此后灵石的进出都记在这里`,
  };
}

// Gain on the current major realm: a full step moves up with the rest carried over, several at
// once if need be; the top step holds at 100.
function climb(c, gain) {
  const top = stepsIn(c.major);
  let step = c.step, progress = c.progress + gain;
  const passed = [];
  while (progress >= 100 && step < top) { progress -= 100; step += 1; passed.push(step); }
  return { step, progress: Math.min(100, progress), passed, capped: step >= top && progress >= 100 };
}

function raise(stats, stat, amount, floor = null) {
  const current = statValue(stats[stat]), max = statValue(stats[stat], 'max');
  let next = max + amount;
  if (floor !== null && next < floor) next = floor + amount;
  stats[stat] = { current: Math.max(0, Math.min(next, current + next - max)), max: next };
}

// One step up: a 炼气 layer adds a twelfth of the realm's span (±10%), a stage from 筑基 on a
// random value from 20% of the realm's low bound to 20% of its high bound. 气运 and 魅力 stay.
function stepGrowth(env, major, step, stats) {
  const rule = CULTIVATION.growth;
  const random = create(`${env.seed}:growth:${major}:${step}`);
  for (const [stat, [low, high]] of Object.entries(COMBAT.baselines[ORDER[major]] || {})) {
    const amount = major === 1
      ? Math.round((high - low) / rule.layerDivisor * (1 - rule.layerJitter + 2 * rule.layerJitter * random.random()))
      : Math.round(rule.lowShare * low + random.random() * (rule.highShare * high - rule.lowShare * low));
    if (amount > 0) raise(stats, stat, amount);
  }
}

// Into a new major realm: 20% of its low bound to 20% of its high bound, and a total still
// below the low bound becomes the low bound plus the same amount. `band` (the cultivation-life
// play's foundation: low, mid or high) keeps the draw in that third of the range.
const GROWTH_BANDS = { low: 0, mid: 1, high: 2 };
function realmGrowth(env, major, stats, band) {
  const rule = CULTIVATION.growth;
  const random = create(`${env.seed}:breakthrough-growth:${major}`);
  const third = Object.hasOwn(GROWTH_BANDS, band) ? GROWTH_BANDS[band] : null;
  for (const [stat, [low, high]] of Object.entries(COMBAT.baselines[ORDER[major]] || {})) {
    const draw = third === null ? random.random() : (third + random.random()) / 3;
    raise(stats, stat, Math.round(rule.lowShare * low + draw * (rule.highShare * high - rule.lowShare * low)), low);
  }
}

function refill(stats) {
  for (const stat of ['血量', '法力']) {
    const max = statValue(stats[stat], 'max');
    if (max > 0) stats[stat] = { current: max, max };
  }
}

// The panel changes between two copies, as commands, what the receipt owns and readable parts.
function statEdits(before, after) {
  const commands = [], owned = [], changes = [];
  const keys = [...STATS.filter(stat => stat in after), ...Object.keys(after).filter(stat => !STATS.includes(stat))];
  for (const stat of keys) {
    const was = { current: statValue(before[stat]), max: statValue(before[stat], 'max') };
    const now = { current: statValue(after[stat]), max: statValue(after[stat], 'max') };
    if (was.current === now.current && was.max === now.max) continue;
    commands.push(`updateAttribute("B1",${JSON.stringify(stat)},{"current":${now.current},"max":${now.max}})`);
    owned.push(stat);
    changes.push({ stat, before: was, after: now });
  }
  return { commands, owned, changes };
}

const grownText = changes => changes.filter(c => c.after.max > c.before.max).map(c => `${c.stat}+${c.after.max - c.before.max}`).join('、');

// What a receipt that moved the player's step, progress and panel writes and owns.
function settleProgress(env, c, climbed, stats, { remarks = {}, realm = null } = {}) {
  const commands = [];
  const newRealm = realm ?? (climbed.step !== c.step ? stepName(c.major, climbed.step) : null);
  if (newRealm) commands.push(`add("B1",${JSON.stringify({ 2: withRealm(c.row, newRealm) })})`);
  const written = { ...(climbed.progress !== c.progress || newRealm ? { 修为进度: progressText(climbed.progress, c.remarks['修为进度']) } : {}), ...remarks };
  if (Object.keys(written).length) commands.push(`add("B1",${JSON.stringify({ 9: written })})`);
  const edits = statEdits(c.stats, stats);
  commands.push(...edits.commands);
  const owns = noOwnership();
  owns.stats.push(...edits.owned);
  owns.charStats.push(...edits.owned.map(stat => `B1:${stat}`));
  return { commands, owns, changes: edits.changes, realm: newRealm };
}

function cultivationRecord(c, climbed, gain, changes, realm = null) {
  return {
    before: { realm: c.realm.text, progress: c.progress },
    after: { realm: realm || (climbed.step !== c.step ? stepName(c.major, climbed.step) : c.realm.text), progress: climbed.progress },
    gain, steps: climbed.passed.map(step => stepName(c.major, step)), bottleneck: climbed.capped,
    growth: changes.filter(change => change.after.max !== change.before.max)
      .map(change => ({ stat: change.stat, before: change.before.max, after: change.after.max })),
  };
}

function progressPhrase(c, climbed, gain) {
  if (!gain) return `收效甚微，修为仍为${c.progress}`;
  // Across steps the bare numbers read as no change (10→10), so each side names its step.
  const steps = climbed.passed.length;
  let text = steps
    ? `修为 ${stepName(c.major, c.step)}${c.progress}→${stepName(c.major, climbed.step)}${climbed.progress}（共增${gain}点，${steps > 1 ? `连升${steps}层` : '晋升一层'}）`
    : `修为 ${c.progress}→${climbed.progress}`;
  if (steps && c.major > 1) text = text.replace(/连升(\d+)层|晋升一层/, match => match === '晋升一层' ? '晋升一个小境界' : match.replace('层', '个小境界'));
  if (climbed.capped) text += `，已到${stepName(c.major, climbed.step)}的瓶颈，要冲关突破才能更进一步`;
  return text;
}

// ------------------------------------------------ places

// A rich aura needs a spirit vein, eye, cave dwelling, spring or blessed land at the place:
// in the place's name or in the description of a map entry the place names.
function richPlace(env) {
  const text = String(clockRow(env.state)?.['0'] ?? '');
  const place = text.slice(text.indexOf('/') + 1);
  const map = env.worldMap || {};
  const described = [];
  for (const key of ['points_of_interest', 'sub_regions', 'main_regions']) {
    for (const entry of Array.isArray(map[key]) ? map[key] : []) {
      const name = plain(entry?.name);
      if (name && place.includes(name)) described.push(plain(entry.description));
    }
  }
  return new RegExp(CULTIVATION.environment.richPlace).test([place, ...described].join(' '));
}

function auraOf(env, aura) {
  const rule = CULTIVATION.environment;
  const requested = Object.hasOwn(rule.aura, plain(aura)) ? plain(aura) : rule.default;
  const used = requested === '浓' && !richPlace(env) ? '中' : requested;
  return { requested, used, factor: rule.aura[used] };
}

// The aura a place has by the cultivation-life play's place rules (life/places.cjs), taken as it is;
// `bonus` is added to its factor (a 聚灵 array, life/arrays.cjs) and kept on it.
function placedAura(aura, bonus = 0) {
  const rule = CULTIVATION.environment;
  const used = Object.hasOwn(rule.aura, aura) ? aura : rule.default;
  if (!bonus) return { requested: used, used, factor: rule.aura[used] };
  return { requested: used, used, factor: round2(rule.aura[used] + bonus), bonus };
}

const placeOf = state => {
  const text = String(clockRow(state)?.['0'] ?? '');
  const slash = text.indexOf('/');
  return (slash < 0 ? text : text.slice(slash + 1)).trim();
};

// ------------------------------------------------ cultivating

const inFight = row => String(row?.['31']).trim() === 'true';

// cultivate: a stretch of cultivation (修炼) or a windfall (机缘). `options` are the cultivation-life
// play's (life/verbs.cjs; the old play never passes them, and left out they change nothing):
//   aura       the place's aura tier (life/places.cjs), taken instead of args.aura and its check;
//              auraBonus added to its factor (a 聚灵 array, life/arrays.cjs)
//   affinity   契合, a factor (1); bonus 加成, the capped bonus pool as a fraction (0): a day's gain
//              is the old rule's × affinity × (1 + bonus) (gameplay design 七)
//   moveClock  false leaves the time row and the age to the caller, who moves the clock itself
//   carry      the fraction of a point the stretches before left (frxPlay.leftover, -0.5 to 0.5): added
//              to this stretch's gain before it is rounded to a whole point, and what is left after
//              comes back as cultivation.leftover (0 at a bottleneck); a slow realm's short stretches
//              add up instead of each rounding to nothing
//   stepDays   the play's own days a step of this realm takes (life/speed.cjs), for the rule table's
function cultivate(env, args = {}, source, options = {}) {
  const mode = plain(args.mode) || (plain(args.fortune) ? '机缘' : '修炼');
  if (mode === '机缘') return windfall(env, args, source);
  const fail = message => refusal('cultivate', message, { source, label: '未能修炼', mode: '修炼' });
  if (mode !== '修炼') return fail('mode只能是：修炼、机缘');
  const c = cultivator(env);
  if (inFight(c.row)) return fail('仍在战斗中，无法静心修炼');
  if (isFallen(env.ctx, c.row)) return fail('你已重伤倒地，无法修炼');
  if (c.root.factor <= 0) return fail(`${c.root.label}，吸纳不了天地灵气，无法修炼`);
  const need = progressToTop(c);
  if (need <= 0) return fail(`已到${stepName(c.major, c.step)}的瓶颈，修为圆满，再修炼也不会增长；要冲关突破才能更进一步`);
  const span = spanMinutes(args.duration, args.unit);
  if (span.error) return fail(span.error);
  const clock = readClock(env.state);
  if (!clock) return fail('时间行里没有可识别的日期，无法结算修炼时长');
  const years = span.minutes / (YEAR_DAYS * DAY_MINUTES);
  const left = yearsLeft(c.remarks);
  if (left !== null && years > left) {
    return fail(`修炼时长${describeSpan(span.minutes)}超过剩余寿元：寿元${numberIn(c.remarks['寿元'])}，年龄${numberIn(c.remarks['年龄'])}，只剩${Math.max(0, left)}年`);
  }
  if (left === null && years > CULTIVATION.limits.maxSessionYears) return fail(`一次修炼最长${CULTIVATION.limits.maxSessionYears}年`);
  const aura = options.aura === undefined ? auraOf(env, args.aura) : placedAura(options.aura, options.auraBonus);
  const days = span.minutes / DAY_MINUTES;
  const affinity = options.affinity ?? 1, bonus = options.bonus ?? 0, mind = options.mind ?? 1;
  const moves = options.moveClock !== false;
  const base = rateBase(c, options);
  const useStones = args.use_stones === true || plain(args.use_stones) === 'true';
  // Stones lift the aura to the floor; where it is already that rich they would not help and
  // none are spent.
  const floor = CULTIVATION.stones.floor;
  const helps = useStones && aura.factor + 1e-9 < floor;
  let stones = null, stoneRate = 0, stoneDays = 0;
  if (useStones) {
    stones = stonesOf(c.row);
    if (stones === null) return fail(`当前灵石「${plain(c.row['26'])}」无法识别`);
    if (helps) {
      stoneRate = byMajor(CULTIVATION.stones.perDay, c.major);
      stoneDays = Math.min(days, stones / stoneRate);
    }
  }
  const boosted = base * Math.max(aura.factor, floor), rate = base * aura.factor;
  const carry = Number.isFinite(options.carry) ? options.carry : 0;
  const wanted = need - carry;
  // At the bottleneck the stretch ends early: only the hours it took are spent.
  let used = span.minutes, early = false;
  if (boosted * stoneDays + rate * (days - stoneDays) + 1e-9 >= wanted) {
    const needed = wanted <= boosted * stoneDays ? wanted / boosted : stoneDays + (wanted - boosted * stoneDays) / rate;
    used = Math.min(span.minutes, Math.max(60, Math.ceil(needed * CALENDAR.hoursPerDay - 1e-9) * 60));
    early = true;
  }
  const usedDays = used / DAY_MINUTES;
  const stoneUsed = Math.min(stoneDays, usedDays);
  const cost = helps ? Math.min(stones, Math.ceil(stoneUsed * stoneRate - 1e-9)) : 0;
  const exact = boosted * stoneUsed + rate * (usedDays - stoneUsed) + carry;
  const gain = early ? need : roundHalfUp(exact);
  const stats = structuredClone(c.stats);
  const climbed = climb(c, gain);
  for (const step of climbed.passed) stepGrowth(env, c.major, step, stats);
  // A full day of cultivating brings mana and health back to full.
  const restored = used >= DAY_MINUTES
    && ['血量', '法力'].some(stat => statValue(stats[stat], 'max') > 0 && statValue(stats[stat]) < statValue(stats[stat], 'max'));
  if (used >= DAY_MINUTES) refill(stats);
  const end = clock.minutes + used;
  const age = agedRemarks(c.remarks, clock.minutes, end);
  const settled = settleProgress(env, c, climbed, stats, { remarks: age && moves ? { 年龄: String(age.after) } : {} });
  const commands = [...settled.commands];
  if (cost) {
    commands.push(`add("B1",{"26":"${stones - cost}"})`);
    settled.owns.currency = true;
  }
  if (moves) commands.push(`add(${JSON.stringify(TIME_ROW)},${JSON.stringify({ 0: clockText(clock, used) })})`);
  const time = { before: formatClock(clock.minutes, clock.timed), after: formatClock(end, clock.timed), minutes: used };
  const factors = [`${c.root.assumed ? '灵根未注明，按真灵根' : c.root.label}×${c.root.factor}`,
    c.technique.name ? `「${c.technique.name}」×${c.technique.factor}` : `没有功法×${c.technique.factor}`];
  if (affinity !== 1) factors.push(`契合×${affinity}`);
  factors.push(`${CULTIVATION.environment.labels[aura.used]}×${aura.factor}`);
  if (c.world) factors.push(`世界因子「${c.world.names.join('、')}」×${round2(c.world.factor)}`);
  if (mind !== 1) factors.push(`心境×${mind}`);
  if (bonus) factors.push(`加成${bonus > 0 ? '+' : ''}${round2(bonus * 100)}%`);
  if (cost) factors.push(`灵石辅助${round2(stoneUsed)}日×${Math.max(aura.factor, floor)}`);
  const notes = [];
  if (aura.requested !== aura.used) notes.push(`此地没有灵脉、灵眼、洞府、灵泉或福地，灵气按「${aura.used}」计`);
  if (useStones && !helps) notes.push(`此地${CULTIVATION.environment.labels[aura.used]}，灵石帮不上忙，未耗用灵石`);
  else if (useStones && !cost) notes.push('没有灵石可用，全程按灵气档位计');
  else if (useStones && stoneUsed + 1e-9 < usedDays) notes.push(`灵石只够${round2(stoneUsed)}日，其余按灵气档位计`);
  if (c.technique.unequipped) notes.push(`储物袋中的「${c.technique.unequipped}」尚未装备`);
  const parts = [progressPhrase(c, climbed, gain)];
  const grown = grownText(settled.changes);
  if (grown) parts.push(`属性随境界提升：${grown}`);
  if (restored) parts.push('法力血量回满');
  if (cost) parts.push(`灵石 ${stones}→${stones - cost}`);
  parts.push(`时间 ${time.before}→${time.after}`);
  if (age) parts.push(`年龄 ${age.before}→${age.after}`);
  const head = `修炼${describeSpan(used)}` + (used < span.minutes ? `（原定${describeSpan(span.minutes)}，到瓶颈提前出关）` : '');
  return {
    kind: 'cultivate', ok: true, source, mode: '修炼',
    cultivation: {
      ...cultivationRecord(c, climbed, gain, settled.changes),
      perDay: round2(base * aura.factor),
      factors: { root: c.root, technique: { name: c.technique.name, factor: c.technique.factor }, aura,
        ...(affinity !== 1 || bonus ? { affinity, bonus } : {}), ...(mind !== 1 ? { mind } : {}) },
      stones: useStones ? { before: stones, after: stones - cost, cost, days: round2(stoneUsed) } : null,
      requestedMinutes: span.minutes, restored, notes,
      ...(options.carry === undefined ? {} : { leftover: early ? 0 : Math.round((exact - gain) * 1e6) / 1e6 }),
    },
    time, age, commands: commands.join('\n'), owns: settled.owns, reason: plain(args.reason).slice(0, 80),
    summary: `${head}：${parts.join('；')}。系数：${factors.join('，')}，每日约${round2(base * aura.factor)}点` + (notes.length ? `。${notes.join('；')}` : ''),
  };
}

// A windfall: a fixed amount by tier, once per tier's interval of game days, stepping down to
// the best tier still open. A storyline chapter reward is the same gain outside those limits.
function windfall(env, args, source, chapter = null) {
  const kind = chapter ? 'chapter_reward' : 'cultivate';
  const fail = message => refusal(kind, message, { source, label: chapter ? '主线奖励未发放' : '机缘未结算', mode: '机缘' });
  const c = cultivator(env);
  const book = ledger(env);
  let requested = chapter?.tier, granted = chapter?.tier, next;
  if (chapter) {
    next = { ...book, chapterRewards: [...book.chapterRewards, chapter.id] };
  } else {
    requested = plain(args.fortune) || '小';
    if (!FORTUNES.includes(requested)) return fail('机缘档位只能是：小、中、大');
    if (progressToTop(c) <= 0) return fail(`已到${stepName(c.major, c.step)}的瓶颈，修为圆满，机缘也无从增益；要冲关突破才能更进一步`);
    const clock = readClock(env.state);
    if (!clock) return fail('时间行里没有可识别的日期，无法核对机缘次数');
    const today = dayOf(clock.minutes);
    granted = FORTUNES.slice(0, FORTUNES.indexOf(requested) + 1).reverse().find(tier => {
      const last = book.fortune[tier];
      return !Number.isInteger(last) || today - last >= CULTIVATION.fortune.tiers[tier].everyDays;
    });
    if (!granted) {
      const limits = FORTUNES.slice(0, FORTUNES.indexOf(requested) + 1)
        .map(tier => `${tier}机缘每${CULTIVATION.fortune.tiers[tier].everyDays}日一次`).join('，');
      return fail(`机缘次数已用完（${limits}），这次的际遇只作剧情描写，不增修为`);
    }
    next = { ...book, fortune: { ...book.fortune, [granted]: today } };
  }
  const gain = CULTIVATION.fortune.tiers[granted].amount;
  const stats = structuredClone(c.stats);
  const climbed = climb(c, gain);
  for (const step of climbed.passed) stepGrowth(env, c.major, step, stats);
  const settled = settleProgress(env, c, climbed, stats);
  const actual = climbed.passed.length * 100 + climbed.progress - c.progress;
  const origin = plain(chapter ? `个人主线「${chapter.title || chapter.id}」完成` : args.source).slice(0, 40);
  const parts = [actual ? progressPhrase(c, climbed, actual) : `修为已到${stepName(c.major, c.step)}的瓶颈，未能增益`];
  const grown = grownText(settled.changes);
  if (grown) parts.push(`属性随境界提升：${grown}`);
  const tierText = granted === requested ? `${granted}机缘` : `${requested}机缘降为${granted}机缘（${requested}机缘每${CULTIVATION.fortune.tiers[requested].everyDays}日一次）`;
  return {
    kind, ok: true, source, mode: '机缘',
    fortune: { requested, granted, amount: gain, source: origin },
    ...(chapter ? { chapter: { id: chapter.id, index: chapter.index, title: chapter.title || '' } } : {}),
    cultivation: cultivationRecord(c, climbed, actual, settled.changes),
    commands: settled.commands.join('\n'), owns: settled.owns, frxProgress: next, reason: plain(args?.reason).slice(0, 80),
    summary: `${chapter ? '主线奖励' : '机缘'}（${tierText}${origin ? `，${origin}` : ''}）：${parts.join('；')}`,
  };
}

// The storyline chapters marked done whose reward is not yet in the ledger, oldest first.
function pendingChapterRewards(env, plot) {
  const given = new Set(ledger(env).chapterRewards);
  const rule = CULTIVATION.chapterRewards;
  return (Array.isArray(plot?.chapters) ? plot.chapters : []).flatMap((chapter, index) => {
    const id = plain(chapter?.id);
    if (!id || plain(chapter?.status) !== '已完成' || given.has(id)) return [];
    given.add(id);
    return [{ kind: 'chapter_reward', id, index, title: plain(chapter.title).slice(0, 20), tier: index < rule.earlyChapters ? rule.early : rule.later }];
  });
}

function chapterReward(env, entry) {
  return windfall(env, {}, 'engine', entry);
}

// Progress from a pill or another item: settled the same way, null when nothing would change.
function itemProgress(env, gain, stats) {
  const c = cultivator(env, stats);
  if (progressToTop(c) <= 0) return null;
  const working = structuredClone(stats);
  const climbed = climb(c, gain);
  for (const step of climbed.passed) stepGrowth(env, c.major, step, working);
  const settled = settleProgress(env, c, climbed, working);
  const actual = climbed.passed.length * 100 + climbed.progress - c.progress;
  const grown = grownText(settled.changes);
  return { ...settled, cultivation: cultivationRecord(c, climbed, actual, settled.changes),
           text: progressPhrase(c, climbed, actual) + (grown ? `；属性随境界提升：${grown}` : '') };
}

// ------------------------------------------------ breaking through

function modifierFor(value) {
  let modifier = 0;
  for (const [floor, bonus] of CHECKS.modifierBands) if (value >= floor) modifier = bonus;
  return modifier;
}

// The gate out of the current major realm's top step, or null at the very top.
function gateOf(c) {
  if (c.major >= ORDER.length - 1) return null;
  const target = c.major + 1;
  const gates = CULTIVATION.breakthrough.gates;
  const gate = gates[ORDER[target]] || gates.higher;
  const tier = gate.tiers[c.root.tier] ?? gate.tiers.default;
  const aids = Array.isArray(gate.aids) ? gate.aids : gate.aids?.[ORDER[target]] || [];
  return { target, to: stepName(target, 1), requires: gate.requires, tier, dc: CHECKS.tiers[tier], aids, days: gate.days };
}

// Every pill the rule table lists as a breakthrough aid, for every gate.
const AID_NAMES = [...new Set(Object.values(CULTIVATION.breakthrough.gates)
  .flatMap(gate => (Array.isArray(gate.aids) ? gate.aids : Object.values(gate.aids || {}).flat())))];
const isAid = name => AID_NAMES.some(aid => plain(name).includes(aid));

function cooldownOf(env) {
  const until = ledger(env).breakthroughCooldownDay;
  const clock = readClock(env.state);
  return Number.isInteger(until) && clock && dayOf(clock.minutes) < until ? formatDay(until) : null;
}

const techniqueDetail = technique => (technique.name ? `「${technique.name}」` : technique.unequipped
  ? `储物袋中的「${technique.unequipped}」尚未装备` : '尚无功法');

// The next step and what it asks for, as the progress panel and the prompt show it.
function nextOf(env, c) {
  const full = { label: '修为圆满', met: c.progress >= 100, detail: `修为${c.progress}/100` };
  if (!c.top) {
    return { kind: '小境界', target: stepName(c.major, c.step + 1), conditions: [{ ...full, detail: `修为${c.progress}/100，满100自动晋升` }], cooldownUntil: null };
  }
  const gate = gateOf(c);
  if (!gate) return { kind: '已至顶峰', target: null, conditions: [], cooldownUntil: null };
  const conditions = [full];
  if (gate.requires.includes('root')) conditions.push({ label: '身具灵根', met: c.root.factor > 0, detail: c.root.assumed ? '未注明，按真灵根计' : c.root.label });
  if (gate.requires.includes('technique')) conditions.push({ label: '装备或习得一部功法', met: !!c.technique.name, detail: techniqueDetail(c.technique) });
  return { kind: '突破', target: gate.to, conditions, cooldownUntil: cooldownOf(env), tier: gate.tier, dc: gate.dc, aids: gate.aids, days: gate.days };
}

// `options` are the cultivation-life play's (life/gate.cjs; the old play never passes them, and
// left out they change nothing):
//   odds        a whole number added to the total: the gate's new terms (灵地, 护法, 心结)
//   growth      low, mid or high: the third of the growth range a success takes (根基)
//   foundation  the foundation's grade, recorded on the check
//   moveClock   false leaves the time row and the age to the caller, who moves the clock itself
//   totals      the totals of 气运 and 神识 (env, id, stats) => totals, mechanics.totalStats by default
//   modifiers   { 气运, 神识 }: the play's own modifier for each (神识 against the realm), for the bands'
//   dc          the play's difficulty for this gate, for the rule table's by the root
//   aidBonus    what each aid pill adds, for the rule table's
//   stepDays    the play's own days a step of the realm takes (the rate a top-up closes the gap at)
function breakthrough(env, args = {}, source, ordinal = 0, options = {}) {
  const fail = message => refusal('breakthrough', message, { source, label: '未能冲关' });
  const c = cultivator(env);
  if (inFight(c.row)) return fail('仍在战斗中，不能冲关');
  if (isFallen(env.ctx, c.row)) return fail('你已重伤倒地，不能冲关');
  if (!c.top) return fail(`还没到大境界的瓶颈：当前${c.realm.text}，要修到${stepName(c.major, stepsIn(c.major))}且修为圆满才能冲关；平日要先修炼`);
  const found = gateOf(c);
  if (!found) return fail('已至当前版本的最高境界，无关可冲');
  const gate = Number.isSafeInteger(options.dc) ? { ...found, dc: options.dc } : found;
  const clock = readClock(env.state);
  if (!clock) return fail('时间行里没有可识别的日期，无法结算冲关');
  const missing = [];
  // A gap of up to a day's cultivation (at an ordinary place) is closed as part of the attempt:
  // the hours go on the clock first. A larger gap is refused with how long it would take.
  const rate = (options.stepDays ? dayRate({ major: c.major, root: c.root.factor, technique: c.technique.factor, world: c.world?.factor ?? 1, stepDays: options.stepDays }) : perDayOf(c))
    * CULTIVATION.environment.aura[CULTIVATION.environment.default];
  const gapDays = c.progress < 100 && rate > 0 ? (100 - c.progress) / rate : null;
  const topUp = gapDays !== null && gapDays <= (CULTIVATION.breakthrough.topUpDays ?? 1)
    ? { gain: 100 - c.progress, minutes: Math.max(60, Math.ceil(gapDays * CALENDAR.hoursPerDay - 1e-9) * 60) } : null;
  if (c.progress < 100 && !topUp) {
    missing.push(`修为未圆满（${c.progress}/100）` + (gapDays !== null ? `，以眼下的速度还要修炼约${describeSpan(Math.ceil(gapDays * DAY_MINUTES))}` : '') + '，要先修炼');
  }
  if (gate.requires.includes('root') && c.root.factor <= 0) missing.push('没有灵根，引气入体无从谈起');
  if (gate.requires.includes('technique') && !c.technique.name) {
    missing.push(c.technique.unequipped ? `没有装备功法：储物袋中的「${c.technique.unequipped}」要先装备` : '没有功法：要先装备或习得一部功法');
  }
  const cooldown = cooldownOf(env);
  if (cooldown) missing.push(`冲关受挫未久，${cooldown}之前不能再冲关`);
  const left = yearsLeft(c.remarks);
  if (left !== null && gate.days / YEAR_DAYS > left) missing.push(`剩余寿元只有${Math.max(0, left)}年，撑不过冲关所需的${gate.days}日`);
  if (missing.length) return fail(missing.join('；'));
  // Aid pills: each listed ID is one pill; at most two count and only those are taken.
  const rule = CULTIVATION.breakthrough;
  const wanted = (Array.isArray(args.aid_item_ids) ? args.aid_item_ids : args.aid_item_ids ? [args.aid_item_ids] : []).map(plain).filter(Boolean);
  const picked = new Map();
  for (const key of wanted) {
    const stack = bagStack(env, key);
    if (!stack) return fail(`储物袋中没有用来辅助冲关的「${key}」`);
    if (!gate.aids.some(name => stack.name.includes(name))) {
      return fail(`「${stack.name}」不是冲击${ORDER[gate.target]}的辅助丹药` + (gate.aids.length ? `（可用：${gate.aids.join('、')}）` : '（这一关没有辅助丹药）'));
    }
    const entry = picked.get(stack.id) || { stack, count: 0 };
    entry.count += 1;
    picked.set(stack.id, entry);
  }
  const aids = [];
  let counted = 0;
  for (const { stack, count } of picked.values()) {
    const take = Math.min(count, rule.aidMax - counted);
    if (take <= 0) break;
    if (!Number.isSafeInteger(stack.count) || stack.count < take) return fail(`「${stack.name}」只有${Number.isSafeInteger(stack.count) ? stack.count : 0}枚`);
    aids.push({ id: stack.id, name: stack.name, count: take, before: stack.count, after: stack.count - take });
    counted += take;
  }
  const commands = [], owns = noOwnership();
  for (const aid of aids) {
    commands.push(aid.after ? `add(${JSON.stringify(aid.id)},{"5":"${aid.after}"})` : `de(${JSON.stringify(aid.id)})`);
    owns.items.push(aid.id);
  }
  // 气运 and 神识 as the panel totals them: gear, buffs and inborn traits count, as in a fight (the
  // life play counts only its active gear: options.totals).
  const totals = (options.totals || totalStats)(env, 'B1', c.stats);
  const values = Object.fromEntries(rule.attributes.map(stat => [stat, totals[stat] ?? statValue(c.stats[stat])]));
  const given = options.modifiers || {};
  const modifiers = Object.fromEntries(rule.attributes.map(stat => [stat, Number.isSafeInteger(given[stat]) ? given[stat] : modifierFor(values[stat])]));
  const aidBonus = Number.isSafeInteger(options.aidBonus) ? options.aidBonus : rule.aidBonus;
  const bonus = counted * aidBonus;
  const odds = Number.isSafeInteger(options.odds) ? options.odds : 0;
  // `odds` by name ([{ label, value }] that add up to it), shown on the card and in the summary
  const named = Array.isArray(options.terms) ? options.terms.filter(term => term && term.label && Number.isSafeInteger(term.value) && term.value) : [];
  const terms = named.reduce((sum, term) => sum + term.value, 0) === odds ? named : [];
  const moves = options.moveClock !== false;
  const roll = Math.floor(create(`${env.seed}:breakthrough:${ordinal}`).random() * CHECKS.die) + 1;
  const total = roll + Object.values(modifiers).reduce((sum, value) => sum + value, 0) + bonus + odds;
  const outcome = roll === CHECKS.die || total >= gate.dc + 5 ? '大成功' : total >= gate.dc ? '成功'
    : roll === 1 || total <= gate.dc - 5 ? '大失败' : '失败';
  const result = rule.outcomes[outcome];
  const succeeded = outcome === '成功' || outcome === '大成功';
  const minutes = gate.days * DAY_MINUTES + (topUp ? topUp.minutes : 0);
  const end = clock.minutes + minutes;
  const age = agedRemarks(c.remarks, clock.minutes, end);
  const stats = structuredClone(c.stats);
  const remarks = age && moves ? { 年龄: String(age.after) } : {};
  let lifespan = null, hp = null;
  const book = ledger(env);
  let next = book;
  if (succeeded) {
    realmGrowth(env, gate.target, stats, options.growth);
    refill(stats);
    const before = numberIn(c.remarks['寿元']), floor = byMajor(CULTIVATION.lifespan, gate.target);
    if (floor && (before === null || before < floor)) {
      lifespan = { before, after: floor };
      remarks['寿元'] = String(floor);
    }
    if (book.breakthroughCooldownDay !== null) next = { ...book, breakthroughCooldownDay: null };
  } else {
    const max = statValue(stats['血量'], 'max'), current = statValue(stats['血量']);
    if (max > 0) {
      const after = Math.max(1, current - Math.max(1, Math.ceil(max * result.hpLossPercent / 100)));
      stats['血量'] = { current: Math.min(after, current), max };
      hp = { before: current, after: Math.min(after, current), max };
    }
    next = { ...book, breakthroughCooldownDay: dayOf(end) + result.cooldownDays };
  }
  const climbed = succeeded
    ? { step: 1, progress: result.progress, passed: [], capped: false }
    : { step: c.step, progress: result.progress, passed: [], capped: false };
  const settled = settleProgress(env, c, climbed, stats, { remarks, realm: succeeded ? gate.to : null });
  commands.push(...settled.commands);
  owns.stats.push(...settled.owns.stats);
  owns.charStats.push(...settled.owns.charStats);
  if (moves) commands.push(`add(${JSON.stringify(TIME_ROW)},${JSON.stringify({ 0: clockText(clock, minutes) })})`);
  const time = { before: formatClock(clock.minutes, clock.timed), after: formatClock(end, clock.timed), minutes };
  const cooldownUntil = succeeded ? null : formatDay(next.breakthroughCooldownDay);
  const check = {
    kind: '突破', from: c.realm.text, to: gate.to, tier: gate.tier, dc: gate.dc, die: CHECKS.die, roll,
    attributes: rule.attributes.map(stat => ({ stat, value: values[stat], modifier: modifiers[stat] })),
    aids, aidBonus: bonus, total, outcome, consequence: CHECKS.kinds['突破'].results[outcome].text,
    realm: { before: c.realm.text, after: succeeded ? gate.to : c.realm.text },
    progress: { before: c.progress, after: result.progress }, lifespan, hp, cooldownUntil, days: gate.days,
    topUp: topUp ? { gain: topUp.gain, minutes: topUp.minutes } : null,
    growth: succeeded ? settled.changes.filter(change => change.after.max !== change.before.max)
      .map(change => ({ stat: change.stat, before: change.before.max, after: change.after.max })) : [],
    rulesVersion: CULTIVATION.version,
    ...(odds ? { odds } : {}), ...(options.foundation ? { foundation: options.foundation } : {}),
    // what `odds` is made of, by name, when the caller says (the life's gate: 灵地, 护法, 心结 …)
    ...(odds && terms.length ? { terms } : {}),
  };
  const signed = value => `${value >= 0 ? '+' : ''}${value}`;
  const mods = check.attributes.map(a => `${a.stat}修正${signed(a.modifier)}`)
    .concat(aids.map(aid => `「${aid.name}」×${aid.count}+${aid.count * aidBonus}`))
    .concat(odds ? (terms.length ? terms.map(term => `${term.label}${signed(term.value)}`) : [`其余${signed(odds)}`]) : []).join('，');
  const effects = succeeded
    ? [`境界 ${c.realm.text}→${gate.to}`, `修为 ${c.progress}→${result.progress}`, ...(lifespan ? [`寿元 ${lifespan.before ?? '未注明'}→${lifespan.after}`] : []),
       ...(grownText(settled.changes) ? [`属性提升：${grownText(settled.changes)}`] : [])]
    : [`修为 ${c.progress}→${result.progress}`, ...(hp ? [`血量 ${hp.before}→${hp.after}/${hp.max}`] : []), `${cooldownUntil}之前不能再冲关`];
  if (aids.length) effects.push(`服下${aids.map(aid => `「${aid.name}」×${aid.count}`).join('、')}`);
  if (wanted.length > counted) effects.push(`辅助丹药最多计${rule.aidMax}枚，其余未服用`);
  const locked = env.ctx.storedItemIds(env.state);
  const unused = !wanted.length && gate.aids.length
    ? Object.entries(env.state['1'] || {}).filter(([id, row]) => row && !locked.has(id) && gate.aids.some(name => rowName(row).includes(name))).map(([, row]) => rowName(row))
    : [];
  if (unused.length) effects.push(`储物袋中的${[...new Set(unused)].map(name => `「${name}」`).join('、')}这次没有服用`);
  if (topUp) effects.unshift(`冲关前运功补足最后${topUp.gain}点修为（${describeSpan(topUp.minutes)}）`);
  effects.push(`耗时${topUp ? describeSpan(minutes) : `${gate.days}日`}，时间 ${time.before}→${time.after}`);
  if (age) effects.push(`年龄 ${age.before}→${age.after}`);
  return {
    kind: 'breakthrough', ok: true, source, breakthrough: check, time, age,
    commands: commands.join('\n'), owns, ...(JSON.stringify(next) !== JSON.stringify(book) ? { frxProgress: next } : {}),
    reason: plain(args.reason).slice(0, 80),
    summary: `冲击${gate.to}（${gate.tier}，难度${gate.dc}）：1d${CHECKS.die}=${roll}，${mods}，总值${total} → ${outcome}：${check.consequence}；${effects.join('；')}`,
  };
}

// ------------------------------------------------ what the player sees

function cultivationView(env, options = null) {
  const c = cultivator(env);
  return {
    realm: c.realm.text, major: ORDER[c.major] || '凡人', progress: c.progress, top: c.top,
    root: { label: c.root.label, factor: c.root.factor, assumed: c.root.assumed },
    technique: { name: c.technique.name, factor: c.technique.factor, unequipped: c.technique.unequipped },
    perDay: round2(options ? rateBase(c, options) * placedAura(options.aura, options.auraBonus).factor
      : perDayOf(c) * CULTIVATION.environment.aura[CULTIVATION.environment.default]),
    world: c.world,
    next: nextOf(env, c),
  };
}

// 【修行】 for the user message of a pilot turn.
function cultivationPrompt(env) {
  const view = cultivationView(env);
  let text = `【修行】${view.realm}，修为${view.progress}/100；${view.root.assumed ? '灵根未注明（按真灵根计）' : view.root.label}，`
    + `功法${view.technique.name ? `「${view.technique.name}」` : '无'}`;
  if (view.technique.unequipped) text += `（储物袋中的「${view.technique.unequipped}」尚未装备）`;
  text += view.perDay > 0 ? `，在灵气寻常处修炼每日约增${view.perDay}点` : '，无法修炼';
  const next = view.next;
  if (next.kind === '小境界') text += `。下一步：${next.target}，修为满100自动晋升`;
  else if (next.kind === '突破') {
    const aid = next.aids.length ? `，可服${next.aids.join('、')}辅助，每枚+${CULTIVATION.breakthrough.aidBonus}，最多${CULTIVATION.breakthrough.aidMax}枚` : '';
    const missing = next.conditions.filter(item => !item.met);
    text += `。下一关：冲击${next.target}（难度${next.tier}${aid}，耗时${next.days}日）；条件：`
      + next.conditions.map(item => `${item.label}${item.met ? '（已满足）' : `（未满足：${item.detail}）`}`).join('，')
      + (missing.length ? '' : '，条件已齐');
  } else text += '。已至当前版本的最高境界';
  if (next.cooldownUntil) text += `。冲关受挫，${next.cooldownUntil}之前不能再冲关`;
  // The purse and what it buys: stones speed cultivation up, or pay for methods and pills.
  const stones = stonesOf(env.state['0']?.B1);
  if (stones !== null && view.perDay > 0) {
    const rate = byMajor(CULTIVATION.stones.perDay, cultivator(env).major);
    const floor = CULTIVATION.stones.floor;
    const tier = Object.entries(CULTIVATION.environment.aura).find(([, factor]) => factor === floor)?.[0];
    text += `。灵石${stones}块下品灵石：修炼时可耗用（每日${rate}块，灵气按${tier ? `「${tier}」` : `${floor}倍`}计，`
      + `已在灵气更浓之处则不必），也可留作买卖`;
  }
  text += '。修为与境界由引擎结算：修炼调用cultivate，冲关调用breakthrough；正文不写修为数值，upstore不写修为进度与境界。';
  return text.length > 560 ? text.slice(0, 559) + '…' : text;
}

// ------------------------------------------------ the main storyline's conditions

// Kinds of things a 持有 condition may name instead of an item: the item types that count, and
// for pills the names that make a consumable one.
const HELD_KINDS = {
  功法: { types: ['功法'] },
  丹药: { types: ['丹药', '消耗品'], names: /丹|丸|散|膏|液|露/ },
  法宝: { types: ['法宝'] },
  武器: { types: ['武器'] },
  护甲: { types: ['护甲'] },
  材料: { types: ['材料'] },
};

// A 持有 condition's test of a thing by its name and item type: a kind of thing (HELD_KINDS: its
// types, and for pills its name) or a named one (the name contains the value).
const heldBare = text => plain(text).replace(/[《》「」『』“”"\s]/g, '');
function heldMatch(value) {
  const category = HELD_KINDS[heldBare(value)];
  return (name, type) => (category
    ? category.types.includes(plain(type)) && (!category.names || category.names.test(name) || plain(type) === heldBare(value))
    : heldBare(name).includes(heldBare(value)));
}

function investigationGoal(text) {
  const match = plain(text).match(/(?:查明|查清|打听明晰|打听清楚|调查清楚)([^。；！？，,]{6,})/);
  return match?.[1].replace(/[\s《》「」『』]/g, '') || '';
}

function recordChapterEvidence(play, plot, before, after, receipts) {
  const chapter = plot?.chapters?.find(each => each.status !== '已完成');
  if (!chapter?.id) return;
  const previous = play.chapterEvidence?.chapter === chapter.id ? play.chapterEvidence : {};
  const evidence = { chapter: chapter.id };
  if (chapter.conditions?.some(condition => condition.kind === '灵石')) {
    evidence.stones = Math.max(previous.stones || 0, stonesOf(before['0']?.B1) || 0, stonesOf(after['0']?.B1) || 0);
  }
  const outcomes = receipts.filter(receipt => receipt.ok && receipt.kind === 'act'
    && ['探查', '交涉'].includes(receipt.check?.kind)
    && ['成功', '大成功'].includes(receipt.check?.outcome))
    .map(receipt => ({ title: plain(receipt.card?.title), goal: investigationGoal(receipt.card?.title) }))
    .filter(action => action.goal);
  const inquiries = (chapter.conditions || []).filter(condition => condition.kind === '其他').flatMap(condition => {
    const goal = investigationGoal(condition.value);
    if (!goal) return [];
    const verified = previous.inquiries?.includes(condition.value) || outcomes.some(action => {
      if (action.goal === goal) return true;
      if (action.goal.length < 8 || !goal.endsWith(action.goal)) return false;
      const scope = goal.slice(0, -action.goal.length);
      return scope.length >= 2 && action.title.includes(scope);
    });
    return verified ? [condition.value] : [];
  });
  if (inquiries.length) evidence.inquiries = inquiries;
  if (evidence.stones !== undefined || inquiries.length || play.chapterEvidence) play.chapterEvidence = evidence;
}

function conditionStatus(env, c, condition, evidence = {}) {
  const kind = plain(condition?.kind), value = plain(condition?.value);
  const count = Number.isFinite(Number(condition?.count)) && condition?.count !== null && condition?.count !== '' && condition?.count !== undefined
    ? Number(condition.count) : undefined;
  const done = (met, detail) => ({ kind, value, ...(count !== undefined ? { count } : {}), met, detail });
  switch (kind) {
    case '境界': {
      const target = parseRealm(value);
      if (!value || target.unknown) return done(false, `认不出境界「${value}」`);
      const minor = c.major <= 0 ? 0 : c.realm.minor || 1;
      return done(c.major > target.major || (c.major === target.major && minor >= (target.minor || 0)), `当前${c.realm.text}`);
    }
    case '持有': {
      if (!value) return done(false, '没有写明物品');
      const want = count ?? 1;
      const locked = env.ctx.storedItemIds(env.state);
      // A storyline may ask for a kind of thing (any 功法, any 丹药) rather than a named one.
      const bare = heldBare;
      const matches = heldMatch(value);
      let have = 0;
      const names = new Set();
      for (const [id, row] of Object.entries(env.state['1'] || {})) {
        if (!row || locked.has(id) || !matches(rowName(row), row['2'])) continue;
        const n = env.ctx.itemStackCount(row['5']);
        have += Number.isSafeInteger(n) ? n : 1;
        names.add(rowName(row));
      }
      for (const item of env.ctx.equippedItemRows(env.state['0']?.B1)) {
        const name = plain(item?.name ?? item?.['1']).split('|')[0];
        if (!matches(name, item?.type ?? item?.['2'])) continue;
        const n = Number(item.quantity ?? item['5'] ?? 1);
        have += Number.isFinite(n) && n > 0 ? n : 1;
        names.add(name);
      }
      // A learned cultivation method counts as holding a 功法.
      if (bare(value) === '功法' && c.technique.name && !names.has(c.technique.name)) { have += 1; names.add(c.technique.name); }
      return done(have >= want, have ? `有${[...names].map(name => `「${name}」`).join('、')}共${have}件` : `没有「${value}」`);
    }
    case '到达': {
      const place = placeOf(env.state);
      if (env.play || env.cultivationLife) {
        const where = require('./life/places.cjs').mapPosition(place, env.worldMap);
        const reading = [where.region, where.area, where.spot].filter(Boolean);
        return done(!!value && reading.some(part => part.includes(value)), `当前位于${reading.join('／') || '未知'}`);
      }
      return done(!!value && place.includes(value), `当前位于${place.replace(/\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*$/, '') || '未知'}`);
    }
    case '日期': {
      const target = value.match(/(\d+)\s*年(?:\s*(\d+)\s*月)?(?:\s*(\d+)\s*日)?/);
      if (!target) return done(false, `认不出日期「${value}」`);
      const clock = readClock(env.state);
      if (!clock) return done(false, '时间行里没有可识别的日期');
      const day = (Number(target[1]) - 1) * YEAR_DAYS + (Number(target[2] || 1) - 1) * CALENDAR.daysPerMonth + Number(target[3] || 1) - 1;
      return done(dayOf(clock.minutes) >= day, `当前${formatDay(dayOf(clock.minutes))}`);
    }
    case '倒下': {
      if (!value) return done(false, '没有写明人物');
      const scene = env.state['0'] || {};
      const rows = [...Object.entries(scene).filter(([id, row]) => id !== 'B1' && row),
        ...Object.entries(env.biographies || {}).filter(([id]) => !scene[id])];
      let found = rows.filter(([, row]) => rowName(row) === value);
      if (!found.length && value.length >= 2) found = rows.filter(([, row]) => rowName(row).includes(value));
      if (!found.length) return done(false, `没有名为「${value}」的人物`);
      const fallen = found.find(([, row]) => isFallen(env.ctx, row));
      return done(!!fallen, fallen ? `${rowName(fallen[1])}已倒下` : `${rowName(found[0][1])}仍未倒下`);
    }
    case '任务': {
      const quests = Object.values(env.state['6'] || {}).filter(row => row && value && rowName(row).includes(value));
      if (!quests.length) return done(false, `没有标题含「${value}」的任务`);
      const finished = quests.find(row => /已完成|已达成|^完成/.test(plain(row['5'])) && !/未完成/.test(plain(row['5'])));
      return done(!!finished, finished ? `任务「${rowName(finished)}」已完成` : `任务「${rowName(quests[0])}」${plain(quests[0]['5']) || '进行中'}`);
    }
    case '灵石': {
      const want = count ?? numberIn(value);
      if (want === null || want === undefined) return done(false, '没有写明灵石数目');
      const stones = stonesOf(env.state['0']?.B1) ?? 0;
      const gathered = Math.max(stones, evidence.stones || 0);
      return done(gathered >= want, gathered > stones && gathered >= want
        ? `曾为本章筹得灵石${gathered}块` : `当前灵石${stones}块`);
    }
    case '其他': {
      if (evidence.inquiries?.includes(value)) return done(true, '本章的调查检定已成功');
      const { threadId, quote } = condition.evidence || {};
      if (typeof threadId !== 'string' || !/^T\d+$/.test(threadId)
          || typeof quote !== 'string' || quote.length < 4) return done(null, '');
      const history = Array.isArray(env.play?.threadHistory) ? env.play.threadHistory : [];
      const proof = history.find(entry => entry?.id === threadId && entry.status === 'completed'
        && typeof entry.result === 'string' && entry.result.includes(quote));
      return proof ? done(true, quote) : done(null, '');
    }
    default:
      return done(null, '');
  }
}

// Each chapter's conditions; the current chapter is the first one not yet done.
function plotView(env, plot) {
  const c = cultivator(env);
  const chapters = Array.isArray(plot?.chapters) ? plot.chapters : [];
  const views = chapters.map(chapter => ({
    id: plain(chapter?.id),
    conditions: (Array.isArray(chapter?.conditions) ? chapter.conditions : []).map(condition => conditionStatus(env, c, condition,
      env.play?.chapterEvidence?.chapter === chapter.id ? env.play.chapterEvidence : undefined)),
  }));
  const index = chapters.findIndex(chapter => plain(chapter?.status) !== '已完成');
  const checkable = index >= 0 ? views[index].conditions.filter(condition => condition.met !== null) : [];
  return { currentIndex: index >= 0 ? index : null, allMet: checkable.length > 0 && checkable.every(condition => condition.met), chapters: views };
}

module.exports = {
  COMBAT, CULTIVATION, STATS, SLOT_OF, parseRealm, inferRealm, realmGap, referenceHp, baselineStats, readStats, totalStats, skillCost, skillFactor,
  proficiencyAfter, useSkill, resolveAttack, equipItem, unequipItem, bagGear, wornGear, updateQuest, activeQuests, combatOver,
  standingFoes, revivedStatus, rest, tradeItem, isFallen, FALLEN_WORDS, inventoryEdit,
  ledgerOf, emptyLedger, numberIn, progressValue, readClock, clockRow, formatDay, cultivator, cultivate, breakthrough, chapterReward,
  pendingChapterRewards, itemProgress, cultivationView, cultivationPrompt, plotView, recordChapterEvidence, isAid, worldFactorsOf, worldRealm, shelvedMethod,
  openingPurse, stonesOf,
  // For the cultivation-life play (apps/engine/life/), which moves the clock itself.
  clockText, spanMinutes, agedRemarks, placeOf,
  // For its fights (life/fight.cjs), which play each move themselves on the same rules.
  strike, fighter, castSkill, skillOf, defeatStatus, statValue, spellManaCost,
  // The gate's preparation sheet (life/gate.cjs) reads the same gate and cooldown as breakthrough.
  gateOf, cooldownOf,
  // What counts for a main line's 持有 (life/hints.cjs looks for it in the shops).
  heldMatch,
  // Rewards and loot (life/rewards.cjs) put goods in the bag as the trade rule does.
  nextItemIds, ITEM_TYPES,
  // The people of the cultivation life (life/people.cjs) cultivate and break through by the same rules.
  dayRate, rootOf, stepsIn, stepOf, stepName, withRealm, modifierFor, worldSpeed, placedAura,
};
