'use strict';
/* The catalogue (图鉴, 玩法设计第十二节; plan item 29): every good the life play prices, hands out
 * and takes in, from content/life/goods.json. A thing the catalogue does not list (a story-only
 * oddity such as 「蚀纹旧铁片」) has no market price: shops do not take it, it is only a lead.
 *
 * lookup(name) → the good, or null when the catalogue does not list it. Read by its name, an
 *   alias, or its id; the name as a bag row writes it is read too (markup and a "×2" after it left
 *   out, and a quality mark: 「回气丹（精）」 is 回气丹).
 * qualityOf(name) → 精, 常 or 残: the mark after a name (the file's qualities), 常 when none;
 *   named(name, quality) → the name with its mark (none for 常). A good: { id, name, class, tier, price, uses, element?, key, age?, part?, species?,
 *   kind?, unit?, type?, effect?, aliases? } (the file's description says what each is).
 * appraise(name) → { name, good, price, text }: what it is worth, in words for the player:
 *   「底价三块灵石」, or the file's `none` (无市价) with good and price null.
 * byId(id) → the good with that id, or null.
 * tierOf(major) → the tier of a realm (mechanics.parseRealm's major): 一阶 for 凡人 and 炼气, 二阶
 *   for 筑基 and so on; the last tier past the end.
 * row(good, count, quality?) → the bag row it makes, columns 1 to 5 (the caller gives column 0, the
 *   id): name (with its quality mark), the item type (type, else its class's), uses, effect (else
 *   无) and the count.
 * unitOf(good) → its measure word (株, 枚 …); said(item) → 「青灵草三株」 for { name, count, unit };
 *   listed(items) → those joined with 、.
 * gearTypeOf(name, type) → 武器, 护甲 or 法宝 for a piece of gear written as `type` (防具, 法器 and
 *   the like read by the name's last word: 盾 is 护甲), null for anything else.
 * likeFor({ name, type, text, tier }) → the catalogue's piece a story's piece of that type is (its
 *   numbers, tier and price), null when the catalogue has none of the type.
 * pieceEffect(good) → the use a story's piece of that good is registered with: 「一阶护甲，物防+12」.
 * ofItem(texts) → the good a bag row or worn piece is: lookup by its name, else the catalogue's
 *   piece its use names (a story's piece: pieceEffect), else null.
 * GOODS, CLASSES, TIERS, NONE, GEAR_TYPES: the file's goods, classes, tier names in order, 无市价,
 *   and the slots' types a piece can be.
 */
const { plain } = require('../item-use.cjs');
const chronicle = require('./chronicle.cjs');
const { data } = require('./data.cjs');

const FILE = data('goods');
const GOODS = FILE.goods;
const CLASSES = FILE.classes;
const TIERS = Object.keys(FILE.tiers);
const NONE = FILE.none;
const QUALITIES = FILE.qualities;
const MARK = new RegExp(`（(${QUALITIES.join('|')})）$`);

const byName = new Map();
for (const good of GOODS) for (const name of [good.name, ...(good.aliases || [])]) byName.set(name, good);
const ids = new Map(GOODS.map(good => [good.id, good]));

const byId = id => ids.get(String(id ?? '')) || null;

function lookup(name) {
  const text = plain(name).split('|')[0].replace(/\s*[×xX*]\s*\d+\s*$/, '').trim();
  return byName.get(text) || ids.get(text) || byName.get(text.replace(MARK, '')) || null;
}

const qualityOf = name => plain(name).split('|')[0].trim().match(MARK)?.[1] ?? '常';
const named = (name, quality) => (quality && quality !== '常' ? `${name}（${quality}）` : name);

const unitOf = good => good.unit || CLASSES[good.class].unit;

function appraise(name) {
  const good = lookup(name);
  if (!good) return { name: plain(name), good: null, price: null, text: NONE };
  return { name: good.name, good, price: good.price, text: `底价${chronicle.count(good.price)}块灵石` };
}

const tierOf = major => TIERS[Math.min(TIERS.length - 1, Math.max(0, (Number(major) || 0) - 1))];

const row = (good, count, quality) => ({
  1: named(good.name, quality), 2: good.type || CLASSES[good.class].type, 3: good.uses, 4: good.effect || '无', 5: String(count),
});

const said = item => `${named(item.name, item.quality)}${chronicle.count(item.count)}${item.unit}`;
const listed = items => items.map(said).join('、');

// ---------------------------------------------------------------- a piece of the story's

// A piece of gear the story names that the catalogue does not list (the owner's 玄甲盾, bought at
// 万宝阁 for a 百年血参, which could not be worn) is the catalogue's piece of its kind and tier
// under the story's name: its numbers, tier and price are that piece's (玩法设计第十二节: the
// numbers are the engine's). The kinds are the slots' types; a written type of another word (防具,
// 法器, 装备) or none is read from the name's last word.
const GEAR_TYPES = ['武器', '护甲', '法宝'];
const ARMOR_WORDS = /(?:盾|甲|铠|衣|袍|裳|靴|履|盔)$/;
const WEAPON_WORDS = /(?:剑|刀|枪|戟|戈|矛|鞭|锤|斧|棍|棒|弓|刃|匕|钩|叉)$/;
const TREASURE_WORDS = /(?:镜|幡|钉|珠|环|印|钟|塔|鼎|扇|梭|轮|葫芦|铃|尺|锥)$/;
// what is no piece whatever type it is written as: a formation's flag or plate (arrays.cjs has its
// own), a talisman, a token, a book, a map
const NOT_PIECES = /(?:阵旗|阵盘|阵图|旗|盘|符|箓|简|册|书|经|诀|图|录|令|牌|信|笺|卷)$/;
const ARMOR_TYPES = new Set(['护甲', '防具', '盔甲', '甲胄', '护具']);
const LOOSE_TYPES = new Set(['法宝', '法器', '装备', '器物', '']);
const STAT = /([一-龥]+)\s*\+\s*\d/g;
const QUALITY_WORDS = { 下品: '下', 中品: '中', 上品: '上', 极品: '极', 顶阶: '极' };

// The slot type (武器, 护甲, 法宝) of a thing written with `type`, or null when it is no piece: a
// thing written as a piece of any kind (or with no type) is the kind its name's last word says
// first (a 盾 written as 武器 is 护甲: the owner's replayed 玄甲盾), else the kind written.
function gearTypeOf(name, type) {
  const written = plain(type), text = plain(name);
  if (NOT_PIECES.test(text)) return null;
  if (written !== '武器' && !ARMOR_TYPES.has(written) && !LOOSE_TYPES.has(written)) return null;
  if (ARMOR_WORDS.test(text)) return '护甲';
  if (WEAPON_WORDS.test(text)) return '武器';
  if (written === '武器') return '武器';
  if (ARMOR_TYPES.has(written)) return '护甲';
  return written === '法宝' || written === '法器' || TREASURE_WORDS.test(text) ? '法宝' : null;
}

const statsOf = effect => [...String(effect || '').matchAll(STAT)].map(found => found[1]);
const pieces = GOODS.filter(good => GEAR_TYPES.includes(good.type) && statsOf(good.effect).length);

// The catalogue's piece a story's piece is: of its type (gearTypeOf's), at `tier` (else the
// nearest tier below that has one, else the lowest that has one), the closest by the name's last
// word (盾 is 青木盾), then what its words say it is for (防, 攻), then its quality word (中品),
// the cheapest of equals. Null when the catalogue has no piece of that type.
function likeFor({ name, type, text = '', tier }) {
  const pool = pieces.filter(good => good.type === type);
  if (!pool.length) return null;
  const tiers = [...new Set(pool.map(good => good.tier))].sort((a, b) => TIERS.indexOf(a) - TIERS.indexOf(b));
  const below = tiers.filter(each => TIERS.indexOf(each) <= TIERS.indexOf(tier));
  const at = below.length ? below.at(-1) : tiers[0];
  const words = `${plain(name)} ${plain(text)}`, last = plain(name).slice(-1);
  const quality = Object.entries(QUALITY_WORDS).find(([word]) => words.includes(word))?.[1];
  const aims = [/防|护|挡|御/.test(words) ? '防' : null, /攻|杀|伤|斩|破敌/.test(words) ? '攻' : null].filter(Boolean);
  const score = good => (good.name.endsWith(last) ? 4 : 0)
    + (aims.some(aim => statsOf(good.effect).some(stat => stat.includes(aim))) ? 2 : 0) + (quality && good.quality === quality ? 1 : 0);
  return pool.filter(good => good.tier === at).sort((a, b) => score(b) - score(a) || a.price - b.price)[0];
}

// What a story's piece is registered with as its use (column 4): the catalogue piece's tier, type
// and effect, 「一阶护甲，物防+12」, by which it is known again (ofItem). A row that only happens to
// write a piece's effect (「物攻+12」 on a 五阶 relic) is not taken for that piece.
const pieceEffect = good => `${good.tier}${good.type}，${good.effect}`;

// The catalogue's good a bag row or worn piece is: by its name, else, for a piece of the story's,
// the catalogue's piece its use names (pieceEffect).
function ofItem(texts) {
  const good = lookup(texts?.name ?? texts?.['1'] ?? '');
  if (good) return good;
  const type = plain(texts?.type ?? texts?.['2']), effect = plain(texts?.effect ?? texts?.['4']);
  return GEAR_TYPES.includes(type) ? pieces.find(piece => piece.type === type && pieceEffect(piece) === effect) || null : null;
}

module.exports = {
  GOODS, CLASSES, TIERS, NONE, QUALITIES, GEAR_TYPES, lookup, appraise, byId, tierOf, row, unitOf, said, listed, qualityOf, named,
  gearTypeOf, likeFor, pieceEffect, ofItem,
};
