// The card uses ordinary table edits for both gaining and spending stock. Keep the
// player's original action, the story and those edits separate until settlement.
const plain = value => String(value ?? '').replace(/<[^>]*>/g, '').trim();
const numeral = '[零一二两三四五六七八九十百千万\\d]+';
const measure = '[枚颗粒瓶张份个支包滴块杯剂片根株碗壶次]';
const counted = new RegExp('^(' + numeral + ')\\s*' + measure + '\\s*');
const multiplier = /\s*[×x*]\s*(\d+)\s*$/i;
const bag = /^(?:(?:我|你|自己)的)?(?:(?:储物袋|背包|包裹|行囊)(?:里面|中|里)?|手[中里上])(?:没有|不存在|已有|剩余|剩下|仅有|最后)?的?\s*/;
// A lone 喝 or 吃 starts words that are not drinking or eating: 喝令, 喝道, 喝问, 喝彩, 喝斥,
// 喝止 (shouting); 吃惊, 吃亏, 吃力, 吃痛, 吃了一惊 (being struck by something).
const use = /^(?:服下|服用|服食|吞服|吞下|吞食|吃下|吃掉|食用|喝下|喝光|喝掉|一饮而尽|饮下|饮用|饮尽|用掉|用完|使用|消耗|连服|祭出|催动|启用|激活|装备|吃(?!惊|亏|力|紧|苦|痛|瘪|醋|香|透|准|罪|不消|不准|不住|了一惊|了一吓|了一记|了亏|了苦头|了闭门羹)|喝(?![令道问彩采斥叱止骂退住阻醒破声喊])|用)(?:了)?\s*/;
// "服用时……" and "服下后……" name a time, not a thing.
const when = /^(?:的时候|时候|之时|时|之前|以前|之后|以后|过后|后)/;
// Words of a question are never part of an item's name ("喝点什么好呢").
const asking = /有没有|有无|是不是|会不会|要不要|可不可以|什么|啥|怎么|怎样|如何|吗|呢/;
const gain = /^(?:获得|得到|取得|收到|获赠|买下|买到|买入|购入|购买|拾取|拾得|捡到|捡起|采到|采得|采集|采摘|领到|领取|接过|取到|买)(?:了)?\s*/;
const take = /^(?:从(?:储物袋|背包)[中里]?)?(?:取出|拿出|掏出)\s*/;
// Paying with a thing: "用碎灵砂换一张符", "用灵石买", "用玉佩抵账", "用铜钱付钱". Not 对付 or 抵挡.
const PAYING = /换|买|购|兑|抵(?:价|账|债|押)|(?<![对应])付(?:钱|账|款|清|给)|支付/;
const adverbs = /^(?:(?:决定|尝试|试着|立刻|立即|赶紧|赶忙|直接|缓缓|悄悄|一口气|一口|又|先|今天|当即|成功|终于)\s*)+/;
// Only the pilot's story check uses these; the original reconciliation keeps its wording.
const storyAdverbs = /^(?:(?:顺手|随手|随即|便|就|于是|也|还|再|轻轻|慢慢|小心翼翼地|毫不犹豫地|迫不及待地)\s*)+/;
const consumableName = /(?:丹药|丹|丸|散|药水|药剂|药粉|灵药|膏|灵液|灵水|露|药酒|符箓|符|灵果|药草)$/;
// Where a name the bag does not know stops: what it is for, or the next action joined to it
// (「辟谷丹并运转《水火调息诀》引气修炼」, 「回气丹以恢复法力」). Never at the name's first
// character, nor at 并没有 / 并未 / 并不 (a denial).
const purpose = /\s|(?:用来|以便|来|尝试|恢复|补充|治疗|疗伤|回满|回蓝|补血|解毒|攻击|对付|打开|探查|观察|之后|以后|的时候)|(?<=.)(?:一并|并且|并(?!没|未|不|非|无)|用?以(?=\p{Script=Han}))/u;
// A grade in front of a name: 「辟谷丹」 is the bag's 「下品辟谷丹」 when it holds no other.
const grade = /^(?:[下中上极凡良精绝]品|劣质|普通|[低中高]阶|[一二三四五六七八九十][阶品]|[天地玄黄]阶(?:[上中下]品)?)$/;
// What the player calls up that is no thing in a bag: a gift, an art, the qi in the body. 「催动入梦者的
// 奇能」, 「催动先天气运「入梦者」潜入梦境」 and 「催动“入梦者”奇能」 are a trait at work, not an item.
const POWERS = '技能|法术|法诀|咒语|功法|剑法|法力|灵力|神识|力量|方法|技巧|能力|奇能|异能|天赋|神通|本领|本事|真气|真元|内力|内息|气机|元神|神魂|血脉|气运|灵根|功力|剑气|剑意';
const power = new RegExp('(?:' + POWERS + '|术|诀)$');
const powerFirst = new RegExp('^(?:先天|后天|体内|自身|周身|丹田|全身|一身)?(?:' + POWERS + ')');
const powerAfterQuote = new RegExp('^(?:的|之)?(?:' + POWERS + '|之力)');
const realms = ['凡人', '炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'];
const requiredRealm = new RegExp('(?:仅限?|至少)(' + realms.join('|') + ')期?(及以上|或以上)?(?:修士)?(?:方可|才可|可)?(?:服用|使用|服食|吞服)');
const dailyLimit = new RegExp('(?:每日|每天|一日)(?:最多|限|仅可|限量|限用)(?:服用|使用|吞服|用|服)?\\s*(' + numeral + ')' + measure);

// `daily` false leaves the daily limit out (the cultivation life's cultivation pills: 耐药 instead).
function checkLimits(stock, amount, before, dailyUses, daily = true) {
  const rules = stock.rules.replaceAll('练气', '炼气').replaceAll('金丹', '结丹');
  const realm = rules.match(requiredRealm);
  if (realm) {
    const player = String(before['0']?.B1?.['2'] || '').split('|')[0].replace('练气', '炼气').replace('金丹', '结丹');
    const rank = realms.findIndex(name => player.includes(name));
    const required = realms.indexOf(realm[1]);
    const minimum = realm[2] || realm[0].startsWith('至少');
    if (minimum ? rank < required : rank !== required) throw new Error(`「${stock.name}」要求${realm[1]}期${minimum ? '及以上' : ''}`);
  }
  const limit = daily ? rules.match(dailyLimit) : null;
  if (!limit) return dailyUses;
  const clock = (before['4'] || []).find(row => row.id === 'TIME_LOCATION_ROW') || before['4']?.[0];
  const date = String(clock?.['0'] || '').match(/(\d+)年\s*(\d+)月\s*(\d+)日/);
  if (!date) throw new Error(`无法确定游戏日期，不能核对「${stock.name}」的每日限量`);
  const day = date.slice(1).map(Number).join('-');
  const counts = dailyUses?.day === day ? dailyUses.counts : {};
  const used = Object.hasOwn(counts, stock.name) ? counts[stock.name] : 0;
  if (used + amount > quantity(limit[1])) throw new Error(`「${stock.name}」${limit[0]}，今日已用 ${used} 份`);
  return { day, counts: { ...counts, [stock.name]: used + amount } };
}

function quantity(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = '零一二三四五六七八九';
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let value = 0, group = 0, digit = 0;
  for (const char of text.replaceAll('两', '二')) {
    if (char === '万') { value += (group + digit || 1) * 10000; group = digit = 0; }
    else if (units[char]) { group += (digit || 1) * units[char]; digit = 0; }
    else if (digits.includes(char)) digit = digits.indexOf(char);
    else return NaN;
  }
  return value + group + digit;
}

function itemObject(raw, names, previous, directUse) {
  // "服用时有没有啥需要注意的" asks about taking something; "取出补气丸，服下后调息" takes the
  // pill just named.
  if (when.test(raw.trim()) && ![...names].some(known => known && raw.trim().startsWith(known))) {
    return previous ? { name: previous, quantity: 1, counted: false } : null;
  }
  let text = raw.trim().replace(bag, '').replace(/^(?:从未出现过的|不存在的|一件名为|名为|道具)\s*/, '');
  text = text.replace(/^(?:仅剩的|最后的|剩下的|刚得到的|仅剩|最后)\s*/, '');
  // "那个杂粮饼" names the cake; a bare "这瓶" still falls back to the previous item.
  text = text.replace(/^(?:那|这)[个些块枚颗粒份张瓶包只株根片碗壶杯件把柄双套本卷]/, '');
  const amount = text.match(counted);
  if (amount) text = text.slice(amount[0].length);
  text = text.replace(/^(?:剩下的|手中的|刚得到的|仅有的|最后的|名为)/, '').trim();
  const suffix = text.match(multiplier);
  if (suffix) text = text.slice(0, suffix.index).trim();
  const quoted = text.match(/^[【\[「“《]([^】\]」”》]+)[】\]」”》]/);
  // "回春丹调息伤势" names the pill the player owns; the rest says what it is for.
  const owned = [...names].filter(known => known && text.startsWith(known)).sort((a, b) => b.length - a.length)[0];
  let name = quoted?.[1] || (names.has(text) ? text : owned || text.split(purpose, 1)[0]);
  name = name.replace(/(?:后|了)$/, '');
  if (name.includes('的') && !names.has(name)) {
    name = [...names].find(known => known && name.endsWith('的' + known)) || name;
  }
  if (name && !names.has(name)) {
    const graded = [...names].filter(known => known && known.length > name.length
      && known.endsWith(name) && grade.test(known.slice(0, -name.length)));
    if (graded.length === 1) name = graded[0];
  }
  if (!name || /^(?:它|其|这瓶|这枚|此物|这东西)$/.test(name)) name = previous;
  if (!name || name.length > 100) return null;
  const known = names.has(name);
  if (!known && asking.test(name)) return null;
  // 「催动“入梦者”奇能」: the quotes name a gift, the words after them say so
  if (!known && quoted && powerAfterQuote.test(text.slice(quoted[0].length))) return null;
  if (!known && !quoted && !bag.test(raw.trim()) && !consumableName.test(name) && !raw.startsWith('道具')) {
    // "使用星河玉髓" can refer to a completely new item; spells, gifts and resources
    // have their own rules and aren't inventory stacks.
    if (!directUse || power.test(name) || powerFirst.test(name)
        || /^(?:[口杯碗壶盏勺瓢捧])?(?:水|茶|酒|饭|粥|汤|清水|热水|凉水|冷水|茶水|热茶|清茶|井水|泉水|溪水|山泉|雨水|空气)$/.test(name)) return null;
  }
  return { name, quantity: amount ? quantity(amount[1]) : suffix ? Number(suffix[1]) : 1,
           counted: Boolean(amount || suffix) };
}

// Only affirmative actions by the player are evidence of consumption. Rules,
// conversation, decisions still being considered and suggested branches aren't.
function itemEvents(text, names, narration, playerName, options = {}) {
  const events = [];
  const acquired = new Set();
  const cleaned = plain(String(text).replace(/<\/?(?:p|div|br)\b[^>]*>/gi, '\n'))
    .replace(/[“「]([^”」]*?)[”」]/g, (whole, quote) => use.test(quote) || /[。！？喝服吞]/.test(quote) ? '' : whole);
  for (const sentence of cleaned.split(/(?<=[。！？?!])|\n/)) {
    if (/[？?]|(?:能否|能不能|可否|如果|假如|要是|是否)|(?:吗|呢)[\s。！!]*$/.test(sentence)) continue;
    let previousItem = '', sentencePlayer = false;
    const clauses = sentence.replace(/[。！!]$/, '').split(/[，,；;]|然后|随后|接着|再(?=[喝吃服饮吞用使消装])/);
    for (let index = 0; index < clauses.length; index++) {
      let clause = clauses[index].replace(/^[\s>]+/, '').trim();
      let player = false;
      for (const subject of ['玩家', '主角', '我', '你', playerName].filter(Boolean)) {
        if (clause.startsWith(subject)) {
          clause = clause.slice(subject.length).trim();
          player = true;
          break;
        }
      }
      // The pilot's story check keeps the player as the subject of later clauses.
      if (player) sentencePlayer = true;
      else if (options.inheritSubject && sentencePlayer) player = true;
      if (narration && /^(?:决定|尝试|试着|想要?|要|打算|准备|试图|正要|本想)/.test(clause)) continue;
      clause = clause.replace(adverbs, '');
      if (options.inheritSubject) clause = clause.replace(storyAdverbs, '').replace(adverbs, '');
      if (/^(?:想|要|打算|准备|试图)/.test(clause)) {
        if (narration) continue;
        clause = clause.replace(/^(?:想要?|要|打算|准备|试图)/, '');
      }
      clause = clause.replace(/^从.{1,20}?(?:那里|手中|手里|处)(?=买|购|得到|获得|接过)/, '');
      // 把灵露喝下 / 从储物袋中取出一枚补气丸服下
      const inverted = clause.match(/^(?:把|将|(?:从(?:储物袋|背包)[中里]?)?(?:取出|拿出))(.+?)(?:一口|一次)?(喝下|喝掉|饮尽|吞下|吞服|服下|吃下)(?:了)?$/);
      if (inverted) clause = inverted[2] + inverted[1];
      const denial = narration && clause.match(/^(?:并没有|并未|未能|没能|无法|没有|不能|未曾)(?=服|喝|吞|吃|饮|使用|消耗)/);
      if (denial) clause = clause.slice(denial[0].length);
      const acquisition = clause.match(gain), taken = clause.match(take);
      const verb = acquisition || taken || clause.match(use);
      if (!verb || (narration && !player && index > 0 && !previousItem)) continue;
      // "用四枚碎灵砂向摊主换一张符": paying with something is a trade, not using it up. Fighting
      // with it ("用火球符对付妖狼", "用盾符抵挡刀锋") still uses it.
      if (!acquisition && !taken && verb[0].trim() === '用' && PAYING.test(clause.slice(verb[0].length))) continue;
      const obj = itemObject(clause.slice(verb[0].length), names, previousItem,
        !narration && verb[0].trim() !== '用');
      if (!obj) continue;
      if (taken || acquisition) previousItem = obj.name;
      if (taken) continue;
      if (acquisition) acquired.add(obj.name);
      events.push({ ...obj, acquired: Boolean(acquisition), afterGain: acquired.has(obj.name), player,
                    bought: Boolean(acquisition && /^(?:买|购)/.test(acquisition[0])),
                    denied: Boolean(denial), consumed: /^(?:服|吞|吃|食|喝|饮|一饮|连服|消耗|用掉|用完)/.test(verb[0]) });
    }
  }
  return events;
}

function trackStock(before, equipped, delta, count) {
  const tracks = new Map();
  function track(id, row) {
    const initial = row ? count(row['5']) : 0;
    const stock = { id, name: plain(row?.['1']), type: row?.['2'], effect: plain(row?.['4']),
                    rules: row ? plain(row['3']) + ' ' + plain(row['4']) : '',
                    initial, current: initial,
                    added: 0, spent: 0, firstSpend: Infinity, replaced: false };
    tracks.set(id, stock);
    return stock;
  }
  for (const [id, row] of Object.entries(before['1'] || {})) if (row) track(id, row);
  // The equipment picker moves worn gear out of table 1. Older saves can keep both copies.
  for (const item of equipped) {
    const id = item.id || item['0'];
    if (id && !tracks.has(id)) {
      track(id, { '1': item.name || item['1'], '2': item.type || item['2'], '5': item.quantity ?? item['5'] });
    }
  }
  for (const [index, op] of delta.entries()) {
    const id = op.id || op.data?.['0'];
    if (!id?.startsWith('I') || !['set', 'add', 'de'].includes(op.command)) continue;
    const stock = tracks.get(id) || track(id);
    if (!stock.name && op.command === 'set') {
      stock.effect = plain(op.data['4']);
      stock.rules = plain(op.data['3']) + ' ' + stock.effect;
    }
    const name = plain(op.data?.['1']);
    if (name) {
      if (stock.name && stock.name !== name) stock.replaced = true;
      stock.name = name;
    }
    if (op.data?.['2']) {
      if (stock.type && stock.type !== op.data['2']) stock.replaced = true;
      stock.type = op.data['2'];
    }
    let next = stock.current;
    if (op.command === 'de') next = 0;
    else if (op.command === 'set' || Object.hasOwn(op.data, '5')) next = count(op.data['5']);
    stock.added += Math.max(0, next - stock.current);
    stock.spent += Math.max(0, stock.current - next);
    if (next < stock.current) stock.firstSpend = Math.min(index, stock.firstSpend);
    stock.current = next;
  }
  return tracks;
}

function gameplayChange(op, before, after) {
  if (op.command !== 'add') return true;
  if (op.id === 'TIME_LOCATION_ROW') return false;
  const row = before['0']?.[op.id], final = after['0']?.[op.id];
  if (!row || !final) return true;
  // An honest refusal can still advance the clock, describe a pose or an NPC's thoughts.
  return Object.keys(op.data).some(key => {
    if (key === '12') return false;
    if (key === '16') {
      const location = value => (value || '').split('|')[2] || '';
      return location(row[key]) !== location(final[key]);
    }
    return JSON.stringify(row[key]) !== JSON.stringify(final[key]);
  });
}

function checkRecovery(stock, story, beforeStats, afterStats, delta) {
  const recovery = /(?:恢复|回复|补充)(?:了)?\s*\d+\s*点?\s*(法力|血量|气血|生命值)|(法力|血量|气血|生命值)(?:恢复|回复|回升)(?:了)?\s*\d+\s*点?/g;
  for (const match of (stock.effect + '。' + story).matchAll(recovery)) {
    const stat = (match[1] || match[2]) === '法力' ? '法力' : '血量';
    const start = beforeStats[stat], end = afterStats[stat];
    if (start && Number.isFinite(start.current) && start.current >= start.max) continue;
    if (end && end.current > (start?.current ?? 0)) continue;
    // A gain may be real even if a later spell spends it in this same batch.
    let previous = start?.current ?? 0;
    const didRecover = delta.some(op => {
      if (op.id !== 'B1') return false;
      const value = op.command === 'updateAttribute' && op.attribute === stat
        ? op.value : op.command === 'add' ? op.data?.['11']?.[stat] : null;
      const next = typeof value === 'number' ? previous + value : value?.current;
      if (!Number.isFinite(next)) return false;
      const gain = next > previous;
      previous = next;
      return gain;
    });
    if (didRecover) continue;
    throw new Error(`「${stock.name}」的恢复效果缺少${stat}结算`);
  }
}

function reconcileItemUse({ action, story, before, after, delta, storedItemIds, itemStackCount, equipped, dailyUses, readStats }) {
  if (!action || (!action.text && !action.items?.length && !action.legacy)) return;
  const tracks = trackStock(before, equipped, delta, itemStackCount);
  const selected = action.items || [];
  const names = new Set([...tracks.values()].map(item => item.name));
  const player = plain(before['0']?.B1?.['1']).split('|')[0];
  const input = itemEvents(action.text, names, false, player);
  const outcome = itemEvents(story, names, true, player);
  const requests = new Map();
  function request(name) {
    if (!requests.has(name)) requests.set(name, { ids: new Map(), typed: 0, reported: 0, exact: false, denied: false, consumed: false });
    return requests.get(name);
  }
  for (const { id, name, quantity } of selected) {
    const ids = request(plain(name)).ids;
    ids.set(id, (ids.get(id) || 0) + quantity);
  }
  for (const event of input) if (!event.acquired) {
    if (!Number.isSafeInteger(event.quantity) || event.quantity < 1) {
      throw new Error(`「${event.name}」的使用数量必须是正整数`);
    }
    const entry = request(event.name);
    entry.typed += event.quantity;
    entry.consumed ||= event.consumed;
  }
  for (const event of outcome) if (!event.acquired && (event.player || requests.has(event.name))) {
    const entry = request(event.name);
    if (event.denied) { entry.denied = true; continue; }
    entry.reported += event.quantity;
    entry.exact ||= event.counted;
    entry.consumed ||= event.consumed;
  }
  if (!requests.size) return;
  const lockedBefore = storedItemIds(before), lockedAfter = storedItemIds(after);
  const changes = delta.some(op => gameplayChange(op, before, after));
  let usage = dailyUses;
  for (const [name, req] of requests) {
    const named = [...tracks.values()].filter(s => s.name === name);
    const expendable = stock => !stock.type || ['消耗品', '丹药', '药品', '药水', '食物'].includes(stock.type)
      || (stock.type === '材料' && req.consumed);
    const reusable = named.length && named.every(s => !expendable(s)) && !req.ids.size;
    const confirmed = req.reported > 0;
    const sourceEvents = req.typed || req.ids.size ? input : outcome;
    const acquired = sourceEvents.some(e => !e.acquired && e.name === name && e.afterGain);
    const unavailableBefore = reusable ? storedItemIds(before, false) : lockedBefore;
    const unavailableAfter = reusable ? storedItemIds(after, false) : lockedAfter;
    const usable = named.filter(stock => {
      if (!(stock.initial > 0 || stock.added > 0)) return false;
      if (unavailableAfter.has(stock.id)) return false;
      if (!unavailableBefore.has(stock.id)) return true;
      return acquired && delta.some((op, index) => op.command === 'de' && op.subId === stock.id
        && ['inventory', 'warehouse'].includes(op.subCategory) && index < stock.firstSpend
        && storedItemIds({ '0': { [op.id]: before['0']?.[op.id] } }).has(stock.id));
    });
    if (!confirmed && !changes && !usable.some(s => s.spent)) continue;
    if (req.denied) throw new Error(`正文中未使用「${name}」，道具及效果需要重新核对`);
    const desired = [...req.ids.values()].reduce((a, b) => a + b, 0) || req.typed || req.reported;
    if (!Number.isSafeInteger(desired) || desired < 1 || (req.typed && req.typed !== desired)
        || req.reported > desired || (req.exact && req.reported !== desired)) {
      throw new Error(`「${name}」的使用数量与本回合行动不一致`);
    }
    if (!req.ids.size) {
      if (usable.length > 1) throw new Error(`有多件同名的「${name}」，请从储物袋选择具体道具`);
      if (usable.length) req.ids.set(usable[0].id, desired);
    }
    if (!req.ids.size) throw new Error(`储物袋中没有可用的「${name}」`);
    if (named.some(s => s.spent && !req.ids.has(s.id))) throw new Error(`扣减的「${name}」与所选道具编号不同`);
    const receipts = sourceEvents.filter(e => e.acquired && e.name === name);
    if (receipts.length && receipts.every(e => e.counted)) {
      const received = receipts.reduce((sum, e) => sum + e.quantity, 0);
      const added = usable.reduce((sum, s) => sum + s.added, 0);
      if (added > received) throw new Error(`「${name}」的入袋数量超过已取得的 ${received} 份`);
    }
    for (const [id, amount] of req.ids) {
      const stock = usable.find(s => s.id === id);
      if (!stock || stock.replaced || (!reusable && !expendable(stock))) {
        throw new Error(`储物袋中没有可用的「${name}」(${id})`);
      }
      if (stock.added && !acquired) throw new Error(`「${name}」缺少使用前的取得记录`);
      if (!(stock.initial + stock.added >= amount)) throw new Error(`「${name}」库存不足，本回合需要 ${amount} 份`);
      if (reusable) continue;
      usage = checkLimits(stock, amount, before, usage);
      checkRecovery(stock, confirmed && requests.size === 1 ? plain(story) : '',
                    readStats(before['0']?.B1?.['11'], {}), readStats(after['0']?.B1?.['11'], {}), delta);
      if (stock.spent && stock.spent !== amount) throw new Error(`「${name}」的库存扣减数量与使用数量不一致`);
      if (stock.spent === amount) continue;
      if (!confirmed) throw new Error(`「${name}」缺少实际使用或库存扣减记录`);
      if (desired > 1 && req.reported !== desired) throw new Error(`「${name}」实际使用了几份尚未确认`);
      if ([...tracks.values()].some(other => other.spent && !requests.has(other.name))) {
        throw new Error(`指令扣除了其他道具，无法确认「${name}」的扣减`);
      }
      const row = after['1']?.[id];
      if (!row || !(stock.current >= amount)) throw new Error(`「${name}」已不在储物袋中`);
      const remaining = stock.current - amount;
      if (remaining) {
        row['5'] = String(remaining);
        delta.push({ command: 'add', id, data: { '5': row['5'] } });
      } else {
        delete after['1'][id];
        delta.push({ command: 'de', id });
      }
    }
  }
  if (usage !== dailyUses) return usage;
}

module.exports = { reconcileItemUse, itemEvents, trackStock, checkLimits, plain, quantity };
